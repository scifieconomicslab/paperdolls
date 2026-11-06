/* buildinglib.js: buildings as assets (v0.3). Extends AssetLib; load after assetlib.js.
 *
 * A building asset is built from a handful of parameters, pre-built for the four isometric headings, and shows only the
 * faces turned toward the camera (left, right, top), exactly like vehicles and people.
 *
 *   parameters   kind (archetype), W (frontage width, m), D (depth, m), N (storeys), variant (facade seed), fs (regional
 *                facade style), ov (overlays)
 *   frame        local x along the frontage, y depth, z up. The front faces local +y.
 *   data surface the walls (role "data"). A simulation recolours them to show an output. Roofs, doors, glass, trim keep
 *                their own colours.
 *   overlays     scaffold, solar, band, marker, insulation, community: discrete geometry a simulation switches on (retrofit story, ownership).
 *   segments     seg = [n, k]: every wall is divided into n sections and the first k are drawn in a second colour (roles segdone and segtodo),
 *                for "k of n units retrofitted" in a block. n is capped at SEG_MAX. Part of the cache key, so it stays one sprite per (shape, n, k, colours).
 *
 * fitFootprint() decides which real footprints can use these assets: near-rectangular, within 12 degrees of an axis. The
 * rest are reported, and the scene renderer falls back to a generic extrusion. Nothing is silently approximated.
 *
 * Regional facade grammar (roofs, shutters, balconies, awnings, air-conditioning, window proportion) is a PROPOSAL to be
 * checked with local authors. It follows climate and local building types, never identity.
 */
