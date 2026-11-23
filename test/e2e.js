/* MAP
 * Scop: Suita E2E Netor: porneste paginile de proba (formular, iframe de plata pe alt port, proxy HTTP
 *       contorizat), lanseaza Netor intr-un profil temporar (sau binarul instalat: NETOR_TEST_EXE), ruleaza
 *       cazurile din cases-*.js si scrie un raport cu fiecare verificare si capturi de ecran.
 *       Rulare: node test/e2e.js   (optional: NETOR_TEST_AI_KEY + NETOR_TEST_AI_URL pentru agent/AI real)
 * Legaturi: cases-ui.js, cases-groups.js, cases-data.js, cases-ai.js, src/main/local-server.js (ui.eval/test.input in modul de test)
 * Sectiuni:
 *   §1 Servere de proba (pagina, iframe, proxy)
 *   §2 Pornire/oprire Netor si apeluri de control
 *   §3 Rulare cazuri si raport
 */
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORTS = { page: 10212, frame: 10214, proxy: 10213, bridge: 10211 };
const OUT = path.join(os.tmpdir(), 'netor-e2e-out');

// §1 Servere de proba (pagina, iframe, proxy)
const FORM = `<!DOCTYPE html><html><head><title>Formular Netor</title></head><body><h1>Comanda</h1>
<form id="f" onsubmit="event.preventDefault()">
<input id="fname" name="first_name" placeholder="Prenume"><input id="lname" name="last_name" placeholder="Nume">
<input id="email" type="email" name="email"><input id="phone" name="telefon"><input id="company" name="company" placeholder="Firma">
<input id="cui" name="cui"><label for="street">Adresa</label><input id="street" name="address"><input id="city" name="city"><input id="zip" name="zip">
<input id="slot1" name="observatii1"><input id="slot2" name="observatii2"><input id="upload" type="file" name="doc">
<p id="sel">Text de copiat in slot</p><iframe id="pay" src="http://127.0.0.1:${PORTS.frame}/pay" width="400" height="120"></iframe></form>
<a id="next" href="/p2">Pagina 2</a></body></html>`;
const PAY = '<!DOCTYPE html><html><body><input id="cc" name="cardnumber" autocomplete="cc-number"><input id="exp" name="exp-date" autocomplete="cc-exp"><input id="cvc" name="cvc" autocomplete="cc-csc"></body></html>';
const LOGIN = '<!DOCTYPE html><html><head><title>Login</title></head><body><form id="lf" onsubmit="event.preventDefault()"><input id="u" name="username"><input id="p" type="password" name="password"><button id="b" type="submit">Intră</button></form></body></html>';

