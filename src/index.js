import { jsonResponse, errorResponse, CORS_HEADERS } from './utils';
import { GitHubAPI } from './github';
import { AgnesAI } from './ai';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Tangani preflight OPTIONS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const githubProjects = new GitHubAPI(env.GITHUB_TOKEN, env.GITHUB_PROJECTS_REPO);
    const githubMemory   = new GitHubAPI(env.GITHUB_TOKEN, env.GITHUB_MEMORY_REPO);
    const ai = new AgnesAI(env);

    try {
      // ---------- CHAT ----------
      if (path === '/api/chat' && request.method === 'POST') {
        return handleChat(request, ai, githubProjects, githubMemory, env);
      }

      // ---------- PROJECTS ----------
      if (path === '/api/projects' && request.method === 'GET') {
        const data = await githubProjects.listDirectory('');
        return jsonResponse(data);
      }

      if (path === '/api/projects/create' && request.method === 'POST') {
        const { name } = await request.json();
        if (!name) return errorResponse('Project name required');
        await githubProjects.createFolder(name, `Create project ${name}`);
        return jsonResponse({ success: true, name });
      }

      if (path === '/api/projects/files' && request.method === 'GET') {
        const project = url.searchParams.get('project');
        const sub = url.searchParams.get('path') || '';
        if (!project) return errorResponse('Project name required');
        const data = await githubProjects.listDirectory(`${project}/${sub}`);
        return jsonResponse(data);
      }

      if (path === '/api/projects/file' && request.method === 'GET') {
        const project = url.searchParams.get('project');
        const filePath = url.searchParams.get('path');
        if (!project || !filePath) return errorResponse('Project and path required');
        const data = await githubProjects.getFile(`${project}/${filePath}`);
        return jsonResponse(data);
      }

      if (path === '/api/projects/file' && request.method === 'PUT') {
        const { project, path: filePath, content, message } = await request.json();
        if (!project || !filePath || content === undefined) {
          return errorResponse('Project, path, and content required');
        }
        const existing = await githubProjects.getFile(`${project}/${filePath}`);
        const sha = existing ? existing.sha : null;
        await githubProjects.createOrUpdateFile(
          `${project}/${filePath}`,
          content,
          message || `Update ${filePath}`,
          sha
        );
        return jsonResponse({ success: true });
      }

      // ---------- MEMORY ----------
      if (path === '/api/memory' && request.method === 'GET') {
        const data = await githubMemory.listDirectory('');
        return jsonResponse(data);
      }

      if (path === '/api/memory/save' && request.method === 'POST') {
        const { key, content } = await request.json();
        if (!key || content === undefined) return errorResponse('Key and content required');
        await githubMemory.createOrUpdateFile(`${key}.md`, content, `Update memory ${key}`);
        return jsonResponse({ success: true });
      }

      if (path === '/api/memory/get' && request.method === 'GET') {
        const key = url.searchParams.get('key');
        if (!key) return errorResponse('Key required');
        const data = await githubMemory.getFile(`${key}.md`);
        return jsonResponse(data);
      }

      // ---------- FALLBACK ----------
      return errorResponse('Not found', 404);
    } catch (err) {
      console.error('Worker error:', err);
      return errorResponse(err.message || 'Internal error', 500);
    }
  },
};

