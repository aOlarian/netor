/* MAP
 * Scop: Cazuri E2E pentru automatizari si AI: sablon cu 2 taburi paralele (linkuri din lista, extragere,
 *       CSV), auto-repararea unui selector stricat din alternative, istoric si sugestii in bara de adrese;
 *       agent real (daca exista NETOR_TEST_AI_KEY): context de grup, unealta snapshot, Loop oprit de agent.
 * Legaturi: e2e.js, src/main/automation.js, src/main/agent-runner.js
 * Sectiuni:
 *   §1 Sablon de automatizare
 *   §2 Istoric
 *   §3 Agent AI real
 */
const fs = require('fs');

async function run({ app, check, assert, PORTS, sleep }) {
  const base = `http://127.0.0.1:${PORTS.page}`;

  // §1 Sablon de automatizare
  await check('Șablon: 2 taburi paralele, 4 linkuri, extragere, CSV, selector reparat din alternative', async () => {
    const tpl = { id: 'tpl_e2e', name: 'Produse E2E', rules: { tabs: 2, delayMs: 100, links: { source: 'list', list: [1, 2, 3, 4].map((i) => `${base}/item/${i}`).join('\n') },
      proxies: { source: 'none' }, output: { format: 'csv' } },
      steps: [{ id: 's1', action: 'navigate', url: '{{link}}' }, { id: 's2', action: 'wait', selector: 'h1.t', timeoutMs: 5000 },
        { id: 's3', action: 'extract', name: 'titlu', selector: 'h1.selector-vechi-stricat', alt: ['h1.t'] }, { id: 's4', action: 'extract', name: 'pret', selector: '.p' }] };
    await app.ev(`NetorApp.state.templates.push(${JSON.stringify(tpl)}); await NetorApp.flush(); return true`);
    await app.ev(`window.__runDone = null; netorEvents.on('template-event', (e) => { if (e.type === 'finished') window.__runDone = e; }); return true`);
    const r = await app.ev(`return await netorAPI.templateRun({ templateId: 'tpl_e2e' })`);
    assert.ok(r.runId, JSON.stringify(r));
    await app.waitFor('!!window.__runDone', 40000);
    const done = await app.ev('window.__runDone');
    assert.strictEqual(done.ok, 4, JSON.stringify(done));
    const csv = fs.readFileSync(done.file, 'utf8');
    for (const i of [1, 2, 3, 4]) assert.ok(csv.includes(`Produs ${i}`) && csv.includes(`${i * 10} lei`), csv);
    const healed = await app.ev(`NetorApp.state.templates.find((t) => t.id === 'tpl_e2e').steps[2].selector`);
    assert.strictEqual(healed, 'h1.t');
    await app.shot('07-template-run');
    return `${done.ok} rezultate, selector reparat`;
  });

  // §2 Istoric
  await check('Istoric + sugestii în bara de adrese', async () => {
    const h = await app.ev(`return await netorAPI.historyQuery({ q: 'Produs', limit: 10 })`);
    assert.ok(Array.isArray(h) && h.length >= 1, JSON.stringify(h));
    return `${h.length} rezultate`;
  });

  // §3 Agent AI real
  if (!process.env.NETOR_TEST_AI_KEY) {
    await check('Agent AI real (sărit: lipsește NETOR_TEST_AI_KEY)', async () => 'sărit');
    return;
  }
  await app.ev(`const gs = NetorApp.state.globalSettings; gs.ai = { mode: 'direct', endpoint: '${process.env.NETOR_TEST_AI_URL || 'http://127.0.0.1:10988/v1'}', apiKey: '', model: 'sonnet-strip-medium' };
    await NetorApp.flush(); await netorAPI.aiSecret({ apiKey: ${JSON.stringify(process.env.NETOR_TEST_AI_KEY)} }); return true`);

  await check('Agent în grup: folosește snapshot pe tabul grupului și citește nota', async () => {
    const r = await app.ev(`const b = NetorApp.state.browsers[0]; const g = b.groups[0]; const web = b.tabs.find((t) => t.groupId === g.id && t.type === 'web');
      NetorActions.navigate(web.id, '${base}/item/5'); await new Promise((r) => setTimeout(r, 1500));
      const noteTab = b.tabs.find((t) => t.groupId === g.id && t.type === 'note'); const note = NetorApp.state.notes.find((n) => n.id === noteTab.refId); note.content = 'Codul secret al grupului este ZETA-7.';
      const agTab = b.tabs.find((t) => t.groupId === g.id && t.type === 'agent'); const ag = NetorApp.state.agents.find((a) => a.id === agTab.refId); ag.model = 'sonnet-strip-medium';
      await NetorApp.flush(); await netorAPI.agentClear({ agentId: ag.id });
      const res = await netorAPI.agentTurn({ agentId: ag.id, browserId: b.id, text: 'Ce produs și ce preț are pagina din grup? Și care e codul din nota grupului? Răspunde scurt.' });
      const c = await netorAPI.agentConv({ agentId: ag.id }); return { res, tools: c.messages.filter((m) => m.role === 'tool').map((m) => m.tool), last: c.messages[c.messages.length - 1].text }`);
    assert.ok(r.res.ok, JSON.stringify(r.res));
    assert.ok(r.tools.includes('snapshot') || r.tools.includes('extract'), `unelte: ${r.tools}`);
    assert.ok(/50/.test(r.last) && /ZETA-7/.test(r.last), r.last);
    return r.last.slice(0, 120);
  });

  await check('Loop: agentul oprește singur bucla când nu mai are ce face', async () => {
    const r = await app.ev(`const ag = NetorApp.state.agents.find((a) => a.model === 'sonnet-strip-medium'); ag.loop = { enabled: true, count: 4 }; await NetorApp.flush();
      const res = await netorAPI.agentTurn({ agentId: ag.id, browserId: NetorApp.state.browsers[0].id, text: 'Nu ai nicio sarcină de făcut. Confirmă scurt și oprește bucla.' });
      await new Promise((r) => setTimeout(r, 1500)); return { res, loop: NetorApp.state.agents.find((a) => a.id === ag.id).loop }`);
    assert.ok(r.res.stopLoop, JSON.stringify(r.res));
    assert.strictEqual(r.loop.count, 0);
    await app.shot('08-agent');
    return 'loop=0';
  });

  await check('Agent în fundal: lucrează în alt browser, nu te mută, eliberează taburile la final', async () => {
    const s = await app.ev(`const a = NetorApp.state.browsers[0]; NetorApp.state.activeBrowserId = a.id; NetorApp.commit();
      const { browserId } = NetorActions.createBrowser({ name: 'Agent fundal', activate: false });
      const ag = NetorApp.state.agents.find((x) => x.model === 'sonnet-strip-medium'); ag.loop = { enabled: false, count: 0 }; await NetorApp.flush(); await netorAPI.agentClear({ agentId: ag.id });
      const before = { active: NetorApp.state.activeBrowserId, focused: NetorApp.focusedTab().id };
      const res = await netorAPI.agentTurn({ agentId: ag.id, browserId, groupId: '', text: 'Deschide ${base}/ și scrie Robot în câmpul Prenume (#fname). Fără submit. Apoi spune gata.' });
      const c = await netorAPI.agentConv({ agentId: ag.id }); const tab = NetorApp.browser(browserId).tabs.find((t) => t.url === '${base}/');
      return { res, browserId, tabId: tab && tab.id, before, after: { active: NetorApp.state.activeBrowserId, focused: NetorApp.focusedTab().id }, tools: c.messages.filter((m) => m.role === 'tool').map((m) => m.tool), held: NetorWV.awakeBy.has(ag.id) }`);
    assert.ok(s.res.ok, JSON.stringify(s.res));
    assert.ok(s.tabId, `agentul nu a deschis pagina: ${s.tools}`);
    const v = await app.pageEval(s.tabId, "document.getElementById('fname').value");
    await app.ev(`NetorApp.state.browsers = NetorApp.state.browsers.filter((x) => x.id !== '${s.browserId}'); NetorApp.commit(); return true`);
    assert.strictEqual(v, 'Robot');
    assert.deepStrictEqual(s.after, s.before, 'agentul te-a mutat din browserul/tabul tau');
    assert.strictEqual(s.held, false, 'taburile au ramas tinute treze dupa final');
    return `unelte: ${s.tools.join(', ')}`;
  });
}

module.exports = { run };
