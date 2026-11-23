/* MAP
 * Scop: Cazuri E2E pentru interfata: migrarea din v1.0, o singura bara URL, navigare si cautare, taburi
 *       (nou, inchis, redeschis, fixat, redenumit), teme, favorite
 *       (foldere, pe aceeasi linie), browsere din minibar (privat izolat, proxy pe tab), persistenta la repornire.
 * Legaturi: e2e.js (ctx: app, check, servers, PORTS)
 * Sectiuni:
 *   §1 Migrare si bara URL
 *   §2 Taburi (grupurile: cases-groups.js)
 *   §3 Teme si favorite
 *   §4 Minibar, privat, proxy pe tab, repornire
 */

async function run({ app, check, assert, PORTS, servers, sleep }) {
  const base = `http://127.0.0.1:${PORTS.page}`;

  // §1 Migrare si bara URL
  await check('Migrare v1.0 → v1.1 (grup, note, agent, favorite cu foldere)', async () => {
    const r = await app.ev(`const b = NetorApp.state.browsers[0]; const g = b.groups[0];
      return { group: g && g.name, panes: g && g.panes.length, types: g && g.panes.map((p) => b.tabs.find((t) => t.id === p.tabId).type),
        folder: NetorApp.state.favorites.some((f) => f.type === 'folder' && f.title === 'Work'), agentMsgs: NetorApp.state.agents[0].messages, version: NetorApp.state.version }`);
    assert.strictEqual(r.group, 'facebook');
    assert.deepStrictEqual(r.types, ['web', 'note', 'agent']);
    assert.ok(r.folder, 'folderul Work lipseste');
    assert.strictEqual(r.version, '1.2.0');
    return r.types.join('+');
  });

  await check('O singură bară de adrese, înălțime mărită (single tab)', async () => {
    const r = await app.ev(`const b = NetorApp.activeBrowser(); const t = NetorApp.stripTabs(b).find((x) => !x.pinned) || NetorApp.stripTabs(b)[0];
      b.active = { kind: 'tab', id: t.id }; NetorApp.commit(); await new Promise((r) => setTimeout(r, 300));
      return { inputs: document.querySelectorAll('.url-input').length, old: !!document.getElementById('addressInput'), h: document.querySelector('.pane-bar').offsetHeight, urlH: document.querySelector('.urlbox').offsetHeight }`);
    assert.strictEqual(r.inputs, 1);
    assert.strictEqual(r.old, false);
    assert.ok(r.h >= 36, `bara are ${r.h}px`);
    await app.shot('01-single-tab');
    return `${r.h}px`;
  });

  await check('Navigare din bara de adrese + căutare pentru text', async () => {
    const tabId = await app.ev('NetorApp.focusedTab().id');
    await app.ev(`NetorActions.navigate('${tabId}', '127.0.0.1:${PORTS.page}/p2')`);
    await app.waitFor(`NetorApp.tabById('${tabId}').tab.title === 'Pagina 2'`);
    const s = await app.ev(`NetorActions.resolveInput(NetorApp, 'pret laptop')`);
    assert.ok(s.startsWith('https://www.google.com/search?q=pret%20laptop'), s);
    return 'ok';
  });

  // §2 Taburi si grupuri
  await check('Taburi: nou, închis, redeschis (Ctrl+Shift+T), fixat, redenumit', async () => {
    const r = await app.ev(`const A = NetorActions; const { tabId } = await A.openTab({ url: '${base}/item/7' });
      await new Promise((r) => setTimeout(r, 1200)); A.closeTab(tabId); const before = NetorApp.activeBrowser().tabs.length;
      NetorTools.shortcut(NetorApp, 'reopenTab'); await new Promise((r) => setTimeout(r, 300));
      const t = NetorApp.activeBrowser().tabs.find((x) => x.url && x.url.includes('/item/7'));
      t.pinned = true; t.customTitle = 'Produsul meu fixat'; NetorApp.commit();
      return { reopened: !!t, before, after: NetorApp.activeBrowser().tabs.length, pinnedEl: !!document.querySelector('.tab.pinned[title^="Produsul meu fixat"]') }`);
    assert.ok(r.reopened && r.after === r.before + 1, JSON.stringify(r));
    assert.ok(r.pinnedEl, 'tabul fixat redenumit nu apare');
    return r;
  });

  await check('Redenumire tab fixat: câmpul iese în afara tabului', async () => {
    const w = await app.ev(`const t = NetorApp.activeBrowser().tabs.find((x) => x.pinned && !x.groupId); NetorTabstrip.renaming = t.id; NetorTabstrip.render(NetorApp);
      await new Promise((r) => setTimeout(r, 80)); const inp = document.querySelector('.tab-rename'); const tabW = inp.parentElement.offsetWidth; const w = inp.offsetWidth;
      inp.value = 'Nume lung pentru tabul fixat'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return { tabW, w, title: t.customTitle }`);
    assert.ok(w.w > w.tabW * 3, JSON.stringify(w));
    assert.strictEqual(w.title, 'Nume lung pentru tabul fixat');
    return w;
  });

  // §3 Teme si favorite
  await check('Teme: toate se aplică (familie + mod)', async () => {
    const r = await app.ev(`const out = {}; for (const k of Object.keys(NetorThemes.NETOR_THEMES)) { NetorApp.state.globalSettings.theme = k; NetorApp.render(); out[k] = document.documentElement.dataset.family + '/' + document.documentElement.dataset.mode; } return out`);
    assert.ok(Object.keys(r).length >= 15, 'prea putine teme');
    for (const k of ['firefox-dark', 'ie-classic', 'opera-dark']) {
      await app.ev(`NetorApp.state.globalSettings.theme = '${k}'; NetorApp.commit()`);
      await sleep(500);
      await app.shot(`03-theme-${k}`);
    }
    await app.ev(`NetorApp.state.globalSettings.theme = 'chrome-light'; NetorApp.commit()`);
    return `${Object.keys(r).length} teme`;
  });

  await check('Favorite: adăugare din stea, folder, mod „în bara de adrese”', async () => {
    const r = await app.ev(`const b = NetorApp.activeBrowser(); const t = NetorApp.stripTabs(b).find((x) => !x.pinned); b.active = { kind: 'tab', id: t.id }; NetorApp.commit();
      await new Promise((r) => setTimeout(r, 400)); NetorFavorites.toggleCurrent(NetorApp, t); NX.closeAllModals();
      NetorApp.state.globalSettings.favoritesMode = 'same'; NetorApp.commit(); await new Promise((r) => setTimeout(r, 300));
      return { fav: NetorApp.state.favorites.some((f) => f.url === t.url), inline: document.querySelectorAll('.pane-bar .fav-inline .fav').length, barHidden: document.getElementById('favbar').classList.contains('hidden') }`);
    assert.ok(r.fav && r.inline > 0 && r.barHidden, JSON.stringify(r));
    await app.shot('04-favorites-same-line');
    await app.ev(`NetorApp.state.globalSettings.favoritesMode = 'separate'; NetorApp.commit()`);
    return r;
  });

  // §4 Minibar, privat, proxy pe tab, repornire
  await check('Browser „toate privat”: taburile nu împart cookie-uri', async () => {
    const r = await app.ev(`const A = NetorActions; const { browserId } = A.createBrowser({ name: 'Privat test', allPrivate: true });
      const a = await A.openTab({ url: '${base}/p2', browserId }); const b2 = await A.openTab({ url: '${base}/p2', browserId });
      await new Promise((r) => setTimeout(r, 1500)); return { a: a.tabId, b: b2.tabId, pa: NetorWV.get(a.tabId).partition, pb: NetorWV.get(b2.tabId).partition }`);
    assert.notStrictEqual(r.pa, r.pb);
    assert.ok(!r.pa.startsWith('persist:'), 'partitia privata e persistenta');
    await app.pageEval(r.a, `document.cookie = 'netor=1; path=/'; true`);
    const other = await app.pageEval(r.b, 'document.cookie');
    assert.ok(!String(other).includes('netor=1'), 'cookie vizibil in alt tab privat');
    return 'izolat';
  });

  await check('Proxy pe un singur tab (trafic prin proxy-ul de test)', async () => {
    servers.proxyHits.length = 0;
    const tabId = await app.ev(`const { tabId } = await NetorActions.openTab({ url: 'about:blank', proxy: { mode: 'custom', scheme: 'http', host: '127.0.0.1', port: '${PORTS.proxy}', bypass: '<-loopback>' } }); return tabId`);
    await sleep(800);
    await app.ev(`NetorActions.navigate('${tabId}', '${base}/item/42')`);
    await app.waitFor(`NetorApp.tabById('${tabId}').tab.title === 'Produs 42'`);
    assert.ok(servers.proxyHits.some((u) => u.includes('/item/42')), `hits: ${servers.proxyHits.join(',')}`);
    return `${servers.proxyHits.length} cereri prin proxy`;
  });

  await check('Persistență: taburi fixate și grupuri rămân după repornire', async () => {
    await app.stop();
    await app.start();
    const r = await app.ev(`const b = NetorApp.state.browsers[0]; return { pinned: b.tabs.filter((t) => t.pinned).map((t) => t.customTitle), groups: b.groups.length, browsers: NetorApp.state.browsers.length }`);
    assert.ok(r.pinned.includes('Nume lung pentru tabul fixat'), JSON.stringify(r));
    assert.ok(r.groups >= 1);
    return r;
  });
}

module.exports = { run };
