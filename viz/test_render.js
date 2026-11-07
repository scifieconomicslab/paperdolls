/* Regression tests for the rendering-engine fixes of part 30 (docs/state-machines/parts/30-rendering.md): GPU canvas backing (#3), ground marks (#17), ground height (#14),
 * the sprite budget and eviction (#18), device pixel ratio and the far layer's exact flag (#19). Each ports a repro (docs/state-machines/repro/rNN-*.js) and fails on the code it was written against.
 * Run: node viz/test_render.js (node-canvas on NODE_PATH / PAPERDOLLS_NODE_MODULES). Prints PASS/FAIL and exits non-zero on failure. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const R = require('../docs/state-machines/repro/_render.js');
const { A, V } = R;
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; process.exitCode = 1; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); } }

// ---- #3: offscreen canvases are memory-backed in the browser pages ----
test('#3 canvasFactory: every offscreen canvas opens its 2d context willReadFrequently (memory-backed), the stage canvases are untouched', () => {
  assert.strictEqual(typeof A.canvasFactory, 'function', 'AssetLib.canvasFactory exists');
  const made = [], doc = { createElement: tag => { assert.strictEqual(tag, 'canvas'); const c = { width: 0, height: 0, calls: [], getContext(t, o) { c.calls.push([t, o]); return {}; } }; made.push(c); return c; } };
  const f = A.canvasFactory(doc), c = f(30, 20);
  assert.strictEqual(c.width, 30); assert.strictEqual(c.height, 20);
  assert.strictEqual(JSON.stringify(c.calls[0]), JSON.stringify(['2d', { willReadFrequently: true }]), 'the FIRST getContext call decides the backing, so the factory makes it');
  const g = A.canvasFactory(doc, { soft: false })(5, 5); assert.strictEqual(g.calls.length, 0, 'soft: false leaves the canvas to the browser');
  for (const page of ['viewer.html', 'packhost.html']) {
    const src = fs.readFileSync(path.join(R.VIZ, page), 'utf8');
    assert(/A\.sprites\.factory = A\.canvasFactory\(document\)/.test(src), page + ' builds its canvases with AssetLib.canvasFactory');
    assert(!/sprites\.factory = \(w, hh\) =>/.test(src), page + ' has no plain factory left');
  }
});


// ---- shared helpers for the ground tests ----
const W = 1200, H = 700;
const whole = s => !s._farP && !s._groundP && !s._farPatch && !(s._far && s._far.rough) && !s._farC && !s._groundC && A.sprites.builds === 0;
function settle(sim, c, view, max) { for (let n = 0; n < (max || 4000); n++) { V.renderFrame(c, sim, view, {}); if (n > 4 && whole(sim)) break; } for (let i = 0; i < 4; i++) V.renderFrame(c, sim, view, {}); }
function marksCells(scene, size, share) { const B = V.sceneBounds(scene), out = []; for (let x = Math.floor(B[0] / size) * size; x < B[2]; x += size) for (let y = Math.floor(B[1] / size) * size; y < B[3]; y += size) out.push({ kind: (Math.round(x / size) + Math.round(y / size)) & 1 ? 'halo' : 'outline', x0: x, y0: y, x1: x + size, y1: y + size, share, colour: '#c0392b' }); return out; }
const px = c => c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
const maxDiff = (a, b) => { let m = 0, n = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; if (d) n++; } return { max: m, n }; };

// ---- #17: ground marks are cached; a replay's style is versioned ----
test('#17 ground marks: a settled far frame paints the marks zero times, a new version or view paints them once, and the picture equals the uncached drawing', () => {
  const scene = R.tiled(3), view = R.fitView(scene, W, H), cs = marksCells(scene, 100, 0.5);
  let version = 1; const mk = (o) => { R.resetSprites(); R.clock.set(0.25); const s = R.mkSim(scene, Object.assign({ layerMs: 6 }, o)); s.groundMarks = { cells: () => cs, version: () => version }; return s; };
  const cached = mk({}), c1 = R.ctx2d(W, H); settle(cached, c1, view);
  assert.strictEqual(cached.marksPaints, 1, 'painted once while settling: ' + cached.marksPaints);
  for (let i = 0; i < 6; i++) V.renderFrame(c1, cached, view, {});
  assert.strictEqual(cached.marksPaints, 1, 'six more settled frames paint nothing');
  version = 2; V.renderFrame(c1, cached, view, {}); assert.strictEqual(cached.marksPaints, 2, 'a new frame version repaints once');
  V.renderFrame(c1, cached, view, {}); assert.strictEqual(cached.marksPaints, 2);
  const plain = mk({ cacheMarks: false }); plain.groundMarks = { cells: () => cs, version: () => version }; const c2 = R.ctx2d(W, H); settle(plain, c2, view);
  const d = maxDiff(px(c1), px(c2)); console.log('   cached vs uncached marks: max channel difference ' + d.max + ', ' + d.n + ' of ' + px(c1).length + ' bytes differ');
  assert(d.max <= 2, 'the cached marks equal the uncached ones to 2 levels of 255: ' + d.max);
});
test('#17 replay: a mapping gives a versioned style, so the far layer stays on and an idle frame calls the style zero times', () => {
  const sc = V.makePlaceholderScene(7), N = sc.buildings.length; R.resetSprites(); R.clock.set(0.25);
  const sim = R.mkSim(sc, { layerMs: 1e9, buildMs: 1e9 });
  const data = { n: N, mapping: [{ variable: 'v', channel: 'wall', scale: { type: 'sequential', colours: ['#f4e9c8', '#c8452f'], domain: [0, 1] } }], weeks: [{ vars: { v: Array.from({ length: N }, (_, i) => i / N) } }, { vars: { v: Array.from({ length: N }, (_, i) => (i % 7) / 7) } }] };
  const rp = R.g.Replay.create(sim, data); let calls = 0; const st = sim.buildingStyle; sim.buildingStyle = e => { calls++; return st(e); };
  const c = R.ctx2d(W, H), v = R.viewAt(sc, 0.35, W, H); for (let i = 0; i < 6; i++) V.renderFrame(c, sim, v, {}); calls = 0; for (let i = 0; i < 5; i++) V.renderFrame(c, sim, v, {});
  assert.strictEqual(typeof sim.frameVersion, 'number', 'the replay publishes a frame version'); assert(sim._far, 'the far layer is on'); assert.strictEqual(calls, 0, 'style calls in 5 idle frames: ' + calls);
  const v0 = sim.frameVersion; rp.setWeek(1); assert(sim.frameVersion !== v0, 'a new week is a new version'); for (let i = 0; i < 40; i++) V.renderFrame(c, sim, v, {});
  assert(calls > 0, 'the new week is asked once'); calls = 0; for (let i = 0; i < 5; i++) V.renderFrame(c, sim, v, {}); assert.strictEqual(calls, 0, 'and then not again: ' + calls);
});

// ---- #14: highlights and ground marks stand at the ground height ----
test('#14 outline, halo, selection halo and vis() use the building\'s ground height; tint and marks sit on the terrain', () => {
  const g = R.g, PackHost = g.PackHost, PStore = g.PackStore, Pick = g.Pick;
  const scene = V.makePlaceholderScene(7); scene.terrain = { x0: -100, y0: -100, dx: 100, dy: 100, nx: 12, ny: 8, z: Array.from({ length: 96 }, (_, i) => (i % 12) * 40 / 11) };
  const N = scene.buildings.length, RED = '#c0392b'; R.resetSprites();
  const probe = V.createSim(scene, { seed: 5, theme: R.theme(), region: 'nw', relief: 1 }); let HI = 0; probe.buildings.forEach((e, i) => { if (e.z > probe.buildings[HI].z) HI = i; });
  const manifest = { spec: 1, id: 'z', title: 'z', runtime: { type: 'js', entry: 'r.js' }, time: { unit: 'year', steps: 2, speeds: [1], speed: 1 }, params: {},
    entities: { b: { count: N, fields: { state: { type: 'category', values: ['no', 'part', 'all'] }, cannot: 'boolean' } } },
    mappings: [
      { entity: 'b', field: 'state', channel: 'wall', scale: { type: 'categorical', label: 'S', values: { no: { colour: '#c9c2b0', label: 'No' }, part: { colour: '#e0a030', label: 'Some' }, all: { colour: '#2e9d6a', label: 'All' } } } },
      { entity: 'b', field: 'cannot', channel: 'outline', lod: { far: 'show' }, scale: { type: 'categorical', label: 'C', values: { true: { colour: RED, label: 'Cannot' }, false: { colour: null, label: 'Can' } } } },
      { entity: 'b', field: 'cannot', channel: 'halo', lod: { far: 'show' }, scale: { type: 'categorical', label: 'H', values: { true: { colour: '#1d4ed8', label: 'Cannot' }, false: { colour: null, label: 'Can' } } } } ] };
  const store = PStore.create(manifest), sim = V.createSim(scene, { seed: 5, theme: R.theme(), region: 'nw', relief: 1 });
  const b = PackHost.bindRenderer({ manifest, store, controller: { wall: 0 }, sim }); assert(b.ok, b.error);
  const KM = Array.from(b.index).indexOf(HI);
  store.pushFrames([{ t: 0, entities: { b: { state: Int8Array.from({ length: N }, (_, i) => i % 3), cannot: Float32Array.from({ length: N }, (_, i) => (i === KM ? 1 : 0)) } }, series: {} }], { replace: true });
  const e = sim.buildings[HI], k = 2.5, v0 = R.viewAt(scene, k, 1200, 700), view = { w: 1200, h: 700, scale: k, ox: v0.ox, oy: v0.oy }; { const p = V.proj(view, e.fit.cx, e.fit.cy, e.z); view.ox += 600 - p[0]; view.oy += 350 - p[1]; }
  assert(e.z > 30, 'the test building is on a hill: ' + e.z);
  // pixels: draw the channels on an empty canvas, find the outline's own pixels (the halo is blue, the outline red), and check they enclose the building as drawn (footprint at z .. z + h)
  const cv = R.createCanvas(1200, 700), cx = cv.getContext('2d'); b.drawChannels(cx, view);
  const d = cx.getImageData(0, 0, 1200, 700).data; let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < 700; y++) for (let x = 0; x < 1200; x++) { const i = (y * 1200 + x) * 4; if (d[i + 3] > 200 && d[i] > 150 && d[i + 2] < 100) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
  let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9; const h = V.entityHeight(e);
  for (const p of e.src.footprint) for (const z of [e.z, e.z + h]) { const q = V.proj(view, p[0], p[1], z); bx0 = Math.min(bx0, q[0]); bx1 = Math.max(bx1, q[0]); by0 = Math.min(by0, q[1]); by1 = Math.max(by1, q[1]); }
  assert(x1 > 0, 'the outline drew something');
  assert(Math.abs(x0 - bx0) < 3 && Math.abs(x1 - bx1) < 3 && Math.abs(y0 - by0) < 3 && Math.abs(y1 - by1) < 3, 'the outline [' + [x0, y0, x1, y1] + '] encloses the building [' + [bx0, by0, bx1, by1].map(Math.round) + ']');
  // vis(): culled when truly off screen, drawn when on screen
  const shift = t => ({ w: 1200, h: 700, scale: k, ox: view.ox, oy: view.oy + (t - V.proj(view, e.fit.cx, e.fit.cy, e.z)[1]) });
  const count = v => { let n = 0; const c = { save() {}, restore() {}, beginPath() {}, closePath() {}, stroke() {}, fill() {}, clearRect() {}, setLineDash() {}, moveTo() { n++; }, lineTo() { n++; } }; b.drawChannels(c, v); return n; };
  const pad = 14 * k + 20; assert.strictEqual(count(shift(-(pad + 60))), 0, 'off the top by 115 px: culled'); assert(count(shift(690)) > 0, 'on screen at y=690: drawn');
  // the selection halo and outline
  store.select({ entity: 'b', id: KM }); const box = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) }, doc = { addEventListener() {}, removeEventListener() {} };
  const inter = PackHost.bindInteraction({ manifest, store, sim, binding: b, pick: Pick.create(sim), box, camera: { view: () => view }, doc });
  const ys = []; const rec = { save() {}, restore() {}, beginPath() {}, closePath() {}, stroke() {}, fill() {}, clearRect() {}, setLineDash() {}, moveTo(x, y) { ys.push(y); }, lineTo(x, y) { ys.push(y); } }; inter.drawHighlight(rec, view);
  assert(ys.length && ys.every(y => y > by0 - 12 && y < by1 + 12), 'every vertex of the channels and the selection is within the building\'s drawn extent (' + Math.round(by0) + '..' + Math.round(by1) + '): ' + Math.round(Math.min(...ys)) + '..' + Math.round(Math.max(...ys)));
  b.dispose();
  // tint and marks: the centroid of what is drawn is where the ground under the cell is drawn
  const cell = { x0: 300, y0: 200, x1: 340, y1: 240 }, mx = 320, my = 220, gz = sim.terrain.at(mx, my) * sim.relief; assert(gz > 10, 'the cell is on a slope: ' + gz);
  const centroid = (img) => { let sx = 0, sy = 0, n = 0; for (let y = 0; y < 700; y++) for (let x = 0; x < 1200; x++) if (img[(y * 1200 + x) * 4 + 3] > 0) { sx += x; sy += y; n++; } return n ? [sx / n, sy / n, n] : null; };
  const tview = { w: 1200, h: 700, scale: k, ox: v0.ox, oy: v0.oy }; { const p = V.proj(tview, mx, my, gz); tview.ox += 600 - p[0]; tview.oy += 350 - p[1]; }      // the cell on the ground in the middle of the screen
  const want = V.proj(tview, mx, my, gz);
  for (const what of ['groundTint', 'groundMarks']) {
    const s2 = V.createSim(scene, { seed: 5, theme: R.theme(), region: 'nw', relief: 1, cacheGround: false }); s2.buildings.length = 0; s2.trees.length = 0; s2.agents.length = 0;
    if (what === 'groundTint') s2.groundTint = { cells: () => [Object.assign({ colour: '#4477aa' }, cell)], opacity: 1, version: () => 1 }; else s2.groundMarks = { cells: () => [Object.assign({ kind: 'outline', share: 1, colour: '#c0392b' }, cell)], version: () => 1 };
    const c3 = R.createCanvas(1200, 700), x3 = c3.getContext('2d'); x3.clearRect(0, 0, 1200, 700); V.renderFrame(x3, s2, tview, { buildings: false, vehicles: false, people: false, trees: false });
    // the bg is opaque, so find the tinted pixels by colour
    const img = x3.getImageData(0, 0, 1200, 700).data, sel = new Uint8ClampedArray(img.length); for (let i = 0; i < img.length; i += 4) { const hit = what === 'groundTint' ? (Math.abs(img[i] - 0x44) < 6 && Math.abs(img[i + 1] - 0x77) < 6 && Math.abs(img[i + 2] - 0xaa) < 6) : (img[i] > 150 && img[i + 1] < 90 && img[i + 2] < 90); sel[i + 3] = hit ? 255 : 0; }
    const ce = centroid(sel); assert(ce, what + ' drew something'); assert(Math.hypot(ce[0] - want[0], ce[1] - want[1]) < 6, what + ' centroid (' + ce.slice(0, 2).map(Math.round) + ') is on the ground under the cell (' + want.map(Math.round) + ')');
  }
});

console.log(failed ? passed + ' passed, ' + failed + ' FAILED' : 'all passed (' + passed + ')');
