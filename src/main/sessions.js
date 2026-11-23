/* MAP
 * Scop: Sesiuni Chromium per browser din minibar: partitie persistenta sau efemera (All Private), proxy/SOCKS
 *       structurat cu autentificare, adblock pe retea, user-agent curat (fara Electron), descarcari urmarite,
 *       protocolul intern netor:// (pagina tab nou) si curatarea datelor.
 * Legaturi: config.js, main.js, ipc.js, extensions.js
 * Sectiuni:
 *   §1 Partitii si setari efective (browser -> global)
 *   §2 Configurare sesiune (proxy, UA, adblock, protocol, permisiuni, descarcari)
 *   §3 Descarcari urmarite
 *   §4 Curatare date si test proxy
 */
const { session, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { ADBLOCK_DOMAINS, SEARCH_ENGINES } = require('./config');

const configured = new Map(); // partitie -> browserId
const downloads = new Map();
let emit = () => {};
let getState = () => ({});
let onSessionCreated = () => {};

// §1 Partitii si setari efective
// Tab izolat (proxy propriu) sau browser All Private -> partitie dedicata tabului
function partitionFor(brw, tab) {
  const bid = (brw && brw.id) || 'brw_default';
  if (brw && brw.allPrivate) return `netor_private_${bid}_${tab.id}`;
  if (tab && tab.isolated) return `persist:netor_${bid}_${tab.id}`;
  return `persist:netor_${bid}`;
}

const custom = (p) => p && p.mode && p.mode !== 'inherit';
function effective(brw, tab) {
  const gs = getState().globalSettings || {};
  const proxy = custom(tab && tab.proxy) ? tab.proxy : custom(brw && brw.proxy) ? brw.proxy : gs.proxy || { mode: 'system' };
  const adblock = !brw || brw.adblock === 'inherit' || brw.adblock === undefined ? gs.adblock !== false : brw.adblock === 'on';
  return { proxy, adblock, downloadDir: (brw && brw.downloadDir) || gs.downloadDir, askDownload: !!gs.askDownload };
}

function proxyConfig(p) {
  if (!p || p.mode === 'system' || p.mode === 'inherit') return { mode: 'system' };
  if (p.mode === 'direct') return { mode: 'direct' };
  if (!p.host || !p.port) return { mode: 'system' };
  const scheme = p.scheme === 'https' ? 'https' : p.scheme || 'http';
  return { proxyRules: `${scheme}://${p.host}:${p.port}`, proxyBypassRules: p.bypass || '<local>' };
}

function chromeUA() {
  // UA fara "Electron/x" si numele aplicatiei: unele site-uri (ex. Google login) blocheaza browserele incorporate
  return session.defaultSession.getUserAgent().replace(/\s?Electron\/\S+/i, '').replace(/\s?netor\/\S+/i, '');
}

// §2 Configurare sesiune
async function configureSession(partition, brw, tab) {
  const ses = session.fromPartition(partition);
  const eff = effective(brw, tab);
  try {
    await ses.setProxy(proxyConfig(eff.proxy));
  } catch (err) {
    console.error('[netor] proxy invalid pentru', partition, err.message);
  }
  if (configured.has(partition)) return ses;
  configured.set(partition, { browserId: brw ? brw.id : '', tabId: tab && (tab.isolated || (brw && brw.allPrivate)) ? tab.id : '' });
  ses.setUserAgent(chromeUA());

  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
    const b = findBrowser(configured.get(partition).browserId);
    if (!effective(b).adblock || details.resourceType === 'mainFrame') return cb({});
    const u = details.url.toLowerCase();
    cb({ cancel: ADBLOCK_DOMAINS.some((d) => u.includes(d)) });
  });

  if (!ses.protocol.isProtocolHandled('netor')) {
    ses.protocol.handle('netor', (req) => {
      const u = new URL(req.url);
      const page = u.hostname || 'newtab';
      // netor://go?q=... = cautarea din pagina "Tab nou" -> redirect catre adresa sau motorul de cautare ales
      if (page === 'go') return new Response(null, { status: 302, headers: { Location: resolveInput(u.searchParams.get('q') || '') } });
      if (page === 'data' && u.pathname === '/theme') return new Response(JSON.stringify(getState().ui || {}), { headers: { 'Content-Type': 'application/json' } });
      if (page === 'data' && u.pathname === '/favorites') {
        const favs = (getState().favorites || []).filter((f) => f.type === 'link').map((f) => ({ title: f.title, url: f.url, favicon: f.favicon || '' }));
        return new Response(JSON.stringify(favs), { headers: { 'Content-Type': 'application/json' } });
      }
      const file = path.join(__dirname, '..', 'renderer', 'pages', `${page.replace(/[^a-z]/g, '')}.html`);
      return net.fetch(pathToFileURL(fs.existsSync(file) ? file : path.join(__dirname, '..', 'renderer', 'pages', 'newtab.html')).toString());
    });
  }

  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    // Permisiuni sensibile: le aprobam doar pe cele uzuale; restul raman refuzate
    cb(['clipboard-sanitized-write', 'fullscreen', 'notifications', 'media', 'geolocation', 'pointerLock'].includes(permission));
  });

  ses.on('will-download', (_e, item) => trackDownload(item, findBrowser(configured.get(partition).browserId)));
  onSessionCreated(ses);
  return ses;
}

