/* MAP
 * Scop: Editorul de sabloane: nume, reguli de rulare (numar taburi, pauza intre pasi, sursa linkurilor:
 *       lista / nota / fisier, proxy-uri per tab din lista, iesire JSON/CSV, webhook (ex. Veromaps),
 *       reparare cu AI) si lista de pasi (adaugare, editare, ordonare, stergere, inregistrare din tab).
 * Legaturi: templates-ui.js, settings.js (componente), src/main/automation.js (formatul pasilor)
 * Sectiuni:
 *   §1 Definitii actiuni
 *   §2 Fereastra editorului
 *   §3 Editarea unui pas
 */

// §1 Definitii actiuni
const STEP_TYPES = {
  navigate: ['Deschide adresa', [['url', 'Adresă ({{link}} = linkul curent)']]],
  click: ['Clic', [['selector', 'Selector CSS'], ['text', 'sau textul vizibil al elementului']]],
  type: ['Scrie text', [['selector', 'Selector CSS'], ['value', 'Text ({{link}}, {{index}})'], ['submit', 'Apasă Enter după', 'bool']]],
  select: ['Alege din listă', [['selector', 'Selector CSS'], ['value', 'Valoare sau text opțiune']]],
  wait: ['Așteaptă', [['ms', 'Milisecunde (dacă nu aștepți un element)', 'num'], ['selector', 'sau elementul (selector)'], ['text', 'sau textul'], ['timeoutMs', 'Timp maxim (ms)', 'num']]],
  extract: ['Extrage date', [['name', 'Nume coloană'], ['selector', 'Selector CSS'], ['attr', 'Ce extrag (text, href, src, value, html)'], ['multiple', 'Toate potrivirile', 'bool']]],
  scroll: ['Derulează', [['times', 'De câte ori', 'num'], ['dy', 'Pixeli pe derulare', 'num']]],
  upload: ['Încarcă fișier (fără fereastră)', [['selector', 'Selector input[type=file]'], ['value', 'Cale fișier (mai multe: separate cu |)', 'file']]],
  assert: ['Confirmă (verificare)', [['selector', 'Elementul trebuie să existe'], ['text', 'sau textul trebuie să apară'], ['timeoutMs', 'Timp maxim (ms)', 'num']]],
  pause: ['Pauză pentru mine', [['message', 'Mesaj (ex. rezolvă captcha și apasă Continuă)']]],
  repeat: ['Repetă (paginare)', [['times', 'Maximum repetări', 'num'], ['until', 'Cât timp există elementul (selector)'], ['stepsJson', 'Pași de repetat (JSON)', 'json']]],
};

const stepLabel = (s) => `${(STEP_TYPES[s.action] || [s.action])[0]}${s.selector || s.text || s.url || s.name ? ' · ' : ''}${s.name || s.url || s.text || s.selector || ''}`;

