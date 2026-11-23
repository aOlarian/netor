/* MAP
 * Scop: Gestiunea webview-urilor (motorul Chromium al fiecarui tab web). Webview-urile stau toate intr-un
 *       singur strat si NU se muta in DOM (mutarea reincarca pagina); se pozitioneaza peste locul panoului
 *       din scena. Tine starea fiecarui tab (incarcare, favicon, inapoi/inainte, zoom) si leaga evenimentele.
 *       Taburile pe care lucreaza un agent in fundal raman treze (randate, nevazute), chiar in alt browser.
 * Legaturi: stage.js (layout), app.js, autofill.js (mesaje din pagina), tabstrip.js
 * Sectiuni:
 *   §1 Creare si incarcare
 *   §2 Evenimente webview
 *   §3 Pozitionare peste panouri
 *   §4 Distrugere si comenzi
 */

window.NetorWV = {
  map: new Map(), // tabId -> { wv, wcId, partition, loading, canBack, canFwd, zoom, browserId }
  awakeBy: new Map(), // agentId -> Set(tabId): taburi tinute treze de agentii care lucreaza in fundal

  // §1 Creare si incarcare
  async ensure(app, brw, tab) {
    const cur = this.map.get(tab.id);
    if (cur) return cur;
    const rec = { wv: null, wcId: 0, partition: '', loading: true, canBack: false, canFwd: false, zoom: 1, browserId: brw.id };
    rec.ready = new Promise((res) => { rec.markReady = res; });
    this.map.set(tab.id, rec);
    const browser = { id: brw.id, allPrivate: !!brw.allPrivate, proxy: brw.proxy, adblock: brw.adblock, downloadDir: brw.downloadDir };
    const prep = await window.netorAPI.prepareTab({ browserId: brw.id, browser, tab });
    rec.partition = prep.partition;
    const wv = document.createElement('webview');
    wv.setAttribute('partition', prep.partition);
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('webpreferences', 'spellcheck=yes');
    wv.dataset.tabId = tab.id;
    wv.className = 'wv-hidden';
    wv.src = this.srcFor(tab.url);
    rec.wv = wv;
    this.bindEvents(app, tab.id, rec);
    document.getElementById('webviewLayer').appendChild(wv);
    this.layout();
    return rec;
  },

  srcFor(url) {
    return url && url !== 'about:blank' ? url : url === 'about:blank' ? 'about:blank' : 'netor://newtab';
  },

  async load(app, brw, tab, url) {
    const rec = await this.ensure(app, brw, tab);
    if (rec.wcId) rec.wv.loadURL(url).catch(() => {});
    else rec.wv.src = url;
  },

  // §2 Evenimente webview
  bindEvents(app, tabId, rec) {
    const wv = rec.wv;
    const tab = () => app.tabById(tabId).tab;
    const update = (stripOnly) => { window.NetorTabstrip.updateTab(app, tabId); if (!stripOnly) window.NetorStage.updateBar(app, tabId); };
    // Inregistrarea tab<->webContents se face la atasare (inaintea primei navigari), ca istoricul si comenzile sa-l vada
    const register = async () => {
      if (rec.wcId) return;
      rec.wcId = wv.getWebContentsId();
      await window.netorAPI.registerTab({ wcId: rec.wcId, tabId, browserId: rec.browserId });
      rec.markReady(rec);
    };
    wv.addEventListener('did-attach', register);
    wv.addEventListener('dom-ready', () => { register(); wv.setZoomFactor(rec.zoom); });
    wv.addEventListener('did-start-loading', () => { rec.loading = true; update(); });
    wv.addEventListener('did-stop-loading', () => {
      rec.loading = false;
      rec.canBack = wv.canGoBack();
      rec.canFwd = wv.canGoForward();
      update();
    });
    const nav = (url) => {
      const t = tab();
      if (!t) return;
      t.url = url.startsWith('netor://newtab') ? 'netor://newtab' : url;
      rec.canBack = wv.canGoBack();
      rec.canFwd = wv.canGoForward();
      app.save();
      update();
    };
    wv.addEventListener('did-navigate', (e) => nav(e.url));
    wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) nav(e.url); });
    wv.addEventListener('page-title-updated', (e) => { const t = tab(); if (t) { t.title = e.title; app.save(); update(true); } });
    wv.addEventListener('page-favicon-updated', (e) => { const t = tab(); if (t && e.favicons && e.favicons[0]) { t.favicon = e.favicons[0]; app.save(); update(true); } });
    wv.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3 || !e.isMainFrame) return;
      const t = tab();
      if (t) { t.title = 'Pagina nu s-a încărcat'; update(true); }
      wv.executeJavaScript(`document.documentElement.innerHTML = ${JSON.stringify(errorPage(e))}`).catch(() => {});
    });
    wv.addEventListener('focus', () => window.NetorStage.setFocused(app, tabId));
    wv.addEventListener('ipc-message', (e) => window.NetorAutofill.onPageMessage(app, tabId, rec, e.channel, e.args && e.args[0]));
    wv.addEventListener('media-started-playing', () => { const t = tab(); if (t) { t.audible = true; update(true); } });
    wv.addEventListener('media-paused', () => { const t = tab(); if (t) { t.audible = false; update(true); } });
    wv.addEventListener('enter-html-full-screen', () => document.body.classList.add('fullscreen'));
    wv.addEventListener('leave-html-full-screen', () => document.body.classList.remove('fullscreen'));
  },

  // §3 Pozitionare peste panouri; taburile treze ale agentilor raman randate, practic invizibile (vezi .wv-awake)
  isAwake(tabId) {
    for (const set of this.awakeBy.values()) if (set.has(tabId)) return true;
    return false;
  },

  async wake(app, agentId, tabIds) {
    const set = this.awakeBy.get(agentId) || new Set();
    this.awakeBy.set(agentId, set);
    const waits = [];
    for (const id of tabIds || []) {
      const { brw, tab } = app.tabById(id);
      if (!tab || tab.type !== 'web') continue;
      set.add(id);
      const rec = await this.ensure(app, brw, tab);
      waits.push(Promise.race([rec.ready, new Promise((r) => setTimeout(r, 10000))]));
    }
    await Promise.all(waits);
    this.layout();
    return { ok: true, awake: Array.from(set) };
  },

  sleep(agentId) {
    this.awakeBy.delete(agentId);
    this.layout();
    return { ok: true };
  },

  layout() {
    const stage = document.getElementById('stage');
    const sr = stage.getBoundingClientRect();
    const slots = new Map(Array.from(document.querySelectorAll('[data-wv-slot]')).map((s) => [s.dataset.wvSlot, s]));
    for (const [tabId, rec] of this.map) {
      if (!rec.wv) continue;
      const slot = slots.get(tabId);
      if (!slot) {
        // Treaz = vizibil pentru Chromium (randare reala, la marimea scenei), dar nevazut si fara mouse
        const awake = this.isAwake(tabId);
        rec.wv.classList.toggle('wv-hidden', !awake);
        rec.wv.classList.toggle('wv-awake', awake);
        if (awake) Object.assign(rec.wv.style, { left: '0px', top: '0px', width: `${sr.width}px`, height: `${sr.height}px` });
        continue;
      }
      rec.wv.classList.remove('wv-awake');
      const r = slot.getBoundingClientRect();
      const full = document.body.classList.contains('fullscreen');
      Object.assign(rec.wv.style, full
        ? { left: `${-sr.left}px`, top: `${-sr.top}px`, width: '100vw', height: '100vh' }
        : { left: `${r.left - sr.left}px`, top: `${r.top - sr.top}px`, width: `${Math.max(0, r.width)}px`, height: `${Math.max(0, r.height)}px` });
      rec.wv.classList.remove('wv-hidden');
    }
  },

  // §4 Distrugere si comenzi
  destroy(tabId, wipe) {
    const rec = this.map.get(tabId);
    if (!rec) return;
    this.map.delete(tabId);
    if (rec.wv) rec.wv.remove();
    // Doar partitiile proprii tabului (izolat/privat) se golesc; cea comuna a browserului ramane
    if (wipe && rec.partition && rec.partition.includes(tabId)) window.netorAPI.clearPartition({ partition: rec.partition });
  },

  get(tabId) { return this.map.get(tabId) || null; },

  cmd(tabId, action) {
    const rec = this.map.get(tabId);
    if (!rec || !rec.wv || !rec.wcId) return;
    const wv = rec.wv;
    const zoomSteps = [0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    if (action === 'back' && wv.canGoBack()) wv.goBack();
    if (action === 'forward' && wv.canGoForward()) wv.goForward();
    if (action === 'reload') { if (rec.loading) wv.stop(); else wv.reload(); }
    if (action === 'hardReload') wv.reloadIgnoringCache();
    if (action === 'devtools') { if (wv.isDevToolsOpened()) wv.closeDevTools(); else wv.openDevTools(); }
    if (action === 'print') wv.print();
    if (action === 'focus') wv.focus();
    if (/^zoom/.test(action)) {
      const i = zoomSteps.findIndex((z) => z >= rec.zoom - 0.001);
      rec.zoom = action === 'zoomReset' ? 1 : zoomSteps[Math.max(0, Math.min(zoomSteps.length - 1, i + (action === 'zoomIn' ? 1 : -1)))];
      wv.setZoomFactor(rec.zoom);
    }
  },
};

function errorPage(e) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<head><title>Pagina nu s-a încărcat</title><style>body{font:15px Segoe UI,sans-serif;color:#3c4043;display:grid;place-items:center;height:90vh;margin:0}
    div{max-width:560px}h1{font-size:22px;font-weight:500}code{color:#80868b}</style></head><body><div><h1>Pagina nu a putut fi încărcată</h1>
    <p>${esc(e.validatedURL)}</p><p>Verifică adresa, conexiunea la internet sau setările de proxy ale acestui browser.</p><code>${esc(e.errorDescription)} (${e.errorCode})</code></div></body>`;
}
