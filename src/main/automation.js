/* MAP
 * Scop: Motorul de sabloane de automatizare (stil WinAutomation): pasi declarativi (navigate, click, type,
 *       select, wait, extract, scroll, upload, assert, pause, repeat), reguli de rulare (numar taburi, proxy per
 *       tab, sursa linkurilor, iesire fisier JSON/CSV si webhook ex. Veromaps), auto-reparare a selectorilor
 *       (alternative, text, AI optional) si pauza pentru reparare manuala ("alege elementul").
 * Legaturi: cdp-bridge.js, ai-client.js, ipc.js, renderer/js/templates-ui.js
 * Sectiuni:
 *   §1 Stare rulari si evenimente
 *   §2 Surse: linkuri si proxy-uri
 *   §3 Executie pas cu auto-reparare
 *   §4 Rulare completa (lucratori paraleli, iesire)
 */
const fs = require('fs');
const path = require('path');
const bridge = require('./cdp-bridge');
const ai = require('./ai-client');

let ctx = null; // { store, emit, uiCall }
const runs = new Map();

// §1 Stare rulari si evenimente
const ev = (run, type, data) => ctx.emit('netor:template-event', { runId: run.id, templateId: run.tpl.id, type, ...data });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fillVars = (s, vars) => String(s ?? '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));

// §2 Surse: linkuri si proxy-uri
function linksFor(tpl) {
  const src = (tpl.rules && tpl.rules.links) || {};
  let text = '';
  if (src.source === 'note') { const n = ctx.store.state.notes.find((x) => x.title === src.noteTitle); text = n ? n.content : ''; }
  else if (src.source === 'file' && src.file && fs.existsSync(src.file)) text = fs.readFileSync(src.file, 'utf8');
  else text = src.list || '';
  const links = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l));
  return links.length ? links : [''];
}

function proxiesFor(tpl) {
  const p = (tpl.rules && tpl.rules.proxies) || {};
  if (p.source !== 'list') return [];
  return String(p.list || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(?:(socks5|socks4|http|https):\/\/)?(?:([^:@]+):([^@]*)@)?([^:]+):(\d+)$/i);
    return m ? { mode: 'custom', scheme: (m[1] || p.scheme || 'http').toLowerCase(), host: m[4], port: m[5], username: m[2] || '', password: m[3] || '' } : null;
  }).filter(Boolean);
}

