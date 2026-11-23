/* MAP
 * Scop: Minibarul de browsere (dreapta sau stanga): bulina per browser izolat (nume la hover, iconita, culori,
 *       insigna Privat), comutare, ordonare prin tragere, plasarea unui tab pe bulina (mutare), setarile
 *       minibarului (clic dreapta pe spatiul gol) si modalul de setari al fiecarui browser (clic dreapta pe bulina),
 *       plus proxy-ul pe un singur tab.
 * Legaturi: app.js, app-actions.js, settings.js (editor proxy, carduri tema), tabstrip.js (tragere tab)
 * Sectiuni:
 *   §1 Randare buline
 *   §2 Setari minibar
 *   §3 Setari browser
 *   §4 Proxy pe tab
 */

window.NetorMinibar = {
  dragId: null,

  // §1 Randare buline
  render(app) {
    const list = document.getElementById('minibarList');
    list.innerHTML = '';
    for (const b of app.state.browsers) {
      const dot = document.createElement('button');
      dot.className = `browser-dot${b.id === app.state.activeBrowserId ? ' active' : ''}`;
      dot.style.background = b.bgColor || '#1A73E8';
      dot.style.color = b.iconColor || '#FFFFFF';
      dot.dataset.tip = `${b.name}${b.allPrivate ? ' · toate taburile private' : ''}`;
      dot.draggable = true;
      dot.innerHTML = `<span>${NX.esc(b.icon || '🌐')}</span>${b.allPrivate ? '<span class="dot-badge">P</span>' : ''}`;
      dot.addEventListener('click', () => { app.state.activeBrowserId = b.id; app.commit(); });
      dot.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.browserSettings(app, b.id); });
      dot.addEventListener('dragstart', () => { this.dragId = b.id; });
      dot.addEventListener('dragover', (e) => { e.preventDefault(); dot.classList.add('drag-over'); });
      dot.addEventListener('dragleave', () => dot.classList.remove('drag-over'));
      dot.addEventListener('drop', (e) => {
        e.preventDefault();
        dot.classList.remove('drag-over');
        const tabDrag = window.NetorTabstrip.dragId;
        if (tabDrag && tabDrag.kind === 'tab') { window.NetorActions.moveTab(tabDrag.id, b.id, ''); return; }
        if (!this.dragId || this.dragId === b.id) return;
        const arr = app.state.browsers;
        const src = arr.find((x) => x.id === this.dragId);
        arr.splice(arr.indexOf(src), 1);
        arr.splice(arr.indexOf(b), 0, src);
        this.dragId = null;
        app.commit({ stage: false });
      });
      list.appendChild(dot);
    }
    const mb = document.getElementById('minibar');
    mb.oncontextmenu = (e) => {
      if (e.target.closest('.browser-dot') || e.target.closest('#btnGlobalSettings')) return;
      e.preventDefault();
      this.minibarSettings(app);
    };
    document.getElementById('btnGlobalSettings').innerHTML = IC('gear', 19);
    document.getElementById('btnGlobalSettings').onclick = () => window.NetorSettings.open(app);
    document.getElementById('btnAddBrowser').onclick = () => this.newBrowser(app);
  },

  newBrowser(app) {
    const colors = ['#0F9D58', '#DB4437', '#7C3AED', '#F4B400', '#EC4899', '#14B8A6', '#F97316', '#1A73E8'];
    const icons = ['💼', '🏠', '🛒', '🧪', '🎯', '🚀', '📈', '🧭'];
    const n = app.state.browsers.length;
    const { browserId } = window.NetorActions.createBrowser({ icon: icons[n % icons.length], bgColor: colors[n % colors.length] });
    this.browserSettings(app, browserId, true);
  },

  // §2 Setari minibar
  minibarSettings(app) {
    const mb = app.state.minibar;
    NX.openModal({
      title: 'Setări minibar', width: 460,
      body: `<div class="form-col"><div class="fld"><span>Poziție</span><div class="seg" data-seg="pos">
          <button data-v="left" class="${mb.position === 'left' ? 'on' : ''}">Stânga</button><button data-v="right" class="${mb.position !== 'left' ? 'on' : ''}">Dreapta</button></div></div>
        <div class="fld"><span>Culoarea de fundal</span>${NX.colorPickerHTML('bg', mb.bgColor)}</div></div>
        <div class="row-end"><button class="btn primary" data-ok>Salvează</button></div>`,
      onMount: (m) => {
        const bg = NX.bindPicker(m.body, 'bg', mb.bgColor);
        const pos = window.NetorSettings.bindSeg(m.body, 'pos', mb.position);
        NX.$('[data-ok]', m.body).onclick = () => { app.state.minibar = { position: pos(), bgColor: bg() }; app.commit(); m.close(); };
      },
    });
  },

  // §3 Setari browser
  browserSettings(app, id, isNew) {
    const b = app.browser(id);
    if (!b) return;
    const S = window.NetorSettings;
    NX.openModal({
      title: isNew ? 'Browser nou' : `Setări browser · ${b.name}`, width: 760, className: 'browser-settings',
      body: `<div class="bs-grid"><div class="form-col">
          <label class="fld"><span>Nume (apare la hover pe bulină și în titlul ferestrei)</span><input class="inp" data-k="name" value="${NX.esc(b.name)}"></label>
          <div class="fld"><span>Iconiță</span>${NX.iconPickerHTML('icon', b.icon)}</div>
          <div class="grid2"><div class="fld"><span>Culoare iconiță</span>${NX.colorPickerHTML('iconColor', b.iconColor)}</div>
          <div class="fld"><span>Fundal bulină</span>${NX.colorPickerHTML('bgColor', b.bgColor)}</div></div>
          <div class="fld"><span>Temă (ca să recunoști browserul dintr-o privire)</span>${S.themeGrid(b.theme, true)}</div></div>
        <div class="form-col">
          <div class="fld"><span>Proxy / SOCKS</span>${S.proxyEditor('bp', b.proxy, true)}</div>
          <div class="fld"><span>Folder descărcări</span>${S.folderField('dl', b.downloadDir, 'Ca în setările globale')}</div>
          <div class="fld"><span>Blocare reclame</span>${S.segHTML('adblock', [['inherit', 'Ca global'], ['on', 'Pornit'], ['off', 'Oprit']], b.adblock || 'inherit')}</div>
          <div class="fld"><span>Bara de favorite</span>${S.segHTML('fav', [['inherit', 'Ca global'], ['separate', 'Linie separată'], ['same', 'În bara de adrese']], b.favoritesMode || 'inherit')}</div>
          <label class="switch"><span class="sw-text">Toate taburile private<small>Fiecare tab are sesiunea lui în memorie: fără cookie-uri salvate sau partajate între taburi; la închiderea tabului nu rămâne nicio urmă.</small></span>
            <input type="checkbox" data-k="allPrivate" ${b.allPrivate ? 'checked' : ''}></label>
          <div class="row"><button class="btn small" data-clear>Șterge datele de navigare ale acestui browser</button></div></div></div>
        <div class="row-end">${app.state.browsers.length > 1 ? '<button class="btn danger" data-del style="margin-right:auto">Șterge browserul</button>' : ''}
          <button class="btn ghost" data-cancel>Anulează</button><button class="btn primary" data-ok>Salvează</button></div>`,
      onMount: (m) => {
        const r = m.body;
        const get = { icon: NX.bindPicker(r, 'icon', b.icon), iconColor: NX.bindPicker(r, 'iconColor', b.iconColor), bgColor: NX.bindPicker(r, 'bgColor', b.bgColor),
          theme: S.bindThemeGrid(r, b.theme), adblock: S.bindSeg(r, 'adblock', b.adblock || 'inherit'), fav: S.bindSeg(r, 'fav', b.favoritesMode || 'inherit') };
        S.bindProxyEditor(r, 'bp');
        S.bindFolderField(r, 'dl');
        NX.$('[data-cancel]', r).onclick = () => m.close();
        NX.$('[data-clear]', r).onclick = async () => { await window.netorAPI.clearBrowser({ browserId: b.id }); NX.toast('Datele de navigare au fost șterse.'); };
        const del = NX.$('[data-del]', r);
        if (del) del.onclick = () => { m.close(); window.NetorActions.deleteBrowser(b.id); };
        NX.$('[data-ok]', r).onclick = () => {
          const wasPrivate = b.allPrivate;
          const oldProxy = JSON.stringify(b.proxy);
          Object.assign(b, { name: NX.$('[data-k="name"]', r).value.trim() || b.name, icon: get.icon(), iconColor: get.iconColor(), bgColor: get.bgColor(), theme: get.theme(),
            proxy: S.readProxyEditor(r, 'bp'), downloadDir: S.readFolderField(r, 'dl'), adblock: get.adblock(), favoritesMode: get.fav(), allPrivate: NX.$('[data-k="allPrivate"]', r).checked });
          // Schimbarea modului privat sau a proxy-ului cere sesiuni noi: webview-urile se recreeaza
          if (wasPrivate !== b.allPrivate || oldProxy !== JSON.stringify(b.proxy)) b.tabs.forEach((t) => window.NetorWV.destroy(t.id, wasPrivate));
          window.NetorStage.structKey = '';
          app.commit();
          m.close();
        };
      },
    });
  },

  // §4 Proxy pe tab
  tabProxyModal(app, brw, tab) {
    const S = window.NetorSettings;
    NX.openModal({
      title: 'Proxy pentru acest tab', width: 520,
      body: `<p class="muted-text">Tabul primește o sesiune separată (cookie-uri proprii) ca să poată folosi alt proxy decât restul browserului.</p>
        ${S.proxyEditor('tp', tab.proxy || { mode: 'inherit' }, true)}
        <div class="row-end"><button class="btn ghost" data-cancel>Anulează</button><button class="btn primary" data-ok>Aplică</button></div>`,
      onMount: (m) => {
        S.bindProxyEditor(m.body, 'tp');
        NX.$('[data-cancel]', m.body).onclick = () => m.close();
        NX.$('[data-ok]', m.body).onclick = async () => {
          const p = S.readProxyEditor(m.body, 'tp');
          window.NetorWV.destroy(tab.id, true);
          if (p.mode === 'inherit') { delete tab.proxy; tab.isolated = false; } else { tab.proxy = p; tab.isolated = true; }
          window.NetorStage.structKey = '';
          app.commit();
          m.close();
        };
      },
    });
  },
};
