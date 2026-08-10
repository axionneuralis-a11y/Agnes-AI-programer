// ============ KONFIGURASI ============
const CONFIG = {
  AGNES_API: {
    keys: [
      'API_KEY_1',  // Ganti dengan key asli
      'API_KEY_2'   // Ganti dengan key asli
    ],
    model: 'agnes-2.5-flash',
    maxTokens: 32768, // Maksimum untuk coding
    baseUrl: 'https://api.agnes.ai/v1'
  },
  
  GITHUB: {
    token: 'gh_classic_YOUR_TOKEN',
    projectsRepo: 'axionneuralis-a11y/projects',
    memoryRepo: 'axionneuralis-a11y/memory',
    branch: 'main'
  }
};

// ============ HELPERS ============
class GitHubAPI {
  constructor(token) {
    this.token = token;
    this.baseUrl = 'https://api.github.com';
    this.headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };
  }

  async getFileContent(repo, path) {
    const url = `${this.baseUrl}/repos/${repo}/contents/${path}`;
    const response = await fetch(url, { headers: this.headers });
    
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub error: ${response.status}`);
    
    const data = await response.json();
    return {
      content: atob(data.content),
      sha: data.sha,
      encoding: data.encoding
    };
  }

  async createOrUpdateFile(repo, path, content, message, sha = null) {
    const url = `${this.baseUrl}/repos/${repo}/contents/${path}`;
    const body = {
      message,
      content: btoa(content),
      branch: CONFIG.GITHUB.branch
    };
    if (sha) body.sha = sha;

    const response = await fetch(url, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(`GitHub error: ${response.status}`);
    return await response.json();
  }

  async createDirectory(repo, path, message) {
    // Buat file .gitkeep untuk membuat directory
    return this.createOrUpdateFile(
      repo, 
      `${path}/.gitkeep`, 
      '', 
      message || `Create directory ${path}`
    );
  }

  async listDirectory(repo, path = '') {
    const url = `${this.baseUrl}/repos/${repo}/contents/${path}`;
    const response = await fetch(url, { headers: this.headers });
    
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`GitHub error: ${response.status}`);
    
    return await response.json();
  }
}

class AgnesAI {
  constructor(apiKeys, model, maxTokens) {
    this.apiKeys = apiKeys;
    this.model = model;
    this.maxTokens = maxTokens;
    this.currentKeyIndex = 0;
  }

  async generateResponse(prompt, systemPrompt = '') {
    const maxRetries = this.apiKeys.length;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const keyIndex = (this.currentKeyIndex + attempt) % this.apiKeys.length;
      const apiKey = this.apiKeys[keyIndex];
      
      try {
        const response = await fetch(`${CONFIG.AGNES_API.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt }
            ],
            max_tokens: this.maxTokens,
            temperature: 0.7,
            top_p: 0.9
          })
        });

        if (response.status === 429) {
          console.log(`Rate limit hit untuk key ${keyIndex + 1}, mencoba key lain...`);
          continue;
        }

        if (!response.ok) {
          throw new Error(`Agnes AI error: ${response.status}`);
        }

        const data = await response.json();
        this.currentKeyIndex = (keyIndex + 1) % this.apiKeys.length; // Rotate key
        return data.choices[0].message.content;

      } catch (error) {
        console.error(`Attempt ${attempt + 1} failed:`, error);
        if (attempt === maxRetries - 1) throw error;
      }
    }
  }
}

