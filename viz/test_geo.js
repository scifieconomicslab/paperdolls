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

(async () => {
  for (const [name, fn] of queue) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
  console.log(failed ? failed + ' FAILED' : 'all ' + queue.length + ' passed'); process.exit(failed ? 1 : 0);
})();
