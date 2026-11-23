/* MAP
 * Scop: Schema categoriilor din seif (campuri, titluri, ce e secret) si formularul de adaugare/editare:
 *       parole (potrivite strict pe domeniu), carduri cu numele tau + CVV, adrese (doar adresa fizica),
 *       companii (fara adresa), identitati (nume + contact), contacte, grupuri de date.
 * Legaturi: vault-ui.js, autofill.js
 * Sectiuni:
 *   §1 Schema categoriilor
 *   §2 Formular adaugare/editare (cu generator de parola si afisare/ascundere)
 */

// §1 Schema categoriilor
const last4 = (n) => String(n || '').replace(/\D/g, '').slice(-4);
const brandOf = (n) => { const d = String(n || '').replace(/\D/g, ''); return /^4/.test(d) ? 'Visa' : /^(5[1-5]|2[2-7])/.test(d) ? 'Mastercard' : /^3[47]/.test(d) ? 'Amex' : /^6/.test(d) ? 'Discover/Maestro' : 'Card'; };

window.NetorVaultSchema = {
  logins: { label: 'Parole', one: 'parolă', icon: 'key', title: (x) => x.label || x.domain, sub: (x) => `${x.username || ''} · ${x.domain || ''}`,
    fields: [['domain', 'Site (domeniu)', { req: true, ph: 'exemplu.ro' }], ['username', 'Utilizator sau email', { req: true }], ['password', 'Parolă', { secret: true, gen: true }],
      ['label', 'Nume afișat (opțional)'], ['notes', 'Note', { area: true }]] },
  cards: { label: 'Carduri', one: 'card', icon: 'card', title: (x) => x.cardName, sub: (x) => `${brandOf(x.number)} •••• ${last4(x.number)} · exp ${x.exp || '--'}`,
    fields: [['cardName', 'Numele cardului (cum îl vezi în meniuri)', { req: true, ph: 'ex. Visa firmă BT' }], ['holder', 'Titular (ca pe card)'],
      ['number', 'Număr card', { req: true, secret: true, mono: true }], ['exp', 'Expirare (LL/AA)', { ph: '09/29' }], ['cvv', 'CVV / CVC', { secret: true, mono: true }], ['notes', 'Note', { area: true }]] },
  addresses: { label: 'Adrese', one: 'adresă', icon: 'home', title: (x) => x.label || x.street, sub: (x) => [x.street, x.city, x.country].filter(Boolean).join(', '),
    fields: [['label', 'Nume (ex. Sediu, Acasă)', { req: true }], ['street', 'Stradă și număr', { req: true }], ['line2', 'Bloc, scară, etaj, apartament'],
      ['city', 'Localitate'], ['county', 'Județ / sector'], ['zip', 'Cod poștal'], ['country', 'Țară', { def: 'România' }]] },
  companies: { label: 'Companii', one: 'companie', icon: 'building', title: (x) => x.name, sub: (x) => [x.cui, x.regCom].filter(Boolean).join(' · '),
    fields: [['name', 'Denumire', { req: true }], ['cui', 'CUI / CIF'], ['regCom', 'Nr. Registrul Comerțului'], ['iban', 'IBAN', { mono: true }], ['bank', 'Bancă'],
      ['website', 'Site'], ['email', 'Email firmă'], ['phone', 'Telefon firmă']] },
  identities: { label: 'Identități', one: 'identitate', icon: 'user', title: (x) => x.label || `${x.firstName || ''} ${x.lastName || ''}`, sub: (x) => [x.email, x.phone].filter(Boolean).join(' · '),
    fields: [['firstName', 'Prenume', { req: true }], ['lastName', 'Nume', { req: true }], ['email', 'Email'], ['phone', 'Telefon'], ['label', 'Nume afișat (opțional)']] },
  contacts: { label: 'Contacte', one: 'contact', icon: 'phone', title: (x) => x.name, sub: (x) => [x.role, x.company, x.email].filter(Boolean).join(' · '),
    fields: [['name', 'Nume', { req: true }], ['role', 'Rol'], ['company', 'Firmă'], ['email', 'Email'], ['phone', 'Telefon'], ['notes', 'Note', { area: true }]] },
  dataGroups: { label: 'Grupuri de date', one: 'grup de date', icon: 'layers', title: (x) => x.name, sub: () => 'identitate + firmă + adresă + card',
    fields: [['name', 'Nume grup', { req: true }], ['identityId', 'Identitate', { ref: 'identities' }], ['companyId', 'Companie', { ref: 'companies' }],
      ['addressId', 'Adresă', { ref: 'addresses' }], ['cardId', 'Card', { ref: 'cards' }]] },
};
window.NetorVaultSchema.brandOf = brandOf;
window.NetorVaultSchema.last4 = last4;

