/* MAP
 * Scop: Tras cu mouse-ul in grupuri (ca Windows Space din Nex Remote): mutarea unei ferestre de bara ei,
 *       redimensionarea din cele 8 margini (vecinele lipite se misca odata cu muchia comuna; cu Alt,
 *       fereastra se redimensioneaza singura), schimbul de loc cand lasi fereastra peste mijlocul alteia.
 *       La eliberare, ferestrele nu raman suprapuse: o suprapunere mica devine lipire, una mare se anuleaza.
 * Legaturi: group-geom.js (calcule), stage.js (api: container, panouri, comite, schimba), webviews.js (layout)
 * Sectiuni:
 *   §1 Pornire si urmarirea mouse-ului
 *   §2 Mutare si schimb de loc
 *   §3 Redimensionare cu vecinele lipite
 */

(function () {
  const G = () => window.NetorGroupGeom;
  const SCAPARE_PX = 28;

  // §1 Pornire si urmarirea mouse-ului
  function pornire(e, api) {
    if (e.button !== 0) return null;
    const c = api.container.getBoundingClientRect();
    const W = api.container.clientWidth;
    const H = api.container.clientHeight;
    const toate = api.panouri().map((p) => ({ id: p.tabId, f: p.rect, px: G().laPixeli(p.rect, W, H) }));
    document.getElementById('stage').classList.add('dragging', 'win-drag');
    return { c, W, H, toate, x0: e.clientX, y0: e.clientY };
  }

  function aplica(el, r) {
    if (!el) return;
    Object.assign(el.style, { left: `${r.l}px`, top: `${r.t}px`, width: `${r.r - r.l}px`, height: `${r.b - r.t}px` });
  }

  // Pointer capture: tractiunea continua si cand cursorul trece peste alt panou sau peste un webview
  function urmareste(s, tinta, e, pas, gata) {
    tinta.setPointerCapture(e.pointerId);
    let terminat = false;
    const stop = (ev) => {
      if (terminat) return;
      terminat = true;
      tinta.removeEventListener('pointermove', misca);
      tinta.removeEventListener('pointerup', stop);
      tinta.removeEventListener('pointercancel', stop);
      tinta.removeEventListener('lostpointercapture', stop);
      document.getElementById('stage').classList.remove('dragging', 'win-drag');
      gata(ev);
    };
    // Un clic simplu pe bara (sub 4px) nu e tractiune: nu muta si nu salveaza nimic
    const misca = (ev) => {
      if (!(ev.buttons & 1)) { stop(ev); return; }
      if (!s.mutat && Math.abs(ev.clientX - s.x0) + Math.abs(ev.clientY - s.y0) < 4) return;
      s.mutat = true;
      pas(ev);
      window.NetorWV.layout();
    };
    tinta.addEventListener('pointermove', misca);
    tinta.addEventListener('pointerup', stop);
    tinta.addEventListener('pointercancel', stop);
    tinta.addEventListener('lostpointercapture', stop);
  }

  // §2 Mutare si schimb de loc
  function tintaDeSchimb(s, id, x, y) {
    for (const o of s.toate) {
      if (o.id === id) continue;
      const w = o.px.r - o.px.l;
      const h = o.px.b - o.px.t;
      if (x > o.px.l + w * 0.3 && x < o.px.r - w * 0.3 && y > o.px.t + h * 0.3 && y < o.px.b - h * 0.3) return o;
    }
    return null;
  }

  function impingeAfara(r, altele, W, H) {
    const n = { ...r };
    for (const o of altele) {
      const ox = Math.min(n.r, o.r) - Math.max(n.l, o.l);
      const oy = Math.min(n.b, o.b) - Math.max(n.t, o.t);
      if (ox <= 0 || oy <= 0 || Math.min(ox, oy) > SCAPARE_PX) continue;
      const w = n.r - n.l;
      const h = n.b - n.t;
      if (ox <= oy) { n.l = n.l + w / 2 < (o.l + o.r) / 2 ? o.l - w : o.r; n.r = n.l + w; } else { n.t = n.t + h / 2 < (o.t + o.b) / 2 ? o.t - h : o.b; n.b = n.t + h; }
    }
    return n.l < 0 || n.t < 0 || n.r > W || n.b > H ? r : n;
  }

  function muta(e, id, api) {
    const s = pornire(e, api);
    if (!s) return;
    const eu = s.toate.find((x) => x.id === id);
    const altele = s.toate.filter((x) => x.id !== id).map((x) => x.px);
    const el = api.nod(id);
    el.classList.add('lifted');
    api.ridica(id, true);
    let acum = eu.px;
    let tinta = null;
    e.preventDefault();
    urmareste(s, e.currentTarget, e, (ev) => {
      acum = G().muta(eu.px, ev.clientX - s.x0, ev.clientY - s.y0, altele, s.W, s.H);
      aplica(el, acum);
      api.contur('win-ghost', acum);
      const nou = tintaDeSchimb(s, id, ev.clientX - s.c.left, ev.clientY - s.c.top);
      if (nou !== tinta) {
        if (tinta) api.nod(tinta.id).classList.remove('swap-target');
        if (nou) api.nod(nou.id).classList.add('swap-target');
        api.contur('win-drop', nou && nou.px);
        tinta = nou;
      }
    }, () => {
      el.classList.remove('lifted');
      api.ridica(id, false);
      api.contur('win-ghost', null);
      api.contur('win-drop', null);
      if (!s.mutat) return;
      if (tinta) { api.nod(tinta.id).classList.remove('swap-target'); api.schimba(id, tinta.id); return; }
      const final = impingeAfara(acum, altele, s.W, s.H);
      const G0 = G();
      const fin = { l: final.l, t: final.t, r: final.r, b: final.b };
      if (altele.some((o) => G0.suprapuse(fin, o))) {
        NX.toast('Fereastra s-ar suprapune peste alta. Las-o într-un loc liber sau peste mijlocul alteia ca să schimbați locurile.', 'warn', 4200);
        api.comite(new Map());
        return;
      }
      api.comite(new Map([[id, G0.laFractii(final, s.toate.filter((x) => x.id !== id).map((x) => x.f), s.W, s.H)]]));
    });
  }

  // §3 Redimensionare cu vecinele lipite (granita comuna se muta, nu se deschide un gol)
  function lipite(eu, altele, muchii) {
    const out = [];
    const peY = (o) => Math.min(eu.b, o.px.b) - Math.max(eu.t, o.px.t) > 0;
    const peX = (o) => Math.min(eu.r, o.px.r) - Math.max(eu.l, o.px.l) > 0;
    for (const o of altele) {
      if (muchii.r && Math.abs(o.px.l - eu.r) <= 1 && peY(o)) out.push({ o, a: 'r', b: 'l' });
      if (muchii.l && Math.abs(o.px.r - eu.l) <= 1 && peY(o)) out.push({ o, a: 'l', b: 'r' });
      if (muchii.b && Math.abs(o.px.t - eu.b) <= 1 && peX(o)) out.push({ o, a: 'b', b: 't' });
      if (muchii.t && Math.abs(o.px.b - eu.t) <= 1 && peX(o)) out.push({ o, a: 't', b: 'b' });
    }
    return out;
  }

  function limiteazaDeVecine(n, legate) {
    const g = G();
    for (const { o, a } of legate) {
      if (a === 'r') n.r = Math.min(n.r, o.px.r - g.MIN_W);
      if (a === 'l') n.l = Math.max(n.l, o.px.l + g.MIN_W);
      if (a === 'b') n.b = Math.min(n.b, o.px.b - g.MIN_H);
      if (a === 't') n.t = Math.max(n.t, o.px.t + g.MIN_H);
    }
    return n;
  }

  function redimensioneaza(e, id, muchii, api) {
    const s = pornire(e, api);
    if (!s) return;
    const eu = s.toate.find((x) => x.id === id);
    const restul = s.toate.filter((x) => x.id !== id);
    const legate = e.altKey ? [] : lipite(eu.px, restul, muchii);
    const libere = restul.filter((x) => !legate.some((l) => l.o === x)).map((x) => x.px);
    const el = api.nod(id);
    api.ridica(id, true);
    let acum = eu.px;
    const vecine = new Map();
    e.preventDefault();
    e.stopPropagation();
    urmareste(s, e.currentTarget, e, (ev) => {
      acum = limiteazaDeVecine(G().redimensioneaza(eu.px, ev.clientX - s.x0, ev.clientY - s.y0, muchii, libere, s.W, s.H), legate);
      aplica(el, acum);
      for (const { o, a, b } of legate) {
        const v = vecine.get(o.id) || { ...o.px };
        v[b] = acum[a];
        vecine.set(o.id, v);
        aplica(api.nod(o.id), v);
      }
    }, () => {
      api.ridica(id, false);
      if (!s.mutat) return;
      // Fiecare muchie noua ia fractia exacta a muchiei de care e lipita (fara dunga de 1px la alta latime)
      const fixe = restul.filter((x) => !vecine.has(x.id)).map((x) => x.f);
      const fEu = G().laFractii(acum, fixe, s.W, s.H);
      const schimbate = new Map([[id, fEu]]);
      for (const [vid, v] of vecine) schimbate.set(vid, G().laFractii(v, [...fixe, fEu], s.W, s.H));
      api.comite(schimbate);
    });
  }

  window.NetorGroupDrag = { muta, redimensioneaza, impingeAfara, lipite };
})();
