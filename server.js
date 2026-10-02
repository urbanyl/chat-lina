require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.MODEL || 'openai/gpt-oss-120b';
const MODEL_CANDIDATES = [...new Set([
  MODEL,
  'openai/gpt-oss-120b',
  'qwen/qwen3.6-27b',
  'openai/gpt-oss-20b'
])];
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'conversations.json');

const SYSTEM_PROMPT = [
  "Tu es Lina, une assistante IA francophone, rigoureuse et chaleureuse.",
  "Tu es particulierement competente dans les domaines suivants :",
  "- Sociologie : theorie sociale, methodes qualitatives/quantitatives, dynamiques de groupe, inegalites, institutions.",
  "- Criminologie : theories du crime, victimologie, prevention, justice penale, profilage, deviance.",
  "- Islam : theologie, Coran, hadith, fiqh (droit islamique), usul al-fiqh, ecoles juridiques, histoire, spiritualite.",
  "- Developpement et codage : JavaScript/Node.js, Python, architecture logicielle, bases de donnees, bonnes pratiques.",
  "- Cybersecurite : securite offensive et defensive, OWASP, cryptographie, reseaux, analyse de vulnerabilites, reponse a incident.",
  "- Droit : droit civil, penal, constitutionnel, administratif, des contrats, droit islamique compare.",
  "- Psychologie : clinique, cognitive, sociale, du developpement, psychopathologie.",
  "- Psychiatrie et domaine medical : semiologie, psychopharmacologie, nosographie (DSM-5 / CIM-11), medecine generale, sante publique.",
  "",
  "Regles de conduite :",
  "1. Reponds toujours en francais, sauf demande contraire.",
  "2. Sois precise, structuree et pedagogique. Utilise le markdown (titres, listes, tableaux) quand c'est utile.",
  "3. Cite les notions, auteurs, theories, articles de loi ou references pertinentes lorsque c'est approprie.",
  "4. Distingue clairement les faits, les hypotheses et les opinions. Signale les incertitudes.",
  "5. Sur les sujets sensibles (sante, droit, securite), rappelle que tes reponses sont informatives et ne remplacent pas un professionnel qualifie.",
  "6. En cas de danger immediat pour une personne (urgence medicale, danger suicidaire), invite fermement a contacter les services d'urgence.",
  "7. Reste neutre et respectueuse sur les questions religieuses et politiques : expose les differentes positions de maniere equilibree.",
  "8. N'invente jamais de source. Si tu ne sais pas, dis-le clairement.",
  "9. Sois concise par defaut, mais developpe quand le sujet l'exige.",
  "",
  "Tu es Lina. Adopte un ton humain, direct et bienveillant."
].join('\n');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ conversations: {} }, null, 2));
}

function loadStore() {
  try {
    ensureStore();
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.conversations) parsed.conversations = {};
    return parsed;
  } catch (e) {
    return { conversations: {} };
  }
}

function saveStore(store) {
  try {
    ensureStore();
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('Erreur sauvegarde:', e.message);
  }
}

function genId() {
  return crypto.randomBytes(9).toString('hex');
}

function titleFrom(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > 45 ? t.slice(0, 45) + '...' : t || 'Nouvelle conversation';
}

app.get('/api/conversations', (req, res) => {
  const store = loadStore();
  const list = Object.values(store.conversations)
    .map((c) => {
      const last = c.messages.length ? c.messages[c.messages.length - 1] : null;
      const preview = last
        ? String(last.content).replace(/\s+/g, ' ').slice(0, 80)
        : '';
      return {
        id: c.id,
        title: c.title,
        preview,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        count: c.messages.length
      };
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(list);
});

app.get('/api/conversations/:id', (req, res) => {
  const store = loadStore();
  const conv = store.conversations[req.params.id];
  if (!conv) return res.status(404).json({ error: 'Conversation introuvable' });
  res.json(conv);
});

app.delete('/api/conversations/:id', (req, res) => {
  const store = loadStore();
  if (!store.conversations[req.params.id]) return res.status(404).json({ error: 'Conversation introuvable' });
  delete store.conversations[req.params.id];
  saveStore(store);
  res.json({ ok: true });
});

app.post('/api/chat', async (req, res) => {
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY manquante dans les variables d\'environnement.' });
  }

  const { conversationId, message } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message requis.' });
  }

  const store = loadStore();
  let conv = conversationId ? store.conversations[conversationId] : null;
  const isNew = !conv;
  if (!conv) {
    const id = genId();
    conv = { id, title: titleFrom(message), createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    store.conversations[id] = conv;
  }

  conv.messages.push({ role: 'user', content: message, ts: Date.now() });
  conv.updatedAt = Date.now();
  saveStore(store);

  const history = conv.messages.slice(-24).map((m) => ({ role: m.role, content: m.content }));
  const apiMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  send({ type: 'meta', conversationId: conv.id, title: conv.title, isNew });

  let full = '';
  try {
    let upstream = null;
    let lastError = '';

    for (const model of MODEL_CANDIDATES) {
      const attempt = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          stream: true,
          temperature: 0.7,
          max_tokens: 2048
        })
      });

      if (attempt.ok && attempt.body) {
        upstream = attempt;
        console.log(`Groq: reponse via ${model}`);
        break;
      }

      let errText = '';
      try { errText = await attempt.text(); } catch (e) {}
      lastError = `modele "${model}" -> ${attempt.status} ${errText.slice(0, 300)}`;
      console.error('Groq echec:', lastError);
    }

    if (!upstream) {
      send({ type: 'error', message: `Aucun modele Groq disponible. ${lastError}` });
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) {
            full += delta;
            send({ type: 'delta', content: delta });
          }
        } catch (e) {
          // ignore lignes partielles
        }
      }
    }

    if (!full.trim()) {
      send({ type: 'error', message: 'Le modele a renvoye une reponse vide.' });
      res.end();
      return;
    }

    conv.messages.push({ role: 'assistant', content: full, ts: Date.now() });
    conv.updatedAt = Date.now();
    saveStore(store);
    send({ type: 'done', conversationId: conv.id, title: conv.title });
    res.end();
  } catch (e) {
    console.error('Erreur /api/chat:', e);
    send({ type: 'error', message: String(e && e.message ? e.message : e) });
    res.end();
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, model: MODEL, models: MODEL_CANDIDATES, hasKey: Boolean(GROQ_API_KEY) });
});

ensureStore();
app.listen(PORT, () => {
  console.log(`Chat Lina en ligne sur le port ${PORT} (modele: ${MODEL})`);
});
