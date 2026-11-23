/* MAP
 * Scop: Uneltele din bara de titlu (Extensii, Descarcari, Note, Agenti, Date, Sabloane, Meniu), panoul lateral
 *       per browser (deschidere, inchidere, latime trasa, urmeaza browserul activ), meniul Netor, dispecerul scurtaturilor, istoricul,
 *       descarcarile si sectiunea Extensii din setari, tooltip-urile.
 * Legaturi: app.js, notes.js, agents.js, vault-ui.js, templates-ui.js, settings.js, webviews.js
 * Sectiuni:
 *   §1 Butoane si insigne
 *   §2 Panoul lateral comun
 *   §3 Meniul Netor si scurtaturi
 *   §4 Istoric si descarcari
 *   §5 Extensii
 */

window.NetorTools = {
  sidebarKind: '',
  sidebarBrowser: '',
  sidebars: {}, // browserId -> { kind, agentId }: panoul lateral deschis in fiecare browser

  // §1 Butoane si insigne
  bind(app) {
    const set = (id, icon, fn) => { const b = document.getElementById(id); b.innerHTML = IC(icon); b.onclick = (e) => fn(e, b); };
    set('btnNotes', 'notes', () => this.toggle(app, 'notes', () => window.NetorNotes.openSidebar(app)));
    set('btnAgents', 'agent', () => this.toggle(app, 'agents', () => window.NetorAgents.openSidebar(app)));
    set('btnVault', 'vault', () => this.toggle(app, 'vault', () => window.NetorVaultUI.openSidebar(app)));
    set('btnTemplates', 'zap', () => this.toggle(app, 'templates', () => window.NetorTemplates.openSidebar(app)));
    set('btnMenu', 'dots', (e, b) => { const r = b.getBoundingClientRect(); NX.showMenu(this.mainMenu(app), r.right - 260, r.bottom + 4); });
    set('btnDownloads', 'download', (e, b) => this.downloadsMenu(app, b));
    set('btnExtensions', 'puzzle', (e, b) => this.extensionsMenu(app, b));
    document.getElementById('btnSidebarClose').innerHTML = IC('close', 15);
    document.getElementById('btnSidebarClose').onclick = () => this.closeSidebar();
    this.sidebarBrowser = app.state.activeBrowserId;
    this.bindSidebarResize();
    this.bindTooltips();
    window.NetorAgents.bindEvents(app);
    window.NetorTemplates.bindEvents(app);
    window.netorEvents.on('download', (d) => { const prev = app.downloads.get(d.id); app.downloads.set(d.id, d); if (!prev) NX.toast(`Descarc: ${d.filename}`); if (d.state === 'completed' && prev && prev.state !== 'completed') NX.toast(`Descărcat: ${d.filename}`); this.renderBadges(app); });
    window.netorEvents.on('sync', (s) => { if (s && s.error) console.warn('[netor] sincronizare:', s.error); });
  },

  renderBadges(app) {
    const dl = document.getElementById('btnDownloads');
    const active = Array.from(app.downloads.values()).filter((d) => d.state === 'progressing').length;
    dl.classList.toggle('hidden', !app.downloads.size);
    dl.innerHTML = IC('download') + (active ? `<span class="badge">${active}</span>` : '');
    document.getElementById('btnVault').classList.toggle('unlocked', !!app.vault);
    document.getElementById('btnExtensions').classList.toggle('hidden', !app.extensions.length);
  },

  bindTooltips() {
    const tip = document.getElementById('tooltip');
    let t = 0;
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tip]');
      clearTimeout(t);
      if (!el) { tip.classList.add('hidden'); return; }
      t = setTimeout(() => {
        tip.textContent = el.dataset.tip;
        tip.classList.remove('hidden');
        const r = el.getBoundingClientRect();
        const w = tip.offsetWidth;
        const left = el.closest('.minibar') ? (document.getElementById('app').classList.contains('minibar-left') ? r.right + 8 : r.left - w - 8) : Math.min(window.innerWidth - w - 6, Math.max(6, r.left + r.width / 2 - w / 2));
        tip.style.left = `${left}px`;
        tip.style.top = `${el.closest('.minibar') ? r.top + r.height / 2 - 13 : r.bottom + 6}px`;
      }, 350);
    });
  },

  // §2 Panoul lateral comun: fiecare browser din minibar are panoul lui (deschis de tine, ramane in acel
  // browser); la trecerea in alt browser se arata panoul acelui browser sau niciunul.
  toggle(app, kind, open) {
    if (this.sidebarKind === kind) { this.closeSidebar(); return; }
    open();
  },

  openSidebar(app, kind, title, fill) {
    const sb = document.getElementById('sidebar');
    sb.classList.remove('hidden');
    this.sidebarKind = kind;
    this.sidebarBrowser = app.state.activeBrowserId;
    this.rememberSidebar(this.sidebarBrowser, kind, {});
    document.getElementById('sidebarTitle').textContent = title;
    const body = document.getElementById('sidebarBody');
    const actions = document.getElementById('sidebarActions');
    body.innerHTML = '';
    body.onclick = null;
    body.oncontextmenu = null;
    actions.innerHTML = '';
    this.markButtons(kind);
    fill(body, actions);
    window.NetorWV.layout();
  },

  rememberSidebar(browserId, kind, extra) {
    this.sidebars[browserId] = { ...(this.sidebars[browserId] && this.sidebars[browserId].kind === kind ? this.sidebars[browserId] : {}), kind, ...extra };
  },

  markButtons(kind) {
    const ids = { notes: 'btnNotes', agents: 'btnAgents', vault: 'btnVault', templates: 'btnTemplates' };
    Object.values(ids).forEach((id) => document.getElementById(id).classList.toggle('active', id === ids[kind]));
  },

  closeSidebar(keep) {
    document.getElementById('sidebar').classList.add('hidden');
    if (!keep && this.sidebarBrowser) delete this.sidebars[this.sidebarBrowser];
    this.sidebarKind = '';
    this.markButtons('');
    window.NetorWV.layout();
  },

  // Apelat la fiecare randare: daca s-a schimbat browserul activ, panoul lateral urmeaza browserul
  syncSidebar(app) {
    const id = app.state.activeBrowserId;
    if (id === this.sidebarBrowser) return;
    if (this.sidebarKind) this.closeSidebar(true);
    this.sidebarBrowser = id;
    const s = this.sidebars[id];
    if (!s) return;
    const open = { notes: () => window.NetorNotes.openSidebar(app), agents: () => window.NetorAgents.openSidebar(app, s.agentId),
      vault: () => window.NetorVaultUI.openSidebar(app), templates: () => window.NetorTemplates.openSidebar(app) }[s.kind];
    if (open) open();
  },

  bindSidebarResize() {
    const h = document.getElementById('sidebarResize');
    const sb = document.getElementById('sidebar');
    h.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const start = e.clientX;
      const w0 = sb.offsetWidth;
      document.getElementById('stage').classList.add('dragging');
      const move = (ev) => { sb.style.width = `${Math.max(280, Math.min(window.innerWidth * 0.7, w0 + (start - ev.clientX)))}px`; window.NetorWV.layout(); };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.getElementById('stage').classList.remove('dragging'); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  },

  // §3 Meniul Netor si scurtaturi
  mainMenu(app) {
    const A = window.NetorActions;
    const tab = app.focusedTab();
    const web = tab && tab.type === 'web';
    const zoom = web && window.NetorWV.get(tab.id) ? Math.round((window.NetorWV.get(tab.id).zoom || 1) * 100) : 100;
    return [
      { label: 'Tab nou', hint: 'Ctrl+T', onClick: () => A.openTab({}) },
      { label: 'Browser nou în minibar', onClick: () => window.NetorMinibar.newBrowser(app) },
      { label: 'Browser privat nou', onClick: () => A.createBrowser({ name: 'Privat', icon: '🕵️', bgColor: '#111827', allPrivate: true }) },
      { separator: true },
      { label: 'Istoric', hint: 'Ctrl+H', onClick: () => this.history(app) },
      { label: 'Descărcări', hint: 'Ctrl+J', onClick: () => this.downloadsMenu(app, document.getElementById('btnMenu')) },
      { label: 'Sloturi (Ctrl+1..9)', onClick: () => window.NetorAutofill.manageSlots(app) },
      { label: 'Fereastra de date', onClick: () => window.NetorAutofill.openDataWindow(app) },
      { separator: true },
      web && { label: `Zoom ${zoom}%`, submenu: [{ label: 'Mărește', hint: 'Ctrl +', onClick: () => window.NetorWV.cmd(tab.id, 'zoomIn') }, { label: 'Micșorează', hint: 'Ctrl −', onClick: () => window.NetorWV.cmd(tab.id, 'zoomOut') }, { label: 'Resetează', hint: 'Ctrl+0', onClick: () => window.NetorWV.cmd(tab.id, 'zoomReset') }] },
      web && { label: 'Caută în pagină', hint: 'Ctrl+F', onClick: () => window.NetorStage.openFind(app) },
      web && { label: 'Printează…', hint: 'Ctrl+P', onClick: () => window.NetorWV.cmd(tab.id, 'print') },
      web && { label: 'Instrumente pentru dezvoltatori', hint: 'F12', onClick: () => window.NetorWV.cmd(tab.id, 'devtools') },
      { separator: true },
      { label: 'Setări', onClick: () => window.NetorSettings.open(app) },
      { label: 'Extensii', onClick: () => window.NetorSettings.open(app, 'extensions') },
      { label: 'Despre Netor', onClick: () => window.NetorSettings.open(app, 'about') },
    ];
  },

  shortcut(app, name, p) {
    const A = window.NetorActions;
    const tab = (p && p.tabId && app.tabById(p.tabId).tab) || app.focusedTab();
    const id = tab && tab.id;
    const map = {
      newTab: () => A.openTab({}), closeTab: () => id && A.closeTab(id), reopenTab: () => A.reopenTab(), nextTab: () => A.cycleTab(1), prevTab: () => A.cycleTab(-1),
      focusUrl: () => window.NetorStage.focusUrl(id), find: () => window.NetorStage.openFind(app), history: () => this.history(app),
      downloads: () => this.downloadsMenu(app, document.getElementById('btnMenu')), bookmark: () => tab && window.NetorFavorites.toggleCurrent(app, tab, true),
      toggleFavorites: () => { app.state.globalSettings.showFavorites = !app.state.globalSettings.showFavorites; app.commit(); },
      slotCopyHost: () => { const s = String(window.getSelection() || '').trim(); if (s) window.netorAPI.slotSet({ slot: p.slot, value: s }); },
      savePage: () => tab && A.openTab({ url: tab.url }),
    };
    if (map[name]) map[name]();
    else if (id) window.NetorWV.cmd(id, name);
  },

  // §4 Istoric si descarcari
  history(app) {
    NX.openModal({
      title: 'Istoric', width: 760,
      body: `<div class="row"><div class="search-box" style="flex:1">${IC('search', 14)}<input class="inp" data-q placeholder="Caută în istoric"></div><button class="btn danger" data-clear>Șterge tot istoricul</button></div><div class="hist-list" data-list></div>`,
      onMount: (m) => {
        const draw = async () => {
          const r = await window.netorAPI.historyList({ q: NX.$('[data-q]', m.body).value, offset: 0 });
          NX.$('[data-list]', m.body).innerHTML = (r.items || []).map((h) => `<div class="hist-row" data-url="${NX.esc(h.url)}"><span class="muted-text">${new Date(h.ts).toLocaleString('ro-RO')}</span>
            <span class="hist-title">${NX.esc(h.title || h.url)}</span><small>${NX.esc(h.url)}</small><button class="icon-btn" data-del title="Șterge">${IC('close', 13)}</button></div>`).join('') || '<div class="empty">Istoricul e gol.</div>';
        };
        NX.$('[data-q]', m.body).addEventListener('input', draw);
        NX.$('[data-list]', m.body).addEventListener('click', async (e) => {
          const row = e.target.closest('.hist-row');
          if (!row) return;
          if (e.target.closest('[data-del]')) { await window.netorAPI.historyRemove({ url: row.dataset.url }); draw(); return; }
          window.NetorActions.openTab({ url: row.dataset.url });
          m.close();
        });
        NX.$('[data-clear]', m.body).onclick = async () => { if (await NX.confirmBox({ title: 'Șterge istoricul', message: 'Ștergi tot istoricul de navigare?', okLabel: 'Șterge', danger: true })) { await window.netorAPI.historyRemove({}); draw(); } };
        draw();
      },
    });
  },

  downloadsMenu(app, anchor) {
    const r = anchor.getBoundingClientRect();
    const list = Array.from(app.downloads.values()).sort((a, b) => b.startedAt - a.startedAt).slice(0, 12);
    const fmt = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
    NX.showMenu(list.length ? list.map((d) => ({
      html: `<div class="dl-row"><b>${NX.esc(d.filename)}</b><small>${d.state === 'completed' ? `${fmt(d.total || d.received)} · gata` : d.state === 'progressing' ? `${fmt(d.received)} / ${d.total ? fmt(d.total) : '?'}` : d.state === 'cancelled' ? 'anulat' : 'întrerupt'}</small></div>`,
      submenu: [{ label: 'Deschide', disabled: d.state !== 'completed', onClick: () => window.netorAPI.downloadAction({ id: d.id, action: 'open' }) },
        { label: 'Arată în folder', disabled: !d.path, onClick: () => window.netorAPI.downloadAction({ id: d.id, action: 'show' }) },
        d.state === 'progressing' && { label: 'Anulează', danger: true, onClick: () => window.netorAPI.downloadAction({ id: d.id, action: 'cancel' }) },
        { label: 'Scoate din listă', onClick: () => { window.netorAPI.downloadAction({ id: d.id, action: 'remove' }); app.downloads.delete(d.id); this.renderBadges(app); } }],
    })) : [{ label: 'Nicio descărcare', disabled: true }], r.right - 300, r.bottom + 4);
  },

  // §5 Extensii
  extensionsMenu(app, anchor) {
    const r = anchor.getBoundingClientRect();
    const brw = app.activeBrowser();
    const tab = app.focusedTab();
    const rec = tab && window.NetorWV.get(tab.id);
    NX.showMenu([...app.extensions.filter((x) => x.enabled).map((x) => ({ html: `${x.iconData ? `<img src="${x.iconData}" width="16" height="16"> ` : ''}${NX.esc(x.name)}`, disabled: !x.popup,
      onClick: () => window.netorAPI.extPopup({ id: x.id, partition: (rec && rec.partition) || `persist:netor_${brw.id}`, x: r.right, y: r.bottom }) })),
    { separator: true }, { label: 'Gestionează extensiile…', onClick: () => window.NetorSettings.open(app, 'extensions') }], r.right - 260, r.bottom + 4);
  },

  async extensionsPane(app, host) {
    const draw = async () => {
      const list = await window.netorAPI.extList();
      app.extensions = Array.isArray(list) ? list : [];
      this.renderBadges(app);
      host.innerHTML = `<h2 class="section-title">Extensii Chrome</h2><p class="section-sub">Instalează din Chrome Web Store (lipește linkul extensiei) sau dintr-un folder despachetat. Majoritatea extensiilor merg; cele care depind de API-uri Chrome rare pot avea funcții lipsă.</p>
        <div class="row"><input class="inp" data-cws placeholder="https://chromewebstore.google.com/detail/…/ID"><button class="btn primary" data-inst>Instalează</button><button class="btn" data-folder>Din folder…</button></div>
        <div class="muted-text" data-out style="margin:8px 0"></div><div class="ext-list">${app.extensions.map((x) => `<div class="card row" data-id="${NX.esc(x.id)}">
          ${x.iconData ? `<img src="${x.iconData}" width="28" height="28">` : IC('puzzle', 24)}<div style="flex:1"><b>${NX.esc(x.name)}</b><div class="muted-text">v${NX.esc(x.version)} · MV${x.mv} · ${x.source === 'store' ? 'Chrome Web Store' : NX.esc(x.path)}</div></div>
          <label class="switch" style="border:0"><input type="checkbox" data-on ${x.enabled ? 'checked' : ''}></label><button class="btn small danger" data-rm>Elimină</button></div>`).join('') || '<div class="empty">Nicio extensie instalată.</div>'}</div>`;
      const out = NX.$('[data-out]', host);
      NX.$('[data-inst]', host).onclick = async () => { out.textContent = 'Descarc și instalez…'; const res = await window.netorAPI.extInstallStore({ input: NX.$('[data-cws]', host).value }); out.textContent = res && res.ok === false ? `Eroare: ${res.error}` : `Instalată: ${res.name}`; if (!(res && res.ok === false)) draw(); };
      NX.$('[data-folder]', host).onclick = async () => { const dir = await window.netorAPI.pickFolder({ title: 'Folderul extensiei (cu manifest.json)' }); if (typeof dir !== 'string') return; const res = await window.netorAPI.extInstallFolder({ dir }); out.textContent = res && res.ok === false ? `Eroare: ${res.error}` : `Încărcată: ${res.name}`; draw(); };
      host.querySelectorAll('.ext-list [data-id]').forEach((row) => {
        NX.$('[data-on]', row).addEventListener('change', (e) => window.netorAPI.extEnable({ id: row.dataset.id, on: e.target.checked }).then(draw));
        NX.$('[data-rm]', row).addEventListener('click', () => window.netorAPI.extRemove({ id: row.dataset.id }).then(draw));
      });
    };
    draw();
  },
};
