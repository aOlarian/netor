/* MAP
 * Scop: Cazuri E2E pentru date: seiful (import v1.0, PIN, blocare, PIN gresit, schimbare PIN, adaugare intrari),
 *       completarea formularelor (grup de date, card in iframe de pe alt domeniu), meniul de la clic dreapta,
 *       sloturile (Ctrl+1 + clic lipeste, Ctrl+Shift+2 copiaza selectia, Ctrl+3 + Copy in fereastra de date),
 *       upload direct prin cale, oferta de salvare a parolei.
 * Legaturi: e2e.js, preload-page.js, src/main/vault*.js, src/main/web-contents.js
 * Sectiuni:
 *   §1 Seif
 *   §2 Completare formulare si meniu
 *   §3 Sloturi, upload, salvare parola
 */
const fs = require('fs');
const path = require('path');

async function run({ app, check, assert, PORTS, sleep, profile }) {
  const base = `http://127.0.0.1:${PORTS.page}`;
  const api = (call) => app.ev(`return await netorAPI.${call}`);

  // §1 Seif
  await check('Seif: PIN nou la prima folosire, import doar intrări reale din v1.0', async () => {
    const st = await api('vaultStatus()');
    assert.strictEqual(st.initialized, false);
    const r = await app.ev(`const r = await netorAPI.vaultSetup({ pin: '4821' }); NetorApp.vault = r.vault; return r.vault.cards.map((c) => c.cardName)`);
    assert.deepStrictEqual(r, ['Card real importat']);
    return 'PIN setat, demo eliminat';
  });

  await check('Seif: adăugare identitate, firmă, adresă, card, parolă, grup de date', async () => {
    const n = await app.ev(`const v = NetorApp.vault;
      v.identities.push({ id: 'idn_t', firstName: 'Ana', lastName: 'Popescu', email: 'ana@exemplu.ro', phone: '0722111222' });
      v.companies.push({ id: 'cmp_t', name: 'EXEMPLU SRL', cui: 'RO123456', regCom: 'J40/1/2020', iban: 'RO49AAAA1B31007593840000' });
      v.addresses.push({ id: 'adr_t', label: 'Sediu', street: 'Str. Lalelelor 5', city: 'Cluj-Napoca', county: 'Cluj', zip: '400001', country: 'România' });
      v.cards.push({ id: 'crd_t', cardName: 'Visa firmă', holder: 'ANA POPESCU', number: '4242424242424242', exp: '08/31', cvv: '321' });
      v.logins.push({ id: 'log_t', domain: '127.0.0.1', username: 'ana', password: 'Parola!23' });
      v.dataGroups.push({ id: 'dg_t', name: 'Comandă firmă', identityId: 'idn_t', companyId: 'cmp_t', addressId: 'adr_t', cardId: 'crd_t' });
      const r = await netorAPI.vaultSave({ vault: v }); NetorApp.vault = r.vault; return Object.values(r.vault).filter(Array.isArray).reduce((s, l) => s + l.length, 0)`);
    assert.ok(n >= 7, `${n} intrari`);
    const raw = fs.readFileSync(path.join(profile, 'netor-vault.v2.json'), 'utf8');
    assert.ok(!raw.includes('4242424242424242') && !raw.includes('Ana'), 'seiful nu e criptat pe disc');
    return `${n} intrări, criptate pe disc`;
  });

  await check('Seif: blocare, PIN greșit refuzat, deblocare, schimbare PIN', async () => {
    await api('vaultLock()');
    const locked = await api('vaultGet()');
    assert.strictEqual(locked.ok, false);
    const bad = await api(`vaultUnlock({ pin: '0000' })`);
    assert.strictEqual(bad.ok, false);
    const good = await api(`vaultUnlock({ pin: '4821' })`);
    assert.strictEqual(good.ok, true);
    const chg = await api(`vaultChangePin({ oldPin: '4821', newPin: '7777' })`);
    assert.strictEqual(chg.ok, true);
    await api('vaultLock()');
    const again = await app.ev(`const r = await netorAPI.vaultUnlock({ pin: '7777' }); NetorApp.vault = r.vault; return r.ok`);
    assert.strictEqual(again, true);
    return 'ok';
  });

  // §2 Completare formulare si meniu (in browserul normal: in cel privat nu se ofera salvarea parolelor)
  await app.ev(`NetorApp.state.activeBrowserId = NetorApp.state.browsers[0].id; NetorApp.commit(); return true`);
  const formTab = await app.ev(`const { tabId } = await NetorActions.openTab({ url: '${base}/' }); return tabId`);
  await app.waitFor(`NetorApp.tabById('${formTab}').tab.title === 'Formular Netor' && !NetorWV.get('${formTab}').loading`, 10000);
  await sleep(800);

  await check('Completare din grupul de date (inclusiv cardul din iframe-ul de plată de pe alt domeniu)', async () => {
    const r = await api(`fill({ tabId: '${formTab}', kind: 'datagroup', id: 'dg_t' })`);
    assert.ok(r.ok, JSON.stringify(r));
    await sleep(600);
    const vals = await app.pageEval(formTab, `({ fname: fname.value, lname: lname.value, email: email.value, company: company.value, cui: cui.value, street: street.value, city: city.value, zip: zip.value })`);
    assert.deepStrictEqual(vals, { fname: 'Ana', lname: 'Popescu', email: 'ana@exemplu.ro', company: 'EXEMPLU SRL', cui: 'RO123456', street: 'Str. Lalelelor 5', city: 'Cluj-Napoca', zip: '400001' });
    return 'formular complet';
  });

  await check('Card în iframe cross-origin completat (număr, expirare, CVV)', async () => {
    // Valorile din cadrul cross-origin se citesc prin procesul principal (toate cadrele paginii)
    const frameVals = await app.call({ cmd: 'test.frames', tabId: formTab, expr: `JSON.stringify({ cc: (document.getElementById('cc')||{}).value, exp: (document.getElementById('exp')||{}).value, cvc: (document.getElementById('cvc')||{}).value })` });
    const pay = frameVals.map((x) => { try { return JSON.parse(x); } catch (_) { return {}; } }).find((x) => x.cc);
    assert.deepStrictEqual(pay, { cc: '4242424242424242', exp: '08/31', cvc: '321' });
    return pay;
  });

  await check('Clic dreapta într-un câmp gol → meniul Netor (Carduri, Parole, Adrese, Identități, Companii)', async () => {
    await app.pageEval(formTab, `document.getElementById('slot1').value = ''; true`);
    const p = await app.pageEval(formTab, `(() => { const r = document.getElementById('slot1').getBoundingClientRect(); return { x: Math.round(r.left + 10), y: Math.round(r.top + 8) }; })()`);
    await app.input(formTab, [{ type: 'mouseDown', x: p.x, y: p.y, button: 'right', clickCount: 1 }, { type: 'mouseUp', x: p.x, y: p.y, button: 'right', clickCount: 1 }]);
    await app.waitFor(`!!document.querySelector('.nx-menu')`, 5000);
    const labels = await app.ev(`[...document.querySelectorAll('.nx-menu > .nx-menu-item .nx-mi-label')].map((x) => x.textContent)`);
    await app.shot('05-form-menu');
    for (const l of ['Lipește', 'Grupuri de date', 'Carduri', 'Adrese', 'Identități', 'Companii']) assert.ok(labels.some((x) => x.startsWith(l)), `lipseste ${l}: ${labels}`);
    assert.ok(labels.some((x) => x.startsWith('Parole · 127.0.0.1')), 'parole pe domeniu');
    await app.ev(`NX.closeMenus()`);
    return labels.length + ' opțiuni';
  });

  // §3 Sloturi, upload, salvare parola
  await check('Ctrl+1 ținut + clic într-un câmp lipește slotul 1', async () => {
    await api(`slotSet({ slot: '1', value: 'ALFA-1' })`);
    const p = await app.pageEval(formTab, `(() => { const r = document.getElementById('slot2').getBoundingClientRect(); return { x: Math.round(r.left + 10), y: Math.round(r.top + 8) }; })()`);
    await app.input(formTab, [{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }, { type: 'keyDown', keyCode: '1', modifiers: ['control'] }, { wait: 50 },
      { type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: ['control'] }, { type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: ['control'] }, { wait: 200 },
      { type: 'keyUp', keyCode: '1', modifiers: ['control'] }, { type: 'keyUp', keyCode: 'Control' }]);
    await sleep(300);
    const v = await app.pageEval(formTab, `document.getElementById('slot2').value`);
    assert.strictEqual(v, 'ALFA-1');
    return v;
  });

  await check('Ctrl+Shift+2 pe text selectat îl pune în slotul 2', async () => {
    await app.pageEval(formTab, `(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('sel')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); window.focus(); return true; })()`);
    await app.input(formTab, [{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }, { type: 'keyDown', keyCode: '2', modifiers: ['control', 'shift'] }, { wait: 300 }, { type: 'keyUp', keyCode: 'Control' }]);
    await app.waitFor(`NetorApp.slots['2'] === 'Text de copiat in slot'`, 4000);
    await app.shot('06-slot-pill');
    return 'slot 2 ok';
  });

  await check('Ctrl+3 ținut + Copy în fereastra de date → slotul 3', async () => {
    await app.input(null, [{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }, { type: 'keyDown', keyCode: '3', modifiers: ['control'] }]);
    await app.ev(`await NetorAutofill.copyValue(NetorApp, 'RO123456', 'CUI')`);
    await app.input(null, [{ type: 'keyUp', keyCode: 'Control' }]);
    await app.waitFor(`NetorApp.slots['3'] === 'RO123456'`, 3000);
    return 'slot 3 ok';
  });

  await check('Upload direct prin cale (fără fereastra Windows)', async () => {
    const file = path.join(profile, 'oferta-test.txt');
    fs.writeFileSync(file, 'test upload');
    await app.cmd('file.upload', { tabId: formTab, selector: '#upload', files: [file] });
    const names = await app.pageEval(formTab, `Array.from(document.getElementById('upload').files).map((f) => f.name)`);
    assert.deepStrictEqual(names, ['oferta-test.txt']);
    return names[0];
  });

  await check('După login, Netor oferă salvarea parolei', async () => {
    await app.ev(`NetorActions.navigate('${formTab}', '${base}/login')`);
    await app.waitFor(`NetorApp.tabById('${formTab}').tab.title === 'Login' && !NetorWV.get('${formTab}').loading`);
    await app.cmd('dom.type', { tabId: formTab, selector: '#u', text: 'ion' });
    await app.cmd('dom.type', { tabId: formTab, selector: '#p', text: 'Secret!9' });
    await app.cmd('dom.click', { tabId: formTab, selector: '#b' });
    await app.waitFor(`[...document.querySelectorAll('.nx-modal-head span')].some((s) => s.textContent === 'Salvezi parola?')`, 5000);
    await app.ev(`NX.closeAllModals()`);
    return 'ofertă afișată';
  });
}

module.exports = { run };
