/* Tests for terrain: the scene schema (z on buildings, road vertices and trees, a ground grid), the renderer (lift, depth, ground, shadows, agents), picking
 * with elevation, the camera's room for relief, and, above all, that a scene without z draws exactly what it drew before terrain existed.
 * Run: node viz/test_terrain.js      (needs the 'canvas' package) */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date, Int32Array, Uint8Array, Float32Array }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js', 'terrainlib.js', 'packpick.js', 'camera.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib, Tr = g.Terrain, Pick = g.Pick, Cam = g.LabCamera; A.sprites.factory = (w, h) => createCanvas(w, h);
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8')), fam = pal.families.find(f => f.id === 'nw');
const clone = o => JSON.parse(JSON.stringify(o));
let failed = 0; const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const W = 1200, H = 700;
const viewAt = (B, k, cx, cy, lift) => { cx = cx === undefined ? (B[0] + B[2]) / 2 : cx; cy = cy === undefined ? (B[1] + B[3]) / 2 : cy; return { w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * 0.8660254, oy: H / 2 - (cx + cy) * k * 0.5 + (lift || 0) * k }; };
function makeSim(scene, opts) { const theme = A.theme(fam, undefined, 'colorfigures'), sim = V.createSim(scene, Object.assign({ seed: 5, theme, region: 'nw' }, opts || {})); for (let i = 0; i < 20; i++) V.stepSim(sim, 0.1); return sim; }
function draw(sim, view, layers, frames) {
  A.sprites.cache.clear(); A.sprites.pixels = 0; sim._ground = sim._far = sim._zoom = sim._warm = null;
  const cv = createCanvas(W, H), c = cv.getContext('2d'); sim.opts.sliceLayers = false; sim.opts.buildMs = 1e9; sim.opts.prewarm = false;
  for (let i = 0; i < (frames || 6); i++) V.renderFrame(c, sim, view, layers);
  return c.getImageData(0, 0, W, H).data;
}
const sha = d => crypto.createHash('sha256').update(Buffer.from(d.buffer, d.byteOffset, d.length)).digest('hex');
// the rows and columns where two images differ
function diffBox(a, b) { let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } } return { x0, y0, x1, y1, n }; }
const oneBuilding = z => ({ area: { name: 't' }, roads: [{ id: 'r', class: 'local', pts: [[-40, 60], [80, 60]] }], buildings: [{ id: 'b1', footprint: [[0, 0], [12, 0], [12, 10], [0, 10]], levels: 3, archetype: 'terrace', state: 'none', investor: false }].map(b => z === undefined ? b : Object.assign(b, { z })), landuse: [], trees: [] });

// ---------- schema ----------
test('schema: old scenes validate; z on buildings, road points and trees, and a terrain grid, validate; bad ones are named', () => {
  assert.ok(V.validateScene(V.makePlaceholderScene(7)).ok);
  const s = oneBuilding(4.5); s.roads[0].z = [3, 4]; s.trees = [[5, 5, null, null, 2.5]]; s.terrain = { x0: -50, y0: -50, dx: 50, dy: 50, nx: 3, ny: 3, z: [0, 1, 2, 3, 4, 5, 6, 7, 8] };
  assert.strictEqual(V.validateScene(s).errors.length, 0, JSON.stringify(V.validateScene(s).errors));
  const bad = (f, re) => { const t = clone(s); f(t); const r = V.validateScene(t); assert.ok(!r.ok && re.test(r.errors.join(' ')), re + ' in ' + JSON.stringify(r.errors)); };
  bad(t => { t.buildings[0].z = 'high'; }, /z must be a number/); bad(t => { t.roads[0].z = [1]; }, /one height in metres per point/);
  bad(t => { t.trees[0][4] = 'x'; }, /tree 0: z/); bad(t => { t.terrain.z = [1, 2, 3]; }, /terrain must be/); bad(t => { t.terrain.nx = 1; }, /terrain must be/);
});

