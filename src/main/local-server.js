/* MAP
 * Scop: Server HTTP local de control (127.0.0.1:10211) pentru unelte de pe aceeasi masina (agenti din
 *       Workspace, teste E2E). Cere un token aleator scris in profil (netor-control-token.txt); evaluarea JS in
 *       interfata (ui.eval) exista doar in modul de test (NETOR_TEST=1).
 * Legaturi: main.js, cdp-bridge.js
 * Sectiuni:
 *   §1 Token si pornire
 *   §2 Rute (/health, /cmd)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LOCAL_BRIDGE_PORT } = require('./config');

let server = null;

// §1 Token si pornire
function start({ store, execute, dir, mainWindow }) {
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(path.join(dir, 'netor-control-token.txt'), token, 'utf8');
  const testMode = process.env.NETOR_TEST === '1';

  // §2 Rute
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url === '/health') {
      send(200, { ok: true, app: 'netor-desktop', version: store.state.version, browsers: store.state.browsers.length });
      return;
    }
    // Paginile web nu pot trimite acest antet fara preflight CORS, pe care nu il acceptam
    if (req.headers['x-netor-token'] !== token) { send(401, { ok: false, error: 'token lipsă sau greșit' }); return; }
    if (req.method !== 'POST' || req.url !== '/cmd') { send(404, { ok: false, error: 'not found' }); return; }
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 20e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const p = JSON.parse(body || '{}');
        if (p.cmd === 'ui.eval') {
          if (!testMode) throw new Error('ui.eval este disponibil doar în modul de test');
          send(200, { ok: true, data: await mainWindow().webContents.executeJavaScript(String(p.expr), true) });
          return;
        }
        if (p.cmd === 'test.input') {
          if (!testMode) throw new Error('test.input este disponibil doar în modul de test');
          const wc = p.tabId ? require('./web-contents').wcForTab(p.tabId) : mainWindow().webContents;
          for (const ev of p.events || []) {
            if (ev.wait) await new Promise((r) => setTimeout(r, ev.wait)); else wc.sendInputEvent(ev);
          }
          send(200, { ok: true, data: true });
          return;
        }
        if (p.cmd === 'test.frames') {
          if (!testMode) throw new Error('test.frames este disponibil doar în modul de test');
          const wc = require('./web-contents').wcForTab(p.tabId);
          const out = [];
          for (const f of wc.mainFrame.framesInSubtree) out.push(await f.executeJavaScript(String(p.expr)).catch((err) => `eroare: ${err.message}`));
          send(200, { ok: true, data: out });
          return;
        }
        if (p.cmd === 'ui.screenshot') {
          if (!testMode) throw new Error('ui.screenshot este disponibil doar în modul de test');
          const img = await mainWindow().webContents.capturePage();
          fs.writeFileSync(p.file, img.toPNG());
          send(200, { ok: true, data: { file: p.file } });
          return;
        }
        send(200, { ok: true, data: await execute(p.cmd, p.params || {}) });
      } catch (err) {
        send(500, { ok: false, error: err.message });
      }
    });
  });
  server.on('error', (err) => console.error('[netor] serverul local de control nu a pornit:', err.message));
  server.listen(LOCAL_BRIDGE_PORT, '127.0.0.1');
}

function stop() {
  if (server) server.close();
  server = null;
}

module.exports = { start, stop };