// ============ MAIN WORKER ============
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Initialisasi services
    const github = new GitHubAPI(CONFIG.GITHUB.token);
    const agnes = new AgnesAI(
      CONFIG.AGNES_API.keys,
      CONFIG.AGNES_API.model,
      CONFIG.AGNES_API.maxTokens
    );

    // Routing
    try {
      // API Routes
      if (path === '/api/chat' && method === 'POST') {
        return await handleChat(request, github, agnes);
      }
      
      if (path === '/api/projects' && method === 'GET') {
        return await getProjects(github);
      }
      
      if (path === '/api/projects' && method === 'POST') {
        return await createProject(request, github);
      }
      
      if (path === '/api/projects/:project/files' && method === 'GET') {
        return await getProjectFiles(request, github);
      }
      
      if (path === '/api/projects/:project/files' && method === 'POST') {
        return await updateProjectFile(request, github);
      }

      // Serve frontend
      if (path === '/' || path === '/index.html') {
        return serveFrontend();
      }

      return new Response('Not Found', { status: 404 });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

// ============ HANDLERS ============
async function handleChat(request, github, agnes) {
  const { message, projectName } = await request.json();
  
  // Build system prompt with memory and project context
  let systemPrompt = `You are Agnes AI, a coding assistant.
You have access to GitHub repositories:
- Projects: ${CONFIG.GITHUB.projectsRepo}
- Memory: ${CONFIG.GITHUB.memoryRepo}

Current project: ${projectName || 'none'}

You can perform GitHub operations:
1. Read/write files in projects
2. Create new projects (folders)
3. Commit and push changes
4. Access memory for persistent context

Always use proper folder structure: ${projectName}/filename

When creating new projects, create the folder first.
Respond with clear, executable code.`;

  // Get memory context if exists
  if (projectName) {
    try {
      const memoryPath = `${projectName}/memory.md`;
      const memoryContent = await github.getFileContent(
        CONFIG.GITHUB.memoryRepo,
        memoryPath
      );
      if (memoryContent) {
        systemPrompt += `\n\nMemory for this project:\n${memoryContent.content}`;
      }
    } catch (e) {
      console.log('No memory found for project');
    }
  }

  // Generate AI response
  const fullPrompt = `Project: ${projectName || 'none'}\nUser: ${message}`;
  const response = await agnes.generateResponse(fullPrompt, systemPrompt);

  // Save to memory
  if (projectName) {
    try {
      const memoryPath = `${projectName}/memory.md`;
      const existing = await github.getFileContent(
        CONFIG.GITHUB.memoryRepo,
        memoryPath
      );
      
      const newMemory = `### ${new Date().toISOString()}\nUser: ${message}\nAgnes: ${response}\n\n`;
      const updatedContent = existing ? existing.content + newMemory : newMemory;
      
      await github.createOrUpdateFile(
        CONFIG.GITHUB.memoryRepo,
        memoryPath,
        updatedContent,
        `Update memory for ${projectName}`,
        existing?.sha
      );
    } catch (e) {
      console.log('Failed to save memory:', e);
    }
  }

  return new Response(JSON.stringify({ response }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getProjects(github) {
  const files = await github.listDirectory(CONFIG.GITHUB.projectsRepo);
  
  const projects = files
    .filter(f => f.type === 'dir')
    .map(f => ({
      name: f.name,
      path: f.path,
      url: f.html_url
    }));

  return new Response(JSON.stringify({ projects }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function createProject(request, github) {
  const { projectName } = await request.json();
  
  if (!projectName) {
    return new Response(JSON.stringify({ error: 'Project name required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Create project folder
  await github.createDirectory(
    CONFIG.GITHUB.projectsRepo,
    projectName,
    `Create project: ${projectName}`
  );

  // Create memory for project
  await github.createDirectory(
    CONFIG.GITHUB.memoryRepo,
    projectName,
    `Create memory for project: ${projectName}`
  );

  // Create initial README
  const readmeContent = `# ${projectName}\n\nProject created at ${new Date().toISOString()}`;
  await github.createOrUpdateFile(
    CONFIG.GITHUB.projectsRepo,
    `${projectName}/README.md`,
    readmeContent,
    `Initial README for ${projectName}`
  );

  return new Response(JSON.stringify({ 
    success: true, 
    project: projectName,
    url: `https://github.com/${CONFIG.GITHUB.projectsRepo}/tree/main/${projectName}`
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getProjectFiles(request, github) {
  const projectName = new URL(request.url).pathname.split('/')[3];
  const files = await github.listDirectory(
    CONFIG.GITHUB.projectsRepo,
    projectName
  );

  return new Response(JSON.stringify({ files }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function updateProjectFile(request, github) {
  const projectName = new URL(request.url).pathname.split('/')[3];
  const { path: filePath, content, message } = await request.json();

  const fullPath = `${projectName}/${filePath}`;
  const existing = await github.getFileContent(
    CONFIG.GITHUB.projectsRepo,
    fullPath
  );

  const result = await github.createOrUpdateFile(
    CONFIG.GITHUB.projectsRepo,
    fullPath,
    content,
    message || `Update ${filePath}`,
    existing?.sha
  );

  return new Response(JSON.stringify({ success: true, result }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// ============ FRONTEND ============
function serveFrontend() {
  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agnes AI - Coding Assistant</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      height: 100vh;
      display: flex;
    }
    
    /* Sidebar */
    .sidebar {
      width: 280px;
      background: #1a1a1a;
      border-right: 1px solid #2a2a2a;
      display: flex;
      flex-direction: column;
      padding: 20px;
    }
    .sidebar-header {
      padding-bottom: 20px;
      border-bottom: 1px solid #2a2a2a;
    }
    .sidebar-header h1 {
      font-size: 20px;
      color: #fff;
    }
    .sidebar-header .sub {
      font-size: 12px;
      color: #888;
      margin-top: 4px;
    }
    
    .projects-list {
      flex: 1;
      overflow-y: auto;
      margin: 20px 0;
    }
    .project-item {
      padding: 12px;
      background: #252525;
      border-radius: 8px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: all 0.2s;
      border: 1px solid transparent;
    }
    .project-item:hover {
      background: #2a2a2a;
      border-color: #3a3a3a;
    }
    .project-item.active {
      border-color: #6c63ff;
      background: #2a2a4a;
    }
    .project-item .name {
      font-weight: 500;
    }
    .project-item .path {
      font-size: 11px;
      color: #888;
      margin-top: 4px;
    }
    
    .btn-new-project {
      padding: 12px;
      background: #6c63ff;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s;
    }
    .btn-new-project:hover {
      background: #7b73ff;
      transform: translateY(-1px);
    }
    
    /* Main Chat */
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .chat-header {
      padding: 20px;
      border-bottom: 1px solid #2a2a2a;
      background: #0f0f0f;
    }
    .chat-header .project-name {
      font-size: 18px;
      font-weight: 600;
    }
    .chat-header .repo-link {
      font-size: 12px;
      color: #6c63ff;
      text-decoration: none;
    }
    
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .message {
      max-width: 80%;
      padding: 12px 16px;
      border-radius: 12px;
      animation: slideIn 0.3s ease;
    }
    .message.user {
      align-self: flex-end;
      background: #6c63ff;
      color: white;
      border-bottom-right-radius: 4px;
    }
    .message.agnes {
      align-self: flex-start;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-bottom-left-radius: 4px;
    }
    .message .time {
      font-size: 10px;
      opacity: 0.7;
      margin-top: 4px;
    }
    .message pre {
      background: #0a0a0a;
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
      font-size: 13px;
      border: 1px solid #2a2a2a;
    }
    .message code {
      font-family: 'Courier New', monospace;
      background: #0a0a0a;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }
    
    .input-area {
      padding: 20px;
      border-top: 1px solid #2a2a2a;
      background: #0f0f0f;
      display: flex;
      gap: 12px;
    }
    .input-area textarea {
      flex: 1;
      padding: 12px;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      color: #e0e0e0;
      resize: none;
      font-family: inherit;
      font-size: 14px;
      min-height: 50px;
      max-height: 150px;
    }
    .input-area textarea:focus {
      outline: none;
      border-color: #6c63ff;
    }
    .input-area button {
      padding: 12px 24px;
      background: #6c63ff;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s;
    }
    .input-area button:hover {
      background: #7b73ff;
    }
    .input-area button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .modal {
      position: fixed;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: rgba(0,0,0,0.8);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal.active {
      display: flex;
    }
    .modal-content {
      background: #1a1a1a;
      padding: 30px;
      border-radius: 12px;
      max-width: 400px;
      width: 90%;
    }
    .modal-content h2 {
      margin-bottom: 20px;
    }
    .modal-content input {
      width: 100%;
      padding: 12px;
      background: #0a0a0a;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      color: #e0e0e0;
      margin-bottom: 16px;
      font-size: 14px;
    }
    .modal-content input:focus {
      outline: none;
      border-color: #6c63ff;
    }
    .modal-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
    .modal-actions button {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
    }
    .modal-actions .cancel {
      background: #2a2a2a;
      color: #e0e0e0;
    }
    .modal-actions .create {
      background: #6c63ff;
      color: white;
    }
    
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .loading {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 2px solid #2a2a2a;
      border-top-color: #6c63ff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #0a0a0a; }
    ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #3a3a3a; }
  </style>
</head>
<body>

<div class="sidebar">
  <div class="sidebar-header">
    <h1>🤖 Agnes AI</h1>
    <div class="sub">Coding Assistant • ${CONFIG.AGNES_API.model}</div>
  </div>
  
  <div class="projects-list" id="projectsList">
    <div style="text-align:center;color:#666;padding:20px;font-size:14px;">
      Belum ada project<br>
      <span style="font-size:12px;">Klik "New Project" untuk mulai</span>
    </div>
  </div>
  
  <button class="btn-new-project" onclick="showNewProjectModal()">
    + New Project
  </button>
</div>

<div class="main">
  <div class="chat-header">
    <div class="project-name" id="currentProject">No Project Selected</div>
    <a class="repo-link" id="repoLink" href="#" target="_blank">View on GitHub</a>
  </div>
  
  <div class="messages" id="messages">
    <div class="message agnes">
      👋 Hi! I'm Agnes AI, your coding assistant.<br>
      Select or create a project to get started.
    </div>
  </div>
  
  <div class="input-area">
    <textarea id="messageInput" placeholder="Type your message..." rows="2"></textarea>
    <button id="sendBtn" onclick="sendMessage()">Send</button>
  </div>
</div>

<!-- Modal New Project -->
<div class="modal" id="newProjectModal">
  <div class="modal-content">
    <h2>📁 New Project</h2>
    <input type="text" id="projectNameInput" placeholder="Project name (e.g., my-app)">
    <div class="modal-actions">
      <button class="cancel" onclick="closeModal()">Cancel</button>
      <button class="create" onclick="createProject()">Create</button>
    </div>
  </div>
</div>

<script>
  let currentProject = null;
  let isLoading = false;

  // Load projects on startup
  async function loadProjects() {
    try {
      const response = await fetch('/api/projects');
      const data = await response.json();
      const container = document.getElementById('projectsList');
      
      if (data.projects && data.projects.length > 0) {
        container.innerHTML = data.projects.map(p => 
          `<div class="project-item" onclick="selectProject('${p.name}')">
            <div class="name">📁 ${p.name}</div>
            <div class="path">${p.path}</div>
          </div>`
        ).join('');
      } else {
        container.innerHTML = `
          <div style="text-align:center;color:#666;padding:20px;font-size:14px;">
            No projects yet<br>
            <span style="font-size:12px;">Click "New Project" to start</span>
          </div>
        `;
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  }

  function selectProject(name) {
    currentProject = name;
    document.getElementById('currentProject').textContent = '📁 ' + name;
    document.getElementById('repoLink').href = 
      'https://github.com/axionneuralis-a11y/projects/tree/main/' + name;
    
    // Update active state
    document.querySelectorAll('.project-item').forEach(el => {
      el.classList.toggle('active', el.querySelector('.name').textContent.includes(name));
    });
    
    // Clear messages
    document.getElementById('messages').innerHTML = `
      <div class="message agnes">
        💬 Project: ${name}<br>
        What would you like to work on?
      </div>
    `;
  }

  function showNewProjectModal() {
    document.getElementById('newProjectModal').classList.add('active');
    document.getElementById('projectNameInput').focus();
  }

  function closeModal() {
    document.getElementById('newProjectModal').classList.remove('active');
  }

  async function createProject() {
    const name = document.getElementById('projectNameInput').value.trim();
    if (!name) return alert('Please enter a project name');
    
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: name })
      });
      
      const data = await response.json();
      if (data.success) {
        closeModal();
        loadProjects();
        selectProject(name);
        document.getElementById('projectNameInput').value = '';
      } else {
        alert('Failed to create project: ' + data.error);
      }
    } catch (error) {
      alert('Error creating project: ' + error.message);
    }
  }

  async function sendMessage() {
    if (isLoading) return;
    
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message) return;
    if (!currentProject) {
      alert('Please select or create a project first');
      return;
    }
    
    // Add user message
    addMessage(message, 'user');
    input.value = '';
    
    // Show loading
    isLoading = true;
    document.getElementById('sendBtn').disabled = true;
    const loadingMsg = addMessage('<div class="loading"></div>', 'agnes', true);
    
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message, 
          projectName: currentProject 
        })
      });
      
      const data = await response.json();
      
      // Remove loading message
      loadingMsg.remove();
      
      // Add AI response with formatting
      const formattedResponse = formatResponse(data.response);
      addMessage(formattedResponse, 'agnes');
      
    } catch (error) {
      loadingMsg.remove();
      addMessage('❌ Error: ' + error.message, 'agnes');
    } finally {
      isLoading = false;
      document.getElementById('sendBtn').disabled = false;
    }
  }

  function addMessage(content, type, isHtml = false) {
    const messages = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message ' + type;
    if (isHtml) {
      div.innerHTML = content;
    } else {
      div.innerHTML = content;
    }
    div.innerHTML += `<div class="time">${new Date().toLocaleTimeString()}</div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function formatResponse(text) {
    // Simple markdown formatting
    return text
      .replace(/\\n/g, '<br>')
      .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
      .replace(/\`([^\`]*)\`/g, '<code>$1</code>')
      .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
  }

  // Enter key to send
  document.getElementById('messageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Enter key in modal
  document.getElementById('projectNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createProject();
  });

  // Load
  loadProjects();
</script>

</body>
</html>`;

  return new Response(html, {
    headers: { 
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache'
    }
  });
      }
