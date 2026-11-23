/* MAP
 * Scop: Completarea formularelor si clipboardul multi-slot:
 *       - meniul Netor la clic dreapta intr-un camp gol: Paste, Grupuri de date, Carduri (numele tau + CVV),
 *         Parole (strict pe domeniu), Adrese, Identitati, Companii, Lipire din slot, Fereastra de date
 *       - fereastra de date: fiecare camp cu Copy; Ctrl+1..9 tinut + Copy = in slotul respectiv
 *       - pastila cu sloturi (vizibila cand ai ceva in sloturi), gestionarea sloturilor
 *       - oferta de salvare a parolei dupa login; mesajele din pagina (completare, inregistrare pasi)
 * Legaturi: preload-page.js, src/main/vault-fill.js, src/main/web-contents.js, vault-ui.js, templates-ui.js
 * Sectiuni:
 *   §1 Evenimente si mesaje din pagina
 *   §2 Meniul de completare
 *   §3 Copiere in slot, fereastra de date
 *   §4 Pastila si gestionarea sloturilor
 *   §5 Salvarea parolei
 */

window.NetorAutofill = {
  held: '',

  // §1 Evenimente si mesaje din pagina
  bind(app) {
    window.netorEvents.on('form-menu', (p) => this.formMenu(app, p));
    window.netorEvents.on('slots', (s) => { app.slots = s; this.renderPill(app); });
    window.netorEvents.on('slot-held', (d) => { this.held = d; this.renderPill(app); });
    window.netorEvents.on('vault-locked', (locked) => { if (locked) { app.vault = null; window.NetorTools.renderBadges(app); } });
    window.netorEvents.on('vault-changed', async () => { const r = await window.netorAPI.vaultGet(); if (r && r.vault) app.vault = r.vault; });
    this.renderPill(app);
  },

  onPageMessage(app, tabId, rec, channel, payload) {
    if (channel === 'netor-page:login-submitted') this.offerSave(app, tabId, payload);
    else if (channel === 'netor-page:filled' && payload) NX.toast(payload.count ? `Am completat ${payload.count} câmpuri.` : 'Nu am găsit câmpuri potrivite; folosește fereastra de date.', payload.count ? 'info' : 'warn');
    else if (channel === 'netor-page:record' || channel === 'netor-page:picked') window.NetorTemplates.onPageEvent(app, tabId, channel, payload);
  },

  // §2 Meniul de completare
  async formMenu(app, p) {
    const rec = window.NetorWV.get(p.tabId);
    if (!rec || !rec.wv) return;
    const r = rec.wv.getBoundingClientRect();
    const x = r.left + p.x;
    const y = r.top + p.y;
    const host = (() => { try { return new URL(p.url).hostname.replace(/^www\./, ''); } catch (_) { return ''; } })();
    const fill = (kind, id, field) => window.netorAPI.fill({ wcId: p.wcId, frame: p.frame, kind, id, field }).then((res) => { if (res && res.ok === false) NX.toast(res.error, 'error'); });
    const paste = async (text) => window.netorAPI.tabCommand({ tabId: p.tabId, cmd: 'page.insert', params: { text } });
    const slotItems = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => app.slots[n]).map((n) => ({ label: `${n} · ${app.slots[n].slice(0, 40)}`, onClick: () => paste(app.slots[n]) }));
    const base = [{ label: 'Lipește', icon: '📋', hint: 'Ctrl+V', onClick: async () => paste(await window.netorAPI.clipboard({})) }];
    if (!app.vault) {
      NX.showMenu([...base, slotItems.length && { label: 'Lipește din slot', submenu: slotItems }, { separator: true },
        { label: app.vaultStatus.initialized ? 'Deblochează seiful pentru completare…' : 'Creează seiful (PIN)…', icon: '🔒',
          onClick: async () => { if (await window.NetorVaultUI.ensureUnlocked(app)) this.formMenu(app, p); } }], x, y);
      return;
    }
    const v = app.vault;
    const S = window.NetorVaultSchema;
    const entry = (kind, cat, x2, fields) => ({
      label: S[cat].title(x2), submenu: [{ label: 'Completează formularul', icon: '⚡', onClick: () => fill(kind, x2.id) }, { separator: true }, { header: 'Doar în acest câmp' },
        ...fields.filter(([k]) => x2[k]).map(([k, label]) => ({ label, hint: k === 'cvv' || k === 'password' ? '•••' : String(x2[k]).slice(0, 22), onClick: () => fill(kind, x2.id, k) })),
        { separator: true }, { label: 'Fereastra cu datele…', icon: '🪟', onClick: () => this.openDataWindow(app, { cat, id: x2.id }) }],
    });
    const match = (l) => host && (host === l.domain || host.endsWith(`.${l.domain}`));
    const logins = (v.logins || []).filter(match);
    const otherLogins = (v.logins || []).filter((l) => !match(l));
    const list = (cat, kind, fields) => ((v[cat] || []).length ? (v[cat]).map((x2) => entry(kind, cat, x2, fields)) : [{ label: 'Nicio intrare', disabled: true }]);
    NX.showMenu([
      ...base,
      { separator: true },
      { label: 'Grupuri de date', icon: '📦', submenu: (v.dataGroups || []).length ? v.dataGroups.map((g) => ({ label: g.name, onClick: () => fill('datagroup', g.id) })) : [{ label: 'Creează din Setări → Grupuri de date', disabled: true }] },
      { label: 'Carduri', icon: '💳', submenu: list('cards', 'card', [['number', 'Număr'], ['holder', 'Titular'], ['exp', 'Expirare'], ['cvv', 'CVV']]) },
      { label: `Parole${host ? ` · ${host}` : ''}`, icon: '🔑', submenu: [...(logins.length ? logins.map((l) => entry('login', 'logins', l, [['username', 'Utilizator'], ['password', 'Parolă']])) : [{ label: 'Nicio parolă pentru acest site', disabled: true }]),
        ...(otherLogins.length ? [{ separator: true }, { label: 'Parole de pe alte site-uri', submenu: otherLogins.map((l) => entry('login', 'logins', l, [['username', 'Utilizator'], ['password', 'Parolă']])) }] : [])] },
      { label: 'Adrese', icon: '📍', submenu: list('addresses', 'address', [['street', 'Stradă'], ['line2', 'Bloc/ap.'], ['city', 'Localitate'], ['county', 'Județ'], ['zip', 'Cod poștal'], ['country', 'Țară']]) },
      { label: 'Identități', icon: '👤', submenu: list('identities', 'identity', [['firstName', 'Prenume'], ['lastName', 'Nume'], ['email', 'Email'], ['phone', 'Telefon']]) },
      { label: 'Companii', icon: '🏢', submenu: list('companies', 'company', [['name', 'Denumire'], ['cui', 'CUI'], ['regCom', 'Reg. Com.'], ['iban', 'IBAN'], ['bank', 'Bancă'], ['email', 'Email'], ['phone', 'Telefon']]) },
      { separator: true },
      slotItems.length ? { label: 'Lipește din slot', icon: '🔢', submenu: slotItems } : { label: 'Sloturile sunt goale (Ctrl+Shift+1..9 pe text selectat)', disabled: true },
      { label: 'Fereastra de date (sloturi)…', icon: '🪟', onClick: () => this.openDataWindow(app) },
    ], x, y);
  },

  // §3 Copiere in slot, fereastra de date
  async copyValue(app, value, label, btn) {
    const held = await window.netorAPI.heldSlot();
    if (held && typeof held === 'string') {
      await window.netorAPI.slotSet({ slot: held, value });
      NX.toast(`„${label}” e în slotul ${held}. Ține Ctrl+${held} și dă clic într-un câmp ca să-l lipești.`);
    } else {
      await window.netorAPI.clipboard({ text: value });
      NX.toast(`„${label}” copiat în clipboard.`);
    }
    if (btn) { btn.classList.add('active'); setTimeout(() => btn.classList.remove('active'), 600); }
  },

  async openDataWindow(app, focus) {
    if (!(await window.NetorVaultUI.ensureUnlocked(app))) return;
    const S = window.NetorVaultSchema;
    const cats = Object.keys(S).filter((k) => S[k] && S[k].fields && k !== 'dataGroups');
    NX.openModal({
      title: 'Fereastra de date · Ctrl+1..9 + Copy = slot', width: 720, className: 'data-window',
      body: `<p class="muted-text">Ține apăsat <b>Ctrl+1</b> și apasă <b>Copy</b> la o valoare, apoi <b>Ctrl+2</b> + Copy la următoarea… În pagină ține <b>Ctrl+1</b> și dă clic în câmp: se lipește valoarea din slotul 1. Sloturile merg în orice tab și în orice browser.</p>
        <div class="row"><select class="inp" data-cat style="max-width:200px">${cats.map((c) => `<option value="${c}" ${focus && focus.cat === c ? 'selected' : ''}>${NX.esc(S[c].label)}</option>`).join('')}</select>
        <select class="inp" data-item></select><button class="btn" data-all title="Pune fiecare câmp în sloturile 1, 2, 3…">Toate în sloturi</button></div><div class="data-rows" data-rows></div>`,
      onMount: (m) => {
        const catSel = NX.$('[data-cat]', m.body);
        const itemSel = NX.$('[data-item]', m.body);
        const rowsOf = () => {
          const cat = catSel.value;
          const it = (app.vault[cat] || []).find((x) => x.id === itemSel.value);
          return it ? S[cat].fields.filter(([k, , o = {}]) => it[k] && !o.ref && k !== 'notes').map(([k, label]) => ({ label, value: String(it[k]) })) : [];
        };
        const drawRows = () => {
          const rows = rowsOf();
          NX.$('[data-rows]', m.body).innerHTML = rows.length ? rows.map((r, i) => `<div class="vf-row"><span class="slot-num">${i + 1}</span><span class="k">${NX.esc(r.label)}</span><span class="v mono">${NX.esc(r.value)}</span>
            <button class="btn small" data-copy="${i}">${IC('copy', 13)} Copy</button></div>`).join('') : '<div class="empty">Nicio intrare în această categorie.</div>';
        };
        const drawItems = () => {
          const cat = catSel.value;
          itemSel.innerHTML = (app.vault[cat] || []).map((x) => `<option value="${x.id}" ${focus && focus.id === x.id ? 'selected' : ''}>${NX.esc(S[cat].title(x))}</option>`).join('');
          drawRows();
        };
        catSel.addEventListener('change', drawItems);
        itemSel.addEventListener('change', drawRows);
        NX.$('[data-rows]', m.body).addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) { const r = rowsOf()[b.dataset.copy]; this.copyValue(app, r.value, r.label, b); } });
        NX.$('[data-all]', m.body).onclick = async () => {
          const rows = rowsOf().slice(0, 9);
          for (let i = 0; i < rows.length; i++) await window.netorAPI.slotSet({ slot: String(i + 1), value: rows[i].value });
          NX.toast(`Am pus ${rows.length} valori în sloturile 1–${rows.length}.`);
        };
        drawItems();
      },
    });
  },

  // §4 Pastila si gestionarea sloturilor
  renderPill(app) {
    const pill = document.getElementById('slotPill');
    const filled = Object.keys(app.slots || {}).filter((k) => app.slots[k]).sort();
    pill.classList.toggle('hidden', !filled.length && !this.held);
    pill.innerHTML = `${IC('slots', 14)}${filled.map((k) => `<span class="sp${this.held === k ? ' held' : ''}" title="${NX.esc(app.slots[k])}"><b>${k}</b>${NX.esc(app.slots[k].slice(0, 14))}</span>`).join('')}
      ${this.held && !app.slots[this.held] ? `<span class="sp held"><b>${this.held}</b>gol</span>` : ''}`;
    pill.onclick = () => this.manageSlots(app);
  },

  manageSlots(app) {
    NX.openModal({
      title: 'Sloturi (Ctrl+1..9)', width: 560,
      body: `<div class="form-col">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<div class="row"><span class="slot-num">${n}</span>
        <input class="inp" data-slot="${n}" value="${NX.esc(app.slots[n] || '')}" placeholder="gol"><button class="icon-btn" data-cp="${n}" title="Copiază în clipboard">${IC('copy', 14)}</button></div>`).join('')}</div>
        <div class="row-end"><button class="btn danger" data-clear style="margin-right:auto">Golește toate</button><button class="btn primary" data-ok>Salvează</button></div>`,
      onMount: (m) => {
        m.body.addEventListener('click', (e) => { const b = e.target.closest('[data-cp]'); if (b) window.netorAPI.clipboard({ text: NX.$(`[data-slot="${b.dataset.cp}"]`, m.body).value }); });
        NX.$('[data-clear]', m.body).onclick = async () => { await window.netorAPI.slotClear(); m.close(); };
        NX.$('[data-ok]', m.body).onclick = async () => {
          for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) { const val = NX.$(`[data-slot="${n}"]`, m.body).value; if (val !== (app.slots[n] || '')) await window.netorAPI.slotSet({ slot: String(n), value: val }); }
          m.close();
        };
      },
    });
  },

  // §5 Salvarea parolei
  offerSave(app, tabId, p) {
    const gs = app.state.globalSettings;
    if (!gs.offerSavePasswords || !p || !p.password || !p.domain) return;
    const { brw } = app.tabById(tabId);
    if (brw && brw.allPrivate) return;
    const domain = p.domain.replace(/^www\./, '');
    const key = `${domain}|${p.username}`;
    if (this.lastOffer === key && Date.now() - this.lastOfferAt < 15000) return;
    this.lastOffer = key;
    this.lastOfferAt = Date.now();
    if (app.vault && (app.vault.logins || []).some((l) => l.domain === domain && l.username === p.username && l.password === p.password)) return;
    NX.openModal({
      title: 'Salvezi parola?', width: 420,
      body: `<p>Salvez în seif datele de autentificare pentru <b>${NX.esc(domain)}</b>?</p><div class="vf-row"><span class="k">Utilizator</span><span class="v">${NX.esc(p.username || '(fără)')}</span></div>
        <div class="row-end"><button class="btn ghost" data-no>Nu acum</button><button class="btn primary" data-yes>Salvează</button></div>`,
      onMount: (m) => {
        NX.$('[data-no]', m.body).onclick = () => m.close();
        NX.$('[data-yes]', m.body).onclick = async () => {
          m.close();
          if (!(await window.NetorVaultUI.ensureUnlocked(app))) return;
          const list = app.vault.logins || (app.vault.logins = []);
          const ex = list.find((l) => l.domain === domain && l.username === p.username);
          if (ex) Object.assign(ex, { password: p.password, updatedAt: Date.now() });
          else list.push({ id: NX.uid('log'), domain, username: p.username, password: p.password, label: '', updatedAt: Date.now() });
          const r = await window.netorAPI.vaultSave({ vault: app.vault });
          if (r && r.vault) { app.vault = r.vault; NX.toast('Parola a fost salvată în seif.'); }
        };
      },
    });
  },
};
