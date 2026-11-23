/* MAP
 * Scop: Carlige pe fiecare tab web (<webview>) si pe fereastra principala: registrul tab<->webContents,
 *       scurtaturi de tastatura tip Chrome, tasta Ctrl+1..9 tinuta (sloturi), meniul contextual al paginii,
 *       ferestre noi -> taburi, istoric, cautare in pagina, securizarea atasarii webview.
 * Legaturi: main.js, slots-history.js, ipc.js, cdp-bridge.js, renderer (evenimente netor:*)
 * Sectiuni:
 *   §1 Registru tab <-> webContents
 *   §2 Tastatura: scurtaturi si sloturi
 *   §3 Meniu contextual (camp gol -> meniul Netor din interfata; restul -> meniu nativ)
 *   §4 Ferestre noi, istoric, cautare in pagina, atasare webview
 */
const { webContents, Menu, BrowserWindow, clipboard, ipcMain, shell } = require('electron');

const registry = new Map(); // wcId -> { tabId, browserId }
let ctx = null; // { emit, slots, history, store, preloadPath, mainWindow }

// §1 Registru tab <-> webContents
function registerTab(wcId, tabId, browserId) {
  for (const [id, v] of registry) if (v.tabId === tabId && id !== wcId) registry.delete(id);
  registry.set(Number(wcId), { tabId, browserId });
}

function wcForTab(tabId) {
  for (const [id, v] of registry) {
    if (v.tabId === tabId) {
      const wc = webContents.fromId(id);
      if (wc && !wc.isDestroyed()) return wc;
    }
  }
  return null;
}

const tabForWc = (wc) => registry.get(wc.id) || null;
const isPrivate = (info) => {
  const b = info && (ctx.store.state.browsers || []).find((x) => x.id === info.browserId);
  return !!(b && b.allPrivate);
};

// §2 Tastatura: scurtaturi si sloturi
const SHORTCUTS = [
  [(i) => i.control && !i.shift && i.code === 'KeyT', 'newTab'],
  [(i) => i.control && !i.shift && (i.code === 'KeyW' || i.code === 'F4'), 'closeTab'],
  [(i) => i.control && i.shift && i.code === 'KeyT', 'reopenTab'],
  [(i) => i.control && !i.shift && i.code === 'Tab', 'nextTab'],
  [(i) => i.control && i.shift && i.code === 'Tab', 'prevTab'],
  [(i) => (i.control && i.code === 'KeyL') || (i.alt && i.code === 'KeyD') || i.code === 'F6', 'focusUrl'],
  [(i) => (i.control && i.shift && i.code === 'KeyR') || (i.control && i.code === 'F5'), 'hardReload'],
  [(i) => (i.control && !i.shift && i.code === 'KeyR') || (!i.control && i.code === 'F5'), 'reload'],
  [(i) => i.alt && i.code === 'ArrowLeft', 'back'],
  [(i) => i.alt && i.code === 'ArrowRight', 'forward'],
  [(i) => i.control && i.code === 'KeyF', 'find'],
  [(i) => i.control && (i.code === 'Equal' || i.code === 'NumpadAdd'), 'zoomIn'],
  [(i) => i.control && (i.code === 'Minus' || i.code === 'NumpadSubtract'), 'zoomOut'],
  [(i) => i.control && (i.code === 'Digit0' || i.code === 'Numpad0'), 'zoomReset'],
  [(i) => i.code === 'F12' || (i.control && i.shift && i.code === 'KeyI'), 'devtools'],
  [(i) => i.control && !i.shift && i.code === 'KeyD', 'bookmark'],
  [(i) => i.control && i.code === 'KeyH', 'history'],
  [(i) => i.control && i.code === 'KeyJ', 'downloads'],
  [(i) => i.control && !i.shift && i.code === 'KeyP', 'print'],
  [(i) => i.control && i.shift && i.code === 'KeyB', 'toggleFavorites'],
];

function onInput(wc, event, input) {
  const digit = /^(Digit|Numpad)([1-9])$/.exec(input.code || '');
  if (input.type === 'keyDown' && input.control && digit) {
    ctx.slots.setHeld(digit[2]);
    if (input.shift) {
      event.preventDefault();
      grabSelectionToSlot(wc, digit[2]);
    }
    return;
  }
  if (input.type === 'keyUp' && (input.key === 'Control' || !input.control)) ctx.slots.setHeld('');
  if (input.type !== 'keyDown' || input.isAutoRepeat && !/^(Tab|Equal|Minus)$/.test(input.code)) return;
  for (const [test, name] of SHORTCUTS) {
    if (test(input)) {
      event.preventDefault();
      const info = tabForWc(wc);
      ctx.emit('netor:shortcut', { name, tabId: info ? info.tabId : '' });
      return;
    }
  }
}

function grabSelectionToSlot(wc, slot) {
  if (wc.getType() !== 'webview') {
    ctx.emit('netor:shortcut', { name: 'slotCopyHost', slot });
    return;
  }
  for (const f of wc.mainFrame.framesInSubtree) {
    try { f.send('netor-host:grab-selection', { slot }); } catch (err) { console.error('[netor] cadru indisponibil:', err.message); }
  }
}

// §3 Meniu contextual
function onContextMenu(wc, params) {
  const info = tabForWc(wc);
  if (params.isEditable && !String(params.selectionText || '').trim() && info) {
    ctx.emit('netor:form-menu', {
      wcId: wc.id, tabId: info.tabId, x: params.x, y: params.y,
      frame: params.frame ? { processId: params.frame.processId, routingId: params.frame.routingId } : null,
      url: (params.frame && params.frame.url) || params.pageURL, inputType: params.inputFieldType,
    });
    return;
  }
  const win = BrowserWindow.fromWebContents(wc.hostWebContents || wc) || ctx.mainWindow;
  Menu.buildFromTemplate(nativeMenuItems(wc, params, info)).popup({ window: win });
}

