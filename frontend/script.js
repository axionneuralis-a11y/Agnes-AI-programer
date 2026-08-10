const API_BASE = 'https://axn-copilot.nrls.workers.dev';

let currentProject = '';
let messages = [];
let isProcessing = false;

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const projectSelect = document.getElementById('project-select');
const projectsContainer = document.getElementById('projects-container');
const memoryContainer = document.getElementById('memory-container');
const modal = document.getElementById('modal');
const modalInput = document.getElementById('modal-input');
const modalConfirm = document.getElementById('modal-confirm');
const modalClose = document.querySelector('.modal-close');

document.addEventListener('DOMContentLoaded', () => {
  loadProjects();
  loadMemory();
  setupEvents();
  autoResize();
});

function setupEvents() {
  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const target = document.getElementById(tab.dataset.tab + '-list');
      if (target) target.classList.add('active');
      if (tab.dataset.tab === 'projects') loadProjects();
      if (tab.dataset.tab === 'memory') loadMemory();
    });
  });

  document.getElementById('new-project-btn').addEventListener('click', () => openModal('project'));
  document.getElementById('new-memory-btn').addEventListener('click', () => openModal('memory'));

  modalConfirm.addEventListener('click', () => {
    const val = modalInput.value.trim();
    if (!val) return;
    const type = modal.dataset.type;
    if (type === 'project') createProject(val);
    else if (type === 'memory') createMemory(val);
    closeModal();
  });

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  document.getElementById('clear-chat').addEventListener('click', () => {
    messages = [];
    messagesEl.innerHTML = `<div class="message system"><div class="message-content">🧹 Chat dibersihkan.</div></div>`;
  });

  projectSelect.addEventListener('change', () => { currentProject = projectSelect.value; });
}

function autoResize() {
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });
}

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || isProcessing) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  isProcessing = true;
  sendBtn.disabled = true;

  addMessage('user', text);
  const loadId = addLoading();

  try {
    const resp = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [...messages], project: currentProject || null }),
    });
    const data = await resp.json();
    removeLoading(loadId);

    if (data.error) { addMessage('assistant', `❌ ${data.error}`); return; }

    addMessage('assistant', data.response);
    if (data.tool_results?.length) {
      for (const r of data.tool_results) {
        const icon = r.success ? '✅' : '❌';
        addMessage('tool-result', `${icon} ${r.success ? r.message : r.error}`);
      }
      loadProjects();
      loadMemory();
      updateProjectSelect();
    }

    messages.push({ role: 'user', content: text });
    messages.push({ role: 'assistant', content: data.response });
  } catch (err) {
    removeLoading(loadId);
    addMessage('assistant', `❌ ${err.message}`);
  }

  isProcessing = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

function addMessage(type, content) {
  const div = document.createElement('div');
  div.className = `message ${type}`;
  const inner = document.createElement('div');
  inner.className = 'message-content';
  inner.innerHTML = formatContent(content);
  div.appendChild(inner);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatContent(text) {
  let html = text;
  html = html.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (_, lang, code) =>
    `<pre><code>${escapeHtml(code)}</code></pre>`
  );
  html = html.replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`);
  html = html.replace(/\n/g, '<br />');
  return html;
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

let loadCounter = 0;
function addLoading() {
  const id = 'load-' + (++loadCounter);
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = id;
  div.innerHTML = `<div class="message-content">⏳ <span class="dots">...</span></div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return id;
}
function removeLoading(id) { const el = document.getElementById(id); if (el) el.remove(); }

// ----- Projects -----
async function loadProjects() {
  try {
    const res = await fetch(`${API_BASE}/api/projects`);
    const data = await res.json();
    if (Array.isArray(data)) {
      projectsContainer.innerHTML = data.map(item =>
        `<div class="project-item"><span class="project-name">📁 ${item.name}</span><span class="project-badge">${item.type}</span></div>`
      ).join('') || `<p style="color:#666;font-size:13px;padding:12px;">Belum ada project.</p>`;
      updateProjectSelect(data);
    }
  } catch { projectsContainer.innerHTML = `<p style="color:#f87171;">Error loading projects</p>`; }
}

function updateProjectSelect(data) {
  const current = projectSelect.value;
  projectSelect.innerHTML = '<option value="">-- none --</option>';
  (data || []).forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.name;
    opt.textContent = item.name;
    projectSelect.appendChild(opt);
  });
  if (current) projectSelect.value = current;
}

async function createProject(name) {
  try {
    const res = await fetch(`${API_BASE}/api/projects/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.success) { loadProjects(); updateProjectSelect(); addMessage('system', `✅ Project "${name}" dibuat.`); }
    else addMessage('system', `❌ ${data.error}`);
  } catch (err) { addMessage('system', `❌ ${err.message}`); }
}

// ----- Memory -----
async function loadMemory() {
  try {
    const res = await fetch(`${API_BASE}/api/memory`);
    const data = await res.json();
    if (Array.isArray(data)) {
      memoryContainer.innerHTML = data.map(item =>
        `<div class="memory-item"><span class="memory-name">🧠 ${item.name.replace('.md','')}</span><span class="memory-badge">${item.type}</span></div>`
      ).join('') || `<p style="color:#666;font-size:13px;padding:12px;">Belum ada memory.</p>`;
    }
  } catch { memoryContainer.innerHTML = `<p style="color:#f87171;">Error loading memory</p>`; }
}

async function createMemory(key) {
  try {
    const res = await fetch(`${API_BASE}/api/memory/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, content: `# ${key}\nCreated ${new Date().toLocaleString()}` }),
    });
    const data = await res.json();
    if (data.success) { loadMemory(); addMessage('system', `✅ Memory "${key}" dibuat.`); }
    else addMessage('system', `❌ ${data.error}`);
  } catch (err) { addMessage('system', `❌ ${err.message}`); }
}

// ----- Modal -----
function openModal(type) {
  modal.dataset.type = type;
  modal.classList.remove('hidden');
  modalInput.value = '';
  modalInput.placeholder = type === 'project' ? 'Nama project...' : 'Nama memory...';
  modalInput.focus();
}
function closeModal() { modal.classList.add('hidden'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

console.log('🚀 AXN Copilot loaded'); 
