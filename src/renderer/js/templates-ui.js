/* MAP
 * Scop: Panoul "Sabloane de automatizare": lista sabloanelor, rulare (intr-un browser nou din minibar),
 *       monitorul rularii (progres, pauza, reparare pas prin "alege elementul in pagina", stop, fisier rezultat),
 *       inregistrarea pasilor din tabul activ si import/export JSON.
 * Legaturi: template-editor.js (editorul), src/main/automation.js (evenimente netor:template-event), preload-page.js
 * Sectiuni:
 *   §1 Panoul lateral si lista
 *   §2 Rulare si monitor
 *   §3 Inregistrare pasi si alegere element
 */

window.NetorTemplates = {
  runs: {},
  recording: null, // { tabId, templateId, onStep }
  picking: null,   // { runId, tabId }

  // §1 Panoul lateral si lista
  openSidebar(app) {
    window.NetorTools.openSidebar(app, 'templates', 'Șabloane', (body, actions) => {
      actions.innerHTML = `<button class="icon-btn" data-new title="Șablon nou">${IC('plus', 16)}</button><button class="icon-btn" data-imp title="Importă JSON">${IC('download', 15)}</button>`;
      NX.$('[data-new]', actions).onclick = () => window.NetorTemplateEditor.open(app, null, () => this.renderList(app, body));
      NX.$('[data-imp]', actions).onclick = () => this.importJson(app, () => this.renderList(app, body));
      this.renderList(app, body);
    });
  },

  renderList(app, body) {
    const tpls = app.state.templates;
    body.innerHTML = `${tpls.length ? '' : '<div class="empty">Niciun șablon. Creează unul cu + sau înregistrează pașii dintr-un tab.</div>'}
      ${tpls.map((t) => `<div class="tpl-card" data-id="${t.id}"><div class="row"><b style="flex:1">${NX.esc(t.name)}</b>
        <button class="icon-btn" data-run title="Rulează">${IC('play', 15)}</button><button class="icon-btn" data-edit title="Editează">${IC('edit', 15)}</button>
        <button class="icon-btn" data-more>${IC('dots', 15)}</button></div>
        <small class="muted-text">${(t.steps || []).length} pași · ${(t.rules && t.rules.tabs) || 1} taburi · linkuri: ${NX.esc(((t.rules && t.rules.links) || {}).source || 'listă')}${t.rules && t.rules.output && t.rules.output.webhook ? ' · trimite la webhook' : ''}</small>
        <div data-run-box="${t.id}"></div></div>`).join('')}`;
    body.onclick = (e) => {
      const card = e.target.closest('.tpl-card');
      if (!card) return;
      const t = tpls.find((x) => x.id === card.dataset.id);
      if (e.target.closest('[data-run]')) this.run(app, t.id);
      if (e.target.closest('[data-edit]')) window.NetorTemplateEditor.open(app, t, () => this.renderList(app, body));
      if (e.target.closest('[data-more]')) NX.showMenu([
        { label: 'Duplică', onClick: () => { app.state.templates.push({ ...JSON.parse(JSON.stringify(t)), id: NX.uid('tpl'), name: `${t.name} (copie)` }); app.save(); this.renderList(app, body); } },
        { label: 'Copiază JSON', onClick: () => { window.netorAPI.clipboard({ text: JSON.stringify(t, null, 2) }); NX.toast('JSON copiat.'); } },
        { separator: true },
        { label: 'Șterge', danger: true, onClick: async () => { if (await NX.confirmBox({ title: 'Șterge șablonul', message: `Ștergi „${t.name}”?`, okLabel: 'Șterge', danger: true })) { app.state.templates = tpls.filter((x) => x.id !== t.id); app.save(); this.renderList(app, body); } } },
      ], e.clientX, e.clientY);
    };
    for (const [runId, r] of Object.entries(this.runs)) this.drawRun(runId, r);
  },

  async importJson(app, after) {
    const txt = await NX.askText({ title: 'Importă șablon', label: 'Lipește JSON-ul șablonului', okLabel: 'Importă' });
    if (!txt) return;
    try {
      const t = JSON.parse(txt);
      if (!Array.isArray(t.steps)) throw new Error('lipsesc pașii (steps)');
      app.state.templates.push({ ...t, id: NX.uid('tpl'), name: t.name || 'Șablon importat' });
      app.save();
      after();
    } catch (err) {
      NX.toast(`JSON invalid: ${err.message}`, 'error');
    }
  },

  // §2 Rulare si monitor
  async run(app, id) {
    const r = await window.netorAPI.templateRun({ templateId: id });
    if (!r || r.ok === false) { NX.toast(`Nu am putut porni: ${(r && r.error) || ''}`, 'error'); return; }
    this.runs[r.runId] = { templateId: id, status: 'pornit', done: 0, total: 0 };
    this.drawRun(r.runId, this.runs[r.runId]);
  },

  bindEvents(app) {
    window.netorEvents.on('template-event', (e) => {
      const r = this.runs[e.runId] || (this.runs[e.runId] = { templateId: e.templateId });
      if (e.type === 'started') Object.assign(r, { status: 'rulează', total: e.total, browserId: e.browserId });
      if (e.type === 'progress') Object.assign(r, { done: e.done, total: e.total, ok: e.ok, failed: e.failed, status: 'rulează', waiting: null });
      if (e.type === 'healed') NX.toast(`Pas reparat automat: ${e.selector}`);
      if (e.type === 'paused' || e.type === 'needs-repair') Object.assign(r, { status: e.type === 'paused' ? 'pauză' : 'necesită reparare', waiting: e });
      if (e.type === 'finished') Object.assign(r, { status: e.stopped ? 'oprit' : 'terminat', waiting: null, file: e.file, ok: e.ok, failed: e.failed, webhook: e.webhook });
      if (e.type === 'error') Object.assign(r, { status: `eroare: ${e.error}` });
      if (e.type === 'needs-repair') NX.toast('Un pas nu găsește elementul: alege-l în pagină din panoul Șabloane.', 'warn', 5000);
      this.drawRun(e.runId, r);
    });
  },

  drawRun(runId, r) {
    const box = document.querySelector(`[data-run-box="${r.templateId}"]`);
    if (!box) return;
    const pct = r.total ? Math.round(((r.done || 0) / r.total) * 100) : 0;
    box.innerHTML = `<div class="run-box"><div class="row"><b>${NX.esc(r.status || '')}</b><span class="grow"></span><span class="muted-text">${r.done || 0}/${r.total || 0} · ✓${r.ok || 0} ✗${r.failed || 0}</span></div>
      <div class="progress"><span style="width:${pct}%"></span></div>
      ${r.waiting ? `<div class="run-wait">${NX.esc(r.waiting.message)}<div class="row">${r.waiting.type === 'needs-repair' ? '<button class="btn small primary" data-pick>Alege elementul în pagină</button>' : '<button class="btn small primary" data-resume>Continuă</button>'}</div></div>` : ''}
      <div class="row">${/rulează|pauză|necesită/.test(r.status) ? '<button class="btn small danger" data-stop>Oprește</button>' : ''}
      ${r.file ? `<button class="btn small" data-file>Deschide rezultatul</button><span class="muted-text">${r.webhook ? `webhook: ${NX.esc(r.webhook)}` : ''}</span>` : ''}</div></div>`;
    box.onclick = (e) => {
      if (e.target.closest('[data-stop]')) window.netorAPI.templateStop({ runId });
      if (e.target.closest('[data-resume]')) window.netorAPI.templateResume({ runId });
      if (e.target.closest('[data-file]')) window.netorAPI.showItem({ path: r.file });
      if (e.target.closest('[data-pick]')) this.startPick(runId, r.waiting.tabId);
    };
  },

  // §3 Inregistrare pasi si alegere element
  startPick(runId, tabId) {
    const rec = window.NetorWV.get(tabId);
    if (!rec || !rec.wv) return;
    this.picking = { runId, tabId };
    window.NetorActions.activateTab(tabId);
    rec.wv.send('netor-host:pick');
    NX.toast('Dă clic pe elementul corect în pagină.');
  },

  startRecording(app, tabId, onStep) {
    const rec = window.NetorWV.get(tabId);
    if (!rec || !rec.wv) { NX.toast('Deschide întâi pagina de pornire într-un tab web.', 'warn'); return false; }
    this.recording = { tabId, onStep };
    rec.wv.send('netor-host:record', true);
    // Editorul se strange intr-un panou mic ca pagina sa ramana utilizabila cat timp inregistram
    document.getElementById('modalLayer').classList.add('recording');
    return true;
  },

  stopRecording() {
    if (!this.recording) return;
    const rec = window.NetorWV.get(this.recording.tabId);
    if (rec && rec.wv) rec.wv.send('netor-host:record', false);
    this.recording = null;
    document.getElementById('modalLayer').classList.remove('recording');
  },

  onPageEvent(app, tabId, channel, p) {
    if (channel === 'netor-page:picked' && this.picking && this.picking.tabId === tabId) {
      window.netorAPI.templateResume({ runId: this.picking.runId, picked: p });
      this.picking = null;
      NX.toast(`Element ales: ${p.selector}`);
    }
    if (channel === 'netor-page:record' && this.recording && this.recording.tabId === tabId) this.recording.onStep(p);
  },
};
