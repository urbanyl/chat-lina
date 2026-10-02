const els = {
  conversations: document.getElementById('conversations'),
  messages: document.getElementById('messages'),
  welcome: document.getElementById('welcome'),
  composer: document.getElementById('composer'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  newChat: document.getElementById('new-chat'),
  chatTitle: document.getElementById('chat-title'),
  sidebar: document.getElementById('sidebar'),
  toggle: document.getElementById('toggle-sidebar')
};

let currentId = null;
let sending = false;

function renderMarkdown(text) {
  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true });
    const html = marked.parse(text || '');
    return window.DOMPurify ? DOMPurify.sanitize(html) : html;
  }
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function hideWelcome() {
  if (els.welcome) els.welcome.style.display = 'none';
}

function showWelcome() {
  if (els.welcome) els.welcome.style.display = '';
}

function clearMessages() {
  els.messages.innerHTML = '';
  els.messages.appendChild(els.welcome);
  showWelcome();
}

function addMessage(role, content) {
  hideWelcome();
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'V' : 'L';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (role === 'user') {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }

  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  els.messages.appendChild(wrap);
  scrollDown();
  return bubble;
}

function scrollDown() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
    const list = await res.json();
    els.conversations.innerHTML = '';
    list.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'conv' + (c.id === currentId ? ' active' : '');
      item.dataset.id = c.id;

      const title = document.createElement('span');
      title.className = 'conv-title';
      title.textContent = c.title || 'Conversation';

      const del = document.createElement('button');
      del.className = 'conv-del';
      del.textContent = '🗑';
      del.title = 'Supprimer';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteConversation(c.id);
      });

      item.appendChild(title);
      item.appendChild(del);
      item.addEventListener('click', () => openConversation(c.id));
      els.conversations.appendChild(item);
    });
  } catch (e) {
    console.error('loadConversations', e);
  }
}

async function openConversation(id) {
  if (sending) return;
  currentId = id;
  const res = await fetch('/api/conversations/' + id);
  if (!res.ok) return;
  const conv = await res.json();
  els.messages.innerHTML = '';
  els.welcome = null;
  conv.messages.forEach((m) => addMessage(m.role === 'user' ? 'user' : 'lina', m.content));
  els.chatTitle.textContent = conv.title || 'Conversation';
  els.sidebar.classList.remove('open');
  loadConversations();
  scrollDown();
}

async function deleteConversation(id) {
  if (!confirm('Supprimer cette conversation ?')) return;
  await fetch('/api/conversations/' + id, { method: 'DELETE' });
  if (id === currentId) newChat();
  loadConversations();
}

function newChat() {
  currentId = null;
  els.messages.innerHTML = '';
  if (els.welcome) {
    els.messages.appendChild(els.welcome);
    showWelcome();
  }
  els.chatTitle.textContent = 'Nouvelle conversation';
  els.sidebar.classList.remove('open');
  loadConversations();
}

async function sendMessage(text) {
  if (sending || !text.trim()) return;
  sending = true;
  els.send.disabled = true;
  els.input.value = '';
  els.input.style.height = 'auto';

  addMessage('user', text);
  const bubble = addMessage('lina', '');
  bubble.classList.add('cursor');

  let assistantText = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: currentId, message: text })
    });

    if (!res.ok || !res.body) {
      let msg = 'Erreur serveur (' + res.status + ')';
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (e) {}
      bubble.classList.remove('cursor');
      bubble.classList.add('error-bubble');
      bubble.textContent = msg;
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
          currentId = evt.conversationId;
          els.chatTitle.textContent = evt.title || 'Conversation';
        } else if (evt.type === 'delta') {
          assistantText += evt.content;
          bubble.innerHTML = renderMarkdown(assistantText);
          scrollDown();
        } else if (evt.type === 'error') {
          bubble.classList.remove('cursor');
          bubble.classList.add('error-bubble');
          bubble.textContent = evt.message || 'Erreur';
        } else if (evt.type === 'done') {
          currentId = evt.conversationId || currentId;
          if (evt.title) els.chatTitle.textContent = evt.title;
        }
      }
    }

    bubble.classList.remove('cursor');
    if (!assistantText) {
      bubble.innerHTML = renderMarkdown('_(aucune réponse)_');
    }
  } catch (e) {
    bubble.classList.remove('cursor');
    bubble.classList.add('error-bubble');
    bubble.textContent = 'Erreur réseau : ' + e.message;
  } finally {
    sending = false;
    els.send.disabled = false;
    loadConversations();
    els.input.focus();
  }
}

els.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage(els.input.value);
});

els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(els.input.value);
  }
});

els.input.addEventListener('input', () => {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + 'px';
});

els.newChat.addEventListener('click', newChat);

els.toggle.addEventListener('click', () => {
  els.sidebar.classList.toggle('open');
});

document.querySelectorAll('.suggestion').forEach((btn) => {
  btn.addEventListener('click', () => {
    els.input.value = btn.dataset.q || '';
    sendMessage(els.input.value);
  });
});

loadConversations();
els.input.focus();