// ---------- CHAT HANDLER ----------
async function handleChat(request, ai, githubProjects, githubMemory, env) {
  const { messages, project } = await request.json();

  // Context: project files
  let projectContext = '';
  if (project) {
    try {
      const files = await githubProjects.listDirectory(project);
      projectContext = `Project "${project}" contains: ${files.map(f => f.name).join(', ')}`;
    } catch {
      projectContext = `Project "${project}" not found or empty.`;
    }
  }

  // Context: memory
  let memoryContext = '';
  try {
    const mems = await githubMemory.listDirectory('');
    memoryContext = `Memory files: ${mems.map(f => f.name).join(', ')}`;
  } catch {
    memoryContext = 'No memory files found.';
  }

  const systemPrompt = `
Anda adalah Agnes AI, asisten coding profesional yang terhubung dengan GitHub.

REPOSITORI:
- Projects: ${env.GITHUB_PROJECTS_REPO}
- Memory:   ${env.GITHUB_MEMORY_REPO}

KONTEKS SAAT INI:
${projectContext}
${memoryContext}

Anda dapat membantu user dengan membuat project, menulis kode, commit, push, dan menyimpan memory.

Jika user meminta tindakan di GitHub, Anda HARUS merespon dengan JSON:
{
  "response": "Pesan ke user",
  "tool_calls": [
    { "name": "nama_tool", "arguments": { ... } }
  ]
}

TOOLS:
1. create_project   → { "name": "nama_project" }
2. save_file        → { "project": "x", "path": "file.js", "content": "..." }
3. read_file        → { "project": "x", "path": "file.js" }
4. commit_project   → { "project": "x", "message": "pesan" }
5. save_memory      → { "key": "nama", "content": "..." }
6. read_memory      → { "key": "nama" }
7. list_projects    → {}
8. list_files       → { "project": "x", "path": "" }

Jika tidak ada tool, kirim "tool_calls": [].
Jangan membuat asumsi, tanyakan jika kurang jelas.
`;

  // Gabungkan system prompt ke pesan user terakhir (Agnes API tidak support system role)
  let modifiedMessages = [...messages];
  let lastUserIndex = -1;
  for (let i = modifiedMessages.length - 1; i >= 0; i--) {
    if (modifiedMessages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex !== -1) {
    modifiedMessages[lastUserIndex].content = systemPrompt + "\n\n" + modifiedMessages[lastUserIndex].content;
  } else {
    // Jika tidak ada pesan user, tambahkan sebagai user
    modifiedMessages.push({ role: 'user', content: systemPrompt });
  }

  try {
    const result = await ai.call(modifiedMessages, { temperature: 0.7 });
    const raw = result.choices[0].message.content;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // plain text response
      return jsonResponse({ response: raw, tool_calls: [] });
    }

    const toolResults = [];
    if (parsed.tool_calls?.length) {
      for (const tool of parsed.tool_calls) {
        const r = await executeTool(tool, githubProjects, githubMemory);
        toolResults.push(r);
      }
    }

    return jsonResponse({
      response: parsed.response || raw,
      tool_calls: parsed.tool_calls || [],
      tool_results: toolResults,
    });
  } catch (err) {
    console.error('Chat error:', err);
    return errorResponse(err.message, 500);
  }
}

// ---------- TOOL EXECUTOR ----------
async function executeTool(tool, githubProjects, githubMemory) {
  const { name, arguments: args } = tool;
  try {
    switch (name) {
      case 'create_project': {
        await githubProjects.createFolder(args.name, `Create project ${args.name}`);
        return { success: true, message: `Project "${args.name}" created.` };
      }
      case 'save_file': {
        const full = `${args.project}/${args.path}`;
        const existing = await githubProjects.getFile(full);
        await githubProjects.createOrUpdateFile(
          full,
          args.content,
          `Update ${args.path}`,
          existing?.sha
        );
        return { success: true, message: `File "${args.path}" saved in "${args.project}".` };
      }
      case 'read_file': {
        const full = `${args.project}/${args.path}`;
        const data = await githubProjects.getFile(full);
        if (!data) return { success: false, error: 'File not found.' };
        return { success: true, content: data.content };
      }
      case 'commit_project': {
        // commit is implicit with save_file, but we acknowledge
        return { success: true, message: `Commit "${args.message}" acknowledged.` };
      }
      case 'save_memory': {
        await githubMemory.createOrUpdateFile(`${args.key}.md`, args.content, `Update memory ${args.key}`);
        return { success: true, message: `Memory "${args.key}" saved.` };
      }
      case 'read_memory': {
        const data = await githubMemory.getFile(`${args.key}.md`);
        if (!data) return { success: false, error: 'Memory not found.' };
        return { success: true, content: data.content };
      }
      case 'list_projects': {
        const list = await githubProjects.listDirectory('');
        return { success: true, projects: list.map(f => f.name) };
      }
      case 'list_files': {
        const path = args.path || '';
        const list = await githubProjects.listDirectory(`${args.project}/${path}`);
        return { success: true, files: list.map(f => ({ name: f.name, path: f.path, type: f.type })) };
      }
      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
  }
