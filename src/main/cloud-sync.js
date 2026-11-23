/* MAP
 * Scop: Contul Netor Cloud (netor.example.test): autentificare/inregistrare, activarea dispozitivului,
 *       sincronizare E2E a starii (favorite, note, agenti, sabloane, browsere cu taburi) si a seifului,
 *       cu imbinare in 3 sensuri pe fiecare intrare; puntea WebSocket pentru control remote; comenzi pe alte dispozitive.
 * Legaturi: vault.js, ai-client.js (secrete), cdp-bridge.js, ipc.js
 * Sectiuni:
 *   §1 HTTP catre cloud si cheia contului (derivata local, nu pleaca de pe dispozitiv)
 *   §2 Cont: login, register, logout, dispozitive
 *   §3 Imbinare in 3 sensuri si sincronizare stare/seif
 *   §4 Puntea WebSocket (control remote al acestui browser)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { seal, open } = require('./vault');
const { getSecret, setSecret } = require('./ai-client');
const { APP_VERSION } = require('./config');

let ctx = null; // { store, vault, dir, emit, uiCall, execute }
let ws = null;
let wsTimer = null;
let pushTimer = null;

// §1 HTTP catre cloud si cheia contului
const gs = () => ctx.store.state.globalSettings;
async function api(method, p, body, token = gs().authToken) {
  const res = await fetch(gs().cloudUrl.replace(/\/+$/, '') + p, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(j.error || `Netor Cloud ${res.status}`);
  return j;
}
const accountKey = () => { const h = getSecret('accountKey'); return h ? Buffer.from(h, 'hex') : null; };
const deriveAccountKey = (user, pass) => crypto.pbkdf2Sync(String(pass), `netor-e2e|${String(user).toLowerCase()}`, 310000, 32, 'sha256');

// §2 Cont
async function login({ url, username, password, register, email }) {
  if (url) gs().cloudUrl = url.replace(/\/+$/, '');
  const r = register
    ? await api('POST', '/api/v1/auth/register', { username, email, display_name: username, password }, '')
    : await api('POST', '/api/v1/auth/login', { username, password }, '');
  const act = await api('POST', '/api/v1/browsers/activate', { name: `Netor · ${os.hostname()}`, os: process.platform, version: APP_VERSION }, r.token);
  setSecret('accountKey', deriveAccountKey(username, password).toString('hex'));
  const patch = { cloudUrl: gs().cloudUrl, authToken: r.token, user: r.user, deviceId: act.browser_id, deviceKey: act.device_key };
  await ctx.uiCall('patchSettings', patch);
  Object.assign(gs(), patch);
  connectBridge();
  const pulled = await syncNow().catch((err) => ({ error: err.message }));
  return { ok: true, user: r.user, deviceId: act.browser_id, sync: pulled };
}

async function logout() {
  await api('POST', '/api/v1/auth/logout').catch(() => null);
  setSecret('accountKey', '');
  const patch = { authToken: '', user: null, deviceId: '', deviceKey: '' };
  Object.assign(gs(), patch);
  await ctx.uiCall('patchSettings', patch);
  if (ws) { try { ws.close(); } catch (_) { /* inchis deja */ } ws = null; }
  return { ok: true };
}

const devices = async () => (await api('GET', '/api/v1/browsers')).browsers || [];
async function remoteCmd(deviceId, cmd, params) {
  const r = await api('POST', `/api/v1/browsers/${encodeURIComponent(deviceId)}/cmd`, { cmd, params, timeout_ms: 30000 });
  if (r.error) throw new Error(String(r.error));
  return r.data;
}

// §3 Imbinare in 3 sensuri si sincronizare
const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 24);
const baseFile = () => path.join(ctx.dir, 'netor-sync-base.json');
const readBase = () => { try { return JSON.parse(fs.readFileSync(baseFile(), 'utf8')); } catch (_) { return { state: {}, vault: {}, stateVersion: 0, vaultVersion: 0 }; } };
const writeBase = (b) => fs.writeFileSync(baseFile(), JSON.stringify(b), 'utf8');

function merge3(baseHashes, local, remote) {
  const L = new Map((local || []).map((x) => [x.id, x]));
  const R = new Map((remote || []).map((x) => [x.id, x]));
  const out = [];
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const l = L.get(id); const r = R.get(id); const b = baseHashes[id];
    const lc = l && hash(l) !== b; const rc = r && hash(r) !== b;
    if (l && r) out.push(rc && !lc ? r : l);
    else if (l) { if (!b || lc) out.push(l); } else if (r) { if (!b || rc) out.push(r); }
  }
  return out;
}
const hashes = (list) => Object.fromEntries((list || []).map((x) => [x.id, hash(x)]));
const STATE_KEYS = ['favorites', 'notes', 'agents', 'templates', 'browsers'];