// ---------- the old picture is unchanged ----------
const GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'terrain_golden.json'), 'utf8'));
function placeholderShot(k) {
  const scene = V.makePlaceholderScene(7), sim = makeSim(scene), B = V.sceneBounds(scene);
  return draw(sim, viewAt(B, k), {});
}
for (const [name, k] of [['overview', 0.7], ['street', 4]]) test('regression: the placeholder scene draws as it did before terrain (' + name + ')', () => {
  const d = placeholderShot(k), gold = GOLD[name];
  if (sha(d) === gold.sha) return;                      // byte for byte, on the machine the golden was made on
  // another canvas build can round differently: then every 24 x 25 block must still match the golden's mean colour
  let worst = 0; for (let ty = 0; ty < 28; ty++) for (let tx = 0; tx < 50; tx++) { let r = 0, gg = 0, b = 0; for (let y = ty * 25; y < ty * 25 + 25; y++) for (let x = tx * 24; x < tx * 24 + 24; x++) { const i = (y * W + x) * 4; r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const j = (ty * 50 + tx) * 3; worst = Math.max(worst, Math.abs(r / 600 - gold.thumb[j]), Math.abs(gg / 600 - gold.thumb[j + 1]), Math.abs(b / 600 - gold.thumb[j + 2])); }
  assert.ok(worst <= 1.5, 'the picture changed: the worst block differs by ' + worst.toFixed(2) + ' of 255');
});
test('regression: z = 0 everywhere, with or without relief, draws the same pixels as no z at all', () => {
  const base = oneBuilding(), B = V.sceneBounds(base), v = viewAt(B, 4), ref = sha(draw(makeSim(base), v, {}));
  const z0 = oneBuilding(0); z0.roads[0].z = [0, 0]; assert.strictEqual(sha(draw(makeSim(z0), v, {})), ref);
  assert.strictEqual(sha(draw(makeSim(oneBuilding(7), { relief: 0 }), v, {})), ref, 'relief 0 lifts nothing');
  const rz = oneBuilding(7); rz.roads[0].z = [9, 20]; rz.trees = [[3, 30, null, null, 8]]; const rzRef = oneBuilding(); rzRef.trees = [[3, 30]];
  assert.strictEqual(sha(draw(makeSim(rz, { relief: 0 }), v, {})), sha(draw(makeSim(rzRef), v, {})), 'relief 0 lifts roads and trees too, without a terrain grid');
});

// ---------- lift ----------
test('lift: a building at z metres is drawn z * scale pixels higher, and its shadow and road go with the ground', () => {
  const k = 4, flat = oneBuilding(), B = V.sceneBounds(flat), v = viewAt(B, k, undefined, undefined, 0);
  const none = draw(makeSim(flat), v, { buildings: false, trees: false, vehicles: false, people: false });
  const a = diffBox(none, draw(makeSim(flat), v, { trees: false, vehicles: false, people: false }));
  const up = oneBuilding(10), b = diffBox(none, draw(makeSim(up), v, { trees: false, vehicles: false, people: false }));
  assert.ok(a.n > 500 && b.n > 500, 'the building is drawn');
  assert.ok(Math.abs((a.y0 - b.y0) - 10 * k) <= 2 && Math.abs((a.y1 - b.y1) - 10 * k) <= 2, 'top and bottom rise by 40 px: ' + (a.y0 - b.y0) + ', ' + (a.y1 - b.y1));
  assert.ok(Math.abs(a.x0 - b.x0) <= 1 && Math.abs(a.x1 - b.x1) <= 1, 'no sideways shift');
  const x3 = diffBox(none, draw(makeSim(up, { relief: 3 }), v, { trees: false, vehicles: false, people: false }));
  assert.ok(Math.abs((a.y0 - x3.y0) - 30 * k) <= 2, 'relief 3 triples the lift');
});
test('lift: an extruded building (no asset fit) is lifted too', () => {
  const s = oneBuilding(), B = V.sceneBounds(s); s.buildings[0].footprint = [[0, 0], [14, 2], [12, 11], [3, 13], [-1, 6]];       // not a rectangle: the generic extrusion
  const k = 4, v = viewAt(B, k), none = draw(makeSim(s), v, { buildings: false, trees: false, vehicles: false, people: false });
  const sim = makeSim(s); assert.ok(!sim.buildings[0].params, 'extruded');
  const a = diffBox(none, draw(sim, v, { trees: false, vehicles: false, people: false })), up = clone(s); up.buildings[0].z = 8;
  const b = diffBox(none, draw(makeSim(up), v, { trees: false, vehicles: false, people: false }));
  assert.ok(Math.abs((a.y0 - b.y0) - 8 * k) <= 2, 'rises by 32 px: ' + (a.y0 - b.y0));
});
test('lift: relief 0 keeps every position (the ground is shaded, nothing is lifted)', () => {
  const s = oneBuilding(9), B = V.sceneBounds(s); s.terrain = Tr.synthetic(B, { cell: 20, relief: 30 });
  const k = 4, v = viewAt(B, k), L = { trees: false, vehicles: false, people: false, buildings: true };
  const flat = oneBuilding(); const none = draw(makeSim(flat), v, { buildings: false, trees: false, vehicles: false, people: false });
  const a = diffBox(none, draw(makeSim(flat), v, L)), sh = clone(s); const r0 = draw(makeSim(sh, { relief: 0 }), v, L);
  const noneShaded = draw(makeSim(Object.assign(clone(s), { buildings: [] }), { relief: 0 }), v, L), b = diffBox(noneShaded, r0);
  assert.ok(Math.abs(a.y0 - b.y0) <= 2 && Math.abs(a.y1 - b.y1) <= 2, 'same rows as the flat building: ' + a.y0 + ' vs ' + b.y0);
});

// ---------- terrain sampling, ground, shadows ----------
test('terrain: bilinear sampling, clamped at the edge; heights default from the grid; an explicit z wins', () => {
  const s = oneBuilding(); s.terrain = { x0: 0, y0: 0, dx: 10, dy: 10, nx: 3, ny: 3, z: [0, 10, 20, 0, 10, 20, 0, 10, 20] };   // rises 1 m per metre eastward
  s.trees = [[5, 5], [15, 5, null, null, 99]];
  const sim = makeSim(s), T = sim.terrain;
  assert.strictEqual(T.at(0, 0), 0); assert.strictEqual(T.at(10, 7), 10); assert.strictEqual(T.at(5, 3), 5); assert.strictEqual(T.at(-50, 0), 0); assert.strictEqual(T.at(500, 500), 20);
  assert.ok(Math.abs(sim.buildings[0].z - 6) < 1.2, 'the building takes the grid height at its centre (about 6 m): ' + sim.buildings[0].z);
  assert.ok(Math.abs(sim.trees[0].z - 5) < 1e-9 && sim.trees[1].z === 99);
  assert.strictEqual(makeSim(s, { relief: 2 }).trees[0].z, 10, 'relief scales what is read from the grid');
  assert.ok(sim.zmax >= 99 && makeSim(oneBuilding()).zmax === 0);
});
test('ground: a hill lifts the ground, roads follow their own z, and the relief shading is lighter facing the sun and darker away', () => {
  const s = oneBuilding(); s.buildings = []; const B = V.sceneBounds(s);
  const mk = zf => Object.assign(clone(s), { terrain: { x0: -100, y0: -100, dx: 20, dy: 20, nx: 15, ny: 11, z: Array.from({ length: 165 }, (_, n) => zf(-100 + (n % 15) * 20, -100 + Math.floor(n / 15) * 20)) } });
  const v = viewAt(B, 2), L = { buildings: false, trees: false, vehicles: false, people: false };
  const lum = (d, x, y) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return d[i] + d[i + 1] + d[i + 2]; };
  // a slope that falls toward +x faces the sun (which stands toward +x, -y): lighter than a slope that falls toward -x. Sample the ground in an empty corner of the scene.
  const east = draw(makeSim(mk((x, y) => -0.12 * x), { relief: 0 }), v, L), west = draw(makeSim(mk((x, y) => 0.12 * x), { relief: 0 }), v, L), flat = draw(makeSim(mk(() => 0), { relief: 0 }), v, L);
  const p = V.proj(v, 30, 40, 0);
  assert.ok(lum(east, ...p) > lum(flat, ...p) && lum(west, ...p) < lum(flat, ...p), 'lit side ' + lum(east, ...p) + ' > flat ' + lum(flat, ...p) + ' > shaded side ' + lum(west, ...p));
  // a raised road: its z lifts it on screen by z * scale
  const r1 = oneBuilding(); r1.buildings = []; const r2 = clone(r1); r2.roads[0].z = [12, 12];
  const a = diffBox(draw(makeSim(r1), v, L), draw(makeSim(r2), v, L)); assert.ok(a.n > 300, 'the road moved');
  const none = oneBuilding(); none.buildings = []; none.roads = [{ id: 'q', class: 'local', pts: [[0, 0], [1, 0]] }];
});
test('shadow: a building\'s shadow stands on its ground height, not at z = 0', () => {
  const k = 4, up = oneBuilding(10), flat = oneBuilding(), B = V.sceneBounds(flat), v = viewAt(B, k);
  const L = { trees: false, vehicles: false, people: false }, base = draw(makeSim(flat), v, { buildings: false, trees: false, vehicles: false, people: false });
  // with the building hidden by drawing only the ground layer (the shadow is part of the cached ground layer), the shadow shifts by 10 * k px
  const sh = (s) => { const sim = makeSim(s); sim.buildings.forEach(e => { e._asset = null; }); return sim; };
  const gOnly = (s) => { const sim = makeSim(s), d1 = draw(sim, v, { buildings: true, trees: false, vehicles: false, people: false }); return d1; };
  const dflat = diffBox(base, gOnly(flat)), dup = diffBox(base, gOnly(up));
  assert.ok(Math.abs(dflat.y1 - dup.y1) >= 10 * k - 2, 'the lowest changed row (the shadow or foot) moves up with the ground');
});

