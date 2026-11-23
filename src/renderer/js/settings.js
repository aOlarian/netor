/* MAP
 * Scop: Fereastra de Setari globale (navigare in stanga pe sectiuni, continut in dreapta) si componentele de
 *       formular reutilizate: grila de teme cu previzualizare, editor proxy structurat (tip, host, port,
 *       utilizator, parola, exceptii, test), alegere folder cu dialogul Windows, butoane segmentate.
 * Legaturi: settings-panes.js (continutul sectiunilor), minibar.js (setari browser), vault-ui.js
 * Sectiuni:
 *   §1 Fereastra setari
 *   §2 Butoane segmentate si grila de teme
 *   §3 Editor proxy
 *   §4 Camp folder
 */

window.NetorSettings = {
  SECTIONS: [
    ['account', 'Cont & sincronizare', 'cloud'], ['appearance', 'Aspect', 'layers'], ['workspace', 'Workspace & AI', 'sparkles'],
    ['browsing', 'Navigare & căutare', 'search'], ['network', 'Rețea & proxy', 'globe'], ['downloads', 'Descărcări', 'download'],
    ['security', 'Seif & PIN', 'lock'], ['extensions', 'Extensii', 'puzzle'],
    ['-', 'Date salvate'], ['logins', 'Parole', 'key'], ['cards', 'Carduri', 'card'], ['addresses', 'Adrese', 'home'],
    ['companies', 'Companii', 'building'], ['identities', 'Identități', 'user'], ['contacts', 'Contacte', 'phone'], ['dataGroups', 'Grupuri de date', 'layers'],
    ['-', ''], ['about', 'Despre Netor', 'info'],
  ],

  // §1 Fereastra setari
  open(app, section = 'account') {
    NX.openModal({
      title: 'Setări globale', wide: true, className: 'settings-modal',
      body: `<div class="settings-shell"><nav class="settings-nav">${this.SECTIONS.map(([id, label, icon]) => (id === '-'
        ? `<div class="settings-nav-sep">${NX.esc(label)}</div>`
        : `<button data-sec="${id}">${IC(icon, 16)}<span>${NX.esc(label)}</span></button>`)).join('')}</nav>
        <div class="settings-content" id="settingsContent"></div></div>`,
      onMount: (m) => {
        const show = (id) => {
          m.body.querySelectorAll('[data-sec]').forEach((b) => b.classList.toggle('on', b.dataset.sec === id));
          const host = m.body.querySelector('#settingsContent');
          host.innerHTML = '';
          host.scrollTop = 0;
          window.NetorSettingsPanes.render(app, id, host, m);
        };
        m.body.querySelectorAll('[data-sec]').forEach((b) => b.addEventListener('click', () => show(b.dataset.sec)));
        show(section);
      },
    });
  },

  // §2 Butoane segmentate si grila de teme
  segHTML(name, options, value) {
    return `<div class="seg" data-seg="${name}">${options.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === value ? 'on' : ''}">${NX.esc(l)}</button>`).join('')}</div>`;
  },

  bindSeg(root, name, initial, onChange) {
    let value = initial;
    const seg = root.querySelector(`[data-seg="${name}"]`);
    if (!seg) return () => value;
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      value = b.dataset.v;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      if (onChange) onChange(value);
    });
    return () => value;
  },

  themeGrid(current, allowInherit) {
    const T = window.NetorThemes;
    const inherit = allowInherit ? `<button class="theme-card inherit${current === 'inherit' || !current ? ' selected' : ''}" data-theme="inherit"><div class="theme-mock inherit-mock">Ca în setările globale</div><div class="theme-card-name">Implicită</div></button>` : '';
    return `<div class="theme-grid">${inherit}${Object.keys(T.NETOR_THEMES).map((k) => T.themePreviewHTML(k, k === current)).join('')}</div>`;
  },

  bindThemeGrid(root, initial, onChange) {
    let value = initial || 'inherit';
    const grid = root.querySelector('.theme-grid');
    grid.addEventListener('click', (e) => {
      const c = e.target.closest('[data-theme]');
      if (!c) return;
      value = c.dataset.theme;
      grid.querySelectorAll('.theme-card').forEach((x) => x.classList.toggle('selected', x === c));
      if (onChange) onChange(value);
    });
    return () => value;
  },

  // §3 Editor proxy
  proxyEditor(prefix, p = {}, allowInherit) {
    const mode = p.mode || (allowInherit ? 'inherit' : 'system');
    const modes = [...(allowInherit ? [['inherit', 'Ca global']] : []), ['system', 'Sistem'], ['direct', 'Fără proxy'], ['custom', 'Proxy propriu']];
    const v = (k, d = '') => NX.esc(p[k] ?? d);
    return `<div class="proxy-editor" data-proxy="${prefix}">${this.segHTML(`${prefix}-mode`, modes, mode)}
      <div class="proxy-fields ${mode === 'custom' ? '' : 'hidden'}">
        <div class="grid3"><label class="fld"><span>Tip</span><select class="inp" data-p="scheme">
          ${['http', 'https', 'socks5', 'socks4'].map((s) => `<option value="${s}" ${s === (p.scheme || 'socks5') ? 'selected' : ''}>${s.toUpperCase()}</option>`).join('')}</select></label>
          <label class="fld"><span>Server (host)</span><input class="inp" data-p="host" value="${v('host')}" placeholder="127.0.0.1"></label>
          <label class="fld"><span>Port</span><input class="inp" data-p="port" value="${v('port')}" placeholder="1080" inputmode="numeric"></label></div>
        <div class="grid2"><label class="fld"><span>Utilizator (opțional)</span><input class="inp" data-p="username" value="${v('username')}" autocomplete="off"></label>
          <label class="fld"><span>Parolă (opțional)</span><input class="inp" type="password" data-p="password" value="${v('password')}" autocomplete="new-password"></label></div>
        <label class="fld"><span>Fără proxy pentru</span><input class="inp" data-p="bypass" value="${v('bypass', '<local>')}"><small class="help">Separă cu virgulă, ex: &lt;local&gt;, *.intern.ro</small></label>
        <div class="row"><button type="button" class="btn small" data-test>Testează proxy-ul</button><span class="muted-text" data-test-out></span></div>
      </div></div>`;
  },

  bindProxyEditor(root, prefix) {
    const ed = root.querySelector(`[data-proxy="${prefix}"]`);
    const fields = ed.querySelector('.proxy-fields');
    this.bindSeg(ed, `${prefix}-mode`, null, (v) => fields.classList.toggle('hidden', v !== 'custom'));
    ed.querySelector('[data-test]').addEventListener('click', async () => {
      const out = ed.querySelector('[data-test-out]');
      out.textContent = 'Testez…';
      const r = await window.netorAPI.testProxy(this.readProxyEditor(root, prefix));
      out.textContent = r && r.ok ? `Funcționează · IP ieșire ${r.ip} · ${r.ms} ms` : `Nu merge: ${(r && r.error) || 'eroare'}`;
      out.style.color = r && r.ok ? 'var(--success)' : 'var(--danger)';
    });
  },

  readProxyEditor(root, prefix) {
    const ed = root.querySelector(`[data-proxy="${prefix}"]`);
    const mode = ed.querySelector(`[data-seg="${prefix}-mode"] .on`).dataset.v;
    if (mode !== 'custom') return { mode };
    const g = (k) => ed.querySelector(`[data-p="${k}"]`).value.trim();
    return { mode, scheme: g('scheme'), host: g('host'), port: g('port'), username: g('username'), password: ed.querySelector('[data-p="password"]').value, bypass: g('bypass') };
  },

  // §4 Camp folder (alegere cu dialogul Windows, nu scris de mana)
  folderField(name, value, emptyLabel = 'Neselectat') {
    return `<div class="folder-field" data-folder="${name}" data-value="${NX.esc(value || '')}">${IC('folder', 16)}
      <span class="folder-path">${NX.esc(value || emptyLabel)}</span>
      <button type="button" class="btn small" data-pick>Alege…</button>${value ? '<button type="button" class="btn small ghost" data-clear>Resetează</button>' : ''}</div>`;
  },

  bindFolderField(root, name, onChange) {
    const f = root.querySelector(`[data-folder="${name}"]`);
    const empty = f.querySelector('.folder-path').textContent;
    f.addEventListener('click', async (e) => {
      if (e.target.closest('[data-clear]')) { f.dataset.value = ''; f.querySelector('.folder-path').textContent = empty; e.target.remove(); if (onChange) onChange(''); return; }
      if (!e.target.closest('[data-pick]')) return;
      const p = await window.netorAPI.pickFolder({ title: 'Alege folderul', defaultPath: f.dataset.value || undefined });
      if (typeof p !== 'string' || !p) return;
      f.dataset.value = p;
      f.querySelector('.folder-path').textContent = p;
      if (onChange) onChange(p);
    });
  },

  readFolderField(root, name) { return root.querySelector(`[data-folder="${name}"]`).dataset.value || ''; },
};