async function syncState() {
  const key = accountKey();
  if (!key || !gs().authToken) return { skipped: true };
  const base = readBase();
  const remote = await api('GET', '/api/v1/sync/state');
  const local = ctx.store.state;
  let merged = { ...local };
  if (remote.state_json && remote.state_version !== base.stateVersion) {
    const rs = JSON.parse(open(key, JSON.parse(remote.state_json).enc).toString('utf8'));
    for (const k of STATE_KEYS) merged[k] = merge3(base.state[k] || {}, local[k], rs[k]);
    if (!merged.browsers.some((b) => b.id === merged.activeBrowserId)) merged.activeBrowserId = merged.browsers[0] && merged.browsers[0].id;
    await ctx.uiCall('replaceState', { state: merged });
  }
  const payload = Object.fromEntries(STATE_KEYS.map((k) => [k, merged[k]]));
  const payloadHash = hash(payload);
  if (payloadHash === base.statePushed && remote.state_version === base.stateVersion) return { version: base.stateVersion, unchanged: true };
  base.statePushed = payloadHash;
  const put = await api('POST', '/api/v1/sync/state', { state_json: JSON.stringify({ enc: seal(key, Buffer.from(JSON.stringify(payload))) }) });
  base.state = Object.fromEntries(STATE_KEYS.map((k) => [k, hashes(merged[k])]));
  base.stateVersion = put.state_version;
  writeBase(base);
  return { version: put.state_version };
}

async function syncVault() {
  const key = accountKey();
  const v = ctx.vault;
  if (!key || !gs().authToken || !v.data) return { skipped: true };
  const base = readBase();
  const remote = await api('GET', '/api/v1/sync/vault');
  if (remote.vault_cipher && remote.vault_version !== base.vaultVersion) {
    const { data } = v.decryptCloud(key, JSON.parse(remote.vault_cipher));
    const next = { ...v.data };
    for (const c of Object.keys(data)) if (Array.isArray(data[c])) next[c] = merge3((base.vault || {})[c] || {}, v.data[c], data[c]);
    v.save(next);
    ctx.emit('netor:vault-changed', {});
  }
  const vh = hash(v.data);
  if (vh === base.vaultPushed && remote.vault_version === base.vaultVersion) return { version: base.vaultVersion, unchanged: true };
  base.vaultPushed = vh;
  const put = await api('POST', '/api/v1/sync/vault', { vault_cipher: JSON.stringify(v.exportForCloud(key)), vault_salt: 'v2' });
  base.vault = Object.fromEntries(Object.entries(v.data).filter(([, x]) => Array.isArray(x)).map(([c, list]) => [c, hashes(list)]));
  base.vaultVersion = put.vault_version;
  writeBase(base);
  return { version: put.vault_version };
}

async function syncNow() {
  const st = await syncState();
  const vt = await syncVault();
  ctx.emit('netor:sync', { at: Date.now(), state: st, vault: vt });
  return { state: st, vault: vt };
}

function schedulePush() {
  if (!gs().authToken || !gs().autoSync) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncNow().catch((err) => ctx.emit('netor:sync', { error: err.message })), 6000);
}

// §4 Puntea WebSocket
function connectBridge() {
  clearTimeout(wsTimer);
  if (ws) { try { ws.close(); } catch (_) { /* inchis deja */ } ws = null; }
  if (!gs().deviceKey || !gs().cloudUrl) return;
  const url = gs().cloudUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + `/ws/ext?key=${encodeURIComponent(gs().deviceKey)}`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = async () => sock.send(JSON.stringify({ type: 'hello', info: await ctx.execute('info', {}) }));
  sock.onmessage = async (e) => {
    let msg;
    try { msg = JSON.parse(String(e.data)); } catch (_) { return; }
    if (msg.type !== 'cmd' || !msg.id) return;
    if (gs().allowRemote === false) { sock.send(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: 'Controlul remote e dezactivat pe acest dispozitiv.' })); return; }
    try { sock.send(JSON.stringify({ type: 'result', id: msg.id, ok: true, data: await ctx.execute(msg.cmd, msg.params || {}) })); } catch (err) { sock.send(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: err.message })); }
  };
  sock.onclose = () => { if (ws === sock) wsTimer = setTimeout(connectBridge, 6000); };
  sock.onerror = () => {};
}

function init(opts) {
  ctx = opts;
  ctx.store.onChange(schedulePush);
  connectBridge();
  setInterval(() => { if (gs().authToken && gs().autoSync) syncNow().catch((err) => ctx.emit('netor:sync', { error: err.message })); }, 180000);
}

module.exports = { init, login, logout, devices, remoteCmd, syncNow, schedulePush, connectBridge, bridgeOnline: () => !!(ws && ws.readyState === 1) };
