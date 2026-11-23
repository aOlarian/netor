/* MAP
 * Scop: Cazuri E2E pentru ferestrele din grupuri (asezare libera ca in Nex Remote: margine comuna trasa,
 *       mutare de bara, schimb de loc, 4 = 2 sus + 2 jos, 9 = 3x3, golul umplut, marire) si pentru fereastra
 *       de agenti (panoul lateral tine de browserul in care l-ai deschis; fereastra intra in grupuri), tab treaz in fundal.
 * Legaturi: e2e.js (ctx: app, check), src/renderer/js/group-geom.js, group-drag.js, stage.js, agents.js, tools-menu.js
 * Sectiuni:
 *   §1 Utilitare
 *   §2 Grupul migrat: margini, mutare, schimb
 *   §3 Grila de 4 si 9, golul, marirea
 *   §4 Fereastra de agenti
 */

// §1 Utilitare
const RECTS = `const b = NetorApp.activeBrowser(); const g = NetorApp.activeItem(b).group;
  const dom = (id) => { const r = document.querySelector('#paneLayer > .pane[data-tab-id="' + id + '"]').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; };
  const panes = g.panes.map((p) => ({ id: p.tabId, f: p.rect, px: dom(p.tabId) }));`;
const overlap = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
const drag = (x, y, x2, y2) => [{ type: 'mouseMove', x, y }, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { wait: 40 },
  { type: 'mouseMove', x: Math.round((x + x2) / 2), y: Math.round((y + y2) / 2), modifiers: ['leftButtonDown'] }, { wait: 40 },
  { type: 'mouseMove', x: x2, y: y2, modifiers: ['leftButtonDown'] }, { wait: 60 }, { type: 'mouseUp', x: x2, y: y2, button: 'left', clickCount: 1 }];

