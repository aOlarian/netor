/* MAP
 * Scop: Comenzile de control al taburilor (Chromer v2 integrat): folosite de agentul AI, de sabloanele de
 *       automatizare, de puntea remote netor.example.test si de serverul local de control.
 *       Tinta = tabId (sau tabul activ); actiunile merg pe webContents-ul real prin JS + CDP (upload direct).
 * Legaturi: web-contents.js (registru), ui-rpc.js (deschidere taburi in interfata), agent-tools.js, automation.js
 * Sectiuni:
 *   §1 Rezolvare tab tinta si scripturi injectate (snapshot cu referinte, gasire element)
 *   §2 Upload direct prin cale (DOM.setFileInputFiles)
 *   §3 Executie comenzi
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { wcForTab } = require('./web-contents');
const { LIMITS } = require('./config');

let ctx = null; // { store, uiCall }

// §1 Rezolvare tab tinta si scripturi injectate
function activeTabId(browserId) {
  const st = ctx.store.state;
  const b = st.browsers.find((x) => x.id === (browserId || st.activeBrowserId)) || st.browsers[0];
  if (!b) return '';
  if (b.active && b.active.kind === 'tab') return b.active.id;
  const g = b.groups.find((x) => b.active && x.id === b.active.id);
  const pane = g && g.panes.map((p) => b.tabs.find((t) => t.id === p.tabId)).find((t) => t && t.type === 'web');
  return pane ? pane.id : '';
}

function target(params) {
  const tabId = params.tabId || activeTabId(params.browserId);
  const wc = wcForTab(tabId);
  if (!wc) throw new Error(`Tabul ${tabId || '(activ)'} nu este deschis sau nu este un tab web.`);
  return { wc, tabId };
}

const SNAPSHOT_JS = (maxChars) => `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const sel = 'a[href],button,input,textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[contenteditable=true],summary,label[for]';
  let n = 0; const els = [];
  document.querySelectorAll('[data-netor-ref]').forEach((e) => e.removeAttribute('data-netor-ref'));
  for (const el of document.querySelectorAll(sel)) {
    if (!vis(el) || els.length >= 250) continue;
    const ref = 'e' + (++n); el.setAttribute('data-netor-ref', ref);
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.title || '').trim().replace(/\\s+/g, ' ').slice(0, 90);
    els.push({ ref, tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '', name: el.name || el.id || '', text,
      href: el.href ? String(el.href).slice(0, 160) : undefined, value: el.type === 'password' ? (el.value ? '••••' : '') : (el.value || undefined) });
  }
  return { title: document.title, url: location.href, text: (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, ${maxChars}), elements: els };
})()`;

const FIND_JS = (q) => `(() => {
  const q = ${JSON.stringify(q)};
  let el = null;
  if (q.ref) el = document.querySelector('[data-netor-ref="' + q.ref + '"]');
  if (!el && q.selector) { try { el = document.querySelector(q.selector); } catch (_) { el = null; } }
  if (!el && q.text) {
    const t = q.text.toLowerCase();
    el = Array.from(document.querySelectorAll('a,button,[role=button],input[type=submit],label,span,div,li,td'))
      .filter((e) => (e.innerText || e.value || '').trim().toLowerCase() === t || (e.getAttribute('aria-label') || '').toLowerCase() === t)
      .sort((a, b) => a.innerText.length - b.innerText.length)[0] || null;
  }
  return el;
})()`;

async function withElement(wc, q, body) {
  return wc.executeJavaScript(`(() => { const el = ${FIND_JS(q)}; if (!el) return { ok: false, error: 'element negasit' }; el.scrollIntoView({ block: 'center' }); ${body} })()`, true);
}

// §2 Upload direct prin cale
async function directFileUpload(wc, q, files) {
  const paths = (Array.isArray(files) ? files : [files]).filter(Boolean).map((p) => path.resolve(String(p)));
  for (const p of paths) if (!fs.existsSync(p)) throw new Error(`Fișierul nu există: ${p}`);
  const mark = `up${Date.now()}`;
  const found = await withElement(wc, q.ref || q.selector || q.text ? q : { selector: 'input[type=file]' }, `el.setAttribute('data-netor-up', '${mark}'); return { ok: true };`);
  if (!found.ok) throw new Error('Câmpul de încărcare (input[type=file]) nu a fost găsit.');
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  const doc = await wc.debugger.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
  const node = await wc.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `[data-netor-up="${mark}"]` });
  await wc.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: node.nodeId, files: paths });
  await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-netor-up="${mark}"]'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return Array.from(el.files || []).map((f) => f.name); })()`);
  return { uploaded: paths };
}

// §3 Executie comenzi
async function execute(cmd, params = {}) {
  const st = ctx.store.state;
  switch (cmd) {
    case 'ping': return { pong: true, version: st.version, ts: new Date().toISOString() };
    case 'info': return { version: st.version, os: process.platform, hostname: os.hostname(), browsers: st.browsers.length, active_browser: st.activeBrowserId };
    case 'tabs.list': return st.browsers.filter((b) => !params.browserId || b.id === params.browserId).map((b) => ({
      browserId: b.id, browser: b.name, groups: b.groups.map((g) => ({ id: g.id, name: g.name })),
      tabs: b.tabs.map((t) => ({ tabId: t.id, type: t.type, title: t.customTitle || t.title, url: t.url, groupId: t.groupId || '', pinned: !!t.pinned, open: !!wcForTab(t.id) })) }));
    case 'tab.open': return ctx.uiCall('openTab', params);
    case 'tab.activate': return ctx.uiCall('activateTab', params);
    case 'tab.close': return ctx.uiCall('closeTab', params);
    case 'page.navigate': {
      const { wc, tabId } = target(params);
      await wc.loadURL(params.url).catch((err) => { if (!/ERR_ABORTED/.test(err.message)) throw err; });
      return { tabId, url: wc.getURL(), title: wc.getTitle() };
    }
    case 'page.insert': { const { wc } = target(params); wc.focus(); wc.insertText(String(params.text ?? '')); return { ok: true }; }
    case 'page.back': { const { wc } = target(params); wc.navigationHistory.goBack(); return { ok: true }; }
    case 'page.snapshot': { const { wc, tabId } = target(params); return { tabId, ...(await wc.executeJavaScript(SNAPSHOT_JS(params.maxChars || LIMITS.snapshotTextChars), true)) }; }
    case 'page.screenshot': { const { wc } = target(params); const img = await wc.capturePage(); return { dataUrl: img.resize({ width: Math.min(1280, img.getSize().width) }).toDataURL() }; }
    case 'page.eval': { const { wc } = target(params); return { result: await wc.executeJavaScript(String(params.expr || ''), true) }; }
    case 'page.scroll': { const { wc } = target(params); return wc.executeJavaScript(`window.scrollBy(0, ${Number(params.dy) || 600}); ({ y: scrollY, h: document.body.scrollHeight })`); }
    case 'page.wait': {
      const { wc } = target(params);
      const until = Date.now() + Math.min(Number(params.timeoutMs) || LIMITS.templateStepTimeoutMs, 60000);
      if (!params.selector && !params.text) { await new Promise((r) => setTimeout(r, Math.min(Number(params.ms) || 1000, 30000))); return { ok: true }; }
      while (Date.now() < until) {
        const ok = await wc.executeJavaScript(`!!(${FIND_JS({ selector: params.selector, text: params.text })})`).catch(() => false);
        if (ok) return { ok: true };
        await new Promise((r) => setTimeout(r, 300));
      }
      return { ok: false, error: 'timeout' };
    }
    case 'dom.click': {
      const { wc } = target(params);
      return withElement(wc, params, `el.click(); return { ok: true, text: (el.innerText || el.value || '').slice(0, 60) };`);
    }
    case 'dom.type': {
      const { wc } = target(params);
      const r = await withElement(wc, params, `el.focus(); if (el.select) el.select(); else document.execCommand('selectAll'); return { ok: true };`);
      if (!r.ok) return r;
      // Textul tastat inlocuieste selectia (continutul vechi), ca la tastare reala
      const text = String(params.text ?? '');
      wc.insertText(text);
      // Un tab din fundal (agentul lucreaza cat tu esti in alt tab) nu are focusul tastaturii: daca textul
      // nu a intrat, il punem prin setterul nativ + evenimentele input/change, ca sa-l vada si React/Vue
      await withElement(wc, params, `const v = ${JSON.stringify(text)}; if (('value' in el ? el.value : el.innerText) !== v) {
        const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); if (d && d.set) d.set.call(el, v); else el.innerText = v;
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } return { ok: true };`);
      if (params.submit && wc.isFocused()) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); wc.sendInputEvent({ type: 'char', keyCode: 'Return' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); }
      else if (params.submit) await withElement(wc, params, `for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        if (el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); } return { ok: true };`);
      return { ok: true };
    }
    case 'dom.select': {
      const { wc } = target(params);
      return withElement(wc, params, `const v = ${JSON.stringify(String(params.value ?? ''))}.toLowerCase();
        const o = Array.from(el.options || []).find((x) => x.value.toLowerCase() === v || x.text.trim().toLowerCase() === v);
        if (!o) return { ok: false, error: 'optiune negasita' }; el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true };`);
    }
    case 'dom.extract': {
      const { wc } = target(params);
      return wc.executeJavaScript(`(() => { const attr = ${JSON.stringify(params.attr || 'text')};
        const get = (e) => attr === 'text' ? (e.innerText || '').trim() : attr === 'html' ? e.innerHTML : (e.getAttribute(attr) || e[attr] || '');
        const els = Array.from(document.querySelectorAll(${JSON.stringify(params.selector || 'body')}));
        return { ok: els.length > 0, values: ${params.multiple ? 'els.map(get)' : 'els.slice(0, 1).map(get)'} }; })()`, true);
    }
    case 'file.upload': {
      const { wc } = target(params);
      let files = params.files || params.path;
      if (params.base64 && params.filename) {
        const tmp = path.join(os.tmpdir(), `netor-${Date.now()}-${path.basename(params.filename)}`);
        fs.writeFileSync(tmp, Buffer.from(params.base64, 'base64'));
        files = [tmp];
      }
      return directFileUpload(wc, params, files);
    }
    case 'notes.list': return st.notes.map((n) => ({ id: n.id, title: n.title, chars: (n.content || '').length }));
    default: {
      if (ctx.extra && ctx.extra[cmd]) return ctx.extra[cmd](params);
      throw new Error(`Comandă necunoscută: ${cmd}`);
    }
  }
}

function init(opts) { ctx = opts; }

module.exports = { init, execute, activeTabId, directFileUpload };