function resolveInput(text) {
  const s = String(text).trim();
  if (!s) return 'netor://newtab';
  if (/^(https?|file):/i.test(s)) return s;
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s)) return `https://${s}`;
  const eng = SEARCH_ENGINES[(getState().globalSettings || {}).searchEngine] || SEARCH_ENGINES.google;
  return eng.url.replace('%s', encodeURIComponent(s));
}

function findBrowser(id) {
  return (getState().browsers || []).find((b) => b.id === id) || null;
}

// §3 Descarcari urmarite
function trackDownload(item, brw) {
  const eff = effective(brw);
  const id = `dl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  if (!eff.askDownload && eff.downloadDir) {
    fs.mkdirSync(eff.downloadDir, { recursive: true });
    item.setSavePath(uniquePath(path.join(eff.downloadDir, item.getFilename())));
  }
  const rec = { id, item, filename: item.getFilename(), url: item.getURL(), total: item.getTotalBytes(), received: 0, state: 'progressing', path: '', startedAt: Date.now() };
  downloads.set(id, rec);
  const push = () => emit('netor:download', publicDl(rec));
  item.on('updated', (_e, state) => { rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes(); rec.state = state === 'interrupted' ? 'interrupted' : 'progressing'; rec.path = item.getSavePath(); push(); });
  item.once('done', (_e, state) => { rec.state = state; rec.path = item.getSavePath(); rec.received = item.getReceivedBytes(); push(); });
  push();
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 1; i < 1000; i++) {
    const c = path.join(dir, `${name} (${i})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
  return p;
}

const publicDl = (r) => ({ id: r.id, filename: r.filename, url: r.url, total: r.total, received: r.received, state: r.state, path: r.path, startedAt: r.startedAt });

function downloadAction(id, action) {
  const r = downloads.get(id);
  if (!r) return false;
  if (action === 'open' && r.path) shell.openPath(r.path);
  if (action === 'show' && r.path) shell.showItemInFolder(r.path);
  if (action === 'cancel' && r.state === 'progressing') r.item.cancel();
  if (action === 'remove') downloads.delete(id);
  return true;
}

// §4 Curatare date si test proxy
async function clearPartition(partition) {
  const ses = session.fromPartition(partition);
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
}

async function testProxy(p) {
  const ses = session.fromPartition(`netor_proxytest_${Date.now()}`);
  await ses.setProxy(proxyConfig(p));
  const started = Date.now();
  const res = await ses.fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(12000) });
  const body = await res.json();
  return { ok: true, ip: body.ip, ms: Date.now() - started };
}

function init(opts) {
  emit = opts.emit;
  getState = opts.getState;
  onSessionCreated = opts.onSessionCreated || onSessionCreated;
}

const proxyCredentialsFor = (host, port) => {
  const st = getState();
  const all = [st.globalSettings && st.globalSettings.proxy, ...(st.browsers || []).flatMap((b) => [b.proxy, ...(b.tabs || []).map((t) => t.proxy)])];
  return all.find((p) => p && p.mode === 'custom' && p.host === host && String(p.port) === String(port) && p.username) || null;
};

module.exports = {
  init, partitionFor, configureSession, effective, clearPartition, testProxy, downloadAction, proxyCredentialsFor, chromeUA,
  listDownloads: () => Array.from(downloads.values()).map(publicDl),
  configuredPartitions: () => Array.from(configured.keys()),
  registerSchemes: () => protocol.registerSchemesAsPrivileged([{ scheme: 'netor', privileges: { standard: true, secure: true, supportFetchAPI: true } }]),
};