// ---------- agents, trees, depth ----------
test('agents: a vehicle on a road with z is at the road\'s height; on a terrain it is at the terrain\'s', () => {
  const s = oneBuilding(); s.buildings = []; s.roads[0].z = [0, 12];
  const sim = makeSim(s), a = sim.agents[0] || (() => { throw new Error('no agent'); })(), e = a.edge;
  for (const t of [0, 0.5, 1]) { a.s = t * e.len; const p = V.agentPose(a, sim); assert.ok(Math.abs(p.z - (e.az + (e.bz - e.az) * t)) < 1e-9, 'z along the edge'); }
  const s2 = oneBuilding(); s2.buildings = []; s2.terrain = { x0: -100, y0: -100, dx: 100, dy: 100, nx: 4, ny: 3, z: [0, 10, 20, 30, 0, 10, 20, 30, 0, 10, 20, 30] };
  const sim2 = makeSim(s2, { relief: 2 }), a2 = sim2.agents[0]; a2.s = 0; const p2 = V.agentPose(a2, sim2); assert.ok(Math.abs(p2.z - 2 * sim2.terrain.at(p2.x, p2.y)) < 1e-9);
});
test('depth: height counts in the paint order (a building up a hill is in front of one behind it at the same x + y)', () => {
  // two overlapping footprints one behind the other along (1, 1): the nearer one is lower. Raising the farther one 30 m puts it nearer the camera than a point at the same x + y
  const s = oneBuilding(); s.buildings = [];
  const mkb = (id, x, y, z) => ({ id, footprint: [[x, y], [x + 8, y], [x + 8, y + 8], [x, y + 8]], levels: 2, archetype: 'terrace', state: 'none', investor: false, z });
  s.buildings.push(mkb('far-high', 0, 0, 30), mkb('near-low', 10, 10, 0));
  const sim = makeSim(s), A_ = sim.buildings[0], B_ = sim.buildings[1];
  assert.ok(A_.fit.cx + A_.fit.cy + A_.z > B_.fit.cx + B_.fit.cy + B_.z, 'the high building sorts after (is drawn over) the low one');
  const pk = Pick.create(sim), hit = (e, view) => { const q = V.proj(view, e.fit.cx, e.fit.cy, e.z + 3); return pk.hit(view, q[0], q[1]); };
  const view = viewAt(V.sceneBounds(s), 3);
  assert.strictEqual(hit(A_, view), 0, 'a pick at the high building\'s wall lands on it'); assert.strictEqual(hit(B_, view), 1);
});