// §3 Executie pas cu auto-reparare
async function runStep(run, w, step, vars, record) {
  const base = { tabId: w.tabId };
  const target = { selector: fillVars(step.selector, vars), text: step.text ? fillVars(step.text, vars) : undefined };
  const tryAct = async (cmd, extra) => {
    const variants = [target, ...(step.alt || []).map((s) => ({ selector: s })), ...(step.text ? [{ text: fillVars(step.text, vars) }] : [])];
    for (const v of variants) {
      const r = await bridge.execute(cmd, { ...base, ...v, ...extra }).catch((err) => ({ ok: false, error: err.message }));
      if (r && r.ok !== false) { if (v !== target && v.selector) healed(run, step, v.selector); return r; }
    }
    return repair(run, w, step, cmd, extra);
  };
  switch (step.action) {
    case 'navigate': return bridge.execute('page.navigate', { ...base, url: fillVars(step.url || '{{link}}', vars) });
    case 'click': return tryAct('dom.click', {});
    case 'type': return tryAct('dom.type', { text: fillVars(step.value, vars), submit: !!step.submit });
    case 'select': return tryAct('dom.select', { value: fillVars(step.value, vars) });
    case 'wait': return bridge.execute('page.wait', { ...base, ms: step.ms, selector: step.selector ? target.selector : undefined, text: target.text, timeoutMs: step.timeoutMs });
    case 'scroll': for (let i = 0; i < (step.times || 1); i++) { await bridge.execute('page.scroll', { ...base, dy: step.dy || 900 }); await sleep(step.ms || 600); } return { ok: true };
    case 'extract': {
      // Selectorul principal, apoi alternativele salvate; primul care gaseste ceva devine principal (auto-reparare)
      let r = { ok: false, values: [] };
      for (const sel of [target.selector, ...(step.alt || [])].filter(Boolean)) {
        r = await bridge.execute('dom.extract', { ...base, selector: sel, attr: step.attr || 'text', multiple: !!step.multiple });
        if (r.ok) { if (sel !== target.selector) healed(run, step, sel); break; }
      }
      record[step.name || `camp${Object.keys(record).length + 1}`] = step.multiple ? r.values : (r.values || [])[0] || '';
      return r;
    }
    case 'upload': return bridge.execute('file.upload', { ...base, selector: target.selector, files: String(fillVars(step.value, vars)).split('|') });
    case 'assert': {
      const r = await bridge.execute('page.wait', { ...base, selector: step.selector ? target.selector : undefined, text: target.text, timeoutMs: step.timeoutMs || 5000 });
      if (!r.ok) throw new Error(`Confirmare eșuată: ${step.selector || step.text}`);
      return r;
    }
    case 'pause': return waitForUser(run, w, step, step.message || 'Pauză: continuă după ce termini manual.');
    case 'repeat': {
      for (let i = 0; i < Math.min(step.times || 200, 500); i++) {
        if (step.until) { const exists = await bridge.execute('page.wait', { ...base, selector: step.until, timeoutMs: 1500 }); if (!exists.ok) break; }
        for (const s of step.steps || []) { await runStep(run, w, s, { ...vars, i }, record); await sleep(run.delay); }
      }
      return { ok: true };
    }
    default: throw new Error(`Acțiune necunoscută: ${step.action}`);
  }
}

function healed(run, step, selector) {
  step.alt = [step.selector, ...(step.alt || []).filter((s) => s !== selector)].filter(Boolean);
  step.selector = selector;
  ev(run, 'healed', { stepId: step.id, selector });
  ctx.uiCall('templateUpdated', { template: run.tpl }).catch((err) => console.error('[netor] templateUpdated:', err.message));
}

async function repair(run, w, step, cmd, extra) {
  const rules = run.tpl.rules || {};
  if (rules.aiRepair) {
    const snap = await bridge.execute('page.snapshot', { tabId: w.tabId, maxChars: 2500 });
    const res = await ai.chat({ model: ctx.store.state.globalSettings.ai.model, messages: [
      { role: 'system', content: 'Alegi elementul potrivit dintr-o lista. Raspunzi DOAR cu referinta (ex. e12) sau NONE.' },
      { role: 'user', content: `Pasul: ${step.action} pe "${step.text || step.selector}" (${step.note || ''}). Elemente: ${JSON.stringify(snap.elements).slice(0, 12000)}` }] }).catch(() => null);
    const ref = res && (res.text.match(/\be\d+\b/) || [])[0];
    if (ref) {
      const r = await bridge.execute(cmd, { tabId: w.tabId, ref, ...extra });
      if (r.ok !== false) {
        const sel = await bridge.execute('page.eval', { tabId: w.tabId, expr: `(() => { const el = document.querySelector('[data-netor-ref="${ref}"]'); return el && el.id ? '#' + CSS.escape(el.id) : (el && el.getAttribute('name') ? el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]' : ''); })()` });
        if (sel.result) healed(run, step, sel.result);
        return r;
      }
    }
  }
  const picked = await waitForUser(run, w, step, `Pasul „${step.action} ${step.selector || step.text || ''}” nu găsește elementul. Alege elementul corect în tab.`, true);
  if (picked && picked.selector) { healed(run, step, picked.selector); return bridge.execute(cmd, { tabId: w.tabId, selector: picked.selector, ...extra }); }
  throw new Error('Pas nereparat.');
}

