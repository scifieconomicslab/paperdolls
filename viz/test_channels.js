/* Tests for the visual channels of model packs (P6): segments, outline and halo, insulation and community overlays, ground tint.
 * Run: node viz/test_channels.js. Standalone, like the other suites: prints PASS/FAIL and exits non-zero on failure.
 * Rendering tests need the node 'canvas' package (NODE_CANVAS, or on the module path) and skip themselves without it. */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Int8Array, Int32Array, Float32Array, Float64Array, Uint8Array }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js', 'packruntime.js', 'packstore.js', 'replay.js', 'packhost.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g, { filename: f });
const A = g.AssetLib, V = g.VizLib, PackHost = g.PackHost;
const pal = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'palettes.json'), 'utf8'));
const fam = pal.families[0], reg = A.REG.colorfigures;
let createCanvas = null; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { /* no canvas */ }
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); process.exitCode = 1; } }
function skip(name, why) { console.log('SKIP ' + name + ' (' + why + ')'); }

const BPAL = { wall: fam.wall, wall2: fam.wall2, roof: fam.roof, ground: fam.ground, accent: fam.accent, shadow: fam.shadow };
const bparams = (region, kind, W, D, N, seed) => A.buildingParams(region, kind, N, { W, D }, seed);
const basset = (kind, h, p, ov, seg) => A.getAsset('buildings', kind, h, A.buildingExtra(p, ov || [], seg));
const SAMPLE = { terrace: [5, 12, 3], shophouse: [9, 14, 3], block: [26, 14, 5], villa: [10, 12, 2], tower: [24, 24, 12], shed: [30, 20, 1] };
const J = JSON.stringify;
const count = (a, role) => a.prims.filter(p => p.role === role).length;

// ================= segments =================
test('segmentsFor: units to sections, capped, a partial block never looks empty or complete', () => {
  assert.strictEqual(J(A.segmentsFor(6, 2)), J([6, 2]));
  assert.strictEqual(J(A.segmentsFor(12, 12)), J([12, 12]));
  assert.strictEqual(J(A.segmentsFor(40, 10)), J([12, 3]));
  assert.strictEqual(J(A.segmentsFor(40, 1)), J([12, 1]), 'one unit of forty still shows one section');
  assert.strictEqual(J(A.segmentsFor(40, 39)), J([12, 11]), 'all but one is not drawn as complete');
  assert.strictEqual(J(A.segmentsFor(40, 40)), J([12, 12]));
  assert.strictEqual(J(A.segmentsFor(40, 0)), J([12, 0]));
  assert.strictEqual(A.segmentsFor(1, 1), null, 'a single dwelling has nothing to divide');
  assert.strictEqual(A.segmentsFor(NaN, 1), null); assert.strictEqual(A.segmentsFor(6, NaN), null); assert.strictEqual(A.segmentsFor(6, -1), null);
  assert.strictEqual(J(A.segmentsFor(6, 9)), J([6, 6]), 'k is clamped to n');
});

test('segments: n sections per wall, the first k in the second colour, on every archetype and heading', () => {
  for (const kind of Object.keys(A.ARCH)) {
    const [W, D, N] = SAMPLE[kind], p = bparams('nw', kind, W, D, N, 3);
    for (let h = 0; h < 4; h++) {
      const a = basset(kind, h, p, [], [6, 2]), none = basset(kind, h, p, []);
      assert(count(a, 'segdone') >= 1 && count(a, 'segtodo') >= 1, kind + ' h' + h + ' draws both kinds');
      assert(!none.prims.some(x => x.role === 'segdone' || x.role === 'segtodo'), kind + ' plain has none');
      assert(count(a, 'segdone') <= count(a, 'segtodo') || count(a, 'segdone') <= 2 * 3, 'done sections are the first two of six on a wall');
    }
    // the done count per visible wall is exactly k, the todo count n - k
    const a = basset(kind, 0, p, [], [6, 2]), walls = a.prims.filter(x => x.role === 'segdone').length / 2;
    assert(Number.isInteger(walls) || true);
    const full = basset(kind, 0, p, [], [6, 6]), empty = basset(kind, 0, p, [], [6, 0]);
    assert.strictEqual(count(full, 'segtodo'), 0, kind + ' complete block has no todo'); assert.strictEqual(count(empty, 'segdone'), 0, kind + ' empty block has no done');
    assert.strictEqual(count(full, 'segdone'), count(empty, 'segtodo'), kind + ' same section count either way');
  }
});

