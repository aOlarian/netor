/* MAP
 * Scop: Notele Netor (comune tuturor browserelor): panoul lateral cu lista (cautare, creare, redenumire,
 *       stergere), editorul cu salvare automata, deschiderea ca tab, fixarea si adaugarea intr-un grup
 *       (agentul din grup citeste notele grupului), scrierea din agent (note_write).
 * Legaturi: app-actions.js (taburi/grupuri), stage.js (panou nota), agents.js
 * Sectiuni:
 *   §1 Utilitare si creare
 *   §2 Panoul lateral
 *   §3 Editorul
 */

window.NetorNotes = {
  // §1 Utilitare si creare
  title(app, id) { const n = app.state.notes.find((x) => x.id === id); return n ? n.title : 'Notă ștearsă'; },

  create(app, title = 'Notă nouă', content = '') {
    const n = { id: NX.uid('note'), title, content, updatedAt: Date.now() };
    app.state.notes.unshift(n);
    app.save();
    return n;
  },

  openAsTab(app, noteId, groupId) {
    const brw = app.activeBrowser();
    const ex = brw.tabs.find((t) => t.type === 'note' && t.refId === noteId);
    if (ex && !groupId) { window.NetorActions.activateTab(ex.id); return; }
    if (ex && groupId) { window.NetorActions.addToGroup(ex.id, groupId, brw); return; }
    window.NetorActions.openTab({ type: 'note', refId: noteId, groupId, title: this.title(app, noteId) });
  },

  createInGroup(app, groupId) {
    const n = this.create(app);
    this.openAsTab(app, n.id, groupId);
  },

  write(app, { title, content, append }) {
    let n = app.state.notes.find((x) => x.title.toLowerCase() === String(title || '').toLowerCase());
    if (!n) n = this.create(app, title || 'Notă agent', '');
    n.content = append ? `${n.content || ''}${n.content ? '\n' : ''}${content}` : String(content || '');
    n.updatedAt = Date.now();
    app.save();
    document.querySelectorAll(`textarea[data-note="${n.id}"]`).forEach((ta) => { if (document.activeElement !== ta) ta.value = n.content; });
    return { ok: true, title: n.title, chars: n.content.length };
  },

  // §2 Panoul lateral
  openSidebar(app) {
    window.NetorTools.openSidebar(app, 'notes', 'Note', (body, actions) => {
      actions.innerHTML = `<button class="icon-btn" data-new title="Notă nouă">${IC('plus', 16)}</button>`;
      NX.$('[data-new]', actions).onclick = () => { const n = this.create(app); this.renderList(app, body, n.id); };
      this.renderList(app, body);
    });
  },

  renderList(app, body, editId) {
    body.innerHTML = `<div class="search-box">${IC('search', 14)}<input class="inp" placeholder="Caută în note" data-q></div><div class="note-list" data-list></div><div data-editor></div>`;
    const draw = () => {
      const q = NX.$('[data-q]', body).value.toLowerCase();
      const list = NX.$('[data-list]', body);
      const notes = app.state.notes.filter((n) => !q || n.title.toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q));
      list.innerHTML = notes.length ? notes.map((n) => `<div class="note-item" data-id="${n.id}"><b>${NX.esc(n.title)}</b><small>${NX.esc((n.content || '').slice(0, 90) || 'goală')}</small></div>`).join('')
        : '<div class="empty">Nicio notă. Apasă + ca să creezi una.</div>';
    };
    NX.$('[data-q]', body).addEventListener('input', draw);
    NX.$('[data-list]', body).addEventListener('click', (e) => { const it = e.target.closest('.note-item'); if (it) this.renderList(app, body, it.dataset.id); });
    NX.$('[data-list]', body).addEventListener('contextmenu', (e) => {
      const it = e.target.closest('.note-item');
      if (!it) return;
      e.preventDefault();
      NX.showMenu(this.noteMenu(app, it.dataset.id, () => this.renderList(app, body)), e.clientX, e.clientY);
    });
    draw();
    if (editId) {
      NX.$('[data-list]', body).classList.add('hidden');
      NX.$('[data-q]', body).parentElement.classList.add('hidden');
      const ed = NX.$('[data-editor]', body);
      ed.innerHTML = `<div class="row"><button class="btn small ghost" data-back>${IC('back', 14)} Toate notele</button><span class="grow"></span>
        <button class="btn small" data-tab>Deschide ca tab</button><button class="icon-btn" data-more>${IC('dots', 15)}</button></div><div class="note-host"></div>`;
      NX.$('[data-back]', ed).onclick = () => this.renderList(app, body);
      NX.$('[data-tab]', ed).onclick = () => this.openAsTab(app, editId);
      NX.$('[data-more]', ed).onclick = (e) => NX.showMenu(this.noteMenu(app, editId, () => this.renderList(app, body)), e.clientX, e.clientY);
      this.mountEditor(app, NX.$('.note-host', ed), editId);
    }
  },

  noteMenu(app, id, after) {
    const brw = app.activeBrowser();
    return [
      { label: 'Deschide ca tab', onClick: () => this.openAsTab(app, id) },
      { label: 'Adaugă în grup', submenu: [...brw.groups.map((g) => ({ label: g.name, icon: '●', onClick: () => this.openAsTab(app, id, g.id) })),
        { separator: true }, { label: 'Grup nou…', icon: '+', onClick: async () => { const g = await window.NetorActions.createGroup(null); if (g) this.openAsTab(app, id, g.id); } }] },
      { label: 'Redenumește…', onClick: async () => { const n = app.state.notes.find((x) => x.id === id); const t = await NX.askText({ title: 'Redenumește nota', label: 'Titlu', value: n.title }); if (t) { n.title = t.trim(); app.commit({ stage: false }); after(); } } },
      { separator: true },
      { label: 'Șterge nota', danger: true, onClick: async () => {
        if (!await NX.confirmBox({ title: 'Șterge nota', message: 'Nota se șterge definitiv.', okLabel: 'Șterge', danger: true })) return;
        app.state.notes = app.state.notes.filter((x) => x.id !== id);
        for (const b of app.state.browsers) for (const t of b.tabs.filter((x) => x.type === 'note' && x.refId === id)) window.NetorActions.closeTab(t.id);
        app.commit();
        after();
      } },
    ];
  },

  // §3 Editorul
  mountEditor(app, host, noteId) {
    const n = app.state.notes.find((x) => x.id === noteId);
    if (!n) { host.innerHTML = '<div class="empty">Nota a fost ștearsă.</div>'; return; }
    host.innerHTML = `<input class="note-title" value="${NX.esc(n.title)}" placeholder="Titlu"><textarea class="note-area" data-note="${n.id}" placeholder="Scrie aici… (se salvează automat)"></textarea>
      <div class="note-foot muted-text"></div>`;
    const ta = NX.$('textarea', host);
    const foot = NX.$('.note-foot', host);
    ta.value = n.content || '';
    const stamp = () => { foot.textContent = `Salvat · ${new Date(n.updatedAt || Date.now()).toLocaleTimeString('ro-RO')}`; };
    stamp();
    let t = 0;
    ta.addEventListener('input', () => {
      n.content = ta.value;
      n.updatedAt = Date.now();
      clearTimeout(t);
      t = setTimeout(() => { app.save(); stamp(); }, 300);
    });
    NX.$('.note-title', host).addEventListener('change', (e) => { n.title = e.target.value.trim() || 'Fără titlu'; app.commit({ stage: false }); });
  },
};
