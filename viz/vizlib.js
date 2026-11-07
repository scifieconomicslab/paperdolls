/* vizlib.js: reusable isometric library for SimCity-style replays (mock, v0).
 * Layers: scene schema -> network -> sim (agents) -> renderFrame(ctx, sim, view).
 * All world units are metres. Everything is parametric: no sprite sheets.
 * Public API is at the bottom: VizLib.
 */
(function (root) {
  'use strict';

  // ---------- small utilities ----------
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hexRgb(h) { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }
  function rgbStr(c) { return 'rgb(' + c.map(v => Math.max(0, Math.min(255, Math.round(v)))).join(',') + ')'; }
  // shade/mixHex are called for every wall and roof of every building drawn, with a handful of distinct arguments: memoised (a Map per k, bounded by the colours in use)
  const shadeMemo = new Map();
  function shade(hex, k) {
    let m = shadeMemo.get(k); if (!m) shadeMemo.set(k, m = new Map());
    let r = m.get(hex); if (r === undefined) { if (m.size > 5000) m.clear(); m.set(hex, r = rgbStr(hexRgb(hex).map(v => v * k))); }
    return r;
  }
  function mixHex(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return rgbStr(A.map((v, i) => v * (1 - t) + B[i] * t)); }
  function key(x, y) { return Math.round(x * 10) + ',' + Math.round(y * 10); }

  // Registers and themes live in AssetLib (REG, theme). The scene reads them from there.

  // ---------- projection ----------
  // View: { scale (px per metre), ox, oy } ; sx = ox + (x - y) * k * cos30 ; sy = oy + (x + y) * k * 0.5 - z * k
  const C30 = 0.8660254;
  function proj(view, x, y, z) {
    const k = view.scale;
    return [view.ox + (x - y) * k * C30, view.oy + (x + y) * k * 0.5 - z * k];
  }
  // ---------- terrain (optional) ----------
  // scene.terrain = { x0, y0, dx, dy, nx, ny, z: [nx * ny heights in metres, row-major: row j is y = y0 + j * dy] } is a regular height grid. Buildings, road
  // vertices and trees may also carry their own z (metres): b.z, road.z = [one per point], tree = [x, y, kind, scale, z]. An explicit z wins over the grid;
  // with neither, z is 0 and the picture is what it was before terrain existed. sim.opts.relief scales every height (1 = true, 0 = relief shading only, no
  // vertical offset, 3 = exaggerated), and is baked in when the sim is created, so everything downstream just uses e.z.
  function makeTerrain(t) {
    const z = Float32Array.from(t.z); let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < z.length; i++) { if (z[i] < lo) lo = z[i]; if (z[i] > hi) hi = z[i]; }
    const T = { x0: t.x0, y0: t.y0, dx: t.dx, dy: t.dy, nx: t.nx, ny: t.ny, z, lo, hi };
    T.at = function (x, y) {                                   // bilinear, clamped to the grid (heights in metres, unscaled)
      let u = (x - T.x0) / T.dx, v = (y - T.y0) / T.dy;
      u = u < 0 ? 0 : (u > T.nx - 1 ? T.nx - 1 : u); v = v < 0 ? 0 : (v > T.ny - 1 ? T.ny - 1 : v);
      const i = Math.min(T.nx - 2, Math.floor(u)), j = Math.min(T.ny - 2, Math.floor(v)), fu = u - i, fv = v - j, k = j * T.nx + i;
      return (z[k] * (1 - fu) + z[k + 1] * fu) * (1 - fv) + (z[k + T.nx] * (1 - fu) + z[k + T.nx + 1] * fu) * fv;
    };
    return T;
  }
  // view direction (toward the camera), used for face visibility
  const VIEW = [1, 1, 1.2];

  // ---------- library: buildings and roads (parametric). People and vehicles live in assetlib.js ----------
  const LIB = {
    buildings: {
      // bayW: bay width (m); storeyH: storey height (m); win: window size fraction; roof: flat|pitch|none
      terrace:  { bayW: 5.2, storeyH: 3.0, win: 0.42, roof: 'pitch', shopFloor: false },
      shophouse:{ bayW: 6.0, storeyH: 3.6, win: 0.5,  roof: 'flat',  shopFloor: true },
      block:    { bayW: 4.0, storeyH: 3.0, win: 0.4,  roof: 'flat',  shopFloor: false },
      villa:    { bayW: 4.5, storeyH: 3.0, win: 0.3,  roof: 'pitch', shopFloor: false },
      tower:    { bayW: 4.0, storeyH: 3.3, win: 0.8,  roof: 'flat',  shopFloor: false },
      shed:     { bayW: 5.0, storeyH: 6.0, win: 0.15, roof: 'flat',  shopFloor: false }
    },
    roads: {
      local:     { width: 6,  pavement: 2.6, centre: 'dash',   cycle: false, tram: false },
      avenue:    { width: 10, pavement: 3.0, centre: 'dash',   cycle: true,  tram: false },
      boulevard: { width: 16, pavement: 3.5, centre: 'median', cycle: true,  tram: true  },
      cycle:     { width: 2.5, pavement: 0,  centre: 'none',   cycle: true,  tram: false },
      pedestrian:{ width: 5,  pavement: 1.5, centre: 'none',   cycle: false, tram: false },   // people only: no vehicles
      tramway:   { width: 6,  pavement: 0,   centre: 'none',   cycle: false, tram: true }     // a tram track with no road alongside
    }
  };
  // A road's parameters: its class, with any per-road overrides from the scene (an OSM width, cycle lanes, a tram line).
  function roadCls(r) {
    const c = LIB.roads[r.class] || LIB.roads.local, o = {};
    for (const k of ['width', 'pavement', 'centre', 'cycle', 'tram']) if (r[k] !== undefined && r[k] !== null) o[k] = r[k];
    return Object.assign({}, c, o);
  }

  // ---------- drawing primitives ----------
  const WINDOW_LOD_PX = 1.5;                         // default for sim.opts.windowLodPx: a window module narrower than this (screen px) is not drawn
  let windowLodPx = WINDOW_LOD_PX;                   // set by renderFrameInner for the frame being drawn
  function poly(ctx, pts, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  }
  // Buildings: footprint extruded; windows drawn per visible wall, bay by bay.
  // Generic extrusion of an arbitrary footprint. The fallback for footprints the asset slots cannot take (see fitFootprint).
  function drawBuilding(ctx, view, reg, pal, b, shadowRgb, state, wallOverride, roofOverride) {
    reg = Object.assign({}, reg, { lw: reg.lw * Math.max(0.3, Math.min(1, view.scale / 10)) });   // thinner ink when zoomed out
    const arch = LIB.buildings[b.archetype] || LIB.buildings.terrace;
    const H = b.levels * arch.storeyH;
    const fp = b.footprint;
    const n = fp.length;
    // orientation: make the polygon counter-clockwise in world (x right, y down means screen-ccw; use signed area)
    let area = 0; for (let i = 0; i < n; i++) { const p = fp[i], q = fp[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
    const sgn = area > 0 ? 1 : -1;
    const base = pal.wall, base2 = pal.wall2;
    let wallFill = wallOverride || b.wallFill || base;
    if (!wallOverride) {
      if (state === 'finished') wallFill = reg.finished;
      if (state === 'in_progress') wallFill = reg.inprog;
      if (state === 'queued') wallFill = mixHex(base, reg.queued, 0.55);
    }
    // ink-outlined walls facing the viewer
    for (let i = 0; i < n; i++) {
      const p = fp[i], q = fp[(i + 1) % n];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const len = Math.hypot(dx, dy); if (len < 0.05) continue;
      // outward normal for the chosen orientation
      const nx = sgn * dy / len, ny = -sgn * dx / len;
      const dot = nx * VIEW[0] + ny * VIEW[1];
      if (dot <= 0) continue;
      const k = (Math.abs(nx) > Math.abs(ny)) ? reg.tones[2] : reg.tones[1];
      const wall = shade(wallFill, k);
      const pts = [proj(view, p[0], p[1], 0), proj(view, q[0], q[1], 0), proj(view, q[0], q[1], H), proj(view, p[0], p[1], H)];
      poly(ctx, pts, wall, reg.ink, reg.lw);
      // windows, bay by bay
      const bays = Math.max(1, Math.floor(len / arch.bayW));
      const bayLen = len / bays;
      const storeys = b.levels;
      // Level of detail: a window module narrower than WINDOW_LOD_PX on the screen cannot be seen (it is a smudge of ink on the wall), and drawing
      // the windows of a district is most of the time a far-zoom frame costs (11.7 s of 12 s for the 9,214 buildings of Jette at Fit). The wall is then drawn plain.
      // sim.opts.windowLodPx = 0 draws every window as before (renderFrame sets windowLodPx for the frame).
      const winBays = bayLen * view.scale < windowLodPx ? 0 : bays;
      for (let bi = 0; bi < winBays; bi++) {
        for (let si = 0; si < storeys; si++) {
          if (arch.shopFloor && si === 0) {
            // shopfront band
            const u0 = bi * bayLen + bayLen * 0.12, u1 = bi * bayLen + bayLen * 0.88;
            const v0 = 0.2, v1 = arch.storeyH * 0.75;
            const a = [p[0] + dx / len * u0, p[1] + dy / len * u0], bpt = [p[0] + dx / len * u1, p[1] + dy / len * u1];
            poly(ctx, [proj(view, a[0], a[1], v0), proj(view, bpt[0], bpt[1], v0), proj(view, bpt[0], bpt[1], v1), proj(view, a[0], a[1], v1)],
                 '#9fc1d4', reg.ink, reg.lw * 0.7);
            continue;
          }
          const u0 = bi * bayLen + bayLen * (0.5 - arch.win / 2), u1 = bi * bayLen + bayLen * (0.5 + arch.win / 2);
          const v0 = si * arch.storeyH + arch.storeyH * 0.3, v1 = si * arch.storeyH + arch.storeyH * 0.8;
          const a = [p[0] + dx / len * u0, p[1] + dy / len * u0], bpt = [p[0] + dx / len * u1, p[1] + dy / len * u1];
          const glass = state === 'finished' ? '#8fb8cc' : '#9fc1d4';
          poly(ctx, [proj(view, a[0], a[1], v0), proj(view, bpt[0], bpt[1], v0), proj(view, bpt[0], bpt[1], v1), proj(view, a[0], a[1], v1)],
               glass, reg.ink, reg.lw * 0.6);
        }
      }
      if (state === 'in_progress') {
        // scaffold band
        const z = H * 0.55;
        ctx.strokeStyle = reg.ink; ctx.lineWidth = reg.lw * 0.8;
        const a = proj(view, p[0], p[1], z), bq = proj(view, q[0], q[1], z);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(bq[0], bq[1]); ctx.stroke();
      }
    }
    // roof: flat top polygon, drawn last among the faces
    const top = fp.map(p => proj(view, p[0], p[1], H));
    poly(ctx, top, shade(roofOverride || pal.roof || wallFill, reg.tones[0]), reg.ink, reg.lw);
    if (state === 'finished') {
      // solar panels on the roof: a small inset polygon near the centroid
      let cx = 0, cy = 0; fp.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= n; cy /= n;
      const s = 2.2;
      const rp = [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]].map(p => proj(view, p[0], p[1], H + 0.05));
      poly(ctx, rp, '#2e3c5c', reg.ink, reg.lw * 0.6);
    }
    if (b.investor) {
      // investor-owned: purple roof stripe
      let cx = 0, cy = 0; fp.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= n; cy /= n;
      const s = 1.0;
      const rp = [[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]].map(p => proj(view, p[0], p[1], H + 0.06));
      poly(ctx, rp, reg.investor, reg.ink, reg.lw * 0.6);
    }
  }

  // ---------- scene: placeholder generator (same schema a real OSM extract would produce) ----------
  // Schema (metres, local frame):
  // { area:{name, source, osm_relation}, roads:[{id, class, pts:[[x,y],...], tram?}],
  //   buildings:[{id, footprint:[[x,y],...], levels, archetype, state, investor}],
  //   landuse:[{id, kind:'park'|'garden'|'square'|'water', footprint:[[x,y]...]}], trees:[[x,y] or [x,y,kind,scale], ...] }
  function makePlaceholderScene(seed) {
    const R = rng(seed || 7);
    const xs = [0, 150, 300, 450, 600, 750], ys = [0, 130, 260, 390, 520];
    const roads = [], buildings = [], landuse = [], trees = [];
    let rid = 0;
    // grid streets; y=260 is the boulevard with tram, x=450 is an avenue with a cycle lane
    for (const y of ys) {
      const cls = (y === 260) ? 'boulevard' : (y === 390 ? 'avenue' : 'local');
      roads.push({ id: 'r' + (rid++), class: cls, tram: y === 260, pts: [[-60, y], [xs[xs.length - 1] + 60, y]] });
    }
    for (const x of xs) {
      const cls = (x === 450) ? 'avenue' : 'local';
      roads.push({ id: 'r' + (rid++), class: cls, pts: [[x, -60], [x, ys[ys.length - 1] + 60]] });
    }
    // a curved avenue to the north-east, to show non-grid geometry
    roads.push({ id: 'r' + (rid++), class: 'avenue', pts: [[750, 390], [820, 330], [860, 240], [880, 130]] });
    // cycle route along the local street at y=0
    roads.push({ id: 'r' + (rid++), class: 'cycle', pts: [[0, -18], [600, -18]] });
    // landuse: a square at the junction (300..450, 130..260) and a park (450..600, 0..130)
    landuse.push({ id: 'sq', kind: 'square', footprint: [[318, 148], [432, 148], [432, 242], [318, 242]] });
    landuse.push({ id: 'pk', kind: 'park', footprint: [[468, 12], [582, 12], [582, 118], [468, 118]] });
    for (let i = 0; i < 16; i++) trees.push([476 + R() * 98, 18 + R() * 94]);                                    // the park
    // buildings: fill each block with terrace rows along its four frontages
    const inSq = (x, y) => x > 300 && x < 450 && y > 130 && y < 260;
    const inPk = (x, y) => x > 450 && x < 600 && y > 0 && y < 130;
    let bid = 0;
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      const x0 = xs[i] + 10, x1 = xs[i + 1] - 10, y0 = ys[j] + 8, y1 = ys[j + 1] - 8;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (inSq(cx, cy) || inPk(cx, cy)) continue;
      // row along the north and south frontages
      const bandDepth = 16;
      // the block's interior is a garden, with a few trees and shrubs
      const gx0 = x0 + bandDepth + 3, gx1 = x1 - bandDepth - 3, gy0 = y0 + bandDepth + 3, gy1 = y1 - bandDepth - 3;
      landuse.push({ id: 'g' + i + '_' + j, kind: 'garden', footprint: [[gx0, gy0], [gx1, gy0], [gx1, gy1], [gx0, gy1]] });
      const nt = 5 + Math.floor(R() * 4);
      for (let k = 0; k < nt; k++) trees.push([gx0 + 4 + R() * (gx1 - gx0 - 8), gy0 + 4 + R() * (gy1 - gy0 - 8), ...(R() < 0.25 ? ['shrub'] : [])]);
      const rows = [
        { a: [x0, y0], b: [x1, y0], d: [0, 1] },
        { a: [x0, y1], b: [x1, y1], d: [0, -1] },
        { a: [x0, y0], b: [x0, y1], d: [1, 0] },
        { a: [x1, y0], b: [x1, y1], d: [-1, 0] }
      ];
      for (const row of rows) {
        const L = Math.hypot(row.b[0] - row.a[0], row.b[1] - row.a[1]);
        const ux = (row.b[0] - row.a[0]) / L, uy = (row.b[1] - row.a[1]) / L;
        let s = 0;
        while (s < L - 6) {
          let levels = 2 + Math.floor(R() * 3), arch;
          const u = R();
          if (u < 0.04) { arch = 'tower'; levels = 8 + Math.floor(R() * 5); }
          else if (u < 0.08) { arch = 'shed'; levels = 1; }
          else if (u < 0.15) { arch = 'villa'; levels = 2; }
          else arch = (levels >= 4) ? 'block' : (R() < 0.3 ? 'shophouse' : 'terrace');
          const wMin = { tower: 13, shed: 15, villa: 9 }[arch] || 6, wMax = { tower: 16, shed: 20, villa: 11 }[arch] || 9;
          const w = Math.min(wMin + R() * (wMax - wMin), L - s);
          const p0 = [row.a[0] + ux * s, row.a[1] + uy * s];
          const p1 = [row.a[0] + ux * (s + w), row.a[1] + uy * (s + w)];
          const d = [row.d[0] * bandDepth, row.d[1] * bandDepth];
          const fp = [p0, p1, [p1[0] + d[0], p1[1] + d[1]], [p0[0] + d[0], p0[1] + d[1]]];
          const state = R() < 0.1 ? 'finished' : (R() < 0.12 ? 'in_progress' : (R() < 0.12 ? 'queued' : 'none'));
          // a third of the buildings leave the archetype to the region ('auto'): the region's building mix decides
          buildings.push({ id: 'b' + (bid++), footprint: fp, levels, archetype: R() < 0.33 ? 'auto' : arch, state, investor: R() < 0.15 });
          s += w + 0.6;
        }
      }
    }
    // buildings along the curved avenue: rotated footprints that the asset slots cannot take (they use the extrusion fallback)
    const curve = [[750, 390], [820, 330], [860, 240], [880, 130]];
    for (let i = 0; i < curve.length - 1; i++) {
      const [ax, ay] = curve[i], [bx, by] = curve[i + 1], L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
      for (const side of [1, -1]) for (let t = 6; t + 8 < L - 4; t += 9) {
        const w = 8, dep = 12, off = 12;                       // off: gap from the road centre line to the near edge
        const o = [ax + ux * t - uy * off * side, ay + uy * t + ux * off * side];
        const dv = [-uy * dep * side, ux * dep * side];
        const p0 = o, p1 = [o[0] + ux * w, o[1] + uy * w];
        buildings.push({ id: 'c' + (bid++), footprint: [p0, p1, [p1[0] + dv[0], p1[1] + dv[1]], [p0[0] + dv[0], p0[1] + dv[1]]], levels: 2 + Math.floor(R() * 3), archetype: R() < 0.3 ? 'shophouse' : 'terrace', state: R() < 0.2 ? 'finished' : 'none', investor: R() < 0.15 });
      }
    }
    // street trees on the pavements: both sides of avenues, one side of local streets, none on the tram boulevard (no room)
    const isH = r => r.pts[0][1] === r.pts[r.pts.length - 1][1] && r.pts.length === 2, isV = r => r.pts[0][0] === r.pts[r.pts.length - 1][0] && r.pts.length === 2;
    roads.forEach((r, ri) => {
      if (r.class === 'boulevard' || r.class === 'cycle' || !(isH(r) || isV(r))) return;
      const cls = { local: [6, 2.6], avenue: [10, 3] }[r.class] || [6, 2.6], off = cls[0] / 2 + cls[1] * 0.5, sides = r.class === 'avenue' ? [1, -1] : [ri % 2 ? 1 : -1];
      const horiz = isH(r), lo = horiz ? -40 : -40, hi = horiz ? 790 : 560, cross = horiz ? xs : ys;
      for (let t = lo; t <= hi; t += 24) {
        const c = horiz ? [t, r.pts[0][1]] : [r.pts[0][0], t];
        if (cross.some(v => Math.abs((horiz ? c[0] : c[1]) - v) < 13)) continue;                   // keep junctions clear
        for (const sd of sides) { const px = horiz ? c[0] : c[0] + off * sd, py = horiz ? c[1] + off * sd : c[1]; if (!inSq(px, py) && !inPk(px, py)) trees.push([px, py]); }
      }
    });
    for (let x = 326; x <= 424; x += 16) { trees.push([x, 154]); trees.push([x, 236]); }               // the square: a ring of trees
    for (let y = 164; y <= 228; y += 16) { trees.push([324, y]); trees.push([426, y]); }
    return { area: { name: 'Jette-style placeholder (not OSM)', source: 'synthetic', osm_relation: 58258 },
             roads, buildings, landuse, trees };
  }

  // ---------- scene validation ----------
  // Checks a scene before it is built, so a bad file fails with a clear message and not deep inside the renderer.
  function validateScene(scene) {
    const A = A_(), errors = [], warnings = [], num = x => typeof x === 'number' && isFinite(x), pt = p => Array.isArray(p) && p.length >= 2 && num(p[0]) && num(p[1]);
    const bad = m => { if (errors.length < 40) errors.push(m); };
    if (!scene || typeof scene !== 'object') return { ok: false, errors: ['scene must be an object'], warnings };
    for (const k of ['roads', 'buildings', 'landuse', 'trees']) if (!Array.isArray(scene[k])) bad(k + ' must be an array');
    if (errors.length) return { ok: false, errors, warnings };
    scene.roads.forEach((r, i) => {
      if (!r || !LIB.roads[r.class]) bad('road ' + i + ': unknown class ' + (r && r.class));
      else if (!Array.isArray(r.pts) || r.pts.length < 2 || !r.pts.every(pt)) bad('road ' + i + ' (' + r.id + '): needs at least two [x, y] points');
      else {
        for (const k of ['width', 'pavement']) if (r[k] !== undefined && r[k] !== null && !(num(r[k]) && r[k] >= 0 && r[k] < 100)) bad('road ' + i + ': bad ' + k);
        if (r.z !== undefined && !(Array.isArray(r.z) && r.z.length === r.pts.length && r.z.every(num))) bad('road ' + i + ' (' + r.id + '): z must list one height in metres per point');
      }
    });
    const ids = new Set();
    scene.buildings.forEach((b, i) => {
      if (!b || !Array.isArray(b.footprint) || b.footprint.length < 3 || !b.footprint.every(pt)) { bad('building ' + i + ': needs a footprint of at least three [x, y] points'); return; }
      if (!(num(b.levels) && b.levels >= 1)) bad('building ' + i + ' (' + b.id + '): levels must be a number of at least 1');
      if (b.archetype !== undefined && b.archetype !== 'auto' && !A.ARCH[b.archetype]) bad('building ' + i + ': unknown archetype ' + b.archetype);
      if (b.id !== undefined) { if (ids.has(b.id)) bad('building id ' + b.id + ' appears twice'); ids.add(b.id); }
      // optional fields written by the ingest (scene entity table); old scenes without them stay valid
      if (b.z !== undefined && !num(b.z)) bad('building ' + i + ' (' + b.id + '): z must be a number of metres');
      if (b.area !== undefined && !(num(b.area) && b.area >= 0)) bad('building ' + i + ' (' + b.id + '): area must be a number of at least 0');
      if (b.centroid !== undefined && !pt(b.centroid)) bad('building ' + i + ' (' + b.id + '): centroid must be [x, y]');
      if (b.height !== undefined && !(num(b.height) && b.height > 0)) bad('building ' + i + ' (' + b.id + '): height must be a number above 0');
      if (b.levels_assumed !== undefined && typeof b.levels_assumed !== 'boolean') bad('building ' + i + ' (' + b.id + '): levels_assumed must be true or false');
      if (b.residential !== undefined && !['residential', 'probable', 'other'].includes(b.residential)) bad('building ' + i + ' (' + b.id + '): residential must be residential, probable or other');
      if (b.neighbours !== undefined && !(Array.isArray(b.neighbours) && b.neighbours.every(n => typeof n === 'string' || num(n)))) bad('building ' + i + ' (' + b.id + '): neighbours must be a list of building ids');
    });
    let dangling = 0;
    scene.buildings.forEach(b => { if (b && Array.isArray(b.neighbours)) for (const n of b.neighbours) if (!ids.has(n)) dangling++; });
    if (dangling) warnings.push(dangling + ' neighbour id(s) name no building in the scene');
    scene.landuse.forEach((l, i) => { if (!l || !['park', 'garden', 'square', 'water'].includes(l.kind)) bad('landuse ' + i + ': unknown kind ' + (l && l.kind)); else if (!Array.isArray(l.footprint) || l.footprint.length < 3 || !l.footprint.every(pt)) bad('landuse ' + i + ': needs a footprint'); });
    scene.trees.forEach((t, i) => { if (!pt(t)) bad('tree ' + i + ': needs [x, y]'); else if (t[2] && !A.TREES[t[2]]) bad('tree ' + i + ': unknown kind ' + t[2]); else if (t[3] !== undefined && t[3] !== null && !(num(t[3]) && t[3] > 0)) bad('tree ' + i + ': bad scale'); else if (t[4] !== undefined && t[4] !== null && !num(t[4])) bad('tree ' + i + ': z must be a number of metres'); });
    if (scene.terrain !== undefined && scene.terrain !== null) {
      const t = scene.terrain;
      if (!(t && num(t.x0) && num(t.y0) && num(t.dx) && num(t.dy) && t.dx > 0 && t.dy > 0 && Number.isInteger(t.nx) && Number.isInteger(t.ny) && t.nx >= 2 && t.ny >= 2 && Array.isArray(t.z) && t.z.length === t.nx * t.ny && t.z.every(num)))
        bad('terrain must be { x0, y0, dx, dy, nx, ny, z } with nx * ny heights in metres (nx and ny at least 2)');
    }
    const B = sceneBounds(scene);
    if (B[2] - B[0] > 20000 || B[3] - B[1] > 20000) warnings.push('the scene is more than 20 km across: expect it to be slow');
    if (scene.buildings.length > 30000) warnings.push(scene.buildings.length + ' buildings: expect it to be slow');
    if (!scene.roads.length) warnings.push('no roads: nothing for vehicles and people to move on');
    return { ok: errors.length === 0, errors, warnings };
  }

  // ---------- network ----------
  function buildNetwork(scene) {
    const nodes = new Map(), edges = [];
    function node(x, y) {
      const k = key(x, y);
      if (!nodes.has(k)) nodes.set(k, { k, x, y, edges: [] });
      return nodes.get(k);
    }
    for (const r of scene.roads) {
      const cls = roadCls(r);
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1];
        const na = node(ax, ay), nb = node(bx, by);
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 0.1) continue;
        const e = { id: edges.length, a: na, b: nb, ax, ay, bx, by, az: r.z ? r.z[i] : undefined, bz: r.z ? r.z[i + 1] : undefined, len, cls: r.class, width: cls.width, pavement: cls.pavement,
                    tram: !!cls.tram, cycle: !!cls.cycle, roadId: r.id, centre: cls.centre };
        edges.push(e); na.edges.push(e); nb.edges.push(e);
      }
    }
    return { nodes, edges };
  }

  // ---------- where people may walk ----------
  // A person is drawn on the pavement, at a fixed offset from the road's centre line. Nothing says the pavement is free: in a dense scene (and in the
  // synthetic placeholder, on the tram boulevard) buildings stand on it, and people were drawn walking through or along the walls. So each pavement edge
  // is checked against the building footprints, per side and at three offsets across the pavement: a person takes the clearest side and offset, and an
  // edge that is blocked on both sides is not walked at all while there is another way.
  const WALK_MARGIN = 0.4, WALK_OK = 0.7;            // metres a person keeps from a wall; the share of an edge that must be clear to use it
  function buildingIndex(scene) {
    const cell = 25, grid = new Map(), boxes = [];
    for (const b of scene.buildings) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of b.footprint) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      x0 -= WALK_MARGIN; y0 -= WALK_MARGIN; x1 += WALK_MARGIN; y1 += WALK_MARGIN;
      const bx = { f: b.footprint, x0, y0, x1, y1 };
      for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
        const k = cx + ',' + cy, l = grid.get(k); if (l) l.push(bx); else grid.set(k, [bx]);
      }
    }
    const inside = (x, y, f) => { let ins = false; for (let i = 0, j = f.length - 1; i < f.length; j = i++) { const a = f[i], c = f[j]; if ((a[1] > y) !== (c[1] > y) && x < (c[0] - a[0]) * (y - a[1]) / (c[1] - a[1]) + a[0]) ins = !ins; } return ins; };
    const near = (x, y, f) => { for (let i = 0; i < f.length; i++) { const a = f[i], c = f[(i + 1) % f.length], dx = c[0] - a[0], dy = c[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)); if (Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)) < WALK_MARGIN) return true; } return false; };
    return { blocked(x, y) { const l = grid.get(Math.floor(x / cell) + ',' + Math.floor(y / cell)); if (!l) return false; for (const b of l) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && (inside(x, y, b.f) || near(x, y, b.f))) return true; return false; } };
  }
  // For an edge: clear[0] and clear[1] are the shares of it that are free of buildings on the left (+) and right (-) of its direction, at the best of
  // three offsets; off[0] and off[1] are those offsets from the centre line; best is the larger share.
  function walkInfo(e, idx) {
    const kerb = e.width / 2, pav = e.pavement, ux = (e.bx - e.ax) / e.len, uy = (e.by - e.ay) / e.len, n = Math.max(2, Math.ceil(e.len / 2));
    const offs = pav > 1.4 ? [kerb + pav * 0.5, kerb + 0.5, kerb + pav - 0.5] : [kerb + pav * 0.5], w = { clear: [0, 0], off: [offs[0], offs[0]], best: 0 };
    for (const [i, sg] of [[0, 1], [1, -1]]) {
      for (const o of offs) {
        let ok = 0; for (let k = 0; k <= n; k++) { const t = k / n; if (!idx.blocked(e.ax + (e.bx - e.ax) * t - uy * sg * o, e.ay + (e.by - e.ay) * t + ux * sg * o)) ok++; }
        const f = ok / (n + 1); if (f > w.clear[i] + 1e-9) { w.clear[i] = f; w.off[i] = o; }          // ties keep the earlier offset, so the middle of a clear pavement as before
      }
    }
    w.best = Math.max(w.clear[0], w.clear[1]); return w;
  }
  const isWalkable = e => !e.walk || e.walk.best >= WALK_OK;
  // a person walks on the side of the road (a.side, as seen from the direction of travel) that is clearer on this edge
  function settleSide(a) {
    const w = a.edge.walk; if (!w) return;
    const i = a.dir * a.side > 0 ? 0 : 1;
    if (w.clear[i] < WALK_OK && w.clear[1 - i] > w.clear[i]) a.side = -a.side;
  }

  // ---------- sim ----------
  // Agents are classed: { group: 'vehicles' | 'people', kind, network, edge, dir, s, side, speed, seed, outfits?, tint?, rider?, motion? }.
  // Motion is decorative by default (a random walk on the network). A class can be given non-decorative motion with setMotion().
  function A_() { if (!root.AssetLib) throw new Error('assetlib.js must be loaded before vizlib.js'); return root.AssetLib; }
  function edgeOk(e, network) {
    if (network === 'rail') return e.tram;
    if (network === 'cycle') return e.cycle;
    if (network === 'pavement') return e.pavement > 0;
    return e.cls !== 'cycle' && e.cls !== 'pedestrian' && e.cls !== 'tramway';   // roads: shared with trams where a tram runs along them
  }
  const SPEED = { bicycle: 3.5, cargo_bike: 3.2, moped: 8, motorbike: 8, tram: 9, bus: 7, double_decker: 7, lorry: 6 };

  function createSim(scene, opts) {
    const A = A_();
    opts = Object.assign({ seed: 11, trafficScale: 1, peopleScale: 1, theme: null, family: null, look: undefined, region: 'nw', register: 'colorfigures', drive: null }, opts || {});
    // the theme is every colour the scene needs: AssetLib.theme(family, look, register). A bare family record still works.
    let th = opts.theme;
    if (!th) { if (!opts.family) throw new Error('createSim needs opts.theme, from AssetLib.theme(family, look, register)'); th = A.theme(opts.family, opts.look, opts.register); }
    opts.theme = th; opts.register = th.reg;
    const rg = A.REGIONS[opts.region] || A.REGIONS.nw;
    if (!opts.drive) opts.drive = rg.drive === 'left' ? 'left' : 'right';
    const check = validateScene(scene);
    if (!check.ok) throw new Error('invalid scene: ' + check.errors.slice(0, 3).join('; ') + (check.errors.length > 3 ? ' (and ' + (check.errors.length - 3) + ' more)' : ''));
    const net = buildNetwork(scene);
    const bidx = buildingIndex(scene); for (const e of net.edges) if (e.pavement > 0) e.walk = walkInfo(e, bidx);
    const candBy = {}; for (const nw of ['road', 'cycle', 'rail', 'pavement']) candBy[nw] = net.edges.filter(e => edgeOk(e, nw));
    { const ok = candBy.pavement.filter(isWalkable); if (ok.length) candBy.pavement = ok; }      // people start only where a pavement is clear (all of them if none is)
    const totalLen = net.edges.reduce((s, e) => s + e.len, 0), density = Math.max(1, totalLen / 7500);   // agents scale with the network: 7.5 km is the placeholder's size
    const R = rng(opts.seed);
    const agents = [];
    const pick = arr => arr[Math.floor(R() * arr.length)];
    function spawn(group, kind, def, extra) {
      const cands = candBy[def.network] || [];
      if (!cands.length) return null;
      const edge = pick(cands), seed = (agents.length + 1) * 7919 + opts.seed;
      const a = Object.assign({ group, kind, network: def.network, edge, dir: R() < 0.5 ? 1 : -1, s: R() * edge.len, side: R() < 0.5 ? 1 : -1,
                                speed: (group === 'people' ? 1.3 : (SPEED[kind] || 8)) * (0.85 + R() * 0.3), seed }, extra || {});
      if (group === 'people') settleSide(a);
      agents.push(a); return a;
    }
    const nVeh = Math.min(1500, Math.round(60 * opts.trafficScale * density)), nPeople = Math.min(4000, Math.round(220 * opts.peopleScale * density));
    for (let i = 0; i < nVeh; i++) {
      const kind = A.pickFleet(opts.region, R()), def = A.DEFS.vehicles[kind];
      const seed = (agents.length + 1) * 7919 + opts.seed;
      const a = spawn('vehicles', kind, def, { tint: A.vehicleTint(th, seed), ts: seed });     // ts: the appearance seed, so a theme change can redress the agent
      if (a && def.rider) a.rider = { outfit: A.makeOutfit(opts.region, th, seed + 99), lift: def.riderLift || 0 };
    }
    for (let i = 0; i < Math.round(opts.trafficScale * 3 * Math.sqrt(density)); i++) { const d = A.DEFS.vehicles.van_coop; spawn('vehicles', 'van_coop', d, { tint: th.accents[0], ts: 0 }); }
    const trams = rg.fleet.some(f => f[0] === 'tram') ? Math.round(opts.trafficScale * 2 * Math.sqrt(density)) : 0;
    for (let i = 0; i < trams; i++) spawn('vehicles', 'tram', A.DEFS.vehicles.tram, { tint: th.accents[0], ts: 0 });
    for (let i = 0; i < nPeople; i++) {
      const kind = A.pickPerson(R()), def = A.DEFS.people[kind];
      const seed = (agents.length + 1) * 6151 + opts.seed;
      const outfits = def.members.map((m, k) => A.makeOutfit(opts.region, th, seed + k * 31));
      spawn('people', kind, def, { outfits, speed: 1.1 + R() * 0.4, ts: seed });
    }
    // Buildings are entities too: each carries its footprint fit and, when the footprint fits an asset slot, its asset parameters.
    if (!A.fitFootprint) throw new Error('buildinglib.js must be loaded before vizlib.js');
    const stats = { buildings: scene.buildings.length, assets: 0, extruded: 0, reasons: {} };
    const relief = opts.relief === undefined ? 1 : +opts.relief, T = scene.terrain ? makeTerrain(scene.terrain) : null;     // heights are baked in here, scaled by opts.relief
    let zmax = 0;
    for (const r of scene.roads) if (r.z) for (const z of r.z) zmax = Math.max(zmax, z * relief);
    if (T) zmax = Math.max(zmax, T.hi * relief);
    const rIdx = A.roadIndex(scene.roads);                       // a spatial index, so a city of tens of thousands of buildings stays fast
    const buildings = scene.buildings.map(b => {
      const fit = A.fitFootprint(b.footprint, rIdx), seed = A.hashStr(String(b.id)) ^ opts.seed;
      const kind = (b.archetype && b.archetype !== 'auto' && A.ARCH[b.archetype]) ? b.archetype : A.pickArchetype(opts.region, b.levels, A.hash(seed + 5));
      const bz = (b.z !== undefined ? b.z : (T ? T.at(fit.cx, fit.cy) : 0)) * relief; if (bz > zmax) zmax = bz;
      const e = { src: b, id: b.id, group: 'buildings', kind, seed, fit, z: bz, params: fit.ok ? A.buildingParams(opts.region, kind, b.levels, fit, seed) : null,
                  get state() { return b.state; }, get investor() { return b.investor; }, get levels() { return b.levels; } };
      if (e.params && opts.detail) e.params.fs = Object.assign({}, e.params.fs, { rich: true });   // opt-in detail: roof clutter and varied glazing
      if (e.params) stats.assets++; else { stats.extruded++; stats.reasons[fit.reason] = (stats.reasons[fit.reason] || 0) + 1; }
      return e;
    });
    // Trees are entities too. A tree in the scene is [x, y] or [x, y, kind, scale]; without a kind the region's species mix decides.
    if (!A.pickTree) throw new Error('treelib.js must be loaded before vizlib.js');
    const trees = scene.trees.map((t, i) => {
      const seed = A.hashStr('t' + i) ^ opts.seed, tp = A.treeParams(seed), fixed = !!(t[2] && A.TREES[t[2]]);
      const tz = (t[4] !== undefined && t[4] !== null ? t[4] : (T ? T.at(t[0], t[1]) : 0)) * relief; if (tz > zmax) zmax = tz;
      return { id: 't' + i, group: 'trees', x: t[0], y: t[1], z: tz, seed, v: tp.v, s: t[3] || tp.s, fixed, kind: fixed ? t[2] : A.pickTree(opts.region, A.hash(seed + 1), th) };
    });
    return { scene, net, agents, buildings, trees, stats, rng: R, time: 0, opts, theme: th, palette: th, bindings: [], buildingStyle: null, warnings: check.warnings, density,
             terrain: T, relief, zmax };
  }

  // Swap the theme (register, look) on a running sim: agents are redressed from their stored seeds, so nothing respawns.
  function setTheme(sim, th) {
    const A = A_();
    sim.theme = th; sim.palette = th; sim.opts.theme = th; sim.opts.register = th.reg;
    for (const a of sim.agents) {
      if (a.group === 'vehicles') {
        if (a.ts) a.tint = A.vehicleTint(th, a.ts); else a.tint = th.accents[0];
        if (a.rider) a.rider.outfit = A.makeOutfit(sim.opts.region, th, a.ts + 99);
      } else a.outfits = A.DEFS.people[a.kind].members.map((m, k) => A.makeOutfit(sim.opts.region, th, a.ts + k * 31));
      a._ck = null; a._rc = null;
    }
    for (const e of sim.buildings) { e._ck = null; e._fast = false; e._fv = null; }
    for (const t of sim.trees) { if (!t.fixed) t.kind = A.pickTree(sim.opts.region, A.hash(t.seed + 1), th); t._ck = null; t._asset = null; }
  }

  // Default building style: the Great Retrofit's own mapping from state to appearance.
  // Replace it with sim.buildingStyle = (entity, reg, theme, wall) => ({ data: hex | null, overlays: ['scaffold'|'solar'|'band'|'marker', ...] }).
  function retrofitStyle(e, reg, pal, wall) {
    const A = A_(), s = e.state, ov = []; let data = null;
    if (s === 'finished') { data = reg.states.finished; ov.push('solar'); }
    else if (s === 'in_progress') { data = reg.states.in_progress; ov.push('scaffold'); }
    else if (s === 'queued') { data = A.mix(wall, reg.states.queued, 0.55); ov.push('band'); }
    if (e.investor) ov.push('marker');
    return { data, overlays: ov };
  }

  function matcher(selector) {
    if (typeof selector === 'function') return selector;
    return a => a.kind === selector || a.group === selector;
  }

  // Non-decorative motion for a class of agents.
  //   setMotion(sim, 'bus', { mode: 'static' })
  //   setMotion(sim, 'bus', { mode: 'driven', update(agent, t, dt, sim) { return { x, y, heading } | { edge, s, dir } | null } })
  //   setMotion(sim, 'tram', { mode: 'path', path: [[t, x, y], ...], loop: true })
  //   setMotion(sim, 'bus', null)   // back to decorative
  function setMotion(sim, selector, motion) {
    const m = matcher(selector);
    let n = 0;
    for (const a of sim.agents) if (m(a)) { a.motion = motion || null; if (!motion) a.pose = null; n++; }
    return n;
  }

  // Data binding: colour the data surface of a class from a simulation output.
  //   bindData(sim, 'people', scale, agent => value)
  // scale comes from AssetLib.scales (categorical, sequential, retrofitStates). Returns the legend.
  function bindData(sim, selector, scale, valueFn) {
    sim.bindings = sim.bindings.filter(b => b.key !== String(selector));
    if (scale) sim.bindings.push({ key: String(selector), match: matcher(selector), scale, value: valueFn });
    for (const a of sim.agents) a._ck = null;
    for (const e of sim.buildings || []) { e._ck = null; e._fast = false; }
    for (const e of sim.trees || []) e._ck = null;
    return scale ? scale.legend() : [];
  }

  function stepSim(sim, dt) {
    sim.time += dt;
    for (const a of sim.agents) {
      const mo = a.motion;
      if (mo) {
        if (mo.mode === 'static') continue;
        if (mo.mode === 'driven') {
          const r = mo.update(a, sim.time, dt, sim);
          if (r && r.edge) { a.edge = r.edge; a.s = r.s; a.dir = r.dir; a.pose = null; }
          else a.pose = r || null;
          continue;
        }
        if (mo.mode === 'path') {
          const P = mo.path, T = P[P.length - 1][0];
          let t = mo.loop ? (sim.time % T) : Math.min(sim.time, T), i = 0;
          while (i < P.length - 2 && P[i + 1][0] < t) i++;
          const p0 = P[i], p1 = P[Math.min(i + 1, P.length - 1)], u = p1[0] > p0[0] ? Math.max(0, Math.min(1, (t - p0[0]) / (p1[0] - p0[0]))) : 0;
          a.pose = { x: p0[1] + (p1[1] - p0[1]) * u, y: p0[2] + (p1[2] - p0[2]) * u, heading: Math.atan2(p1[2] - p0[2], p1[1] - p0[1]) };
          continue;
        }
      }
      a.s += a.speed * dt * a.dir;
      const e = a.edge;
      if (a.s < 0 || a.s > e.len) {
        const atNode = a.s > e.len ? e.b : e.a;
        const walker = a.group === 'people';
        let opts = atNode.edges.filter(x => x !== e && edgeOk(x, a.network) && (!walker || isWalkable(x)));
        if (!opts.length && walker && isWalkable(e)) opts = [e];                         // turn round rather than step onto a street whose pavements are blocked
        if (!opts.length && walker) opts = atNode.edges.filter(x => edgeOk(x, a.network) && isWalkable(x));
        if (!opts.length) opts = atNode.edges.filter(x => edgeOk(x, a.network));
        if (!opts.length) opts = [e];
        const ne = pick2(opts, sim.rng);
        a.edge = ne;
        a.dir = (ne.a === atNode) ? 1 : -1;
        a.s = a.dir > 0 ? 0 : ne.len;
        if (walker) settleSide(a);
      }
    }
  }
  function pick2(arr, R) { return arr[Math.floor(R() * arr.length)]; }

  // position and heading of an agent in world coordinates
  function agentPose(a, sim) {
    if (a.pose) return Object.assign({ dx: Math.cos(a.pose.heading), dy: Math.sin(a.pose.heading), z: 0 }, a.pose);
    const e = a.edge;
    const t = Math.max(0, Math.min(1, a.s / e.len));
    const x = e.ax + (e.bx - e.ax) * t, y = e.ay + (e.by - e.ay) * t;
    const ux = (e.bx - e.ax) / e.len, uy = (e.by - e.ay) / e.len;
    const dx = ux * a.dir, dy = uy * a.dir;
    const heading = Math.atan2(dy, dx);
    const driveSign = (sim && sim.opts.drive === 'left') ? -1 : 1;
    let off;
    if (a.group === 'people') off = (e.walk ? e.walk.off[a.dir * a.side > 0 ? 0 : 1] : e.width / 2 + e.pavement * 0.5) * a.side;
    else if (a.network === 'cycle') off = e.width * 0.3 * driveSign;
    else if (a.network === 'rail') off = 0;
    else off = e.width * 0.22 * driveSign;
    let z = 0;                                                     // on the road's own heights if it has them, else on the terrain
    if (e.az !== undefined && sim) z = (e.az + (e.bz - e.az) * t) * sim.relief; else if (sim && sim.terrain) z = sim.terrain.at(x, y) * sim.relief;
    return { x: x - dy * off, y: y + dx * off, heading, dx, dy, z };
  }

  // ---------- rendering ----------
  function sceneBounds(scene) {
    if (scene._bounds) return scene._bounds;
    let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
    const add = p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); };
    for (const r of scene.roads) r.pts.forEach(add);
    for (const b of scene.buildings) b.footprint.forEach(add);
    return (scene._bounds = [x0 - 30, y0 - 30, x1 + 30, y1 + 30]);
  }

  // The tallest ground in a scene, in metres (from its terrain grid and its own z values; 0 for a scene without terrain). The camera leaves room for it.
  function sceneRelief(scene) {
    let m = 0;
    if (scene.terrain && Array.isArray(scene.terrain.z)) for (const z of scene.terrain.z) if (z > m) m = z;
    for (const b of scene.buildings) if (b.z > m) m = b.z;
    for (const r of scene.roads) if (r.z) for (const z of r.z) if (z > m) m = z;
    return m;
  }

  // Ground: a base plane (plots and gardens), a faint grid in the formal register, landuse, then roads with a surface
  // (asphalt, concrete joints, setts, earth tracks) and markings. Surface detail is drawn only when it can be seen.
  // The ground is painted in steps: a generator that yields between landuse polygons and roads, so a layer repaint can be spread over frames
  // (see worldLayer). drawGround runs it to the end.
  function drawGround(ctx, view, scene, th, reg, G) { for (const _ of drawGroundSteps(ctx, view, scene, th, reg, G)); }
  // G, when the sim has terrain: { T (the height grid), relief }. Without it (or with nothing to lift) the ground is drawn flat, as it always was.
  function* drawGroundSteps(ctx, view, scene, th, reg, G) {
    const lod = view.scale >= 4, B = sceneBounds(scene), T = G && G.T, rl = G ? G.relief : 0, lifted = !!T && rl !== 0;
    const P0 = lifted ? (x, y) => proj(view, x, y, T.at(x, y) * rl) : (x, y) => proj(view, x, y, 0), P = P0;
    const reliefCv = T ? yield* drawTerrain(ctx, view, T, rl, th, B) : null;
    if (!T) poly(ctx, [[B[0], B[1]], [B[2], B[1]], [B[2], B[3]], [B[0], B[3]]].map(p => P(p[0], p[1])), th.ground, null, 0);
    if (th.grid && view.scale >= 0.8 && !T) {
      ctx.strokeStyle = th.grid; ctx.lineWidth = 0.6; const g = 20;
      for (let x = Math.ceil(B[0] / g) * g; x <= B[2]; x += g) { const a = P(x, B[1]), b = P(x, B[3]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      for (let y = Math.ceil(B[1] / g) * g; y <= B[3]; y += g) { const a = P(B[0], y), b = P(B[2], y); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    }
    yield;
    let lu = 0;
    for (const l of scene.landuse) {
      const fill = l.kind === 'park' ? th.grass : (l.kind === 'garden' ? mixHex(th.grass, th.ground, 0.3) : (l.kind === 'water' ? th.water : th.plaza));
      poly(ctx, l.footprint.map(p => P(p[0], p[1])), fill, l.kind === 'garden' ? null : reg.ink, reg.lw * 0.5);
      if ((++lu & 7) === 0) yield;
    }
    const cycleLane = th.reg === 'formal' ? A_().CARBON.blue[30] : mixHex(th.grass, '#4aa890', 0.5);
    for (const r of scene.roads) {
      const cls = roadCls(r);
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1];
        const L = Math.hypot(bx - ax, by - ay); if (L < 0.1) continue;
        const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
        // a road's height runs along its centre line (its own z per point, else the terrain's), and is the same across it
        const za = r.z ? r.z[i] * (G ? G.relief : 1) : (lifted ? T.at(ax, ay) * rl : 0), zb = r.z ? r.z[i + 1] * (G ? G.relief : 1) : (lifted ? T.at(bx, by) * rl : 0);
        const P = (za === 0 && zb === 0) ? P0 : (x, y) => { const t = ((x - ax) * ux + (y - ay) * uy) / L; return proj(view, x, y, za + (zb - za) * (t < 0 ? 0 : (t > 1 ? 1 : t))); };
        const hw = cls.width / 2 + cls.pavement, hr = cls.width / 2;
        if (cls.pavement > 0) poly(ctx, [[ax + nx * hw, ay + ny * hw], [bx + nx * hw, by + ny * hw], [bx - nx * hw, by - ny * hw], [ax - nx * hw, ay - ny * hw]].map(p => P(p[0], p[1])), th.pave, null, 0);
        const isTrack = r.class === 'cycle', ped = r.class === 'pedestrian';
        const fill = isTrack ? cycleLane : (ped ? th.pave : (r.class === 'tramway' ? mixHex(th.road, th.grass, 0.35) : th.road));
        poly(ctx, [[ax + nx * hr, ay + ny * hr], [bx + nx * hr, by + ny * hr], [bx - nx * hr, by - ny * hr], [ax - nx * hr, ay - ny * hr]].map(p => P(p[0], p[1])), fill, (cls.pavement > 0 && !ped) ? th.kerb : null, Math.max(0.5, view.scale * 0.1));
        const line = (x0, y0, x1, y1, colour, w, dash, off) => {
          const a = P(x0, y0), b = P(x1, y1); ctx.strokeStyle = colour; ctx.lineWidth = w;
          if (dash) { ctx.setLineDash(dash); ctx.lineDashOffset = off || 0; }
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); if (dash) ctx.setLineDash([]);
        };
        if (lod && !isTrack && !ped && r.class !== 'tramway') {        // surface texture
          if (th.surface === 'concrete') for (let t = 4; t < L; t += 8) line(ax + ux * t - nx * hr, ay + uy * t - ny * hr, ax + ux * t + nx * hr, ay + uy * t + ny * hr, mixHex(th.road, '#000000', 0.12), 0.7);
          else if (th.surface === 'cobble') { let row = 0; for (let o = -hr + 0.9; o < hr - 0.5; o += 1.3, row++) line(ax + nx * o, ay + ny * o, bx + nx * o, by + ny * o, mixHex(th.road, '#000000', 0.18), Math.max(1, view.scale * 0.5), [view.scale * 0.7, view.scale * 0.5], (row % 2) * view.scale * 0.6); }
          else if (th.surface === 'earth') for (const o of [-hr * 0.4, hr * 0.4]) line(ax + nx * o, ay + ny * o, bx + nx * o, by + ny * o, mixHex(th.road, '#000000', 0.14), Math.max(1.5, view.scale * 0.9));
        }
        if (cls.centre === 'dash' && th.surface !== 'earth' && !ped) {
          const n = Math.max(1, Math.floor(L / 5)), w = Math.max(1, view.scale * 0.12);
          for (let k = 0; k < n; k += 2) line(ax + (bx - ax) * k / n, ay + (by - ay) * k / n, ax + (bx - ax) * Math.min(1, (k + 1) / n), ay + (by - ay) * Math.min(1, (k + 1) / n), th.mark, w);
        }
        if (cls.centre === 'median') poly(ctx, [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]].map(p => P(p[0], p[1])), th.median, null, 0);
        if (cls.tram) for (const o of [-2.2, 2.2]) line(ax + nx * o, ay + ny * o, bx + nx * o, by + ny * o, th.rail, Math.max(1, view.scale * 0.2));
        if (cls.cycle && !isTrack && hr >= 3) for (const o of [-hr + 1.2, hr - 1.2]) line(ax + nx * o, ay + ny * o, bx + nx * o, by + ny * o, cycleLane, Math.max(1, view.scale * 0.5));
      }
      yield;
    }
    // square paving: a light grid over each square
    ctx.save(); ctx.globalAlpha = 0.7; ctx.strokeStyle = th.kerb; ctx.lineWidth = 1;
    for (const l of scene.landuse) if (l.kind === 'square') {
      const xs = l.footprint.map(p => p[0]), ys = l.footprint.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (let x = x0 + 8; x < x1; x += 8) { const a = P(x, y0), b = P(x, y1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      for (let y = y0 + 8; y < y1; y += 8) { const a = P(x0, y), b = P(x1, y); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    }
    ctx.restore();
    // relief shading lies over everything on the ground (roads and parks too), so a slope reads the same whatever it is covered with
    if (reliefCv) { ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.drawImage(reliefCv, 0, 0, view.w, view.h); ctx.restore(); }
  }

  // The terrain surface: the grid's cells in painter's order (far to near), each filled with the ground colour at its true height, so the ground
  // stands where the hills are. Returns a canvas of grey relief shading (50% grey is flat; lighter faces the sun, darker faces away; the sun is where
  // the building shadows say it is) that the caller lays over the finished ground with soft-light.
  const RELIEF_GAIN = 24, RELIEF_AMP = 90;          // a 4% slope facing the sun lifts the grey by about 85 of 255 (the shading is stylised: real slopes are gentle)
  function* drawTerrain(ctx, view, T, rl, th, B) {
    const A = A_(), q = A.sprites.dpr || 1, F = A.sprites.factory;
    let sc = null, sg = null;
    if (F) { sc = F(Math.ceil(view.w * q), Math.ceil(view.h * q)); sg = sc.getContext('2d'); sg.scale(q, q); sg.fillStyle = 'rgb(128,128,128)'; sg.fillRect(0, 0, view.w, view.h); }
    // cells of about 18 px a side or less, so a close view is smooth and a far one costs one polygon per grid cell. Neighbouring cells are drawn a hair
    // too big (0.8 px) instead of being outlined: they are painted far to near, so the overlap is covered, and a stroke would double the cost.
    const sub = Math.max(1, Math.min(8, Math.ceil(Math.min(T.dx, T.dy) * view.scale / 18))), cw = T.dx / sub, ch = T.dy / sub;
    const gi0 = Math.floor((B[0] - T.x0) / cw), gi1 = Math.ceil((B[2] - T.x0) / cw), gj0 = Math.floor((B[1] - T.y0) / ch), gj1 = Math.ceil((B[3] - T.y0) / ch);
    const i0 = Math.max(0, gi0), i1 = Math.min((T.nx - 1) * sub, gi1), j0 = Math.max(0, gj0), j1 = Math.min((T.ny - 1) * sub, gj1);
    const pad = 4, W = view.w, H = view.h, k = view.scale, grow = 1 + 0.8 / Math.max(1, cw * k * C30);
    const LX = 0.94, LY = -0.34, n = i1 - i0 + 1;
    ctx.fillStyle = th.ground;
    if (n < 2 || j1 <= j0) return sc;
    let prev = new Float32Array(n), next = new Float32Array(n);
    const row = (arr, j) => { const y = T.y0 + j * ch; for (let i = 0; i < n; i++) arr[i] = T.at(T.x0 + (i0 + i) * cw, y); };     // true heights (metres) of one row of corners
    row(prev, j0);
    for (let j = j0; j < j1; j++) {
      row(next, j + 1);
      const y0 = T.y0 + j * ch, y1 = y0 + ch;
      for (let i = 0; i < n - 1; i++) {
        const x0 = T.x0 + (i0 + i) * cw, x1 = x0 + cw, h00 = prev[i], h10 = prev[i + 1], h01 = next[i], h11 = next[i + 1];
        const ax = view.ox + (x0 - y0) * k * C30, ay = view.oy + (x0 + y0) * k * 0.5 - h00 * rl * k,
              bx = view.ox + (x1 - y0) * k * C30, by = view.oy + (x1 + y0) * k * 0.5 - h10 * rl * k,
              cx = view.ox + (x1 - y1) * k * C30, cy = view.oy + (x1 + y1) * k * 0.5 - h11 * rl * k,
              dx = view.ox + (x0 - y1) * k * C30, dy = view.oy + (x0 + y1) * k * 0.5 - h01 * rl * k;
        if ((ax < -pad && bx < -pad && cx < -pad && dx < -pad) || (ax > W + pad && bx > W + pad && cx > W + pad && dx > W + pad) ||
            (ay < -pad && by < -pad && cy < -pad && dy < -pad) || (ay > H + pad && by > H + pad && cy > H + pad && dy > H + pad)) continue;
        const mx = (ax + bx + cx + dx) / 4, my = (ay + by + cy + dy) / 4;
        const pa = [mx + (ax - mx) * grow, my + (ay - my) * grow], pb = [mx + (bx - mx) * grow, my + (by - my) * grow], pc = [mx + (cx - mx) * grow, my + (cy - my) * grow], pd = [mx + (dx - mx) * grow, my + (dy - my) * grow];
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.lineTo(pc[0], pc[1]); ctx.lineTo(pd[0], pd[1]); ctx.closePath(); ctx.fill();
        if (sg) {
          const gx = ((h10 + h11) - (h00 + h01)) / (2 * cw), gy = ((h01 + h11) - (h00 + h10)) / (2 * ch);            // slope east and south, from the four corners
          const sh = Math.max(-1, Math.min(1, -(gx * LX + gy * LY) * RELIEF_GAIN)), g = Math.round(128 + sh * RELIEF_AMP);
          sg.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
          sg.beginPath(); sg.moveTo(pa[0], pa[1]); sg.lineTo(pb[0], pb[1]); sg.lineTo(pc[0], pc[1]); sg.lineTo(pd[0], pd[1]); sg.closePath(); sg.fill();
        }
      }
      const t = prev; prev = next; next = t;
      if (((j - j0) & 7) === 7) yield;
    }
    return sc;
  }

  function buildingDepth(b) {
    let cx = 0, cy = 0; b.footprint.forEach(p => { cx += p[0]; cy += p[1]; });
    return (cx / b.footprint.length + cy / b.footprint.length);
  }

  // ---------- occlusion culling ----------
  // Items are drawn back to front, so an item is wasted work when later items cover every pixel it would change. This walks the sorted
  // list front to back with a one byte per pixel coverage grid. An item is skipped when every pixel its sprite (and ground shadow)
  // can touch is already covered by fully opaque pixels of nearer buildings. Survivors that are buildings then add their own opaque
  // pixels. The test is conservative (alpha 255 only, the touched area widened by a pixel), so the picture is the same pixel for pixel.
  // It needs sprites cached at the view's exact scale, so it does nothing until the view has held still, and it skips any item whose
  // sprite or colours may be stale this frame (a state change, a binding, a custom style). Opt in with sim.opts.occlusion = true.
  // The coverage grid has one byte per CELL x CELL block of device pixels. A cell is set only when opaque pixels cover all of it.
  const CELL = 4;
  function rectCovered(g, GW, GH, x0, y0, x1, y1) {
    const cx0 = Math.max(0, Math.floor(x0 / CELL)), cy0 = Math.max(0, Math.floor(y0 / CELL)), cx1 = Math.min(GW - 1, Math.floor(x1 / CELL)), cy1 = Math.min(GH - 1, Math.floor(y1 / CELL));
    for (let y = cy0; y <= cy1; y++) for (let i = y * GW + cx0, e = y * GW + cx1; i <= e; i++) if (!g[i]) return false;
    return true;
  }
  function rowCovered(g, GW, GH, m, X, Y, r) {
    const gy = Y + r, lo = m.t0[r]; if (lo < 0 || gy < 0) return true;
    const cy = Math.floor(gy / CELL); if (cy >= GH) return true;
    const xa = Math.max(0, Math.floor((X + lo) / CELL)), xb = Math.min(GW - 1, Math.floor((X + m.t1[r]) / CELL));
    for (let i = cy * GW + xa, e = cy * GW + xb; i <= e; i++) if (!g[i]) return false;
    return true;
  }
  function maskCovered(g, GW, GH, m, X, Y) {
    if (m.ry1 < 0) return true;                                        // nothing is drawn at all
    if (!rowCovered(g, GW, GH, m, X, Y, (m.ry0 + m.ry1) >> 1)) return false;   // a visible item usually fails on its middle row
    for (let r = m.ry0; r <= m.ry1; r++) if (!rowCovered(g, GW, GH, m, X, Y, r)) return false;
    return true;
  }
  function markSolid(g, GW, GH, m, X, Y) {
    const r = m.rects;
    for (let k = 0; k < r.length; k += 4) {
      const cx0 = Math.max(0, Math.ceil((X + r[k]) / CELL)), cx1 = Math.min(GW, Math.floor((X + r[k + 2]) / CELL));
      const cy0 = Math.max(0, Math.ceil((Y + r[k + 1]) / CELL)), cy1 = Math.min(GH, Math.floor((Y + r[k + 3]) / CELL));
      if (cx1 <= cx0) continue;
      for (let cy = cy0; cy < cy1; cy++) g.fill(1, cy * GW + cx0, cy * GW + cx1);
    }
  }
  function cullHidden(items, sim, view, layers, pal) {
    const A = A_(), q = A.sprites.dpr || 1, W = Math.ceil(Math.ceil(view.w * q) / CELL), H = Math.ceil(Math.ceil(view.h * q) / CELL);
    const areg = A.REG[pal.reg] || A.REG.colorfigures, sareg = A.REG[sim.opts.register] || A.REG.colorfigures;
    let g = sim._occ; if (!g || g.length !== W * H) g = sim._occ = new Uint8Array(W * H); else g.fill(0);
    const plain = !sim.buildingStyle && !sim.bindings.length;             // with a style or a binding, colours and overlays may be stale
    const keep = new Array(items.length); let culled = 0, tested = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]; let place = null, shadow = null;
      if (it.kind === 'b') {
        const e = it.o;
        if (plain && e._asset && e._fast && e._th === pal && e._st === e.state && e._inv === e.investor && e._cols) {
          const p = proj(view, e.fit.cx, e.fit.cy, e.z); place = A.spritePlacement(e._asset, e._cols, areg, p[0], p[1], view.scale);
        }
      } else if (it.kind === 't') {
        const e = it.o;
        if (plain && e._asset && e._cols && e._ck === pal.famId + '/' + pal.lookId + '/' + pal.reg + '|' + e.kind + '|' + null) {
          const p = proj(view, e.x, e.y, e.z); place = A.spritePlacement(e._asset, e._cols, areg, p[0], p[1], view.scale);
          if (place) { const bb = e._asset.bbox, w = (bb.maxX - bb.minX) * view.scale, rx = Math.max(2, w * 0.36), ry = Math.max(1, w * 0.13); shadow = [(p[0] - rx - 1) * q, (p[1] - ry - 1) * q, (p[0] + rx + 1) * q, (p[1] + ry + 1) * q]; }
        }
      } else if (it.kind === 'a') {
        const a = it.o;
        if (plain && !a.rider && (a.group === 'people' ? view.scale >= 1.6 : view.scale >= 0.9)) {
          const h = A.snapHeading(it.pose.heading), p = proj(view, it.pose.x, it.pose.y, it.pose.z), sc = view.scale * (a.group === 'people' ? A.STYLE.person : A.STYLE.vehicle);
          const asset = a.group === 'vehicles' ? A.getAsset('vehicles', a.kind, h) : A.getAsset('people', a.kind, h, A.flagsOf(a.outfits));
          const cols = agentColours(sim, a, sareg);
          place = A.spritePlacement(asset, cols, sareg, p[0], p[1], sc);
          if (place) { const bb = asset.bbox, w = (bb.maxX - bb.minX) * sc, rx = Math.max(2, w * 0.42), ry = Math.max(1, w * 0.15); shadow = [(p[0] - rx - 1) * q, (p[1] - ry - 1) * q, (p[0] + rx + 1) * q, (p[1] + ry + 1) * q]; }
        }
      }
      if (place) {
        tested++;
        if (maskCovered(g, W, H, place.mask, place.x, place.y) && (!shadow || rectCovered(g, W, H, shadow[0], shadow[1], shadow[2], shadow[3]))) { culled++; continue; }
        if (it.kind === 'b') markSolid(g, W, H, place.mask, place.x, place.y);
      }
      keep[i] = true;
    }
    sim.occlusionStats = { tested, culled, items: items.length };
    if (!culled) return items;
    const out = []; for (let i = 0; i < items.length; i++) if (keep[i]) out.push(items[i]);
    return out;
  }

  // At most SPRITE_BUILDS_PER_FRAME sprites are rebuilt at the exact scale in one frame, so a settled view sharpens over a few frames
  // instead of stalling on one.
  const SPRITE_BUILDS_PER_FRAME = 60;
  // A building whose colours or overlays change gets a new asset (vector parts, about 0.2 ms each) and then a new sprite. Drawing buildings one by one, at most RESTYLES_PER_FRAME of them are
  // restyled in a frame (sim.opts.restyleBudget); the rest keep their last picture until a later frame, so a month that recolours 400 buildings is a sweep over a few frames, not one 120 ms frame (paperdolls#18).
  const RESTYLES_PER_FRAME = 64;
  let restyleLeft = Infinity;                          // the restyles left in this frame; Infinity outside the one-by-one draw (the far layer paints exactly)
  const BUILD_MS_PER_FRAME = 8;                      // wall time a frame may spend building sprites (at least one is always built)
  const PREWARM_MS = 4;                              // and pre-rendering neighbouring levels while the view is still
  const PREWARM_STILL_FRAMES = 8;                    // frames the view must not have moved before neighbouring levels are pre-rendered
  const PREWARM_PER_FRAME = 12;                      // while the view is still and fully sharp: sprites pre-rendered for the neighbouring zoom levels, per frame
  const ZOOM_BUILDS_PER_FRAME = 16;                  // while the zoom is changing: about 6 ms of sprite building, then scaled sprites are used
  const OCCLUSION_MIN_ITEMS = 300;
  // Opt-in finish (colorfigures only): sim.opts.pixel = n (2 or more) draws the scene at 1/n resolution and upscales it with nearest-neighbour, so
  // every pixel is n by n and the ink is one logical pixel wide; sim.opts.posterize = step rounds each colour channel to a multiple of step (at the
  // low resolution, so it is cheap); sim.opts.fog = true lays a cool haze toward the top of the screen and darkens the edges. Fog is two gradient
  // fills. The low-resolution frame has no grain, because at that size grain reads as noise.
  const clockNow = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  function renderFrame(ctx, sim, view, layers) {
    const A = A_(), o = sim.opts, finish = sim.theme.reg !== 'formal';
    const ps = finish && A.sprites.factory && o.pixel > 1 ? o.pixel : 1;
    A.sprites.posterize = ps > 1 && o.posterize > 1 ? o.posterize : 0;
    A.sprites.grain = ps === 1; A.sprites.minDetail = ps > 1 ? 1.25 : 2.5;
    A.sprites.frame++; A.sprites.builds = 0; A.sprites.maxBuilds = SPRITE_BUILDS_PER_FRAME; A.sprites.maxZoomBuilds = ZOOM_BUILDS_PER_FRAME;
    A.sprites.frameStart = clockNow(); A.sprites.maxBuildMs = sim.opts.buildMs === undefined ? BUILD_MS_PER_FRAME : sim.opts.buildMs;
    try {
      if (ps === 1) renderFrameInner(ctx, sim, view, layers);
      else {
        const iw = Math.ceil(view.w / ps), ih = Math.ceil(view.h / ps);
        let P = sim._px; if (!P || P.w !== iw || P.h !== ih) { const cv = A.sprites.factory(iw, ih); P = sim._px = { cv, c: cv.getContext('2d', { willReadFrequently: true }), w: iw, h: ih }; }
        const dpr = A.sprites.dpr; A.sprites.dpr = 1;                       // the low-resolution frame is drawn at device scale 1 and magnified once
        try { renderFrameInner(P.c, sim, { w: iw, h: ih, scale: view.scale / ps, ox: view.ox / ps, oy: view.oy / ps }, layers); } finally { A.sprites.dpr = dpr; }
        ctx.save(); ctx.imageSmoothingEnabled = o.pixelSmooth === true; ctx.drawImage(P.cv, 0, 0, iw * ps, ih * ps); ctx.restore();
      }
      if (finish && o.fog) drawFog(ctx, sim.theme, view);
      const warm = sim._warm;
      A.sprites.warmBuilds = 0;
      if (A.sprites.collect && A.sprites.builds === 0 && ps === 1) { A.sprites.warmBuilds = A.prewarm(view.scale, PREWARM_PER_FRAME, sim.opts.prewarmMs === undefined ? PREWARM_MS : sim.opts.prewarmMs); warm.done = A.sprites.warmBuilds === 0; }
      A.sprites.collect = null;
    } finally { A.sprites.maxBuilds = Infinity; A.sprites.maxZoomBuilds = Infinity; A.sprites.maxBuildMs = Infinity; }
  }
  // The haze is painted once into a canvas the size of the view and blitted each frame.
  function drawFog(ctx, pal, view) {
    const A = A_(), key = [view.w, view.h, pal.bg, pal.shadow].join('|');
    let F = drawFog.cache;
    if (!F || F.key !== key) {
      const hz = mixHex(pal.bg, '#c8d8ee', 0.7).match(/\d+/g).map(Number), sh = hexRgb(pal.shadow), cv = A.sprites.factory(Math.ceil(view.w), Math.ceil(view.h)), c = cv.getContext('2d');
      let g = c.createLinearGradient(0, 0, 0, view.h); g.addColorStop(0, 'rgba(' + hz.join(',') + ',0.42)'); g.addColorStop(0.55, 'rgba(' + hz.join(',') + ',0)');
      c.fillStyle = g; c.fillRect(0, 0, view.w, view.h);
      g = c.createRadialGradient(view.w / 2, view.h / 2, view.h * 0.45, view.w / 2, view.h / 2, view.w * 0.62); g.addColorStop(0, 'rgba(' + sh.join(',') + ',0)'); g.addColorStop(1, 'rgba(' + sh.join(',') + ',0.28)');
      c.fillStyle = g; c.fillRect(0, 0, view.w, view.h);
      F = drawFog.cache = { key, cv };
    }
    ctx.drawImage(F.cv, 0, 0, view.w, view.h);
  }
  function renderFrameInner(ctx, sim, view, layers) {
    layers = Object.assign({ buildings: true, vehicles: true, people: true, trees: true }, layers || {});
    const A = A_(), pal = sim.theme, reg = A.REG[pal.reg] || A.REG.colorfigures;
    // once the zoom has held still for two frames, sprites are drawn at the exact scale (see AssetLib.sprites.exact)
    const zs = sim._zoom || (sim._zoom = { scale: NaN, still: 0 });
    if (zs.scale === view.scale) zs.still++; else { if (zs.scale === zs.scale) zs.moved = true; zs.scale = view.scale; zs.still = 0; }       // moved: the scale has changed at least once (not just the first frame)
    A.sprites.exact = zs.still >= 2; A.sprites.zooming = zs.still < 2 && zs.moved;
    // pre-render and hold: once this scale is sharp, the frame notes the sprites it draws and renderFrame builds the neighbouring levels for them
    const warm = sim._warm || (sim._warm = {});
    if (warm.scale !== view.scale) { warm.scale = view.scale; warm.done = false; }
    // only a view that is truly still is pre-rendered for: a pan costs enough already, and the sprites it reveals are a new set to look at once it stops
    if (warm.ox !== view.ox || warm.oy !== view.oy) { warm.ox = view.ox; warm.oy = view.oy; warm.still = 0; warm.done = false; } else warm.still = (warm.still || 0) + 1;
    A.sprites.collect = (A.sprites.exact && !warm.done && warm.still >= PREWARM_STILL_FRAMES && sim.opts.prewarm !== false) ? new Map() : null;
    // the whole view (scale and offset) unchanged for a few frames: cached layers are then repainted exactly if they are off by a fraction of a pixel
    if (zs.ox === view.ox && zs.oy === view.oy && zs.vscale === view.scale) zs.stillView = (zs.stillView || 0) + 1; else { zs.ox = view.ox; zs.oy = view.oy; zs.vscale = view.scale; zs.stillView = 0; }
    windowLodPx = sim.opts.windowLodPx === undefined ? WINDOW_LOD_PX : sim.opts.windowLodPx;
    const detail = sim.opts.detail === true && pal.reg !== 'formal';
    A.sprites.detail = detail; A.sprites.ink = sim.opts.ink === true && pal.reg !== 'formal';
    const shadow = mixHex(pal.shadow, pal.bg, 0.72);
    const sRgb = hexRgb(pal.shadow);
    const heightOfEntity = entityHeight;
    // The ground and the building shadows do not change between frames. They are drawn once into a cached layer that is bigger than the
    // screen and anchored to the world, so panning only moves a window over it (see worldLayer).
    const drawStaticSteps = function* (c, v) {
      c.fillStyle = pal.bg; c.fillRect(0, 0, v.w, v.h); c.lineJoin = 'round';
      yield* drawGroundSteps(c, v, sim.scene, pal, reg, { T: sim.terrain, relief: sim.relief });
      let nb = 0;
      if (layers.buildings) for (const e of sim.buildings) {
        if ((++nb & 31) === 0) yield;
        const b = e.src, H = heightOfEntity(e), ez = e.z, q = proj(v, b.footprint[0][0], b.footprint[0][1], ez);
        if (q[0] < -v.w * 0.5 - H * v.scale || q[0] > v.w * 1.5 + H * v.scale || q[1] < -v.h * 0.5 - H * v.scale || q[1] > v.h * 1.5 + H * v.scale) continue;
        if (detail && v.scale >= 0.6) {                // soft contact shadow: a longer, fainter cast shadow, then three stepped rings around the footprint
          poly(c, b.footprint.map(p => proj(v, p[0] - H * 0.55, p[1] + H * 0.19, ez)), 'rgba(' + sRgb.join(',') + ',0.16)', null, 0);
        }
        poly(c, b.footprint.map(p => proj(v, p[0] - H * 0.35, p[1] + H * 0.12, ez)), shadow, null, 0);
        if (detail && v.scale >= 0.6) {
          let cx = 0, cy = 0; for (const p of b.footprint) { cx += p[0]; cy += p[1]; } cx /= b.footprint.length; cy /= b.footprint.length;
          for (const g of [3.0, 1.8, 0.8]) poly(c, b.footprint.map(p => { const dx = p[0] - cx, dy = p[1] - cy, L = Math.hypot(dx, dy) || 1; return proj(v, p[0] + dx / L * g, p[1] + dy / L * g, ez); }), 'rgba(' + sRgb.join(',') + ',0.10)', null, 0);
        }
      }
    };
    const drawStatic = (c, v) => { for (const _ of drawStaticSteps(c, v)); };
    const F = A.sprites.factory, gkey = [view.w, view.h, pal.famId, pal.lookId, pal.reg, pal.surface, layers.buildings, detail, A.sprites.ink, A.sprites.posterize].join('|');
    const settled = zs.stillView >= 3, zooming = zs.still < 2;
    if (F && sim.opts.cacheGround !== false) worldLayer(ctx, sim, '_ground', view, gkey, settled, zooming, drawStatic, pal.bg, drawStaticSteps, view.scale < 1.0, (c, v) => groundCoarse(c, v, sim, pal));      // far out (below 1 px/m) a missing ground is first painted flat, then exactly in slices
    else drawStatic(ctx, view);
    if (sim.groundTint) drawGroundTint(ctx, sim, view);                    // under the buildings and agents, over the ground and shadows
    if (sim.groundMarks) drawGroundMarks(ctx, sim, view);                  // the zoomed-out form of the outline and halo channels: a hatch on the ground
    // What can be seen at a view: buildings and trees (and the fountain) that reach it, and the agents. Anything whose screen bounds
    // miss the canvas is skipped (viewport culling).
    const collectStatic = (v, out) => {
      const pad = v.scale * 12;
      if (layers.buildings) for (let bi = 0; bi < sim.buildings.length; bi++) {
        const e = sim.buildings[bi], H = heightOfEntity(e) * v.scale; let vis = false;
        for (const p of e.src.footprint) { const q = proj(v, p[0], p[1], e.z); if (q[0] > -pad && q[0] < v.w + pad && q[1] > -pad && q[1] < v.h + pad + H) { vis = true; break; } }
        if (vis) out.push({ d: e.fit.cx + e.fit.cy + e.z, kind: 'b', o: e, i: bi });       // i: the building's index in sim.buildings (the far layer's signature table is indexed by it)
      }
      if (layers.trees) for (const t of sim.trees) {
        const q = proj(v, t.x, t.y, t.z), H = A.treeHeight(t.kind, t.s) * v.scale;
        if (q[0] > -pad && q[0] < v.w + pad && q[1] > -pad && q[1] < v.h + pad + H) out.push({ d: t.x + t.y + t.z + 0.5, kind: 't', o: t });
      }
      for (const l of sim.scene.landuse) if (l.kind === 'square') {
        let cx = 0, cy = 0; l.footprint.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= l.footprint.length; cy /= l.footprint.length;
        const fz = sim.terrain ? sim.terrain.at(cx, cy) * sim.relief : 0;
        out.push({ d: cx + cy + fz, kind: 'fountain', o: [cx, cy, fz] });
      }
      return out;
    };
    const collectAgents = (out) => {
      const pad = view.scale * 12;
      for (const a of sim.agents) {
        if (a.group === 'people' ? !layers.people : !layers.vehicles) continue;
        const pose = agentPose(a, sim), z = pose.z, p = proj(view, pose.x, pose.y, z);
        if (!(p[0] > -pad && p[0] < view.w + pad && p[1] > -pad && p[1] < view.h + pad)) continue;
        out.push({ d: pose.x + pose.y + z, kind: 'a', o: a, pose });
      }
      return out;
    };
    const drawItem = (target, it, v) => {
      if (it.kind === 'b') drawBuildingEntity(target, v, reg, pal, shadow, sim, it.o);
      else if (it.kind === 'fountain') drawFountain(target, v, pal, reg, it.o[0], it.o[1], it.o[2]);
      else if (it.kind === 't') drawTreeEntity(target, v, sim, it.o, pal, reg, shadow);
      else drawAgent(target, v, reg, shadow, sim, it.o, it.pose, layers);
    };
    const drawItems = (target, list, v) => { for (const it of list) drawItem(target, it, v); };
    const byDepth = (p, q) => p.d - q.d;
    // Zoomed far out nothing in the buildings and trees changes from frame to frame, so they are drawn once into a world-anchored layer
    // and blitted; only vehicles (dots at this zoom) are drawn on top. The layer is redrawn when the scale, the theme or any building's
    // state changes, or when panning runs past its margin. A binding can change colours at any moment, so it switches the layer off; so does a
    // custom building style, unless the style publishes a frame version (see below).
    // A custom style that publishes sim.frameVersion (a number it bumps whenever any building's style may have changed, as the pack store does) promises
    // that it returns the same style for a building until the number changes. The layer is then keyed on that number instead of being switched off.
    const versioned = !!sim.buildingStyle && typeof sim.frameVersion === 'number';
    const far = view.scale < 1.0 && F && sim.opts.cacheGround !== false && !sim.bindings.length && (!sim.buildingStyle || versioned);
    if (far) {
      // The data signature of the frame: changes whenever any building's colour may have changed. (A version number, or a hash of the states.)
      let h = 0;
      if (versioned) h = 'v' + sim.frameVersion;
      else for (const e of sim.buildings) h = (h * 31 + (e.state ? e.state.charCodeAt(0) : 0) * 2 + (e.investor ? 1 : 0)) | 0;
      // INCREMENTAL: the layer is not repainted for a new signature. farPatch finds the buildings whose style changed and repaints only the small cells they touch (see
      // FAR LAYER, below). sim.opts.farPatch = false (or posterize, which needs the whole picture) keys the layer on the signature as before: a changed colour repaints it all.
      const incremental = sim.opts.farPatch !== false && !A.sprites.posterize;
      const skey = gkey + '|' + layers.trees + (incremental ? '' : '|' + h);
      // a building's signature: what decides its colour. The style object itself when the style is versioned (a shared object per distinct look), else the state and owner.
      const sigOf = versioned ? (e => sim.buildingStyle(e)) : (e => (e.state ? e.state.charCodeAt(0) : 0) * 2 + (e.investor ? 1 : 0));
      // painted in slices (a yield every 16 items); until it is ready the picture is the coarse one (or the buildings are drawn directly). The sprite exact flag is not part of the
      // key: it flipped when the view settled and repainted the whole layer a second time for nothing. The generator returns what it painted (items, signatures, layer view).
      const farSteps = function* (c, v) {
        c.lineJoin = 'round'; let n = 0; const items = collectStatic(v, []).sort(byDepth), sigs = new Array(sim.buildings.length);
        for (const it of items) { drawItem(c, it, v); if (it.kind === 'b') sigs[it.i] = sigOf(it.o); if ((++n & 15) === 0) yield; }
        return { items, sigs, v };
      };
      const farOnce = (c, v) => { const g = farSteps(c, v); for (;;) { const r = g.next(); if (r.done) return r.value; } };
      const coarse = (c, v) => farCoarse(c, v, sim, pal, reg, A.REG[pal.reg] || A.REG.colorfigures, layers);
      if (incremental) farPatch(sim, view, skey, h, sigOf, drawItem, sim.opts.layerMs === undefined ? LAYER_MS : sim.opts.layerMs);
      const drew = worldLayer(ctx, sim, '_far', view, skey, settled, zooming, farOnce, null, farSteps, true, coarse);
      if (drew) {
        const agents = collectAgents([]).sort(byDepth);
        drawItems(ctx, agents, view);
        return;
      }
    }
    // items sorted back to front
    let items = collectAgents(collectStatic(view, [])).sort(byDepth);
    // occlusion culling: off unless sim.opts.occlusion is true. It draws the same picture, but on every scene measured it costs more time
    // than the draws it saves (see viz/README.md), so it is opt-in.
    if (sim.opts.occlusion === true && A.sprites.exact && F && items.length >= (sim.opts.occlusionMin || OCCLUSION_MIN_ITEMS)) items = cullHidden(items, sim, view, layers, pal);
    else sim.occlusionStats = null;
    restyleLeft = sim.opts.restyleBudget === undefined ? RESTYLES_PER_FRAME : sim.opts.restyleBudget;
    A.sprites.staleOk = true;
    try { drawItems(ctx, items, view); } finally { restyleLeft = Infinity; A.sprites.staleOk = false; }
  }

  // A layer that is cached in a canvas bigger than the screen (LAYER_MARGIN of the view on every side) and anchored to the world.
  // Panning only changes which window of it is blitted, so a pan frame costs one drawImage. While the zoom is changing, the old layer is
  // drawn scaled instead of being repainted at every step (a little soft, then exact once the zoom stops).
  // The layer is repainted when its key changes (theme, state, or the scale once it has held still), when the view has moved further than
  // the margin, and once after a pan has ended with a fractional shift, so a still picture is always exact.
  // skey describes everything but the scale. paint(ctx, v) draws the layer for the enlarged view v. bg, if given, is filled first when
  // the scaled layer does not cover the screen.
  const LAYER_MARGIN = 0.4;
  // The old layer drawn scaled to the current view (a zoom, or a repaint still in progress). Only the part that lands on the screen is resampled.
  function blitScaled(ctx, view, L, q, bg) {
    const r = view.scale / L.scale;
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, view.w, view.h); }
    // u is a layer position in css pixels, x a screen position
    const cw = L.cv.width / q, ch = L.cv.height / q;
    let u0 = (0 - view.ox) / r + L.mw + L.ox, u1 = (view.w - view.ox) / r + L.mw + L.ox, v0 = (0 - view.oy) / r + L.mh + L.oy, v1 = (view.h - view.oy) / r + L.mh + L.oy;
    u0 = Math.max(0, u0); v0 = Math.max(0, v0); u1 = Math.min(cw, u1); v1 = Math.min(ch, v1);
    if (u1 > u0 && v1 > v0) ctx.drawImage(L.cv, u0 * q, v0 * q, (u1 - u0) * q, (v1 - v0) * q, view.ox + (u0 - L.mw - L.ox) * r, view.oy + (v0 - L.mh - L.oy) * r, (u1 - u0) * r, (v1 - v0) * r);
  }
  // A layer canvas is 40 to 50 MB on a large screen. Allocating one for every repaint churns memory (and the garbage collector is slow to give it back),
  // so the canvas of the layer that was just replaced is kept as a spare and reused for the next, when the size is the same.
  function layerCanvas(sim, slot, w, h) {
    const sp = sim[slot + 'Spare']; sim[slot + 'Spare'] = null;
    if (sp && sp.width === w && sp.height === h) { const c = sp.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h); return sp; }
    return A_().sprites.factory(w, h);
  }
  const LAYER_STAND_IN = [0.15, 8];                  // the old layer, scaled, may stand in for a new one this far either way: no blurrier than the zoom just before it
  const layerMsBase = sim => sim.opts.layerMs === undefined ? LAYER_MS : sim.opts.layerMs;
  const COARSE_MS = 20;                              // wall time a frame may spend completing a rough (first) picture; the exact layer is sliced at LAYER_MS in the same frame
  const LAYER_MS = 6;                                // wall time a frame may spend painting a layer in slices
  const layerClock = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  // Returns true when it drew the layer. With steps and softStart, a layer that does not exist yet is started in slices and false is returned, so the
  // caller draws the frame another way until it is ready.
  function worldLayer(ctx, sim, slot, view, skey, settled, zooming, paint, bg, steps, softStart, coarse) {
    const A = A_(), q = A.sprites.dpr || 1, sc = view.scale.toFixed(4);
    let L = sim[slot], sx = 0, sy = 0;
    if (L && L.skey === skey && L.sc !== sc && zooming) {
      const r = view.scale / L.scale;
      if (r > LAYER_STAND_IN[0] && r < LAYER_STAND_IN[1]) { blitScaled(ctx, view, L, q, bg); return true; }
    }
    // FIRST PAINT. A layer that does not exist yet and has a coarse painter (opts.coarse) gets a rough layer at once: one cheap pass, so the screen is never empty and no
    // frame waits for the exact painting. The layer is marked `rough`, which makes it out of date for the slicer below, so the exact one starts being painted in slices
    // behind it and replaces it when whole.
    if (!L && coarse && steps && softStart && sim.opts.sliceLayers !== false && sim.opts.coarseFirst !== false) {
      const mw = Math.ceil(view.w * LAYER_MARGIN), mh = Math.ceil(view.h * LAYER_MARGIN);
      const cv = layerCanvas(sim, slot, Math.ceil((view.w + 2 * mw) * q), Math.ceil((view.h + 2 * mh) * q)), c = cv.getContext('2d');
      c.scale(q, q); const g = coarse(c, { w: view.w + 2 * mw, h: view.h + 2 * mh, scale: view.scale, ox: view.ox + mw, oy: view.oy + mh });
      L = sim[slot] = { skey, sc, scale: view.scale, cv, ox: view.ox, oy: view.oy, mw, mh, rough: true, info: null };
      if (g && typeof g.next === 'function') sim[slot + 'C'] = { gen: g, L };        // a coarse painter that yields is stepped COARSE_MS a frame below, until it is done
      sim.layerRoughPaints = (sim.layerRoughPaints || 0) + 1;
    }
    // A coarse painter still running (this layer's rough picture is being completed): step it. It is dropped when the layer it paints is gone.
    const C = sim[slot + 'C'];
    if (C) {
      if (C.L !== sim[slot]) sim[slot + 'C'] = null;
      else { const t0 = layerClock(); do { if (C.gen.next().done) { sim[slot + 'C'] = null; break; } } while (layerClock() - t0 < COARSE_MS); }
    }
    // The layer is out of date and the zoom has stopped (the scale or the key has changed), or it does not exist and softStart is set: the new one is
    // painted a slice per frame into a second canvas while the old one, scaled, keeps the picture on screen, and is swapped in when it is whole.
    // (Painting it in one go cost 35 to 50 ms for the ground, and 275 ms for the far layer, in a browser.) The old layer stands in only within
    // LAYER_STAND_IN. Otherwise, and for a pan past the margin, it is painted at once as before.
    const outOfDate = L && (L.rough || (L.skey === skey && L.sc !== sc) || (L.skey !== skey && L.sc === sc));
    if (steps && sim.opts.sliceLayers !== false && !sim[slot + 'C'] && (outOfDate || (!L && softStart))) {      // (not while the rough picture is still being completed: it gets the frame's time first)
      const r = L ? view.scale / L.scale : 1;
      if (!L || (r > LAYER_STAND_IN[0] && r < LAYER_STAND_IN[1])) {
        let p = sim[slot + 'P'];
        if (!p || p.sc !== sc || p.skey !== skey) {
          const mw = Math.ceil(view.w * LAYER_MARGIN), mh = Math.ceil(view.h * LAYER_MARGIN);
          if (p) sim[slot + 'Spare'] = p.cv;               // an abandoned repaint: its canvas is free again
          const cv = layerCanvas(sim, slot, Math.ceil((view.w + 2 * mw) * q), Math.ceil((view.h + 2 * mh) * q)), c = cv.getContext('2d'); c.scale(q, q);
          p = sim[slot + 'P'] = { skey, sc, scale: view.scale, cv, ox: view.ox, oy: view.oy, mw, mh, gen: steps(c, { w: view.w + 2 * mw, h: view.h + 2 * mh, scale: view.scale, ox: view.ox + mw, oy: view.oy + mh }), done: false };
        }
        const budget = sim.opts.layerMs === undefined ? LAYER_MS : sim.opts.layerMs, t0 = layerClock();
        do { const r = p.gen.next(); if (r.done) { p.done = true; p.info = r.value || null; break; } } while (layerClock() - t0 < budget);
        if (p.done) {
          if (A.sprites.posterize) A.quantise(p.cv, A.sprites.posterize);
          if (L && L.cv !== p.cv) sim[slot + 'Spare'] = L.cv;
          L = sim[slot] = { skey, sc, scale: p.scale, cv: p.cv, ox: p.ox, oy: p.oy, mw: p.mw, mh: p.mh, info: p.info, ver: null }; sim[slot + 'P'] = null;
          sim.layerRepaints = (sim.layerRepaints || 0) + 1;
        } else if (L) { blitScaled(ctx, view, L, q, bg); return true; }
        else return false;
      }
    }
    if (L && L.skey === skey && L.sc === sc) {
      const dx = (view.ox - L.ox) * q, dy = (view.oy - L.oy) * q;                    // device pixels the view has moved since the layer was painted
      sx = L.mw * q - Math.round(dx); sy = L.mh * q - Math.round(dy);
      const inside = sx >= 0 && sy >= 0 && sx + Math.ceil(view.w * q) <= L.cv.width && sy + Math.ceil(view.h * q) <= L.cv.height;
      const exact = Math.abs(dx - Math.round(dx)) < 0.01 && Math.abs(dy - Math.round(dy)) < 0.01;
      if (!inside || (settled && !exact)) L = null;
    } else L = null;
    if (!L) {
      const mw = Math.ceil(view.w * LAYER_MARGIN), mh = Math.ceil(view.h * LAYER_MARGIN);
      if (sim[slot]) sim[slot + 'Spare'] = sim[slot].cv;
      const cv = layerCanvas(sim, slot, Math.ceil((view.w + 2 * mw) * q), Math.ceil((view.h + 2 * mh) * q)), c = cv.getContext('2d');
      c.scale(q, q); const info = paint(c, { w: view.w + 2 * mw, h: view.h + 2 * mh, scale: view.scale, ox: view.ox + mw, oy: view.oy + mh });
      if (A.sprites.posterize) A.quantise(cv, A.sprites.posterize);
      L = sim[slot] = { skey, sc, scale: view.scale, cv, ox: view.ox, oy: view.oy, mw, mh, info: info || null, ver: null }; sx = mw * q; sy = mh * q;
      sim.layerRepaints = (sim.layerRepaints || 0) + 1;
    }
    ctx.drawImage(L.cv, sx, sy, Math.ceil(view.w * q), Math.ceil(view.h * q), 0, 0, view.w, view.h);
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------
  // FAR LAYER: the state machine of sim._far (the buildings and trees below 1 px per metre, painted once into a world-anchored layer; see worldLayer).
  //
  //   ABSENT --first far frame--> ROUGH --exact painting done--> EXACT <------------------------------------+
  //     (no layer)         (farCoarse: flat shapes, one fill       (L.info = items, signatures, layer view)  | signature changed: farPatch
  //                         per colour, stepped COARSE_MS a frame;        |      ^                           v
  //                         the exact layer is painted behind it           |      +----------- INDEXING (lookup grid, a few ms a frame, once per layer)
  //                         in slices, sim._farP, once it is complete)     |                         |
  //                                                                        |               DIFFING (which buildings changed) -> PAINTING (their boxes) -> EXACT
  //   ROUGH or EXACT --scale changes (zoom)--> STALE: the old layer is blitted scaled; --zoom stops--> repainted in slices (sim._farP) and swapped in whole: EXACT
  //   EXACT --key changes (theme, trees on/off, size)--> same repaint;  a pan past the margin or a fraction of a pixel after a pan --> one-shot repaint, EXACT
  //   DIFFING finds more than FAR_PATCH_MAX of the buildings changed --> the layer is marked stale (skey = null) and repainted in slices as above: nothing is patched
  //
  // The same for the ground layer (sim._ground) up to ROUGH: groundCoarse (flat landuse and roads) first, then the exact ground in slices.
  //
  // A new data signature (the frame version, or the states) never repaints the layer. farPatch compares each building's signature with the one it was painted with
  // (L.info.sigs, indexed like sim.buildings; the signature is the style object for a versioned style, else the state and owner) and repaints only those buildings, in place:
  // the box of a changed building is cleared and every item touching it is drawn again, back to front, so the pixels equal a full painting (see the scratch canvas below).
  // The work is queued in depth order and spent layerMs a frame (twice that with a backlog), so a colour change appears as a sweep across the picture over a few frames instead of the whole
  // layer being redone in slices. A newer signature while a pass is painting starts another diff pass after it (changes between are coalesced into the queue, never lost).
  // While a full repaint (sim._farP) is running the layer is not patched: the repaint draws the current colours itself, and the diff that follows its swap catches what changed meanwhile.
  // Counters on the sim, for tests and benches: layerRepaints (whole layers painted), layerRoughPaints, farPatches (passes), farRectsPainted, farPatchFallbacks.
  // Options: sim.opts.coarseFirst = false (no rough layer), sim.opts.farPatch = false (a new signature repaints the whole layer, as before), sim.opts.sliceLayers = false (everything in one go).
  const FAR_RECT_PAD = 2.5;                          // css px added to a changed building's own box: its pixels, ink and sprite rounding included
  const FAR_PAD = 2.5;                               // the same for every item's box in the lookup grid (the far ink is under a pixel wide; viz/test_farlayer.js would catch too little)
  const FAR_SCRATCH_MARGIN = 2;                      // device px of margin round the scratch canvas a patch box is drawn in
  const FAR_CELL = 32;                               // side of a lookup grid cell, device pixels
  const FAR_PATCH_MAX = 0.2;                         // above this share of changed buildings, repainting the whole layer in slices is cheaper than patching (a patch redraws a building and its neighbours)
  // The flat first picture: every building's top (and a body under it) in its colour, batched one fill per colour, and the trees as dots in one path. No sprites, no ink, no sorting:
  // about a tenth of the exact painting. Colours come from the same style the exact painting uses, so the picture is the right colours, just not the right shapes.
  function* farCoarse(c, v, sim, pal, reg, areg, layers) {
    const A = A_(), body = new Map(), tops = new Map(), pad = v.scale * 12, shadeMemo = new Map();
    const shaded = (col, k) => { const kk = col + '|' + k; let r = shadeMemo.get(kk); if (!r) shadeMemo.set(kk, r = shade(col, k)); return r; };
    c.lineJoin = 'round';
    if (layers.buildings) for (let bi = 0; bi < sim.buildings.length; bi++) {
      if ((bi & 1023) === 1023) yield;
      const e = sim.buildings[bi], fp = e.src.footprint, Hm = entityHeight(e), H = Hm * v.scale;
      const q0 = proj(v, fp[0][0], fp[0][1], e.z); if (q0[0] < -pad - H || q0[0] > v.w + pad + H || q0[1] < -pad - H || q0[1] > v.h + pad + 2 * H) continue;
      const wall = A.wallFor(pal, e.seed), st = (sim.buildingStyle || retrofitStyle)(e, areg, pal, wall) || {};
      const wc = st.data || wall, rc = st.roof || pal.roof || wc;
      let a = body.get(wc); if (!a) body.set(wc, a = []); a.push(e, Hm);
      let b = tops.get(rc); if (!b) tops.set(rc, b = []); b.push(e, Hm);
    }
    // A building is a rectangle round its footprint on the screen when it is only a few pixels across (one native call instead of one per vertex, which is most of the cost:
    // 9,214 polygons took 90 ms and the rectangles 20), and the footprint polygon itself when it is bigger.
    const k = v.scale, SMALL = 36;
    const fill = (groups, col, zf, up) => {
      for (const [colour, list] of groups) {
        c.fillStyle = col(colour); let open = 0;
        for (let i = 0; i < list.length; i += 2) {
          const e = list[i], z = e.z + list[i + 1] * zf, fp = e.src.footprint, oy = v.oy - z * k;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (let j = 0; j < fp.length; j++) { const x = v.ox + (fp[j][0] - fp[j][1]) * k * C30, y = oy + (fp[j][0] + fp[j][1]) * k * 0.5; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          if (open === 0) c.beginPath();
          if ((x1 - x0) * (y1 - y0) < SMALL) { const dx = (x1 - x0) * 0.12, dy = (y1 - y0) * 0.12; c.rect(x0 + dx, y0 + dy, (x1 - x0) - 2 * dx, (y1 - y0) - 2 * dy + up * list[i + 1] * k); if (++open === 128) { c.fill(); open = 0; } continue; }
          for (let j = 0; j < fp.length; j++) { const x = v.ox + (fp[j][0] - fp[j][1]) * k * C30, y = oy + (fp[j][0] + fp[j][1]) * k * 0.5; if (j) c.lineTo(x, y); else c.moveTo(x, y); }
          c.closePath();
          if (++open === 128) { c.fill(); open = 0; }
        }
        if (open) c.fill();
      }
    };
    yield; fill(body, w => shaded(w, reg.tones[1]), 0.5, 0.5); yield; fill(tops, r => shaded(r, reg.tones[0]), 1, 0);               // a body half way up (a rectangle also covers the wall below it), then the roofs
    if (layers.trees && sim.trees.length) {
      c.beginPath(); const s = Math.max(1.2, v.scale * 6);
      yield;
      for (const t of sim.trees) { const q = proj(v, t.x, t.y, t.z); if (q[0] > -pad && q[0] < v.w + pad && q[1] > -pad && q[1] < v.h + pad) c.rect(q[0] - s / 2, q[1] - s * 0.9, s, s); }
      c.fillStyle = shaded(mixHex(pal.bg, '#4f7a46', 0.8), 1); c.fill();
    }
  }
  // The flat first picture of the ground: the base colour, the landuse in one fill per colour, the roads as one stroke per width. About a twentieth of the exact painting
  // (no relief shading, no building shadows, no markings), drawn at once the first time the ground is wanted far out; the exact ground is painted behind it in slices.
  function groundCoarse(c, v, sim, th) {
    const B = sceneBounds(sim.scene), P = (x, y) => proj(v, x, y, 0);
    c.fillStyle = th.bg; c.fillRect(0, 0, v.w, v.h); c.lineJoin = 'round'; c.lineCap = 'butt';
    c.beginPath(); [[B[0], B[1]], [B[2], B[1]], [B[2], B[3]], [B[0], B[3]]].forEach((p, i) => { const q = P(p[0], p[1]); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }); c.closePath(); c.fillStyle = th.ground; c.fill();
    const groups = new Map();
    for (const l of sim.scene.landuse) {
      const fill = l.kind === 'park' ? th.grass : (l.kind === 'garden' ? mixHex(th.grass, th.ground, 0.3) : (l.kind === 'water' ? th.water : th.plaza));
      let a = groups.get(fill); if (!a) groups.set(fill, a = []); a.push(l.footprint);
    }
    for (const [fill, list] of groups) { c.beginPath(); for (const fp of list) { fp.forEach((p, i) => { const q = P(p[0], p[1]); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }); c.closePath(); } c.fillStyle = fill; c.fill(); }
    // roads: pavements (a wide stroke) then carriageways, one path per width
    for (const pass of [0, 1]) {
      const byW = new Map();
      for (const r of sim.scene.roads) {
        const cls = roadCls(r), w = Math.max(pass ? 0.8 : 1, (pass ? cls.width : cls.width + 2 * cls.pavement) * v.scale), colour = pass ? (r.class === 'cycle' || r.class === 'pedestrian' ? th.pave : th.road) : th.pave;
        if (!pass && !(cls.pavement > 0)) continue;
        const key = colour + '|' + Math.round(w * 2) / 2; let a = byW.get(key); if (!a) byW.set(key, a = { colour, w: Math.round(w * 2) / 2, roads: [] }); a.roads.push(r);
      }
      for (const g of byW.values()) {
        c.strokeStyle = g.colour; c.lineWidth = g.w;
        g.roads.forEach((r, n) => {
          if ((n & 63) === 0) { if (n) c.stroke(); c.beginPath(); }
          r.pts.forEach((p, i) => { const q = P(p[0], p[1]); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
        });
        c.stroke();
      }
    }
  }
  // The box an item's pixels can fall in, in layer css pixels [x0, y0, x1, y1], generous (ink and rounding add a pixel or two).
  function farBox(it, v, FAR_PAD) {
    const k = v.scale;
    if (it.kind === 'b') {
      const e = it.o;
      if (e._asset) { const p = proj(v, e.fit.cx, e.fit.cy, e.z), bb = e._asset.bbox; return [p[0] + bb.minX * k - FAR_PAD, p[1] + bb.minY * k - FAR_PAD, p[0] + bb.maxX * k + FAR_PAD, p[1] + bb.maxY * k + FAR_PAD]; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const Hk = entityHeight(e) * k;
      for (const f of e.src.footprint) { const q = proj(v, f[0], f[1], e.z); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1] - Hk); y1 = Math.max(y1, q[1]); }
      return [x0 - FAR_PAD, y0 - FAR_PAD, x1 + FAR_PAD, y1 + FAR_PAD];
    }
    if (it.kind === 't') {
      const t = it.o, p = proj(v, t.x, t.y, t.z), bb = t._asset ? t._asset.bbox : { minX: -3, minY: -8, maxX: 3, maxY: 0 }, w = (bb.maxX - bb.minX) * k;
      return [Math.min(p[0] + bb.minX * k, p[0] - w * 0.4) - FAR_PAD, p[1] + bb.minY * k - FAR_PAD, Math.max(p[0] + bb.maxX * k, p[0] + w * 0.4) + FAR_PAD, Math.max(p[1] + bb.maxY * k, p[1] + w * 0.15) + FAR_PAD];
    }
    const p = proj(v, it.o[0], it.o[1], it.o[2]), r = 60 * k + 40; return [p[0] - r, p[1] - r, p[0] + r, p[1] + r];       // the fountain
  }
  // The lookup grid of a painted layer (built the first time it is patched): each item's box (css px in the layer), and per grid cell the items whose box touches it, in the layer's
  // depth order (a lookup structure only: what gets repainted is the box of a changed building, not whole cells).
  // Built in steps (about 3 microseconds an item, 55 ms for Jette's 18,000 items at once): returns the grid when it is whole, else null after spending `budget` ms from t0.
  function farGrid(L, q, t0, budget) {
    const info = L.info; if (info.grid) return info.grid;
    const n = info.items.length, cell = FAR_CELL / q;
    let G = info.gridBuild;
    if (!G) G = info.gridBuild = { pos: 0, nb: 0, cols: Math.ceil(L.cv.width / FAR_CELL), rows: Math.ceil(L.cv.height / FAR_CELL), cells: null, box: new Float32Array(n * 4) };
    if (!G.cells) G.cells = new Array(G.cols * G.rows);
    while (G.pos < n) {
      const end = Math.min(n, G.pos + 512);
      for (let k = G.pos; k < end; k++) {
        const it = info.items[k], b = farBox(it, info.v, FAR_PAD); G.box[k * 4] = b[0]; G.box[k * 4 + 1] = b[1]; G.box[k * 4 + 2] = b[2]; G.box[k * 4 + 3] = b[3]; if (it.kind === 'b') G.nb++;
        const cx0 = Math.max(0, Math.floor(b[0] / cell)), cy0 = Math.max(0, Math.floor(b[1] / cell)), cx1 = Math.min(G.cols - 1, Math.floor(b[2] / cell)), cy1 = Math.min(G.rows - 1, Math.floor(b[3] / cell));
        for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) { const i = y * G.cols + x; (G.cells[i] || (G.cells[i] = [])).push(k); }
      }
      G.pos = end;
      if (G.pos < n && layerClock() - t0 >= budget) return null;
    }
    info.gridBuild = null;
    return (info.grid = { cols: G.cols, rows: G.rows, cell, cells: G.cells, box: G.box, nb: G.nb, dirty: new Uint8Array(n), queue: [], qpos: 0, seen: new Uint32Array(n), stamp: 0 });
  }
  // One call per frame (before the layer is blitted): bring the exact layer up to date with the buildings' current signature `h`, within `budget` ms.
  // sim._farPatch is the state: null when the layer is current, else { ver, phase: 'diff' | 'paint', pos }.
  function farPatch(sim, view, skey, h, sigOf, drawItem, budget) {
    const L = sim._far, q = (A_().sprites.dpr || 1);
    if (!L || !L.info || L.rough || sim._farP || L.skey !== skey || L.sc !== view.scale.toFixed(4) || !A_().sprites.factory) { return; }
    const info = L.info, P = sim._farPatch;
    if (!P && L.ver === h) return;
    const t0 = layerClock(), grid = farGrid(L, q, t0, budget), nItems = info.items.length;
    if (!grid) { sim._farPatch = sim._farPatch || { ver: null, phase: 'index', pos: 0 }; return; }          // INDEXING: the lookup grid is built a few ms a frame first
    const st = (P && P.phase !== 'index') ? P : (sim._farPatch = { ver: h, phase: 'diff', pos: 0 });               // st.ver: the signature this pass of the diff started from
    const c = L.cv.getContext('2d'), v = info.v, box = grid.box, W = L.cv.width, Hd = L.cv.height;
    for (;;) {
      if (st.phase === 'diff') {
        while (st.pos < nItems) {
          const end = Math.min(nItems, st.pos + 128);
          for (let n = st.pos; n < end; n++) {
            const it = info.items[n]; if (it.kind !== 'b') continue;
            const sg = sigOf(it.o); if (sg === info.sigs[it.i]) continue;
            info.sigs[it.i] = sg;
            if (!grid.dirty[n]) { grid.dirty[n] = 1; grid.queue.push(n); }
          }
          st.pos = end;
          if (layerClock() - t0 >= budget) return;
        }
        if (grid.queue.length - grid.qpos > FAR_PATCH_MAX * grid.nb) {                  // too many to patch one by one: repaint the lot in slices instead
          sim._farPatch = null; L.skey = null; info.grid = null; sim.farPatchFallbacks = (sim.farPatchFallbacks || 0) + 1; return;
        }
        st.phase = 'paint';
      }
      if (grid.queue.length - grid.qpos > 64 && budget < 2 * layerMsBase(sim)) budget = 2 * layerMsBase(sim);       // a backlog (patches arriving faster than they are painted): spend twice the time on it
      // paint phase: for each queued building (in depth order, so a change sweeps across the screen), clear its box and redraw, back to front, every item touching the box, clipped to it
      while (grid.qpos < grid.queue.length) {
        const n = grid.queue[grid.qpos++]; grid.dirty[n] = 0;
        const rb = farBox(info.items[n], v, FAR_RECT_PAD);
        const x0 = Math.max(0, Math.floor(rb[0] * q)), y0 = Math.max(0, Math.floor(rb[1] * q)), x1 = Math.min(W, Math.ceil(rb[2] * q)), y1 = Math.min(Hd, Math.ceil(rb[3] * q));
        if (x1 > x0 && y1 > y0) {
          // The items are drawn into a scratch canvas a few pixels bigger than the box on every side, and the middle of it is copied into the layer: drawing straight into the
          // layer under a clip differs from the unclipped painting by one level of 255 on a few pixels at the clip's edge (the canvas resamples scaled sprites differently there).
          // Here the edge is in the scratch's margin, and the copy is 1:1 on whole device pixels.
          const S = FAR_SCRATCH_MARGIN, w = x1 - x0, h = y1 - y0, rx0 = (x0 - S) / q, ry0 = (y0 - S) / q, rx1 = (x1 + S) / q, ry1 = (y1 + S) / q, hit = [], stamp = ++grid.stamp;
          for (let cy = Math.max(0, Math.floor(ry0 / grid.cell)); cy <= Math.min(grid.rows - 1, Math.floor(ry1 / grid.cell)); cy++)
            for (let cx = Math.max(0, Math.floor(rx0 / grid.cell)); cx <= Math.min(grid.cols - 1, Math.floor(rx1 / grid.cell)); cx++) {
              const list = grid.cells[cy * grid.cols + cx]; if (!list) continue;
              for (const k of list) if (grid.seen[k] !== stamp) { grid.seen[k] = stamp; if (box[k * 4] < rx1 && box[k * 4 + 2] > rx0 && box[k * 4 + 1] < ry1 && box[k * 4 + 3] > ry0) hit.push(k); }
            }
          hit.sort((a, b) => a - b);                                                      // item order is the layer's depth order
          const sw = w + 2 * S, sh = h + 2 * S; let X = sim._farScratch;
          if (!X || X.width < sw || X.height < sh) X = sim._farScratch = A_().sprites.factory(Math.max(sw, X ? X.width : 0, 64), Math.max(sh, X ? X.height : 0, 64));
          const sc = X.getContext('2d'); sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, X.width, X.height);
          sc.setTransform(q, 0, 0, q, S - x0, S - y0); sc.lineJoin = 'round';
          for (const k of hit) drawItem(sc, info.items[k], v);
          c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(x0, y0, w, h); c.drawImage(X, S, S, w, h, x0, y0, w, h);
          sim.farRectsPainted = (sim.farRectsPainted || 0) + 1;
        }
        if (layerClock() - t0 >= budget) return;
      }
      grid.queue.length = 0; grid.qpos = 0; L.ver = st.ver; sim.farPatches = (sim.farPatches || 0) + 1;
      // The pass is painted. If the signature moved on while it ran, diff again (only what changed since is queued); else the layer is current.
      if (st.ver === h) { sim._farPatch = null; return; }
      st.ver = h; st.phase = 'diff'; st.pos = 0;
    }
  }

  // Ground height at a world point, as the ground layer draws it (terrain times relief; 0 on a flat scene). Tint and marks are cut from the ground, so they stand at this height.
  const groundZ = (sim, x, y) => sim.terrain ? sim.terrain.at(x, y) * sim.relief : 0;
  // Ground tint (model packs): sim.groundTint = { cells(version) -> [{ x0, y0, x1, y1, colour }] (world metres), opacity, version() }. The cells are painted opaque into a
  // canvas the size of the view (so neighbours leave no seams) and blitted once with the opacity. The canvas is repainted only when the version or the view changes, so a still
  // frame costs one blit; the ground layer is cached on its own key and is not repainted for a new version. Each corner of a cell is at the terrain height there (paperdolls#14).
  function drawGroundTint(ctx, sim, view) {
    const T = sim.groundTint, A = A_(), ver = T.version ? T.version() : 0, cells = T.cells(ver); if (!cells.length) return;
    const q = A.sprites.dpr || 1, w = Math.ceil(view.w * q), h = Math.ceil(view.h * q), key = ver + '|' + view.scale + '|' + view.ox + '|' + view.oy + '|' + w + 'x' + h + '|' + cells.length + '|' + sim.relief;
    if (!A.sprites.factory) { ctx.save(); ctx.globalAlpha = T.opacity; for (const c of cells) tintCell(ctx, sim, view, c); ctx.restore(); return; }
    let C = sim._tint;
    if (!C || C.cv.width !== w || C.cv.height !== h) C = sim._tint = { cv: A.sprites.factory(w, h), key: null };
    if (C.key !== key) {
      const c = C.cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h); c.scale(q, q); c.lineJoin = 'round';
      for (const cell of cells) tintCell(c, sim, view, cell);
      C.key = key; sim.tintPaints = (sim.tintPaints || 0) + 1;
    }
    ctx.save(); ctx.globalAlpha = T.opacity; ctx.drawImage(C.cv, 0, 0, w, h, 0, 0, view.w, view.h); ctx.restore();
  }
  // Ground marks (model packs, the far-zoom form of outline and halo): sim.groundMarks = { cells(version, view) -> [{ kind, x0, y0, x1, y1, share, colour }], version() }.
  // A cell is hatched in the flag colour with diagonal lines whose weight and opacity grow with the share of its buildings that are flagged (outline: one way, halo:
  // the other). It is drawn on the ground, under the buildings, so it can never cover a roof or wall colour; each cell is clipped to its quad (corners at the terrain height there).
  // The hatch is a clip and a few dozen strokes per cell, so it is painted into a canvas of the view's size and that is blitted: a settled frame costs one blit, whatever the number
  // of cells (paperdolls#17; uncached it was 6.6 to 8 times a plain frame). The key is the frame version, the cells' count (the marks shown depend on the scale), the view and the relief;
  // `version()` must change whenever the cells do, as it must for the tint. Without a canvas factory the marks are drawn straight onto ctx, as before.
  function drawGroundMarks(ctx, sim, view) {
    const M = sim.groundMarks, A = A_(), ver = M.version ? M.version() : 0, cells = M.cells(ver, view); if (!cells.length) return;
    if (!A.sprites.factory || sim.opts.cacheMarks === false) { paintGroundMarks(ctx, sim, view, cells); return; }       // cacheMarks: false draws straight onto the frame (the pixel reference for the tests)
    const q = A.sprites.dpr || 1, w = Math.ceil(view.w * q), h = Math.ceil(view.h * q), key = ver + '|' + view.scale + '|' + view.ox + '|' + view.oy + '|' + w + 'x' + h + '|' + cells.length + '|' + sim.relief;
    let C = sim._marks;
    if (!C || C.cv.width !== w || C.cv.height !== h) C = sim._marks = { cv: A.sprites.factory(w, h), key: null };
    if (C.key !== key) {
      const c = C.cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h); c.scale(q, q);
      paintGroundMarks(c, sim, view, cells);
      C.key = key; sim.marksPaints = (sim.marksPaints || 0) + 1;
    }
    ctx.drawImage(C.cv, 0, 0, w, h, 0, 0, view.w, view.h);
  }
  function paintGroundMarks(ctx, sim, view, cells) {
    ctx.save(); ctx.lineCap = 'butt';
    for (const cell of cells) {
      if (!(cell.share > 0.02)) continue;
      const a = proj(view, cell.x0, cell.y0, groundZ(sim, cell.x0, cell.y0)), b = proj(view, cell.x1, cell.y0, groundZ(sim, cell.x1, cell.y0)), d = proj(view, cell.x1, cell.y1, groundZ(sim, cell.x1, cell.y1)), e = proj(view, cell.x0, cell.y1, groundZ(sim, cell.x0, cell.y1));
      const x0 = Math.min(a[0], b[0], d[0], e[0]), x1 = Math.max(a[0], b[0], d[0], e[0]), y0 = Math.min(a[1], b[1], d[1], e[1]), y1 = Math.max(a[1], b[1], d[1], e[1]);
      if (x1 < 0 || x0 > view.w || y1 < 0 || y0 > view.h) continue;
      const s = Math.min(1, cell.share), cellPx = Math.max(x1 - x0, 1) / 1.7, gap = Math.max(2.5, Math.min(8 - 3 * s, cellPx / 4)), dir = cell.kind === 'halo' ? -1 : 1;
      ctx.save(); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(d[0], d[1]); ctx.lineTo(e[0], e[1]); ctx.closePath(); ctx.clip();
      ctx.strokeStyle = cell.colour; ctx.globalAlpha = 0.4 + 0.5 * s; ctx.lineWidth = 1 + 1.1 * s; ctx.beginPath();
      const h = y1 - y0;
      for (let x = x0 - h; x <= x1 + h; x += gap) { if (dir > 0) { ctx.moveTo(x, y1); ctx.lineTo(x + h, y0); } else { ctx.moveTo(x, y0); ctx.lineTo(x + h, y1); } }
      ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }
  function tintCell(c, sim, view, cell) {
    const a = proj(view, cell.x0, cell.y0, groundZ(sim, cell.x0, cell.y0)), b = proj(view, cell.x1, cell.y0, groundZ(sim, cell.x1, cell.y0)), d = proj(view, cell.x1, cell.y1, groundZ(sim, cell.x1, cell.y1)), e = proj(view, cell.x0, cell.y1, groundZ(sim, cell.x0, cell.y1));
    if (Math.max(a[0], b[0], d[0], e[0]) < 0 || Math.min(a[0], b[0], d[0], e[0]) > view.w || Math.max(a[1], b[1], d[1], e[1]) < 0 || Math.min(a[1], b[1], d[1], e[1]) > view.h) return;
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.lineTo(e[0], e[1]); c.closePath();
    c.fillStyle = cell.colour; c.fill(); c.strokeStyle = cell.colour; c.lineWidth = 1; c.stroke();            // the stroke closes the antialiased seam between neighbours
  }

  // Height of a building in metres, as drawn (an asset's own height, or storeys times the storey height).
  function entityHeight(e) { return e.params ? A_().buildingHeight(e.kind, e.params.N) : e.levels * (LIB.buildings[e.kind] || LIB.buildings.terrace).storeyH; }

  // A building: an asset sprite when its footprint fits a slot, otherwise the generic extrusion.
  // A style may carry seg: { n, k, done, todo } ("k of n units"). Zoomed in (view.scale >= SEG_MIN_SCALE, sim.opts.segMinScale) the wall is divided into
  // sections; zoomed out, and on a building drawn as a generic extrusion, there is nothing to divide, so the data colour is mixed toward `done` by the share k/n.
  const SEG_MIN_SCALE = 1.4;
  function drawBuildingEntity(ctx, view, reg, pal, shadowCol, sim, e) {
    const A = A_(), areg = A.REG[pal.reg] || A.REG.colorfigures;
    // Fast path: with the default style and no binding, a building only changes when its state, owner or the theme does.
    let bound = false;
    for (const b of sim.bindings) if (b.match(e)) { bound = true; break; }
    const fastOk = !sim.buildingStyle && !bound;
    if (fastOk && e._fast && e._th === pal && e._st === e.state && e._inv === e.investor) { drawBuildingSprite(ctx, view, A, areg, e); return; }
    // A style with a frame version (sim.frameVersion, a number) is asked again only when the number has changed: no style call, no key string, no allocation.
    const ver = sim.buildingStyle && typeof sim.frameVersion === 'number' ? sim.frameVersion : null;
    const segOn = view.scale >= (sim.opts.segMinScale === undefined ? SEG_MIN_SCALE : sim.opts.segMinScale);
    if (ver !== null && !bound && e._fv === ver && e._th === pal && (!e._seg || e._sm === segOn)) { if (e._asset) drawBuildingSprite(ctx, view, A, areg, e); else drawExtruded(ctx, view, reg, pal, e, shadowCol, e._fdata, e._froof); return; }
    const wall = A.wallFor(pal, e.seed);
    const style = (sim.buildingStyle || retrofitStyle)(e, areg, pal, wall) || {};
    let data = style.data || null, seg = null, roof = style.roof || null;   // style.roof: a colour for the roof (the data colour on the roof, or a neutral one), null for the look's own
    for (const b of sim.bindings) if (b.match(e)) { data = b.scale.colour(b.value(e)); break; }   // a data binding wins over the style
    if (style.seg) {
      seg = A.segmentsFor(style.seg.n, style.seg.k);
      if (seg && !(segOn && e.params)) { const mixk = (style.data || style.roof ? 0.3 : 0.85) * style.seg.k / style.seg.n; data = A.mix(data || wall, style.seg.done, mixk); if (roof) roof = A.mix(roof, style.seg.done, mixk); seg = null; }   // far away: only a hint of the sections' colour when a mapping paints the state colour, so that stays readable (at most 0.3 of the way)
    }
    e._seg = !!style.seg; e._sm = segOn;
    if (!e.params) { e._fv = ver; e._th = pal; e._asset = null; e._fdata = data || wall; e._froof = roof; drawExtruded(ctx, view, reg, pal, e, shadowCol, data || wall, roof); return; }
    const ov = style.overlays || [], key = pal.famId + '/' + pal.lookId + '/' + pal.reg + '|' + wall + '|' + data + '|' + roof + '|' + ov.join(',') + (seg ? '|' + seg[0] + ':' + seg[1] + ':' + style.seg.done + ':' + (style.seg.todo || '') : '');
    if (e._ck !== key) {
      if (e._asset && restyleLeft <= 0) { drawBuildingSprite(ctx, view, A, areg, e); return; }       // over the frame's restyle budget: the last picture stays and is restyled on a later frame
      restyleLeft--;
      e._cols = A.buildingColours(areg, pal, { wall, data, roof, seed: e.seed, seg: seg ? style.seg : null });
      e._asset = A.getAsset('buildings', e.kind, e.fit.heading, A.buildingExtra(e.params, ov, seg));
      e._ck = key;
    }
    e._fast = fastOk; e._th = pal; e._st = e.state; e._inv = e.investor; e._fv = ver;
    drawBuildingSprite(ctx, view, A, areg, e);
  }
  // The generic extrusion, standing at the building's ground height (the whole drawing is lifted: no per-point z).
  function drawExtruded(ctx, view, reg, pal, e, shadowCol, wall, roof) {
    if (!e.z) { drawBuilding(ctx, view, reg, pal, e.src, shadowCol, e.state, wall, roof); return; }
    ctx.save(); ctx.translate(0, -e.z * view.scale); drawBuilding(ctx, view, reg, pal, e.src, shadowCol, e.state, wall, roof); ctx.restore();
  }
  function drawBuildingSprite(ctx, view, A, areg, e) {
    const p = proj(view, e.fit.cx, e.fit.cy, e.z);
    A.drawSprite(ctx, e._asset, e._cols, areg, p[0], p[1], view.scale, e);
  }

  // A tree: a cached asset sprite, coloured from the look, with a ground shadow. A binding can recolour the foliage.
  function drawTreeEntity(ctx, view, sim, e, th, areg, shadowCol) {
    const A = A_(); let data = null;
    for (const b of sim.bindings) if (b.match(e)) { data = b.scale.colour(b.value(e)); break; }
    const key = th.famId + '/' + th.lookId + '/' + th.reg + '|' + e.kind + '|' + data;
    if (e._ck !== key) { e._cols = A.treeColours(areg, th, e.seed, e.kind, data); e._asset = A.getAsset('trees', e.kind, e.seed & 3, { s: e.s, v: e.v }); e._ck = key; }
    const p = proj(view, e.x, e.y, e.z), bb = e._asset.bbox, w = (bb.maxX - bb.minX) * view.scale;
    ctx.beginPath(); ctx.ellipse(p[0], p[1], Math.max(2, w * 0.36), Math.max(1, w * 0.13), 0, 0, Math.PI * 2); ctx.fillStyle = shadowCol; ctx.fill();
    A.drawSprite(ctx, e._asset, e._cols, areg, p[0], p[1], view.scale);
  }

  // Colours for an agent: defaults from its outfit or tint, data surface from any matching binding.
  function agentColours(sim, a, reg) {
    const A = A_();
    let data = null;
    for (const b of sim.bindings) if (b.match(a)) {
      const v = b.value(a);
      data = Array.isArray(v) ? v.map(x => b.scale.colour(x)) : b.scale.colour(v);
      break;
    }
    const key = reg.id + '|' + JSON.stringify(data);
    if (a._ck !== key) {
      a._cols = a.group === 'vehicles' ? A.vehicleColours(a.kind, reg, a.tint, Array.isArray(data) ? data[0] : data) : A.personColours(a.kind, reg, a.outfits, data);
      a._ck = key;
    }
    return a._cols;
  }

  function drawAgent(ctx, view, reg, shadowCol, sim, a, pose, layers) {
    const A = A_(), areg = A.REG[sim.opts.register] || A.REG.colorfigures;
    // level of detail: zoomed far out a person is under two pixels and a vehicle is a dot
    if (a.group === 'people' && view.scale < 1.6) return;
    const h = A.snapHeading(pose.heading), p = proj(view, pose.x, pose.y, pose.z);
    if (a.group === 'vehicles' && view.scale < 0.9) {
      const col = agentColours(sim, a, areg), d = Math.max(1.5, view.scale * 3.2);
      ctx.fillStyle = col.data; ctx.fillRect(p[0] - d / 2, p[1] - d, d, d);
      return;
    }
    const sc = view.scale * (a.group === 'people' ? A.STYLE.person : A.STYLE.vehicle);
    const asset = a.group === 'vehicles' ? A.getAsset('vehicles', a.kind, h) : A.getAsset('people', a.kind, h, A.flagsOf(a.outfits));
    const bb = asset.bbox, w = (bb.maxX - bb.minX) * sc;
    ctx.beginPath(); ctx.ellipse(p[0], p[1], Math.max(2, w * 0.42), Math.max(1, w * 0.15), 0, 0, Math.PI * 2); ctx.fillStyle = shadowCol; ctx.fill();
    A.drawSprite(ctx, asset, agentColours(sim, a, areg), areg, p[0], p[1], sc);
    if (a.rider && layers.people) {
      const ra = A.getAsset('people', 'cyclist', h, [a.rider.outfit.flags]);
      if (!a._rc || a._rcReg !== areg.id) { a._rc = A.personColours('cyclist', areg, [a.rider.outfit]); a._rcReg = areg.id; }
      A.drawSprite(ctx, ra, a._rc, areg, p[0], p[1] - a.rider.lift * sc, sc);
    }
  }
  // Fountain: a stepped basin with water and a central jet, all in world units.
  function drawFountain(ctx, view, th, reg, cx, cy, gz) {
    const R = 6.5, N = 18, z0 = gz || 0;
    const ring = (r, z) => { const out = []; for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; out.push(proj(view, cx + Math.cos(a) * r, cy + Math.sin(a) * r, z + z0)); } return out; };
    poly(ctx, ring(R, 0.9), th.kerb, reg.ink, reg.lw);
    poly(ctx, ring(R - 1.2, 1.0), th.water, reg.ink, reg.lw * 0.8);
    const top = proj(view, cx, cy, 2.6 + z0), base = proj(view, cx, cy, 1.0 + z0), jet = mixHex(th.water, '#ffffff', 0.45);
    ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.strokeStyle = jet; ctx.lineWidth = Math.max(1, view.scale * 0.35); ctx.stroke();
    ctx.beginPath(); ctx.arc(top[0], top[1], Math.max(1.5, view.scale * 0.6), 0, Math.PI * 2); ctx.fillStyle = mixHex(th.water, '#ffffff', 0.65); ctx.fill(); ctx.strokeStyle = reg.ink; ctx.lineWidth = reg.lw; ctx.stroke();
  }
  // view fit: centre the scene in a w x h canvas
  function fitView(scene, w, h, margin, zmax) {
    const B = sceneBounds(scene), dx = B[2] - B[0], dy = B[3] - B[1], S = dx + dy, zm = zmax || 0;        // an iso box is (dx + dy) * cos30 wide and (dx + dy) / 2 tall (plus the relief)
    const scale = Math.min((w * (1 - margin)) / (S * C30 + 1), (h * (1 - margin)) / (S * 0.5 + zm + 1));
    const cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2;
    return { w, h, scale, ox: w / 2 - (cx - cy) * scale * C30, oy: h / 2 - (cx + cy) * scale * 0.5 + zm * scale / 2 };
  }

  root.VizLib = { LIB, rng, validateScene, roadCls, sceneBounds, makePlaceholderScene, buildNetwork, createSim, setTheme, stepSim, setMotion, bindData, retrofitStyle, renderFrame, fitView, proj, agentPose, entityHeight, sceneRelief };
})(typeof window !== 'undefined' ? window : globalThis);