// §2 Formular adaugare/editare
window.NetorVaultForm = {
  open(app, cat, item, onSaved) {
    const sc = window.NetorVaultSchema[cat];
    const isNew = !item;
    const cur = item || {};
    const fieldHTML = ([k, label, o = {}]) => {
      const val = NX.esc(cur[k] ?? o.def ?? '');
      if (o.ref) {
        const list = (app.vault[o.ref] || []);
        const ss = window.NetorVaultSchema[o.ref];
        return `<label class="fld"><span>${NX.esc(label)}</span><select class="inp" data-k="${k}"><option value="">— niciuna —</option>
          ${list.map((x) => `<option value="${x.id}" ${x.id === cur[k] ? 'selected' : ''}>${NX.esc(ss.title(x))}</option>`).join('')}</select></label>`;
      }
      if (o.area) return `<label class="fld"><span>${NX.esc(label)}</span><textarea class="inp" data-k="${k}" rows="3">${val}</textarea></label>`;
      return `<label class="fld"><span>${NX.esc(label)}${o.req ? ' *' : ''}</span><div class="inp-wrap">
        <input class="inp${o.mono ? ' mono' : ''}" data-k="${k}" value="${val}" placeholder="${NX.esc(o.ph || '')}" ${o.secret ? 'type="password" autocomplete="new-password"' : 'autocomplete="off"'}>
        ${o.secret ? `<button type="button" class="icon-btn" data-eye="${k}" title="Arată / ascunde">${IC('eye', 15)}</button>` : ''}
        ${o.gen ? `<button type="button" class="icon-btn" data-gen="${k}" title="Generează parolă puternică">${IC('sparkles', 15)}</button>` : ''}</div></label>`;
    };
    NX.openModal({
      title: `${isNew ? 'Adaugă' : 'Editează'} ${sc.one}`, width: 520,
      body: `<form class="form-col" autocomplete="off">${sc.fields.map(fieldHTML).join('')}<div class="vf-err"></div>
        <div class="row-end"><button type="button" class="btn ghost" data-cancel>Anulează</button><button class="btn primary" type="submit">Salvează</button></div></form>`,
      onMount: (m) => {
        const form = NX.$('form', m.body);
        form.addEventListener('click', (e) => {
          const eye = e.target.closest('[data-eye]');
          if (eye) { const i = NX.$(`[data-k="${eye.dataset.eye}"]`, form); i.type = i.type === 'password' ? 'text' : 'password'; }
          const gen = e.target.closest('[data-gen]');
          if (gen) { const i = NX.$(`[data-k="${gen.dataset.gen}"]`, form); i.value = genPassword(); i.type = 'text'; }
        });
        NX.$('[data-cancel]', form).onclick = () => m.close();
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const next = { ...cur, id: cur.id || NX.uid(cat.slice(0, 3)), updatedAt: Date.now() };
          for (const [k, , o = {}] of sc.fields) {
            const v = NX.$(`[data-k="${k}"]`, form).value.trim();
            if (o.req && !v) { NX.$('.vf-err', form).textContent = 'Completează câmpurile marcate cu *.'; return; }
            next[k] = k === 'domain' ? v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase() : v;
          }
          const list = app.vault[cat] || (app.vault[cat] = []);
          const i = list.findIndex((x) => x.id === next.id);
          if (i >= 0) list[i] = next; else list.push(next);
          const r = await window.netorAPI.vaultSave({ vault: app.vault });
          if (r && r.ok === false) { NX.$('.vf-err', form).textContent = r.error; return; }
          app.vault = r.vault;
          m.close();
          if (onSaved) onSaved(next);
        });
        setTimeout(() => { const f = NX.$('input,select', form); if (f) f.focus(); }, 30);
      },
    });
  },
};

function genPassword(len = 18) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%&*?-_+='];
  const all = sets.join('');
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const chars = sets.map((s) => s[rnd(s.length)]);
  while (chars.length < len) chars.push(all[rnd(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
