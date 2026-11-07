/* Tests for the geometry fixes of part 30 (issues #15, #20, #21): scene validation (degenerate footprints, levels cap), small engine items (shared scene
 * objects between sims, theme cache key, camera scale limits and guards), and smooth terrain shading. Ported from docs/state-machines/repro/r35*.js and r33.
 * Run: node viz/test_geo.js      (needs the 'canvas' package for the terrain pixel test only) */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
let createCanvas = null; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { /* pixel tests are skipped */ }
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date, Int32Array, Uint8Array, Float32Array, Float64Array, Number, String, isFinite, isNaN }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js', 'terrainlib.js', 'camera.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib, Cam = g.LabCamera;
if (createCanvas) A.sprites.factory = (w, h) => createCanvas(w, h);
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8')), fam = pal.families.find(f => f.id === 'nw');
const theme = () => A.theme(fam, undefined, 'colorfigures');
let failed = 0; const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const mkSim = (sc, o) => V.createSim(sc, Object.assign({ seed: 1, theme: theme(), region: 'nw' }, o || {}));

// ---------- #20: scene validation ----------
test('#20 degenerate footprints (collinear, repeated points) are counted, and sit at the bounding-box centre, not the origin', () => {
  const sc = V.makePlaceholderScene(7); sc.terrain = { x0: -100, y0: -100, dx: 100, dy: 100, nx: 12, ny: 8, z: Array.from({ length: 96 }, (_, i) => (i % 12) * 4) };
  sc.buildings.push({ id: 'collinear', footprint: [[300, 300], [310, 300], [320, 300]], levels: 3, archetype: 'terrace', state: 'none', investor: false });
  sc.buildings.push({ id: 'repeated', footprint: [[200, 200], [200, 200], [200, 200]], levels: 3, archetype: 'terrace', state: 'none', investor: false });
  const chk = V.validateScene(sc); assert.ok(chk.ok, 'still valid: repaired, not rejected');
  assert.ok(chk.warnings.some(w => /^2 building footprint\(s\) have no area/.test(w)), JSON.stringify(chk.warnings));
  const sim = mkSim(sc), d = sim.buildings[sim.buildings.length - 2], r = sim.buildings[sim.buildings.length - 1];
  assert.strictEqual(d.fit.ok, false); assert.deepStrictEqual([d.fit.cx, d.fit.cy], [310, 300]); assert.deepStrictEqual([r.fit.cx, r.fit.cy], [200, 200]);
  assert.ok(Math.abs(d.z - sim.terrain.at(310, 300)) < 1e-9, 'terrain height is taken where the building stands, not at the origin: ' + d.z);
});
test('#20 levels above 60 are counted and drawn with 60 (the ingest cap); an old valid scene gets no new warning', () => {
  const sc = V.makePlaceholderScene(7), b = sc.buildings[0]; b.levels = 200000;
  const chk = V.validateScene(sc); assert.ok(chk.ok); assert.ok(chk.warnings.some(w => /^1 building\(s\) have more than 60 levels/.test(w)), JSON.stringify(chk.warnings));
  const e = mkSim(sc).buildings[0]; assert.strictEqual(e.levels, 60); assert.strictEqual(sc.buildings[0].levels, 200000, 'the scene is not changed');
  const ok = V.validateScene(V.makePlaceholderScene(7)); assert.ok(ok.ok && !ok.warnings.some(w => /levels|no area/.test(w)), JSON.stringify(ok.warnings));
});

