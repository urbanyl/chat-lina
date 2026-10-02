/* ─────────────────────────────────────────────
   Lina — iOS Messages style app logic
   ───────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);

const el = {
  listScreen: $('listScreen'),
  chatScreen: $('chatScreen'),
  convList: $('convList'),
  emptyState: $('emptyState'),
  searchInput: $('searchInput'),
  editBtn: $('editBtn'),
  composeBtn: $('composeBtn'),
  backBtn: $('backBtn'),
  infoBtn: $('infoBtn'),
  messages: $('messages'),
  composer: $('composer'),
  plusBtn: $('plusBtn'),
  input: $('input'),
  sendBtn: $('sendBtn'),
  contactName: $('contactName'),
  unreadBadge: $('unreadBadge')
};

const state = {
  conversations: [],
  currentId: null,
  sending: false,
  editing: false,
  filter: '',
  lastDayKey: null,
  lastRole: null
};

/* ── helpers ── */
function renderMarkdown(text) {
  if (window.marked && window.DOMPurify) {
    marked.setOptions({ breaks: true, gfm: true });
    return DOMPurify.sanitize(marked.parse(text || ''));
  }
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}

function formatDay(ts) {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  if (diff < 7) return d.toLocaleDateString('fr-FR', { weekday: 'long' });
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (dayKey(ts) === dayKey(now.getTime())) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff === 1) return 'Hier';
  if (diff < 7) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function preview(text) {
  const t = String(text || '')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/[#*_>`~\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t || 'Pièce jointe';
}

function scrollBottom() {
  el.messages.scrollTop = el.messages.scrollHeight;
}

/* ── messages DOM ── */
function addDayIfNeeded(ts) {
  const k = dayKey(ts);
  if (k === state.lastDayKey) return;
  state.lastDayKey = k;
  const div = document.createElement('div');
  div.className = 'day';
  div.textContent = formatDay(ts);
  el.messages.appendChild(div);
}

function appendMessage(role, content, ts, animate) {
  addDayIfNeeded(ts || Date.now());
  const row = document.createElement('div');
  row.className = 'row ' + (role === 'user' ? 'out' : 'in');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'user') {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }
  if (!animate) bubble.style.animation = 'none';

  row.appendChild(bubble);
  el.messages.appendChild(row);
  scrollBottom();
  state.lastRole = role;
  return bubble;
}

function addTyping() {
  addDayIfNeeded(Date.now());
  const row = document.createElement('div');
  row.className = 'row in';
  const bubble = document.createElement('div');
  bubble.className = 'bubble typing';
  bubble.innerHTML = '<i></i><i></i><i></i>';
  row.appendChild(bubble);
  el.messages.appendChild(row);
  scrollBottom();
  return row;
}

function removeNode(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

function addSystem(text, isError) {
  const div = document.createElement('div');
  div.className = 'system' + (isError ? ' error' : '');
  div.textContent = text;
  el.messages.appendChild(div);
  scrollBottom();
}

/* ── conversation list ── */
async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
    state.conversations = await res.json();
  } catch (e) {
    state.conversations = [];
  }
  renderList();
}

function renderList() {
  const list = el.convList;
  list.innerHTML = '';
  const q = state.filter.toLowerCase();
  const items = state.conversations.filter(
    (c) => !q || (c.title || '').toLowerCase().includes(q)
  );

  el.emptyState.classList.toggle('hidden', items.length > 0);

  items.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'conv';

    const av = document.createElement('img');
    av.className = 'avatar';
    av.src = '/logo.svg';
    av.alt = '';

    const main = document.createElement('div');
    main.className = 'conv-main';

    const top = document.createElement('div');
    top.className = 'conv-top';
    const name = document.createElement('span');
    name.className = 'conv-name';
    name.textContent = c.title || 'Conversation';
    const time = document.createElement('span');
    time.className = 'conv-time';
    time.textContent = formatTime(c.updatedAt || c.createdAt || Date.now());
    top.appendChild(name);
    top.appendChild(time);

    const prev = document.createElement('div');
    prev.className = 'conv-preview';
    prev.textContent = c.preview || '';

    main.appendChild(top);
    main.appendChild(prev);

    row.appendChild(av);
    row.appendChild(main);

    if (state.editing) {
      const del = document.createElement('button');
      del.className = 'conv-del';
      del.textContent = '🗑';
      del.style.cssText = 'border:none;background:none;color:var(--danger);font-size:18px;cursor:pointer;padding:6px;';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConversation(c.id);
      });
      row.appendChild(del);
    } else {
      const chev = document.createElement('span');
      chev.className = 'conv-chevron';
      chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
      row.appendChild(chev);
    }

    row.addEventListener('click', () => openChat(c.id));
    list.appendChild(row);
  });
}