function nativeMenuItems(wc, p, info) {
  const items = [];
  const openTab = (url, background) => ctx.emit('netor:open-url', { url, background, tabId: info && info.tabId });
  const sel = String(p.selectionText || '').trim();
  if (p.linkURL) {
    items.push({ label: 'Deschide linkul într-un tab nou', click: () => openTab(p.linkURL, false) },
      { label: 'Deschide în fundal', click: () => openTab(p.linkURL, true) },
      { label: 'Deschide în alt browser', submenu: (ctx.store.state.browsers || []).map((b) => ({ label: `${b.icon || ''} ${b.name}`, click: () => ctx.emit('netor:open-url', { url: p.linkURL, browserId: b.id }) })) },
      { label: 'Copiază adresa linkului', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push({ label: 'Deschide imaginea într-un tab nou', click: () => openTab(p.srcURL, false) },
      { label: 'Salvează imaginea ca...', click: () => wc.downloadURL(p.srcURL) },
      { label: 'Copiază imaginea', click: () => wc.copyImageAt(p.x, p.y) },
      { label: 'Copiază adresa imaginii', click: () => clipboard.writeText(p.srcURL) }, { type: 'separator' });
  }
  if (p.isEditable) {
    items.push({ label: 'Taie', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Copiază', role: 'copy', enabled: p.editFlags.canCopy },
      { label: 'Lipește', role: 'paste', enabled: p.editFlags.canPaste }, { label: 'Selectează tot', role: 'selectAll' });
  } else if (sel) {
    items.push({ label: 'Copiază', role: 'copy' });
  }
  if (sel) {
    items.push({ label: 'Copiază în slot', submenu: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
      label: `Slot ${n}${ctx.slots.get(n) ? ' · ' + ctx.slots.get(n).slice(0, 24) : ''}`, accelerator: `Ctrl+Shift+${n}`, registerAccelerator: false,
      click: () => ctx.slots.set(n, sel) })) },
    { label: `Caută „${sel.slice(0, 28)}${sel.length > 28 ? '…' : ''}”`, click: () => ctx.emit('netor:open-url', { search: sel, tabId: info && info.tabId }) });
  }
  if (items.length) items.push({ type: 'separator' });
  items.push({ label: 'Înapoi', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: 'Înainte', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: 'Reîncarcă', click: () => wc.reload() }, { type: 'separator' },
    { label: 'Salvează pagina ca...', click: () => ctx.emit('netor:shortcut', { name: 'savePage', tabId: info && info.tabId }) },
    { label: 'Printează...', click: () => wc.print() },
    { label: 'Vezi sursa paginii', click: () => openTab('view-source:' + wc.getURL(), false) },
    { label: 'Inspectează', click: () => wc.inspectElement(p.x, p.y) });
  return items;
}

// §4 Ferestre noi, istoric, cautare in pagina, atasare webview
function hookWebview(wc) {
  wc.setWindowOpenHandler((d) => {
    const isPopup = d.disposition === 'new-window' && /width|height|popup/i.test(d.features || '');
    if (isPopup) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 520, height: 680 } };
    if (/^https?:|^netor:/i.test(d.url)) {
      const info = tabForWc(wc);
      ctx.emit('netor:open-url', { url: d.url, background: d.disposition === 'background-tab', tabId: info && info.tabId });
    } else if (/^mailto:|^tel:/i.test(d.url)) shell.openExternal(d.url);
    return { action: 'deny' };
  });
  wc.on('context-menu', (_e, params) => onContextMenu(wc, params));
  const addHistory = (url) => { const info = tabForWc(wc); if (info && !isPrivate(info)) ctx.history.add(url, wc.getTitle()); };
  wc.on('did-navigate', (_e, url) => addHistory(url));
  wc.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) addHistory(url); });
  wc.on('page-title-updated', (_e, title) => ctx.history.setTitle(wc.getURL(), title));
  wc.on('found-in-page', (_e, r) => { const info = tabForWc(wc); ctx.emit('netor:found', { tabId: info && info.tabId, active: r.activeMatchOrdinal, total: r.matches }); });
  wc.on('destroyed', () => registry.delete(wc.id));
}

function init(opts) {
  ctx = opts;
  ipcMain.on('netor:held-slot', (e) => { e.returnValue = ctx.slots.held || ''; });
  ipcMain.on('netor:slot-paste', (e, { slot }) => {
    const v = ctx.slots.get(slot);
    if (v) e.sender.insertText(v);
  });
  ipcMain.on('netor:slot-copy', (_e, { slot, text }) => { if (text) ctx.slots.set(slot, text); });
  require('electron').app.on('web-contents-created', (_e, wc) => {
    wc.on('before-input-event', (ev, input) => onInput(wc, ev, input));
    if (wc.getType() === 'webview') hookWebview(wc);
    wc.on('will-attach-webview', (_ev, prefs) => {
      // Webview-urile primesc doar preload-ul Netor, fara Node, izolate si cu preload si in iframe-uri (autofill in cadre de plata)
      prefs.preload = ctx.preloadPath;
      delete prefs.preloadURL;
      prefs.nodeIntegration = false;
      prefs.contextIsolation = true;
      prefs.sandbox = true;
      prefs.nodeIntegrationInSubFrames = true;
    });
  });
}

module.exports = { init, registerTab, wcForTab, tabForWc, registry };