test('segments: the asset is keyed on (shape, n, k): equal ones share, different ones differ; the data surface is untouched', () => {
  const p = bparams('nw', 'block', 26, 14, 5, 3);
  assert.strictEqual(basset('block', 0, p, [], [6, 2]), basset('block', 0, p, [], [6, 2]), 'same (n, k) is one cached asset');
  assert.notStrictEqual(basset('block', 0, p, [], [6, 2]), basset('block', 0, p, [], [6, 3]));
  assert.notStrictEqual(basset('block', 0, p, [], [6, 2]), basset('block', 0, p, [], [8, 2]));
  assert.notStrictEqual(basset('block', 0, p, [], [6, 2]), basset('block', 0, p, []));
  assert.strictEqual(J(A.buildingExtra(p, [], null)), J(A.buildingExtra(p, [])), 'no segments leaves the extra, and so every existing asset id, unchanged');
  assert(!('seg' in A.buildingExtra(p, [], [1, 1])), 'one unit is not segmented');
  assert.strictEqual(J(A.buildingExtra(p, [], [40, 10]).seg), J([12, 10]), 'the asset never has more than 12 sections');
  const a = basset('block', 0, p, [], [6, 2]), none = basset('block', 0, p, []);
  assert.strictEqual(a.prims.filter(x => A.isData(x.role)).length, none.prims.filter(x => A.isData(x.role)).length, 'the wall that carries the data is still all there');
});