async function run({ app, check, assert, PORTS, sleep }) {
  const base = `http://127.0.0.1:${PORTS.page}`;

  // §2 Grupul migrat: margini, mutare, schimb
  await check('Grup: ferestre așezate liber, fără suprapunere, webview peste fereastra lui', async () => {
    const r = await app.ev(`const b0 = NetorApp.state.browsers[0]; NetorApp.state.activeBrowserId = b0.id; b0.active = { kind: 'group', id: b0.groups[0].id }; NetorApp.commit();
      await new Promise((r) => setTimeout(r, 900)); ${RECTS}
      const slot = document.querySelector('[data-wv-slot]').getBoundingClientRect(); const wv = NetorWV.get(document.querySelector('[data-wv-slot]').dataset.wvSlot).wv.getBoundingClientRect();
      return { windows: document.getElementById('paneLayer').classList.contains('windows'), panes, dx: Math.abs(slot.left - wv.left) + Math.abs(slot.top - wv.top) + Math.abs(slot.width - wv.width), edges: document.querySelectorAll('.win-edge').length, chat: !!document.querySelector('.pane .chat') }`);
    assert.ok(r.windows, 'grupul nu e in modul ferestre');
    assert.strictEqual(r.panes.length, 3);
    assert.strictEqual(r.edges, 24);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!overlap(r.panes[i].px, r.panes[j].px), 'ferestre suprapuse');
    assert.ok(r.dx < 3, `webview deplasat ${r.dx}px`);
    assert.ok(r.chat, 'chatul agentului lipseste din grup');
    await app.shot('02-group-windows');
    return r.panes.map((p) => `${p.px.r - p.px.l}x${p.px.b - p.px.t}`).join(' ');
  });

  await check('Grup: marginea comună trasă mută ambele ferestre (fără gol între ele)', async () => {
    const s = await app.ev(`${RECTS} const a = panes.find((p) => panes.some((q) => Math.abs(q.f.l - p.f.r) < 1e-6 && q.f.t < p.f.b && q.f.b > p.f.t));
      const nb = panes.find((q) => Math.abs(q.f.l - a.f.r) < 1e-6 && q.f.t < a.f.b && q.f.b > a.f.t);
      const e = document.querySelector('#paneLayer > .pane[data-tab-id="' + a.id + '"] .win-edge.e-e').getBoundingClientRect();
      return { a: a.id, nb: nb.id, x: Math.round(e.left + e.width / 2), y: Math.round(e.top + e.height / 2), aw: a.px.r - a.px.l, nl: nb.px.l }`);
    await app.input(null, drag(s.x, s.y, s.x - 140, s.y));
    await sleep(300);
    const r = await app.ev(`${RECTS} const a = panes.find((p) => p.id === '${s.a}'); const nb = panes.find((p) => p.id === '${s.nb}'); return { aw: a.px.r - a.px.l, ar: a.px.r, nl: nb.px.l, shared: Math.abs(a.f.r - nb.f.l) < 1e-9 }`);
    assert.ok(Math.abs(s.aw - 140 - r.aw) < 20, `latime ${s.aw} -> ${r.aw}`);
    assert.ok(r.shared && Math.abs(r.ar - r.nl) <= 1, `muchia comuna s-a rupt: ${JSON.stringify(r)}`);
    return `${s.aw}px → ${r.aw}px, vecina lipită`;
  });

  await check('Grup: fereastra trasă de bară peste mijlocul alteia schimbă locul', async () => {
    const s = await app.ev(`${RECTS} const [a, c] = [panes[0], panes[2]];
      const gr = document.querySelector('#paneLayer > .pane[data-tab-id="' + a.id + '"] .win-grip').getBoundingClientRect();
      return { a: a.id, c: c.id, fa: a.f, fc: c.f, x: Math.round(gr.left + gr.width / 2), y: Math.round(gr.top + gr.height / 2), cx: Math.round((c.px.l + c.px.r) / 2), cy: Math.round((c.px.t + c.px.b) / 2) }`);
    await app.input(null, drag(s.x, s.y, s.cx, s.cy));
    await sleep(300);
    const r = await app.ev(`${RECTS} return { a: panes.find((p) => p.id === '${s.a}').f, c: panes.find((p) => p.id === '${s.c}').f }`);
    assert.deepStrictEqual(r.a, s.fc);
    assert.deepStrictEqual(r.c, s.fa);
    return 'locuri schimbate';
  });

  // §3 Grila de 4 si 9, golul, marirea
  await check('Grup: 4 ferestre = 2 sus + 2 jos; 9 ferestre = grilă 3×3', async () => {
    const r = await app.ev(`const g = await NetorActions.createGroup(null, 'grila');
      for (let i = 0; i < 4; i++) await NetorActions.openTab({ url: '${base}/p2', groupId: g.id });
      const four = g.panes.map((p) => [p.rect.l, p.rect.t, p.rect.r, p.rect.b].map((v) => Math.round(v * 100)).join(','));
      for (let i = 0; i < 5; i++) await NetorActions.openTab({ url: '${base}/p2', groupId: g.id });
      await new Promise((r) => setTimeout(r, 600));
      const nine = g.panes.map((p) => p.rect); return { four, cols: [...new Set(nine.map((f) => Math.round(f.l * 100)))].length, rows: [...new Set(nine.map((f) => Math.round(f.t * 100)))].length, n: nine.length, dom: document.querySelectorAll('#paneLayer > .pane').length }`);
    assert.deepStrictEqual(r.four, ['0,0,50,50', '50,0,100,50', '0,50,50,100', '50,50,100,100']);
    assert.strictEqual(r.n, 9);
    assert.ok(r.cols === 3 && r.rows === 3 && r.dom === 9, JSON.stringify(r));
    await app.shot('02-group-3x3');
    return '2×2 și 3×3';
  });

  await check('Grup: fereastra închisă își lasă locul vecinelor; dublu-clic pe bară mărește fereastra', async () => {
    const r = await app.ev(`const b = NetorApp.activeBrowser(); const g = b.groups.find((x) => x.name === 'grila');
      for (const p of g.panes.slice(4)) NetorActions.closeTab(p.tabId); NetorTabstrip.arrange(NetorApp, b, g, 'grid');
      const before = g.panes.length; NetorActions.closeTab(g.panes[1].tabId); NetorApp.commit(); await new Promise((r) => setTimeout(r, 300));
      const area = g.panes.reduce((s, p) => s + (p.rect.r - p.rect.l) * (p.rect.b - p.rect.t), 0);
      const grip = document.querySelector('#paneLayer > .pane[data-tab-id="' + g.panes[0].tabId + '"] .win-grip');
      grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await new Promise((r) => setTimeout(r, 200));
      const max = { id: g.maxTabId, w: document.querySelector('#paneLayer > .pane.maxed').offsetWidth, layer: document.getElementById('paneLayer').offsetWidth, hidden: document.querySelectorAll('#paneLayer > .pane.hidden').length };
      grip.ownerDocument.querySelector('#paneLayer > .pane.maxed .win-grip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return { before, after: g.panes.length, area, max, restored: !g.maxTabId }`);
    assert.strictEqual(r.after, r.before - 1);
    assert.ok(Math.abs(r.area - 1) < 1e-6, `gol ramas: aria ${r.area}`);
    assert.ok(r.max.id && Math.abs(r.max.w - r.max.layer) < 2 && r.max.hidden === r.after - 1, JSON.stringify(r.max));
    assert.ok(r.restored);
    return `3 ferestre acoperă tot grupul`;
  });

  // §4 Fereastra de agenti
  await check('Panoul de agenți ține de browserul în care l-ai deschis', async () => {
    const r = await app.ev(`const b1 = NetorApp.activeBrowser(); NetorTools.closeSidebar(); NetorAgents.openSidebar(NetorApp);
      const open1 = !document.getElementById('sidebar').classList.contains('hidden');
      const { browserId } = NetorActions.createBrowser({ name: 'Alt browser' }); await new Promise((r) => setTimeout(r, 300));
      const inB2 = !document.getElementById('sidebar').classList.contains('hidden');
      NetorApp.state.activeBrowserId = b1.id; NetorApp.commit(); await new Promise((r) => setTimeout(r, 200));
      const back = !document.getElementById('sidebar').classList.contains('hidden') && NetorTools.sidebarKind === 'agents';
      NetorApp.state.activeBrowserId = browserId; NetorApp.commit(); NetorAgents.openSidebar(NetorApp); const ctx = NetorTools.sidebars[browserId];
      NetorApp.state.browsers = NetorApp.state.browsers.filter((x) => x.id !== browserId); NetorApp.state.activeBrowserId = b1.id; NetorApp.commit();
      return { open1, inB2, back, ctx, still: NetorTools.sidebarKind }`);
    assert.ok(r.open1, 'panoul nu s-a deschis');
    assert.strictEqual(r.inB2, false, 'panoul de agenti a ramas deschis in alt browser');
    assert.ok(r.back, 'panoul nu a revenit in browserul lui');
    assert.strictEqual(r.ctx.kind, 'agents');
    return 'deschis în B1, închis în B2, revine în B1';
  });

  await check('Fereastra de agenți se adaugă în grup și lucrează pe browserul grupului', async () => {
    const r = await app.ev(`const b = NetorApp.activeBrowser(); const g = b.groups.find((x) => x.name === 'grila');
      NetorTools.closeSidebar(); NetorAgents.openAsTab(NetorApp, '', g.id); await new Promise((r) => setTimeout(r, 400));
      const tab = b.tabs.find((t) => t.groupId === g.id && t.type === 'agent'); const pane = document.querySelector('#paneLayer > .pane[data-tab-id="' + tab.id + '"]');
      const list = pane.querySelectorAll('.agents-pane .note-item').length; pane.querySelector('.agents-pane .note-item').click(); await new Promise((r) => setTimeout(r, 500));
      const chat = pane.querySelector('.chat'); const out = { list, refId: tab.refId, chatBrowser: chat && chat.dataset.browser, brw: b.id, title: pane.querySelector('.pane-title').textContent, panes: g.panes.length };
      await NetorApp.flush(); out.ctx = await netorAPI.agentContext({ agentId: tab.refId, browserId: b.id, groupId: chat.dataset.group }); out.shown = pane.querySelector('[data-ctx]').textContent;
      chat.querySelector('[data-back]').click(); await new Promise((r) => setTimeout(r, 200)); out.backToList = !tab.refId && !!pane.querySelector('.agents-pane');
      return out`);
    assert.ok(r.list >= 1 && r.refId, JSON.stringify(r));
    assert.strictEqual(r.chatBrowser, r.brw);
    assert.ok(r.ctx && r.ctx.group && r.ctx.group.name === 'grila', `context: ${JSON.stringify(r.ctx)}`);
    assert.ok(/grila/.test(r.shown), `contextul afisat: ${r.shown}`);
    assert.ok(r.backToList, 'inapoi la lista nu merge');
    await app.shot('02-agents-window');
    await app.ev(`const b = NetorApp.activeBrowser(); NetorActions.ungroup(b.groups.find((x) => x.name === 'grila').id, true)`);
    return `${r.panes} ferestre în grup, context „${r.ctx.group.name}”`;
  });

  await check('Tab treaz: un tab din alt browser lucrează în fundal (randat, fără să te mute)', async () => {
    const s = await app.ev(`const a = NetorApp.activeBrowser(); const focused = NetorApp.focusedTab().id;
      const { browserId } = NetorActions.createBrowser({ name: 'Fundal', activate: false }); const tabId = NetorApp.browser(browserId).tabs[0].id;
      const before = !!NetorWV.get(tabId); await NetorWV.wake(NetorApp, 'test-agent', [tabId]); return { a: a.id, focused, browserId, tabId, before }`);
    await app.cmd('page.navigate', { tabId: s.tabId, url: `${base}/` });
    await app.cmd('dom.type', { tabId: s.tabId, selector: '#fname', text: 'Fundal' });
    await sleep(500);
    const page = await app.pageEval(s.tabId, `(async () => { let n = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
      return { vis: document.visibilityState, raf: n, v: document.getElementById('fname').value }; })()`);
    const after = await app.ev(`return { active: NetorApp.state.activeBrowserId, focused: NetorApp.focusedTab().id, awake: NetorWV.get('${s.tabId}').wv.classList.contains('wv-awake') }`);
    await app.ev(`NetorWV.sleep('test-agent'); return true`);
    await sleep(500);
    // Eliberat = Chromium nu-l mai randeaza (cadrele se opresc); numaram cu limita de timp, nu asteptam cadre
    const slept = await app.pageEval(s.tabId, `new Promise((r) => { let n = 0; const f = () => { n++; requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(() => r(n), 1000); })`);
    await app.ev(`NetorWV.destroy('${s.tabId}'); NetorApp.state.browsers = NetorApp.state.browsers.filter((x) => x.id !== '${s.browserId}'); NetorApp.commit(); return true`);
    assert.strictEqual(s.before, false, 'tabul exista deja');
    assert.ok(page.vis === 'visible' && page.raf > 15, `tabul doarme: ${JSON.stringify(page)}`);
    assert.strictEqual(page.v, 'Fundal');
    assert.ok(after.active === s.a && after.focused === s.focused, `te-a mutat: ${JSON.stringify(after)}`);
    assert.ok(after.awake, 'webview-ul nu e marcat treaz');
    assert.ok(slept < 5, `tabul nu a fost eliberat: ${slept} cadre/s`);
    return `${page.raf} cadre/s, text scris, rămâi în browserul tău`;
  });
}

module.exports = { run };
