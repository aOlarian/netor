/* MAP
 * Scop: Preload in fiecare tab web si in iframe-urile lui (izolat, sandbox):
 *       - Ctrl+1..9 tinut apasat + clic intr-un camp -> lipeste slotul (tasta e urmarita in procesul principal)
 *       - preia selectia pentru Ctrl+Shift+1..9 (copiere in slot)
 *       - completeaza formulare din seif: clasifica fiecare camp (autocomplete, name, id, eticheta) si il umple
 *       - ofera salvarea parolei la trimiterea unui formular de login
 *       - inregistrare pasi pentru sabloane (mod "record") si alegere element pentru repararea unui pas
 * Legaturi: src/main/web-contents.js, src/renderer/js/autofill.js, src/renderer/js/templates-ui.js
 * Sectiuni:
 *   §1 Utilitare camp si setare valoare compatibila React/Vue
 *   §2 Sloturi (lipire la clic, preluare selectie)
 *   §3 Clasificare campuri si completare
 *   §4 Oferta de salvare parola
 *   §5 Inregistrare pasi si selectori robusti
 */
const { ipcRenderer } = require('electron');

let lastField = null;
let recording = false;
let picking = false;

// §1 Utilitare camp
function isField(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !['button', 'submit', 'reset', 'checkbox', 'radio', 'hidden', 'image', 'file', 'range', 'color'].includes((el.type || 'text').toLowerCase());
  return !!el.isContentEditable;
}

