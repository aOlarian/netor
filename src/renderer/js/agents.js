/* MAP
 * Scop: Agentii AI Netor: fereastra de agenti (lista comuna + chatul ales), a browserului in care o deschizi:
 *       in panoul lateral al acelui browser, ca tab sau ca fereastra intr-un grup. Chatul:
 *       selector de model, Options (Enter trimite, pasi vizibili, fara autocompresie, istoric fara rezultate
 *       de unelte), Loop cu numar de reluari (agentul il poate opri singur), Stop, context de grup.
 * Legaturi: src/main/agent-runner.js (evenimente netor:agent-event), app-actions.js, stage.js
 * Sectiuni:
 *   §1 Utilitare, creare, panoul lateral
 *   §2 Chatul (montare, controale)
 *   §3 Mesaje si randare text
 *   §4 Trimitere, stop, evenimente
 */

window.NetorAgents = {
  models: null,
  busy: {},

  // §1 Utilitare, creare, panoul lateral
  title(app, id) { const a = app.state.agents.find((x) => x.id === id); return a ? a.name : 'Agent șters'; },

  create(app, name) {
    const a = { id: NX.uid('agent'), name: name || `Agent ${app.state.agents.length + 1}`, model: app.state.globalSettings.ai.model || '',
      loop: { enabled: false, count: 0 }, options: { enterSends: true, debug: false, skipCompress: false, toolsless: false }, updatedAt: Date.now() };
    app.state.agents.unshift(a);
    app.save();
    return a;
  },

  openAsTab(app, agentId, groupId) {
    const brw = app.activeBrowser();
    const ex = brw.tabs.find((t) => t.type === 'agent' && t.refId === agentId);
    if (ex && !groupId) { window.NetorActions.activateTab(ex.id); return; }
    if (ex && groupId) { window.NetorActions.addToGroup(ex.id, groupId, brw); return; }
    window.NetorActions.openTab({ type: 'agent', refId: agentId, groupId, title: agentId ? this.title(app, agentId) : 'Agenți' });
  },

  createInGroup(app, groupId) { this.openAsTab(app, this.create(app).id, groupId); },

  // Fereastra de agenti (lista comuna + chatul ales) e a browserului in care o deschizi: in panoul lateral
  // al acelui browser, ca tab sau ca fereastra intr-un grup. Chatul lucreaza doar pe browserul ei.
  openSidebar(app, agentId) {
    const brwId = app.state.activeBrowserId;
    window.NetorTools.openSidebar(app, 'agents', 'Agenți', (body, actions) => {
      window.NetorTools.rememberSidebar(brwId, 'agents', { agentId: agentId || '' });
      actions.innerHTML = `<button class="icon-btn" data-new title="Agent nou">${IC('plus', 16)}</button>
        <button class="icon-btn" data-tab title="Deschide fereastra de agenți ca tab">${IC('maximize', 15)}</button>
        <button class="icon-btn" data-grp title="Adaugă fereastra de agenți într-un grup">${IC('grid', 15)}</button>`;
      NX.$('[data-new]', actions).onclick = async () => { const a = await this.askNew(app); if (a) this.openSidebar(app, a.id); };
      NX.$('[data-tab]', actions).onclick = () => { window.NetorTools.closeSidebar(); this.openAsTab(app, agentId || ''); };
      NX.$('[data-grp]', actions).onclick = (e) => NX.showMenu(this.groupTargets(app, (gid) => { window.NetorTools.closeSidebar(); this.openAsTab(app, agentId || '', gid); }), e.clientX, e.clientY);
      if (agentId) { this.mountChat(app, body, agentId, brwId, () => this.openSidebar(app)); return; }
      this.listInto(app, body, (id) => this.openSidebar(app, id), () => this.openSidebar(app));
    });
  },

  async askNew(app) {
    const n = await NX.askText({ title: 'Agent nou', label: 'Numele agentului', value: `Agent ${app.state.agents.length + 1}`, okLabel: 'Creează' });
    return n ? this.create(app, n.trim()) : null;
  },

  groupTargets(app, pick) {
    const brw = app.activeBrowser();
    return [...brw.groups.map((g) => ({ label: g.name, icon: '●', onClick: () => pick(g.id) })), brw.groups.length && { separator: true },
      { label: 'Grup nou…', icon: '+', onClick: async () => { const g = await window.NetorActions.createGroup(null); if (g) pick(g.id); } }];
  },

  listInto(app, body, pick, after) {
    body.innerHTML = app.state.agents.length ? app.state.agents.map((a) => `<div class="note-item" data-id="${a.id}"><b>${IC('agent', 14)} ${NX.esc(a.name)}</b><small>${NX.esc(a.model || 'model implicit')}${a.loop && a.loop.enabled ? ` · loop ${a.loop.count}` : ''}</small></div>`).join('')
      : '<div class="empty">Niciun agent. Apasă + ca să creezi unul.</div>';
    body.onclick = (e) => { const it = e.target.closest('.note-item'); if (it) pick(it.dataset.id); };
    body.oncontextmenu = (e) => { const it = e.target.closest('.note-item'); if (!it) return; e.preventDefault(); NX.showMenu(this.agentMenu(app, it.dataset.id, after), e.clientX, e.clientY); };
  },

  paneTitle(app, tab) { return tab.refId ? this.title(app, tab.refId) : 'Agenți'; },

  // Fereastra de agenti ca tab sau in grup: tab.refId = agentul deschis acum ('' = lista)
  mountPane(app, host, tab, browserId) {
    const titleEl = host.parentElement && host.parentElement.querySelector('.pane-title');
    if (titleEl && !tab.customTitle) titleEl.textContent = this.paneTitle(app, tab);
    const go = (id) => { tab.refId = id; tab.title = this.paneTitle(app, tab); app.save(); window.NetorTabstrip.render(app); this.mountPane(app, host, tab, browserId); };
    if (tab.refId && app.state.agents.some((a) => a.id === tab.refId)) { this.mountChat(app, host, tab.refId, browserId, () => go(''), tab.groupId || ''); return; }
    host.innerHTML = `<div class="agents-pane"><div class="agents-pane-head"><button class="btn small" data-new>${IC('plus', 14)} Agent nou</button></div><div class="agents-pane-list"></div></div>`;
    NX.$('[data-new]', host).onclick = async () => { const a = await this.askNew(app); if (a) go(a.id); };
    this.listInto(app, NX.$('.agents-pane-list', host), go, () => this.mountPane(app, host, tab, browserId));
  },

  agentMenu(app, id, after) {
    return [
      { label: 'Deschide ca tab', onClick: () => this.openAsTab(app, id) },
      { label: 'Adaugă în grup', submenu: this.groupTargets(app, (gid) => this.openAsTab(app, id, gid)) },
      { label: 'Redenumește…', onClick: async () => { const a = app.state.agents.find((x) => x.id === id); const t = await NX.askText({ title: 'Redenumește agentul', label: 'Nume', value: a.name }); if (t) { a.name = t.trim(); app.commit(); after && after(); } } },
      { label: 'Golește conversația', onClick: async () => { await window.netorAPI.agentClear({ agentId: id }); this.refreshMessages(app, id); } },
      { separator: true },
      { label: 'Șterge agentul', danger: true, onClick: async () => {
        if (!await NX.confirmBox({ title: 'Șterge agentul', message: 'Agentul și conversația lui se șterg definitiv.', okLabel: 'Șterge', danger: true })) return;
        app.state.agents = app.state.agents.filter((x) => x.id !== id);
        // Ferestrele de agenti raman deschise si revin la lista
        for (const b of app.state.browsers) for (const t of b.tabs.filter((x) => x.type === 'agent' && x.refId === id)) { t.refId = ''; t.title = 'Agenți'; }
        window.NetorStage.structKey = '';
        await window.netorAPI.agentDelete({ agentId: id });
        app.commit();
        after && after();
      } },
    ];
  },

  // §2 Chatul (montare, controale)
  async mountChat(app, host, agentId, browserId, onBack, groupId = '') {
    const a = app.state.agents.find((x) => x.id === agentId);
    if (!a) { host.innerHTML = '<div class="empty">Agentul a fost șters.</div>'; return; }
    a.options = { enterSends: true, ...(a.options || {}) };
    a.loop = { enabled: false, count: 0, ...(a.loop || {}) };
    host.innerHTML = `<div class="chat" data-agent-chat="${a.id}" data-browser="${browserId}" data-group="${groupId}">
      <div class="chat-top">${onBack ? `<button class="icon-btn" data-back title="Toți agenții">${IC('back', 15)}</button><b class="chat-name">${NX.esc(a.name)}</b>` : ''}
        <select class="inp chat-model" data-model title="Model"></select>
        <label class="loop-box" title="Când agentul se oprește, îl trezește automat de câte ori alegi. Agentul poate opri singur bucla dacă nu mai are ce face."><input type="checkbox" data-loop ${a.loop.enabled ? 'checked' : ''}> Loop
          <input type="number" class="inp" data-loopn min="0" max="200" value="${a.loop.count || 0}"></label>
        <button class="btn small" data-opts>Options</button></div>
      <div class="chat-ctx muted-text" data-ctx></div><div class="chat-msgs" data-msgs></div>
      <div class="chat-compose"><textarea class="inp" data-input rows="2" placeholder="Scrie agentului… (Enter trimite, Shift+Enter rând nou)"></textarea>
        <button class="btn primary" data-send>${IC('send', 15)}</button></div></div>`;
    const chat = NX.$('.chat', host);
    if (onBack) NX.$('[data-back]', chat).onclick = onBack;
    this.fillModels(app, a, NX.$('[data-model]', chat));
    NX.$('[data-model]', chat).addEventListener('change', (e) => { a.model = e.target.value; app.save(); });
    const syncLoop = () => { a.loop = { enabled: NX.$('[data-loop]', chat).checked && Number(NX.$('[data-loopn]', chat).value) > 0, count: Math.max(0, Number(NX.$('[data-loopn]', chat).value) || 0) }; app.save(); };
    NX.$('[data-loop]', chat).addEventListener('change', () => { if (NX.$('[data-loop]', chat).checked && !Number(NX.$('[data-loopn]', chat).value)) NX.$('[data-loopn]', chat).value = 5; syncLoop(); });
    NX.$('[data-loopn]', chat).addEventListener('change', syncLoop);
    NX.$('[data-opts]', chat).onclick = (e) => {
      const o = a.options;
      const t = (k) => () => { o[k] = !o[k]; app.save(); if (k === 'debug') this.refreshMessages(app, a.id); };
      NX.showMenu([{ label: 'Enter trimite mesajul', checked: o.enterSends, onClick: t('enterSends') }, { label: 'Arată pașii (unelte și rezultate)', checked: o.debug, onClick: t('debug') },
        { label: 'Fără autocompresie', checked: o.skipCompress, onClick: t('skipCompress') }, { label: 'Istoric fără rezultatele uneltelor vechi', checked: o.toolsless, onClick: t('toolsless') },
        { separator: true }, ...this.agentMenu(app, a.id, onBack)], e.clientX, e.clientY);
    };
    const input = NX.$('[data-input]', chat);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && a.options.enterSends) { e.preventDefault(); this.send(app, a.id, chat); } });
    NX.$('[data-send]', chat).onclick = () => (this.busy[a.id] ? window.netorAPI.agentStop({ agentId: a.id }) : this.send(app, a.id, chat));
    await app.flush();
    const ctx = await window.netorAPI.agentContext({ agentId: a.id, browserId, groupId });
    NX.$('[data-ctx]', chat).textContent = ctx && ctx.group ? `În grupul „${ctx.group.name}”: ${ctx.webTabs.length} taburi web, ${ctx.notes.length} note` : `În browserul „${(ctx && ctx.browserName) || ''}” · ținta: tabul activ`;
    await this.refreshMessages(app, a.id);
  },

  async fillModels(app, a, sel) {
    if (!this.models) {
      const r = await window.netorAPI.aiModels();
      this.models = r && r.models ? r.models : [];
    }
    const list = this.models.length ? this.models : [a.model || app.state.globalSettings.ai.model].filter(Boolean);
    // Un model care nu mai exista la furnizor e inlocuit cu modelul implicit din setari
    if (a.model && this.models.length && !this.models.includes(a.model)) { a.model = ''; app.save(); }
    const cur = a.model || app.state.globalSettings.ai.model;
    sel.innerHTML = list.length ? list.map((m) => `<option ${m === cur ? 'selected' : ''}>${NX.esc(m)}</option>`).join('') : '<option value="">Configurează AI în setări</option>';
    if (!a.model && list[0]) a.model = cur || list[0];
  },

  refreshControls(app, id) {
    const a = app.state.agents.find((x) => x.id === id);
    document.querySelectorAll(`[data-agent-chat="${id}"]`).forEach((chat) => {
      NX.$('[data-loop]', chat).checked = !!(a.loop && a.loop.enabled);
      NX.$('[data-loopn]', chat).value = (a.loop && a.loop.count) || 0;
    });
  },

  // §3 Mesaje si randare text
  async refreshMessages(app, id) {
    const conv = await window.netorAPI.agentConv({ agentId: id });
    this.busy[id] = !!(conv && conv.busy);
    const a = app.state.agents.find((x) => x.id === id);
    document.querySelectorAll(`[data-agent-chat="${id}"]`).forEach((chat) => {
      const box = NX.$('[data-msgs]', chat);
      box.innerHTML = (conv.messages || []).length ? '' : '<div class="empty">Spune-i agentului ce să facă. Dacă e într-un grup, folosește automat taburile și notele grupului.</div>';
      if (conv.summary) box.insertAdjacentHTML('beforeend', '<div class="msg sys">Conversația veche a fost rezumată automat; mai jos vezi și mesajele originale.</div>');
      for (const m of conv.messages || []) box.appendChild(this.msgEl(m, a && a.options && a.options.debug));
      box.scrollTop = box.scrollHeight;
      this.setBusyUI(chat, this.busy[id]);
    });
  },

  msgEl(m, debug) {
    const el = document.createElement('div');
    if (m.role === 'tool') {
      el.className = `msg tool${debug ? '' : ' hidden'}`;
      el.innerHTML = `<details><summary>${IC('zap', 12)} rezultat ${NX.esc(m.tool || '')}</summary><pre>${NX.esc(m.text.slice(0, 4000))}</pre></details>`;
      return el;
    }
    el.className = `msg ${m.role}${m.archived ? ' archived' : ''}`;
    let text = m.text;
    if (m.role === 'assistant') {
      const tool = /<tool>\s*([\s\S]*?)\s*<\/tool>/i.exec(text);
      text = text.replace(/<tool>[\s\S]*?<\/tool>/gi, '').trim();
      let call = '';
      if (tool) { try { const j = JSON.parse(tool[1]); call = `<div class="tool-call">${IC('zap', 12)} ${NX.esc(j.name)} ${debug ? `<code>${NX.esc(JSON.stringify(j.args || {}).slice(0, 200))}</code>` : ''}</div>`; } catch (_) { call = '<div class="tool-call">unealtă</div>'; } }
      el.innerHTML = (text ? md(text) : '') + call;
    } else el.innerHTML = md(text);
    return el;
  },

  setBusyUI(chat, busy) {
    const b = NX.$('[data-send]', chat);
    b.innerHTML = busy ? IC('square', 15) : IC('send', 15);
    b.title = busy ? 'Stop' : 'Trimite';
    b.classList.toggle('danger', busy);
    chat.classList.toggle('busy', busy);
  },

  // §4 Trimitere, stop, evenimente
  async send(app, id, chat) {
    const input = NX.$('[data-input]', chat);
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await app.flush();
    const r = await window.netorAPI.agentTurn({ agentId: id, browserId: chat.dataset.browser, groupId: chat.dataset.group || '', text });
    if (r && r.ok === false && r.error) NX.toast(r.error, 'error', 5000);
  },

  bindEvents(app) {
    window.netorEvents.on('agent-event', (e) => {
      if (e.type === 'busy') {
        this.busy[e.agentId] = e.busy;
        document.querySelectorAll(`[data-agent-chat="${e.agentId}"]`).forEach((c) => this.setBusyUI(c, e.busy));
      } else if (e.type === 'message') {
        const a = app.state.agents.find((x) => x.id === e.agentId);
        document.querySelectorAll(`[data-agent-chat="${e.agentId}"] [data-msgs]`).forEach((box) => {
          const empty = NX.$('.empty', box);
          if (empty) empty.remove();
          box.appendChild(this.msgEl(e.message, a && a.options && a.options.debug));
          box.scrollTop = box.scrollHeight;
        });
      } else if (e.type === 'compressed') this.refreshMessages(app, e.agentId);
    });
  },
};

function md(src) {
  let s = NX.esc(src);
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, c) => `<pre><code>${c}</code></pre>`);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" data-ext>$2</a>');
  return s.replace(/\n/g, '<br>');
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-ext]');
  if (a) { e.preventDefault(); window.NetorActions.openTab({ url: a.getAttribute('href') }); }
});
