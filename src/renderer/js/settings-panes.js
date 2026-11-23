/* MAP
 * Scop: Continutul sectiunilor din Setari globale (se salveaza imediat la schimbare): cont si sincronizare,
 *       aspect (teme), workspace (folder ales cu dialogul) si AI (Netor Cloud sau endpoint propriu, modele),
 *       navigare, retea/proxy, descarcari, seif si PIN, extensii, date salvate, despre/actualizari.
 * Legaturi: settings.js (componente), vault-ui.js (categorii de date), app.js
 * Sectiuni:
 *   §1 Dispecer si utilitare
 *   §2 Cont, aspect
 *   §3 Workspace & AI
 *   §4 Navigare, retea, descarcari
 *   §5 Seif & PIN, extensii, despre
 */

window.NetorSettingsPanes = {
  // §1 Dispecer si utilitare
  render(app, id, host, modal) {
    const fn = this[id];
    if (fn) fn.call(this, app, host, modal);
    else window.NetorVaultUI.renderCategory(app, host, id);
  },
  head(title, sub) { return `<h2 class="section-title">${NX.esc(title)}</h2><p class="section-sub">${NX.esc(sub || '')}</p>`; },
  sw(key, label, help, on) { return `<label class="switch"><span class="sw-text">${NX.esc(label)}${help ? `<small>${NX.esc(help)}</small>` : ''}</span><input type="checkbox" data-sw="${key}" ${on ? 'checked' : ''}></label>`; },
  bindSwitches(app, host, target) {
    host.querySelectorAll('[data-sw]').forEach((i) => i.addEventListener('change', () => { target[i.dataset.sw] = i.checked; app.commit(); }));
  },

  // §2 Cont, aspect
  account(app, host, modal) {
    const gs = app.state.globalSettings;
    if (gs.authToken && gs.user) {
      host.innerHTML = `${this.head('Cont Netor Cloud', 'Sincronizare criptată end-to-end: serverul vede doar date criptate.')}
        <div class="card row"><span class="avatar">${NX.esc((gs.user.display_name || gs.user.username || '?')[0].toUpperCase())}</span>
          <div style="flex:1"><b>${NX.esc(gs.user.display_name || gs.user.username)}</b><div class="muted-text">${NX.esc(gs.user.email || '')} · rol ${NX.esc(gs.user.role || '')}</div>
          <div class="muted-text">Dispozitiv: ${NX.esc(gs.deviceId)} · <span data-bridge>…</span></div></div>
          <button class="btn" data-sync>${IC('cloud', 15)} Sincronizează acum</button></div>
        <div class="card">${this.sw('autoSync', 'Sincronizare automată', 'Favorite, note, agenți, șabloane, browsere cu taburi și seiful.', gs.autoSync)}
          ${this.sw('allowRemote', 'Permite controlul remote al acestui browser', 'Agenții tăi pot folosi taburile de aici prin netor.example.test.', gs.allowRemote !== false)}</div>
        <div class="row-end"><span class="muted-text" data-out style="margin-right:auto"></span><button class="btn danger" data-logout>Deconectează</button></div>`;
      this.bindSwitches(app, host, gs);
      window.netorAPI.cloudStatus().then((s) => { NX.$('[data-bridge]', host).textContent = s && s.bridge ? 'conectat la puntea remote' : 'punte remote deconectată'; });
      NX.$('[data-sync]', host).onclick = async () => { const o = NX.$('[data-out]', host); o.textContent = 'Sincronizez…'; const r = await window.netorAPI.cloudSync(); o.textContent = r && r.ok === false ? `Eroare: ${r.error}` : 'Sincronizat.'; };
      NX.$('[data-logout]', host).onclick = async () => { await window.netorAPI.cloudLogout(); this.account(app, host, modal); };
      return;
    }
    host.innerHTML = `${this.head('Cont Netor Cloud', 'Conectează-te ca să ai aceleași favorite, taburi, note și seif pe orice calculator.')}
      ${window.NetorSettings.segHTML('acc', [['login', 'Autentificare'], ['register', 'Cont nou']], 'login')}
      <div class="form-col" style="margin-top:14px;max-width:440px">
        <label class="fld"><span>Server</span><input class="inp" data-k="url" value="${NX.esc(gs.cloudUrl)}"></label>
        <label class="fld"><span>Utilizator</span><input class="inp" data-k="username" autocomplete="username"></label>
        <label class="fld hidden" data-reg><span>Email</span><input class="inp" data-k="email" type="email"></label>
        <label class="fld"><span>Parolă</span><input class="inp" data-k="password" type="password" autocomplete="current-password"></label>
        <div class="row"><button class="btn primary" data-go>Conectează-te</button><span class="muted-text" data-out></span></div></div>`;
    const mode = window.NetorSettings.bindSeg(host, 'acc', 'login', (v) => { NX.$('[data-reg]', host).classList.toggle('hidden', v !== 'register'); NX.$('[data-go]', host).textContent = v === 'register' ? 'Creează contul' : 'Conectează-te'; });
    NX.$('[data-go]', host).onclick = async () => {
      const g = (k) => NX.$(`[data-k="${k}"]`, host).value.trim();
      const out = NX.$('[data-out]', host);
      out.textContent = 'Se conectează…';
      const r = await window.netorAPI.cloudLogin({ url: g('url'), username: g('username'), email: g('email'), password: NX.$('[data-k="password"]', host).value, register: mode() === 'register' });
      if (r && r.ok) { NX.toast('Conectat la Netor Cloud.'); this.account(app, host, modal); } else out.textContent = `Eroare: ${(r && r.error) || 'necunoscută'}`;
    };
  },

  appearance(app, host) {
    const gs = app.state.globalSettings;
    const S = window.NetorSettings;
    host.innerHTML = `${this.head('Aspect', 'Tema implicită pentru toate browserele. Fiecare browser din minibar o poate schimba pe a lui.')}
      ${S.themeGrid(gs.theme, false)}
      <div class="fld" style="margin-top:18px"><span>Bara de favorite</span>${S.segHTML('fav', [['separate', 'Pe linie separată'], ['same', 'În bara de adrese (se lărgește la clic)']], gs.favoritesMode)}</div>
      <div class="card" style="margin-top:14px">${this.sw('showFavorites', 'Afișează bara de favorite', 'Ctrl+Shift+B o ascunde sau o afișează.', gs.showFavorites)}</div>
      <div class="row" style="margin-top:14px"><button class="btn" data-mb>Setări minibar (poziție, culoare)…</button></div>`;
    S.bindThemeGrid(host, gs.theme, (v) => { gs.theme = v; app.commit(); });
    S.bindSeg(host, 'fav', gs.favoritesMode, (v) => { gs.favoritesMode = v; app.commit(); });
    this.bindSwitches(app, host, gs);
    NX.$('[data-mb]', host).onclick = () => window.NetorMinibar.minibarSettings(app);
  },

  // §3 Workspace & AI
  workspace(app, host) {
    const gs = app.state.globalSettings;
    const ws = gs.workspace;
    const ai = gs.ai;
    const S = window.NetorSettings;
    host.innerHTML = `${this.head('Workspace & AI', 'Workspace-ul îi dă agentului acces la fișierele tale; AI-ul e modelul care răspunde.')}
      <div class="card form-col"><div class="fld"><span>Workspace</span>${S.segHTML('wsm', [['none', 'Neconectat'], ['local', 'Folder pe acest calculator'], ['remote', 'Pe alt dispozitiv al contului']], ws.mode)}</div>
        <div data-ws="local" class="${ws.mode === 'local' ? '' : 'hidden'}">${S.folderField('ws', ws.path, 'Alege folderul workspace-ului')}
          ${this.sw('allowWrite', 'Agentul poate scrie fișiere în workspace', 'Implicit doar citește.', ws.allowWrite)}
          ${this.sw('shareWithDevices', 'Partajează workspace-ul cu celelalte dispozitive ale mele', 'Ex: browserul de pe laptop folosește workspace-ul de pe stația de lucru.', ws.shareWithDevices)}</div>
        <div data-ws="remote" class="${ws.mode === 'remote' ? '' : 'hidden'}"><label class="fld"><span>Dispozitivul cu workspace-ul</span><select class="inp" data-dev><option value="">Se încarcă…</option></select></label></div></div>
      <div class="card form-col" style="margin-top:14px"><div class="fld"><span>Conexiune AI</span>${S.segHTML('aim', [['cloud', 'Prin contul Netor (merge de oriunde)'], ['direct', 'Endpoint propriu (compatibil OpenAI)']], ai.mode)}</div>
        <div data-ai="direct" class="form-col ${ai.mode === 'direct' ? '' : 'hidden'}"><label class="fld"><span>Endpoint</span><input class="inp" data-k="endpoint" value="${NX.esc(ai.endpoint)}" placeholder="http://server:8811/v1"></label>
          <label class="fld"><span>Cheie API</span><input class="inp" type="password" data-k="apiKey" placeholder="se păstrează criptat pe acest calculator"></label></div>
        <div class="row"><label class="fld" style="flex:1"><span>Model implicit pentru agenți</span><select class="inp" data-model><option value="${NX.esc(ai.model)}">${NX.esc(ai.model || 'alege după test')}</option></select></label>
          <button class="btn" data-test style="align-self:flex-end">Testează și încarcă modelele</button></div><div class="muted-text" data-out></div></div>`;
    const showWs = (v) => host.querySelectorAll('[data-ws]').forEach((d) => d.classList.toggle('hidden', d.dataset.ws !== v));
    S.bindSeg(host, 'wsm', ws.mode, (v) => { ws.mode = v; showWs(v); app.save(); if (v === 'remote') loadDevices(); });
    S.bindFolderField(host, 'ws', (p) => { ws.path = p; app.save(); });
    host.querySelectorAll('[data-sw]').forEach((i) => i.addEventListener('change', () => { ws[i.dataset.sw] = i.checked; app.save(); }));
    const loadDevices = async () => {
      const sel = NX.$('[data-dev]', host);
      const list = await window.netorAPI.cloudDevices();
      sel.innerHTML = Array.isArray(list) ? `<option value="">Alege…</option>${list.filter((d) => d.id !== gs.deviceId).map((d) => `<option value="${NX.esc(d.id)}" ${d.id === ws.remoteDeviceId ? 'selected' : ''}>${NX.esc(d.name)} ${d.online ? '· online' : '· offline'}</option>`).join('')}` : `<option value="">${NX.esc((list && list.error) || 'Conectează-te la cont')}</option>`;
    };
    NX.$('[data-dev]', host).addEventListener('change', (e) => { ws.remoteDeviceId = e.target.value; app.save(); });
    if (ws.mode === 'remote') loadDevices();
    S.bindSeg(host, 'aim', ai.mode, (v) => { ai.mode = v; NX.$('[data-ai="direct"]', host).classList.toggle('hidden', v !== 'direct'); app.save(); });
    NX.$('[data-k="endpoint"]', host).addEventListener('change', (e) => { ai.endpoint = e.target.value.trim(); app.save(); });
    NX.$('[data-k="apiKey"]', host).addEventListener('change', (e) => window.netorAPI.aiSecret({ apiKey: e.target.value.trim() }));
    window.netorAPI.aiHasSecret().then((h) => { if (h === true) NX.$('[data-k="apiKey"]', host).placeholder = '•••••••• (salvată; scrie alta ca s-o înlocuiești)'; });
    NX.$('[data-model]', host).addEventListener('change', (e) => { ai.model = e.target.value; app.save(); });
    NX.$('[data-test]', host).onclick = async () => {
      const out = NX.$('[data-out]', host);
      out.textContent = 'Testez conexiunea…';
      await new Promise((r) => setTimeout(r, 150));
      const r = await window.netorAPI.aiTest();
      if (!r || r.ok === false) { out.textContent = `Nu merge: ${(r && r.error) || 'eroare'}`; out.style.color = 'var(--danger)'; return; }
      out.textContent = `Conexiune bună · ${r.models.length} modele · ${r.ms} ms`;
      out.style.color = 'var(--success)';
      if (!ai.model || !r.models.includes(ai.model)) { ai.model = r.models.find((m) => /sonnet-strip-medium/.test(m)) || r.models.find((m) => /strip/.test(m)) || r.models[0] || ''; app.save(); }
      NX.$('[data-model]', host).innerHTML = r.models.map((m) => `<option ${m === ai.model ? 'selected' : ''}>${NX.esc(m)}</option>`).join('');
    };
  },

  // §4 Navigare, retea, descarcari
  browsing(app, host) {
    const gs = app.state.globalSettings;
    const S = window.NetorSettings;
    host.innerHTML = `${this.head('Navigare & căutare', '')}
      <div class="fld"><span>Motor de căutare din bara de adrese</span>${S.segHTML('se', [['google', 'Google'], ['bing', 'Bing'], ['duckduckgo', 'DuckDuckGo'], ['brave', 'Brave'], ['startpage', 'Startpage']], gs.searchEngine)}</div>
      <div class="fld" style="margin-top:16px"><span>La pornire</span>${S.segHTML('st', [['restore', 'Redeschide taburile de data trecută'], ['newtab', 'Plus un tab nou']], gs.startup)}</div>
      <div class="card" style="margin-top:16px">${this.sw('offerSavePasswords', 'Oferă salvarea parolelor în seif', 'După ce te autentifici pe un site.', gs.offerSavePasswords)}</div>
      <div class="row" style="margin-top:16px"><button class="btn" data-hist>${IC('history', 15)} Istoric (Ctrl+H)</button></div>`;
    S.bindSeg(host, 'se', gs.searchEngine, (v) => { gs.searchEngine = v; app.save(); });
    S.bindSeg(host, 'st', gs.startup, (v) => { gs.startup = v; app.save(); });
    this.bindSwitches(app, host, gs);
    NX.$('[data-hist]', host).onclick = () => window.NetorTools.history(app);
  },

  network(app, host) {
    const gs = app.state.globalSettings;
    const S = window.NetorSettings;
    host.innerHTML = `${this.head('Rețea & proxy', 'Proxy-ul implicit; fiecare browser din minibar și fiecare tab îl pot înlocui.')}
      ${S.proxyEditor('gp', gs.proxy, false)}<div class="row-end"><button class="btn primary" data-save>Aplică proxy-ul</button></div>
      <div class="card" style="margin-top:16px">${this.sw('adblock', 'Blochează reclamele și urmăritorii', 'Implicit pentru toate browserele.', gs.adblock)}</div>`;
    S.bindProxyEditor(host, 'gp');
    this.bindSwitches(app, host, gs);
    NX.$('[data-save]', host).onclick = () => { gs.proxy = S.readProxyEditor(host, 'gp'); app.commit(); NX.toast('Proxy aplicat. Taburile noi îl folosesc imediat.'); };
  },

  downloads(app, host) {
    const gs = app.state.globalSettings;
    const S = window.NetorSettings;
    host.innerHTML = `${this.head('Descărcări', '')}<div class="fld"><span>Folder implicit</span>${S.folderField('dl', gs.downloadDir)}</div>
      <div class="card" style="margin-top:14px">${this.sw('askDownload', 'Întreabă unde salvezi fiecare fișier', '', gs.askDownload)}</div>`;
    S.bindFolderField(host, 'dl', (p) => { gs.downloadDir = p; app.save(); });
    this.bindSwitches(app, host, gs);
  },

  // §5 Seif & PIN, extensii, despre
  security(app, host) { window.NetorVaultUI.securityPane(app, host); },
  extensions(app, host) { window.NetorTools.extensionsPane(app, host); },

  about(app, host) {
    host.innerHTML = `${this.head('Despre Netor', `Versiunea ${app.version} · motor Chromium ${navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || ''}`)}
      <div class="row"><button class="btn" data-upd>Verifică actualizări</button><span class="muted-text" data-out></span></div>`;
    NX.$('[data-upd]', host).onclick = async () => {
      const out = NX.$('[data-out]', host);
      const r = await window.netorAPI.checkUpdate();
      if (!r || r.ok === false) { out.textContent = `Nu am putut verifica: ${(r && r.error) || ''}`; return; }
      const newer = String(r.latest || '').localeCompare(r.current, undefined, { numeric: true }) > 0;
      out.innerHTML = newer ? `Versiune nouă: <b>${NX.esc(r.latest)}</b> <button class="btn small primary" data-dl>Descarcă</button>` : 'Ai ultima versiune.';
      const dl = NX.$('[data-dl]', host);
      if (dl) dl.onclick = () => window.NetorActions.openTab({ url: r.url });
    };
  },
};