async function deleteConversation(id) {
  if (!confirm('Supprimer cette conversation ?')) return;
  try { await fetch('/api/conversations/' + id, { method: 'DELETE' }); } catch (e) {}
  if (state.currentId === id) state.currentId = null;
  loadConversations();
}

/* ── screens ── */
function showList() {
  el.chatScreen.classList.remove('is-active');
  state.currentId = null;
  loadConversations();
}

function showChat() {
  el.chatScreen.classList.add('is-active');
  setTimeout(() => el.input.focus(), 340);
}

function clearMessages() {
  el.messages.innerHTML = '';
  state.lastDayKey = null;
  state.lastRole = null;
}

function newChat() {
  state.currentId = null;
  clearMessages();
  el.contactName.textContent = 'Lina';
  el.unreadBadge.style.display = 'none';
  addSystem('Début de la conversation avec Lina');
  showChat();
}

async function openChat(id) {
  state.currentId = id;
  clearMessages();
  let conv = null;
  try {
    const res = await fetch('/api/conversations/' + id);
    if (res.ok) conv = await res.json();
  } catch (e) {}
  if (!conv) { addSystem('Conversation introuvable.', true); showChat(); return; }
  el.contactName.textContent = conv.title ? 'Lina' : 'Lina';
  el.unreadBadge.style.display = 'none';
  (conv.messages || []).forEach((m) => {
    appendMessage(m.role === 'user' ? 'user' : 'lina', m.content, m.ts || Date.now(), false);
  });
  scrollBottom();
  showChat();
}

/* ── composer ── */
function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
}

function updateSendState() {
  el.sendBtn.disabled = el.input.value.trim().length === 0 || state.sending;
}

async function sendMessage(text) {
  text = (text || '').trim();
  if (!text || state.sending) return;

  state.sending = true;
  el.input.value = '';
  autoGrow();
  updateSendState();

  appendMessage('user', text, Date.now(), true);
  const typing = addTyping();

  let assistantText = '';
  let bubble = null;
  let errored = false;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: state.currentId, message: text })
    });

    if (!res.ok || !res.body) {
      let msg = 'Erreur serveur (' + res.status + ')';
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
      removeNode(typing);
      addSystem('⚠️ ' + msg, true);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let evt;
        try { evt = JSON.parse(payload); } catch (e) { continue; }

        if (evt.type === 'meta') {
          state.currentId = evt.conversationId;
        } else if (evt.type === 'delta') {
          if (typing.parentNode) removeNode(typing);
          if (!bubble) bubble = appendMessage('lina', '', Date.now(), true);
          assistantText += evt.content;
          bubble.innerHTML = renderMarkdown(assistantText);
          scrollBottom();
        } else if (evt.type === 'error') {
          errored = true;
          removeNode(typing);
          addSystem('⚠️ ' + (evt.message || 'Erreur du modèle'), true);
        } else if (evt.type === 'done') {
          if (evt.conversationId) state.currentId = evt.conversationId;
        }
      }
    }

    if (!assistantText && !errored) {
      removeNode(typing);
      addSystem("Aucune réponse reçue. Réessayez.", true);
    }
  } catch (e) {
    removeNode(typing);
    addSystem('Erreur réseau : ' + e.message, true);
  } finally {
    state.sending = false;
    updateSendState();
    loadConversations();
  }
}

/* ── events ── */
el.composer.addEventListener('submit', (e) => e.preventDefault());

el.input.addEventListener('input', () => { autoGrow(); updateSendState(); });
el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(el.input.value);
  }
});

el.sendBtn.addEventListener('click', () => sendMessage(el.input.value));
el.plusBtn.addEventListener('click', () => el.input.focus());
el.composeBtn.addEventListener('click', newChat);
el.backBtn.addEventListener('click', showList);
el.infoBtn.addEventListener('click', () => addSystem('Lina — assistante IA. Réponses informatives, à vérifier.'));
el.searchInput.addEventListener('input', (e) => { state.filter = e.target.value; renderList(); });
el.editBtn.addEventListener('click', () => {
  state.editing = !state.editing;
  el.editBtn.textContent = state.editing ? 'Terminé' : 'Modifier';
  renderList();
});

/* ── init ── */
loadConversations();
autoGrow();
updateSendState();