function startServers() {
  const proxyHits = [];
  const page = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url.startsWith('/item/')) res.end(`<html><head><title>Produs ${req.url.slice(6)}</title></head><body><h1 class="t">Produs ${req.url.slice(6)}</h1><span class="p">${Number(req.url.slice(6)) * 10} lei</span></body></html>`);
    else if (req.url === '/login') res.end(LOGIN);
    else if (req.url === '/p2') res.end('<html><head><title>Pagina 2</title></head><body>doi</body></html>');
    else res.end(FORM);
  });
  const frame = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAY); });
  // Proxy HTTP minimal: contorizeaza cererile si le trimite mai departe
  const proxy = http.createServer((req, res) => {
    proxyHits.push(req.url);
    const u = new URL(req.url);
    const up = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  proxy.on('connect', (req, sock) => { const [h, p] = req.url.split(':'); const s = net.connect(p, h, () => { sock.write('HTTP/1.1 200 OK\r\n\r\n'); s.pipe(sock); sock.pipe(s); }); s.on('error', () => sock.destroy()); });
  return Promise.all([[page, PORTS.page], [frame, PORTS.frame], [proxy, PORTS.proxy]].map(([s, p]) => new Promise((r) => s.listen(p, '127.0.0.1', r))))
    .then(() => ({ close: () => [page, frame, proxy].forEach((s) => s.close()), proxyHits }));
}

// §2 Pornire/oprire Netor si apeluri de control
class Netor {
  constructor(profile, port = PORTS.bridge) { this.profile = profile; this.port = port; this.child = null; }
  async start() {
    const exe = process.env.NETOR_TEST_EXE || path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
    const args = process.env.NETOR_TEST_EXE ? [] : [path.join(__dirname, '..')];
    this.child = spawn(exe, args, { env: { ...process.env, NETOR_TEST: '1', NETOR_USER_DATA_DIR: this.profile, NETOR_BRIDGE_PORT: String(this.port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    const log = fs.createWriteStream(path.join(OUT, 'netor-app.log'), { flags: 'a' });
    this.child.stdout.pipe(log);
    this.child.stderr.pipe(log);
    for (let i = 0; i < 80; i++) {
      await sleep(300);
      try { if ((await fetch(`http://127.0.0.1:${this.port}/health`)).ok) break; } catch (_) { /* inca porneste */ }
    }
    this.token = fs.readFileSync(path.join(this.profile, 'netor-control-token.txt'), 'utf8');
    await this.waitFor('!!window.NetorApp && !!NetorApp.state && document.querySelectorAll(".pane").length > 0', 15000);
  }
  async stop() {
    if (!this.child) return;
    await this.ev('NetorApp.flush()').catch(() => {});
    this.child.kill();
    await sleep(1500);
    this.child = null;
  }
  async call(body) {
    const r = await fetch(`http://127.0.0.1:${this.port}/cmd`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-netor-token': this.token }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'eroare');
    return j.data;
  }
  async ev(expr) {
    // O singura expresie -> intoarcem valoarea; mai multe instructiuni fara return -> le rulam ca atare
    const body = /\breturn\b/.test(expr) || /;/.test(expr) ? expr : `return (${expr})`;
    const r = await this.call({ cmd: 'ui.eval', expr: `(async () => { try { ${body} } catch (e) { return { __err: String(e && e.stack || e) }; } })()` });
    if (r && r.__err) throw new Error(`eroare în interfață: ${r.__err.split(/\r?\n/).slice(0, 3).join(' | ')}`);
    return r;
  }
  cmd(cmd, params) { return this.call({ cmd, params }); }
  input(tabId, events) { return this.call({ cmd: 'test.input', tabId, events }); }
  shot(name) { return this.call({ cmd: 'ui.screenshot', file: path.join(OUT, `${name}.png`) }); }
  async waitFor(expr, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (await this.ev(expr)) return true; } catch (_) { /* reincercam */ } await sleep(250); }
    throw new Error(`timeout: ${expr}`);
  }
  async pageEval(tabId, js) { return this.cmd('page.eval', { tabId, expr: js }).then((r) => r.result); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// §3 Rulare cazuri si raport
async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'netor-e2e-'));
  require('./fixtures').writeLegacyProfile(profile);
  const servers = await startServers();
  const app = new Netor(profile);
  const results = [];
  const ctx = { app, PORTS, OUT, profile, servers, sleep, results, assert: require('assert') };
  const check = async (name, fn) => {
    const t0 = Date.now();
    try { const info = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, info }); console.log(`  ✓ ${name}${info ? ` · ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`); } catch (err) { results.push({ name, ok: false, error: err.message }); console.log(`  ✗ ${name}: ${err.message}`); await app.shot(`FAIL-${results.length}`).catch(() => {}); }
  };
  ctx.check = check;
  try {
    if (process.env.E2E_ONLY !== 'cases-cloud') await app.start();
    for (const mod of (process.env.E2E_ONLY || 'cases-ui,cases-groups,cases-data,cases-ai').split(',')) { console.log(`\n[${mod}]`); await require(`./${mod}`).run(ctx); }
  } finally {
    await app.stop().catch(() => {});
    servers.close();
  }
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'raport.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} verificări trecute. Raport și capturi: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}

module.exports = { Netor, sleep, PORTS };
if (require.main === module) main().catch((err) => { console.error('[E2E] eroare fatală:', err); process.exit(2); });
