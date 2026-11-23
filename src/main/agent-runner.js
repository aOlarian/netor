/* MAP
 * Scop: Motorul agentilor Netor: conversatii salvate pe disc (agents/<id>.json), context de grup (taburi web,
 *       note, alti agenti), bucla de unelte in format text (<tool>{...}</tool>, merge cu cli2api fara tool-calling),
 *       Loop automat cu auto-oprire (<loop:stop/> sau unealta loop_stop), Stop, autocompresie cu pastrarea originalului.
 *       Lucreaza in fundal: tinta fixata la inceput, taburile tinute treze (agent-awake.js) pana la final.
 * Legaturi: ai-client.js, agent-tools.js, agent-awake.js, cdp-bridge.js, ipc.js, config.js (LIMITS)
 * Sectiuni:
 *   §1 Stocare conversatii
 *   §2 Context de grup si prompt de sistem
 *   §3 Tura agentului (unelte, stop, loop)
 *   §4 Autocompresie
 */
const fs = require('fs');
const path = require('path');
const ai = require('./ai-client');
const tools = require('./agent-tools');
const bridge = require('./cdp-bridge');
const awake = require('./agent-awake');
const { LIMITS } = require('./config');

let ctx = null; // { store, dir, emit, uiCall }
const running = new Map(); // agentId -> AbortController
const pending = new Map(); // agentId -> urmatoarea reluare din Loop (timer)

// §1 Stocare conversatii
const convFile = (id) => path.join(ctx.dir, 'agents', `${String(id).replace(/[^\w-]/g, '')}.json`);
function loadConv(id) {
  try { return JSON.parse(fs.readFileSync(convFile(id), 'utf8')); } catch (_) { return { messages: [], summary: '' }; }
}
function saveConv(id, conv) {
  fs.mkdirSync(path.dirname(convFile(id)), { recursive: true });
  fs.writeFileSync(convFile(id) + '.tmp', JSON.stringify(conv), 'utf8');
  fs.renameSync(convFile(id) + '.tmp', convFile(id));
}
function deleteConv(id) { try { fs.unlinkSync(convFile(id)); } catch (_) { /* conversatia poate sa nu existe */ } }

// §2 Context de grup si prompt de sistem
// groupId vine de la fereastra din care scrii ('' = panoul lateral: doar browserul); lipsa lui = cauta grupul agentului
function groupContext(agentId, browserId, groupId) {
  const st = ctx.store.state;
  const brw = st.browsers.find((b) => b.id === browserId) || st.browsers.find((b) => b.id === st.activeBrowserId);
  const agentTab = groupId === undefined && brw && brw.tabs.find((t) => t.type === 'agent' && t.refId === agentId && t.groupId);
  const gid = groupId === undefined ? agentTab && agentTab.groupId : groupId;
  const grp = gid && brw && brw.groups.find((g) => g.id === gid);
  const out = { browserId: brw && brw.id, browserName: brw && brw.name, group: null, webTabs: [], notes: [] };
  if (!grp) return out;
  out.group = { id: grp.id, name: grp.name };
  for (const p of grp.panes) {
    const t = brw.tabs.find((x) => x.id === p.tabId);
    if (!t) continue;
    if (t.type === 'web') out.webTabs.push({ tabId: t.id, title: t.customTitle || t.title, url: t.url });
    if (t.type === 'note') { const n = st.notes.find((x) => x.id === t.refId); if (n) out.notes.push({ title: n.title, content: (n.content || '').slice(0, 6000) }); }
  }
  return out;
}

function systemPrompt(agent, gc) {
  const gs = ctx.store.state.globalSettings;
  const user = (gs.user && (gs.user.display_name || gs.user.username)) || 'utilizatorul';
  const ws = gs.workspace || {};
  const lines = [
    `Esti "${agent.name}", un agent AI integrat in browserul Netor al lui ${user}. Raspunzi in romana, concis si concret.`,
    'Poti controla browserul si citi date cu unelte. Ca sa folosesti o unealta, scrie un singur bloc exact asa:',
    '<tool>{"name":"snapshot","args":{}}</tool>',
    'Dupa bloc te opresti; primesti rezultatul in <result>...</result> si continui. Cand ai terminat, raspunzi normal, fara <tool>.',
    'Inainte sa dai clic sau sa tastezi, fa snapshot ca sa afli referintele elementelor (e1, e2...). Nu inventa rezultate.',
    'Datele secrete din seif (parole, carduri, CVV) nu le vezi; foloseste fill_form ca browserul sa le completeze singur.',
    'Daca esti in modul Loop si constati ca nu mai ai nimic de facut, scrie <loop:stop/> in raspuns.',
    'Lucrezi in fundal: utilizatorul poate fi in alt tab sau browser si nu trebuie deranjat. Taburile tale raman treze cat lucrezi; taburile noi se deschid in fundal si devin tinta implicita.',
    `Unelte:${tools.TOOL_DOCS}`,
  ];
  lines.push(gc.group
    ? `Esti in grupul "${gc.group.name}" din browserul "${gc.browserName}". Taburile web ale grupului (tinta implicita = primul): ${JSON.stringify(gc.webTabs)}.`
    : `Lucrezi in browserul "${gc.browserName}"; tinta implicita = tabul ${gc.defaultTabId || '(niciunul: deschide unul cu open_tab)'}, fixat cand ai inceput.`);
  for (const n of gc.notes) lines.push(`Nota din grup "${n.title}":\n${n.content}`);
  lines.push(ws.mode === 'none' ? 'Workspace: neconectat.' : `Workspace: ${ws.mode === 'local' ? `local (${ws.path})` : 'pe alt dispozitiv al contului'}${ws.allowWrite ? ', cu scriere permisa' : ', doar citire'}.`);
  return lines.join('\n');
}

