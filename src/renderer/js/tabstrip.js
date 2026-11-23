/* MAP
 * Scop: Bara de taburi din bara de titlu: taburi (favicon, incarcare, titlu, inchidere), grupuri ca "taburi de
 *       grup", ordonare prin tragere, redenumire inline (si pe taburi fixate, cu camp care iese in afara tabului),
 *       meniurile contextuale: tab (Pin, Rename, Group, Move to, proxy per tab...) si grup.
 * Legaturi: app.js, app-actions.js, webviews.js, minibar.js (tragere pe bulina = mutare in alt browser)
 * Sectiuni:
 *   §1 Ordinea elementelor si randare
 *   §2 Element tab / grup
 *   §3 Tragere si plasare
 *   §4 Redenumire inline
 *   §5 Meniuri contextuale
 */

window.NetorTabstrip = {
  renaming: null,
  dragId: null,
  raf: 0,

  // §1 Ordinea elementelor si randare
  order(app, brw) {
    const items = [];
    const seenGroups = new Set();
    const pinned = brw.tabs.filter((t) => t.pinned && !t.groupId);
    for (const t of pinned) items.push({ kind: 'tab', id: t.id, tab: t });
    for (const t of brw.tabs) {
      if (t.pinned && !t.groupId) continue;
      if (t.groupId) {
        if (seenGroups.has(t.groupId)) continue;
        const g = app.groupById(brw, t.groupId);
        if (g) { seenGroups.add(g.id); items.push({ kind: 'group', id: g.id, group: g }); }
        continue;
      }
      items.push({ kind: 'tab', id: t.id, tab: t });
    }
    return items;
  },

  render(app) {
    const host = document.getElementById('tabstrip');
    const brw = app.activeBrowser();
    host.innerHTML = '';
    for (const it of this.order(app, brw)) host.appendChild(it.kind === 'tab' ? this.tabEl(app, brw, it.tab) : this.groupEl(app, brw, it.group));
    host.ondblclick = (e) => { if (e.target === host) window.NetorActions.openTab({}); };
  },

  updateTab(app) {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.render(app));
  },

  // §2 Element tab / grup
  tabEl(app, brw, tab) {
    const el = document.createElement('div');
    const active = brw.active.kind === 'tab' && brw.active.id === tab.id;
    const rec = window.NetorWV.get(tab.id);
    el.className = `tab${active ? ' active' : ''}${tab.pinned ? ' pinned' : ''}`;
    el.dataset.id = tab.id;
    el.draggable = true;
    const title = tab.customTitle || tab.title || (tab.type === 'note' ? 'Notă' : tab.type === 'agent' ? 'Agent' : 'Tab nou');
    el.title = `${title}${tab.url && tab.type === 'web' ? `\n${tab.url}` : ''}${tab.proxy ? `\nProxy: ${tab.proxy.host}:${tab.proxy.port}` : ''}`;
    let fav = tab.type === 'note' ? IC('notes', 14) : tab.type === 'agent' ? IC('agent', 14) : IC('globe', 14);
    if (rec && rec.loading && tab.type === 'web') fav = '<span class="spinner"></span>';
    else if (tab.favicon && tab.type === 'web') fav = `<img src="${NX.esc(tab.favicon)}" alt="">`;
    el.innerHTML = `<span class="tab-fav">${fav}</span><span class="tab-title">${NX.esc(title)}</span>` +
      `${tab.audible ? '<span class="audio">🔊</span>' : ''}${tab.proxy ? '<span class="audio" title="Proxy propriu">🛡</span>' : ''}` +
      `<button class="tab-close" title="Închide (Ctrl+W)">✕</button>`;
    const img = el.querySelector('.tab-fav img');
    if (img) img.addEventListener('error', () => { tab.favicon = ''; img.replaceWith(Object.assign(document.createElement('span'), { innerHTML: IC('globe', 14) })); });
    el.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); window.NetorActions.closeTab(tab.id); } });
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) { e.stopPropagation(); window.NetorActions.closeTab(tab.id); return; }
      brw.active = { kind: 'tab', id: tab.id };
      window.NetorStage.focusedTabId = tab.id;
      app.commit();
    });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.tabMenu(app, brw, tab, e.clientX, e.clientY); });
    this.dragHandlers(app, brw, el, { kind: 'tab', id: tab.id });
    if (this.renaming === tab.id) this.renameInput(app, el, tab);
    return el;
  },

  groupEl(app, brw, g) {
    const el = document.createElement('div');
    const active = brw.active.kind === 'group' && brw.active.id === g.id;
    el.className = `tab group-tab${active ? ' active' : ''}`;
    el.style.setProperty('--gcolor', g.color || '#1A73E8');
    el.dataset.id = g.id;
    el.draggable = true;
    el.title = `Grup „${g.name}” · ${g.panes.length} ferestre`;
    el.innerHTML = `<span class="group-dot"></span><span class="tab-title">${NX.esc(g.name)}</span><span class="group-count">${g.panes.length}</span>`;
    el.addEventListener('click', () => { brw.active = { kind: 'group', id: g.id }; app.commit(); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.groupMenu(app, brw, g, e.clientX, e.clientY); });
    this.dragHandlers(app, brw, el, { kind: 'group', id: g.id });
    return el;
  },

  // §3 Tragere si plasare
  dragHandlers(app, brw, el, item) {
    el.addEventListener('dragstart', (e) => { this.dragId = item; e.dataTransfer.setData('text/netor-tab', JSON.stringify(item)); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { this.dragId = null; el.classList.remove('dragging'); });
    el.addEventListener('dragover', (e) => { if (this.dragId) { e.preventDefault(); el.classList.add('drop-before'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-before');
      const src = this.dragId;
      if (!src || src.id === item.id) return;
      if (item.kind === 'group' && src.kind === 'tab') { window.NetorActions.addToGroup(src.id, item.id, brw); return; }
      const ids = (x) => (x.kind === 'tab' ? [x.id] : brw.tabs.filter((t) => t.groupId === x.id).map((t) => t.id));
      const moving = ids(src).map((id) => brw.tabs.find((t) => t.id === id));
      brw.tabs = brw.tabs.filter((t) => !moving.includes(t));
      const anchor = brw.tabs.findIndex((t) => ids(item).includes(t.id));
      brw.tabs.splice(anchor < 0 ? brw.tabs.length : anchor, 0, ...moving);
      app.commit({ stage: false });
    });
  },

  // §4 Redenumire inline
  renameInput(app, el, tab) {
    const inp = document.createElement('input');
    inp.className = 'tab-rename';
    inp.value = tab.customTitle || tab.title || '';
    inp.placeholder = 'Nume tab (gol = titlul paginii)';
    el.appendChild(inp);
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) tab.customTitle = inp.value.trim();
      this.renaming = null;
      app.commit({ stage: false });
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('mousedown', (e) => e.stopPropagation());
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
  },

  // §5 Meniuri contextuale
  tabMenu(app, brw, tab, x, y) {
    const A = window.NetorActions;
    const groups = brw.groups.map((g) => ({ label: g.name, icon: '●', checked: tab.groupId === g.id, onClick: () => A.addToGroup(tab.id, g.id, brw) }));
    const moveTo = app.state.browsers.map((b) => ({
      label: `${b.icon || ''} ${b.name}${b.id === brw.id ? ' (curent)' : ''}`,
      submenu: [{ label: b.id === brw.id ? 'Scoate din grup' : `Direct în „${b.name}”`, icon: '→', onClick: () => A.moveTab(tab.id, b.id, '') },
        ...(b.groups.length ? [{ separator: true }, { header: 'În grupul' }] : []),
        ...b.groups.map((g) => ({ label: g.name, icon: '●', onClick: () => A.moveTab(tab.id, b.id, g.id) }))],
    }));
    const others = app.stripTabs(brw).filter((t) => t.id !== tab.id && !t.pinned);
    NX.showMenu([
      { label: 'Tab nou în dreapta', icon: '+', onClick: () => A.openTab({}) },
      tab.type === 'web' && { label: 'Reîncarcă', hint: 'Ctrl+R', onClick: () => window.NetorWV.cmd(tab.id, 'reload') },
      tab.type === 'web' && { label: 'Duplică', onClick: () => A.duplicateTab(tab.id) },
      { separator: true },
      { label: tab.pinned ? 'Anulează fixarea (Unpin)' : 'Fixează (Pin)', icon: '📌', onClick: () => { tab.pinned = !tab.pinned; app.commit({ stage: false }); } },
      { label: 'Redenumește…', icon: '✎', onClick: () => { this.renaming = tab.id; this.render(app); } },
      { label: 'Grup', icon: '▦', submenu: [{ label: 'Creează grup nou…', icon: '+', onClick: () => A.createGroup(tab.id) }, ...(groups.length ? [{ separator: true }, ...groups] : [])] },
      { label: 'Mută în', icon: '⇄', submenu: moveTo },
      tab.type === 'web' && { label: 'Proxy pentru acest tab…', icon: '🛡', onClick: () => window.NetorMinibar.tabProxyModal(app, brw, tab) },
      { separator: true },
      tab.type === 'web' && { label: tab.audible ? 'Oprește sunetul' : 'Sunet', disabled: !tab.audible, onClick: () => { const r = window.NetorWV.get(tab.id); if (r) r.wv.setAudioMuted(!r.wv.isAudioMuted()); } },
      { label: 'Închide', hint: 'Ctrl+W', danger: true, onClick: () => A.closeTab(tab.id) },
      others.length && { label: 'Închide celelalte taburi', onClick: () => others.forEach((t) => A.closeTab(t.id)) },
      { label: 'Redeschide tabul închis', hint: 'Ctrl+Shift+T', disabled: !brw.closedTabs.length, onClick: () => A.reopenTab() },
    ], x, y);
  },

  arrange(app, brw, g, tip) {
    brw.active = { kind: 'group', id: g.id };
    window.NetorStage.arrange(app, g, tip);
  },

  groupMenu(app, brw, g, x, y) {
    const A = window.NetorActions;
    const colors = ['#1A73E8', '#0F9D58', '#F4B400', '#DB4437', '#7C3AED', '#EC4899', '#14B8A6', '#F97316', '#64748B'];
    NX.showMenu([
      { label: 'Redenumește grupul…', icon: '✎', onClick: async () => { const n = await NX.askText({ title: 'Redenumește grupul', label: 'Nume', value: g.name }); if (n) { g.name = n.trim(); app.commit({ stage: false }); } } },
      { label: 'Culoare', icon: '●', submenu: colors.map((c) => ({ html: `<span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${c}"></span>`, checked: g.color === c, onClick: () => { g.color = c; app.commit({ stage: false }); } })) },
      { label: 'Aranjează ferestrele', icon: '▦', submenu: [
        { label: 'Grilă (2×2, 3×3…)', onClick: () => this.arrange(app, brw, g, 'grid') },
        { label: 'Coloane alăturate', onClick: () => this.arrange(app, brw, g, 'columns') },
        { label: 'Rânduri una sub alta', onClick: () => this.arrange(app, brw, g, 'rows') },
        { label: 'Una mare în stânga, restul în dreapta', onClick: () => this.arrange(app, brw, g, 'main') },
        { separator: true }, { label: 'Trage de bara unei ferestre ca s-o muți; trage de margini ca s-o redimensionezi; las-o peste mijlocul alteia ca să schimbați locurile.', disabled: true }] },
      { separator: true },
      { label: 'Adaugă tab web nou în grup', icon: '+', onClick: () => A.openTab({ groupId: g.id }) },
      { label: 'Adaugă notă nouă în grup', icon: '📝', onClick: () => window.NetorNotes.createInGroup(app, g.id) },
      { label: 'Adaugă fereastra de agenți în grup', icon: '🤖', onClick: () => window.NetorAgents.openAsTab(app, '', g.id) },
      { label: 'Adaugă agent nou în grup', icon: '+', onClick: () => window.NetorAgents.createInGroup(app, g.id) },
      { separator: true },
      { label: 'Desface grupul (păstrează taburile)', onClick: () => A.ungroup(g.id, false) },
      { label: 'Închide grupul și taburile lui', danger: true, onClick: () => A.ungroup(g.id, true) },
    ], x, y);
  },
};
