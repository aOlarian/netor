/* MAP
 * Scop: Client AI compatibil OpenAI pentru agentii Netor. Doua moduri:
 *       - cloud: prin contul Netor (releu pe netor.example.test catre cli2api), merge de oriunde
 *       - direct: orice endpoint compatibil OpenAI (cli2api, DeepSeek, OpenAI, local) cu cheia proprie
 *       Plus secretele locale (cheie API, cheia contului pentru seif) protejate DPAPI.
 * Legaturi: agent-runner.js, automation.js, ipc.js, config.js (LIMITS)
 * Sectiuni:
 *   §1 Secrete locale (safeStorage)
 *   §2 Rezolvare endpoint si autentificare
 *   §3 Lista modele, completare chat, test conexiune
 */
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { LIMITS } = require('./config');

let ctx = null; // { store, dir }

// §1 Secrete locale
function secretsFile() { return path.join(ctx.dir, 'netor-secrets.bin'); }
function readSecrets() {
  try {
    if (!fs.existsSync(secretsFile())) return {};
    const buf = fs.readFileSync(secretsFile());
    return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8'));
  } catch (err) {
    console.error('[netor] secretele locale nu pot fi citite:', err.message);
    return {};
  }
}
function getSecret(name) { return readSecrets()[name] || ''; }
function setSecret(name, value) {
  const all = readSecrets();
  if (value) all[name] = value; else delete all[name];
  const json = JSON.stringify(all);
  fs.writeFileSync(secretsFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json));
}

// §2 Rezolvare endpoint si autentificare
function resolve() {
  const gs = ctx.store.state.globalSettings;
  const ai = gs.ai || {};
  if (ai.mode === 'direct') {
    if (!ai.endpoint) throw new Error('Setează endpoint-ul AI în Setări globale → Workspace & AI.');
    return { base: ai.endpoint.replace(/\/+$/, '').replace(/\/chat\/completions$/, ''), key: getSecret('aiApiKey') };
  }
  if (!gs.authToken) throw new Error('Pentru AI prin Netor Cloud trebuie să fii autentificat (Setări globale → Cont).');
  return { base: `${gs.cloudUrl.replace(/\/+$/, '')}/api/v1/ai/v1`, key: gs.authToken };
}

async function call(pathName, body, signal) {
  const { base, key } = resolve();
  const timeout = AbortSignal.timeout(LIMITS.agentRequestTimeoutMs);
  const res = await fetch(base + pathName, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  if (!res.ok) {
    const msg = (json && (json.error && (json.error.message || json.error))) || text.slice(0, 300);
    throw new Error(`AI ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  if (!json) throw new Error('Răspuns AI invalid (nu e JSON).');
  return json;
}

// §3 Lista modele, completare chat, test conexiune
async function listModels() {
  const j = await call('/models');
  return (j.data || []).map((m) => m.id).sort();
}

async function chat({ model, messages, signal, temperature }) {
  const j = await call('/chat/completions', { model, messages, temperature: temperature ?? 0.2 }, signal);
  const choice = j.choices && j.choices[0];
  const content = choice && choice.message ? choice.message.content : '';
  return { text: Array.isArray(content) ? content.map((p) => p.text || '').join('') : String(content || ''), usage: j.usage || null };
}

async function test() {
  const started = Date.now();
  const models = await listModels();
  return { ok: true, models, ms: Date.now() - started };
}

function init(opts) { ctx = opts; }

module.exports = { init, listModels, chat, test, getSecret, setSecret };