// §3 Tura agentului
function parseTool(text) {
  const m = /<tool>\s*([\s\S]*?)\s*<\/tool>/i.exec(text) || /```(?:json)?\s*(\{\s*"name"[\s\S]*?\})\s*```/i.exec(text);
  if (!m) return null;
  try { const j = JSON.parse(m[1]); return j && j.name ? { name: j.name, args: j.args || {}, raw: m[0] } : null; } catch (_) { return { error: 'JSON invalid în blocul <tool>', raw: m[0] }; }
}

function buildMessages(agent, conv, gc) {
  const opts = agent.options || {};
  const msgs = [{ role: 'system', content: systemPrompt(agent, gc) }];
  if (conv.summary) msgs.push({ role: 'system', content: `Rezumatul conversatiei anterioare:\n${conv.summary}` });
  const live = conv.messages.filter((m) => !m.archived);
  const lastUser = live.map((m) => m.role).lastIndexOf('user');
  live.forEach((m, i) => {
    if (m.role === 'tool' && opts.toolsless && i < lastUser) return;
    msgs.push({ role: m.role === 'tool' ? 'user' : m.role, content: m.role === 'tool' ? `<result>${m.text}</result>` : m.text });
  });
  return msgs;
}

async function runTurn({ agentId, browserId, groupId, tabId, text, isLoop }) {
  const agent = ctx.store.state.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error('Agent inexistent.');
  if (running.has(agentId)) throw new Error('Agentul lucrează deja.');
  if (!agent.model && !ctx.store.state.globalSettings.ai.model) throw new Error('Alege un model AI în Setări globale → Workspace & AI.');
  const ac = new AbortController();
  running.set(agentId, ac);
  const conv = loadConv(agentId);
  clearTimeout(pending.get(agentId));
  pending.delete(agentId);
  const gc = groupContext(agentId, browserId, groupId);
  const brw = ctx.store.state.browsers.find((b) => b.id === gc.browserId);
  // Tinta se fixeaza la inceput (si ramane in Loop): daca tu treci pe alt tab sau browser, agentul ramane pe al lui
  const kept = tabId && brw && brw.tabs.some((t) => t.id === tabId && t.type === 'web') ? tabId : '';
  gc.defaultTabId = kept || (gc.webTabs[0] && gc.webTabs[0].tabId) || bridge.activeTabId(gc.browserId);
  const env = { browserId: gc.browserId, groupId: gc.group && gc.group.id, defaultTabId: gc.defaultTabId, stopLoop: false, uiCall: ctx.uiCall,
    wake: (ids) => awake.wake(agentId, ids) };
  const push = (m) => { conv.messages.push({ ...m, ts: Date.now() }); ctx.emit('netor:agent-event', { agentId, type: 'message', message: conv.messages[conv.messages.length - 1] }); };
  push({ role: 'user', text: isLoop ? `[Loop · ramase ${agent.loop.count}] ${text}` : text });
  ctx.emit('netor:agent-event', { agentId, type: 'busy', busy: true });
  let error = null;
  try {
    await env.wake([env.defaultTabId, ...gc.webTabs.map((t) => t.tabId)]);
    for (let step = 0; step < LIMITS.agentMaxStepsPerTurn; step++) {
      const res = await ai.chat({ model: agent.model || ctx.store.state.globalSettings.ai.model, messages: buildMessages(agent, conv, gc), signal: ac.signal });
      const call = parseTool(res.text);
      if (/<loop:stop\s*\/?>/i.test(res.text)) env.stopLoop = true;
      push({ role: 'assistant', text: res.text.replace(/<loop:stop\s*\/?>/gi, '').trim() || '(gata)' });
      if (!call) break;
      let result;
      try {
        result = call.error ? { error: call.error } : await tools.runTool(call.name, call.args, env);
      } catch (err) {
        result = { error: err.message };
      }
      push({ role: 'tool', text: JSON.stringify(result).slice(0, 14000), tool: call.name });
      if (ac.signal.aborted) break;
    }
  } catch (err) {
    error = ac.signal.aborted ? 'Oprit de utilizator.' : err.message;
    push({ role: 'error', text: error });
  } finally {
    running.delete(agentId);
  }
  if (!agent.options || !agent.options.skipCompress) await compressIfNeeded(agent, conv).catch((err) => push({ role: 'error', text: `Autocompresie eșuată: ${err.message}` }));
  saveConv(agentId, conv);
  ctx.emit('netor:agent-event', { agentId, type: 'busy', busy: false });
  return afterTurn(agent, { browserId, groupId, tabId: env.defaultTabId }, env.stopLoop, ac.signal.aborted, error);
}

