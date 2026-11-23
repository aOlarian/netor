/* MAP
 * Scop: Constante si starea implicita Netor Desktop (fara date de test): versiune, endpoint-uri, porturi,
 *       motoare de cautare, liste adblock, limite configurabile si structura starii.
 * Legaturi: main.js, state-store.js, sessions.js, agent-runner.js, automation.js
 * Sectiuni:
 *   §1 Aplicatie, endpoint-uri, porturi
 *   §2 Limite si praguri (config, nu hardcodare)
 *   §3 Motoare de cautare si adblock
 *   §4 Starea implicita
 */
const path = require('path');
const os = require('os');

// §1 Aplicatie, endpoint-uri, porturi
const APP_VERSION = '1.2.0';
const DEFAULT_CLOUD_URL = process.env.NETOR_CLOUD_URL || '';
const LOCAL_BRIDGE_PORT = Number(process.env.NETOR_BRIDGE_PORT || 10211);
const NEWTAB_URL = 'netor://newtab';

// §2 Limite si praguri
const LIMITS = {
  historyMax: 20000,            // intrari maxime in istoric (interval 1000-100000)
  closedTabsMax: 25,            // taburi inchise retinute pentru Ctrl+Shift+T (5-100)
  agentMaxStepsPerTurn: 14,     // pasi de unelte per tura de agent (3-40)
  agentCompressChars: 60000,    // prag caractere istoric pentru autocompresie (20000-400000)
  agentKeepTurns: 5,            // ture pastrate necomprimate (2-20)
  agentRequestTimeoutMs: 240000,// timeout cerere AI (30000-600000)
  vaultAutoLockMin: 15,         // minute de inactivitate pana la blocarea seifului (0 = niciodata)
  pinMaxAttempts: 5,            // incercari PIN gresite inainte de pauza
  pinLockoutMs: 30000,          // pauza dupa prea multe incercari
  templateStepTimeoutMs: 15000, // timeout implicit pe pas de sablon
  snapshotTextChars: 9000,      // text maxim trimis agentului dintr-o pagina
};

// §3 Motoare de cautare si adblock
const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' },
};

const ADBLOCK_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'pagead2.googlesyndication.com',
  'adnxs.com', 'taboola.com', 'outbrain.com', 'criteo.com', 'criteo.net', 'scorecardresearch.com', 'amazon-adsystem.com',
  'adsrvr.org', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'casalemedia.com', 'smartadserver.com', 'teads.tv',
  'moatads.com', 'quantserve.com', 'yieldmo.com', 'sharethrough.com', 'bidswitch.net', 'adform.net', 'zedo.com',
  'popads.net', 'propellerads.com', 'mgid.com', 'revcontent.com', 'media.net', 'adroll.com', 'exoclick.com',
  'hotjar.com', 'mouseflow.com', 'crazyegg.com', 'fullstory.com', 'clarity.ms', 'quantcount.com', 'gemius.pl',
  'trafic.ro', '2performant.com', 'adocean.pl', 'facebook.net/tr', 'connect.facebook.net/signals', 'bat.bing.com',
];

// §4 Starea implicita
function createDefaultState() {
  const downloads = path.join(os.homedir(), 'Downloads');
  return {
    version: APP_VERSION,
    globalSettings: {
      cloudUrl: DEFAULT_CLOUD_URL, authToken: '', user: null, deviceId: '', deviceKey: '', autoSync: false,
      theme: 'chrome-light',
      workspace: { mode: 'none', path: '', remoteDeviceId: '', allowWrite: false },
      ai: { mode: 'cloud', endpoint: '', apiKey: '', model: '' },
      searchEngine: 'google', homepage: NEWTAB_URL, startup: 'restore',
      proxy: { mode: 'system', scheme: 'socks5', host: '', port: '', username: '', password: '', bypass: '<local>' },
      downloadDir: downloads, askDownload: false, adblock: true, favoritesMode: 'separate', showFavorites: true,
      vaultAutoLockMin: LIMITS.vaultAutoLockMin, offerSavePasswords: true,
    },
    minibar: { position: 'right', bgColor: '#1F1F23' },
    favorites: [],
    notes: [],
    agents: [],
    templates: [],
    activeBrowserId: 'brw_default',
    browsers: [createBrowser('brw_default', 'Principal', '🌐', '#1A73E8')],
  };
}

function createBrowser(id, name, icon, bgColor) {
  const tabId = `tab_${Date.now().toString(36)}`;
  return {
    id, name, icon, iconColor: '#FFFFFF', bgColor, theme: 'inherit',
    proxy: { mode: 'inherit' }, downloadDir: '', adblock: 'inherit', favoritesMode: 'inherit', allPrivate: false,
    active: { kind: 'tab', id: tabId },
    tabs: [{ id: tabId, type: 'web', url: NEWTAB_URL, title: 'Tab nou', customTitle: '', pinned: false, groupId: '' }],
    groups: [], closedTabs: [], updatedAt: Date.now(),
  };
}

module.exports = {
  APP_VERSION, DEFAULT_CLOUD_URL, LOCAL_BRIDGE_PORT, NEWTAB_URL, LIMITS, SEARCH_ENGINES, ADBLOCK_DOMAINS,
  createDefaultState, createBrowser,
};