(function (root) {
  'use strict';
  const A = root.AssetLib;
  if (!A) throw new Error('assetlib.js must be loaded before buildinglib.js');
  const { mix, shade, hash } = A;
  const EPS = 0.012;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function rngSeed(seed) { let a = (seed | 0) >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- archetypes ----------
  // style: facade grammar. sides: what the left and right walls get ('blank', 'few', 'windows', 'ribbon').
  const ARCH = {
    terrace:   { label: 'Terraced house',    bayW: 2.4, storeyH: 3.0, groundH: 3.2, minBays: 2, maxBays: 3, style: 'house', sides: 'blank',   win: 0.5,  roof: 'pitch' },
    shophouse: { label: 'Shophouse',         bayW: 3.2, storeyH: 3.2, groundH: 4.0, minBays: 2, maxBays: 4, style: 'shop',  sides: 'blank',   win: 0.5,  roof: 'flat' },
    block:     { label: 'Apartment block',   bayW: 3.4, storeyH: 3.0, groundH: 3.6, minBays: 3, maxBays: 9, style: 'block', sides: 'few',     win: 0.5,  roof: 'flat' },
    villa:     { label: 'Detached house',    bayW: 3.0, storeyH: 2.9, groundH: 3.0, minBays: 2, maxBays: 4, style: 'house', sides: 'windows', win: 0.4,  roof: 'hip' },
    tower:     { label: 'Tower',             bayW: 4.0, storeyH: 3.3, groundH: 4.5, minBays: 2, maxBays: 8, style: 'tower', sides: 'ribbon',  win: 0.8,  roof: 'flat' },
    shed:      { label: 'Shed / warehouse',  bayW: 5.0, storeyH: 6.0, groundH: 6.5, minBays: 2, maxBays: 8, style: 'shed',  sides: 'blank',   win: 0,    roof: 'pitchlow' }
  };
  function base(a, s) { return s === 0 ? 0 : a.groundH + (s - 1) * a.storeyH; }
  function storeyH(a, s) { return s === 0 ? a.groundH : a.storeyH; }
  function heightOf(kind, N) { const a = ARCH[kind]; return a.groundH + (Math.max(1, N) - 1) * a.storeyH; }

  // ---------- the asset definition ----------
  function buildingDef(kind, o) {
    const a = ARCH[kind]; if (!a) throw new Error('unknown building ' + kind);
    const W = o.W, D = o.D, N = o.N, hw = W / 2, hd = D / 2, H = heightOf(kind, N);
    const fs = o.fs || {}, winK = fs.winK || 1, ov = o.ov || [];
    const seg = Array.isArray(o.seg) && o.seg[0] >= 2 ? [Math.min(SEG_MAX, o.seg[0] | 0), Math.max(0, Math.min(Math.min(SEG_MAX, o.seg[0] | 0), o.seg[1] | 0))] : null;
    const rnd = rngSeed((o.variant | 0) * 7919 + A.hashStr(kind));
    const nbF = clamp(Math.round(W / a.bayW), a.minBays, a.maxBays), bwF = W / nbF;
    const nbS = clamp(Math.round(D / a.bayW), 1, 10), bwS = D / nbS;
    const SIDE = { front: { L: W, n: nbF, bay: bwF }, back: { L: W, n: nbF, bay: bwF }, right: { L: D, n: nbS, bay: bwS }, left: { L: D, n: nbS, bay: bwS } };
    const parts = [];

    // a panel on a wall, in (u, z): u runs along the wall from its centre
    function panel(side, poly, role, extra) {
      if (side === 'front') return Object.assign({ t: 'flat', side: 1, y: hd + EPS, poly, role }, extra);
      if (side === 'back') return Object.assign({ t: 'flat', side: -1, y: hd + EPS, poly, role }, extra);
      if (side === 'right') return Object.assign({ t: 'end', end: 1, x: hw + EPS, poly, role }, extra);
      return Object.assign({ t: 'end', end: -1, x: -(hw + EPS), poly, role }, extra);
    }
    // a box standing proud of a wall: u0..u1 along it, d0..d1 outward, z0..z1 up
    function protrude(side, u0, u1, d0, d1, z0, z1, role, layer) {
      if (side === 'front') return { t: 'box', b: [u0, hd + d0, z0, u1, hd + d1, z1], role, layer, needs: [0, 1] };
      if (side === 'back') return { t: 'box', b: [u0, -hd - d1, z0, u1, -hd - d0, z1], role, layer, needs: [0, -1] };
      if (side === 'right') return { t: 'box', b: [hw + d0, u0, z0, hw + d1, u1, z1], role, layer, needs: [1, 0] };
      return { t: 'box', b: [-hw - d1, u0, z0, -hw - d0, u1, z1], role, layer, needs: [-1, 0] };
    }
    const rect = (u0, u1, z0, z1) => [[u0, z0], [u1, z0], [u1, z1], [u0, z1]];

    // ---- walls: the data surface ----
    parts.push({ t: 'box', b: [-hw, -hd, 0, hw, hd, H], role: 'data', topRole: 'roofflat', layer: 0 });

    // ---- facade modules ----
    function windowAt(side, u, bay, s) {
      const sh = storeyH(a, s), b0 = base(a, s);
      const ww = bay * clamp(a.win * winK, 0.28, 0.72), z0 = b0 + sh * 0.3, z1 = b0 + sh * 0.84;
      parts.push(panel(side, rect(u - ww / 2, u + ww / 2, z0, z1), fs.rich && rnd() < 0.28 ? 'glassdark' : 'glass'));
      parts.push(panel(side, rect(u - 0.025, u + 0.025, z0, z1), 'trim', { ink: false, bias: 0.35 }));
      parts.push(panel(side, rect(u - ww / 2 - 0.08, u + ww / 2 + 0.08, z0 - 0.09, z0), 'trim', { ink: false, bias: 0.35 }));
      if (fs.shutters && ww / bay <= 0.52) for (const sg of [-1, 1]) { const c = u + sg * (ww / 2 + ww * 0.26); parts.push(panel(side, rect(c - ww * 0.22, c + ww * 0.22, z0 - 0.05, z1 + 0.05), 'shutter')); }
      if (fs.ac && (side === 'front' || side === 'back') && rnd() < 0.3) parts.push(protrude(side, u + ww / 2 - 0.6, u + ww / 2 + 0.2, 0, 0.5, z0 - 0.55, z0 - 0.1, 'trim', 6));
      return { ww, z0, z1, b0 };
    }
    function balconyAt(side, u, bay, s) {
      const w = windowAt(side, u, bay, s), bw = Math.min(bay * 0.92, w.ww + 0.9);
      parts.push(protrude(side, u - bw / 2, u + bw / 2, 0, 0.95, w.b0 - 0.02, w.b0 + 0.14, 'trim', 6));
      parts.push(protrude(side, u - bw / 2, u + bw / 2, 0.9, 0.95, w.b0 + 0.14, w.b0 + 1.05, 'frame', 6));
    }
    function doorAt(side, u, bay) {
      const dw = Math.min(1.05, bay * 0.7);
      parts.push(panel(side, rect(u - dw / 2, u + dw / 2, 0, 2.15), 'door'));
      parts.push(protrude(side, u - dw / 2 - 0.15, u + dw / 2 + 0.15, 0, 0.35, 0, 0.12, 'trim', 6));
    }
    function shopAt(side, u, bay) {
      const gh = a.groundH, w = bay * 0.84, z1 = Math.min(2.7, gh - 0.9);
      parts.push(panel(side, rect(u - w / 2, u + w / 2, 0.3, z1), 'glass'));
      parts.push(panel(side, rect(u - bay / 2 + 0.04, u + bay / 2 - 0.04, gh - 0.85, gh - 0.2), 'trim'));
      if (fs.awning && side === 'front') {
        const u0 = u - bay / 2 + 0.05, u1 = u + bay / 2 - 0.05, zt = gh - 0.85, d = 1.2, drop = 0.45;
        parts.push({ t: 'face', pts: [[u0, hd, zt], [u1, hd, zt], [u1, hd + d, zt - drop], [u0, hd + d, zt - drop]], n: [0, drop, d], role: 'awning', layer: 6, needs: [0, 1] });
      }
    }
    function rollerAt(side, u, bay) { const w = Math.min(bay * 0.8, 5), h = Math.min(4.6, a.groundH - 1.2); parts.push(panel(side, rect(u - w / 2, u + w / 2, 0, h), 'door')); }
    function highWinAt(side, u, bay) { const gh = a.groundH, w = bay * 0.7; parts.push(panel(side, rect(u - w / 2, u + w / 2, gh - 2.3, gh - 1.2), 'glass')); }
    function ribbonAt(side, s) {
      const L = SIDE[side].L, sh = storeyH(a, s), b0 = base(a, s);
      parts.push(panel(side, rect(-L / 2 + 0.3, L / 2 - 0.3, b0 + 0.8, b0 + sh - 0.4), 'glass'));
      const n = Math.max(2, Math.round(L / 6));
      for (let i = 1; i < n; i++) { const u = -L / 2 + i * L / n; parts.push(panel(side, rect(u - 0.05, u + 0.05, b0 + 0.8, b0 + sh - 0.4), 'trim', { ink: false, bias: 0.35 })); }
    }

    // ---- facade grammar: a grid of modules per wall, with rules ----
    // W window, B balcony window, D door, S shopfront, G ribbon glazing, R roller door, H high window, X blank
    function fixRuns(row) { for (let i = 1; i + 1 < row.length; i++) if (row[i - 1] === 'X' && row[i] === 'X' && row[i + 1] === 'X') row[i] = 'W'; }
    function grid(side) {
      const S = SIDE[side], n = S.n, front = side === 'front', fb = front || side === 'back';
      const g = []; for (let s = 0; s < N; s++) g.push(new Array(n).fill('X'));
      if (!fb) {
        if (a.sides === 'blank') return g;
        for (let s = 0; s < N; s++) for (let i = 0; i < n; i++) {
          if (a.sides === 'ribbon') g[s][i] = 'G';
          else if (a.sides === 'few') g[s][i] = (s >= 1 && rnd() < 0.55) ? 'W' : 'X';
          else g[s][i] = (s === 0 ? rnd() < 0.5 : rnd() < 0.85) ? 'W' : 'X';
        }
        g.forEach(fixRuns); return g;
      }
      const st = a.style, pBal = fs.balcony || 0;
      if (st === 'shed') {
        const nd = front ? (n >= 3 && rnd() < 0.5 ? 2 : 1) : 0, doors = new Set();
        while (doors.size < nd) doors.add(Math.floor(rnd() * n));
        for (let i = 0; i < n; i++) g[0][i] = doors.has(i) ? 'R' : (rnd() < 0.6 ? 'H' : 'X');
        return g;
      }
      if (!front) {                                   // rear walls: windows, no doors or shops
        for (let s = 0; s < N; s++) for (let i = 0; i < n; i++) g[s][i] = st === 'tower' ? 'G' : (s === 0 ? (rnd() < 0.5 ? 'W' : 'X') : (rnd() < 0.85 ? 'W' : 'X'));
        if (st === 'tower') g[0].fill('W');
        g.forEach(fixRuns); return g;
      }
      const di = Math.floor(rnd() * n), mid = n >> 1;
      if (st === 'house') {                           // exactly one door
        for (let i = 0; i < n; i++) g[0][i] = i === di ? 'D' : (rnd() < 0.8 ? 'W' : 'X');
        for (let s = 1; s < N; s++) for (let i = 0; i < n; i++) g[s][i] = rnd() < pBal * 0.4 ? 'B' : (rnd() < 0.08 ? 'X' : 'W');
      } else if (st === 'shop') {                     // at least one door, shopfront runs of at most three
        for (let i = 0; i < n; i++) g[0][i] = rnd() < 0.85 ? 'S' : 'W';
        g[0][di] = 'D';
        let run = 0; for (let i = 0; i < n; i++) { run = g[0][i] === 'S' ? run + 1 : 0; if (run > 3) { g[0][i - 1] = 'D'; run = 0; } }
        for (let s = 1; s < N; s++) for (let i = 0; i < n; i++) g[s][i] = rnd() < pBal ? 'B' : (rnd() < 0.08 ? 'X' : 'W');
      } else if (st === 'block') {                    // lobby door in the middle, balconies stacked in columns
        for (let i = 0; i < n; i++) g[0][i] = i === mid ? 'D' : (rnd() < 0.25 && n >= 5 ? 'S' : (rnd() < 0.7 ? 'W' : 'X'));
        const cols = []; for (let i = 0; i < n; i++) cols.push(rnd() < pBal);
        for (let s = 1; s < N; s++) for (let i = 0; i < n; i++) g[s][i] = (cols[i] && rnd() < 0.85) ? 'B' : (rnd() < 0.05 ? 'X' : 'W');
      } else if (st === 'tower') {
        for (let i = 0; i < n; i++) g[0][i] = i === mid ? 'D' : (rnd() < 0.6 ? 'S' : 'W');
        for (let s = 1; s < N; s++) g[s].fill('G');
      }
      g.forEach(fixRuns);
      for (let s = 0; s < N; s++) if (!g[s].some(m => 'WBDSG'.includes(m))) g[s][0] = 'W';   // never a storey with no openings on the front
      return g;
    }

    for (const side of ['front', 'back', 'right', 'left']) {
      const S = SIDE[side], g = grid(side);
      for (let s = 0; s < N; s++) {
        if (g[s][0] === 'G') { ribbonAt(side, s); continue; }
        for (let i = 0; i < S.n; i++) {
          const u = -S.L / 2 + (i + 0.5) * S.bay, m = g[s][i];
          if (m === 'W') windowAt(side, u, S.bay, s);
          else if (m === 'B') balconyAt(side, u, S.bay, s);
          else if (m === 'D') doorAt(side, u, S.bay);
          else if (m === 'S') shopAt(side, u, S.bay);
          else if (m === 'R') rollerAt(side, u, S.bay);
          else if (m === 'H') highWinAt(side, u, S.bay);
        }
      }
    }

    // ---- walls: cladding (insulation) and unit segments ----
    // Both sit just proud of the wall at layer 1: above the data surface (layer 0), below windows, doors and everything that stands out (layer 5 and up), so the facade
    // stays readable and the colour of the wall that carries the model's data still frames them. Segments are drawn after cladding where both are on.
    if (ov.includes('insulation')) for (const side of ['front', 'back', 'right', 'left']) {
      const L = SIDE[side].L; parts.push(panel(side, rect(-L / 2 + 0.12, L / 2 - 0.12, 0.5, H - 0.25), 'insul', { layer: 1, bias: 0.05 }));
    }
    if (seg) for (const side of ['front', 'back', 'right', 'left']) {
      const L = SIDE[side].L, w = L / seg[0];
      for (let i = 0; i < seg[0]; i++) parts.push(panel(side, rect(-L / 2 + i * w + 0.08, -L / 2 + (i + 1) * w - 0.08, 0.3, H - 0.2), i < seg[1] ? 'segdone' : 'segtodo', { layer: 1, bias: 0.1 }));
    }

    // ---- roof ----
    let roofKind = a.style === 'shed' ? 'pitchlow' : (a.style === 'tower' ? 'flat' : (fs.roof || a.roof));
    if (N >= 6 && a.style !== 'shed') roofKind = 'flat';
    let top = H, rh = 0;
    if (roofKind === 'flat') {
      const t = 0.22, ph = 0.7;
      parts.push({ t: 'box', b: [-hw, hd - t, H, hw, hd, H + ph], role: 'data', layer: 1 });
      parts.push({ t: 'box', b: [-hw, -hd, H, hw, -hd + t, H + ph], role: 'data', layer: 1 });
      parts.push({ t: 'box', b: [hw - t, -hd + t, H, hw, hd - t, H + ph], role: 'data', layer: 1 });
      parts.push({ t: 'box', b: [-hw, -hd + t, H, -hw + t, hd - t, H + ph], role: 'data', layer: 1 });
      if (a.style !== 'house') { const pw = Math.min(2.6, W * 0.3), pd = Math.min(2.6, D * 0.3), ph2 = a.style === 'tower' ? 3.2 : 2.3; parts.push({ t: 'box', b: [hw * 0.3 - pw / 2, -pd / 2, H, hw * 0.3 + pw / 2, pd / 2, H + ph2], role: 'chimney', layer: 2 }); }
      if (fs.rich) {                                    // roof clutter: air-conditioning, vents and a tank on slots that keep clear of the stair head
        const slots = [[-0.55, -0.4], [-0.55, 0.4], [0.0, -0.45], [0.0, 0.45], [0.7, -0.4], [0.7, 0.4], [-0.15, 0]];
        const nProps = clamp(Math.round(W * D / 90), 1, 5);
        for (let i = 0; i < nProps && slots.length; i++) {
          const [sx, sy] = slots.splice(Math.floor(rnd() * slots.length), 1)[0], cx = sx * hw, cy = sy * hd, k = rnd();
          if (k < 0.45) parts.push({ t: 'box', b: [cx - 0.9, cy - 0.6, H + ph * 0.5, cx + 0.9, cy + 0.6, H + ph + 0.9], role: 'chimney', layer: 2 });
          else if (k < 0.75) parts.push({ t: 'box', b: [cx - 0.35, cy - 0.35, H + ph * 0.5, cx + 0.35, cy + 0.35, H + ph + 0.7], role: 'trim', layer: 2 });
          else parts.push({ t: 'box', b: [cx - 1.0, cy - 1.0, H + ph * 0.5, cx + 1.0, cy + 1.0, H + ph + 2.1], role: 'trim', layer: 2 });
        }
      }
      top = H + ph;
    } else if (roofKind === 'pitch' || roofKind === 'pitchlow') {
      rh = clamp(D * (roofKind === 'pitchlow' ? 0.1 : 0.28), 1.0, 6.5); const oh = 0.35;
      parts.push({ t: 'prism', axis: 'x', x: [-hw - 0.02, hw + 0.02], prof: [[-hd - oh, H], [hd + oh, H], [0, H + rh]], role: 'roof', capRole: 'data', layer: 1 });
      if (fs.chimney && roofKind === 'pitch') { const cx = (rnd() < 0.5 ? -1 : 1) * hw * 0.55; parts.push({ t: 'box', b: [cx - 0.35, -0.35, H + rh * 0.4, cx + 0.35, 0.35, H + rh + 0.9], role: 'chimney', layer: 2 }); }
      top = H + rh;
    } else { // hip
      rh = clamp(Math.min(D, W) * 0.3, 1.2, 5); const oh = 0.35, bx = hw + oh, by = hd + oh, rl = Math.max(0, W - D) / 2;
      const rf = (pts, n) => parts.push({ t: 'face', pts, n, role: 'roof', layer: 1 });
      rf([[-bx, by, H], [bx, by, H], [rl, 0, H + rh], [-rl, 0, H + rh]], [0, rh, by]);
      rf([[bx, -by, H], [-bx, -by, H], [-rl, 0, H + rh], [rl, 0, H + rh]], [0, -rh, by]);
      rf([[bx, by, H], [bx, -by, H], [rl, 0, H + rh]], [rh, 0, Math.max(bx - rl, 0.01)]);
      rf([[-bx, -by, H], [-bx, by, H], [-rl, 0, H + rh]], [-rh, 0, Math.max(bx - rl, 0.01)]);
      if (fs.chimney) { const cx = (rnd() < 0.5 ? -1 : 1) * Math.max(rl * 0.8, 0.8); parts.push({ t: 'box', b: [cx - 0.35, -0.35, H + rh * 0.3, cx + 0.35, 0.35, H + rh + 0.9], role: 'chimney', layer: 2 }); }
      top = H + rh;
    }
    if ((a.style === 'shop' || a.style === 'block') && roofKind === 'flat') {      // cornice
      parts.push({ t: 'box', b: [-hw - 0.1, hd, H - 0.4, hw + 0.1, hd + 0.22, H - 0.05], role: 'trim', layer: 6, needs: [0, 1] });
      parts.push({ t: 'box', b: [-hw - 0.1, -hd - 0.22, H - 0.4, hw + 0.1, -hd, H - 0.05], role: 'trim', layer: 6, needs: [0, -1] });
    }

    // ---- overlays: discrete geometry a simulation can switch on ----
    if (ov.includes('band')) for (const side of ['front', 'back', 'right', 'left']) parts.push(panel(side, rect(-SIDE[side].L / 2, SIDE[side].L / 2, 0, 0.55), 'band', { bias: 0.5 }));
    if (ov.includes('scaffold')) for (const side of ['front', 'back', 'right', 'left']) {
      const L = SIDE[side].L, np = Math.max(2, Math.round(L / 2.6) + 1);
      for (let i = 0; i < np; i++) { const u = -L / 2 + i * L / (np - 1); parts.push(protrude(side, u - 0.04, u + 0.04, 0.82, 0.9, 0, H + 1.0, 'scaffold', 7)); }
      for (let s = 0; s < N; s++) {
        const z = base(a, s) + 1.2;
        parts.push(protrude(side, -L / 2 - 0.2, L / 2 + 0.2, 0, 0.9, z, z + 0.08, 'scaffold', 7));
        parts.push(protrude(side, -L / 2, L / 2, 0.86, 0.9, z + 0.95, z + 1.0, 'scaffold', 7));
        parts.push(protrude(side, -L / 2, L / 2, 0.86, 0.9, z + 0.5, z + 0.54, 'scaffold', 7));
      }
    }
    if (ov.includes('solar')) {
      const quad = (pts) => { // outward normal (upwards) from the first three points
        const u = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]], v = [pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]];
        let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
        return { t: 'face', pts, n, role: 'solar', layer: 3 };
      };
      if (roofKind === 'flat') {
        const rows = clamp(Math.floor((D - 2) / 2.4), 1, 4), cols = clamp(Math.floor((W - 2) / 2), 1, 6);
        const cw = (W - 2) / cols, rd = (D - 2) / rows;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const x0 = -hw + 1 + c * cw + 0.12, x1 = -hw + 1 + (c + 1) * cw - 0.12, yb = -hd + 1 + r * rd + 0.1, yf = -hd + 1 + (r + 1) * rd - 0.1;
          const z = H + 0.7;
          parts.push(quad([[x0, yf, z + 0.2], [x1, yf, z + 0.2], [x1, yb, z + 0.7], [x0, yb, z + 0.7]]));
        }
      } else if (rh > 0) {
        const by = hd + 0.35, n = clamp(Math.floor(W / 2.2), 1, 5), pw = (W * 0.8) / n;
        for (const sg of [1, -1]) for (let c = 0; c < n; c++) {
          const x0 = -W * 0.4 + c * pw + 0.1, x1 = -W * 0.4 + (c + 1) * pw - 0.1;
          const pt = (x, t) => [x, sg * by * (1 - t), H + rh * t + 0.06];
          parts.push(quad(sg > 0 ? [pt(x0, 0.22), pt(x1, 0.22), pt(x1, 0.78), pt(x0, 0.78)] : [pt(x0, 0.78), pt(x1, 0.78), pt(x1, 0.22), pt(x0, 0.22)]));
        }
      }
    }
    if (ov.includes('marker')) parts.push({ t: 'box', b: [-0.7, -0.7, top - (rh > 0 ? 0.2 : 0), 0.7, 0.7, top + 0.5], role: 'marker', layer: 4 });
    // insulation, roof side: a slab on a flat roof, a band along the eaves of a pitched or hipped one (the cladding of the walls is above)
    if (ov.includes('insulation')) {
      if (roofKind === 'flat') parts.push({ t: 'box', b: [-hw + 0.3, -hd + 0.3, H, hw - 0.3, hd - 0.3, H + 0.14], role: 'insulroof', layer: 1, bias: 0.05 });
      else if (rh > 0) {
        const tt = 0.38;
        if (roofKind === 'hip') {
          const bx = hw + 0.35, by = hd + 0.35, rl = Math.max(0, W - D) / 2, lx = tt * (bx - rl);
          for (const sg of [1, -1]) {
            const e = sg * by * (1 - tt);
            parts.push({ t: 'face', pts: sg > 0 ? [[-bx, by, H + 0.06], [bx, by, H + 0.06], [bx - lx, e, H + rh * tt + 0.06], [-bx + lx, e, H + rh * tt + 0.06]]
                                               : [[bx, -by, H + 0.06], [-bx, -by, H + 0.06], [-bx + lx, e, H + rh * tt + 0.06], [bx - lx, e, H + rh * tt + 0.06]], n: [0, sg * rh, by], role: 'insulroof', layer: 3 });
          }
        } else {
          const by = hd + 0.35;
          for (const sg of [1, -1]) {
            const x0 = -hw - 0.02, x1 = hw + 0.02, e = sg * by * (1 - tt), zt = H + rh * tt + 0.06;
            parts.push({ t: 'face', pts: sg > 0 ? [[x0, by, H + 0.06], [x1, by, H + 0.06], [x1, e, zt], [x0, e, zt]] : [[x1, -by, H + 0.06], [x0, -by, H + 0.06], [x0, e, zt], [x1, e, zt]], n: [0, sg * rh, by], role: 'insulroof', layer: 3 });
          }
        }
      }
    }
    // community: a small pavilion on the roof with a flag, in the colour of cooperatives (reg.coop)
    if (ov.includes('community')) {
      const z0 = top - (rh > 0 ? 0.2 : 0);
      parts.push({ t: 'box', b: [-1.0, -1.0, z0, 1.0, 1.0, z0 + 0.8], role: 'community', layer: 4 });
      parts.push({ t: 'box', b: [-0.07, -0.07, z0 + 0.8, 0.07, 0.07, z0 + 3.4], role: 'frame', layer: 4 });
      parts.push({ t: 'flat', side: 'both', y: 0.03, poly: [[0.07, z0 + 3.4], [1.8, z0 + 2.9], [0.07, z0 + 2.4]], role: 'community', layer: 4 });
    }

    return { parts, meta: { H, top, roof: roofKind, bays: nbF } };
  }

  A.registerGroup('buildings', buildingDef);

  // ---------- placing assets on footprints ----------
  function convexHull(pts) {
    const p = pts.slice().sort((u, v) => u[0] - v[0] || u[1] - v[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    up.pop(); lo.pop(); return lo.concat(up);
  }
  function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(s) / 2; }
  function minRect(hull) {
    let best = null;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length], th = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(-th), s = Math.sin(-th);
      let x0 = 1e18, x1 = -1e18, y0 = 1e18, y1 = -1e18;
      for (const q of hull) { const x = q[0] * c - q[1] * s, y = q[0] * s + q[1] * c; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const area = (x1 - x0) * (y1 - y0);
      if (!best || area < best.area) best = { area, th, a: x1 - x0, b: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }
    const ct = Math.cos(best.th), st = Math.sin(best.th);
    return { th: best.th, a: best.a, b: best.b, area: best.area, x: best.cx * ct - best.cy * st, y: best.cx * st + best.cy * ct };
  }
  const HEADING_OF = { '+y': 0, '-x': 1, '-y': 2, '+x': 3 };   // which heading puts the front (local +y) on this world axis
  const FIT = { maxDevDeg: 12, minRectangularity: 0.82, minSide: 3 };

  // A grid of road segments for 'nearest road to this point'. Cycle tracks and tram tracks are not building fronts.
  function roadIndex(roads, cell) {
    cell = cell || 40;
    const g = new Map();
    for (const rd of roads) {
      if (rd.class === 'cycle' || rd.class === 'tramway') continue;
      for (let i = 0; i < rd.pts.length - 1; i++) {
        const p = rd.pts[i], q = rd.pts[i + 1], seg = [p[0], p[1], q[0], q[1]];
        for (let cx = Math.floor(Math.min(p[0], q[0]) / cell); cx <= Math.floor(Math.max(p[0], q[0]) / cell); cx++) for (let cy = Math.floor(Math.min(p[1], q[1]) / cell); cy <= Math.floor(Math.max(p[1], q[1]) / cell); cy++) {
          const k = cx + ',' + cy; let a = g.get(k); if (!a) g.set(k, a = []); a.push(seg);
        }
      }
    }
    return {
      cell, size: g.size,
      nearest(x, y) {
        let best = Infinity, bp = null; const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        for (let r = 0; r <= 14; r++) {
          for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
            if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;           // only the new ring
            const a = g.get(i + ',' + j); if (!a) continue;
            for (const s of a) {
              const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy || 1, t = clamp(((x - s[0]) * dx + (y - s[1]) * dy) / L2, 0, 1), px = s[0] + dx * t, py = s[1] + dy * t, d = Math.hypot(px - x, py - y);
              if (d < best) { best = d; bp = [px, py]; }
            }
          }
          if (bp && best <= r * cell) break;
        }
        return bp;
      }
    };
  }

  // Fit a footprint polygon to an asset slot. Returns { ok, reason, cx, cy, W, D, heading, ... }.
  function fitFootprint(fp, roads, opts) {
    const T = Object.assign({}, FIT, opts || {});
    const hull = convexHull(fp); const out = { ok: false, reason: '', cx: 0, cy: 0, W: 0, D: 0, heading: 0, dev: 0, rectangularity: 0 };
    if (hull.length < 3) { out.reason = 'degenerate'; return out; }
    const r = minRect(hull), area = polyArea(fp);
    out.cx = r.x; out.cy = r.y; out.rectangularity = area / (r.a * r.b);
    const thd = r.th * 180 / Math.PI, m = ((thd % 90) + 90) % 90; out.dev = Math.min(m, 90 - m);
    if (r.a < T.minSide || r.b < T.minSide) out.reason = 'too small';
    else if (out.rectangularity < T.minRectangularity) out.reason = 'not rectangular';
    else if (out.dev > T.maxDevDeg) out.reason = 'rotated ' + out.dev.toFixed(0) + ' degrees off the axes';
    const k = Math.round(r.th / (Math.PI / 2)), even = (((k % 2) + 2) % 2) === 0;
    const wx = even ? r.a : r.b, wy = even ? r.b : r.a;
    let nx = 0, ny = 1;                                   // default: front toward +y
    if (roads && (roads.nearest || roads.length)) {
      let bd = 1e18, bp = null;
      if (roads.nearest) bp = roads.nearest(out.cx, out.cy);
      else for (const rd of roads) { if (rd.class === 'cycle' || rd.class === 'tramway') continue; for (let i = 0; i < rd.pts.length - 1; i++) {
        const p = rd.pts[i], q = rd.pts[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy || 1;
        const t = clamp(((out.cx - p[0]) * dx + (out.cy - p[1]) * dy) / L2, 0, 1), px = p[0] + dx * t, py = p[1] + dy * t, d = Math.hypot(px - out.cx, py - out.cy);
        if (d < bd) { bd = d; bp = [px, py]; } } }
      if (bp) { const vx = bp[0] - out.cx, vy = bp[1] - out.cy; if (Math.abs(vx) > Math.abs(vy)) { nx = vx > 0 ? 1 : -1; ny = 0; } else { nx = 0; ny = vy > 0 ? 1 : -1; } }
    }
    out.heading = HEADING_OF[(nx ? (nx > 0 ? '+x' : '-x') : (ny > 0 ? '+y' : '-y'))];
    if (nx) { out.D = wx; out.W = wy; } else { out.D = wy; out.W = wx; }
    out.ok = out.reason === '';
    return out;
  }

  // ---------- regions: archetype mix and facade grammar (proposals) ----------
  // mult: archetype weight multipliers. roof: weights. shutters, awning, ac, chimney, balcony: probabilities. winK: window proportion.
  const RB = {
    nw: { mult: { terrace: 1.6, villa: 0.6, shophouse: 0.8 }, roof: { pitch: 0.9, flat: 0.1 }, shutters: 0, awning: 0.1, ac: 0, chimney: 0.5, balcony: 0.15, winK: 1.0 },
    uk: { mult: { terrace: 1.8, villa: 1.0, shophouse: 0.7 }, roof: { pitch: 0.95, flat: 0.05 }, shutters: 0, awning: 0.1, ac: 0, chimney: 0.8, balcony: 0.05, winK: 1.0 },
    ws: { mult: { block: 1.3, shophouse: 1.0, terrace: 1.0 }, roof: { flat: 0.35, pitch: 0.55, hip: 0.1 }, shutters: 0.45, awning: 0.3, ac: 0.05, chimney: 0.3, balcony: 0.5, winK: 1.1 },
    md: { mult: { block: 1.4, shophouse: 1.0, terrace: 1.0, villa: 0.8 }, roof: { flat: 0.5, pitch: 0.5 }, shutters: 0.6, awning: 0.4, ac: 0.25, chimney: 0.1, balcony: 0.4, winK: 0.85 },
    ce: { mult: { block: 1.6, terrace: 1.0, shophouse: 0.8, villa: 0.6 }, roof: { pitch: 0.5, hip: 0.2, flat: 0.3 }, shutters: 0.05, awning: 0.15, ac: 0.02, chimney: 0.3, balcony: 0.3, winK: 1.0 },
    sa: { mult: { shophouse: 1.6, terrace: 1.0, block: 1.0, villa: 0.8 }, roof: { flat: 0.7, pitch: 0.3 }, shutters: 0.05, awning: 0.5, ac: 0.3, chimney: 0, balcony: 0.35, winK: 0.8 },
    se: { mult: { shophouse: 2.0, terrace: 1.0, block: 1.0, villa: 0.5 }, roof: { flat: 0.6, pitch: 0.4 }, shutters: 0.05, awning: 0.6, ac: 0.5, chimney: 0, balcony: 0.3, winK: 0.8 },
    ea: { mult: { block: 1.8, tower: 1.5, shophouse: 0.8, terrace: 0.4, villa: 0.3 }, roof: { flat: 0.85, pitch: 0.15 }, shutters: 0, awning: 0.15, ac: 0.5, chimney: 0, balcony: 0.5, winK: 0.9 },
    me: { mult: { block: 1.4, villa: 1.0, shophouse: 0.8, terrace: 0.5 }, roof: { flat: 0.9, pitch: 0.1 }, shutters: 0.1, awning: 0.2, ac: 0.6, chimney: 0, balcony: 0.2, winK: 0.6 },
    sb: { mult: { shophouse: 1.2, villa: 1.2, terrace: 0.6, block: 0.8, shed: 0.8 }, roof: { pitch: 0.6, flat: 0.4 }, shutters: 0.05, awning: 0.4, ac: 0.1, chimney: 0, balcony: 0.15, winK: 0.75 },
    la: { mult: { block: 1.4, terrace: 1.0, villa: 1.0, shophouse: 1.0 }, roof: { flat: 0.6, pitch: 0.4 }, shutters: 0.1, awning: 0.3, ac: 0.2, chimney: 0, balcony: 0.4, winK: 0.9 },
    na: { mult: { villa: 1.8, terrace: 0.5, block: 1.0, shophouse: 0.8, tower: 1.0, shed: 0.8 }, roof: { pitch: 0.6, hip: 0.1, flat: 0.3 }, shutters: 0.1, awning: 0.15, ac: 0.3, chimney: 0.6, balcony: 0.2, winK: 1.0 }
  };
  for (const id of Object.keys(RB)) if (A.REGIONS[id]) A.REGIONS[id].buildings = RB[id];
  const RB_DEFAULT = RB.nw;
  const BAND = [[1, [['villa', 3], ['shed', 1], ['terrace', 2]]], [3, [['terrace', 4], ['villa', 2], ['shophouse', 3]]], [6, [['block', 3], ['shophouse', 2], ['terrace', 1]]], [999, [['tower', 3], ['block', 2]]]];
  function pickArchetype(regionId, levels, u) {
    const rg = (A.REGIONS[regionId] && A.REGIONS[regionId].buildings) || RB_DEFAULT;
    const band = BAND.find(b => levels <= b[0])[1];
    return A.pickWeighted(band.map(e => [e[0], e[1] * ((rg.mult && rg.mult[e[0]]) || 1)]), u);
  }

  // Parameters for one building: a quantised size (so assets are shared), a facade variant, and the regional facade style.
  function buildingParams(regionId, kind, levels, fit, seed) {
    const rg = (A.REGIONS[regionId] && A.REGIONS[regionId].buildings) || RB_DEFAULT, r = rngSeed(seed ^ 0x5bd1e995);
    let N = clamp(Math.round(levels), 1, 60); if (kind === 'shed') N = 1; if (kind === 'tower') N = Math.max(N, 6);
    const roofs = Object.keys(rg.roof).map(k => [k, rg.roof[k]]);
    const roof = A.pickWeighted(roofs, r());
    return { kind, W: clamp(Math.round(fit.W), 3, 80), D: clamp(Math.round(fit.D / 2) * 2, 4, 60), N, variant: Math.floor(r() * 12),
             fs: { shutters: r() < rg.shutters, awning: r() < rg.awning, ac: r() < rg.ac, chimney: r() < rg.chimney, balcony: Math.round(rg.balcony * 20) / 20, winK: Math.round(rg.winK * 20) / 20, roof } };
  }
  // seg: [n, k] or null. It is part of the asset id (JSON of this object), so each (shape, n, k) is one asset and, with the colours, one cached sprite.
  function buildingExtra(params, overlays, seg) {
    const x = { W: params.W, D: params.D, N: params.N, variant: params.variant, fs: params.fs, ov: (overlays || []).slice().sort() };
    if (seg && seg[0] >= 2) x.seg = [Math.min(SEG_MAX, seg[0] | 0), Math.max(0, Math.min(Math.min(SEG_MAX, seg[0] | 0), seg[1] | 0))];
    return x;
  }
  // The number of sections a block can be drawn in; more units are shown as k/n scaled to this many (segmentsFor).
  const SEG_MAX = 12;
  // n units of which k are done -> [sections, done sections] for the asset (at most cap, default SEG_MAX), or null when there is nothing to divide (fewer than two units, or missing data).
  function segmentsFor(n, k, cap) {
    cap = Math.max(2, Math.min(SEG_MAX, cap | 0 || SEG_MAX));
    if (!(n >= 2) || !(k >= 0)) return null;
    n = Math.round(n); k = Math.min(n, Math.round(k));
    if (n <= cap) return [n, k];
    let d = Math.round(k / n * cap); if (k > 0 && d === 0) d = 1; if (k < n && d === cap) d = cap - 1;     // a partial block never looks empty or complete
    return [cap, d];
  }

  // ---------- colours ----------
  // wall colour for one building: a weighted pick from the look's four wall colours, with a slight tone variation
  function wallFor(pal, seed) {
    const w = pal.walls || [pal.wall, pal.wall2], u = hash(seed + 1), i = w.length > 2 ? (u < 0.4 ? 0 : (u < 0.7 ? 1 : (u < 0.9 ? 2 : 3))) : (u < 0.65 ? 0 : 1);
    // five tone steps, not a continuous variation: buildings that share an asset and a tone share a cached sprite
    return shade(w[i], [0.95, 0.975, 1.0, 1.025, 1.05][Math.floor(hash(seed + 2) * 5) % 5]);
  }
  // o: { wall, data (override for the data surface), awning, shutter }
  // o.roof (a colour) replaces both roof colours: the data colour on the roof, or a neutral one. o: { wall, data, seed }: seed picks the roof and the accent (awnings, shutters) from the look
  function buildingColours(reg, pal, o) {
    const wall = o.wall || pal.wall, c = A.baseColours(reg), sd = o.seed || 0;
    const roof = o.roof || (pal.roofs ? pal.roofs[hash(sd + 3) < 0.7 ? 0 : 1] : pal.roof), acc = pal.accents ? pal.accents[Math.floor(hash(sd + 4) * pal.accents.length) % pal.accents.length] : pal.accent;
    return Object.assign(c, {
      data: o.data || wall, roof, roofflat: o.roof || pal.roofflat || mix(pal.ground, '#6e6e6e', 0.55), trim: mix(wall, '#ffffff', 0.5), door: reg.id === 'formal' ? shade(wall, 0.55) : shade(wall, 0.42),
      shutter: o.shutter || acc, awning: o.awning || acc, chimney: shade(wall, 0.8), solar: reg.id === 'formal' ? A.CARBON.blue[80] : '#2e3c5c', scaffold: reg.id === 'formal' ? A.CARBON.gray[60] : '#9a8a64',
      glassdark: shade(c.glass || reg.glass, 0.68), band: reg.states.queued, marker: reg.states.investor, frame: reg.id === 'formal' ? A.CARBON.gray[70] : '#4b4b50',
      // cladding: the wall pushed toward the look's "finished" green; a roof slab or band a darker step of it; community: the cooperative colour; segments: o.seg or defaults
      insul: mix(wall, reg.states.finished, 0.62), insulroof: shade(mix(wall, reg.states.finished, 0.8), 0.86), community: reg.coop,
      segdone: (o.seg && o.seg.done) || reg.states.finished, segtodo: (o.seg && o.seg.todo) || mix(wall, '#ffffff', 0.35)
    });
  }

  Object.assign(A, { ARCH, FIT, roadIndex, buildingParts: (kind, extra) => buildingDef(kind, extra).parts, fitFootprint, pickArchetype, buildingParams, buildingExtra, buildingColours, buildingHeight: heightOf, wallFor, segmentsFor, SEG_MAX });
})(typeof window !== 'undefined' ? window : globalThis);