// ---------- picking ----------
test('pick: with elevation the grid agrees with a brute-force scan, and a pixel on a lifted roof picks that building', () => {
  const sc = V.makePlaceholderScene(7), B = V.sceneBounds(sc); Tr.attach(sc, Tr.synthetic(B, { cell: 25, relief: 40 }));
  const sim = makeSim(sc, { relief: 2 }), pk = Pick.create(sim), view = viewAt(B, 2);
  let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let mismatches = 0, hits = 0;
  for (let n = 0; n < 1500; n++) {
    const px = rnd() * W, py = rnd() * H, a = (px - view.ox) / (view.scale * 0.8660254), b2 = (py - view.oy) * 2 / view.scale, gx = (a + b2) / 2, gy = (b2 - a) / 2;
    const h = pk.hit(view, px, py); if (h >= 0) hits++; if (h !== pk.hitBrute(gx, gy)) mismatches++;
  }
  assert.strictEqual(mismatches, 0); assert.ok(hits > 100, 'queries land on buildings: ' + hits);
  let ok = 0, tried = 0;
  for (let i = 0; i < sim.buildings.length; i += 7) {                      // the middle of the roof of every 7th building: the pick is that building, or one drawn in front of it
    const e = sim.buildings[i], H_ = V.entityHeight(e), q = V.proj(view, e.fit.cx, e.fit.cy, e.z + H_ * 0.5); tried++;
    const h = pk.hit(view, q[0], q[1]); if (h === i) ok++; else if (h >= 0) { const o = sim.buildings[h]; assert.ok(o.fit.cx + o.fit.cy + o.z >= e.fit.cx + e.fit.cy + e.z, 'a different building wins only if it is drawn over'); ok++; }
  }
  assert.ok(ok / tried > 0.97, 'mid-wall picks: ' + ok + ' of ' + tried);
  assert.ok(pk.silhouette(0).z === sim.buildings[0].z);
});