function waitForUser(run, w, step, message, pick) {
  return new Promise((resolve) => {
    run.waiting = { resolve, tabId: w.tabId, stepId: step.id };
    ev(run, pick ? 'needs-repair' : 'paused', { stepId: step.id, tabId: w.tabId, message });
  });
}

// §4 Rulare completa
async function start(templateId) {
  const tpl = ctx.store.state.templates.find((t) => t.id === templateId);
  if (!tpl) throw new Error('Șablon inexistent.');
  const rules = tpl.rules || {};
  const run = { id: `run_${Date.now().toString(36)}`, tpl: JSON.parse(JSON.stringify(tpl)), results: [], errors: [], stopped: false, delay: Number(rules.delayMs) || 700, waiting: null };
  runs.set(run.id, run);
  const links = linksFor(tpl);
  const proxies = proxiesFor(tpl);
  const n = Math.max(1, Math.min(Number(rules.tabs) || 1, 12, links.length));
  const { browserId } = await ctx.uiCall('createRunBrowser', { name: `▶ ${tpl.name}`, isolated: proxies.length > 0 });
  const workers = [];
  for (let i = 0; i < n; i++) {
    const proxy = proxies.length ? proxies[i % proxies.length] : null;
    const { tabId } = await ctx.uiCall('openTab', { browserId, url: 'about:blank', proxy, background: i > 0 });
    workers.push({ tabId, index: i });
  }
  ev(run, 'started', { browserId, total: links.length, workers: n });
  let next = 0;
  const work = async (w) => {
    while (!run.stopped && next < links.length) {
      const idx = next++;
      const vars = { link: links[idx], index: idx + 1 };
      const record = { _link: links[idx] };
      try {
        for (const step of run.tpl.steps || []) { if (run.stopped) break; await runStep(run, w, step, vars, record); await sleep(run.delay); }
        run.results.push(record);
      } catch (err) {
        run.errors.push({ link: links[idx], error: err.message });
      }
      ev(run, 'progress', { done: run.results.length + run.errors.length, total: links.length, ok: run.results.length, failed: run.errors.length, last: record });
    }
  };
  Promise.all(workers.map(work)).then(() => finish(run, tpl)).catch((err) => ev(run, 'error', { error: err.message }));
  return { runId: run.id, browserId };
}

async function finish(run, tpl) {
  const out = (tpl.rules && tpl.rules.output) || {};
  const dir = path.join(ctx.store.state.globalSettings.downloadDir, 'netor-runs');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${tpl.name.replace(/[^\w-]+/g, '_')}-${stamp}.${out.format === 'csv' ? 'csv' : 'json'}`);
  fs.writeFileSync(file, out.format === 'csv' ? toCsv(run.results) : JSON.stringify({ template: tpl.name, results: run.results, errors: run.errors }, null, 2), 'utf8');
  let webhook = null;
  if (out.webhook) {
    webhook = await fetch(out.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(out.webhookKey ? { Authorization: `Bearer ${out.webhookKey}` } : {}) },
      body: JSON.stringify({ source: 'netor', template: tpl.name, results: run.results }) }).then((r) => `${r.status}`).catch((err) => `eroare: ${err.message}`);
  }
  ev(run, 'finished', { file, ok: run.results.length, failed: run.errors.length, errors: run.errors.slice(0, 20), webhook, stopped: run.stopped });
}

function toCsv(rows) {
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const cell = (v) => `"${String(Array.isArray(v) ? v.join(' | ') : v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

function resume(runId, picked) {
  const run = runs.get(runId);
  if (!run || !run.waiting) return false;
  const w = run.waiting;
  run.waiting = null;
  w.resolve(picked || null);
  return true;
}

function stop(runId) {
  const run = runs.get(runId);
  if (!run) return false;
  run.stopped = true;
  if (run.waiting) resume(runId, null);
  return true;
}

function init(opts) { ctx = opts; }

module.exports = { init, start, stop, resume };