// ---------- #21: small engine items ----------
test('#21 createSim does not share or mutate the scene\'s building objects across sims (r35d)', () => {
  const sc = V.makePlaceholderScene(7), s1 = mkSim(sc), before = JSON.stringify(sc.buildings.map(b => [b.state, b.investor]));
  assert.notStrictEqual(s1.buildings[0].src, sc.buildings[0]);
  for (const e of s1.buildings) { e.src.state = 'finished'; e.src.investor = true; }
  assert.strictEqual(JSON.stringify(sc.buildings.map(b => [b.state, b.investor])), before, 'the scene is untouched');
  const s2 = mkSim(sc); assert.strictEqual(s2.buildings.filter(e => e.state === 'finished').length, sc.buildings.filter(b => b.state === 'finished').length);
  assert.strictEqual(s2.buildings[0].src.footprint, sc.buildings[0].footprint, 'immutable geometry is still shared (no copy cost)');
});
test('#21 AssetLib.theme: two different families without an id are two themes (r35e); the same object and id-ed families still share one', () => {
  const mk = (n, c) => ({ name: n, wall: c, wall2: c, roof: '#111111', accent: '#ff0000', ground: c, shadow: '#000000' });
  const a = mk('a', '#aaaaaa'), b = mk('b', '#00aa00');
  const t1 = A.theme(a, undefined, 'colorfigures'), t2 = A.theme(b, undefined, 'colorfigures');
  assert.notStrictEqual(t1, t2); assert.notStrictEqual(t1.ground, t2.ground);
  assert.strictEqual(A.theme(a, undefined, 'colorfigures'), t1, 'cached per family object');
  assert.strictEqual(A.theme(fam, undefined, 'colorfigures'), A.theme(fam, undefined, 'colorfigures'));
});
test('#21 camera.maxScale follows the scene both ways, and zoomAt ignores NaN, zero, negative and infinite factors (r33, r35g)', () => {
  const cam = Cam.create({ bounds: [0, 0, 10, 10], width: 1200, height: 700 });
  assert.ok(cam.maxScale > 32, 'a 10 m scene needs room: ' + cam.maxScale);
  cam.setBounds([0, 0, 5000, 5000]); const fresh = Cam.create({ bounds: [0, 0, 5000, 5000], width: 1200, height: 700 });
  assert.strictEqual(cam.maxScale, fresh.maxScale, 'back to the fresh camera\'s limit, not the old high-water mark');
  cam.zoomAt(2, 300, 200); const s = cam.scale, cx = cam.cx, cy = cam.cy;
  for (const f of [NaN, 0, -1, Infinity, -Infinity, undefined, null, '2']) { cam.zoomAt(f); cam.zoomAt(f, 100, 100); cam.zoomAt(2, NaN, NaN); cam.zoomAt(0.5, NaN, NaN); }
  assert.ok(isFinite(cam.scale) && isFinite(cam.cx) && isFinite(cam.cy));
  cam.zoomAt(NaN); assert.strictEqual(cam.scale, cam.scale); cam.zoomTo(NaN); cam.setZoomFraction(NaN);
  assert.ok(isFinite(cam.scale) && cam.scale >= cam.minScale && cam.scale <= cam.maxScale, String(cam.scale));
});