function setValue(el, val) {
  const v = String(val ?? '');
  el.focus();
  if (el.tagName.toLowerCase() === 'select') {
    const lv = v.toLowerCase();
    const opt = Array.from(el.options).find((o) => o.value.toLowerCase() === lv || o.text.trim().toLowerCase() === lv)
      || Array.from(el.options).find((o) => lv && (o.text.toLowerCase().includes(lv) || lv.includes(o.value.toLowerCase()) && o.value));
    if (!opt) return false;
    el.value = opt.value;
  } else if (el.isContentEditable) {
    el.textContent = v;
  } else {
    const proto = el.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  return true;
}

function labelText(el) {
  const parts = [];
  if (el.labels) for (const l of el.labels) parts.push(l.textContent);
  const aria = el.getAttribute('aria-labelledby');
  if (aria) for (const id of aria.split(/\s+/)) { const n = document.getElementById(id); if (n) parts.push(n.textContent); }
  if (!parts.length) {
    // Textul din jur conteaza doar daca e al acestui camp (nu al intregului formular)
    const prev = el.previousElementSibling;
    if (prev && !prev.querySelector('input,select,textarea') && /^(LABEL|SPAN|B|STRONG|TD|TH|DIV|P)$/.test(prev.tagName)) parts.push(prev.textContent);
    const par = el.parentElement;
    if (par && par.querySelectorAll('input,select,textarea').length === 1) parts.push(par.textContent);
  }
  return parts.join(' ').slice(0, 80);
}

// §2 Sloturi
window.addEventListener('mousedown', (e) => {
  const el = e.target;
  if (isField(el)) lastField = el;
  if (picking) { e.preventDefault(); e.stopPropagation(); return; }
  if (e.button !== 0 || !e.ctrlKey || !isField(el)) return;
  const slot = ipcRenderer.sendSync('netor:held-slot');
  if (!slot) return;
  e.preventDefault();
  e.stopPropagation();
  el.focus();
  ipcRenderer.send('netor:slot-paste', { slot });
}, true);

window.addEventListener('contextmenu', (e) => { if (isField(e.target)) lastField = e.target; }, true);
window.addEventListener('focusin', (e) => { if (isField(e.target)) lastField = e.target; }, true);

ipcRenderer.on('netor-host:grab-selection', (_e, { slot }) => {
  if (!document.hasFocus()) return;
  const a = document.activeElement;
  let text = '';
  if (a && typeof a.selectionStart === 'number' && a.selectionEnd > a.selectionStart) text = a.value.slice(a.selectionStart, a.selectionEnd);
  if (!text) text = String(window.getSelection() || '');
  if (text.trim()) ipcRenderer.send('netor:slot-copy', { slot, text: text.trim() });
});

// §3 Clasificare campuri si completare
const RULES = [
  ['cc-number', /card.?num|cardnumber|cc.?num|numar.?(?:de.?)?card|nr.?card|card.?no\b|ccnum|\bpan\b|credit.?card/],
  ['cc-csc', /cvv|cvc|\bcsc\b|cvn|security.?code|cod.?(?:de.?)?securitate|card.?code/],
  ['cc-exp-month', /exp.*(?:month|\bmm\b|luna)|(?:month|luna).*exp|ccmonth|exp.?m\b/],
  ['cc-exp-year', /exp.*(?:year|\byy|\ban\b)|(?:year|anul).*exp|ccyear|exp.?y\b/],
  ['cc-exp', /expir|exp.?date|valabil|mm.?\/?.?yy|\bexp\b/],
  ['cc-name', /card.?holder|name.?on.?card|titular|cc.?name|nume.?(?:de.?pe.?)?card|holder/],
  ['email', /e.?mail/], ['tel', /phone|\btel|mobil|telefon/],
  ['vat', /\bcui\b|\bcif\b|\bvat\b|tax.?id|fiscal|cod.?unic|\btva\b/],
  ['regcom', /reg.?com|registr|nr.?inreg|trade.?reg/], ['iban', /iban|cont.?bancar|bank.?account|account.?number/],
  ['bank', /\bbank|\bbanca/], ['organization', /company|firma|organi[sz]ation|business.?name|denumire|societate|compan/],
  ['given-name', /first.?name|given|prenume|fname|firstname|\bforename/],
  ['family-name', /last.?name|surname|family|lname|nume.?(?:de.?)?familie|lastname/],
  ['postal-code', /\bzip|postal|post.?code|cod.?postal|postcode/], ['city', /city|\boras|localitate|town|municip/],
  ['state', /county|\bstate\b|judet|province|region|sector/], ['country', /country|\btara\b|țara/],
  ['address-line2', /address.?2|line.?2|apartament|\bapt|\bbloc|\bscara|\betaj/],
  ['street-address', /street|address|adresa|strada|\baddr/], ['website', /website|\bsite\b|\burl\b|\bweb\b/],
  ['name', /full.?name|nume.?complet|\bname\b|\bnume\b/], ['username', /user|login|utilizator|account|\bcont\b/],
];
const AUTOCOMPLETE = { 'cc-number': 'cc-number', 'cc-csc': 'cc-csc', 'cc-exp': 'cc-exp', 'cc-exp-month': 'cc-exp-month', 'cc-exp-year': 'cc-exp-year',
  'cc-name': 'cc-name', 'given-name': 'given-name', 'family-name': 'family-name', name: 'name', email: 'email', tel: 'tel', organization: 'organization',
  'street-address': 'street-address', 'address-line1': 'street-address', 'address-line2': 'address-line2', 'address-level2': 'city',
  'address-level1': 'state', 'postal-code': 'postal-code', country: 'country', 'country-name': 'country', username: 'username',
  'current-password': 'password', 'new-password': 'password', url: 'website' };

function classify(el) {
  const ac = String(el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).pop();
  if (AUTOCOMPLETE[ac]) return AUTOCOMPLETE[ac];
  const type = (el.type || '').toLowerCase();
  if (type === 'password') return 'password';
  if (type === 'email') return 'email';
  if (type === 'tel') return 'tel';
  const sig = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${labelText(el)}`.toLowerCase();
  for (const [kind, rx] of RULES) if (rx.test(sig)) return kind;
  return '';
}

function valueFor(kind, el, values) {
  if (kind === 'cc-exp-year' && values['cc-exp-year']) {
    const y = String(values['cc-exp-year']);
    const max = Number(el.maxLength);
    return max === 2 || /\byy\b/i.test(el.placeholder || '') ? y.slice(-2) : y;
  }
  if (kind === 'name' && !values.name && values['given-name']) return `${values['given-name']} ${values['family-name'] || ''}`.trim();
  return values[kind];
}

function fill(payload) {
  const values = payload.values || {};
  const fields = Array.from(document.querySelectorAll('input, textarea, select')).filter((el) => isField(el) && !el.disabled && !el.readOnly && el.offsetParent !== null);
  let count = 0;
  if (payload.single !== undefined) {
    if (payload.primary && lastField) count += setValue(lastField, payload.single) ? 1 : 0;
    return count;
  }
  for (const el of fields) {
    const kind = classify(el);
    const v = kind && valueFor(kind, el, values);
    if (v && (!el.value || payload.overwrite !== false)) count += setValue(el, v) ? 1 : 0;
  }
  if (payload.primary && lastField && !lastField.value && payload.fallback) count += setValue(lastField, payload.fallback) ? 1 : 0;
  return count;
}

ipcRenderer.on('netor-host:fill', (_e, payload) => {
  const n = fill(payload || {});
  if (payload && payload.primary) ipcRenderer.sendToHost('netor-page:filled', { count: n });
});

// §4 Oferta de salvare parola
function offerSave(form) {
  const pass = Array.from((form || document).querySelectorAll('input[type=password]')).find((p) => p.value);
  if (!pass) return;
  const inputs = Array.from((form || document).querySelectorAll('input')).filter((i) => isField(i) && i.type !== 'password' && i.value);
  const user = inputs.reverse().find((i) => /email|text|tel/.test(i.type || 'text'));
  ipcRenderer.sendToHost('netor-page:login-submitted', { domain: location.hostname, username: user ? user.value : '', password: pass.value });
}
window.addEventListener('submit', (e) => offerSave(e.target), true);
window.addEventListener('click', (e) => {
  const b = e.target && e.target.closest && e.target.closest('button, input[type=submit]');
  if (b && document.querySelector('input[type=password]')) setTimeout(() => offerSave(b.form || document), 0);
}, true);

// §5 Inregistrare pasi si selectori robusti
function selectorFor(el) {
  if (el.id && !/\d{3,}/.test(el.id)) return `#${CSS.escape(el.id)}`;
  for (const attr of ['data-testid', 'data-test', 'name', 'aria-label', 'placeholder']) {
    const v = el.getAttribute(attr);
    if (v) {
      const sel = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(v)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
  }
  const parts = [];
  let n = el;
  while (n && n.nodeType === 1 && parts.length < 5) {
    const tag = n.tagName.toLowerCase();
    const sib = n.parentElement ? Array.from(n.parentElement.children).filter((c) => c.tagName === n.tagName) : [];
    parts.unshift(sib.length > 1 ? `${tag}:nth-of-type(${sib.indexOf(n) + 1})` : tag);
    if (n.id && !/\d{3,}/.test(n.id)) { parts[0] = `#${CSS.escape(n.id)}`; break; }
    n = n.parentElement;
  }
  return parts.join(' > ');
}

const describe = (el) => ({ selector: selectorFor(el), text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80), tag: el.tagName.toLowerCase() });

window.addEventListener('click', (e) => {
  if (picking) { e.preventDefault(); e.stopPropagation(); picking = false; ipcRenderer.sendToHost('netor-page:picked', describe(e.target)); return; }
  if (recording && !isField(e.target)) ipcRenderer.sendToHost('netor-page:record', { action: 'click', ...describe(e.target) });
}, true);
window.addEventListener('change', (e) => {
  if (recording && isField(e.target)) ipcRenderer.sendToHost('netor-page:record', { action: e.target.tagName === 'SELECT' ? 'select' : 'type', value: e.target.type === 'password' ? '{{password}}' : e.target.value, ...describe(e.target) });
}, true);
ipcRenderer.on('netor-host:record', (_e, on) => { recording = !!on; });
ipcRenderer.on('netor-host:pick', () => { picking = true; });
