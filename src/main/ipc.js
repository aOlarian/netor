/* MAP
 * Scop: Toate canalele IPC dintre interfata Netor si procesul principal, plus apelurile inverse
 *       (procesul principal cere interfetei sa deschida taburi, sa actualizeze starea etc. = uiCall).
 * Legaturi: main.js, preload.js si toate modulele din src/main
 * Sectiuni:
 *   §1 Apeluri catre interfata (uiCall) si emitere evenimente
 *   §2 Stare, fereastra, dialoguri de sistem
 *   §3 Sesiuni, taburi, istoric, descarcari, sloturi
 *   §4 Seif si completare
 *   §5 AI, agenti, sabloane, cloud, extensii
 */
const { ipcMain, dialog, shell, clipboard, app, nativeTheme } = require('electron');
const sessions = require('./sessions');
const web = require('./web-contents');
const agents = require('./agent-runner');
const ai = require('./ai-client');
const automation = require('./automation');
const cloud = require('./cloud-sync');
const vaultFill = require('./vault-fill');
const extensions = require('./extensions');
const bridge = require('./cdp-bridge');

let c = null; // { store, vault, slots, history, mainWindow(), dir }
const pending = new Map();
let seq = 0;

// §1 Apeluri catre interfata si emitere evenimente
function emit(channel, payload) {
  const w = c && c.mainWindow();
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function uiCall(cmd, params = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`Interfața nu a răspuns la ${cmd}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, t });
    emit('netor:ui-call', { id, cmd, params });
  });
}

const handle = (ch, fn) => ipcMain.handle(ch, async (_e, arg) => {
  try { return await fn(arg || {}); } catch (err) { return { ok: false, error: err.message }; }
});

function register(ctx) {
  c = ctx;
  ipcMain.on('netor:ui-reply', (_e, { id, ok, data, error }) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.t);
    pending.delete(id);
    if (ok) p.resolve(data); else p.reject(new Error(error || 'eroare interfață'));
  });

  // §2 Stare, fereastra, dialoguri de sistem
  handle('netor:get-init', () => ({ state: c.store.state, version: app.getVersion(), platform: process.platform, vault: c.vault.status(), slots: c.slots.values, downloads: sessions.listDownloads(), extensions: extensions.list() }));
  handle('netor:save-state', ({ state }) => { c.store.replace(state); return { ok: true }; });
  handle('netor:titlebar', ({ color, symbolColor, mode }) => {
    const w = c.mainWindow();
    if (w && w.setTitleBarOverlay) w.setTitleBarOverlay({ color, symbolColor, height: 40 });
    // Paginile web (prefers-color-scheme) urmeaza modul temei alese, nu pe cel al Windows
    if (mode === 'light' || mode === 'dark') nativeTheme.themeSource = mode;
    return { ok: true };
  });
  handle('netor:pick-folder', async ({ title, defaultPath }) => {
    const r = await dialog.showOpenDialog(c.mainWindow(), { title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('netor:pick-files', async ({ title, multi, filters }) => {
    const r = await dialog.showOpenDialog(c.mainWindow(), { title, filters, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] });
    return r.canceled ? [] : r.filePaths;
  });
  handle('netor:open-external', ({ url }) => shell.openExternal(url));
  handle('netor:show-item', ({ path }) => shell.showItemInFolder(path));
  handle('netor:clipboard', ({ text }) => { if (typeof text === 'string') clipboard.writeText(text); return clipboard.readText(); });

  // §3 Sesiuni, taburi, istoric, descarcari, sloturi
  handle('netor:prepare-tab', async ({ browserId, browser, tab }) => {
    // Interfata trimite configul browserului: starea din procesul principal poate fi cu o salvare in urma
    const brw = browser || c.store.state.browsers.find((b) => b.id === browserId);
    const partition = sessions.partitionFor(brw, tab);
    await sessions.configureSession(partition, brw, tab);
    return { partition };
  });
  handle('netor:register-tab', ({ wcId, tabId, browserId }) => { web.registerTab(wcId, tabId, browserId); return { ok: true }; });
  handle('netor:clear-partition', ({ partition }) => sessions.clearPartition(partition));
  handle('netor:clear-browser', async ({ browserId }) => {
    for (const p of sessions.configuredPartitions()) if (p.includes(`netor_${browserId}`) || p.includes(`netor_private_${browserId}`)) await sessions.clearPartition(p);
    return { ok: true };
  });
  handle('netor:test-proxy', (p) => sessions.testProxy(p));
  handle('netor:history-query', ({ q, limit }) => c.history.query(q, limit));
  handle('netor:history-list', ({ q, offset }) => c.history.list(q, offset));
  handle('netor:history-remove', ({ url }) => { if (url) c.history.remove(url); else c.history.clear(); return { ok: true }; });
  handle('netor:download-action', ({ id, action }) => sessions.downloadAction(id, action));
  handle('netor:slot-set', ({ slot, value }) => { c.slots.set(slot, value); return c.slots.values; });
  handle('netor:slot-clear', () => { c.slots.clear(); return {}; });
  handle('netor:held-slot', () => c.slots.held || '');
  handle('netor:tab-command', ({ tabId, cmd, params }) => bridge.execute(cmd, { ...(params || {}), tabId }));

  // §4 Seif si completare
  handle('netor:vault-status', () => c.vault.status());
  handle('netor:vault-setup', ({ pin }) => ({ ok: true, vault: c.vault.setup(pin) }));
  handle('netor:vault-unlock', async ({ pin }) => {
    const vault = c.vault.unlock(pin);
    cloud.syncNow().catch((err) => emit('netor:sync', { error: err.message }));
    return { ok: true, vault };
  });
  handle('netor:vault-lock', () => { c.vault.lock(); return { ok: true }; });
  handle('netor:vault-get', () => ({ ok: true, vault: c.vault.requireOpen() }));
  handle('netor:vault-save', ({ vault }) => { const v = c.vault.save(vault); cloud.schedulePush(); return { ok: true, vault: v }; });
  handle('netor:vault-change-pin', ({ oldPin, newPin }) => ({ ok: c.vault.changePin(oldPin, newPin) }));
  handle('netor:vault-autolock', ({ minutes }) => { c.vault.autoLockMin = Number(minutes) || 0; c.vault.touch(); return { ok: true }; });
  handle('netor:fill', (p) => vaultFill.fill(p));

  // §5 AI, agenti, sabloane, cloud, extensii
  handle('netor:ai-secret', ({ apiKey }) => { ai.setSecret('aiApiKey', apiKey || ''); return { ok: true }; });
  handle('netor:ai-has-secret', () => !!ai.getSecret('aiApiKey'));
  handle('netor:ai-models', async () => ({ ok: true, models: await ai.listModels() }));
  handle('netor:ai-test', () => ai.test());
  handle('netor:agent-turn', (p) => agents.runTurn(p));
  handle('netor:agent-stop', ({ agentId }) => agents.stop(agentId));
  handle('netor:agent-conv', ({ agentId }) => ({ ...agents.loadConv(agentId), busy: agents.isRunning(agentId) }));
  handle('netor:agent-clear', ({ agentId }) => { agents.saveConv(agentId, { messages: [], summary: '' }); return { ok: true }; });
  handle('netor:agent-delete', ({ agentId }) => { agents.deleteConv(agentId); return { ok: true }; });
  handle('netor:agent-context', ({ agentId, browserId, groupId }) => agents.groupContext(agentId, browserId, groupId));
  handle('netor:template-run', ({ templateId }) => automation.start(templateId));
  handle('netor:template-stop', ({ runId }) => automation.stop(runId));
  handle('netor:template-resume', ({ runId, picked }) => automation.resume(runId, picked));
  handle('netor:cloud-login', (p) => cloud.login(p));
  handle('netor:cloud-logout', () => cloud.logout());
  handle('netor:cloud-sync', () => cloud.syncNow());
  handle('netor:cloud-devices', () => cloud.devices());
  handle('netor:cloud-status', () => ({ bridge: cloud.bridgeOnline() }));
  handle('netor:check-update', async () => {
    const r = await fetch(`${c.store.state.globalSettings.cloudUrl}/api/v1/version`, { signal: AbortSignal.timeout(10000) }).then((x) => x.json());
    return { current: app.getVersion(), latest: r.version || r.server, url: r.url || `${c.store.state.globalSettings.cloudUrl}/download/netor-install.exe`, notes: r.notes || '' };
  });
  handle('netor:ext-list', () => extensions.list());
  handle('netor:ext-install-store', ({ input }) => extensions.installFromStore(input));
  handle('netor:ext-install-folder', ({ dir }) => extensions.installUnpacked(dir));
  handle('netor:ext-remove', ({ id }) => extensions.remove(id));
  handle('netor:ext-enable', ({ id, on }) => extensions.setEnabled(id, on));
  handle('netor:ext-popup', ({ id, partition, x, y }) => extensions.openPopup(id, partition, x, y));
}

module.exports = { register, emit, uiCall };