// ---------- #15: terrain shading ----------
// A ground-only picture of a gentle synthetic hill (a bump 6 m high and about 250 m across: slopes of at most 2-3%, like Jette's), as RGB at a view where one cell is a few to many pixels.
const GROUND_ONLY = { buildings: false, trees: false, vehicles: false, people: false };
function hillScene(cell, edgeFill) {
  const nx = Math.ceil(600 / cell) + 1, ny = nx, z = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = i * cell - 300, y = j * cell - 300, v = 6 * Math.exp(-(x * x + y * y) / (2 * 110 * 110)) + 0.004 * x; z.push(Math.round(v * 10) / 10); }
  if (edgeFill) for (let j = 0; j < ny; j++) for (let i = nx - 8; i < nx; i++) z[j * nx + i] = z[j * nx + nx - 9];     // the nearest-height fill the ingest writes past the elevation data
  const corner = (id, x, y) => ({ id, footprint: [[x, y], [x + 6, y], [x + 6, y + 6], [x, y + 6]], levels: 1, archetype: 'shed', state: 'none', investor: false });     // they only fix the scene's bounds: the ground is drawn over the bounds
  return { area: { name: 'hill' }, roads: [], buildings: [corner('c1', -300, -300), corner('c2', 292, 292)], landuse: [], trees: [], terrain: { x0: -300, y0: -300, dx: cell, dy: cell, nx, ny, z } };
}
function groundPixels(scene, k, W, H) {
  A.sprites.cache.clear(); A.sprites.pixels = 0;
  const sim = mkSim(scene), cv = createCanvas(W, H), c = cv.getContext('2d'); sim.opts.sliceLayers = false; sim.opts.buildMs = 1e9; sim.opts.prewarm = false;
  const view = { w: W, h: H, scale: k, ox: W / 2, oy: H / 2 + 5 * k };                       // the scene's centre (0, 0) in the middle
  for (let i = 0; i < 6; i++) V.renderFrame(c, sim, view, GROUND_ONLY);
  return c.getImageData(0, 0, W, H).data;
}
// the share of pixels, in the interior of the hill's picture, whose second difference of grey along a row exceeds `lim`: a smooth shade has almost none (a step at a cell edge has one pair)
function kinks(d, W, H, lim) {
  let n = 0, tot = 0; const L = i => d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
  for (let y = Math.floor(H * 0.4); y < H * 0.6; y++) for (let x = Math.floor(W * 0.35); x < W * 0.65; x++) { const i = y * W + x, d2 = Math.abs(L(i - 1) - 2 * L(i) + L(i + 1)); tot++; if (d2 > lim) n++; }
  return n / tot;
}
for (const [k, name] of [[0.6, 'far (cell 15 px)'], [2, 'mid (cell 50 px)'], [5, 'near (cell 125 px)']]) test('#15 smooth relief shading: no visible cell edges at ' + name, () => {
  if (!createCanvas) return;
  const W = 900, H = 600, d = groundPixels(hillScene(25), k, W, H), f = kinks(d, W, H, 2);
  if (process.env.SHOW) console.log(name, 'kinks>2', (f * 100).toFixed(3) + '%', 'kinks>1.5', (kinks(d, W, H, 1.5) * 100).toFixed(3) + '%');
  assert.ok(f < 0.002, 'cell edges show as kinks in the shade: ' + (f * 100).toFixed(3) + '% of pixels have a second difference above 2 grey levels');
});
test('#15 the shade fades out over made-up land at the elevation data\'s edge (the streaks), and is the same inside the data', () => {
  if (!createCanvas) return;
  const W = 900, H = 600, k = 0.8, shot = sc => { A.sprites.cache.clear(); A.sprites.pixels = 0; const sim = mkSim(sc), cv = createCanvas(W, H), c = cv.getContext('2d'); sim.opts.sliceLayers = false; sim.opts.buildMs = 1e9; sim.opts.prewarm = false;
    const view = { w: W, h: H, scale: k, ox: W / 2, oy: H / 2 + 5 * k }; for (let i = 0; i < 6; i++) V.renderFrame(c, sim, view, GROUND_ONLY);
    const px = (x, y) => { const p = V.proj(view, x, y, sim.terrain.at(x, y)), d = c.getImageData(Math.round(p[0]), Math.round(p[1]), 1, 1).data; return d[0] * 0.3 + d[1] * 0.59 + d[2] * 0.11; };
    return { px, ground: sim.opts.theme.ground }; };
  const filled = shot(hillScene(25, true)), plain = shot(hillScene(25, false));
  // x = 270 m is inside the fill (the last 200 m): each row repeats, so the "slope" across rows is an artefact; y = 120 m is where the hill's own slope is steepest
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), gr = hex(filled.ground), gl = gr[0] * 0.3 + gr[1] * 0.59 + gr[2] * 0.11;
  assert.ok(Math.abs(filled.px(270, 120) - gl) < 2.5, 'over the fill the shade is neutral: ' + filled.px(270, 120).toFixed(1) + ' vs ground ' + gl.toFixed(1));
  assert.ok(Math.abs(filled.px(-120, 120) - plain.px(-120, 120)) < 1.5, 'inside the data nothing changed');
});


(async () => {
  for (const [name, fn] of queue) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
  console.log(failed ? failed + ' FAILED' : 'all ' + queue.length + ' passed'); process.exit(failed ? 1 : 0);
})();

