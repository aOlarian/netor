/* MAP
 * Scop: Uneltele agentului Netor: control browser (prin cdp-bridge), note, completare din seif fara a expune
 *       secretele modelului, workspace local sau al altui dispozitiv al contului (prin netor.example.test).
 * Legaturi: agent-runner.js, cdp-bridge.js, vault-fill.js, cloud-sync.js
 * Sectiuni:
 *   §1 Descrierea uneltelor pentru prompt
 *   §2 Workspace: listare, citire, cautare, scriere (cu limite)
 *   §3 Executie unealta
 */
const fs = require('fs');
const path = require('path');
const bridge = require('./cdp-bridge');

let ctx = null; // { store, vaultFill, cloud }

// §1 Descrierea uneltelor pentru prompt
const TOOL_DOCS = `
- tabs_list {} : toate browserele, grupurile si taburile (tabId, url, titlu)
- open_tab {url, inGroup?:true} : deschide un tab nou in fundal (in grupul agentului daca inGroup); devine tinta implicita
- keep_awake {tabId? | group?:true | browser?:true} : tine treze (randate, fara incetinire) si alte taburi pana termini; tabul pe care lucrezi e treaz automat
- navigate {tabId?, url}
- snapshot {tabId?} : textul paginii + elementele interactive cu referinte (e1, e2...)
- click {tabId?, ref | selector | text}
- type {tabId?, ref | selector, text, submit?:true}
- select {tabId?, ref | selector, value}
- scroll {tabId?, dy}
- wait {tabId?, ms | selector | text}
- extract {tabId?, selector, attr?:"text"|"href"|..., multiple?:true}
- upload {tabId?, ref | selector, files:["C:\\\\cale\\\\fisier.pdf"]} : upload direct prin cale, fara fereastra Windows
- fill_form {tabId?, kind:"identity"|"company"|"address"|"card"|"login"|"datagroup", name} : completeaza formularul din seif; tu nu vezi datele secrete
- vault_list {} : numele intrarilor din seif (fara parole, numere de card sau CVV)
- note_read {title} ; note_write {title, content, append?:true}
- workspace_list {path?} ; workspace_read {path} ; workspace_search {query, path?} ; workspace_write {path, content}
- loop_stop {} : opreste bucla automata cand nu mai ai nimic de facut`;

// §2 Workspace
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache', '__pycache__', 'vendor']);

function wsRoot() {
  const ws = ctx.store.state.globalSettings.workspace || {};
  if (ws.mode !== 'local' || !ws.path) throw new Error('Workspace-ul local nu este selectat.');
  return path.resolve(ws.path);
}

function safeJoin(root, rel) {
  const p = path.resolve(root, String(rel || '.'));
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('Calea iese din workspace.');
  return p;
}

const workspaceOps = {
  list({ path: rel }) {
    const dir = safeJoin(wsRoot(), rel);
    return fs.readdirSync(dir, { withFileTypes: true }).slice(0, 300).map((d) => (d.isDirectory() ? d.name + '/' : d.name));
  },
  read({ path: rel }) {
    const file = safeJoin(wsRoot(), rel);
    const st = fs.statSync(file);
    if (st.size > 400000) throw new Error('Fișier prea mare (>400 KB).');
    return fs.readFileSync(file, 'utf8').slice(0, 60000);
  },
  search({ query, path: rel }) {
    const root = safeJoin(wsRoot(), rel);
    const q = String(query || '').toLowerCase();
    if (q.length < 2) throw new Error('Interogare prea scurtă.');
    const hits = [];
    let scanned = 0;
    const walk = (dir) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (hits.length >= 60 || scanned > 6000) return;
        const p = path.join(dir, d.name);
        if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name) && !d.name.startsWith('.')) walk(p); continue; }
        if (!/\.(md|txt|json|js|ts|go|py|php|html|css|csv|yml|yaml)$/i.test(d.name)) continue;
        scanned++;
        if (d.name.toLowerCase().includes(q)) hits.push({ file: path.relative(wsRoot(), p), line: 0, text: '(nume fișier)' });
        let content = '';
        try { if (fs.statSync(p).size < 500000) content = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
        content.split(/\r?\n/).forEach((ln, i) => { if (hits.length < 60 && ln.toLowerCase().includes(q)) hits.push({ file: path.relative(wsRoot(), p), line: i + 1, text: ln.trim().slice(0, 160) }); });
      }
    };
    walk(root);
    return hits;
  },
  write({ path: rel, content }) {
    if (!ctx.store.state.globalSettings.workspace.allowWrite) throw new Error('Scrierea în workspace este dezactivată din setări.');
    const file = safeJoin(wsRoot(), rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(content ?? ''), 'utf8');
    return { written: path.relative(wsRoot(), file) };
  },
};