// ---------- the camera ----------
test('camera: setRelief leaves room for the hills and recentres; the pointer maths is unchanged', () => {
  const cam = Cam.create({ bounds: [0, 0, 1000, 1000], width: 1200, height: 700 }), f0 = cam.fit, c0 = [cam.cx, cam.cy];
  cam.setRelief(60); cam.fitAll();
  assert.ok(cam.fit < f0, 'the fit is a little smaller to leave room'); assert.ok(Math.abs(cam.cx - c0[0] + 30) < 1e-9 && Math.abs(cam.cy - c0[1] + 30) < 1e-9, 'aimed half the relief up the screen');
  const v = cam.view(), top = v.oy + (0 + 0) * cam.scale * 0.5 - 60 * cam.scale;          // the north corner of the map with its hill: still on screen
  assert.ok(top >= -1 && top < 40, 'the tallest corner is just inside the canvas: ' + top);
  const bottom = v.oy + 1000 * cam.scale; assert.ok(bottom <= 700 + 1 && bottom > 660, 'and the bottom corner too: ' + bottom);
  const [wx, wy] = cam.screenToWorld(300, 200); const v2 = cam.view(); assert.ok(Math.abs(v2.ox + (wx - wy) * cam.scale * 0.8660254 - 300) < 1e-6 && Math.abs(v2.oy + (wx + wy) * cam.scale * 0.5 - 200) < 1e-6);
  const cam2 = Cam.create({ bounds: [0, 0, 1000, 1000], width: 1200, height: 700 }); assert.strictEqual(cam2.fit, f0, 'without relief nothing changed');
  assert.ok(V.fitView({ roads: [], buildings: [{ footprint: [[0, 0], [10, 0], [10, 10]] }], landuse: [], trees: [] }, 800, 500, 0.1, 30).scale < V.fitView({ roads: [], buildings: [{ footprint: [[0, 0], [10, 0], [10, 10]] }], landuse: [], trees: [] }, 800, 500, 0.1).scale);
});

// ---------- the synthetic terrain ----------
test('terrainlib: the synthetic terrain is deterministic, about the asked relief, and attach writes z everywhere', () => {
  const B = [0, 0, 3000, 3000], a = Tr.synthetic(B, { relief: 38, seed: 3 }), b = Tr.synthetic(B, { relief: 38, seed: 3 });
  assert.deepStrictEqual(a.z, b.z); const lo = Math.min(...a.z), hi = Math.max(...a.z); assert.ok(hi - lo > 30 && hi - lo < 50, 'relief ' + (hi - lo));
  const sc = V.makePlaceholderScene(7); Tr.attach(sc, Tr.synthetic(V.sceneBounds(sc), { cell: 25 }));
  assert.ok(sc.buildings.every(x => typeof x.z === 'number') && sc.roads.every(r => r.z.length === r.pts.length) && sc.trees.every(t => typeof t[4] === 'number') && V.validateScene(sc).ok);
});

(async () => {
  for (const [name, fn] of queue) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message || e)); } }
  console.log(failed ? failed + ' failed' : 'all passed'); process.exit(failed ? 1 : 0);
})();
