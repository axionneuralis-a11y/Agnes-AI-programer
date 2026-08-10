export class GitHubAPI {
  constructor(token, repo) {
    this.token = token;
    this.repo = repo;
    this.base = 'https://api.github.com';
  }

  async request(path, method = 'GET', body = null) {
    const url = `${this.base}/repos/${this.repo}${path}`;
    const headers = {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'axn-copilot-worker',
    };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`GitHub ${res.status}: ${err}`);
    }
    return res.json();
  }

  async getFile(path) {
    try {
      const data = await this.request(`/contents/${path}`);
      return { content: atob(data.content), sha: data.sha };
    } catch (e) {
      if (e.message.includes('404')) return null;
      throw e;
    }
  }

  async createOrUpdateFile(path, content, message, sha = null) {
    const body = {
      message,
      content: btoa(content),
      branch: 'main',
    };
    if (sha) body.sha = sha;
    return this.request(`/contents/${path}`, 'PUT', body);
  }

  async createFolder(folderPath, message) {
    // GitHub tidak mendukung folder kosong, buat .gitkeep
    return this.createOrUpdateFile(`${folderPath}/.gitkeep`, '', message || `Create ${folderPath}`);
  }

  async listDirectory(path = '') {
    const data = await this.request(`/contents/${path}`);
    return data.map(item => ({
      name: item.name,
      path: item.path,
      type: item.type,
      sha: item.sha,
      url: item.html_url,
    }));
  }

  async getTree(recursive = true) {
    const data = await this.request('/git/trees/main?recursive=true');
    return data.tree;
  }
                    } 