// Loop: dupa fiecare tura, daca e activ si agentul nu a cerut oprirea, trimite automat "continua"
function afterTurn(agent, where, stopLoop, aborted, error) {
  const cur = ctx.store.state.agents.find((a) => a.id === agent.id) || agent;
  const loop = { enabled: false, count: 0, ...(cur.loop || {}) };
  const willContinue = !stopLoop && !aborted && !error && loop.enabled && loop.count > 0;
  if (stopLoop || aborted) { loop.enabled = false; loop.count = 0; }
  if (willContinue) { loop.count -= 1; if (loop.count === 0) loop.enabled = false; }
  cur.loop = loop;
  // Starea e detinuta de interfata: o anuntam ca sa nu suprascrie contorul la urmatoarea salvare
  ctx.uiCall('agentUpdated', { agentId: agent.id, loop }).catch((err) => console.error('[netor] agentUpdated:', err.message));
  if (!willContinue) awake.release(agent.id);
  if (willContinue) {
    pending.set(agent.id, setTimeout(() => runTurn({ agentId: agent.id, ...where, text: 'Continuă cu următorul pas. Dacă totul e gata, spune-o și oprește bucla.', isLoop: true })
      .catch((err) => { awake.release(agent.id); ctx.emit('netor:agent-event', { agentId: agent.id, type: 'message', message: { role: 'error', text: err.message, ts: Date.now() } }); }), 600));
  }
  return { ok: !error, error, stopLoop, loop };
}

function stop(agentId) {
  const ac = running.get(agentId);
  const agent = ctx.store.state.agents.find((a) => a.id === agentId);
  if (agent && agent.loop) { agent.loop.enabled = false; agent.loop.count = 0; }
  if (ac) ac.abort();
  // Oprit intre doua reluari din Loop: reluarea programata nu mai porneste, taburile se elibereaza
  if (pending.has(agentId)) { clearTimeout(pending.get(agentId)); pending.delete(agentId); awake.release(agentId); }
  return { ok: true };
}

// §4 Autocompresie (originalul ramane vizibil in interfata; modelul primeste rezumatul)
async function compressIfNeeded(agent, conv) {
  const live = conv.messages.filter((m) => !m.archived);
  const chars = live.reduce((s, m) => s + m.text.length, 0) + conv.summary.length;
  if (chars < LIMITS.agentCompressChars) return;
  const userIdx = live.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0);
  if (userIdx.length <= LIMITS.agentKeepTurns) return;
  const cut = userIdx[userIdx.length - LIMITS.agentKeepTurns];
  const old = live.slice(0, cut);
  const transcript = old.map((m) => `${m.role}: ${m.text.slice(0, 3000)}`).join('\n');
  const res = await ai.chat({ model: agent.model || ctx.store.state.globalSettings.ai.model, messages: [
    { role: 'system', content: 'Rezumi fidel o conversatie de lucru pentru reluare: scopul, deciziile, ce s-a facut (cu URL-uri, valori, ID-uri), ce a ramas. Fara invenții. Maximum 400 de cuvinte, in romana.' },
    { role: 'user', content: `${conv.summary ? `Rezumat anterior:\n${conv.summary}\n\n` : ''}Conversatia de rezumat:\n${transcript}` }] });
  conv.summary = res.text.trim();
  for (const m of old) m.archived = true;
  ctx.emit('netor:agent-event', { agentId: agent.id, type: 'compressed' });
}

function init(opts) { ctx = opts; }

module.exports = { init, runTurn, stop, loadConv, saveConv, deleteConv, groupContext, isRunning: (id) => running.has(id) };
