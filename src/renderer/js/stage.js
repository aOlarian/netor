/* MAP
 * Scop: Scena de continut: un singur panou (tabul activ) sau ferestrele unui grup, asezate liber ca in
 *       Nex Remote (mutate de bara, redimensionate din margini, schimbate intre ele, marite, asezari gata facute). Fiecare panou web are bara lui: inapoi/inainte/reincarca, bara de
 *       adrese (singura din fereastra), stea favorite, date/sloturi, zoom; in modul "pe aceeasi linie"
 *       favoritele stau in dreapta barei. Panourile de nota/agent primesc editorul/chatul.
 * Legaturi: webviews.js (pozitionare), group-geom.js, group-drag.js, favorites.js, notes.js, agents.js, app-actions.js, url-suggest (aici §4)
 * Sectiuni:
 *   §1 Randare panouri si ferestrele grupului
 *   §2 Bara panoului web
 *   §3 Focus, actualizari, cautare in pagina
 *   §4 Sugestii in bara de adrese
 */

window.NetorStage = {
  focusedTabId: '',
  structKey: '',

  bind(app) {
    const ro = new ResizeObserver(() => window.NetorWV.layout());
    ro.observe(document.getElementById('stage'));
    window.addEventListener('resize', () => window.NetorWV.layout());
    window.netorEvents.on('found', (r) => this.updateFind(r));
  },

  // §1 Randare panouri: tab unic sau ferestrele grupului (muchii in fractii, trase ca in Nex Remote)
  render(app) {
    const brw = app.activeBrowser();
    const it = app.activeItem(brw);
    const layer = document.getElementById('paneLayer');
    const g = it.kind === 'group' ? it.group : null;
    if (g && window.NetorGroupGeom.normalizeaza(g)) app.save();
    if (g && g.maxTabId && !g.panes.some((p) => p.tabId === g.maxTabId)) g.maxTabId = '';
    const tabs = app.visibleTabs(brw);
    const mode = app.favoritesMode(brw);
    const key = JSON.stringify([brw.id, it.kind, g ? [g.id, g.panes.map((p) => p.tabId), g.maxTabId || ''] : it.tab && it.tab.id, mode, tabs.map((t) => t.type + (t.type === 'agent' ? '' : t.refId))]);
    for (const t of tabs) if (t.type === 'web' && !window.NetorWV.get(t.id)) window.NetorWV.ensure(app, brw, t);
    if (key === this.structKey) { tabs.forEach((t) => this.updateBar(app, t.id)); if (g) this.place(g); window.NetorWV.layout(); return; }
    this.structKey = key;
    layer.innerHTML = '';
    layer.classList.toggle('windows', !!g);
    if (!tabs.some((t) => t.id === this.focusedTabId)) this.focusedTabId = (tabs.find((t) => t.type === 'web') || tabs[0] || {}).id || '';
    for (const tab of tabs) {
      const pane = this.pane(app, brw, tab, g, mode === 'same' && it.kind === 'tab');
      if (g) this.bindWindow(app, g, tab, pane);
      layer.appendChild(pane);
    }
    if (g) this.place(g);
    if (!tabs.length) layer.innerHTML = '<div class="empty-stage">Niciun tab deschis. Apasă + pentru un tab nou.</div>';
    requestAnimationFrame(() => window.NetorWV.layout());
  },

  // Pozitia fiecarei ferestre, in procente din scena: muchiile comune raman pe acelasi pixel
  place(g) {
    const pct = (v) => `${(v * 100).toFixed(4)}%`;
    for (const p of g.panes) {
      const el = document.querySelector(`#paneLayer > .pane[data-tab-id="${p.tabId}"]`);
      if (!el) continue;
      const max = g.maxTabId === p.tabId;
      const r = max ? { l: 0, t: 0, r: 1, b: 1 } : p.rect;
      el.classList.toggle('hidden', !!g.maxTabId && !max);
      el.classList.toggle('maxed', max);
      Object.assign(el.style, { left: pct(r.l), top: pct(r.t), width: pct(r.r - r.l), height: pct(r.b - r.t) });
    }
    window.NetorWV.layout();
  },

  windowApi(app, g) {
    const layer = document.getElementById('paneLayer');
    const byId = (id) => g.panes.find((p) => p.tabId === id);
    return {
      container: layer,
      panouri: () => g.panes.filter((p) => p.rect),
      nod: (id) => layer.querySelector(`.pane[data-tab-id="${id}"]`),
      ridica: (id, on) => { const r = window.NetorWV.get(id); if (r && r.wv) r.wv.style.zIndex = on ? '5' : ''; document.getElementById('winOverlay').classList.toggle('hidden', !on); },
      // Stratul de deasupra webview-urilor: conturul ferestrei trase si locul de schimb raman vizibile peste pagini
      contur: (cls, r) => { const el = document.querySelector(`#winOverlay .${cls}`); el.classList.toggle('hidden', !r); if (r) Object.assign(el.style, { left: `${r.l}px`, top: `${r.t}px`, width: `${r.r - r.l}px`, height: `${r.b - r.t}px` }); },
      comite: (map) => { for (const [id, f] of map) { const p = byId(id); if (p) p.rect = f; } this.place(g); app.save(); },
      schimba: (a, b) => { const pa = byId(a); const pb = byId(b); [pa.rect, pb.rect] = [pb.rect, pa.rect]; this.place(g); app.save(); },
    };
  },

  // Bara ferestrei muta fereastra (din spatiul liber), dublu-clic o mareste; marginile o redimensioneaza
  bindWindow(app, g, tab, pane) {
    const free = (t) => !t.closest('button, input, select, textarea, .urlbox, .fav-inline, a');
    const bar = pane.querySelector('.pane-bar');
    bar.addEventListener('pointerdown', (e) => { this.setFocused(app, tab.id); if (!g.maxTabId && free(e.target)) window.NetorGroupDrag.muta(e, tab.id, this.windowApi(app, g)); });
    bar.addEventListener('dblclick', (e) => { if (free(e.target)) this.toggleMax(app, g, tab.id); });
    const MUCHII = { n: { t: 1 }, s: { b: 1 }, e: { r: 1 }, w: { l: 1 }, ne: { t: 1, r: 1 }, nw: { t: 1, l: 1 }, se: { b: 1, r: 1 }, sw: { b: 1, l: 1 } };
    for (const [k, m] of Object.entries(MUCHII)) {
      const h = document.createElement('div');
      h.className = `win-edge e-${k}`;
      h.addEventListener('pointerdown', (e) => { if (!g.maxTabId) window.NetorGroupDrag.redimensioneaza(e, tab.id, m, this.windowApi(app, g)); });
      pane.appendChild(h);
    }
  },

  toggleMax(app, g, tabId) {
    g.maxTabId = g.maxTabId === tabId ? '' : tabId;
    this.focusedTabId = tabId;
    app.commit();
  },

  arrange(app, g, tip) {
    const r = window.NetorGroupGeom.asezare(tip, g.panes.length);
    g.panes.forEach((p, i) => { p.rect = r[i]; });
    g.maxTabId = '';
    app.commit();
  },

  pane(app, brw, tab, group, sameLine) {
    const pane = document.createElement('div');
    pane.className = `pane${tab.id === this.focusedTabId && group ? ' focused' : ''}`;
    pane.dataset.tabId = tab.id;
    pane.addEventListener('mousedown', () => this.setFocused(app, tab.id));
    const grip = group ? `<span class="win-grip" title="Trage ca să muți fereastra; dublu-clic o mărește">${IC('grip', 15)}</span>` : '';
    const groupBtns = group ? `<button class="icon-btn" data-act="max" title="${group.maxTabId === tab.id ? 'Readu fereastra în grup' : 'Mărește fereastra în grup (dublu-clic pe bară)'}">${IC(group.maxTabId === tab.id ? 'layout' : 'maximize', 15)}</button>
      <button class="icon-btn" data-act="solo" title="Scoate din grup (tab separat)">${IC('layers', 15)}</button>
      <button class="icon-btn" data-act="close" title="Închide fereastra din grup">${IC('close', 15)}</button>` : '';
    if (tab.type === 'web') {
      pane.innerHTML = `<div class="pane-bar${sameLine ? ' same-line' : ''}">${grip}
        <button class="icon-btn" data-act="back" title="Înapoi (Alt+←)">${IC('back')}</button>
        <button class="icon-btn" data-act="forward" title="Înainte (Alt+→)">${IC('forward')}</button>
        <button class="icon-btn" data-act="reload" title="Reîncarcă (F5)">${IC('reload')}</button>
        <div class="urlbox"><span class="url-secure"></span><input class="url-input" spellcheck="false" placeholder="Caută sau scrie o adresă">
          <span class="zoom-chip hidden" data-act="zoomReset" title="Resetează zoom"></span>
          <button class="icon-btn" data-act="star" title="Adaugă la favorite (Ctrl+D)">${IC('star', 15)}</button>
          <button class="icon-btn" data-act="data" title="Fereastra de date și sloturi">${IC('slots', 15)}</button></div>
        ${sameLine ? '<div class="fav-inline"></div>' : ''}${groupBtns}</div>
        <div class="pane-body" data-wv-slot="${tab.id}"></div>`;
      this.bindBar(app, brw, tab, pane);
      if (sameLine) window.NetorFavorites.renderInto(app, pane.querySelector('.fav-inline'));
    } else {
      const title = tab.type === 'note' ? window.NetorNotes.title(app, tab.refId) : window.NetorAgents.paneTitle(app, tab);
      pane.innerHTML = `<div class="pane-bar">${grip}<span class="pane-icon">${IC(tab.type === 'note' ? 'notes' : 'agent')}</span>
        <span class="pane-title">${NX.esc(tab.customTitle || title)}</span>${groupBtns}</div><div class="pane-body"></div>`;
      const body = pane.querySelector('.pane-body');
      if (tab.type === 'note') window.NetorNotes.mountEditor(app, body, tab.refId);
      else window.NetorAgents.mountPane(app, body, tab, brw.id);
    }
    pane.querySelectorAll('[data-act="solo"],[data-act="close"],[data-act="max"]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.dataset.act === 'max') this.toggleMax(app, group, tab.id);
      else if (b.dataset.act === 'solo') window.NetorActions.removeFromGroup(tab.id); else window.NetorActions.closeTab(tab.id);
    }));
    return pane;
  },

  // §2 Bara panoului web
  bindBar(app, brw, tab, pane) {
    const inp = pane.querySelector('.url-input');
    pane.querySelector('.pane-bar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || ['solo', 'close', 'max'].includes(b.dataset.act)) return;
      const act = b.dataset.act;
      if (act === 'star') window.NetorFavorites.toggleCurrent(app, tab, b);
      else if (act === 'data') window.NetorAutofill.openDataWindow(app);
      else window.NetorWV.cmd(tab.id, act);
      if (/zoom/.test(act)) this.updateBar(app, tab.id);
    });
    inp.addEventListener('focus', () => { inp.select(); this.setFocused(app, tab.id); });
    inp.addEventListener('keydown', (e) => {
      if (this.suggestKey(e, inp)) return;
      if (e.key === 'Enter') { window.NetorActions.navigate(tab.id, inp.value); this.closeSuggest(); window.NetorWV.cmd(tab.id, 'focus'); }
      if (e.key === 'Escape') { inp.value = displayUrl(tab.url); inp.blur(); this.closeSuggest(); }
    });
    inp.addEventListener('input', () => this.suggest(app, tab, inp));
    inp.addEventListener('blur', () => setTimeout(() => this.closeSuggest(), 150));
    this.updateBar(app, tab.id, pane);
  },

  // §3 Focus, actualizari, cautare in pagina
  updateBar(app, tabId, paneEl) {
    const pane = paneEl || document.querySelector(`.pane[data-tab-id="${tabId}"]`);
    const { tab } = app.tabById(tabId);
    if (!pane || !tab || tab.type !== 'web') return;
    const rec = window.NetorWV.get(tabId) || {};
    const inp = pane.querySelector('.url-input');
    if (document.activeElement !== inp) inp.value = displayUrl(tab.url);
    const q = (s) => pane.querySelector(`[data-act="${s}"]`);
    q('back').disabled = !rec.canBack;
    q('forward').disabled = !rec.canFwd;
    q('reload').innerHTML = rec.loading ? IC('stop') : IC('reload');
    const secure = /^https:/.test(tab.url || '');
    pane.querySelector('.url-secure').innerHTML = /^netor:/.test(tab.url || '') ? IC('search', 13) : secure ? IC('lock', 13) : IC('info', 13);
    pane.querySelector('.url-secure').title = secure ? 'Conexiune securizată (HTTPS)' : 'Conexiune nesecurizată';
    const isFav = app.state.favorites.some((f) => f.type === 'link' && f.url === tab.url);
    q('star').innerHTML = IC(isFav ? 'starOn' : 'star', 15);
    q('star').classList.toggle('active', isFav);
    const z = q('zoomReset');
    z.classList.toggle('hidden', !rec.zoom || Math.abs(rec.zoom - 1) < 0.01);
    z.textContent = `${Math.round((rec.zoom || 1) * 100)}%`;
  },

  setFocused(app, tabId) {
    if (this.focusedTabId === tabId) return;
    this.focusedTabId = tabId;
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('focused', p.dataset.tabId === tabId && document.querySelectorAll('.pane').length > 1));
  },

  focusUrl(tabId) {
    const id = tabId || this.focusedTabId;
    const inp = document.querySelector(`.pane[data-tab-id="${id}"] .url-input`) || document.querySelector('.url-input');
    if (inp) { inp.focus(); inp.select(); }
  },

  openFind(app) {
    const tab = app.focusedTab();
    if (!tab || tab.type !== 'web') return;
    const bar = document.getElementById('findbar');
    bar.classList.remove('hidden');
    bar.innerHTML = `<input class="inp" placeholder="Caută în pagină"><span class="find-count"></span>
      <button class="icon-btn" data-d="0" title="Anterior">↑</button><button class="icon-btn" data-d="1" title="Următor">↓</button><button class="icon-btn" data-x title="Închide">${IC('close', 15)}</button>`;
    const inp = bar.querySelector('input');
    const wv = window.NetorWV.get(tab.id).wv;
    const find = (forward, findNext) => { if (inp.value) wv.findInPage(inp.value, { forward, findNext }); else wv.stopFindInPage('clearSelection'); };
    inp.addEventListener('input', () => find(true, false));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') find(!e.shiftKey, true); if (e.key === 'Escape') close(); });
    bar.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => find(b.dataset.d === '1', true)));
    const close = () => { wv.stopFindInPage('clearSelection'); bar.classList.add('hidden'); };
    bar.querySelector('[data-x]').addEventListener('click', close);
    inp.focus();
  },

  updateFind(r) {
    const c = document.querySelector('#findbar .find-count');
    if (c) c.textContent = r.total ? `${r.active}/${r.total}` : '0/0';
  },

  // §4 Sugestii in bara de adrese
  async suggest(app, tab, inp) {
    const q = inp.value.trim();
    this.closeSuggest();
    if (!q) return;
    const favs = app.state.favorites.filter((f) => f.type === 'link' && (f.title.toLowerCase().includes(q.toLowerCase()) || f.url.includes(q))).slice(0, 3);
    const hist = await window.netorAPI.historyQuery({ q, limit: 7 });
    const rows = [{ url: window.NetorActions.resolveInput(app, q), title: q, kind: 'go' }, ...favs.map((f) => ({ ...f, kind: 'fav' })),
      ...(Array.isArray(hist) ? hist : []).filter((h) => !favs.some((f) => f.url === h.url)).map((h) => ({ ...h, kind: 'hist' }))];
    const box = document.createElement('div');
    box.className = 'url-suggest';
    box.innerHTML = rows.map((r, i) => `<div class="sg${i === 0 ? ' on' : ''}" data-url="${NX.esc(r.url)}">${IC(r.kind === 'fav' ? 'starOn' : r.kind === 'hist' ? 'history' : 'search', 14)}
      <span>${NX.esc(r.title || r.url)}</span><small>${r.kind === 'go' ? '' : NX.esc(r.url)}</small></div>`).join('');
    box.addEventListener('mousedown', (e) => { const s = e.target.closest('.sg'); if (s) { e.preventDefault(); window.NetorActions.navigate(tab.id, s.dataset.url); this.closeSuggest(); inp.blur(); } });
    inp.parentElement.appendChild(box);
  },

  suggestKey(e, inp) {
    const box = inp.parentElement.querySelector('.url-suggest');
    if (!box || !['ArrowDown', 'ArrowUp'].includes(e.key)) return false;
    e.preventDefault();
    const items = Array.from(box.querySelectorAll('.sg'));
    const i = items.findIndex((x) => x.classList.contains('on'));
    const n = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((x, k) => x.classList.toggle('on', k === n));
    inp.value = items[n].dataset.url;
    return true;
  },

  closeSuggest() { document.querySelectorAll('.url-suggest').forEach((b) => b.remove()); },
};

function displayUrl(url) {
  return !url || url.startsWith('netor://newtab') || url === 'about:blank' ? '' : url;
}
