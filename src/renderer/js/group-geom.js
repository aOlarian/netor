/* MAP
 * Scop: Geometria ferestrelor dintr-un grup (ca Windows Space din Nex Remote): fiecare panou are muchiile
 *       in fractii din scena ({ l, t, r, b } intre 0 si 1), deci doua ferestre lipite impart aceeasi valoare
 *       si raman lipite la orice latime. Functii pure: lipire (snap), mutare, redimensionare, loc nou,
 *       asezari gata facute (grila, coloane, randuri, unul mare), umplerea golului lasat de un panou scos.
 * Legaturi: group-drag.js (mouse), stage.js (randare), app-actions.js (adaugare/scoatere din grup)
 * Sectiuni:
 *   §1 Constante si utilitare
 *   §2 Lipire, mutare, redimensionare
 *   §3 Fractii
 *   §4 Asezari si locuri noi
 *   §5 Golul lasat de un panou scos
 */

(function () {
  // §1 Constante si utilitare
  const PRAG_PX = 12;
  const MIN_W = 220;
  const MIN_H = 150;
  const EPS = 1e-6;
  const px = (f, total) => Math.round(f * total);
  const laPixeli = (f, W, H) => ({ l: px(f.l, W), t: px(f.t, H), r: px(f.r, W), b: px(f.b, H) });
  const seIntalnesc = (a1, a2, b1, b2, p) => a1 <= b2 + p && b1 <= a2 + p;
  const valid = (f) => f && ['l', 't', 'r', 'b'].every((k) => Number.isFinite(f[k]) && f[k] >= -EPS && f[k] <= 1 + EPS) && f.r - f.l > 0.04 && f.b - f.t > 0.04;
  const suprapuse = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > EPS && Math.min(a.b, b.b) - Math.max(a.t, b.t) > EPS;

  // §2 Lipire, mutare, redimensionare
  function ceaMaiBuna(mele, tinte, prag) {
    let best = null;
    for (const m of mele) for (const t of tinte) { const d = t - m; if (Math.abs(d) <= prag && (best === null || Math.abs(d) < Math.abs(best))) best = d; }
    return best === null ? 0 : best;
  }
  function tinteX(r, altele, W, prag) { const t = []; for (const o of altele) if (seIntalnesc(r.t, r.b, o.t, o.b, prag)) t.push(o.l, o.r); t.push(0, W / 2, W / 3, (2 * W) / 3, W); return t; }
  function tinteY(r, altele, H, prag) { const t = []; for (const o of altele) if (seIntalnesc(r.l, r.r, o.l, o.r, prag)) t.push(o.t, o.b); t.push(0, H / 2, H / 3, (2 * H) / 3, H); return t; }

  // Mutarea pastreaza marimea; pe fiecare axa se lipeste de cea mai apropiata muchie (vecina, ghidaj 1/2, 1/3, margine)
  function muta(rect, dx, dy, altele, W, H, prag = PRAG_PX) {
    const w = rect.r - rect.l;
    const h = rect.b - rect.t;
    let l = Math.min(Math.max(0, rect.l + dx), Math.max(0, W - w));
    let t = Math.min(Math.max(0, rect.t + dy), Math.max(0, H - h));
    const nou = { l, t, r: l + w, b: t + h };
    l += ceaMaiBuna([nou.l, nou.r], tinteX(nou, altele, W, prag), prag);
    t += ceaMaiBuna([nou.t, nou.b], tinteY(nou, altele, H, prag), prag);
    l = Math.min(Math.max(0, l), Math.max(0, W - w));
    t = Math.min(Math.max(0, t), Math.max(0, H - h));
    return { l, t, r: l + w, b: t + h };
  }

  // Redimensionarea misca doar muchiile apucate; marimea minima impinge inapoi muchia apucata
  function redimensioneaza(rect, dx, dy, muchii, altele, W, H, prag = PRAG_PX) {
    const n = { ...rect };
    if (muchii.l) n.l += dx;
    if (muchii.r) n.r += dx;
    if (muchii.t) n.t += dy;
    if (muchii.b) n.b += dy;
    const tx = tinteX(n, altele, W, prag);
    const ty = tinteY(n, altele, H, prag);
    for (const k of ['l', 'r']) if (muchii[k]) n[k] += ceaMaiBuna([n[k]], tx, prag);
    for (const k of ['t', 'b']) if (muchii[k]) n[k] += ceaMaiBuna([n[k]], ty, prag);
    n.l = Math.max(0, n.l); n.t = Math.max(0, n.t); n.r = Math.min(W, n.r); n.b = Math.min(H, n.b);
    const minW = Math.min(MIN_W, W);
    const minH = Math.min(MIN_H, H);
    if (n.r - n.l < minW) { if (muchii.l) n.l = n.r - minW; else n.r = n.l + minW; }
    if (n.b - n.t < minH) { if (muchii.t) n.t = n.b - minH; else n.b = n.t + minH; }
    return n;
  }

  // §3 Fractii: muchia care cade pe pixelul altei muchii ia exact fractia aceleia (raman lipite la orice latime)
  function laFractii(rect, altele, W, H) {
    const suda = (v, total, lista) => {
      if (v <= 0) return 0;
      if (v >= total) return 1;
      for (const o of lista) if (px(o, total) === v) return o;
      for (const g of [1 / 2, 1 / 3, 2 / 3]) if (px(g, total) === v) return g;
      return v / total;
    };
    const xs = altele.flatMap((o) => [o.l, o.r]);
    const ys = altele.flatMap((o) => [o.t, o.b]);
    return { l: suda(rect.l, W, xs), r: suda(rect.r, W, xs), t: suda(rect.t, H, ys), b: suda(rect.b, H, ys) };
  }

  // §4 Asezari si locuri noi
  // Grila cu cat mai putine coloane; ultimul rand se intinde pe toata latimea (fara gaura in colt)
  function grila(n) {
    const out = [];
    if (n <= 0) return out;
    const col = Math.ceil(Math.sqrt(n));
    const randuri = Math.ceil(n / col);
    for (let i = 0; i < n; i++) {
      const rand = Math.floor(i / col);
      const peRand = rand === randuri - 1 ? n - col * (randuri - 1) : col;
      const k = i - rand * col;
      out.push({ l: k / peRand, r: (k + 1) / peRand, t: rand / randuri, b: (rand + 1) / randuri });
    }
    return out;
  }

  function asezare(tip, n) {
    if (tip === 'columns') return Array.from({ length: n }, (_, i) => ({ l: i / n, r: (i + 1) / n, t: 0, b: 1 }));
    if (tip === 'rows') return Array.from({ length: n }, (_, i) => ({ l: 0, r: 1, t: i / n, b: (i + 1) / n }));
    if (tip === 'main' && n > 1) return [{ l: 0, r: 0.6, t: 0, b: 1 }, ...Array.from({ length: n - 1 }, (_, i) => ({ l: 0.6, r: 1, t: i / (n - 1), b: (i + 1) / (n - 1) }))];
    return grila(n);
  }

  // Cel mai mare dreptunghi gol in care incape o fereastra; null daca nu exista (atunci se rearanjeaza grila)
  function loculNou(rects, W, H) {
    if (!rects.length) return { l: 0, t: 0, r: 1, b: 1 };
    const xs = [...new Set([0, 1, ...rects.flatMap((f) => [f.l, f.r])])].sort((a, b) => a - b);
    const ys = [...new Set([0, 1, ...rects.flatMap((f) => [f.t, f.b])])].sort((a, b) => a - b);
    let best = null;
    let arie = 0;
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) for (let k = 0; k < ys.length; k++) for (let m = k + 1; m < ys.length; m++) {
      const r = { l: xs[i], r: xs[j], t: ys[k], b: ys[m] };
      if ((r.r - r.l) * W < MIN_W || (r.b - r.t) * H < MIN_H) continue;
      const a = (r.r - r.l) * (r.b - r.t);
      if (a > arie && rects.every((f) => !suprapuse(f, r))) { arie = a; best = r; }
    }
    return best;
  }

  // Panourile fara loc valid sau suprapuse (stare veche, sync) primesc grila
  function normalizeaza(g) {
    const panes = g.panes || [];
    const ok = panes.every((p, i) => valid(p.rect) && panes.every((q, j) => j <= i || !valid(q.rect) || !suprapuse(p.rect, q.rect)));
    if (ok && panes.length) return false;
    const r = asezare(g.layout === 'rows' ? 'rows' : 'grid', panes.length);
    panes.forEach((p, i) => { p.rect = r[i]; });
    return panes.length > 0;
  }

  // §5 Golul lasat de un panou scos: vecinele care acopera exact o latura a golului se intind peste el
  function umpleGolul(gol, rects) {
    const egal = (a, b) => Math.abs(a - b) < 1e-4;
    const directii = [
      { lipite: (o) => egal(o.r, gol.l), axa: ['t', 'b'], intinde: (o) => { o.r = gol.r; } },
      { lipite: (o) => egal(o.l, gol.r), axa: ['t', 'b'], intinde: (o) => { o.l = gol.l; } },
      { lipite: (o) => egal(o.b, gol.t), axa: ['l', 'r'], intinde: (o) => { o.b = gol.b; } },
      { lipite: (o) => egal(o.t, gol.b), axa: ['l', 'r'], intinde: (o) => { o.t = gol.t; } },
    ];
    for (const d of directii) {
      const [a, b] = d.axa;
      const vec = rects.filter((o) => d.lipite(o) && o[b] > gol[a] + 1e-4 && o[a] < gol[b] - 1e-4);
      if (!vec.length || vec.some((o) => o[a] < gol[a] - 1e-4 || o[b] > gol[b] + 1e-4)) continue;
      const acoperit = vec.reduce((s, o) => s + (o[b] - o[a]), 0);
      if (!egal(acoperit, gol[b] - gol[a])) continue;
      vec.forEach(d.intinde);
      return true;
    }
    return false;
  }

  window.NetorGroupGeom = { PRAG_PX, MIN_W, MIN_H, laPixeli, muta, redimensioneaza, laFractii, grila, asezare, loculNou, normalizeaza, umpleGolul, suprapuse, valid };
})();
