/* MAP
 * Scop: Actiunile Netor asupra starii: taburi (deschidere, inchidere, redeschidere, pin, mutare), grupuri
 *       (creare, adaugare in cel mai mare loc liber, scoatere cu umplerea golului, stergere), browsere (creare, stergere), navigare cu cautare,
 *       scurtaturi de tastatura si evenimente din procesul principal (link nou, cautare, descarcari).
 * Legaturi: app.js (stare), webviews.js, stage.js, tabstrip.js, tools-menu.js
 * Sectiuni:
 *   §1 Utilitare (id, URL din text tastat)
 *   §2 Taburi
 *   §3 Grupuri
 *   §4 Browsere
 *   §5 Scurtaturi si evenimente
 */

// §1 Utilitare
const NEWTAB = 'netor://newtab';
function resolveInput(app, text) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (/^(https?|file|netor|about|view-source|chrome-extension):/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return `http://${s}`;
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s)) return `https://${s}`;
  const eng = { google: 'https://www.google.com/search?q=%s', bing: 'https://www.bing.com/search?q=%s', duckduckgo: 'https://duckduckgo.com/?q=%s',
    brave: 'https://search.brave.com/search?q=%s', startpage: 'https://www.startpage.com/do/search?q=%s' }[app.state.globalSettings.searchEngine] || 'https://www.google.com/search?q=%s';
  return eng.replace('%s', encodeURIComponent(s));
}

