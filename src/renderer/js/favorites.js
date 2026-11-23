/* MAP
 * Scop: Favoritele Netor, comune tuturor browserelor: bara de favorite (pe linie separata sau in bara de
 *       adrese), foldere (meniuri derulante, si imbricate), adaugare/editare din stea, redenumire si stergere
 *       din clic dreapta, ordonare prin tragere, favicon-uri.
 * Legaturi: app.js (state.favorites), stage.js (bara pe aceeasi linie), app-actions.js
 * Sectiuni:
 *   §1 Randare bara
 *   §2 Element favorit / folder si meniurile lor
 *   §3 Adaugare / editare
 */

window.NetorFavorites = {
  dragId: null,

  // §1 Randare bara
  render(app) {
    const bar = document.getElementById('favbar');
    const mode = app.favoritesMode();
    const it = app.activeItem();
    const show = mode === 'separate' || (mode === 'same' && it.kind === 'group');
    bar.classList.toggle('hidden', !show);
    if (show) this.renderInto(app, bar);
    document.querySelectorAll('.fav-inline').forEach((el) => this.renderInto(app, el));
  },

  renderInto(app, host) {
    host.innerHTML = '';
    const top = app.state.favorites.filter((f) => !f.parentId);
    if (!top.length) {
      host.innerHTML = '<span class="fav-empty">Apasă ☆ din bara de adrese ca să adaugi favorite aici.</span>';
    }
    for (const f of top) host.appendChild(this.itemEl(app, f));
    host.oncontextmenu = (e) => {
      if (e.target.closest('.fav')) return;
      e.preventDefault();
      NX.showMenu([
        { label: 'Adaugă pagina curentă', icon: '☆', onClick: () => this.addCurrent(app) },
        { label: 'Folder nou…', icon: '📁', onClick: () => this.newFolder(app, '') },
        { separator: true },
        { label: 'Afișează pe linie separată', checked: app.state.globalSettings.favoritesMode === 'separate', onClick: () => { app.state.globalSettings.favoritesMode = 'separate'; app.commit(); } },
        { label: 'Afișează în bara de adrese', checked: app.state.globalSettings.favoritesMode === 'same', onClick: () => { app.state.globalSettings.favoritesMode = 'same'; app.commit(); } },
        { label: 'Ascunde bara de favorite', hint: 'Ctrl+Shift+B', onClick: () => { app.state.globalSettings.showFavorites = false; app.commit(); } },
      ], e.clientX, e.clientY);
    };
  },

  // §2 Element favorit / folder si meniurile lor
  itemEl(app, f) {
    const b = document.createElement('button');
    b.className = 'fav';
    b.draggable = true;
    b.title = f.type === 'folder' ? f.title : `${f.title}\n${f.url}`;
    const icon = f.type === 'folder' ? IC('folder', 14) : f.favicon ? `<img src="${NX.esc(f.favicon)}" alt="">` : IC('globe', 14);
    b.innerHTML = `${icon}<span>${NX.esc(f.title)}</span>`;
    b.addEventListener('click', (e) => {
      if (f.type === 'folder') { const r = b.getBoundingClientRect(); NX.showMenu(this.folderItems(app, f.id), r.left, r.bottom + 2); return; }
      this.open(app, f.url, e.ctrlKey || e.button === 1);
    });
    b.addEventListener('auxclick', (e) => { if (e.button === 1 && f.type === 'link') this.open(app, f.url, true); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); NX.showMenu(this.itemMenu(app, f), e.clientX, e.clientY); });
    b.addEventListener('dragstart', () => { this.dragId = f.id; });
    b.addEventListener('dragover', (e) => { if (this.dragId && this.dragId !== f.id) { e.preventDefault(); b.classList.add('drop-before'); } });
    b.addEventListener('dragleave', () => b.classList.remove('drop-before'));
    b.addEventListener('drop', (e) => {
      e.preventDefault();
      b.classList.remove('drop-before');
      const list = app.state.favorites;
      const src = list.find((x) => x.id === this.dragId);
      if (!src) return;
      list.splice(list.indexOf(src), 1);
      if (f.type === 'folder' && src.type === 'link') src.parentId = f.id;
      else { src.parentId = f.parentId; list.splice(list.indexOf(f), 0, src); }
      if (!list.includes(src)) list.push(src);
      app.commit({ stage: false });
    });
    return b;
  },

  folderItems(app, folderId) {
    const kids = app.state.favorites.filter((x) => x.parentId === folderId);
    if (!kids.length) return [{ label: 'Folder gol', disabled: true }];
    return kids.map((k) => (k.type === 'folder'
      ? { label: k.title, icon: '📁', submenu: this.folderItems(app, k.id) }
      : { label: k.title, icon: '☆', onClick: () => this.open(app, k.url, false) }))
      .concat([{ separator: true }, { label: 'Deschide toate în taburi', onClick: () => kids.filter((k) => k.type === 'link').forEach((k) => this.open(app, k.url, true)) }]);
  },

  itemMenu(app, f) {
    return [
      f.type === 'link' && { label: 'Deschide', onClick: () => this.open(app, f.url, false) },
      f.type === 'link' && { label: 'Deschide într-un tab nou', onClick: () => this.open(app, f.url, true) },
      { label: 'Editează…', icon: '✎', onClick: () => this.edit(app, f) },
      { label: 'Folder nou…', icon: '📁', onClick: () => this.newFolder(app, f.type === 'folder' ? f.id : f.parentId) },
      { separator: true },
      { label: 'Șterge', danger: true, onClick: () => this.remove(app, f.id) },
    ];
  },

  open(app, url, newTab) {
    const tab = app.focusedTab();
    if (newTab || !tab || tab.type !== 'web') window.NetorActions.openTab({ url, background: false });
    else window.NetorActions.navigate(tab.id, url);
  },

  remove(app, id) {
    const ids = new Set([id]);
    let grew = true;
    while (grew) { grew = false; for (const x of app.state.favorites) if (ids.has(x.parentId) && !ids.has(x.id)) { ids.add(x.id); grew = true; } }
    app.state.favorites = app.state.favorites.filter((x) => !ids.has(x.id));
    app.commit({ stage: false });
  },

  // §3 Adaugare / editare
  async newFolder(app, parentId) {
    const name = await NX.askText({ title: 'Folder nou', label: 'Nume folder', value: 'Folder nou', okLabel: 'Creează' });
    if (!name) return;
    app.state.favorites.push({ id: NX.uid('fold'), type: 'folder', title: name.trim(), parentId: parentId || '' });
    app.commit({ stage: false });
  },

  addCurrent(app) {
    const tab = app.focusedTab();
    if (tab && tab.type === 'web') this.toggleCurrent(app, tab, null, true);
  },

  toggleCurrent(app, tab, anchor, forceEdit) {
    if (!tab.url || tab.url.startsWith('netor:')) return;
    let fav = app.state.favorites.find((f) => f.type === 'link' && f.url === tab.url);
    if (!fav) {
      fav = { id: NX.uid('fav'), type: 'link', title: tab.customTitle || tab.title || tab.url, url: tab.url, favicon: tab.favicon || '', parentId: '' };
      app.state.favorites.push(fav);
      app.commit({ stage: false });
      window.NetorStage.updateBar(app, tab.id);
    }
    if (anchor || forceEdit) this.edit(app, fav, true);
  },

  edit(app, f, isNew) {
    const folders = app.state.favorites.filter((x) => x.type === 'folder' && x.id !== f.id);
    NX.openModal({
      title: isNew ? 'Favorit adăugat' : 'Editează favoritul', width: 440,
      body: `<div class="form-col"><label class="fld"><span>Nume</span><input class="inp" data-k="title" value="${NX.esc(f.title)}"></label>
        ${f.type === 'link' ? `<label class="fld"><span>Adresă</span><input class="inp" data-k="url" value="${NX.esc(f.url)}"></label>` : ''}
        <label class="fld"><span>Folder</span><select class="inp" data-k="parentId"><option value="">Bara de favorite</option>
        ${folders.map((x) => `<option value="${x.id}" ${x.id === f.parentId ? 'selected' : ''}>${NX.esc(x.title)}</option>`).join('')}</select></label></div>
        <div class="row-end">${isNew ? '<button class="btn danger" data-del>Elimină</button>' : ''}<button class="btn ghost" data-cancel>Anulează</button><button class="btn primary" data-ok>Gata</button></div>`,
      onMount: (m) => {
        const g = (k) => m.body.querySelector(`[data-k="${k}"]`);
        NX.$('[data-ok]', m.body).onclick = () => {
          f.title = g('title').value.trim() || f.title;
          if (g('url')) f.url = g('url').value.trim() || f.url;
          f.parentId = g('parentId').value;
          app.commit({ stage: false });
          m.close();
        };
        NX.$('[data-cancel]', m.body).onclick = () => m.close();
        const del = NX.$('[data-del]', m.body);
        if (del) del.onclick = () => { this.remove(app, f.id); m.close(); app.render(); };
        setTimeout(() => g('title').select(), 30);
      },
    });
  },
};
