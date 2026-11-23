/* MAP
 * Scop: Procesul principal Netor: o singura instanta, fereastra cu bara de titlu integrata (taburile stau in
 *       bara ferestrei, ca la Chrome), initializarea modulelor, autentificarea proxy, serverul local de control.
 * Legaturi: src/main/* (config, state-store, vault, sessions, web-contents, ipc, cdp-bridge, agent-runner,
 *           agent-tools, automation, cloud-sync, extensions, vault-fill, local-server)
 * Sectiuni:
 *   §1 Instanta unica, profil de date, scheme
 *   §2 Fereastra principala
 *   §3 Initializarea modulelor si legaturile dintre ele
 *   §4 Ciclul de viata
 */
const { app, BrowserWindow, screen, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// §1 Instanta unica, profil de date, scheme
if (process.env.NETOR_USER_DATA_DIR) app.setPath('userData', process.env.NETOR_USER_DATA_DIR);
if (!process.env.NETOR_USER_DATA_DIR && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const sessions = require('./src/main/sessions');
sessions.registerSchemes();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const { StateStore } = require('./src/main/state-store');
const { Vault } = require('./src/main/vault');
const { Slots, History } = require('./src/main/slots-history');
const web = require('./src/main/web-contents');
const ipc = require('./src/main/ipc');
const bridge = require('./src/main/cdp-bridge');
const agents = require('./src/main/agent-runner');
const agentAwake = require('./src/main/agent-awake');
const agentTools = require('./src/main/agent-tools');
const ai = require('./src/main/ai-client');
const automation = require('./src/main/automation');
const cloud = require('./src/main/cloud-sync');
const vaultFill = require('./src/main/vault-fill');
const extensions = require('./src/main/extensions');
const localServer = require('./src/main/local-server');

let mainWindow = null;
let slotsRef = null;
const pagePreload = () => {
  const p = path.join(__dirname, 'preload-page.js');
  const unpacked = p.replace('app.asar', 'app.asar.unpacked');
  return fs.existsSync(unpacked) ? unpacked : p;
};

// §2 Fereastra principala
function createWindow(store) {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const saved = store.state.window || {};
  mainWindow = new BrowserWindow({
    width: Math.min(saved.width || 1440, wa.width), height: Math.min(saved.height || 920, wa.height), x: saved.x, y: saved.y,
    minWidth: Math.min(760, wa.width), minHeight: Math.min(520, wa.height), title: 'Netor', show: false,
    backgroundColor: '#DEE1E6', titleBarStyle: 'hidden', titleBarOverlay: { color: '#DEE1E6', symbolColor: '#3C4043', height: 40 },
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true, spellcheck: true },
  });
  if (saved.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  const remember = () => {
    if (mainWindow.isDestroyed()) return;
    store.state.window = { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() };
    store.scheduleSave();
  };
  mainWindow.on('resize', remember);
  mainWindow.on('move', remember);
  mainWindow.on('focus', () => ipc.emit('netor:window-focus', true));
  mainWindow.on('blur', () => { slotsRef && slotsRef.setHeld(''); ipc.emit('netor:window-focus', false); });
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
}

// §3 Initializarea modulelor si legaturile dintre ele
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const dir = app.getPath('userData');
  const store = new StateStore(dir);
  const vault = new Vault(dir, (locked) => ipc.emit('netor:vault-locked', locked));
  vault.autoLockMin = Number(store.state.globalSettings.vaultAutoLockMin) || 0;
  const slots = new Slots(dir, ipc.emit);
  slotsRef = slots;
  const history = new History(dir);
  const uiCall = ipc.uiCall;
  const ctx = { store, vault, slots, history, dir, emit: ipc.emit, uiCall, mainWindow: () => mainWindow };

  sessions.init({ emit: ipc.emit, getState: () => store.state, onSessionCreated: (ses) => extensions.attach(ses) });
  web.init({ ...ctx, preloadPath: pagePreload(), get mainWindow() { return mainWindow; } });
  ai.init({ store, dir });
  vaultFill.init({ vault });
  const workspaceCmds = agentTools.init({ store, vaultFill, cloud });
  const execute = (cmd, params) => bridge.execute(cmd, params);
  bridge.init({ store, uiCall, extra: workspaceCmds });
  agents.init({ store, dir, emit: ipc.emit, uiCall });
  agentAwake.init({ uiCall });
  automation.init({ store, emit: ipc.emit, uiCall });
  extensions.init({ dir, mainWindow: () => mainWindow });
  ipc.register(ctx);
  cloud.init({ store, vault, dir, emit: ipc.emit, uiCall, execute });
  localServer.start({ store, execute, dir, mainWindow: () => mainWindow });

  app.on('login', (event, _wc, details, authInfo, cb) => {
    if (!authInfo.isProxy) return;
    const p = sessions.proxyCredentialsFor(authInfo.host, authInfo.port);
    if (p) { event.preventDefault(); cb(p.username, p.password); }
  });

  createWindow(store);
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.on('before-quit', () => { store.flush(); history.flush(); });
});

// §4 Ciclul de viata
app.on('window-all-closed', () => {
  localServer.stop();
  app.quit();
});