window.NetorActions = {
  app: null,

  // §2 Taburi
  async openTab({ url, browserId, background, groupId, type = 'web', refId = '', proxy = null, title = '' } = {}) {
    const app = this.app;
    const brw = app.browser(browserId) || app.activeBrowser();
    const tab = { id: NX.uid('tab'), type, url: type === 'web' ? (url || NEWTAB) : '', refId, title: title || (type === 'web' ? 'Tab nou' : ''), customTitle: '', pinned: false, groupId: '' };
    if (proxy) { tab.proxy = proxy; tab.isolated = true; }
    const cur = app.activeItem(brw);
    const idx = cur.kind === 'tab' ? brw.tabs.indexOf(cur.tab) + 1 : brw.tabs.length;
    brw.tabs.splice(idx, 0, tab);
    if (groupId && app.groupById(brw, groupId)) {
      tab.groupId = groupId;
      this.placeInGroup(app.groupById(brw, groupId), tab.id);
      if (!background) brw.active = { kind: 'group', id: groupId };
    } else if (!background) brw.active = { kind: 'tab', id: tab.id };
    if (!background && brw.id !== app.state.activeBrowserId) app.state.activeBrowserId = brw.id;
    app.commit();
    if (type === 'web') {
      const rec = await window.NetorWV.ensure(app, brw, tab);
      // Agentii si sabloanele folosesc tabul imediat: asteptam legarea lui de webContents
      await Promise.race([rec.ready, new Promise((r) => setTimeout(r, 10000))]);
    }
    if (!background && type === 'web' && tab.url === NEWTAB) setTimeout(() => window.NetorStage.focusUrl(tab.id), 60);
    return { tabId: tab.id, browserId: brw.id };
  },

  activateTab(tabId) {
    const { brw, tab } = this.app.tabById(tabId);
    if (!tab) throw new Error('Tab inexistent');
    this.app.state.activeBrowserId = brw.id;
    brw.active = tab.groupId ? { kind: 'group', id: tab.groupId } : { kind: 'tab', id: tab.id };
    window.NetorStage.focusedTabId = tab.id;
    this.app.commit();
    return { ok: true };
  },

  closeTab(tabId) {
    const app = this.app;
    const { brw, tab } = app.tabById(tabId);
    if (!tab) return { ok: false };
    if (tab.type === 'web' && tab.url && !brw.allPrivate) {
      brw.closedTabs.unshift({ url: tab.url, title: tab.customTitle || tab.title, at: Date.now() });
      brw.closedTabs.length = Math.min(brw.closedTabs.length, 25);
    }
    if (tab.groupId) this.removeFromGroup(tabId, true);
    const strip = app.stripTabs(brw);
    const pos = strip.indexOf(tab);
    brw.tabs = brw.tabs.filter((t) => t.id !== tabId);
    window.NetorWV.destroy(tabId, brw.allPrivate || tab.isolated);
    if (brw.active.kind === 'tab' && brw.active.id === tabId) {
      const rest = app.stripTabs(brw);
      const next = rest[Math.min(pos, rest.length - 1)];
      brw.active = next ? { kind: 'tab', id: next.id } : brw.groups[0] ? { kind: 'group', id: brw.groups[0].id } : { kind: 'none' };
    }
    if (!brw.tabs.length) { this.openTab({ browserId: brw.id }); return { ok: true }; }
    app.commit();
    return { ok: true };
  },

  reopenTab() {
    const brw = this.app.activeBrowser();
    const last = brw.closedTabs.shift();
    if (last) this.openTab({ url: last.url, browserId: brw.id });
  },

  duplicateTab(tabId) {
    const { brw, tab } = this.app.tabById(tabId);
    if (tab && tab.type === 'web') this.openTab({ url: tab.url, browserId: brw.id });
  },

  navigate(tabId, text) {
    const url = resolveInput(this.app, text);
    const { brw, tab } = this.app.tabById(tabId);
    if (!url || !tab) return;
    tab.url = url;
    this.app.save();
    window.NetorWV.load(this.app, brw, tab, url);
  },

  moveTab(tabId, destBrowserId, destGroupId) {
    const app = this.app;
    const { brw, tab } = app.tabById(tabId);
    const dest = app.browser(destBrowserId);
    if (!tab || !dest) return;
    if (tab.groupId) this.removeFromGroup(tabId, true);
    if (dest.id !== brw.id) {
      brw.tabs = brw.tabs.filter((t) => t.id !== tabId);
      if (brw.active.id === tabId) { const n = app.stripTabs(brw)[0]; brw.active = n ? { kind: 'tab', id: n.id } : { kind: 'none' }; }
      if (!brw.tabs.length) brw.tabs.push({ id: NX.uid('tab'), type: 'web', url: NEWTAB, title: 'Tab nou', customTitle: '', pinned: false, groupId: '' });
      dest.tabs.push(tab);
      // Sesiunea (cookie-urile) apartine browserului: tabul mutat se reincarca in sesiunea destinatiei
      window.NetorWV.destroy(tabId, brw.allPrivate || tab.isolated);
    }
    app.state.activeBrowserId = dest.id;
    if (destGroupId) this.addToGroup(tabId, destGroupId, dest);
    else dest.active = { kind: 'tab', id: tab.id };
    app.commit();
  },

  // §3 Grupuri
  async createGroup(tabId, name) {
    const found = this.app.tabById(tabId);
    const brw = found.brw || this.app.activeBrowser();
    const tab = found.tab;
    const gname = name || await NX.askText({ title: 'Grup nou', label: 'Numele grupului', value: `Grup ${brw.groups.length + 1}`, okLabel: 'Creează' });
    if (!gname) return null;
    const colors = ['#1A73E8', '#0F9D58', '#F4B400', '#DB4437', '#7C3AED', '#EC4899', '#14B8A6', '#F97316'];
    const g = { id: NX.uid('grp'), name: gname.trim(), color: colors[brw.groups.length % colors.length], layout: 'grid', panes: [] };
    brw.groups.push(g);
    if (tab) this.addToGroup(tab.id, g.id, brw);
    brw.active = { kind: 'group', id: g.id };
    this.app.commit();
    return g;
  },

  addToGroup(tabId, groupId, brw = this.app.tabById(tabId).brw) {
    const tab = brw.tabs.find((t) => t.id === tabId);
    const g = this.app.groupById(brw, groupId);
    if (!tab || !g) return;
    if (tab.groupId && tab.groupId !== groupId) this.removeFromGroup(tabId, true);
    this.placeInGroup(g, tabId);
    if (brw.active.kind === 'tab' && brw.active.id === tabId) brw.active = { kind: 'group', id: groupId };
    tab.groupId = groupId;
    tab.pinned = false;
    brw.active = { kind: 'group', id: groupId };
    window.NetorStage.focusedTabId = tabId;
    this.app.commit();
  },

  // Fereastra noua intra in cel mai mare loc liber; daca nu mai e loc, grupul se reaseaza in grila (2x2, 3x3...)
  placeInGroup(g, tabId) {
    if (g.panes.some((p) => p.tabId === tabId)) return;
    const G = window.NetorGroupGeom;
    G.normalizeaza(g);
    const st = document.getElementById('stage');
    const rect = G.loculNou(g.panes.map((p) => p.rect), st.clientWidth || 1200, st.clientHeight || 800);
    g.panes.push({ tabId, rect });
    if (!rect) G.asezare('grid', g.panes.length).forEach((r, i) => { g.panes[i].rect = r; });
    g.maxTabId = '';
  },

  removeFromGroup(tabId, silent) {
    const { brw, tab } = this.app.tabById(tabId);
    if (!tab || !tab.groupId) return;
    const g = this.app.groupById(brw, tab.groupId);
    tab.groupId = '';
    if (g) {
      const gone = g.panes.find((p) => p.tabId === tabId);
      g.panes = g.panes.filter((p) => p.tabId !== tabId);
      if (g.maxTabId === tabId) g.maxTabId = '';
      // Vecinele lipite de fereastra scoasa se intind peste golul ei; ultima ramasa ia tot grupul
      if (gone && gone.rect) window.NetorGroupGeom.umpleGolul(gone.rect, g.panes.map((p) => p.rect).filter(Boolean));
      if (g.panes.length === 1) g.panes[0].rect = { l: 0, t: 0, r: 1, b: 1 };
      if (!g.panes.length) { brw.groups = brw.groups.filter((x) => x.id !== g.id); if (brw.active.id === g.id) brw.active = { kind: 'tab', id: tab.id }; }
    }
    if (!silent) { brw.active = { kind: 'tab', id: tab.id }; this.app.commit(); }
  },

  ungroup(groupId, closeTabs) {
    const brw = this.app.activeBrowser();
    const g = this.app.groupById(brw, groupId);
    if (!g) return;
    for (const p of [...g.panes]) { if (closeTabs) this.closeTab(p.tabId); else { const t = brw.tabs.find((x) => x.id === p.tabId); if (t) t.groupId = ''; } }
    brw.groups = brw.groups.filter((x) => x.id !== groupId);
    const first = this.app.stripTabs(brw)[0];
    if (brw.active.id === groupId) brw.active = first ? { kind: 'tab', id: first.id } : { kind: 'none' };
    if (!brw.tabs.length) { this.openTab({ browserId: brw.id }); return; }
    this.app.commit();
  },

  // §4 Browsere
  createBrowser({ name, icon = '🌐', bgColor = '#0F9D58', allPrivate = false, activate = true } = {}) {
    const st = this.app.state;
    const tabId = NX.uid('tab');
    const b = { id: NX.uid('brw'), name: name || `Browser ${st.browsers.length + 1}`, icon, iconColor: '#FFFFFF', bgColor, theme: 'inherit',
      proxy: { mode: 'inherit' }, downloadDir: '', adblock: 'inherit', favoritesMode: 'inherit', allPrivate, active: { kind: 'tab', id: tabId },
      tabs: [{ id: tabId, type: 'web', url: NEWTAB, title: 'Tab nou', customTitle: '', pinned: false, groupId: '' }], groups: [], closedTabs: [] };
    st.browsers.push(b);
    if (activate) st.activeBrowserId = b.id;
    this.app.commit();
    return { browserId: b.id };
  },

  async deleteBrowser(id) {
    const st = this.app.state;
    if (st.browsers.length <= 1) { NX.toast('Trebuie să rămână cel puțin un browser.', 'warn'); return; }
    const b = this.app.browser(id);
    const ok = await NX.confirmBox({ title: 'Șterge browserul', message: `Ștergi „${b.name}” cu toate taburile, grupurile și datele lui (cookie-uri, login-uri)?`, okLabel: 'Șterge', danger: true });
    if (!ok) return;
    for (const t of b.tabs) window.NetorWV.destroy(t.id, true);
    await window.netorAPI.clearBrowser({ browserId: id });
    st.browsers = st.browsers.filter((x) => x.id !== id);
    if (st.activeBrowserId === id) st.activeBrowserId = st.browsers[0].id;
    this.app.commit();
  },

  cycleTab(dir) {
    const brw = this.app.activeBrowser();
    const items = window.NetorTabstrip.order(this.app, brw);
    const cur = items.findIndex((x) => x.id === brw.active.id);
    const next = items[(cur + dir + items.length) % items.length];
    if (next) { brw.active = { kind: next.kind, id: next.id }; this.app.commit(); }
  },

  // §5 Scurtaturi si evenimente
  bind(app) {
    this.app = app;
    const run = (name, p) => window.NetorTools.shortcut(app, name, p);
    window.netorEvents.on('shortcut', (p) => run(p.name, p));
    window.netorEvents.on('open-url', (p) => {
      const url = p.search ? resolveInput(app, p.search) : p.url;
      const from = p.tabId && app.tabById(p.tabId);
      const browserId = p.browserId || (from && from.brw && from.brw.id);
      this.openTab({ url, browserId, background: !!p.background });
    });
    document.getElementById('btnNewTab').onclick = () => this.openTab({});
  },
};
window.NetorActions.resolveInput = resolveInput;