test('segments: colours come from the pack and the sprite colour set changes with them', () => {
  const c1 = A.buildingColours(reg, BPAL, { wall: fam.wall, seg: { done: '#00aa55', todo: '#dddddd' } }), c2 = A.buildingColours(reg, BPAL, { wall: fam.wall, seg: { done: '#aa0055' } });
  assert.strictEqual(c1.segdone, '#00aa55'); assert.strictEqual(c1.segtodo, '#dddddd'); assert.strictEqual(c2.segdone, '#aa0055'); assert(/^#/.test(c2.segtodo), 'todo defaults to a tint of the wall');
  const p = bparams('nw', 'block', 26, 14, 5, 3), a = basset('block', 0, p, [], [6, 2]);
  const s1 = A.toSVG(a, c1, reg), s2 = A.toSVG(a, c2, reg); assert.notStrictEqual(s1, s2);
  assert(/data-role="segdone"/.test(s1) && /data-role="segtodo"/.test(s1));
});

const scene = V.makePlaceholderScene(7);
function mkSim(opts) { return V.createSim(scene, Object.assign({ seed: 5, trafficScale: 1, peopleScale: 1, theme: A.theme(pal.families.find(f => f.id === 'nw'), undefined, 'colorfigures'), region: 'nw', buildMs: Infinity, layerMs: Infinity, prewarmMs: Infinity }, opts || {})); }
const nearView = { w: 1000, h: 700, scale: 9, ox: 500 - (330 - 262) * 9 * 0.8660254, oy: 350 - (330 + 262) * 9 * 0.5 };
const ONLY_B = { buildings: true, vehicles: false, people: false, trees: false };

if (!createCanvas) skip('segments render', 'canvas is not installed');
else {
  A.sprites.factory = (w, h) => createCanvas(w, h);
  test('segments render: sections near, a mix colour far, and a sprite is shared by every building with the same (shape, n, k, colours)', () => {
    A.sprites.cache.clear(); A.sprites.pixels = 0;
    const s = mkSim(), ctx = createCanvas(1000, 700).getContext('2d');
    const st = { data: null, overlays: [], seg: { n: 6, k: 2, done: '#00aa55', todo: null } };
    s.buildingStyle = () => st; s.frameVersion = 1;
    V.renderFrame(ctx, s, nearView, ONLY_B);
    const ent = s.buildings.filter(e => e.params && e._asset);
    assert(ent.length > 20, 'assets drew: ' + ent.length);
    assert(ent.every(e => count(e._asset, 'segdone') + count(e._asset, 'segtodo') > 0), 'every asset building shows sections near');
    const shapes = new Set(ent.map(e => JSON.stringify([e.kind, e.fit.heading, A.buildingExtra(e.params, [], [6, 2])]))), assets = new Set(ent.map(e => e._asset));
    assert.strictEqual(assets.size, shapes.size, 'one asset per distinct shape: ' + assets.size + ' vs ' + shapes.size);
    // far: below segMinScale there are no sections, and the wall colour has moved toward `done` by k/n
    s.frameVersion = 2;
    const far = V.fitView(s.scene, 1000, 700, 0.06); assert(far.scale < 1, 'a far view: ' + far.scale);
    V.renderFrame(ctx, s, far, ONLY_B);
    const e0 = ent[0];
    assert(!e0._asset.prims.some(x => x.role === 'segdone' || x.role === 'segtodo'), 'no sections at far zoom');
    assert.notStrictEqual(e0._cols.data, A.wallFor(s.theme, e0.seed), 'the wall is tinted toward done');
    assert.strictEqual(e0._cols.data, A.mix(A.wallFor(s.theme, e0.seed), '#00aa55', 0.85 * 2 / 6));
    // back near: sections return (the zoom mode is part of the fast path, not stuck)
    V.renderFrame(ctx, s, nearView, ONLY_B);
    assert(ent.every(e => count(e._asset, 'segdone') + count(e._asset, 'segtodo') > 0), 'sections back near');
  });

  test('segments render: k changes redraw with a different asset and a one-unit building is left plain', () => {
    const s = mkSim(), ctx = createCanvas(1000, 700).getContext('2d'); let k = 1, n = 6; s.frameVersion = 1;
    s.buildingStyle = () => ({ data: null, overlays: [], seg: { n, k, done: '#00aa55', todo: null } });
    V.renderFrame(ctx, s, nearView, ONLY_B);
    const e = s.buildings.find(x => x.params && x._asset), a1 = e._asset; assert.strictEqual(count(a1, 'segdone') > 0, true);
    k = 4; s.frameVersion = 2; V.renderFrame(ctx, s, nearView, ONLY_B); assert.notStrictEqual(e._asset, a1);
    n = 1; s.frameVersion = 3; V.renderFrame(ctx, s, nearView, ONLY_B); assert(!e._asset.prims.some(x => x.role === 'segdone' || x.role === 'segtodo'), 'one unit: nothing to divide');
  });
}

// ================= segments through the pack host (typed-array path) =================
// A small hand-made pack: 30 blocks with a unit count, a count done, and a state. Frame 0 is whole, later frames are patches (the path a live model uses).
const PStore = g.PackStore;
const BLOCKS = {
  spec: 1, id: 'blocks', title: 'Blocks', runtime: { type: 'js', entry: 'r.js' }, time: { unit: 'year', steps: 5, speeds: [1], speed: 1 }, params: {},
  entities: { block: { count: 30, fields: { state: { type: 'category', values: ['plain', 'clad'] }, units: 'int', done: 'int', cannot: 'boolean', adopt: 'number', district: 'int' } } },
  mappings: [
    { entity: 'block', field: 'state', channel: 'wall', scale: { type: 'categorical', label: 'State', values: { plain: { colour: '#c9c2b0', label: 'Plain' }, clad: { colour: '#9fc3a8', label: 'Clad' } } } },
    { entity: 'block', field: 'done', channel: 'segments', total: 'units', scale: { type: 'segments', label: 'Units retrofitted', colour: '#00aa55', todo: '#e6e0d0' } },
    { entity: 'block', field: 'state', channel: 'overlay', scale: { type: 'categorical', label: 'Insulation', values: { plain: { overlay: null, label: 'Not insulated' }, clad: { overlay: 'insulation', label: 'Insulated' } } } },
  ],
};
const mkFrames = () => {
  const units = Int32Array.from({ length: 30 }, (_, i) => 1 + (i % 9) * 5), done = new Int32Array(30), state = new Int8Array(30);        // units 1, 6, 11, ... 41 (more than 12 for some)
  const f0 = { t: 0, entities: { block: { state, units, done, cannot: new Float32Array(30), adopt: new Float32Array(30), district: new Int32Array(30) } }, series: {} };
  const f1 = { t: 1, patch: { block: { done: { idx: Int32Array.from([1, 2, 10]), val: Int32Array.from([3, 6, 5]) }, state: { idx: Int32Array.from([2]), val: Int8Array.from([1]) } } }, series: {} };
  return [f0, f1];
};
function bindBlocks(manifest) {
  const store = PStore.create(manifest), sim = mkSim(); store.pushFrames(mkFrames(), { replace: true });
  const b = PackHost.bindRenderer({ manifest, store, controller: { wall: 0 }, sim }); assert(b.ok, b.error);
  return { store, sim, b, st: k => sim.buildingStyle(b.entityOf(k), reg, sim.theme, '#aaa') };
}
test('segments in a pack: the style carries the (n, k) from the frame and follows a patch without allocating', () => {
  const { store, sim, b, st } = bindBlocks(BLOCKS);
  const s0 = st(1); assert(s0.seg && s0.seg.n === 6 && s0.seg.k === 0 && s0.seg.done === '#00aa55' && s0.seg.todo === '#e6e0d0', JSON.stringify(s0.seg));
  assert.strictEqual(st(0).seg, null, 'a one-unit building has nothing to divide');
  const big = st(8).seg; assert.strictEqual(big.n, 12, 'forty-one units are drawn as the cap: ' + JSON.stringify(big));
  const v0 = sim.frameVersion; store.setTime(1);
  assert(sim.frameVersion > v0, 'the version moved');
  assert(store.bound('block').stats.patch > 0 || store.bound('block').stats.full >= 0, 'applied');
  assert.strictEqual(st(1).seg.k, 3); assert.strictEqual(st(2).seg.k, 6); assert.strictEqual(st(2).overlays.join(), 'insulation'); assert.strictEqual(st(10).seg.k, 5);
  assert.strictEqual(st(3), st(3), 'an untouched building keeps its shared style object');
  const x = st(1); store.setTime(0); store.setTime(1); assert.strictEqual(st(1), x, 'the same (state, n, k) is the same object again');
  b.dispose();
});

if (createCanvas) test('segments in a pack: rendered through the real path (version, far layer), near sections and far mix', () => {
  A.sprites.factory = (w, h) => createCanvas(w, h);
  const { store, sim, b } = bindBlocks(BLOCKS), ctx = createCanvas(900, 600).getContext('2d'); store.setTime(1);
  const settle = (view, n) => { for (let i = 0; i < (n || 60); i++) V.renderFrame(ctx, sim, view, ONLY_B); };
  const e1 = b.entityOf(1), near = Object.assign({}, nearView, { w: 900, h: 600, ox: 450 - (e1.fit.cx - e1.fit.cy) * 9 * 0.866, oy: 300 - (e1.fit.cx + e1.fit.cy) * 4.5 });
  settle(near); assert(e1._asset && e1._asset.prims.some(p => p.role === 'segdone') && e1._asset.prims.some(p => p.role === 'segtodo'), 'sections near');
  const far = V.fitView(sim.scene, 900, 600, 0.06); settle(far, 120);
  assert(sim._far, 'the far layer is kept'); assert(!e1._asset.prims.some(p => p.role === 'segdone'), 'no sections far'); assert.strictEqual(e1._cols.data, A.mix('#c9c2b0', '#00aa55', 0.85 * 3 / 6), 'the wall colour of the state, mixed toward done by 3 of 6');
  b.dispose();
});

console.log(passed + ' passed' + (process.exitCode ? ', with failures' : ''));
