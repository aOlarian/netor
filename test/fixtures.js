/* MAP
 * Scop: Date de proba pentru E2E: un profil Netor v1.0 (stare veche + seif vechi criptat cu PIN-ul 1234,
 *       cu intrari demonstrative si o intrare reala) ca sa verificam migrarea la v1.1.
 * Legaturi: e2e.js, src/main/state-store.js (migrate), src/main/vault.js (importLegacy)
 * Sectiuni:
 *   §1 Stare v1.0
 *   §2 Seif v1.0
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// §1 Stare v1.0
function legacyState() {
  return {
    version: '1.0.0',
    globalSettings: { cloudUrl: 'https://netor.example.test', defaultDownloadDir: 'C:\\Temp', favoritesSameLine: false, workspacePath: 'C:\\Example\\Projects' },
    minibar: { position: 'right', bgColor: '#181512' },
    favorites: [{ id: 'fav_1', title: 'Netor Cloud', url: 'https://netor.example.test', folder: '' }, { id: 'fav_3', title: 'Funding EU', url: 'https://ec.europa.eu/', folder: 'Work' }],
    clipboardSlots: {},
    notes: [{ id: 'note_welcome', title: 'Instructiuni', content: 'nota veche', updatedAt: new Date().toISOString() }],
    agents: [{ id: 'agent_main', name: 'Nex Browser Agent', model: 'x', messages: [{ role: 'assistant', text: 'mesaj simulat' }] }],
    templates: [],
    activeBrowserId: 'brw_default',
    browsers: [{
      id: 'brw_default', name: 'Principal (Work)', icon: '🌐', iconColor: '#F2ECE4', bgColor: '#D97757', theme: 'amber-dark', proxy: '', adblock: true, allPrivate: false,
      activeTabId: 'tab_home', activeGroupId: '',
      groups: [{ id: 'grp_facebook', name: 'facebook', panes: [{ id: 'pane_1', type: 'web', refId: 'tab_home', widthPct: 50 }, { id: 'pane_2', type: 'note', refId: 'note_welcome', widthPct: 25 }, { id: 'pane_3', type: 'agent', refId: 'agent_main', widthPct: 25 }] }],
      tabs: [{ id: 'tab_home', type: 'web', title: 'Netor', url: 'http://127.0.0.1:10212/p2', pinned: true }, { id: 'tab_2', type: 'web', title: 'Formular', url: 'http://127.0.0.1:10212/', pinned: false }],
    }],
  };
}

// §2 Seif v1.0
function legacyVault() {
  const vault = {
    logins: [{ id: 'log_1', label: 'demo', domain: 'netor.example.test', username: 'demo-user', password: '•••' }],
    cards: [{ id: 'crd_1', cardName: 'Visa demo', number: '4111 •••• •••• 1111', exp: '09/29', cvv: '000' }, { id: 'crd_real', cardName: 'Card real importat', holder: 'TEST', number: '4111111111111111', exp: '12/30', cvv: '123' }],
    addresses: [], companies: [], identities: [], contacts: [], dataGroups: [],
  };
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync('1234', salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(Buffer.from(JSON.stringify(vault))), c.final()]);
  return { cipher: Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64'), salt: salt.toString('hex') };
}

function writeLegacyProfile(dir) {
  fs.writeFileSync(path.join(dir, 'netor-state.json'), JSON.stringify(legacyState()), 'utf8');
  fs.writeFileSync(path.join(dir, 'netor-vault.enc.json'), JSON.stringify(legacyVault()), 'utf8');
}

module.exports = { writeLegacyProfile };