// §2 Fereastra editorului
window.NetorTemplateEditor = {
  open(app, tpl, after) {
    const t = JSON.parse(JSON.stringify(tpl || { id: NX.uid('tpl'), name: 'Șablon nou', steps: [], rules: {} }));
    t.rules = { tabs: 1, delayMs: 700, aiRepair: false, links: { source: 'list', list: '' }, proxies: { source: 'none', list: '' }, output: { format: 'json', webhook: '', webhookKey: '' }, ...t.rules };
    const S = window.NetorSettings;
    const R = t.rules;
    NX.openModal({
      title: tpl ? `Editează · ${t.name}` : 'Șablon nou', wide: true, className: 'tpl-editor',
      body: `<div class="tpl-grid"><div class="form-col">
        <label class="fld"><span>Nume</span><input class="inp" data-k="name" value="${NX.esc(t.name)}"></label>
        <div class="grid2"><label class="fld"><span>Taburi în paralel</span><input class="inp" type="number" min="1" max="12" data-k="tabs" value="${R.tabs}"></label>
          <label class="fld"><span>Pauză între pași (ms)</span><input class="inp" type="number" min="0" data-k="delayMs" value="${R.delayMs}"></label></div>
        <div class="fld"><span>De unde iau linkurile</span>${S.segHTML('ls', [['list', 'Listă'], ['note', 'Dintr-o notă'], ['file', 'Din fișier']], R.links.source)}</div>
        <textarea class="inp" data-k="linksList" rows="4" placeholder="un link pe rând">${NX.esc(R.links.list || '')}</textarea>
        <select class="inp hidden" data-k="linksNote">${app.state.notes.map((n) => `<option ${n.title === R.links.noteTitle ? 'selected' : ''}>${NX.esc(n.title)}</option>`).join('')}</select>
        <div class="hidden" data-lf>${S.folderField('lf', R.links.file || '', 'Alege fișierul .txt')}</div>
        <div class="fld"><span>Proxy pe fiecare tab</span>${S.segHTML('px', [['none', 'Fără (ca browserul)'], ['list', 'Din listă (rotativ)']], R.proxies.source)}</div>
        <textarea class="inp ${R.proxies.source === 'list' ? '' : 'hidden'}" data-k="proxyList" rows="3" placeholder="socks5://user:parola@host:port (unul pe rând)">${NX.esc(R.proxies.list || '')}</textarea>
        <div class="fld"><span>Rezultate</span>${S.segHTML('of', [['json', 'JSON'], ['csv', 'CSV (Excel)']], R.output.format)}</div>
        <label class="fld"><span>Trimite rezultatele la (webhook, ex. Veromaps)</span><input class="inp" data-k="webhook" value="${NX.esc(R.output.webhook || '')}" placeholder="https://…"></label>
        <label class="fld"><span>Cheie webhook (opțional)</span><input class="inp" type="password" data-k="webhookKey" value="${NX.esc(R.output.webhookKey || '')}"></label>
        <label class="switch"><span class="sw-text">Reparare automată cu AI<small>Când un selector nu mai merge, AI-ul alege elementul potrivit și actualizează pasul.</small></span><input type="checkbox" data-k="aiRepair" ${R.aiRepair ? 'checked' : ''}></label>
      </div><div class="form-col"><div class="row"><b style="flex:1">Pași</b><button class="btn small" data-rec>${IC('record', 12)} Înregistrează din tabul activ</button>
        <button class="btn small" data-add>${IC('plus', 13)} Pas</button></div><div class="step-list" data-steps></div></div></div>
        <div class="row-end"><button class="btn ghost" data-cancel>Anulează</button><button class="btn primary" data-ok>Salvează</button></div>`,
      onMount: (m) => {
        const b = m.body;
        const q = (k) => NX.$(`[data-k="${k}"]`, b);
        const showLinks = (v) => { q('linksList').classList.toggle('hidden', v !== 'list'); q('linksNote').classList.toggle('hidden', v !== 'note'); NX.$('[data-lf]', b).classList.toggle('hidden', v !== 'file'); };
        const ls = S.bindSeg(b, 'ls', R.links.source, showLinks);
        showLinks(R.links.source);
        const px = S.bindSeg(b, 'px', R.proxies.source, (v) => q('proxyList').classList.toggle('hidden', v !== 'list'));
        const of = S.bindSeg(b, 'of', R.output.format);
        S.bindFolderField(b, 'lf');
        NX.$('[data-lf] [data-pick]', b).onclick = async (e) => { e.stopPropagation(); const f = await window.netorAPI.pickFiles({ title: 'Fișier cu linkuri', filters: [{ name: 'Text', extensions: ['txt', 'csv'] }] }); if (f && f[0]) { NX.$('[data-folder="lf"]', b).dataset.value = f[0]; NX.$('[data-folder="lf"] .folder-path', b).textContent = f[0]; } };
        const draw = () => this.drawSteps(app, t, NX.$('[data-steps]', b), draw);
        draw();
        NX.$('[data-add]', b).onclick = () => this.editStep(app, { action: 'click' }, (s) => { t.steps.push(s); draw(); });
        NX.$('[data-rec]', b).onclick = (e) => {
          if (window.NetorTemplates.recording) { window.NetorTemplates.stopRecording(); e.currentTarget.innerHTML = `${IC('record', 12)} Înregistrează din tabul activ`; return; }
          const tab = app.focusedTab();
          const first = tab && tab.type === 'web' && tab.url && !t.steps.length ? [{ id: NX.uid('st'), action: 'navigate', url: tab.url }] : [];
          t.steps.push(...first);
          if (window.NetorTemplates.startRecording(app, tab && tab.id, (p) => { t.steps.push({ id: NX.uid('st'), ...p }); draw(); })) {
            e.currentTarget.innerHTML = `${IC('square', 12)} Oprește înregistrarea`;
            NX.toast('Înregistrez: lucrează în pagină (clicuri, câmpuri). Fereastra rămâne deschisă.');
          }
          draw();
        };
        NX.$('[data-cancel]', b).onclick = () => { window.NetorTemplates.stopRecording(); m.close(); };
        NX.$('[data-ok]', b).onclick = () => {
          window.NetorTemplates.stopRecording();
          t.name = q('name').value.trim() || 'Șablon';
          Object.assign(R, { tabs: Number(q('tabs').value) || 1, delayMs: Number(q('delayMs').value) || 0, aiRepair: q('aiRepair').checked,
            links: { source: ls(), list: q('linksList').value, noteTitle: q('linksNote').value, file: S.readFolderField(b, 'lf') },
            proxies: { source: px(), list: q('proxyList').value }, output: { format: of(), webhook: q('webhook').value.trim(), webhookKey: q('webhookKey').value } });
          const i = app.state.templates.findIndex((x) => x.id === t.id);
          if (i >= 0) app.state.templates[i] = t; else app.state.templates.push(t);
          app.save();
          m.close();
          if (after) after();
        };
      },
    });
  },

  drawSteps(app, t, host, redraw) {
    host.innerHTML = t.steps.length ? t.steps.map((s, i) => `<div class="step-row" data-i="${i}"><span class="slot-num">${i + 1}</span><span class="step-txt">${NX.esc(stepLabel(s))}</span>
      <button class="icon-btn" data-up title="Sus">↑</button><button class="icon-btn" data-down title="Jos">↓</button>
      <button class="icon-btn" data-edit title="Editează">${IC('edit', 14)}</button><button class="icon-btn" data-del title="Șterge">${IC('trash', 14)}</button></div>`).join('')
      : '<div class="empty">Niciun pas. Adaugă pași sau înregistrează-i din tab.</div>';
    host.onclick = (e) => {
      const row = e.target.closest('.step-row');
      if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.closest('[data-del]')) t.steps.splice(i, 1);
      else if (e.target.closest('[data-up]') && i > 0) [t.steps[i - 1], t.steps[i]] = [t.steps[i], t.steps[i - 1]];
      else if (e.target.closest('[data-down]') && i < t.steps.length - 1) [t.steps[i + 1], t.steps[i]] = [t.steps[i], t.steps[i + 1]];
      else if (e.target.closest('[data-edit]')) { this.editStep(app, t.steps[i], (s) => { t.steps[i] = s; redraw(); }); return; }
      else return;
      redraw();
    };
  },

  // §3 Editarea unui pas
  editStep(app, step, onSave) {
    const s = { id: step.id || NX.uid('st'), ...step };
    if (s.action === 'repeat') s.stepsJson = JSON.stringify(s.steps || [], null, 1);
    const fieldsHTML = (action) => STEP_TYPES[action][1].map(([k, label, type]) => (type === 'bool'
      ? `<label class="switch"><span class="sw-text">${NX.esc(label)}</span><input type="checkbox" data-f="${k}" ${s[k] ? 'checked' : ''}></label>`
      : type === 'json' ? `<label class="fld"><span>${NX.esc(label)}</span><textarea class="inp mono" rows="6" data-f="${k}">${NX.esc(s[k] || '[]')}</textarea></label>`
        : `<label class="fld"><span>${NX.esc(label)}</span><div class="inp-wrap"><input class="inp" data-f="${k}" value="${NX.esc(s[k] ?? '')}" ${type === 'num' ? 'type="number"' : ''}>
          ${type === 'file' ? `<button type="button" class="btn small" data-file="${k}">Alege…</button>` : ''}</div></label>`)).join('');
    NX.openModal({
      title: 'Pas', width: 520,
      body: `<div class="form-col"><label class="fld"><span>Acțiune</span><select class="inp" data-action>${Object.entries(STEP_TYPES).map(([k, [l]]) => `<option value="${k}" ${k === s.action ? 'selected' : ''}>${NX.esc(l)}</option>`).join('')}</select></label>
        <div data-fields class="form-col">${fieldsHTML(s.action)}</div><div class="vf-err"></div></div>
        <div class="row-end"><button class="btn ghost" data-cancel>Anulează</button><button class="btn primary" data-ok>Salvează pasul</button></div>`,
      onMount: (m) => {
        const sel = NX.$('[data-action]', m.body);
        sel.addEventListener('change', () => { s.action = sel.value; NX.$('[data-fields]', m.body).innerHTML = fieldsHTML(sel.value); });
        m.body.addEventListener('click', async (e) => { const fb = e.target.closest('[data-file]'); if (fb) { const f = await window.netorAPI.pickFiles({ title: 'Fișier de încărcat', multi: true }); if (f && f.length) NX.$(`[data-f="${fb.dataset.file}"]`, m.body).value = f.join('|'); } });
        NX.$('[data-cancel]', m.body).onclick = () => m.close();
        NX.$('[data-ok]', m.body).onclick = () => {
          const out = { id: s.id, action: sel.value, alt: s.alt };
          for (const [k, , type] of STEP_TYPES[sel.value][1]) {
            const el = NX.$(`[data-f="${k}"]`, m.body);
            if (type === 'bool') out[k] = el.checked;
            else if (type === 'num') { if (el.value !== '') out[k] = Number(el.value); } else if (type === 'json') {
              try { out.steps = JSON.parse(el.value || '[]'); } catch (err) { NX.$('.vf-err', m.body).textContent = `JSON invalid: ${err.message}`; return; }
            } else if (el.value.trim()) out[k] = el.value.trim();
          }
          m.close();
          onSave(out);
        };
      },
    });
  },
};
