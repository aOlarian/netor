/* MAP
 * Scop: Completarea formularelor din seif (in procesul principal, ca datele secrete sa nu treaca prin model):
 *       transforma o intrare din seif in valori pe tipuri de camp si le trimite cadrelor paginii.
 * Legaturi: vault.js, web-contents.js (wcForTab), preload-page.js (netor-host:fill), agent-tools.js, ipc.js
 * Sectiuni:
 *   §1 Valori pe tip de camp pentru fiecare categorie
 *   §2 Trimitere catre cadrele paginii
 *   §3 API pentru interfata si agent
 */
const { webContents, webFrameMain } = require('electron');
const { wcForTab } = require('./web-contents');

let ctx = null; // { vault }

const CAT = { card: 'cards', login: 'logins', address: 'addresses', company: 'companies', identity: 'identities', contact: 'contacts', datagroup: 'dataGroups' };

// §1 Valori pe tip de camp
function valuesFor(kind, it, v) {
  if (!it) return {};
  switch (kind) {
    case 'card': {
      const [mm, yy] = String(it.exp || '').split(/[\/\-\s]+/);
      const year = yy ? (yy.length === 2 ? `20${yy}` : yy) : '';
      return { 'cc-name': it.holder, 'cc-number': String(it.number || '').replace(/\s+/g, ''), 'cc-exp': mm && yy ? `${mm.padStart(2, '0')}/${year.slice(-2)}` : '',
        'cc-exp-month': mm ? mm.padStart(2, '0') : '', 'cc-exp-year': year, 'cc-csc': it.cvv };
    }
    case 'login': return { username: it.username, email: /@/.test(it.username || '') ? it.username : undefined, password: it.password };
    case 'address': return { 'street-address': it.street, 'address-line2': it.line2, city: it.city, state: it.county, 'postal-code': it.zip, country: it.country };
    case 'company': return { organization: it.name, vat: it.cui, regcom: it.regCom, iban: it.iban, bank: it.bank, website: it.website, email: it.email, tel: it.phone };
    case 'identity': return { 'given-name': it.firstName, 'family-name': it.lastName, name: `${it.firstName || ''} ${it.lastName || ''}`.trim(), email: it.email, tel: it.phone };
    case 'contact': return { name: it.name, email: it.email, tel: it.phone, organization: it.company };
    case 'datagroup': {
      const pick = (cat, id) => (v[cat] || []).find((x) => x.id === id);
      return { ...valuesFor('address', pick('addresses', it.addressId), v), ...valuesFor('company', pick('companies', it.companyId), v),
        ...valuesFor('card', pick('cards', it.cardId), v), ...valuesFor('identity', pick('identities', it.identityId), v) };
    }
    default: return {};
  }
}

const PRIMARY = { card: 'cc-number', login: 'username', address: 'street-address', company: 'organization', identity: 'name', contact: 'name', datagroup: 'name' };

// §2 Trimitere catre cadrele paginii
function sendToFrames(wc, framePtr, payload) {
  let target = null;
  if (framePtr) {
    try { target = webFrameMain.fromId(framePtr.processId, framePtr.routingId); } catch (_) { target = null; }
  }
  const frames = wc.mainFrame.framesInSubtree;
  for (const f of frames) {
    const primary = target ? f === target : f === wc.mainFrame;
    try { f.send('netor-host:fill', { ...payload, primary }); } catch (err) { console.error('[netor] cadru indisponibil la completare:', err.message); }
  }
}

// §3 API pentru interfata si agent
function fill({ wcId, tabId, frame, kind, id, field }) {
  const v = ctx.vault.requireOpen();
  const wc = wcId ? webContents.fromId(Number(wcId)) : wcForTab(tabId);
  if (!wc || wc.isDestroyed()) throw new Error('Tabul nu mai este disponibil.');
  const item = (v[CAT[kind]] || []).find((x) => x.id === id);
  if (!item) throw new Error('Intrarea din seif nu mai există.');
  const values = valuesFor(kind, item, v);
  if (field) sendToFrames(wc, frame, { single: values[field] !== undefined ? values[field] : item[field] });
  else sendToFrames(wc, frame, { values, fallback: values[PRIMARY[kind]] });
  return { ok: true };
}

function fillByName(tabId, kind, name) {
  const v = ctx.vault.requireOpen();
  const list = v[CAT[kind]] || [];
  const n = String(name || '').toLowerCase();
  const item = list.find((x) => labelOf(kind, x).toLowerCase() === n) || list.find((x) => labelOf(kind, x).toLowerCase().includes(n));
  if (!item) throw new Error(`Nu am găsit „${name}” în categoria ${kind}.`);
  return fill({ tabId, kind, id: item.id });
}

function labelOf(kind, x) {
  return x.label || x.cardName || x.name || [x.firstName, x.lastName].filter(Boolean).join(' ') || x.domain || x.street || '';
}

function listNames() {
  const v = ctx.vault.requireOpen();
  const out = {};
  for (const [kind, cat] of Object.entries(CAT)) out[kind] = (v[cat] || []).map((x) => labelOf(kind, x) + (kind === 'login' ? ` (${x.domain})` : ''));
  return out;
}

function init(opts) { ctx = opts; }

module.exports = { init, fill, fillByName, listNames, valuesFor, CAT };
