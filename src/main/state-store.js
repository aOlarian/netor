/* MAP
 * Scop: Persistenta atomica a starii Netor (netor-state.json) si migrarea starii din v1.0 la v1.1
 *       (teme noi, grupuri pe taburi, favorite cu foldere, setari structurate, fara date de test).
 * Legaturi: config.js, main.js, ipc.js, cloud-sync.js
 * Sectiuni:
 *   §1 Citire/scriere atomica cu salvare amanata
 *   §2 Migrare v1.0 -> v1.1
 *   §3 Normalizare (campuri lipsa dupa actualizari)
 */
const fs = require('fs');
const path = require('path');
const { createDefaultState, createBrowser, APP_VERSION, NEWTAB_URL } = require('./config');

// §1 Citire/scriere atomica cu salvare amanata
class StateStore {
  constructor(userDataDir) {
    this.dir = userDataDir;
    fs.mkdirSync(this.dir, { recursive: true });
    this.statePath = path.join(this.dir, 'netor-state.json');
    this.saveTimer = null;
    this.listeners = new Set();
    this.state = this.load();
  }

  load() {
    let raw = null;
    try {
      if (fs.existsSync(this.statePath)) raw = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch (err) {
      // Fisier corupt: il pastram pentru diagnostic si pornim curat
      try { fs.copyFileSync(this.statePath, this.statePath + `.corrupt-${Date.now()}`); } catch (_) { /* copia e optionala */ }
      console.error('[netor] stare corupta, pornesc cu starea implicita:', err.message);
    }
    const st = normalize(raw ? migrate(raw) : createDefaultState());
    this.writeNow(st);
    return st;
  }

  writeNow(st = this.state) {
    const tmp = this.statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(st, null, 1), 'utf8');
    fs.renameSync(tmp, this.statePath);
  }

  replace(nextState) {
    this.state = normalize(nextState);
    this.scheduleSave();
    for (const fn of this.listeners) fn(this.state);
    return this.state;
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.writeNow(), 250);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.writeNow();
  }

  onChange(fn) { this.listeners.add(fn); }
}

