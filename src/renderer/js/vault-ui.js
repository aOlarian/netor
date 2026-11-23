/* MAP
 * Scop: Interfata seifului de date: setarea PIN-ului la prima folosire, deblocarea cu PIN, panoul lateral
 *       "Date" cu taburi pe iconite (Parole, Carduri, Adrese, Companii, Identitati, Contacte, Grupuri),
 *       lista cu cautare, detalii cu Copy (Ctrl+1..9 + Copy = in slot), editare, stergere, blocare,
 *       si sectiunea "Seif & PIN" din setari (schimbare PIN, blocare automata).
 * Legaturi: vault-forms.js, autofill.js (sloturi), settings-panes.js, app.js (app.vault)
 * Sectiuni:
 *   §1 Deblocare / initializare PIN
 *   §2 Lista unei categorii (setari si sidebar)
 *   §3 Detaliile unei intrari si copierea in sloturi
 *   §4 Panoul lateral "Date" si sectiunea Seif & PIN
 */

window.NetorVaultUI = {
  sidebarCat: 'logins',

  // §1 Deblocare / initializare PIN
  async ensureUnlocked(app) {
    if (app.vault) return true;
    const st = await window.netorAPI.vaultStatus();
    app.vaultStatus = st;
    return new Promise((resolve) => {
      const setup = !st.initialized;
      NX.openModal({
        title: setup ? 'Creează PIN-ul seifului' : 'Deblochează seiful', width: 380, className: 'pin-modal',
        body: `<div class="pin-box">${IC('vault', 34)}<p class="muted-text">${setup ? 'Alege un PIN (minimum 4 caractere). Cu el deblochezi parolele, cardurile și celelalte date.' : 'Introdu PIN-ul seifului.'}</p>
          <input class="inp pin-inp" type="password" data-pin placeholder="PIN" autocomplete="off">${setup ? '<input class="inp pin-inp" type="password" data-pin2 placeholder="Confirmă PIN-ul">' : ''}
          <div class="vf-err"></div><button class="btn primary" data-ok style="width:100%;justify-content:center">${setup ? 'Creează seiful' : 'Deblochează'}</button></div>`,
        onMount: (m) => {
          let ok = false;
          const pin = NX.$('[data-pin]', m.body);
          const go = async () => {
            const err = NX.$('.vf-err', m.body);
            if (setup && pin.value !== NX.$('[data-pin2]', m.body).value) { err.textContent = 'PIN-urile nu coincid.'; return; }
            const r = setup ? await window.netorAPI.vaultSetup({ pin: pin.value }) : await window.netorAPI.vaultUnlock({ pin: pin.value });
            if (!r || r.ok === false) { err.textContent = (r && r.error) || 'Eroare'; pin.select(); return; }
            app.vault = r.vault;
            app.vaultStatus = { initialized: true, unlocked: true };
            ok = true;
            m.close();
            window.NetorTools.renderBadges(app);
            resolve(true);
          };
          m.body.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
          NX.$('[data-ok]', m.body).onclick = go;
          const close = m.close;
          m.close = () => { close(); if (!ok) resolve(false); };
          NX.$('[data-close]', m.el).onclick = m.close;
          setTimeout(() => pin.focus(), 40);
        },
      });
    });
  },

  async lock(app) {
    await window.netorAPI.vaultLock();
    app.vault = null;
    window.NetorTools.renderBadges(app);
  },

  // §2 Lista unei categorii
  async renderCategory(app, host, cat, compact) {
    const sc = window.NetorVaultSchema[cat];
    if (!sc) return;
    if (!app.vault) {
      host.innerHTML = `<div class="locked-box">${IC('lock', 30)}<p>Seiful este blocat.</p><button class="btn primary" data-unlock>Deblochează</button></div>`;
      NX.$('[data-unlock]', host).onclick = async () => { if (await this.ensureUnlocked(app)) this.renderCategory(app, host, cat, compact); };
      return;
    }
    host.innerHTML = `${compact ? '' : `<h2 class="section-title">${NX.esc(sc.label)}</h2>`}
      <div class="row vault-toolbar"><div class="search-box">${IC('search', 14)}<input class="inp" placeholder="Caută în ${NX.esc(sc.label.toLowerCase())}" data-q></div>
      <button class="btn primary" data-add>${IC('plus', 14)} Adaugă</button></div><div class="vault-list" data-list></div>`;
    const draw = () => {
      const q = NX.$('[data-q]', host).value.toLowerCase();
      const items = (app.vault[cat] || []).filter((x) => !q || JSON.stringify([sc.title(x), sc.sub(x)]).toLowerCase().includes(q));
      const list = NX.$('[data-list]', host);
      list.innerHTML = items.length ? '' : `<div class="empty">Nicio intrare. Apasă „Adaugă”.</div>`;
      for (const x of items) list.appendChild(this.itemEl(app, cat, x, draw));
    };
    NX.$('[data-q]', host).addEventListener('input', draw);
    NX.$('[data-add]', host).onclick = () => window.NetorVaultForm.open(app, cat, null, draw);
    draw();
  },

  itemEl(app, cat, x, redraw) {
    const sc = window.NetorVaultSchema[cat];
    const el = document.createElement('div');
    el.className = 'vault-item';
    el.innerHTML = `<div class="vi-head"><span class="vi-icon">${IC(sc.icon, 16)}</span><div class="vi-text"><b>${NX.esc(sc.title(x))}</b><small>${NX.esc(sc.sub(x))}</small></div>
      <button class="icon-btn" data-edit title="Editează">${IC('edit', 15)}</button><button class="icon-btn" data-del title="Șterge">${IC('trash', 15)}</button></div><div class="vi-body hidden"></div>`;
    const body = NX.$('.vi-body', el);
    NX.$('.vi-head', el).addEventListener('click', (e) => {
      if (e.target.closest('[data-edit]')) { window.NetorVaultForm.open(app, cat, x, redraw); return; }
      if (e.target.closest('[data-del]')) { this.remove(app, cat, x, redraw); return; }
      body.classList.toggle('hidden');
      if (!body.classList.contains('hidden')) this.detail(app, cat, x, body);
    });
    return el;
  },

  async remove(app, cat, x, redraw) {
    const sc = window.NetorVaultSchema[cat];
    if (!await NX.confirmBox({ title: `Șterge ${sc.one}`, message: `Ștergi „${sc.title(x)}” din seif?`, okLabel: 'Șterge', danger: true })) return;
    app.vault[cat] = app.vault[cat].filter((y) => y.id !== x.id);
    app.vault._deleted = { ...(app.vault._deleted || {}), [x.id]: Date.now() };
    const r = await window.netorAPI.vaultSave({ vault: app.vault });
    if (r && r.vault) app.vault = r.vault;
    redraw();
  },

  // §3 Detaliile unei intrari si copierea in sloturi
  detail(app, cat, x, body) {
    const sc = window.NetorVaultSchema[cat];
    const rows = sc.fields.filter(([k, , o = {}]) => x[k] && !o.ref).map(([k, label, o = {}]) => ({ k, label, value: String(x[k]), secret: !!o.secret }));
    if (cat === 'dataGroups') {
      for (const [k, label, o] of sc.fields.filter((f) => f[2] && f[2].ref)) {
        const ref = (app.vault[o.ref] || []).find((y) => y.id === x[k]);
        if (ref) rows.push({ k, label, value: window.NetorVaultSchema[o.ref].title(ref), secret: false });
      }
    }
    body.innerHTML = `${rows.map((r, i) => `<div class="vf-row"><span class="k">${NX.esc(r.label)}</span>
      <span class="v${r.secret ? ' secret' : ''}" data-i="${i}">${r.secret ? '••••••••' : NX.esc(r.value)}</span>
      ${r.secret ? `<button class="icon-btn" data-show="${i}" title="Arată">${IC('eye', 14)}</button>` : ''}
      <button class="icon-btn" data-copy="${i}" title="Copiază (ține Ctrl+1..9 apăsat ca să pui în slot)">${IC('copy', 14)}</button></div>`).join('')}
      <div class="muted-text small-hint">Ține apăsat Ctrl+1 … Ctrl+9 și apasă copiere: valoarea intră în slotul respectiv. Apoi Ctrl+cifra + clic în orice câmp o lipește.</div>`;
    body.addEventListener('click', async (e) => {
      const sh = e.target.closest('[data-show]');
      if (sh) { const v = NX.$(`[data-i="${sh.dataset.show}"]`, body); v.textContent = v.textContent.startsWith('•') ? rows[sh.dataset.show].value : '••••••••'; }
      const cp = e.target.closest('[data-copy]');
      if (cp) await window.NetorAutofill.copyValue(app, rows[cp.dataset.copy].value, rows[cp.dataset.copy].label, cp);
    });
  },

  // §4 Panoul lateral "Date" si sectiunea Seif & PIN
  async openSidebar(app) {
    if (!(await this.ensureUnlocked(app))) return;
    const cats = Object.entries(window.NetorVaultSchema).filter(([, v]) => v && v.fields);
    window.NetorTools.openSidebar(app, 'vault', 'Date', (body, actions) => {
      actions.innerHTML = `<button class="icon-btn" data-lock title="Blochează seiful">${IC('lock', 15)}</button>`;
      NX.$('[data-lock]', actions).onclick = async () => { await this.lock(app); window.NetorTools.closeSidebar(); };
      body.innerHTML = `<div class="vault-tabs">${cats.map(([k, v]) => `<button data-cat="${k}" class="${k === this.sidebarCat ? 'on' : ''}" title="${NX.esc(v.label)}">${IC(v.icon, 17)}</button>`).join('')}</div><div data-host></div>`;
      const show = (k) => { this.sidebarCat = k; body.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b.dataset.cat === k)); this.renderCategory(app, NX.$('[data-host]', body), k, true); };
      body.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => show(b.dataset.cat)));
      show(this.sidebarCat);
    });
  },

  async securityPane(app, host) {
    const st = await window.netorAPI.vaultStatus();
    const gs = app.state.globalSettings;
    host.innerHTML = `<h2 class="section-title">Seif & PIN</h2><p class="section-sub">Datele sunt criptate AES-256 cu o cheie protejată de PIN-ul tău și de contul Windows.</p>
      ${!st.initialized ? '<button class="btn primary" data-setup>Creează PIN-ul seifului</button>' : `<div class="card form-col" style="max-width:420px">
        <b>Schimbă PIN-ul</b><input class="inp" type="password" data-old placeholder="PIN actual"><input class="inp" type="password" data-new placeholder="PIN nou (min. 4)">
        <input class="inp" type="password" data-new2 placeholder="Confirmă PIN-ul nou"><div class="row"><button class="btn primary" data-chg>Schimbă PIN-ul</button><span class="muted-text" data-out></span></div></div>`}
      <div class="fld" style="margin-top:16px"><span>Blocare automată după inactivitate</span>${window.NetorSettings.segHTML('al', [['5', '5 min'], ['15', '15 min'], ['60', '1 oră'], ['240', '4 ore'], ['0', 'Niciodată']], String(gs.vaultAutoLockMin))}</div>
      ${st.unlocked || app.vault ? '<div class="row" style="margin-top:16px"><button class="btn" data-lock>Blochează acum</button></div>' : ''}`;
    window.NetorSettings.bindSeg(host, 'al', String(gs.vaultAutoLockMin), (v) => { gs.vaultAutoLockMin = Number(v); app.save(); window.netorAPI.vaultAutolock({ minutes: Number(v) }); });
    const setup = NX.$('[data-setup]', host);
    if (setup) setup.onclick = async () => { if (await this.ensureUnlocked(app)) this.securityPane(app, host); };
    const lock = NX.$('[data-lock]', host);
    if (lock) lock.onclick = async () => { await this.lock(app); this.securityPane(app, host); };
    const chg = NX.$('[data-chg]', host);
    if (chg) chg.onclick = async () => {
      const out = NX.$('[data-out]', host);
      const n = NX.$('[data-new]', host).value;
      if (n !== NX.$('[data-new2]', host).value) { out.textContent = 'PIN-urile noi nu coincid.'; return; }
      const r = await window.netorAPI.vaultChangePin({ oldPin: NX.$('[data-old]', host).value, newPin: n });
      out.textContent = r && r.ok ? 'PIN schimbat.' : `Eroare: ${(r && r.error) || ''}`;
      if (r && r.ok) { const v = await window.netorAPI.vaultGet(); if (v && v.vault) app.vault = v.vault; }
    };
  },
};
