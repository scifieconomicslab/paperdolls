/* treelib.js: trees and greenery as assets (v0.1). Extends AssetLib; load after assetlib.js.
 *
 * Foliage is a low-poly solid: faceted ellipsoids, cones and fronds built from free faces, so it takes the register's three
 * flat tones like everything else. A tree is built from { s: scale, v: variant } and a kind; the colours come from the look
 * (canopies, bloom, trunk), so the same tree reads differently under each look and register.
 *
 *   kinds     broadleaf, oak, plane, columnar, conifer, umbrella, palm, blossom, shrub
 *   data      the main foliage colour (role "data"): a simulation can recolour canopy, for example by condition or species
 *   regions   each region has a species mix (REGIONS[id].trees): plane trees in Paris and Vienna, palms and umbrella trees in
 *             the tropics, cypress and stone pine around the Mediterranean, and so on. These are PROPOSALS to be checked with
 *             local authors, like every regional table.
 *   blossom   only appears when the look has a bloom colour (cherry, jacaranda, flame tree, bougainvillea)
 */
(function (root) {
  'use strict';
  const A = root.AssetLib;
  if (!A) throw new Error('assetlib.js must be loaded before treelib.js');
  const { mix, shade, hash } = A;
  function rngSeed(seed) { let a = (seed | 0) >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  const KINDS = {
    broadleaf: { label: 'Broadleaf tree', h: 8 },
    oak:       { label: 'Large spreading tree', h: 10 },
    plane:     { label: 'Street plane tree', h: 9.5 },
    columnar:  { label: 'Columnar tree (poplar, cypress)', h: 11 },
    conifer:   { label: 'Conifer', h: 9 },
    umbrella:  { label: 'Umbrella tree (acacia, pine)', h: 8 },
    palm:      { label: 'Palm', h: 10 },
    blossom:   { label: 'Flowering tree', h: 7.5 },
    shrub:     { label: 'Shrub or hedge', h: 1.8 }
  };

  function cross(u, v) { return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; }
  function normalUp(pts) { const u = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]], v = [pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]]; let n = cross(u, v); if (n[2] < 0) n = [-n[0], -n[1], -n[2]]; return n; }

  // a faceted ellipsoid: rings of quads, jittered so every tree is its own. Returns face parts.
  function blob(cx, cy, cz, rx, ry, rz, nSeg, nRing, jit, rnd, bloomP) {
    const V = [];
    for (let i = 0; i <= nRing; i++) {
      V.push([]); const th = Math.PI * i / nRing, pole = i === 0 || i === nRing;
      for (let j = 0; j < nSeg; j++) {
        const ph = 2 * Math.PI * j / nSeg, k = pole ? 1 : 1 + jit * (rnd() - 0.5), kz = pole ? 1 : 1 + jit * 0.3 * (rnd() - 0.5);
        V[i].push([cx + rx * Math.sin(th) * Math.cos(ph) * k, cy + ry * Math.sin(th) * Math.sin(ph) * k, cz + rz * Math.cos(th) * kz]);
      }
    }
    const out = [];
    for (let i = 0; i < nRing; i++) for (let j = 0; j < nSeg; j++) {
      const p = [V[i][j], V[i][(j + 1) % nSeg], V[i + 1][(j + 1) % nSeg], V[i + 1][j]];
      const mx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, my = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4, mz = (p[0][2] + p[1][2] + p[2][2] + p[3][2]) / 4;
      const n = [(mx - cx) / (rx * rx), (my - cy) / (ry * ry), (mz - cz) / (rz * rz)], nl = Math.hypot(n[0], n[1], n[2]) || 1, u = rnd();
      let role = 'data';
      if (bloomP && u < bloomP) role = 'bloom';
      else if (n[2] / nl > 0.55) role = 'leaf1';
      else if (u > 0.78) role = 'leaf2';
      out.push({ t: 'face', pts: p, n, role, layer: 1 });
    }
    return out;
  }
  function cone(cx, cy, zb, r, za, nSeg, role0, role1) {
    const ring = []; for (let j = 0; j < nSeg; j++) { const ph = 2 * Math.PI * j / nSeg; ring.push([cx + r * Math.cos(ph), cy + r * Math.sin(ph), zb]); }
    const out = [], slope = r / (za - zb);
    for (let j = 0; j < nSeg; j++) {
      const phm = 2 * Math.PI * (j + 0.5) / nSeg;
      out.push({ t: 'face', pts: [ring[j], ring[(j + 1) % nSeg], [cx, cy, za]], n: [Math.cos(phm), Math.sin(phm), slope], role: j % 2 ? role1 : role0, layer: 1 });
    }
    return out;
  }
  function frond(phi, len, z0, droop, w, role) {
    const b = [0, 0, z0], t = [len * Math.cos(phi), len * Math.sin(phi), z0 - droop], mid = [b[0] + (t[0] - b[0]) * 0.5, b[1] + (t[1] - b[1]) * 0.5, z0 + 0.45], sd = [-Math.sin(phi) * w, Math.cos(phi) * w, 0];
    const pts = [b, [mid[0] + sd[0], mid[1] + sd[1], mid[2]], t, [mid[0] - sd[0], mid[1] - sd[1], mid[2]]];
    return { t: 'face', pts, n: normalUp(pts), role, layer: 1 };
  }
  const trunkBox = (h, w) => ({ t: 'box', b: [-w, -w, 0, w, w, h], role: 'trunk', layer: 0 });

  function treeDef(kind, o) {
    const K = KINDS[kind]; if (!K) throw new Error('unknown tree ' + kind);
    const s = o.s || 1, rnd = rngSeed((o.v | 0) * 977 + A.hashStr(kind)), parts = [];
    if (kind === 'broadleaf') { parts.push(trunkBox(3.2, 0.18)); parts.push(...blob(0, 0, 5.4, 3.0, 3.0, 2.7, 8, 4, 0.22, rnd)); }
    else if (kind === 'oak') { parts.push(trunkBox(3.8, 0.26)); parts.push(...blob(0, 0, 6.6, 4.4, 4.4, 3.4, 9, 4, 0.26, rnd)); parts.push(...blob(1.6, -1.2, 7.4, 2.6, 2.6, 2.2, 7, 3, 0.22, rnd)); }
    else if (kind === 'plane') { parts.push(trunkBox(3.8, 0.22)); parts.push(...blob(0, 0, 6.6, 3.6, 3.6, 3.0, 8, 4, 0.18, rnd)); }
    else if (kind === 'columnar') { parts.push(trunkBox(1.2, 0.16)); parts.push(...blob(0, 0, 6.6, 1.3, 1.3, 5.4, 6, 5, 0.14, rnd)); }
    else if (kind === 'conifer') { parts.push(trunkBox(1.8, 0.2)); parts.push(...cone(0, 0, 1.8, 2.7, 5.0, 8, 'data', 'leaf2')); parts.push(...cone(0, 0, 3.6, 2.1, 7.2, 8, 'data', 'leaf2')); parts.push(...cone(0, 0, 5.4, 1.5, 9.2, 8, 'data', 'leaf2')); }
    else if (kind === 'umbrella') { parts.push(trunkBox(5.6, 0.17)); parts.push(...blob(0, 0, 6.8, 5.2, 5.2, 1.3, 10, 3, 0.2, rnd)); parts.push(...blob(-1.5, 1.0, 7.5, 2.8, 2.8, 0.9, 7, 3, 0.2, rnd)); }
    else if (kind === 'palm') {
      parts.push({ t: 'prism', y: [-0.2, 0.2], role: 'trunk', prof: [[-0.24, 0], [0.24, 0], [0.15, 9], [-0.15, 9]], layer: 0 });
      for (let k = 0; k < 9; k++) parts.push(frond(2 * Math.PI * k / 9 + rnd() * 0.3, 3.2 + rnd() * 0.5, 9.1, 0.5 + rnd() * 0.6, 0.55, k % 2 ? 'leaf1' : 'data'));
    }
    else if (kind === 'blossom') { parts.push(trunkBox(2.8, 0.18)); parts.push(...blob(0, 0, 5.0, 2.9, 2.9, 2.5, 8, 4, 0.26, rnd, 0.55)); }
    else if (kind === 'shrub') parts.push(...blob(0, 0, 0.95, 1.5, 1.5, 0.9, 7, 3, 0.25, rnd));
    if (s !== 1) for (const p of parts) { if (p.pts) p.pts = p.pts.map(q => [q[0] * s, q[1] * s, q[2] * s]); if (p.b) p.b = p.b.map(x => x * s); if (p.prof) p.prof = p.prof.map(q => [q[0] * s, q[1] * s]); if (p.y) p.y = p.y.map(x => x * s); }
    return { parts, meta: { h: K.h * s } };
  }
  A.registerGroup('trees', treeDef);

  // ---------- regional species mixes (proposals) ----------
  const MIX = {
    nw: [['broadleaf', 4], ['plane', 3], ['oak', 1], ['columnar', 1], ['conifer', 0.5], ['blossom', 0.5]],
    uk: [['oak', 3], ['plane', 3], ['broadleaf', 3], ['conifer', 0.5], ['blossom', 0.4]],
    ws: [['plane', 5], ['broadleaf', 2], ['columnar', 1], ['conifer', 0.5], ['blossom', 0.4]],
    md: [['umbrella', 3], ['columnar', 3], ['broadleaf', 3], ['palm', 1], ['shrub', 2], ['blossom', 1]],
    ce: [['broadleaf', 4], ['oak', 2], ['conifer', 1.5], ['columnar', 1], ['blossom', 0.4]],
    sa: [['oak', 3], ['palm', 3], ['umbrella', 2], ['blossom', 1.5], ['broadleaf', 1]],
    se: [['palm', 3], ['broadleaf', 3], ['umbrella', 2], ['blossom', 1.5], ['shrub', 1]],
    ea: [['broadleaf', 4], ['blossom', 2], ['conifer', 1.5], ['columnar', 1], ['plane', 1]],
    me: [['palm', 4], ['broadleaf', 2], ['umbrella', 1], ['shrub', 1.5], ['columnar', 1]],
    sb: [['umbrella', 3], ['broadleaf', 3], ['palm', 1.5], ['blossom', 1.5], ['shrub', 1]],
    la: [['broadleaf', 3], ['palm', 2], ['blossom', 2], ['umbrella', 1], ['oak', 1]],
    na: [['oak', 3], ['broadleaf', 3], ['conifer', 2], ['plane', 1], ['columnar', 0.5]]
  };
  for (const id of Object.keys(MIX)) if (A.REGIONS[id]) A.REGIONS[id].trees = MIX[id];

  // a flowering tree needs a bloom colour in the look; without one it becomes a plain broadleaf
  function pickTree(regionId, u, th) {
    const mixes = ((A.REGIONS[regionId] && A.REGIONS[regionId].trees) || MIX.nw).map(e => [(e[0] === 'blossom' && th && !th.bloom) ? 'broadleaf' : e[0], e[1]]);
    return A.pickWeighted(mixes, u);
  }
  function treeParams(seed) { return { s: [0.8, 1, 1.2][Math.floor(hash(seed + 9) * 3) % 3], v: Math.floor(hash(seed + 10) * 6) }; }

  // colours: foliage from the look's canopies, bloom and trunk from the look
  function treeColours(reg, th, seed, kind, dataColour) {
    const cs = th.canopies, base = cs[Math.floor(hash(seed + 3) * cs.length) % cs.length], dark = kind === 'conifer', c = A.baseColours(reg);
    return Object.assign(c, {
      data: dataColour || (dark ? shade(base, 0.72) : base), leaf1: dark ? shade(base, 0.88) : mix(base, '#ffffff', 0.2), leaf2: dark ? shade(base, 0.58) : shade(base, 0.78),
      bloom: th.bloom || mix(base, '#ffffff', 0.2), trunk: th.trunk
    });
  }

  Object.assign(A, { TREES: KINDS, pickTree, treeParams, treeColours, treeHeight: (kind, s) => KINDS[kind].h * (s || 1) });
})(typeof window !== 'undefined' ? window : globalThis);