async function workspaceCall(op, args) {
  const ws = ctx.store.state.globalSettings.workspace || {};
  if (ws.mode === 'remote') {
    if (!ws.remoteDeviceId) throw new Error('Nu e ales dispozitivul cu workspace-ul.');
    return ctx.cloud.remoteCmd(ws.remoteDeviceId, `workspace.${op}`, args);
  }
  return workspaceOps[op](args || {});
}

// §3 Executie unealta
function awakeTargets(a, env) {
  const b = ctx.store.state.browsers.find((x) => x.id === env.browserId);
  if (!b) return [];
  const web = b.tabs.filter((t) => t.type === 'web');
  if (a.browser) return web.map((t) => t.id);
  if (a.group) return web.filter((t) => env.groupId && t.groupId === env.groupId).map((t) => t.id);
  return [a.tabId || env.defaultTabId];
}

async function runTool(name, args, env) {
  const a = { ...(args || {}) };
  // Fiecare unealta pe un tab il trezeste intai (il creeaza daca browserul lui nu a fost deschis)
  const withTab = async () => {
    const tabId = a.tabId || env.defaultTabId;
    if (env.wake && tabId) await env.wake([tabId]);
    return { ...a, tabId, browserId: env.browserId };
  };
  switch (name) {
    case 'tabs_list': return bridge.execute('tabs.list', {});
    case 'open_tab': {
      // Agentul nu te muta niciodata pe tabul lui: tabul nou se deschide in fundal
      const r = await bridge.execute('tab.open', { url: a.url, browserId: env.browserId, groupId: a.inGroup ? env.groupId : '', background: true });
      if (r && r.tabId) { env.defaultTabId = r.tabId; if (env.wake) await env.wake([r.tabId]); }
      return r;
    }
    case 'keep_awake': return env.wake ? env.wake(awakeTargets(a, env)) : { ok: false };
    case 'navigate': return bridge.execute('page.navigate', await withTab());
    case 'snapshot': return bridge.execute('page.snapshot', await withTab());
    case 'click': return bridge.execute('dom.click', await withTab());
    case 'type': return bridge.execute('dom.type', await withTab());
    case 'select': return bridge.execute('dom.select', await withTab());
    case 'scroll': return bridge.execute('page.scroll', await withTab());
    case 'wait': return bridge.execute('page.wait', await withTab());
    case 'extract': return bridge.execute('dom.extract', await withTab());
    case 'upload': return bridge.execute('file.upload', await withTab());
    case 'fill_form': return ctx.vaultFill.fillByName((await withTab()).tabId, a.kind, a.name);
    case 'vault_list': return ctx.vaultFill.listNames();
    case 'note_read': {
      const n = ctx.store.state.notes.find((x) => x.title.toLowerCase() === String(a.title || '').toLowerCase() || x.id === a.id);
      if (!n) throw new Error('Nota nu există.');
      return { title: n.title, content: n.content || '' };
    }
    case 'note_write': return env.uiCall('noteWrite', { title: a.title, content: a.content, append: !!a.append });
    case 'workspace_list': return workspaceCall('list', a);
    case 'workspace_read': return workspaceCall('read', a);
    case 'workspace_search': return workspaceCall('search', a);
    case 'workspace_write': return workspaceCall('write', a);
    case 'loop_stop': env.stopLoop = true; return { ok: true, loop: 0 };
    default: throw new Error(`Unealtă necunoscută: ${name}`);
  }
}

function init(opts) {
  ctx = opts;
  // Alte dispozitive ale contului pot citi workspace-ul acestui dispozitiv doar daca utilizatorul a permis
  const guard = (op) => (p) => {
    const ws = ctx.store.state.globalSettings.workspace || {};
    if (!ws.shareWithDevices) throw new Error('Acest dispozitiv nu partajează workspace-ul.');
    if (op === 'write' && !ws.allowWrite) throw new Error('Scrierea în workspace este dezactivată.');
    return workspaceOps[op](p || {});
  };
  return { 'workspace.list': guard('list'), 'workspace.read': guard('read'), 'workspace.search': guard('search'), 'workspace.write': guard('write') };
}

module.exports = { init, runTool, TOOL_DOCS, workspaceOps };
