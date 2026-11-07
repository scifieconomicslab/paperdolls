/* assetlib.js: people and vehicles for SimCity-style isometric replays (v0.2).
 *
 * Every asset is defined once, parametrically, in its own local frame (metres, x forward, y lateral, z up).
 * For each of the four axis headings the library builds the faces that face the camera
 * (right face = world +x, left face = world +y, top), as a list of polygons in "screen metres".
 * The same polygon list is emitted as SVG (catalogue, export) or painted on a canvas (scenes).
 *
 * Data surface: every asset has polygons with role "data" (people: garment; vehicles: body or livery).
 * A simulation recolours them to show an output (state, income band, anything), without touching shape.
 *
 * People are paper dolls: flat cut-outs, one neutral paper tone for head and limbs, no skin tones.
 * Regional variation is driven by climate (cold, sun, rain) and by the region's fleet, not by identity.
 * Everything regional here is a PROPOSAL and must be checked with local authors.
 */
(function (root) {
  'use strict';

  const C30 = 0.8660254;
  const VIEW = [1, 1, 1.2];

  // ---------- colour helpers (hex in, hex out) ----------
  function h2r(h) { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }
  function r2h(c) { return '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
  function shade(h, k) { return r2h(h2r(h).map(v => v * k)); }
  function mix(a, b, t) { const A = h2r(a), B = h2r(b); return r2h(A.map((v, i) => v * (1 - t) + B[i] * t)); }
  function hash(n) { // deterministic float in [0,1) from an integer
    n = (n | 0) ^ 61; n ^= n >>> 16; n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
  }

  // ---------- Carbon tokens (IBM Carbon Design System), used by the formal register ----------
  // Checked against carbondesignsystem.com: white, gray 10/20/30/50/60/80/100, blue 10/30/60/70/80, purple 40/60/70, yellow 30,
  // green 60, red 60. From memory of Carbon's palette and still to be checked: gray 40/70/90, cool gray, warm gray, blue 20/40,
  // cyan 50, teal 50.
  const CARBON = {
    white: '#ffffff',
    gray: { 10: '#f4f4f4', 20: '#e0e0e0', 30: '#c6c6c6', 40: '#a8a8a8', 50: '#8d8d8d', 60: '#6f6f6f', 70: '#525252', 80: '#393939', 90: '#262626', 100: '#161616' },
    cool: { 10: '#f2f4f8', 20: '#dde1e6', 30: '#c1c7cd', 40: '#a2a9b0', 50: '#878d96', 60: '#697077', 70: '#4d5358', 80: '#343a3f', 90: '#21272a', 100: '#121619' },
    warm: { 10: '#f7f3f2', 20: '#e5e0df', 30: '#cac5c4', 40: '#ada8a8', 50: '#8f8b8b', 60: '#726e6e', 70: '#565151', 80: '#3c3838', 90: '#272525', 100: '#171414' },
    blue: { 10: '#edf5ff', 20: '#d0e2ff', 30: '#a6c8ff', 40: '#78a9ff', 60: '#0f62fe', 70: '#0043ce', 80: '#002d9c' },
    purple: { 40: '#be95ff', 60: '#8a3ffc', 70: '#6929c4' }, green: { 60: '#198038' }, yellow: { 30: '#f1c21b' }, red: { 60: '#da1e28' },
    cyan: { 50: '#1192e8' }, teal: { 50: '#009d9a' }
  };

  // ---------- registers ----------
  // A register is how a palette is drawn. colorfigures: warm, hand-inked, the region's own colours. formal: a Carbon-based
  // technical drawing: flat fills, hairlines, neutral tokens, one accent (IBM Blue), a faint ground grid, and colour reserved
  // for data (the retrofit states use IBM's data-visualisation colours).
  const REG = {
    colorfigures: { id: 'colorfigures', bg: '#f2efe7', ink: '#231e16', lw: 1.1, tones: [1.14, 1.0, 0.76], paper: '#fbf6ea', glass: '#b6cfdc', coop: '#93d3b0',
                    tram: '#c8452f', grid: false, states: { to_do: null, queued: '#6f96c8', in_progress: '#f4b829', finished: '#93d3b0', investor: '#8e80ac' } },
    formal: { id: 'formal', bg: CARBON.gray[10], ink: CARBON.gray[90], lw: 0.75, tones: [1.08, 0.98, 0.84], paper: CARBON.white, glass: CARBON.blue[20], coop: CARBON.blue[60],
              tram: CARBON.cool[70], grid: true, states: { to_do: null, queued: CARBON.cyan[50], in_progress: CARBON.yellow[30], finished: CARBON.teal[50], investor: CARBON.purple[60] } }
  };
  for (const k of Object.keys(REG)) { const r = REG[k]; r.queued = r.states.queued; r.inprog = r.states.in_progress; r.finished = r.states.finished; r.investor = r.states.investor; }

  // nearest design token in CIELAB (so a regional colour lands on a token, not between tokens)
  function lum(h) { const c = h2r(h); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function toGray(h) { const l = lum(h); return r2h([l, l, l]); }
  const labCache = new Map();
  function lab(h) {
    let v = labCache.get(h); if (v) return v;
    const c = h2r(h).map(x => { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    const X = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047, Y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722, Z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    v = [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; labCache.set(h, v); return v;
  }
  function snapTo(h, set) {
    const L = lab(h); let best = set[0], bd = 1e18;
    for (const t of set) { const l = lab(t), d = (L[0] - l[0]) ** 2 + (L[1] - l[1]) ** 2 + (L[2] - l[2]) ** 2; if (d < bd) { bd = d; best = t; } }
    return best;
  }
  const grades = (scale, from, to) => Object.keys(scale).map(Number).filter(g => g >= from && g <= to).map(g => scale[g]);
  const NEUTRAL_WALLS = [].concat(grades(CARBON.gray, 10, 70), grades(CARBON.cool, 10, 70), grades(CARBON.warm, 10, 70));
  const NEUTRAL_ROOFS = [].concat(grades(CARBON.gray, 60, 90), grades(CARBON.cool, 60, 90), grades(CARBON.warm, 60, 90));

  // ---------- themes: a palette family + a look, resolved for a register ----------
  // A family (palettes.json) owns several looks. theme(family, look, register) returns every colour the renderers need.
  function resolveLook(fam, ref) {
    if (fam.looks && fam.looks.length) {
      if (typeof ref === 'number') return fam.looks[((ref % fam.looks.length) + fam.looks.length) % fam.looks.length];
      if (typeof ref === 'string') return fam.looks.find(l => l.id === ref) || fam.looks[0];
      return fam.looks[0];
    }
    // a flat legacy record (wall, wall2, roof, ground, accent, shadow) becomes a single look
    return { id: 'legacy', name: fam.name || 'legacy', note: '', surface: 'asphalt', walls: [fam.wall, fam.wall2, mix(fam.wall, fam.wall2, 0.5), shade(fam.wall, 0.9)],
             roofs: [fam.roof, shade(fam.roof, 0.8)], accents: [fam.accent, fam.wall2, '#d8b04a'], ground: fam.ground, road: fam.road || shade(fam.ground, 0.9),
             pave: fam.pave || mix(fam.ground, '#ffffff', 0.35), grass: fam.grass || '#b9d3a2', canopies: fam.canopies || ['#7fa27a', '#5f8a62', '#9ab87a'],
             bloom: fam.bloom || null, water: fam.water || '#a9c9d8', shadow: fam.shadow };
  }
  function finishTheme(t) { t.wall = t.walls[0]; t.wall2 = t.walls[1]; t.roof = t.roofs[0]; t.accent = t.accents[0]; return t; }

  function colorTheme(fam, k) {
    const R = REG.colorfigures;
    return finishTheme({
      famId: fam.id, famName: fam.name, lookId: k.id, name: k.name, note: k.note || '', reg: 'colorfigures', surface: k.surface || 'asphalt',
      walls: k.walls, roofs: k.roofs, accents: k.accents, ground: k.ground, road: k.road, pave: k.pave, grass: k.grass, canopies: k.canopies, bloom: k.bloom || null,
      water: k.water, shadow: k.shadow, bg: R.bg, roofflat: mix(k.ground, '#6e6e6e', 0.55), mark: '#f5f0dc', rail: '#6d6a62', median: mix(k.grass, k.ground, 0.3),
      plaza: k.pave, kerb: shade(k.pave, 0.82), trunk: mix('#6b5a45', k.shadow, 0.2), grid: null,
      vehicles: [k.accents[0], k.walls[1], mix(k.roofs[0], '#ffffff', 0.45), '#d9d1bf', '#7b8a98', '#3f4a49', k.walls[0]],
      tops: [k.accents[0], k.walls[1], mix(k.roofs[0], '#ffffff', 0.35), mix(k.walls[0], '#ffffff', 0.25), mix(k.accents[0], '#ffffff', 0.45), '#e9e2d0', '#6b7b8c'],
      bottoms: [k.roofs[0], mix(k.roofs[0], '#000000', 0.2), '#3f4a5c', '#5a5248', mix(k.walls[0], '#000000', 0.45)],
      peopleAccents: [k.accents[0], k.walls[1], '#d8b04a']
    });
  }

  // Formal: the region still decides warm or cool and light or dark, but every colour is snapped to a Carbon token, and
  // everything that is not data is neutral. Greens are built from Carbon green 60, water from blue 60.
  function formalTheme(fam, k) {
    const C = CARBON, G = C.green[60], neutralWall = h => snapTo(mix(mix(h, toGray(h), 0.5), '#ffffff', 0.28), NEUTRAL_WALLS), darkRoof = h => snapTo(mix(h, toGray(h), 0.85), NEUTRAL_ROOFS);
    const earth = k.surface === 'earth';
    const cl = Math.max(0, Math.min(1, (lum(k.canopies[0]) - 90) / 140)), cr = 0.42 + 0.2 * cl;    // lighter foliage in the look gives lighter formal greens
    return finishTheme({
      famId: fam.id, famName: fam.name, lookId: k.id, name: k.name, note: k.note || '', reg: 'formal', surface: k.surface || 'asphalt',
      walls: k.walls.map(neutralWall), roofs: k.roofs.map(darkRoof), accents: [C.blue[60], C.gray[70], C.blue[30]],
      ground: C.gray[20], road: k.surface === 'concrete' ? C.gray[30] : (earth ? C.warm[40] : C.gray[40]), pave: C.white,
      grass: mix(C.gray[20], G, 0.22), canopies: [mix(G, C.gray[30], cr), mix(G, C.gray[40], cr + 0.12), mix(G, C.gray[20], cr - 0.1)], bloom: k.bloom ? mix(C.purple[40], C.gray[20], 0.3) : null,
      water: mix(C.gray[20], C.blue[60], 0.22), shadow: C.gray[50], bg: C.gray[10], roofflat: C.gray[30], mark: C.gray[10], rail: C.gray[70], median: C.gray[30],
      plaza: C.gray[10], kerb: C.gray[30], trunk: C.gray[60], grid: '#dcdcdc',
      vehicles: [C.gray[30], C.gray[40], C.gray[50], C.gray[60], C.cool[20], C.warm[20], C.gray[70]],
      tops: [C.gray[50], C.gray[60], C.gray[40], C.cool[60], C.cool[50], C.warm[50], C.gray[30]], bottoms: [C.gray[80], C.gray[90], C.cool[80], C.gray[70], C.warm[80]],
      peopleAccents: [C.blue[60], C.gray[60], C.blue[30]]
    });
  }

  const themeCache = new Map();
  function theme(fam, lookRef, regId) {
    const reg = REG[regId] ? regId : 'colorfigures', look = resolveLook(fam, lookRef), key = (fam.id || 'x') + '|' + look.id + '|' + reg;
    let t = themeCache.get(key);
    if (!t) { t = reg === 'formal' ? formalTheme(fam, look) : colorTheme(fam, look); themeCache.set(key, t); }
    return t;
  }
  // accepts a resolved theme, or a palette family record (first look, colorfigures)
  function asTheme(x, regId) { return (x && x.walls && x.tops) ? x : theme(x, undefined, regId); }

  // Stylisation: people are drawn 1.2x life size so they read at neighbourhood zoom. Vehicles use the same factor
  // so the proportions between them stay true.
  const STYLE = { person: 1.2, vehicle: 1.2 };

  // ---------- transforms ----------
  function rotFn(h) { const c = [1, 0, -1, 0][h & 3], s = [0, 1, 0, -1][h & 3]; return (lx, ly) => [lx * c - ly * s, lx * s + ly * c]; }
  function P3(R, lx, ly, lz) { const w = R(lx, ly); return [(w[0] - w[1]) * C30, (w[0] + w[1]) * 0.5 - lz]; }
  function depthOf(R, lx, ly, lz) { const w = R(lx, ly); return w[0] + w[1] + lz * 1.2; }
  function snapHeading(rad) { return ((Math.round(rad / (Math.PI / 2)) % 4) + 4) % 4; }

  function circle(cx, cz, r, n) { const a = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; a.push([cx + Math.cos(t) * r, cz + Math.sin(t) * r]); } return a; }
  function halfEllipse(cx, cz, rx, rz, n) { const a = []; for (let i = 0; i <= n; i++) { const t = Math.PI * i / n; a.push([cx + Math.cos(t) * rx, cz + Math.sin(t) * rz]); } return a; }

  // ---------- part builders: each returns { key, prims } ----------
  function visible(n) { return n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2] > 1e-4; }

  // prism: a profile extruded across the object. Default: profile in (x,z), extruded along y over p.y.
  // axis: 'x': profile in (y,z), extruded along x over p.x (gable roofs, ridge along the width).
  function buildPrism(p, R) {
    const ax = p.axis === 'x';
    const prof = p.prof, n = prof.length;
    let A = 0; for (let i = 0; i < n; i++) { const a = prof[i], b = prof[(i + 1) % n]; A += a[0] * b[1] - b[0] * a[1]; }
    const sgn = A > 0 ? 1 : -1, ext = ax ? p.x : p.y, e0 = ext[0], e1 = ext[1];
    const L3 = (u, e, z) => ax ? [e, u, z] : [u, e, z];          // profile coordinate, extrusion coordinate, height -> local 3D
    const edges = [], caps = [];
    for (let i = 0; i < n; i++) {
      const a = prof[i], b = prof[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 1e-6) continue;
      const nx = sgn * dz / L, nz = -sgn * dx / L;
      const wn = ax ? R(0, nx) : R(nx, 0);
      if (!visible([wn[0], wn[1], nz])) continue;
      const role = nz > 0.85 ? (p.topRole || p.role) : (p.edgeRole || p.role);
      edges.push({ pts: [P3(R, ...L3(a[0], e0, a[1])), P3(R, ...L3(b[0], e0, b[1])), P3(R, ...L3(b[0], e1, b[1])), P3(R, ...L3(a[0], e1, a[1]))],
                   role, w: [wn[0] * wn[0], wn[1] * wn[1], nz * nz], d: depthOf(R, ...L3((a[0] + b[0]) / 2, (e0 + e1) / 2, (a[1] + b[1]) / 2)) });
    }
    edges.sort((u, v) => u.d - v.d);
    for (const s of [-1, 1]) {
      const wn = ax ? R(s, 0) : R(0, s);
      if (!visible([wn[0], wn[1], 0])) continue;
      caps.push({ pts: prof.map(q => P3(R, ...L3(q[0], s > 0 ? e1 : e0, q[1]))), role: p.capRole || p.role, w: [wn[0] * wn[0], wn[1] * wn[1], 0] });
    }
    let cu = 0, cz = 0; prof.forEach(q => { cu += q[0]; cz += q[1]; });
    return { key: depthOf(R, ...L3(cu / n, (e0 + e1) / 2, cz / n)) + (p.bias || 0), prims: edges.concat(caps) };
  }

  // face: a free polygon in local 3D with an explicit outward normal (hip roofs, awnings, solar panels)
  function buildFace(p, R) {
    const len = Math.hypot(p.n[0], p.n[1], p.n[2]) || 1, ln = [p.n[0] / len, p.n[1] / len, p.n[2] / len];
    const wn = R(ln[0], ln[1]);
    if (!visible([wn[0], wn[1], ln[2]])) return { key: 0, prims: [] };
    let cx = 0, cy = 0, cz = 0; p.pts.forEach(q => { cx += q[0]; cy += q[1]; cz += q[2]; });
    const m = p.pts.length;
    return { key: depthOf(R, cx / m, cy / m, cz / m) + (p.bias || 0),
             prims: [{ pts: p.pts.map(q => P3(R, q[0], q[1], q[2])), role: p.role, w: [wn[0] * wn[0], wn[1] * wn[1], ln[2] * ln[2]], ink: p.ink, lw: p.lw }] };
  }

  function buildFlat(p, R) {
    const sides = p.side === 'both' ? [1, -1] : [p.side || 0];
    const out = []; let cx = 0, cz = 0; p.poly.forEach(q => { cx += q[0]; cz += q[1]; }); cx /= p.poly.length; cz /= p.poly.length;
    let key = 0;
    for (const s of sides) {
      let wn, yy;
      if (s !== 0) { wn = R(0, s); if (!visible([wn[0], wn[1], 0])) continue; yy = s * Math.abs(p.y || 0); }
      else { const L = R(0, 1); wn = (L[0] * VIEW[0] + L[1] * VIEW[1] > 0) ? L : [-L[0], -L[1]]; yy = p.y || 0; }
      out.push({ pts: p.poly.map(q => P3(R, q[0], yy, q[1])), role: p.role, w: [wn[0] * wn[0], wn[1] * wn[1], 0], ink: p.ink, lw: p.lw });
      key = depthOf(R, cx, yy, cz);
    }
    return { key: key + (p.bias === undefined ? 0.3 : p.bias), prims: out };
  }

  // flat polygon in the (y,z) plane at x = p.x, normal along local x (end: +1 or -1), or end: 0 = whichever faces the camera (paper dolls)
  function buildEnd(p, R) {
    let s = p.end, back = false;
    if (s === 0) { const X = R(1, 0); s = (X[0] * VIEW[0] + X[1] * VIEW[1] > 0) ? 1 : -1; back = s < 0; }
    const wn = R(s, 0);
    if (!visible([wn[0], wn[1], 0])) return { key: 0, prims: [] };
    let cy = 0, cz = 0; p.poly.forEach(q => { cy += q[0]; cz += q[1]; }); cy /= p.poly.length; cz /= p.poly.length;
    return { key: depthOf(R, p.x || 0, cy, cz) + (p.bias === undefined ? 0.3 : p.bias),
             prims: [{ pts: p.poly.map(q => P3(R, p.x || 0, q[0], q[1])), role: p.role, w: [wn[0] * wn[0], wn[1] * wn[1], 0], back, ink: p.ink, lw: p.lw }] };
  }

  function buildPart(p, R) {
    if (p.t === 'box') { const b = p.b; return buildPrism({ prof: [[b[0], b[2]], [b[3], b[2]], [b[3], b[5]], [b[0], b[5]]], y: [b[1], b[4]], role: p.role, topRole: p.topRole, edgeRole: p.edgeRole, capRole: p.capRole, bias: p.bias }, R); }
    if (p.t === 'prism') return buildPrism(p, R);
    if (p.t === 'flat') return buildFlat(p, R);
    if (p.t === 'disc') return buildFlat({ side: p.side, y: p.y, poly: circle(p.c[0], p.c[1], p.r, p.n || 14), role: p.role, bias: p.bias, ink: p.ink }, R);
    if (p.t === 'end') return buildEnd(p, R);
    if (p.t === 'face') return buildFace(p, R);
    throw new Error('unknown part type ' + p.t);
  }

  function buildAsset(def, heading) {
    const R = rotFn(heading), list = [];
    def.parts.forEach((p, i) => {
      // a part that stands proud of a wall (balcony, awning, step, scaffold) declares that wall's outward direction in
      // needs: [x, y]. If that wall faces away from the camera the part is behind the building, so it is not drawn.
      if (p.needs) { const wn = R(p.needs[0], p.needs[1]); if (!visible([wn[0], wn[1], 0])) return; }
      const o = buildPart(p, R);
      const layer = p.layer !== undefined ? p.layer : ((p.t === 'prism' || p.t === 'box') ? 0 : 5);
      if (o.prims.length) list.push({ key: o.key, i, layer, prims: o.prims });
    });
    if (def.sort !== false) list.sort((a, b) => (a.layer - b.layer) || (a.key - b.key) || (a.i - b.i));
    const prims = [].concat(...list.map(l => l.prims));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; const roles = new Set();
    for (const pr of prims) { roles.add(pr.role); for (const q of pr.pts) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); } }
    return { id: def.id, group: def.group, kind: def.kind, heading, prims, roles: Array.from(roles), bbox: { minX, maxX, minY, maxY } };
  }

  // ---------- output: SVG and canvas ----------
  function faceOf(w) { return w[2] > 0.5 ? 'top' : (w[0] > w[1] ? 'right' : 'left'); }
  const shadeMemo = new Map();
  function primFill(pr, colours, reg) {
    const c = colours[pr.role]; if (!c) return null;
    let k = reg.tones[0] * pr.w[2] + reg.tones[1] * pr.w[1] + reg.tones[2] * pr.w[0];
    if (pr.back) k *= 0.93;
    const key = c + k.toFixed(3);                       // the same colour and tone recur across thousands of polygons
    let v = shadeMemo.get(key);
    if (v === undefined) { if (shadeMemo.size > 60000) shadeMemo.clear(); v = shade(c, k); shadeMemo.set(key, v); }
    return v;
  }
  function isData(role) { return role === 'data' || role.indexOf('data@') === 0; }

  function toSVG(asset, colours, reg, o) {
    o = o || {}; const s = o.scale || 40, pad = 6, bb = asset.bbox;
    const w = (bb.maxX - bb.minX) * s + pad * 2, h = (bb.maxY - bb.minY) * s + pad * 2;
    const X = v => ((v - bb.minX) * s + pad).toFixed(1), Y = v => ((v - bb.minY) * s + pad).toFixed(1);
    let out = '<svg xmlns="http://www.w3.org/2000/svg" class="asset" viewBox="0 0 ' + w.toFixed(1) + ' ' + h.toFixed(1) + '" width="' + w.toFixed(0) + '" height="' + h.toFixed(0) + '" data-asset="' + asset.kind + '" data-heading="' + asset.heading + '">';
    for (const pr of asset.prims) {
      const fill = primFill(pr, colours, reg);
      const pts = pr.pts.map(q => X(q[0]) + ',' + Y(q[1])).join(' ');
      const stroke = pr.ink === false ? 'none' : reg.ink;
      out += '<polygon points="' + pts + '" fill="' + (fill || 'none') + '" stroke="' + stroke + '" stroke-width="' + (reg.lw * (pr.lw || 1)).toFixed(2) +
             '" stroke-linejoin="round" vector-effect="non-scaling-stroke" data-face="' + faceOf(pr.w) + '" data-role="' + pr.role + '"' + (isData(pr.role) ? ' data-surface="1"' : '') + '/>';
    }
    return out + '</svg>';
  }

  // lwMul thins the ink line (scenes pass less than 1 when zoomed out, so tiny polygons are not swamped by their outline)
  // detail (opt-in, buildings, baked once per sprite): a light bevel along roof edges, and a soft ambient-occlusion band along the foot of each wall
  const BEVEL_ROLES = { roofflat: 1, roof: 1, data: 1, chimney: 1, trim: 1 };
  function paint(ctx, asset, colours, reg, px, py, scale, lwMul, detail) {
    ctx.lineJoin = 'round'; const lk = lwMul === undefined ? 1 : lwMul;
    const trace = pr => { ctx.beginPath(); pr.pts.forEach((q, i) => { const x = px + q[0] * scale, y = py + q[1] * scale; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); };
    for (const pr of asset.prims) {
      const fill = primFill(pr, colours, reg);
      trace(pr);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (pr.ink !== false) { ctx.strokeStyle = reg.ink; ctx.lineWidth = reg.lw * (pr.lw || 1) * lk; ctx.stroke(); }
      if (detail && fill && pr.w[2] > 0.5 && BEVEL_ROLES[pr.role] && reg.id !== 'formal') {
        ctx.save(); trace(pr); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = reg.lw * lk * 2 + 1.6; ctx.stroke(); ctx.restore();
      }
    }
    if (detail && reg.id !== 'formal') {
      for (const pr of asset.prims) {
        if (pr.role !== 'data' || pr.w[2] >= 0.5 || pr.pts.length < 4) continue;
        const n = pr.pts.length; let bi = 0, best = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < n; i++) { const a = pr.pts[i], b = pr.pts[(i + 1) % n], my = (a[1] + b[1]) / 2; if (my > best) { best = my; bi = i; } y0 = Math.min(y0, a[1]); y1 = Math.max(y1, a[1]); }
        if ((y1 - y0) * scale < 12) continue;
        const a = pr.pts[bi], b = pr.pts[(bi + 1) % n];
        ctx.save(); trace(pr); ctx.clip(); ctx.beginPath(); ctx.moveTo(px + a[0] * scale, py + a[1] * scale); ctx.lineTo(px + b[0] * scale, py + b[1] * scale);
        ctx.strokeStyle = 'rgba(36,28,56,0.075)';
        for (const w of [0.6, 1.2, 2.0]) { ctx.lineWidth = w * scale; ctx.stroke(); }
        ctx.restore();
      }
    }
  }
  // fine grain: a small seeded noise tile of faint dark and light pixels, laid over the painted pixels of a sprite only (source-atop)
  let grainTile = null;
  function grainPattern(c) {
    if (grainTile === null) {
      const N = 48, cv = sprites.factory(N, N), g = cv.getContext('2d'); let t = 0x9e3779b9;
      const r = () => { t = (t + 0x6D2B79F5) | 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = r(); if (v < 0.3) { g.fillStyle = 'rgba(0,0,0,0.075)'; g.fillRect(x, y, 1, 1); } else if (v > 0.82) { g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x, y, 1, 1); } }
      grainTile = c.createPattern(cv, 'repeat');
    }
    return grainTile;
  }

  // Sprite cache: an asset at a given scale and colouring is painted once into an offscreen canvas, then blitted.
  // Set AssetLib.sprites.factory = (w, h) => canvas (browser: document.createElement; node: createCanvas).
  const sprites = { factory: null, cache: new Map(), limit: 20000, dpr: 1, pixels: 0, maxPixels: 90e6, exact: false, builds: 0, maxBuilds: Infinity, detail: false, ink: false, grain: true, minDetail: 2.5, posterize: 0, maxZoomBuilds: Infinity, maxBuildMs: Infinity, frameStart: 0, zooming: false, collect: null, index: new Map(), shapes: new Map(), frame: 0, evictions: 0, staleOk: false, unbudgeted: false, screenFactory: null };       // screenFactory: for canvases that are painted over and over and blitted to the stage every frame (the tint and the marks); GPU-backed in the pages. Falls back to factory       // staleOk: the caller draws to the screen, so a sprite in other colours may stand in for one over the budget (never into a cached layer)
  // The canvas factory for browser pages. Every offscreen canvas the renderer makes (sprites, the ground and far layers, the patch scratch, the tint) is a cache that is written with
  // thousands of small drawImage / fill calls and only ever read by a drawImage. Chromium backs a plain canvas with the GPU and runs those calls as GPU work: 9,900 sprite canvases
  // and two 3x-view layers made the whole-commune view of Jette run at 0.8 fps on a real GPU (paperdolls#3; 40-60 fps with the canvases in memory, 20 fps while the layer was repainting).
  // A canvas opened with { willReadFrequently: true } is backed by memory, and drawing it to the (GPU) stage is a single upload of the window that is shown. The options of
  // getContext are fixed by its first call, so the factory makes that call itself; later getContext('2d') calls return the same context. The stage canvases stay on the GPU.
  // soft: false gives the plain canvases back (a page can pick for a measurement); node-canvas ignores the option.
  // Device pixel ratio changes after load (browser zoom, a window dragged to another monitor): `resize` fires for the first, a resolution media query for both. Sprites, layers and the stage
  // are sized from sprites.dpr, so it is set here before the callback resizes the canvases. Returns a function that stops watching. win: window (or a stand-in with devicePixelRatio and matchMedia).
  function watchDpr(win, onChange) {
    let cur = win.devicePixelRatio || 1, mq = null, off = null;
    const check = () => { const d = win.devicePixelRatio || 1; if (d !== cur) { cur = d; sprites.dpr = d; onChange(d); } arm(); };
    function arm() {
      if (off) { off(); off = null; }
      if (!win.matchMedia) return;
      mq = win.matchMedia('(resolution: ' + cur + 'dppx)');
      if (mq.addEventListener) { mq.addEventListener('change', check); off = () => mq.removeEventListener('change', check); }
    }
    sprites.dpr = cur; arm(); if (win.addEventListener) win.addEventListener('resize', check);
    return () => { if (off) off(); if (win.removeEventListener) win.removeEventListener('resize', check); };
  }
  function canvasFactory(doc, o) {
    const soft = !(o && o.soft === false);
    return function (w, h) { const c = doc.createElement('canvas'); c.width = w; c.height = h; if (soft) c.getContext('2d', { willReadFrequently: true }); return c; };
  }
  // round each colour channel of a canvas to a multiple of step (alpha untouched). Used once per sprite and per cached layer, never per frame.
  function quantise(cv, step) {
    const c = cv.getContext('2d'), d = c.getImageData(0, 0, cv.width, cv.height), a = d.data, k = 1 / step;
    for (let i = 0; i < a.length; i += 4) { a[i] = Math.min(255, Math.round(a[i] * k) * step); a[i + 1] = Math.min(255, Math.round(a[i + 1] * k) * step); a[i + 2] = Math.min(255, Math.round(a[i + 2] * k) * step); }
    c.putImageData(d, 0, 0);
  }
  // Sprites are built under a budget of count and of time (a build costs 0.3 ms in node and about 0.8 ms in a browser, so a count alone is the wrong unit).
  // Every frame may build at least one, so a view always makes progress.
  const clock = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const timeUp = () => sprites.builds > 0 && clock() - sprites.frameStart >= sprites.maxBuildMs;
  // Over the sprite memory cap (paperdolls#18): free the least recently drawn sprites, never one the current frame has drawn (sp.used === sprites.frame), and only as many as make room for the
  // sprite about to be built plus some headroom (down to 85% of the caps), so the cap is hit rarely and never empties the cache. Ties go to the sprite farthest in scale from the one wanted. If the
  // frame's own sprites do not fit, the cache is allowed to be over the cap for the frame: the cap is a memory guard, not a reason to rebuild what is on screen. (It used to drop everything more
  // than 2.7 times away in scale and, still over 80%, clear the whole cache, the sprites on screen included: a rebuild of the whole view, 60 a frame.)
  function evict(sbWanted, needPx) {
    const maxPx = sprites.maxPixels * 0.85 - (needPx || 0), maxN = sprites.limit * 0.85, frame = sprites.frame, old = [];
    for (const sp of sprites.cache.values()) if (sp.used !== frame) old.push(sp);
    old.sort((p, q) => (p.used || 0) - (q.used || 0) || Math.abs(Math.log(q.sb / sbWanted)) - Math.abs(Math.log(p.sb / sbWanted)));
    let freed = 0;
    for (const sp of old) {
      if (sprites.pixels <= maxPx && sprites.cache.size <= maxN) break;
      sprites.cache.delete(sp.key); sprites.pixels -= sp.px; freed++;
    }
    sprites.evictions += freed;
    sprites.index.clear(); sprites.shapes.clear();
    for (const sp of sprites.cache.values()) { addTo(sprites.index, sp.ikey, sp); addTo(sprites.shapes, sp.skey, sp); }
  }
  const lastOf = (holder, sb) => { if (!holder || holder._spk === undefined) return null; const h = sprites.cache.get(holder._spk); return h && Math.abs(Math.log(h.sb / sb)) <= 2.3 ? h : null; };
  function addTo(map, k, sp) { const held = map.get(k); if (held) held.push(sp); else map.set(k, [sp]); }
  // The held sprite nearest in scale to sb (within 2.3 octaves either way) among `list`, or null. Entries no longer in the cache (an outside clear) are skipped.
  function nearestHeld(list, sb) {
    let best = null, bd = Infinity;
    if (list) for (const h of list) { const r = Math.log(h.sb / sb), d = Math.abs(r); if (r >= -2.3 && r <= 2.3 && d < bd && sprites.cache.get(h.key) === h) { best = h; bd = d; } }
    return best;
  }
  // The keys of the sprite for an asset at sprite scale sb (device pixels per metre). key is exact; ikey leaves out the scale and the detail and ink
  // flags, so a sprite at a neighbouring scale can stand in for a missing one while the view is zooming.
  function keysFor(asset, colours, reg, sb) {
    let ck = colours._sk;   // the colour part is built once per colour set (a hidden property, so copies of a colour set do not inherit it)
    if (ck === undefined) { ck = Object.keys(colours).sort().map(k => colours[k] || '-').join(''); Object.defineProperty(colours, '_sk', { value: ck, enumerable: false, writable: true, configurable: true }); }
    const detail = sprites.detail && asset.group === 'buildings' && sb >= sprites.minDetail;                 // baked detail only where it can be seen
    const ink = sprites.ink && (asset.group === 'buildings' || asset.group === 'trees') && sb >= sprites.minDetail;   // heavy ink on the silhouette only, hairlines inside
    const pz = sprites.posterize ? '|p' + sprites.posterize : '', base = asset.id + '|' + asset.heading + '|' + reg.id;
    return { detail, ink, key: base + '|' + sb + '|' + ck + ((sprites.dpr || 1) !== 1 ? '|q' + sprites.dpr : '') + (detail ? (sprites.grain ? '|d' : '|D') : '') + (ink ? '|i' : '') + pz, ikey: base + '|' + ck + pz, skey: base + pz };       // skey: the shape alone, any colours
  }
  // Paint one sprite into the cache. scale is the css scale the ink width follows.
  function buildSprite(asset, colours, reg, sb, scale, kk) {
    const q = sprites.dpr || 1, bb = asset.bbox, m = 2, { detail, ink, key, ikey, skey } = kk;
    const w = Math.ceil((bb.maxX - bb.minX) * sb) + m * 2, h = Math.ceil((bb.maxY - bb.minY) * sb) + m * 2;
    if (sprites.cache.size > sprites.limit || sprites.pixels + w * h > sprites.maxPixels) evict(sb, w * h);
    sprites.pixels += w * h;
    const cv = sprites.factory(w, h), c = cv.getContext('2d');
    paint(c, asset, colours, reg, m - bb.minX * sb, m - bb.minY * sb, sb, Math.max(0.3, Math.min(1, scale / 10)) * (q > 1 ? q : 1) * (ink ? 0.5 : 1), detail);
    if (detail && sprites.grain) { c.save(); c.globalCompositeOperation = 'source-atop'; c.fillStyle = grainPattern(c); c.fillRect(0, 0, w, h); c.restore(); }
    if (ink) {
      const lw = Math.max(1, Math.round(reg.lw * Math.max(0.3, Math.min(1, scale / 10)) * (q > 1 ? q : 1) * 1.4)), tv = sprites.factory(w, h), t = tv.getContext('2d');
      t.drawImage(cv, 0, 0); t.globalCompositeOperation = 'source-in'; t.fillStyle = reg.ink; t.fillRect(0, 0, w, h);
      c.save(); c.globalCompositeOperation = 'destination-over';
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) c.drawImage(tv, dx * lw, dy * lw);
      c.restore();
    }
    if (sprites.posterize) quantise(cv, sprites.posterize);
    const sp = { cv, ox: m - bb.minX * sb, oy: m - bb.minY * sb, sb, key, ikey, skey, px: w * h, used: sprites.frame };
    sprites.cache.set(key, sp); addTo(sprites.index, ikey, sp); addTo(sprites.shapes, skey, sp);
    return sp;
  }
  // Pre-render and hold: while the view is still, build the sprites for the zoom levels either side of the current one (whole octaves, the same
  // ones a zoom draws), for the sprites seen in this frame, a few per frame. A zoom then finds them ready and only downscales. Returns how many it
  // built, so 0 means nothing is missing. sprites.collect is the map of sprites the frame drew (set by the renderer while this is wanted).
  // A build costs in proportion to its pixels: at 11 px per metre on a 2x screen the next level up is 64 device px per metre and one building sprite is over a
  // million pixels, 100 ms or more, and a frame always builds at least one. Pre-rendering skips anything over this many pixels.
  const PREWARM_MAX_PX = 500000;
  function prewarm(scale, budget, budgetMs) {
    if (!sprites.collect || !sprites.factory) return 0;
    const q = sprites.dpr || 1, lev = Math.pow(2, Math.ceil(Math.log2(Math.max(1, scale * q)))), levels = [lev, lev * 2, lev / 2].filter(l => l >= 1 && l <= 64);
    let n = 0; const t0 = clock();
    for (const [asset, colours, reg] of sprites.collect.values()) for (const L of levels) {
      const bb = asset.bbox; if ((Math.ceil((bb.maxX - bb.minX) * L) + 4) * (Math.ceil((bb.maxY - bb.minY) * L) + 4) > PREWARM_MAX_PX) continue;      // too big to build in the background
      const kk = keysFor(asset, colours, reg, L);
      if (sprites.cache.has(kk.key)) continue;
      if (n >= budget || (n > 0 && clock() - t0 >= budgetMs)) return n;
      buildSprite(asset, colours, reg, L, L / q, kk).warm = true; n++;
    }
    return n;
  }
  // sprites.staleOk is set by the renderer only around the one-by-one draw to the frame: a layer is cached, so what it paints must be exact.
  // holder (optional): the object that draws this sprite (a building). It remembers the key of the sprite it last drew (holder._spk), so when its colours or overlays change and the budget is
  // spent, its own previous picture stays on screen until the new one is built (paperdolls#18).
  function drawSprite(ctx, asset, colours, reg, px, py, scale, holder) {
    const lk = Math.max(0.3, Math.min(1, scale / 10));      // adaptive ink: full width from 10 px per metre up
    if (!sprites.factory) { paint(ctx, asset, colours, reg, px, py, scale, lk); return; }
    // sprites.exact: render at exactly the view's scale, so the blit is 1:1 (sharp, and several times cheaper than a resample).
    // The viewer sets it once the view has held still; while it is changing, whole octaves are used (sprites at 1, 2, 4, 8 ... px per metre,
    // always drawn at most 2 times smaller than built), so a zoom crosses one bucket per doubling instead of one every quarter pixel.
    const q = sprites.dpr || 1, sb = sprites.exact ? Math.max(1, scale * q) : Math.max(1, Math.pow(2, Math.ceil(Math.log2(scale * q))));
    const kk = keysFor(asset, colours, reg, sb);
    if (sprites.collect && sprites.exact) sprites.collect.set(kk.ikey, [asset, colours, reg]);
    let sp = sprites.cache.get(kk.key), sbUse = sb;
    // While the zoom is changing, a sprite that is missing at the new octave is drawn scaled from the nearest one already held, once this frame's
    // build budget is spent (maxZoomBuilds). Rebuilding every visible sprite at each new bucket stalled a zoom for 150 to 500 ms at a time. The
    // scaled blit is soft; the view sharpens (exact sprites, 150 builds a frame) once it stops. With nothing held to scale, a building or tree is
    // built, and decoration (people, vehicles) is left out for a few frames.
    if (!sp && sprites.zooming && !sprites.unbudgeted && (sprites.builds >= sprites.maxZoomBuilds || timeUp())) {
      const best = nearestHeld(sprites.index.get(kk.ikey), sb) || (sprites.staleOk ? lastOf(holder, sb) || nearestHeld(sprites.shapes.get(kk.skey), sb) : null);          // same colours first, else what this object drew last, else the same shape in other colours (paperdolls#18)
      if (best) { sp = best; sbUse = best.sb; }
      else if (asset.group === 'people' || asset.group === 'vehicles') return;
    }
    if (!sp && sprites.exact && !sprites.unbudgeted && (sprites.builds >= sprites.maxBuilds || timeUp())) {      // over this frame's budget: show a sprite already held and sharpen on a later frame
      // A colour change on a settled view has no sprite held under the new colours: the same shape in the old colours (or at the nearest scale) stands in until the exact one is built, a few
      // frames later, so the builds of a frame never exceed the budget (paperdolls#18; one model month that recoloured 400 buildings built 362 sprites in one frame).
      const stale = nearestHeld(sprites.index.get(kk.ikey), sb) || (sprites.staleOk ? lastOf(holder, sb) || nearestHeld(sprites.shapes.get(kk.skey), sb) : null);
      if (stale) { sp = stale; sbUse = stale.sb; }
    }
    if (!sp && sprites.exact && !sprites.unbudgeted && (sprites.builds >= sprites.maxBuilds || timeUp())) {      // nothing of this shape is held at all: the bucketed sprite is built, scaled from a neighbour if one appears
      const z = sprites.zooming; sprites.exact = false; sprites.zooming = true;       // scaled from a sprite already held, not built: the octave sprite is not there yet
      drawSprite(ctx, asset, colours, reg, px, py, scale, holder); sprites.exact = true; sprites.zooming = z; return;
    }
    if (!sp) { sprites.builds++; sp = buildSprite(asset, colours, reg, sb, scale, kk); }
    sp.used = sprites.frame;                                                          // drawn this frame: eviction leaves it alone
    if (holder) holder._spk = sp.key;
    const k = scale / sbUse;                                                         // sprite pixels to canvas units
    const dx = Math.round((px - sp.ox * k) * q) / q, dy = Math.round((py - sp.oy * k) * q) / q;   // whole device pixels: no sub-pixel filtering
    if (q === 1 && Math.abs(k - 1) < 1e-9) ctx.drawImage(sp.cv, dx, dy);                        // 1:1: no resampling at all
    else ctx.drawImage(sp.cv, dx, dy, Math.round(sp.cv.width * k * q) / q, Math.round(sp.cv.height * k * q) / q);
  }

  // ---------- occlusion support ----------
  // What an already cached sprite shows, so a renderer can tell whether it would be fully hidden. Only the exact-scale sprite is used
  // (sprites.exact), because it is blitted 1:1 on whole device pixels and the mask then matches the blit pixel for pixel.
  //   touch: per row, the first and last pixel with any alpha, widened by one pixel each way. Everything the blit can change.
  //   rects: a few rectangles that are fully opaque (alpha 255), flat [x0, y0, x1, y1). Only opaque pixels can hide something, and a
  //          handful of rectangles is far cheaper to record in a coverage grid than every opaque run.
  function buildSpriteMask(sp) {
    const w = sp.cv.width, h = sp.cv.height, d = sp.cv.getContext('2d').getImageData(0, 0, w, h).data;
    const a0 = new Int32Array(h).fill(-1), a1 = new Int32Array(h).fill(-1), r0 = new Int32Array(h).fill(-1), r1 = new Int32Array(h).fill(-1);
    for (let y = 0; y < h; y++) {
      let lo = -1, hi = -1, start = -1, best = 0;
      for (let x = 0, i = (y * w) * 4 + 3; x <= w; x++, i += 4) {
        const a = x < w ? d[i] : 0;
        if (a) { if (lo < 0) lo = x; hi = x; }
        if (a === 255) { if (start < 0) start = x; } else if (start >= 0) { if (x - start > best) { best = x - start; r0[y] = start; r1[y] = x; } start = -1; }
      }
      a0[y] = lo; a1[y] = hi;
    }
    const t0 = new Int32Array(h).fill(-1), t1 = new Int32Array(h).fill(-1);
    let ry0 = h, ry1 = -1;
    for (let y = 0; y < h; y++) {
      let lo = 1e9, hi = -1;
      for (let k = Math.max(0, y - 1); k <= Math.min(h - 1, y + 1); k++) if (a0[k] >= 0) { lo = Math.min(lo, a0[k]); hi = Math.max(hi, a1[k]); }
      if (hi >= 0) { t0[y] = lo - 1; t1[y] = hi + 1; ry0 = Math.min(ry0, y); ry1 = Math.max(ry1, y); }
    }
    // Rectangles from each row's longest opaque run: grow a rectangle downward while the shared span stays at least 70% as wide.
    const rects = [];
    for (let y = 0; y < h;) {
      if (r0[y] < 0) { y++; continue; }
      let a = r0[y], b = r1[y], e = y + 1;
      while (e < h && r0[e] >= 0) { const na = Math.max(a, r0[e]), nb = Math.min(b, r1[e]); if (nb - na < 0.7 * (b - a)) break; a = na; b = nb; e++; }
      if (b - a >= 8 && e - y >= 8) rects.push(a, y, b, e);
      y = e;
    }
    return { w, h, t0, t1, ry0, ry1, rects: Int32Array.from(rects) };
  }
  // Where drawSprite would put this sprite, in device pixels, plus its mask. Returns null when occlusion cannot be trusted for it:
  // the sprite is not cached yet, or the view is not at the exact scale.
  function spritePlacement(asset, colours, reg, px, py, scale) {
    if (!sprites.factory || !sprites.exact) return null;
    const q = sprites.dpr || 1; if (scale * q < 1) return null;
    const sb = Math.max(1, scale * q), ck = colours._sk;
    if (ck === undefined) return null;                                   // never drawn yet
    const sp = sprites.cache.get(asset.id + '|' + asset.heading + '|' + reg.id + '|' + sb + '|' + ck + (q !== 1 ? '|q' + q : ''));
    if (!sp) return null;
    return { mask: sp.mask || (sp.mask = buildSpriteMask(sp)), x: Math.round(px * q - sp.ox), y: Math.round(py * q - sp.oy) };
  }

  // ---------- vehicles ----------
  const DEFS = { vehicles: {}, people: {} };
  function addVehicle(id, label, network, parts, extra) { DEFS.vehicles[id] = Object.assign({ id: 'v:' + id, kind: id, group: 'vehicles', label, network, parts, rider: null }, extra || {}); }

  function wheelParts(xs, r, hw, hub) {
    const out = [];
    for (const x of xs) {
      out.push({ t: 'disc', side: 'both', y: hw + 0.01, c: [x, r], r, role: 'wheel', n: 16 });
      out.push({ t: 'disc', side: 'both', y: hw + 0.02, c: [x, r], r: r * (hub || 0.42), role: 'hub', n: 10, bias: 0.4 });
    }
    return out;
  }
  function lights(hl, hw, z, rear) {
    return [-1, 1].map(s => ({ t: 'end', end: 1, x: hl + 0.005, poly: [[s * hw * 0.78 - 0.14, z - 0.06], [s * hw * 0.78 + 0.14, z - 0.06], [s * hw * 0.78 + 0.14, z + 0.06], [s * hw * 0.78 - 0.14, z + 0.06]], role: 'light', lw: 0.7 }));
  }
  function pillars(xs, hw, zb, zr) { return xs.map(x => ({ t: 'flat', side: 'both', y: hw + 0.012, poly: [[x - 0.05, zb + 0.02], [x + 0.05, zb + 0.02], [x + 0.035, zr - 0.03], [x - 0.035, zr - 0.03]], role: 'data', ink: false, bias: 0.45 })); }

  function carLike(o) {
    const hl = o.len / 2, hw = o.wid / 2, z0 = o.z0, zb = o.zb, zr = o.zr, nose = zb - (o.noseDrop === undefined ? 0.2 : o.noseDrop);
    const parts = [
      { t: 'prism', y: [-hw, hw], role: 'data', prof: [[-hl, z0], [hl, z0], [hl, nose], [o.ws0, zb], [o.rr0, zb], [-hl, zb - (o.tailDrop === undefined ? 0.08 : o.tailDrop)]] },
      { t: 'prism', y: [-hw * 0.92, hw * 0.92], role: 'glass', topRole: 'data', layer: 1, prof: [[o.rr0, zb], [o.ws0, zb], [o.ws1, zr], [o.rr1, zr]] }
    ];
    return parts.concat(pillars(o.pillars || [(o.ws0 + o.rr0) / 2], hw * 0.92, zb, zr), lights(hl, hw, nose - 0.12), wheelParts(o.wheels, o.r, hw));
  }

  addVehicle('bicycle', 'Bicycle', 'cycle', [
    { t: 'flat', side: 0, poly: [[-0.52, 0.34], [-0.08, 0.40], [-0.12, 0.43], [-0.56, 0.37]], role: 'frame', bias: 0 },
    { t: 'flat', side: 0, poly: [[-0.08, 0.40], [0.24, 0.80], [0.19, 0.81], [-0.12, 0.43]], role: 'frame', bias: 0 },
    { t: 'flat', side: 0, poly: [[0.22, 0.80], [0.54, 0.34], [0.58, 0.37], [0.27, 0.83]], role: 'frame', bias: 0 },
    { t: 'flat', side: 0, poly: [[-0.18, 0.86], [0.08, 0.86], [0.08, 0.9], [-0.18, 0.9]], role: 'trim', bias: 0 },
    { t: 'flat', side: 0, poly: [[0.2, 0.84], [0.34, 0.84], [0.34, 0.98], [0.3, 0.98], [0.3, 0.88], [0.2, 0.88]], role: 'frame', bias: 0 },
    { t: 'disc', side: 0, y: 0, c: [-0.55, 0.34], r: 0.34, role: 'wheel', n: 16, bias: 0 },
    { t: 'disc', side: 0, y: 0, c: [-0.55, 0.34], r: 0.27, role: 'trim', n: 16, bias: 0.05 },
    { t: 'disc', side: 0, y: 0, c: [0.55, 0.34], r: 0.34, role: 'wheel', n: 16, bias: 0 },
    { t: 'disc', side: 0, y: 0, c: [0.55, 0.34], r: 0.27, role: 'trim', n: 16, bias: 0.05 },
    { t: 'box', b: [-0.92, -0.17, 0.5, -0.42, 0.17, 0.86], role: 'data', layer: 6 }
  ], { rider: 'cyclist' });

  addVehicle('cargo_bike', 'Cargo bike', 'cycle', [
    { t: 'flat', side: 0, poly: [[-0.8, 0.34], [0.2, 0.42], [0.2, 0.46], [-0.8, 0.38]], role: 'frame', bias: 0 },
    { t: 'flat', side: 0, poly: [[-0.5, 0.4], [-0.3, 0.86], [-0.35, 0.86], [-0.55, 0.4]], role: 'frame', bias: 0 },
    { t: 'flat', side: 0, poly: [[1.38, 0.34], [1.34, 0.98], [1.28, 0.98], [1.34, 0.34]], role: 'frame', bias: 0 },
    { t: 'flat', side: 0, poly: [[1.2, 0.98], [1.46, 0.98], [1.46, 1.04], [1.2, 1.04]], role: 'frame', bias: 0 },
    { t: 'flat', side: 0, poly: [[-0.5, 0.9], [-0.2, 0.9], [-0.2, 0.95], [-0.5, 0.95]], role: 'trim', bias: 0 },
    { t: 'disc', side: 0, y: 0, c: [-0.85, 0.34], r: 0.34, role: 'wheel', n: 16, bias: 0 },
    { t: 'disc', side: 0, y: 0, c: [-0.85, 0.34], r: 0.27, role: 'trim', n: 16, bias: 0.05 },
    { t: 'disc', side: 0, y: 0, c: [1.36, 0.3], r: 0.3, role: 'wheel', n: 16, bias: 0 },
    { t: 'disc', side: 0, y: 0, c: [1.36, 0.3], r: 0.23, role: 'trim', n: 16, bias: 0.05 },
    { t: 'prism', y: [-0.42, 0.42], role: 'data', topRole: 'trim', layer: 6, prof: [[0.2, 0.36], [1.12, 0.36], [1.12, 1.0], [0.2, 1.0]] }
  ], { rider: 'cyclist' });

  addVehicle('moped', 'Moped / scooter', 'road', [
    { t: 'prism', y: [-0.14, 0.14], role: 'data', prof: [[-0.55, 0.32], [0.38, 0.32], [0.5, 0.95], [0.34, 0.98], [0.2, 0.58], [-0.1, 0.5], [-0.52, 0.6]] },
    { t: 'prism', y: [-0.1, 0.1], role: 'trim', prof: [[-0.5, 0.6], [0.0, 0.58], [0.0, 0.7], [-0.5, 0.72]], bias: 0.1 },
    { t: 'box', b: [0.36, -0.28, 1.0, 0.48, 0.28, 1.06], role: 'frame' },
    { t: 'end', end: 1, x: 0.51, poly: [[-0.09, 0.82], [0.09, 0.82], [0.09, 0.92], [-0.09, 0.92]], role: 'light', lw: 0.7 }
  ].concat(wheelParts([-0.52, 0.52], 0.25, 0.1)), { rider: 'cyclist', riderLift: -0.18 });

  addVehicle('motorbike', 'Motorbike', 'road', [
    { t: 'prism', y: [-0.12, 0.12], role: 'frame', prof: [[-0.5, 0.35], [0.4, 0.35], [0.3, 0.7], [-0.45, 0.7]] },
    { t: 'prism', y: [-0.16, 0.16], role: 'data', prof: [[-0.1, 0.68], [0.42, 0.68], [0.4, 0.98], [-0.12, 0.92]], bias: 0.1 },
    { t: 'prism', y: [-0.1, 0.1], role: 'trim', prof: [[-0.62, 0.7], [-0.1, 0.7], [-0.1, 0.84], [-0.62, 0.8]], bias: 0.1 },
    { t: 'box', b: [0.5, -0.3, 1.02, 0.6, 0.3, 1.07], role: 'frame' },
    { t: 'flat', side: 0, poly: [[0.36, 0.7], [0.62, 0.34], [0.66, 0.37], [0.4, 0.74]], role: 'frame', bias: 0 }
  ].concat(wheelParts([-0.7, 0.68], 0.32, 0.06)), { rider: 'cyclist', riderLift: -0.1 });

  addVehicle('three_wheeler', 'Three-wheeler taxi (tuk-tuk)', 'road', [
    { t: 'prism', y: [-0.7, 0.7], role: 'data', prof: [[-1.15, 0.36], [0.35, 0.36], [0.35, 1.05], [-1.15, 1.05]] },
    { t: 'prism', y: [-0.36, 0.36], role: 'data', prof: [[0.3, 0.36], [1.2, 0.36], [1.2, 0.78], [0.85, 1.0], [0.3, 1.05]], bias: 0.05 },
    { t: 'box', b: [-1.2, -0.76, 1.6, 0.4, 0.76, 1.68], role: 'roof' },
    { t: 'flat', side: 'both', y: 0.71, poly: [[-1.1, 1.08], [0.3, 1.08], [0.3, 1.58], [-1.1, 1.58]], role: 'interior', ink: false, bias: 0.25 },
    { t: 'end', end: 1, x: 0.41, poly: [[-0.7, 1.05], [0.7, 1.05], [0.7, 1.58], [-0.7, 1.58]], role: 'glass', bias: 0.2 },
    { t: 'end', end: 1, x: 1.21, poly: [[-0.15, 0.55], [0.15, 0.55], [0.15, 0.68], [-0.15, 0.68]], role: 'light', lw: 0.7 },
    { t: 'disc', side: 0, y: 0, c: [1.05, 0.28], r: 0.28, role: 'wheel', n: 14, layer: -2 },
    { t: 'disc', side: 0, y: 0, c: [1.05, 0.28], r: 0.12, role: 'hub', n: 10, layer: -1 }
  ].concat(wheelParts([-0.7], 0.28, 0.7)));

  addVehicle('utility_three_wheeler', 'Three-wheeler utility', 'road', [
    { t: 'prism', y: [-0.52, 0.52], role: 'data', prof: [[-0.1, 0.34], [1.15, 0.34], [1.15, 0.8], [0.85, 1.0], [0.55, 1.5], [-0.1, 1.5]] },
    { t: 'flat', side: 'both', y: 0.53, poly: [[0.15, 1.0], [0.55, 1.0], [0.5, 1.42], [0.15, 1.42]], role: 'glass', bias: 0.3 },
    { t: 'prism', y: [-0.62, 0.62], role: 'data', topRole: 'trim', prof: [[-1.35, 0.5], [-0.1, 0.5], [-0.1, 0.98], [-1.35, 0.98]], bias: 0.05 },
    { t: 'end', end: 1, x: 1.16, poly: [[-0.12, 0.55], [0.12, 0.55], [0.12, 0.66], [-0.12, 0.66]], role: 'light', lw: 0.7 },
    { t: 'disc', side: 0, y: 0, c: [0.95, 0.26], r: 0.26, role: 'wheel', n: 14, layer: -2 },
    { t: 'disc', side: 0, y: 0, c: [0.95, 0.26], r: 0.11, role: 'hub', n: 10, layer: -1 }
  ].concat(wheelParts([-0.85], 0.26, 0.62)));

  addVehicle('city_car', 'City car', 'road', carLike({ len: 3.7, wid: 1.62, z0: 0.22, zb: 0.85, zr: 1.5, ws0: 0.7, ws1: 0.3, rr0: -1.7, rr1: -1.3, wheels: [-1.15, 1.15], r: 0.29, pillars: [-0.5, 0.0] }));
  addVehicle('hatchback', 'Hatchback', 'road', carLike({ len: 4.2, wid: 1.76, z0: 0.24, zb: 0.88, zr: 1.48, ws0: 0.85, ws1: 0.4, rr0: -1.9, rr1: -1.45, wheels: [-1.3, 1.3], r: 0.31, pillars: [-0.7, 0.05] }));
  addVehicle('sedan', 'Saloon', 'road', carLike({ len: 4.6, wid: 1.8, z0: 0.24, zb: 0.88, zr: 1.45, ws0: 0.95, ws1: 0.45, rr0: -1.25, rr1: -0.85, wheels: [-1.4, 1.4], r: 0.32, pillars: [-0.45], tailDrop: 0.02 }));
  addVehicle('suv', 'SUV', 'road', carLike({ len: 4.7, wid: 1.92, z0: 0.3, zb: 1.0, zr: 1.75, ws0: 0.95, ws1: 0.5, rr0: -2.2, rr1: -2.12, wheels: [-1.4, 1.4], r: 0.38, pillars: [-0.9, 0.0], noseDrop: 0.22 }));

  addVehicle('pickup', 'Pickup', 'road', [
    { t: 'prism', y: [-0.97, 0.97], role: 'data', prof: [[-0.2, 0.3], [2.5, 0.3], [2.5, 0.85], [1.0, 1.0], [-0.2, 1.0]] },
    { t: 'prism', y: [-0.9, 0.9], role: 'glass', topRole: 'data', prof: [[-0.2, 1.0], [1.0, 1.0], [0.6, 1.72], [-0.2, 1.72]] },
    { t: 'prism', y: [-0.97, 0.97], role: 'data', topRole: 'trim', prof: [[-2.6, 0.3], [-0.2, 0.3], [-0.2, 1.0], [-2.6, 1.0]], bias: -0.1 }
  ].concat(pillars([0.2], 0.9, 1.0, 1.72), lights(2.5, 0.97, 0.7), wheelParts([-1.7, 1.55], 0.38, 0.97)));

  addVehicle('van', 'Delivery van', 'road', [
    { t: 'prism', y: [-0.97, 0.97], role: 'data', prof: [[-2.45, 0.3], [2.45, 0.3], [2.45, 0.95], [1.6, 1.08], [1.05, 2.0], [-2.45, 2.0]], edgeRole: 'data' },
    { t: 'flat', side: 'both', y: 0.98, poly: [[1.12, 1.2], [1.62, 1.2], [1.28, 1.9], [1.12, 1.9]], role: 'glass', bias: 0.3 },
    { t: 'flat', side: 'both', y: 0.98, poly: [[-2.4, 0.95], [1.0, 0.95], [1.0, 1.0], [-2.4, 1.0]], role: 'trim', ink: false, bias: 0.3 },
    { t: 'end', end: 1, x: 2.455, poly: [[-0.75, 0.86], [0.75, 0.86], [0.75, 0.74], [-0.75, 0.74]], role: 'trim', lw: 0.7 }
  ].concat(lights(2.45, 0.97, 0.78), wheelParts([-1.5, 1.55], 0.36, 0.97)));

  addVehicle('van_coop', 'Co-op van', 'road', [
    { t: 'prism', y: [-0.97, 0.97], role: 'data', prof: [[-2.45, 0.3], [2.45, 0.3], [2.45, 0.95], [1.6, 1.08], [1.05, 2.0], [-2.45, 2.0]], edgeRole: 'data' },
    { t: 'flat', side: 'both', y: 0.98, poly: [[1.12, 1.2], [1.62, 1.2], [1.28, 1.9], [1.12, 1.9]], role: 'glass', bias: 0.3 },
    { t: 'flat', side: 'both', y: 0.98, poly: [[-2.2, 1.0], [0.8, 1.0], [0.8, 1.2], [-2.2, 1.2]], role: 'trim', bias: 0.3 },
    { t: 'flat', side: 'both', y: 0.98, poly: [[-2.0, 1.35], [-0.9, 1.35], [-0.9, 1.7], [-2.0, 1.7]], role: 'trim', bias: 0.3 }
  ].concat(lights(2.45, 0.97, 0.78), wheelParts([-1.5, 1.55], 0.36, 0.97)), { coop: true });

  addVehicle('kei_van', 'Small box van', 'road', [
    { t: 'prism', y: [-0.74, 0.74], role: 'data', prof: [[-1.7, 0.25], [1.7, 0.25], [1.7, 0.9], [1.15, 1.0], [0.85, 1.75], [-1.7, 1.75]], edgeRole: 'data' },
    { t: 'flat', side: 'both', y: 0.75, poly: [[0.9, 1.1], [1.2, 1.1], [0.98, 1.65], [0.9, 1.65]], role: 'glass', bias: 0.3 }
  ].concat(lights(1.7, 0.74, 0.7), wheelParts([-1.05, 1.05], 0.27, 0.74)));

  function windowBand(x0, x1, step, w, z0, z1, hw) { const out = []; for (let x = x0; x + w <= x1; x += step) out.push({ t: 'flat', side: 'both', y: hw + 0.012, poly: [[x, z0], [x + w, z0], [x + w, z1], [x, z1]], role: 'glass', bias: 0.3 }); return out; }

  addVehicle('minibus', 'Minibus (shared taxi)', 'road', [
    { t: 'prism', y: [-1.0, 1.0], role: 'data', prof: [[-2.9, 0.35], [2.9, 0.35], [2.9, 1.2], [2.4, 1.3], [2.1, 2.3], [-2.9, 2.3]], edgeRole: 'data' }
  ].concat(windowBand(-2.6, 2.0, 0.95, 0.75, 1.35, 2.0, 1.0), lights(2.9, 1.0, 0.9), wheelParts([-1.9, 1.8], 0.4, 1.0)));

  addVehicle('bus', 'Bus', 'road', [
    { t: 'box', b: [-5.5, -1.25, 0.45, 5.5, 1.25, 3.1], role: 'data' },
    { t: 'end', end: 1, x: 5.505, poly: [[-1.1, 1.6], [1.1, 1.6], [1.1, 2.8], [-1.1, 2.8]], role: 'glass', bias: 0.3 },
    { t: 'flat', side: 'both', y: 1.26, poly: [[-5.5, 0.45], [5.5, 0.45], [5.5, 0.8], [-5.5, 0.8]], role: 'trim', bias: 0.3 },
    { t: 'flat', side: 'both', y: 1.26, poly: [[4.0, 0.9], [5.0, 0.9], [5.0, 2.6], [4.0, 2.6]], role: 'interior', bias: 0.3 }
  ].concat(windowBand(-4.9, 3.8, 1.45, 1.15, 1.5, 2.7, 1.25), wheelParts([-3.6, 3.3], 0.5, 1.25)));

  addVehicle('double_decker', 'Double-decker bus', 'road', [
    { t: 'box', b: [-5.0, -1.28, 0.45, 5.0, 1.28, 4.35], role: 'data' },
    { t: 'end', end: 1, x: 5.005, poly: [[-1.1, 1.6], [1.1, 1.6], [1.1, 2.6], [-1.1, 2.6]], role: 'glass', bias: 0.3 },
    { t: 'end', end: 1, x: 5.005, poly: [[-1.1, 3.1], [1.1, 3.1], [1.1, 4.05], [-1.1, 4.05]], role: 'glass', bias: 0.3 },
    { t: 'flat', side: 'both', y: 1.29, poly: [[-5.0, 0.45], [5.0, 0.45], [5.0, 0.8], [-5.0, 0.8]], role: 'trim', bias: 0.3 }
  ].concat(windowBand(-4.5, 4.9, 1.3, 1.05, 1.3, 2.3, 1.28), windowBand(-4.5, 4.9, 1.3, 1.05, 3.0, 4.0, 1.28), wheelParts([-3.2, 3.0], 0.5, 1.28)));

  addVehicle('tram', 'Tram', 'rail', [
    { t: 'box', b: [-8.0, -1.3, 0.55, 8.0, 1.3, 3.4], role: 'data', topRole: 'trim' },
    { t: 'box', b: [-8.0, -1.3, 0.3, 8.0, 1.3, 0.62], role: 'frame', bias: -0.05 },
    { t: 'end', end: 1, x: 8.005, poly: [[-1.2, 1.5], [1.2, 1.5], [1.2, 3.0], [-1.2, 3.0]], role: 'glass', bias: 0.3 },
    { t: 'flat', side: 'both', y: 1.31, poly: [[-8.0, 0.62], [8.0, 0.62], [8.0, 0.95], [-8.0, 0.95]], role: 'trim', bias: 0.3 },
    { t: 'box', b: [-0.6, -0.5, 3.4, 0.6, 0.5, 3.75], role: 'frame', bias: 0.2 }
  ].concat(windowBand(-7.5, 7.6, 1.55, 1.2, 1.4, 2.8, 1.3)));

  addVehicle('lorry', 'Lorry', 'road', [
    { t: 'box', b: [-4.8, -1.22, 0.7, 0.9, 1.22, 3.3], role: 'data', topRole: 'trim' },
    { t: 'box', b: [-4.8, -1.0, 0.45, 3.3, 1.0, 0.7], role: 'frame', bias: -0.1 },
    { t: 'prism', y: [-1.15, 1.15], role: 'cab', topRole: 'cab', prof: [[1.0, 0.5], [3.3, 0.5], [3.3, 1.9], [2.9, 2.75], [1.0, 2.75]] },
    { t: 'flat', side: 'both', y: 1.16, poly: [[2.0, 1.5], [2.85, 1.5], [2.7, 2.5], [2.0, 2.5]], role: 'glass', bias: 0.3 },
    { t: 'end', end: 1, x: 3.305, poly: [[-0.9, 1.0], [0.9, 1.0], [0.9, 1.5], [-0.9, 1.5]], role: 'trim', bias: 0.3 }
  ].concat(wheelParts([-3.6, -2.4, 2.3], 0.55, 1.1)));

  // ---------- people: paper dolls ----------
  // A doll is a set of flat polygons in the (u,z) plane facing the direction of travel. Head and limbs share one
  // paper tone (no skin tones). The garment is the data surface.
  const BASE = {
    man:   { sw: 0.24, sz: 1.5, ww: 0.19, wz: 0.92, hz: 1.66, hr: 0.115, dress: false },
    woman: { sw: 0.2, sz: 1.42, ww: 0.14, wz: 0.64, hem: 0.34, hz: 1.56, hr: 0.105, dress: true }
  };
  const KINDS = {
    man: { base: 'man', s: 1 }, woman: { base: 'woman', s: 1 },
    boy: { base: 'man', s: 0.64, headK: 1.28 }, girl: { base: 'woman', s: 0.66, headK: 1.28 }
  };

  function arm(S, H, w0, w1) {
    const dx = H[0] - S[0], dz = H[1] - S[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
    return [[S[0] + nx * w0 / 2, S[1] + nz * w0 / 2], [H[0] + nx * w1 / 2, H[1] + nz * w1 / 2], [H[0] - nx * w1 / 2, H[1] - nz * w1 / 2], [S[0] - nx * w0 / 2, S[1] - nz * w0 / 2]];
  }

  // Parts for one doll. r(role) adds the member suffix so group members can carry different colours.
  function dollParts(kind, u0, flags, r, o) {
    o = o || {};
    const K = KINDS[kind], b = BASE[K.base], s = K.s, hk = K.headK || 1, zOff = o.zOff || 0;
    const U = u => u0 + u * s, Z = z => z * s + zOff;
    const parts = [], poly = (pts, role, lw) => ({ t: 'end', end: 0, x: 0, poly: pts.map(q => [U(q[0]), Z(q[1])]), role: r(role), bias: parts.length * 0.0001, lw: lw || 0.8 });
    const sw = b.sw, sz = b.sz;
    const handL = (o.hands && o.hands.L) ? [(o.hands.L[0] - u0) / s, (o.hands.L[1] - zOff) / s] : [-sw - 0.4, sz - 0.4];
    const handR = (o.hands && o.hands.R) ? [(o.hands.R[0] - u0) / s, (o.hands.R[1] - zOff) / s] : [sw + 0.4, sz - 0.4];
    const sleeve = flags.coat ? 'data' : 'paper'; // coat sleeves are part of the garment, so part of the data surface
    parts.push(poly(arm([-sw + 0.02, sz - 0.05], handL, 0.1, 0.07), sleeve));
    parts.push(poly(arm([sw - 0.02, sz - 0.05], handR, 0.1, 0.07), sleeve));
    // legs
    if (b.dress) {
      parts.push(poly([[-0.12, b.wz], [-0.02, b.wz], [-0.03, 0], [-0.1, 0]], 'paper'));
      parts.push(poly([[0.02, b.wz], [0.12, b.wz], [0.1, 0], [0.03, 0]], 'paper'));
    } else {
      const wz = flags.coat ? 0.6 : b.wz;
      parts.push(poly([[-b.ww, wz], [-0.012, wz], [-0.04, 0], [-b.ww - 0.01, 0]], 'bottom'));
      parts.push(poly([[0.012, wz], [b.ww, wz], [b.ww + 0.01, 0], [0.04, 0]], 'bottom'));
    }
    // garment (data surface)
    if (b.dress) parts.push(poly([[-sw, sz], [sw, sz], [b.hem, b.wz], [-b.hem, b.wz]], 'data'));
    else if (flags.coat) parts.push(poly([[-sw, sz], [sw, sz], [b.ww + 0.07, 0.6], [-b.ww - 0.07, 0.6]], 'data'));
    else parts.push(poly([[-sw, sz], [sw, sz], [b.ww, b.wz], [-b.ww, b.wz]], 'data'));
    if (flags.scarf) parts.push(poly([[-0.1, sz + 0.05], [0.1, sz + 0.05], [0.1, sz - 0.04], [-0.1, sz - 0.04]], 'accent'));
    // head
    const hr = b.hr * hk;
    parts.push({ t: 'end', end: 0, x: 0, poly: circle(U(0), Z(b.hz) + (hk > 1 ? 0.02 : 0), hr * s, 16), role: r('paper'), bias: parts.length * 0.0001, lw: 0.8 });
    const hzz = Z(b.hz) + (hk > 1 ? 0.02 : 0), hrr = hr * s;
    if (flags.hat) {
      const dome = [[U(0) - hrr * 1.05, hzz + hrr * 0.3], [U(0) - hrr * 0.8, hzz + hrr * 0.95], [U(0), hzz + hrr * 1.25], [U(0) + hrr * 0.8, hzz + hrr * 0.95], [U(0) + hrr * 1.05, hzz + hrr * 0.3]];
      parts.push({ t: 'end', end: 0, x: 0, poly: dome, role: r('hat'), bias: parts.length * 0.0001, lw: 0.8 });
      if (flags.hat === 'sunhat') parts.push({ t: 'end', end: 0, x: 0, poly: [[U(0) - hrr * 2.2, hzz + hrr * 0.45], [U(0) + hrr * 2.2, hzz + hrr * 0.45], [U(0) + hrr * 1.1, hzz + hrr * 0.8], [U(0) - hrr * 1.1, hzz + hrr * 0.8]], role: r('hat'), bias: parts.length * 0.0001, lw: 0.8 });
    }
    if (flags.bag) parts.push(poly([[-sw - 0.06, 0.86], [-sw + 0.1, 0.86], [-sw + 0.1, 0.62], [-sw - 0.06, 0.62]], 'accent'));
    if (flags.umbrella) {
      const hx = handR[0], top = b.hz + b.hr + 0.3;
      parts.push(poly([[hx - 0.015, handR[1]], [hx + 0.015, handR[1]], [hx + 0.015, top], [hx - 0.015, top]], 'frame', 0.6));
      parts.push(poly(halfEllipse(hx, top, 0.55, 0.3, 14), 'accent'));
    }
    return parts;
  }

  function addPerson(id, label, members, extra) {
    DEFS.people[id] = Object.assign({ id: 'p:' + id, kind: id, group: 'people', label, members, network: 'pavement', sort: false }, extra || {});
  }
  addPerson('man', 'Man', [{ kind: 'man', u: 0 }]);
  addPerson('woman', 'Woman', [{ kind: 'woman', u: 0 }]);
  addPerson('boy', 'Boy', [{ kind: 'boy', u: 0 }]);
  addPerson('girl', 'Girl', [{ kind: 'girl', u: 0 }]);
  addPerson('couple', 'Couple', [{ kind: 'man', u: -0.46, hands: { R: [0.0, 1.0] } }, { kind: 'woman', u: 0.46, hands: { L: [0.0, 1.0] } }]);
  addPerson('parent_child', 'Parent and child', [{ kind: 'girl', u: -0.62, hands: { R: [-0.27, 0.78] } }, { kind: 'woman', u: 0.2, hands: { L: [-0.27, 0.78] } }]);
  addPerson('family', 'Family of four', [
    { kind: 'girl', u: -1.3, hands: { R: [-0.92, 0.8] } },
    { kind: 'man', u: -0.46, hands: { L: [-0.92, 0.8], R: [0.0, 1.05] } },
    { kind: 'woman', u: 0.46, hands: { L: [0.0, 1.05], R: [0.9, 0.82] } },
    { kind: 'boy', u: 1.3, hands: { L: [0.9, 0.82] } }
  ]);
  // wheelchair user: seated doll on a chair (wheels seen edge-on from the front)
  addPerson('wheelchair', 'Wheelchair user', [{ kind: 'man', u: 0, seated: true }]);
  // rider: doll on a two-wheeler, front view, legs at the pedals
  addPerson('cyclist', 'Rider', [{ kind: 'man', u: 0, rider: true }], { network: 'cycle' });

  function peopleDef(kind, flagSets) {
    const d = DEFS.people[kind];
    let parts = [];
    d.members.forEach((m, i) => {
      const suffix = i ? '@' + i : '';
      const r = role => role + suffix;
      const flags = flagSets[i] || {};
      if (m.seated) {
        parts.push({ t: 'end', end: 0, x: 0, poly: [[-0.34, 0], [-0.28, 0], [-0.28, 0.62], [-0.34, 0.62]], role: 'frame', bias: 0 });
        parts.push({ t: 'end', end: 0, x: 0, poly: [[0.28, 0], [0.34, 0], [0.34, 0.62], [0.28, 0.62]], role: 'frame', bias: 0.0001 });
        parts.push({ t: 'end', end: 0, x: 0, poly: [[-0.3, 0.48], [0.3, 0.48], [0.3, 0.56], [-0.3, 0.56]], role: 'frame', bias: 0.0002 });
        const all = dollParts(m.kind, 0, flags, r, { zOff: -0.46 }).filter(p => p.role.indexOf('bottom') !== 0);
        parts = parts.concat(all);
        parts.push({ t: 'end', end: 0, x: 0, poly: [[-0.17, 0.5], [-0.01, 0.5], [-0.02, 0.2], [-0.16, 0.2]], role: r('bottom'), bias: 0.0003 });
        parts.push({ t: 'end', end: 0, x: 0, poly: [[0.01, 0.5], [0.17, 0.5], [0.16, 0.2], [0.02, 0.2]], role: r('bottom'), bias: 0.0003 });
      } else if (m.rider) {
        const hands = { L: [-0.36, 1.02], R: [0.36, 1.02] };
        const ps = dollParts(m.kind, 0, flags, r, { zOff: 0.0, hands }).filter(p => p.role.indexOf('bottom') !== 0);
        parts = parts.concat(ps);
        parts.push({ t: 'end', end: 0, x: 0, poly: [[-0.19, 0.92], [-0.02, 0.92], [-0.1, 0.3], [-0.22, 0.3]], role: r('bottom'), bias: 0.0003 });
        parts.push({ t: 'end', end: 0, x: 0, poly: [[0.02, 0.92], [0.19, 0.92], [0.22, 0.3], [0.1, 0.3]], role: r('bottom'), bias: 0.0003 });
      } else {
        parts = parts.concat(dollParts(m.kind, m.u, flags, r, { hands: m.hands }));
      }
    });
    return { id: d.id + '|' + JSON.stringify(flagSets), kind: kind, group: 'people', parts, sort: false };
  }

  // ---------- registry and access ----------
  const built = new Map(), groupDefs = new Map(), GROUPS = {};
  // registerGroup('buildings', (kind, extra) => ({ parts, ... })): extra is a plain object, part of the cache key
  function registerGroup(name, factory) { GROUPS[name] = factory; }
  function getAsset(group, kind, heading, flagSets) {
    heading = ((heading % 4) + 4) % 4;
    if (group === 'vehicles') {
      const k = 'v:' + kind + ':' + heading;
      let a = built.get(k);
      if (!a) { const d = DEFS.vehicles[kind]; if (!d) throw new Error('unknown vehicle ' + kind); a = buildAsset(d, heading); built.set(k, a); }
      return a;
    }
    if (group !== 'people') {
      const gf = GROUPS[group]; if (!gf) throw new Error('unknown asset group ' + group);
      const ex = JSON.stringify(flagSets || {}), gk = group + ':' + kind + ':' + ex, k = gk + ':' + heading;
      let a = built.get(k);
      if (!a) {
        let d = groupDefs.get(gk);
        if (!d) { if (groupDefs.size > 4000) groupDefs.clear(); d = Object.assign({ id: gk, kind, group }, gf(kind, flagSets || {})); groupDefs.set(gk, d); }
        if (built.size > 12000) built.clear();
        a = buildAsset(d, heading); built.set(k, a);
      }
      return a;
    }
    const fs = flagSets || [];
    const k = 'p:' + kind + ':' + heading + ':' + JSON.stringify(fs);
    let a = built.get(k);
    if (!a) {
      if (!DEFS.people[kind]) throw new Error('unknown person ' + kind);
      if (built.size > 5000) built.clear();
      a = buildAsset(peopleDef(kind, fs), heading); built.set(k, a);
    }
    return a;
  }

  // ---------- regions: fleets, climate, outfits (proposals, to be checked with local authors) ----------
  // cold / sun / rain are 0..1 and drive coats, sun hats and umbrellas. drive: 'right' | 'left' | 'ask' (mixed region, ask at intake).
  const REGIONS = {
    nw: { drive: 'right', climate: { cold: 0.6, sun: 0.2, rain: 0.6 },
          fleet: [['bicycle', 20], ['cargo_bike', 8], ['city_car', 22], ['hatchback', 18], ['van', 7], ['bus', 4], ['tram', 3], ['moped', 3]] },
    uk: { drive: 'left', climate: { cold: 0.5, sun: 0.15, rain: 0.8 },
          fleet: [['city_car', 22], ['hatchback', 24], ['sedan', 8], ['van', 10], ['double_decker', 6], ['bicycle', 8], ['suv', 6]] },
    ws: { drive: 'right', climate: { cold: 0.4, sun: 0.4, rain: 0.3 },
          fleet: [['moped', 18], ['city_car', 24], ['hatchback', 18], ['bus', 5], ['tram', 3], ['bicycle', 8], ['van', 6]] },
    md: { drive: 'right', climate: { cold: 0.1, sun: 0.8, rain: 0.15 },
          fleet: [['moped', 24], ['utility_three_wheeler', 8], ['city_car', 26], ['hatchback', 12], ['bus', 4], ['bicycle', 3], ['van', 6]] },
    ce: { drive: 'right', climate: { cold: 0.7, sun: 0.25, rain: 0.35 },
          fleet: [['city_car', 24], ['hatchback', 22], ['sedan', 10], ['tram', 6], ['bus', 5], ['bicycle', 5], ['van', 7]] },
    sa: { drive: 'left', climate: { cold: 0.0, sun: 0.85, rain: 0.5 },
          fleet: [['three_wheeler', 22], ['motorbike', 24], ['city_car', 14], ['minibus', 8], ['bus', 6], ['bicycle', 8], ['van', 6]] },
    se: { drive: 'ask', climate: { cold: 0.0, sun: 0.85, rain: 0.6 },
          fleet: [['motorbike', 34], ['three_wheeler', 10], ['pickup', 8], ['minibus', 8], ['city_car', 12], ['bicycle', 4], ['bus', 4]] },
    ea: { drive: 'ask', climate: { cold: 0.5, sun: 0.3, rain: 0.5 },
          fleet: [['kei_van', 12], ['city_car', 22], ['hatchback', 12], ['bicycle', 16], ['moped', 10], ['bus', 5], ['van', 6]] },
    me: { drive: 'right', climate: { cold: 0.05, sun: 0.95, rain: 0.05 },
          fleet: [['sedan', 26], ['city_car', 14], ['pickup', 14], ['minibus', 12], ['bus', 6], ['suv', 8], ['van', 6]] },
    sb: { drive: 'ask', climate: { cold: 0.0, sun: 0.75, rain: 0.45 },
          fleet: [['minibus', 24], ['motorbike', 20], ['pickup', 8], ['lorry', 6], ['three_wheeler', 8], ['bus', 5], ['city_car', 10]] },
    la: { drive: 'right', climate: { cold: 0.15, sun: 0.6, rain: 0.4 },
          fleet: [['minibus', 12], ['city_car', 24], ['hatchback', 14], ['motorbike', 14], ['pickup', 8], ['bus', 8], ['bicycle', 4]] },
    na: { drive: 'right', climate: { cold: 0.5, sun: 0.4, rain: 0.35 },
          fleet: [['pickup', 18], ['suv', 20], ['sedan', 20], ['van', 8], ['bus', 3], ['bicycle', 4], ['city_car', 6]] }
  };
  // people kinds, same everywhere (weights): the region changes clothes and accessories, not who is present
  const PEOPLE_MIX = [['man', 22], ['woman', 22], ['boy', 5], ['girl', 5], ['couple', 10], ['parent_child', 8], ['family', 3], ['wheelchair', 2]];

  function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }
  function pickWeighted(list, u) { let tot = 0; list.forEach(e => tot += e[1]); let x = u * tot; for (const e of list) { x -= e[1]; if (x <= 0) return e[0]; } return list[list.length - 1][0]; }

  function pick(arr, seed) { return arr[Math.floor(hash(seed) * arr.length) % arr.length]; }

  // Outfit for one person: colours from the family palette, flags from climate.
  function makeOutfit(regionId, fam, seed) {
    const th = asTheme(fam), rg = REGIONS[regionId] || REGIONS.nw, c = rg.climate, pal = { tops: th.tops, bottoms: th.bottoms, accents: th.peopleAccents };
    const flags = {};
    if (hash(seed + 11) < c.cold * 0.8) flags.coat = true;
    if (hash(seed + 12) < c.cold * 0.5) flags.scarf = true;
    if (hash(seed + 13) < c.rain * 0.3) flags.umbrella = true;
    else if (hash(seed + 14) < c.sun * 0.35) flags.hat = c.sun > 0.6 ? 'sunhat' : 'cap';
    if (hash(seed + 15) < 0.25) flags.bag = true;
    return { flags, top: pick(pal.tops, seed + 1), bottom: pick(pal.bottoms, seed + 2), accent: pick(pal.accents, seed + 3), hat: pick(pal.accents, seed + 4) };
  }
  function vehicleTint(fam, seed) { return pick(asTheme(fam).vehicles, seed + 7); }
  function pickFleet(regionId, u) { return pickWeighted((REGIONS[regionId] || REGIONS.nw).fleet, u); }
  function pickPerson(u) { return pickWeighted(PEOPLE_MIX, u); }

  // ---------- colours for an asset ----------
  function baseColours(reg) {
    return { glass: reg.glass, wheel: '#2c2c31', hub: '#bdb8aa', frame: '#4b4b50', trim: '#d9d1bf', light: '#f6ebb8', paper: reg.paper, interior: '#3a352e', roof: '#4a4e58', cab: '#d9d1bf' };
  }
  // vehicle colours: tint is the default livery; data (optional) overrides it. roofColour darkens the tint for roofs.
  function vehicleColours(kind, reg, tint, dataColour) {
    const c = baseColours(reg), def = DEFS.vehicles[kind];
    let t = tint;
    if (def && def.coop) t = reg.coop;
    if (kind === 'tram') t = reg.tram;
    c.data = dataColour || t;
    c.roof = shade(c.data, 0.55);
    if (kind === 'lorry') c.cab = mix(tint, '#ffffff', 0.5);
    return c;
  }
  // person colours; dataColours (optional) is one colour or an array per member
  function personColours(kind, reg, outfits, dataColours) {
    const c = baseColours(reg), n = DEFS.people[kind].members.length;
    for (let i = 0; i < n; i++) {
      const o = outfits[i] || outfits[0], sfx = i ? '@' + i : '';
      const dc = Array.isArray(dataColours) ? dataColours[i] : dataColours;
      c['data' + sfx] = dc || o.top; c['bottom' + sfx] = o.bottom; c['accent' + sfx] = o.accent; c['hat' + sfx] = o.hat;
      c['paper' + sfx] = reg.paper; c['frame' + sfx] = '#4b4b50';
    }
    return c;
  }
  function flagsOf(outfits) { return outfits.map(o => o.flags); }

  // ---------- data scales: map a simulation output to the data-surface colour ----------
  const scales = {
    categorical(map, fallback) { return { type: 'categorical', colour: v => map[v] || fallback || '#bbbbbb', legend: () => Object.keys(map).map(k => ({ label: k, colour: map[k] })) }; },
    sequential(stops, domain, labels) {
      const d0 = domain ? domain[0] : 0, d1 = domain ? domain[1] : 1;
      return { type: 'sequential', colour: v => { const t = Math.max(0, Math.min(1, (v - d0) / ((d1 - d0) || 1))) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(t)); return mix(stops[i], stops[i + 1], t - i); },
               legend: () => stops.map((c, i) => ({ label: labels ? labels[i] : (d0 + (d1 - d0) * i / (stops.length - 1)).toFixed(1), colour: c })) };
    },
    retrofitStates(reg, base) { // the Great Retrofit's own classes
      const s = reg.states;
      return scales.categorical({ to_do: base || '#b9876f', queued: s.queued, in_progress: s.in_progress, finished: s.finished, investor: s.investor });
    }
  };

  root.AssetLib = { canvasFactory, watchDpr, quantise, prewarm, PREWARM_MAX_PX, DEFS, REG, STYLE, REGIONS, PEOPLE_MIX, getAsset, snapHeading, toSVG, paint, drawSprite, spritePlacement, sprites, buildAsset,
                    makeOutfit, vehicleTint, pickFleet, pickPerson, vehicleColours, personColours, flagsOf, scales, mix, shade, hash, hashStr, isData, faceOf,
                    registerGroup, baseColours, pickWeighted,
                    CARBON, theme, asTheme, resolveLook, snapTo, toGray };
})(typeof window !== 'undefined' ? window : globalThis);
