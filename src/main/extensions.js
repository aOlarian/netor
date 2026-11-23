/* MAP
 * Scop: Extensii Chrome in Netor: instalare din Chrome Web Store (descarcare CRX + dezarhivare proprie),
 *       incarcare din folder despachetat, activare/dezactivare/stergere, incarcare in toate sesiunile
 *       browserelor si fereastra popup a extensiei (butonul din bara).
 * Legaturi: sessions.js (onSessionCreated), ipc.js, zip.js
 * Sectiuni:
 *   §1 Registrul extensiilor (extensions.json)
 *   §2 Instalare din Chrome Web Store si din folder
 *   §3 Incarcare in sesiuni si popup
 */
const fs = require('fs');
const path = require('path');
const { session, BrowserWindow, net } = require('electron');
const { extractZip } = require('./zip');

let ctx = null; // { dir, partitions(), mainWindow() }
const sessions = new Set();

// §1 Registrul extensiilor
const regFile = () => path.join(ctx.dir, 'extensions.json');
const readReg = () => { try { return JSON.parse(fs.readFileSync(regFile(), 'utf8')); } catch (_) { return []; } };
const writeReg = (r) => fs.writeFileSync(regFile(), JSON.stringify(r, null, 1), 'utf8');
const extApi = (ses) => ses.extensions || ses;

function readManifest(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const action = m.action || m.browser_action || {};
  const icons = action.default_icon || m.icons || {};
  const icon = typeof icons === 'string' ? icons : icons['32'] || icons['48'] || icons['16'] || Object.values(icons)[0] || '';
  return { name: m.name, version: m.version, popup: action.default_popup || '', icon, mv: m.manifest_version };
}

// §2 Instalare din Chrome Web Store si din folder
async function installFromStore(input) {
  const id = (String(input).match(/[a-p]{32}/) || [])[0];
  if (!id) throw new Error('Nu am găsit ID-ul extensiei (32 de litere a-p) în link.');
  const chromeVer = process.versions.chrome;
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${chromeVer}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`Chrome Web Store a răspuns ${res.status}.`);
  const crx = Buffer.from(await res.arrayBuffer());
  if (crx.subarray(0, 4).toString() !== 'Cr24') throw new Error('Fișierul descărcat nu este o extensie CRX.');
  const ver = crx.readUInt32LE(4);
  const zipStart = ver === 3 ? 12 + crx.readUInt32LE(8) : 16 + crx.readUInt32LE(8) + crx.readUInt32LE(12);
  const dest = path.join(ctx.dir, 'extensions', id);
  fs.rmSync(dest, { recursive: true, force: true });
  extractZip(crx.subarray(zipStart), dest);
  // Cheia _metadata (semnatura Google) nu e necesara si Electron o refuza la incarcare
  fs.rmSync(path.join(dest, '_metadata'), { recursive: true, force: true });
  return register(dest, 'store', id);
}

async function installUnpacked(dir) {
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error('Folderul nu conține manifest.json.');
  return register(dir, 'folder');
}

async function register(dir, source, storeId) {
  const meta = readManifest(dir);
  const reg = readReg().filter((e) => e.path !== dir && (!storeId || e.storeId !== storeId));
  let loadedId = '';
  for (const ses of sessions) {
    const ext = await extApi(ses).loadExtension(dir, { allowFileAccess: true }).catch((err) => { throw new Error(`Electron nu a putut încărca extensia: ${err.message}`); });
    loadedId = ext.id;
  }
  const entry = { id: loadedId || storeId || path.basename(dir), storeId: storeId || '', path: dir, source, enabled: true, ...meta };
  reg.push(entry);
  writeReg(reg);
  return entry;
}

async function remove(id) {
  const reg = readReg();
  const e = reg.find((x) => x.id === id);
  if (!e) return false;
  for (const ses of sessions) { try { extApi(ses).removeExtension(id); } catch (_) { /* deja descarcata */ } }
  if (e.source === 'store') fs.rmSync(e.path, { recursive: true, force: true });
  writeReg(reg.filter((x) => x.id !== id));
  return true;
}

async function setEnabled(id, on) {
  const reg = readReg();
  const e = reg.find((x) => x.id === id);
  if (!e) return false;
  e.enabled = !!on;
  writeReg(reg);
  for (const ses of sessions) {
    if (on) await extApi(ses).loadExtension(e.path, { allowFileAccess: true }).catch((err) => console.error('[netor] extensie:', err.message));
    else { try { extApi(ses).removeExtension(id); } catch (_) { /* deja descarcata */ } }
  }
  return true;
}

// §3 Incarcare in sesiuni si popup
async function attach(ses) {
  if (sessions.has(ses)) return;
  sessions.add(ses);
  for (const e of readReg().filter((x) => x.enabled)) {
    await extApi(ses).loadExtension(e.path, { allowFileAccess: true }).catch((err) => console.error(`[netor] extensia ${e.name} nu s-a încărcat:`, err.message));
  }
}

function openPopup(id, partition, x, y) {
  const e = readReg().find((r) => r.id === id);
  if (!e || !e.popup) throw new Error('Extensia nu are fereastră popup.');
  const parent = ctx.mainWindow();
  const b = parent.getBounds();
  const win = new BrowserWindow({ parent, x: Math.round(b.x + x - 340), y: Math.round(b.y + y + 8), width: 380, height: 520, frame: false, resizable: true, show: false,
    webPreferences: { session: session.fromPartition(partition), sandbox: true } });
  win.loadURL(`chrome-extension://${id}/${e.popup}`);
  win.once('ready-to-show', () => win.show());
  win.on('blur', () => { if (!win.isDestroyed()) win.close(); });
  return true;
}

function list() {
  return readReg().map((e) => {
    let iconData = '';
    try { if (e.icon) iconData = `data:image/png;base64,${fs.readFileSync(path.join(e.path, e.icon)).toString('base64')}`; } catch (_) { iconData = ''; }
    return { ...e, iconData };
  });
}

function init(opts) { ctx = opts; }

module.exports = { init, attach, installFromStore, installUnpacked, remove, setEnabled, openPopup, list };
