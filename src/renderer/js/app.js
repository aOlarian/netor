/* MAP
 * Scop: Nucleul interfetei Netor: starea (detinuta de interfata, salvata amanat in procesul principal),
 *       selectoare (browser/tab/grup activ), randarea pe zone, tema efectiva, raspunsurile la apelurile
 *       inverse din procesul principal (uiCall) si pornirea aplicatiei.
 * Legaturi: app-actions.js (actiuni), tabstrip.js, stage.js, webviews.js, favorites.js, minibar.js, autofill.js,
 *           vault-ui.js, agents.js, templates-ui.js, settings.js, tools-menu.js
 * Sectiuni:
 *   §1 Stare si selectoare
 *   §2 Salvare si randare
 *   §3 Apeluri inverse din procesul principal (uiCall)
 *   §4 Pornire
 */

// §1 Stare si selectoare
const NetorApp = {
  state: null,
  vault: null,
  vaultStatus: { initialized: false, unlocked: false },
  slots: {},
  downloads: new Map(),
  extensions: [],
  version: '',
  saveTimer: null,

  browser(id) { return this.state.browsers.find((b) => b.id === id) || null; },
  activeBrowser() { return this.browser(this.state.activeBrowserId) || this.state.browsers[0]; },
  tabById(tabId) {
    for (const b of this.state.browsers) { const t = b.tabs.find((x) => x.id === tabId); if (t) return { brw: b, tab: t }; }
    return { brw: null, tab: null };
  },
  groupById(brw, id) { return (brw.groups || []).find((g) => g.id === id) || null; },
  stripTabs(brw) { return brw.tabs.filter((t) => !t.groupId); },
  // Itemul activ: un tab (din afara grupurilor) sau un grup
  activeItem(brw = this.activeBrowser()) {
    const a = brw.active || {};
    if (a.kind === 'group' && this.groupById(brw, a.id)) return { kind: 'group', group: this.groupById(brw, a.id) };
    const tab = brw.tabs.find((t) => t.id === a.id && !t.groupId) || this.stripTabs(brw)[0];
    if (tab) return { kind: 'tab', tab };
    if (brw.groups[0]) return { kind: 'group', group: brw.groups[0] };
    return { kind: 'none' };
  },
  // Taburile web vizibile acum (tabul activ sau panourile grupului activ)
  visibleTabs(brw = this.activeBrowser()) {
    const it = this.activeItem(brw);
    if (it.kind === 'tab') return [it.tab];
    if (it.kind === 'group') return it.group.panes.map((p) => brw.tabs.find((t) => t.id === p.tabId)).filter(Boolean);
    return [];
  },
  focusedTab() {
    const vis = this.visibleTabs();
    return vis.find((t) => t.id === window.NetorStage.focusedTabId) || vis.find((t) => t.type === 'web') || vis[0] || null;
  },
  themeKey(brw = this.activeBrowser()) {
    return brw && brw.theme && brw.theme !== 'inherit' ? brw.theme : this.state.globalSettings.theme;
  },
  favoritesMode(brw = this.activeBrowser()) {
    const gs = this.state.globalSettings;
    if (!gs.showFavorites) return 'hidden';
    return brw && brw.favoritesMode && brw.favoritesMode !== 'inherit' ? brw.favoritesMode : gs.favoritesMode;
  },

  // §2 Salvare si randare
  // Salvare imediata: procesul principal trebuie sa vada starea la zi inainte de agent/comenzi
  async flush() {
    clearTimeout(this.saveTimer);
    await window.netorAPI.saveState({ state: this.state });
  },
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => window.netorAPI.saveState({ state: this.state }), 120);
  },
  commit(opts = {}) {
    this.save();
    this.render(opts);
  },
  render({ stage = true } = {}) {
    const key = window.NetorThemes.applyNetorTheme(this.themeKey());
    document.documentElement.dataset.theme = key;
    const th = window.NetorThemes.NETOR_THEMES[key];
    // Pagina "Tab nou" (netor://newtab) citeste culorile temei active prin netor://data/theme
    const ui = { mode: th.mode, bg: th.toolbar, fg: th.text, muted: th.muted, card: th.surface2, border: th.border, accent: th.accent };
    if (JSON.stringify(ui) !== JSON.stringify(this.state.ui)) { this.state.ui = ui; this.save(); }
    const app = document.getElementById('app');
    app.classList.toggle('minibar-left', this.state.minibar.position === 'left');
    document.getElementById('minibar').style.setProperty('--minibar-bg', this.state.minibar.bgColor);
    window.NetorMinibar.render(this);
    window.NetorTabstrip.render(this);
    window.NetorFavorites.render(this);
    window.NetorTools.syncSidebar(this);
    if (stage) window.NetorStage.render(this);
    window.NetorTools.renderBadges(this);
    document.title = `${this.activeBrowser().name} · Netor`;
  },

  // §3 Apeluri inverse din procesul principal (uiCall)
  async onUiCall({ id, cmd, params }) {
    const A = window.NetorActions;
    try {
      let data = null;
      if (cmd === 'openTab') data = await A.openTab(params);
      else if (cmd === 'activateTab') data = A.activateTab(params.tabId);
      else if (cmd === 'closeTab') data = A.closeTab(params.tabId);
      else if (cmd === 'createRunBrowser') data = A.createBrowser({ name: params.name, icon: '⚡', bgColor: '#7C3AED', allPrivate: !!params.isolated, activate: true });
      else if (cmd === 'wakeTabs') data = await window.NetorWV.wake(this, params.agentId, params.tabIds);
      else if (cmd === 'sleepTabs') data = window.NetorWV.sleep(params.agentId);
      else if (cmd === 'noteWrite') data = window.NetorNotes.write(this, params);
      else if (cmd === 'agentUpdated') { const a = this.state.agents.find((x) => x.id === params.agentId); if (a) { a.loop = params.loop; this.save(); window.NetorAgents.refreshControls(this, a.id); } }
      else if (cmd === 'templateUpdated') { const i = this.state.templates.findIndex((t) => t.id === params.template.id); if (i >= 0) { this.state.templates[i] = params.template; this.save(); } }
      else if (cmd === 'patchSettings') { Object.assign(this.state.globalSettings, params); this.save(); }
      else if (cmd === 'replaceState') { this.state = { ...this.state, ...params.state }; this.commit(); }
      else throw new Error(`Comandă UI necunoscută: ${cmd}`);
      window.netorEvents.reply(id, true, data);
    } catch (err) {
      window.netorEvents.reply(id, false, null, err.message);
    }
  },

  // §4 Pornire
  async init() {
    const init = await window.netorAPI.getInit();
    this.state = init.state;
    this.version = init.version;
    this.vaultStatus = init.vault;
    this.slots = init.slots || {};
    this.extensions = init.extensions || [];
    for (const d of init.downloads || []) this.downloads.set(d.id, d);
    window.netorEvents.on('ui-call', (p) => this.onUiCall(p));
    window.NetorActions.bind(this);
    window.NetorTools.bind(this);
    window.NetorAutofill.bind(this);
    window.NetorStage.bind(this);
    this.render();
    if (this.state.globalSettings.startup === 'newtab') window.NetorActions.openTab({ url: this.state.globalSettings.homepage });
  },
};

window.NetorApp = NetorApp;
window.addEventListener('DOMContentLoaded', () => NetorApp.init().catch((err) => {
  const pre = Object.assign(document.createElement('pre'), { textContent: `Netor nu a pornit: ${String((err && err.stack) || err)}` });
  pre.style.cssText = 'position:fixed;inset:40px;z-index:999;background:#fff;color:#b00;padding:20px;overflow:auto';
  document.body.appendChild(pre);
}));
