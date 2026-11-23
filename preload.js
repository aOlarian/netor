/* MAP
 * Scop: Preload-ul interfetei Netor: expune window.netorAPI (apeluri IPC catre procesul principal) si
 *       window.netorEvents (abonare la evenimente din procesul principal, doar pe canale permise).
 * Legaturi: main.js, src/main/ipc.js, src/renderer/js/*
 * Sectiuni:
 *   §1 API invoke
 *   §2 Evenimente si raspunsuri la apelurile inverse (uiCall)
 */
const { contextBridge, ipcRenderer } = require('electron');

// §1 API invoke
const inv = (ch) => (arg) => ipcRenderer.invoke(ch, arg);
const CHANNELS = ['get-init', 'save-state', 'titlebar', 'pick-folder', 'pick-files', 'open-external', 'show-item', 'clipboard',
  'prepare-tab', 'register-tab', 'clear-partition', 'clear-browser', 'test-proxy', 'history-query', 'history-list', 'history-remove',
  'download-action', 'slot-set', 'slot-clear', 'held-slot', 'tab-command',
  'vault-status', 'vault-setup', 'vault-unlock', 'vault-lock', 'vault-get', 'vault-save', 'vault-change-pin', 'vault-autolock', 'fill',
  'ai-secret', 'ai-has-secret', 'ai-models', 'ai-test', 'agent-turn', 'agent-stop', 'agent-conv', 'agent-clear', 'agent-delete', 'agent-context',
  'template-run', 'template-stop', 'template-resume', 'cloud-login', 'cloud-logout', 'cloud-sync', 'cloud-devices', 'cloud-status', 'check-update',
  'ext-list', 'ext-install-store', 'ext-install-folder', 'ext-remove', 'ext-enable', 'ext-popup'];
const api = {};
for (const ch of CHANNELS) api[ch.replace(/-(\w)/g, (_, l) => l.toUpperCase())] = inv(`netor:${ch}`);
contextBridge.exposeInMainWorld('netorAPI', api);

// §2 Evenimente si raspunsuri la apelurile inverse
const EVENTS = ['ui-call', 'shortcut', 'open-url', 'form-menu', 'download', 'found', 'slots', 'slot-held', 'vault-locked', 'vault-changed',
  'agent-event', 'template-event', 'sync', 'window-focus'];
contextBridge.exposeInMainWorld('netorEvents', {
  on: (name, cb) => {
    if (!EVENTS.includes(name)) throw new Error(`eveniment nepermis: ${name}`);
    ipcRenderer.on(`netor:${name}`, (_e, payload) => cb(payload));
  },
  reply: (id, ok, data, error) => ipcRenderer.send('netor:ui-reply', { id, ok, data, error }),
});