// §2 Migrare v1.0 -> v1.1
function migrate(old) {
  if (old.version && old.version >= '1.1.0') return old;
  const def = createDefaultState();
  const gs0 = old.globalSettings || {};
  const st = { ...def, notes: old.notes || [], favorites: [], templates: [], agents: [] };
  st.globalSettings = {
    ...def.globalSettings,
    cloudUrl: gs0.cloudUrl || def.globalSettings.cloudUrl, authToken: gs0.authToken || '', user: gs0.user || null,
    deviceId: gs0.deviceId || '', deviceKey: gs0.deviceKey || '',
    downloadDir: gs0.defaultDownloadDir || def.globalSettings.downloadDir,
    favoritesMode: gs0.favoritesSameLine ? 'same' : 'separate',
  };
  if (old.minibar) st.minibar = { ...def.minibar, ...old.minibar };
  // Favoritele vechi: campul "folder" text devine folder real
  const folders = {};
  for (const f of (old.favorites || [])) {
    let parentId = '';
    if (f.folder) {
      if (!folders[f.folder]) {
        folders[f.folder] = `fold_${Object.keys(folders).length + 1}`;
        st.favorites.push({ id: folders[f.folder], type: 'folder', title: f.folder, parentId: '' });
      }
      parentId = folders[f.folder];
    }
    st.favorites.push({ id: f.id, type: 'link', title: f.title, url: f.url, parentId });
  }
  // Agentii si notele raman; mesajele simulate din v1.0 se elimina
  st.agents = (old.agents || []).map((a) => ({ ...a, model: '', messages: [] })); // modelele v1.0 nu exista in cli2api: se foloseste modelul implicit
  // Browsere: activeTabId/activeGroupId -> active; panourile grupului -> taburi cu groupId
  st.browsers = (old.browsers || []).map((b) => {
    const nb = { ...createBrowser(b.id, b.name, b.icon, b.bgColor), iconColor: b.iconColor || '#FFFFFF', allPrivate: !!b.allPrivate };
    nb.theme = b.theme ? 'inherit' : 'inherit';
    nb.proxy = b.proxy ? parseProxyString(b.proxy) : { mode: 'inherit' };
    nb.downloadDir = b.downloadDir && b.downloadDir !== gs0.defaultDownloadDir ? b.downloadDir : '';
    nb.adblock = b.adblock === false ? 'off' : 'inherit';
    nb.tabs = (b.tabs || []).map((t) => ({ id: t.id, type: t.type || 'web', url: t.url || NEWTAB_URL, title: t.title || '',
      customTitle: t.customTitle || '', pinned: !!t.pinned, refId: t.refId || '', groupId: '' }));
    nb.groups = (b.groups || []).map((g) => ({ id: g.id, name: g.name, color: '#1A73E8', layout: 'grid', panes: [] }));
    for (const g of (b.groups || [])) {
      const ng = nb.groups.find((x) => x.id === g.id);
      for (const p of (g.panes || [])) {
        let tab = p.type === 'web' ? nb.tabs.find((t) => t.id === p.refId) : null;
        if (!tab && p.type !== 'web') {
          tab = { id: `tab_${p.id}`, type: p.type, refId: p.refId, title: '', customTitle: '', pinned: false, groupId: '' };
          nb.tabs.push(tab);
        }
        if (tab && !tab.groupId) { tab.groupId = ng.id; tab.pinned = false; ng.panes.push({ tabId: tab.id }); }
      }
    }
    if (!nb.tabs.some((t) => !t.groupId)) nb.tabs.push({ id: `tab_${Date.now()}`, type: 'web', url: NEWTAB_URL, title: 'Tab nou', customTitle: '', pinned: false, groupId: '' });
    nb.active = b.activeGroupId && nb.groups.some((g) => g.id === b.activeGroupId)
      ? { kind: 'group', id: b.activeGroupId }
      : { kind: 'tab', id: nb.tabs.some((t) => t.id === b.activeTabId && !t.groupId) ? b.activeTabId : nb.tabs.find((t) => !t.groupId).id };
    return nb;
  });
  if (!st.browsers.length) st.browsers = def.browsers;
  st.activeBrowserId = st.browsers.some((b) => b.id === old.activeBrowserId) ? old.activeBrowserId : st.browsers[0].id;
  st.version = APP_VERSION;
  return st;
}

function parseProxyString(s) {
  const m = String(s).trim().match(/^(?:(socks5|socks4|http|https):\/\/)?(?:([^:@]+)(?::([^@]*))?@)?([^:/]+):(\d+)/i);
  if (!m) return { mode: 'inherit' };
  return { mode: 'custom', scheme: (m[1] || 'http').toLowerCase(), host: m[4], port: m[5], username: m[2] || '', password: m[3] || '', bypass: '<local>' };
}

// §3 Normalizare
function normalize(st) {
  const def = createDefaultState();
  const out = { ...def, ...st };
  out.globalSettings = { ...def.globalSettings, ...(st.globalSettings || {}) };
  out.globalSettings.workspace = { ...def.globalSettings.workspace, ...(out.globalSettings.workspace || {}) };
  out.globalSettings.ai = { ...def.globalSettings.ai, ...(out.globalSettings.ai || {}) };
  out.globalSettings.proxy = { ...def.globalSettings.proxy, ...(out.globalSettings.proxy || {}) };
  out.minibar = { ...def.minibar, ...(st.minibar || {}) };
  for (const key of ['favorites', 'notes', 'agents', 'templates']) if (!Array.isArray(out[key])) out[key] = [];
  if (!Array.isArray(out.browsers) || !out.browsers.length) out.browsers = def.browsers;
  for (const b of out.browsers) {
    b.tabs = Array.isArray(b.tabs) ? b.tabs : [];
    b.groups = Array.isArray(b.groups) ? b.groups : [];
    b.closedTabs = Array.isArray(b.closedTabs) ? b.closedTabs : [];
    if (!b.proxy || typeof b.proxy !== 'object') b.proxy = { mode: 'inherit' };
  }
  if (!out.browsers.some((b) => b.id === out.activeBrowserId)) out.activeBrowserId = out.browsers[0].id;
  out.version = APP_VERSION;
  return out;
}

module.exports = { StateStore, migrate, normalize, parseProxyString };
