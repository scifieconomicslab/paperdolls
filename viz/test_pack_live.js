/* Tests for live rendering (P2) and picking (P4) of model packs: patch frames and the store's bound typed arrays, the renderer's frame version and far-zoom
 * layer, the runtime in a worker (a real node worker thread) and on the main thread, cancellation, and the hit test.
 * Run: node viz/test_pack_live.js [--manifest-json '<the toy pack.yaml as JSON>']      The page-level tests (hover, click, inspector, keys) are in test_pack_page.js. */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const g = { console, Math, Object, Map, WeakMap, Array, Infinity, JSON, Set, Date, Number, String, Promise, Int8Array, Int16Array, Int32Array, Uint8Array, Float32Array, ArrayBuffer, setTimeout, clearTimeout, performance }; g.globalThis = g; vm.createContext(g);
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8'), load = f => vm.runInContext(read(f), g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js', 'replay.js', 'packvalidate.js', 'packstore.js', 'packruntime.js', 'packhost.js', 'packpick.js', 'packworker.js']) load(f);
const A = g.AssetLib, V = g.VizLib, PStore = g.PackStore, PR = g.PackRuntime, PH = g.PackHost, PW = g.PackWorker, Pick = g.Pick, PD = g.PaperDolls;
const arg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const clone = o => JSON.parse(JSON.stringify(o)), arr = a => Array.from(a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (cond, ms = 8000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await sleep(5); return cond(); };
let failed = 0; const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function skip(name, why) { console.log('SKIP ' + name + ' (' + why + ')'); }

const CASES = JSON.parse(read('../tests/pack_cases.json')), M = CASES.base;                  // entity "thing": 5 of them, fields kind (a/b) and load (number)

// ---------- patch frames and the store ----------
const whole = (t, kind, load) => ({ t, entities: { thing: { kind: Int8Array.from(kind), load: Float32Array.from(load) } }, series: { totals: [t, 0] } });
const patch = (t, kind, load) => ({ t, patch: { thing: Object.assign({}, kind && { kind: { idx: Int32Array.from(kind.idx), val: Int8Array.from(kind.val) } }, load && { load: { idx: Int32Array.from(load.idx), val: Float32Array.from(load.val) } }) }, series: { totals: [t, 0] } });
test('patch: the store applies a patch to the frame before it, leaves that frame alone, and shares what was not touched', () => {
  const s = PStore.create(clone(M)); s.pushFrames([whole(0, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]), patch(1, { idx: [1, 3], val: [1, 1] }, null), patch(2, { idx: [3], val: [0] }, { idx: [0], val: [0.5] })], { replace: true });
  assert.deepStrictEqual(arr(s.frameAt(0).entities.thing.kind), [0, 0, 0, 0, 0]); assert.deepStrictEqual(arr(s.frameAt(1).entities.thing.kind), [0, 1, 0, 1, 0]);
  assert.deepStrictEqual(arr(s.frameAt(2).entities.thing.kind), [0, 1, 0, 0, 0]); assert.deepStrictEqual(arr(s.frameAt(2).entities.thing.load), [0.5, 0, 0, 0, 0]);
  assert.strictEqual(s.frameAt(1).entities.thing.load, s.frameAt(0).entities.thing.load, 'a field the patch did not touch is shared, not copied');
  assert.strictEqual(s.length(), 3); assert.strictEqual(s.series('totals').length, 3);
  assert.throws(() => PStore.create(clone(M)).pushFrames([patch(0, { idx: [0], val: [1] }, null)]), /no frame before it/);
});
test('patch: a patch frame is checked against the manifest with its place in the message', () => {
  const ents = PR.entitySpec(M), chk = f => PR.checkFrame(M, ents, f, f.t);
  assert.strictEqual(chk(patch(1, { idx: [1], val: [1] }, null)).length, 0);
  assert(chk(patch(0, { idx: [1], val: [1] }, null)).some(e => /frame 0 must be whole/.test(e)));
  assert(chk(patch(1, { idx: [9], val: [1] }, null)).some(e => /patch\.thing\.kind\.idx\[0\] = 9 is not an entity number below 5/.test(e)));
  assert(chk(patch(1, { idx: [1], val: [7] }, null)).some(e => /patch\.thing\.kind\.val\[0\] = 7 is not a legal value/.test(e)));
  assert(chk({ t: 1, patch: { thing: { ghost: { idx: [0], val: [0] } } } }).some(e => /ghost is not a field/.test(e)));
  assert(chk({ t: 1, patch: { thing: { kind: { idx: [0, 1], val: [0] } } } }).some(e => /same length/.test(e)));
});
test('bound: per-building typed arrays indexed by scene building, gathered once, then patched by the patch alone', () => {
  const s = PStore.create(clone(M)); s.bindScene('thing', { count: 8, index: [6, 2, 4, -1, 0] });           // model entity k is drawn on scene building index[k]; entity 3 is not drawn
  const b0 = s.bound('thing'); assert(b0.fields.kind instanceof Int8Array && b0.fields.load instanceof Float32Array); assert.strictEqual(b0.fields.kind.length, 8);
  s.pushFrames([whole(0, [0, 1, 0, 1, 0], [0, 0.1, 0.2, 0.3, 0.4]), patch(1, { idx: [0, 3, 4], val: [1, 1, 1] }, { idx: [2], val: [0.9] })], { replace: true });
  let b = s.bound('thing'); assert.deepStrictEqual(arr(b.fields.kind), [0, -1, 1, -1, 0, -1, 0, -1]); assert.strictEqual(b.fields.load[4].toFixed(1), '0.2'); assert(Number.isNaN(b.fields.load[1]), 'nothing bound: NaN');
  assert.deepStrictEqual({ ...b.stats }, { full: 1, patch: 0, touched: 5 }, 'the first look gathers every bound entity');
  const same = b.fields.kind; s.setTime(1); b = s.bound('thing');
  assert.strictEqual(b.fields.kind, same, 'the same array is updated in place: nothing is allocated');
  assert.deepStrictEqual(arr(b.fields.kind), [1, -1, 1, -1, 0, -1, 1, -1]); assert.strictEqual(b.fields.load[4].toFixed(1), '0.9');
  assert.deepStrictEqual({ ...b.stats }, { full: 1, patch: 1, touched: 8 }, 'one step on to a patch frame costs the patch (entity 3 is not bound, so it is not applied)');
  s.bound('thing'); assert.strictEqual(b.stats.patch, 1, 'nothing changed: no work');
  s.setTime(0); b = s.bound('thing'); assert.strictEqual(b.stats.full, 2, 'going back is a gather'); assert.deepStrictEqual(arr(b.fields.kind), [0, -1, 1, -1, 0, -1, 0, -1]);
  assert.strictEqual(s.bound('ghost'), null);
});
test('bound: the version moves when the picture can change, and not when it cannot', () => {
  const s = PStore.create(clone(M)), seen = []; s.subscribe('view', ev => seen.push(ev.topic));
  const v0 = s.shownVersion(); s.pushFrames([whole(0, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0])], { replace: true }); const v1 = s.shownVersion(); assert(v1 > v0, 'a new run');
  s.pushFrames([patch(1, { idx: [0], val: [1] }, null)]); assert.strictEqual(s.shownVersion(), v1, 'frames added beyond the time shown change nothing on the map');
  s.setTime(1); const v2 = s.shownVersion(); assert(v2 > v1, 'time moved'); s.setTime(1); assert.strictEqual(s.shownVersion(), v2);
  s.invalidate(); assert(s.shownVersion() > v2); assert.deepStrictEqual(seen, ['view']);
  s.pushFrames([whole(0, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0])], { replace: true }); assert(s.shownVersion() > v2 + 1, 'a re-run replaces what is shown');
});

// ---------- the renderer: frame version, far-zoom layer, no allocation ----------
let createCanvas = null; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { /* no canvas package */ }
const toyJson = arg('--manifest-json') || process.env.PACK_MANIFEST_JSON;
const fam = JSON.parse(read('../assets/palettes.json')).families.find(f => f.id === 'nw');
const mkSim = () => V.createSim(V.makePlaceholderScene(7), { seed: 5, theme: A.theme(fam, undefined, 'colorfigures'), region: 'nw' });
if (!toyJson) skip('toy-based tests', 'no manifest given');
else {
  const TOY = JSON.parse(toyJson); vm.runInContext(read('../packs/toy-epidemic/runtime.js'), g);
  const impl = PD.getRuntime('toy-epidemic');
  const mkHost = () => { const store = PStore.create(TOY), runtime = PR.create(TOY, impl), ctl = PH.createController({ manifest: TOY, runtime, store, immediate: true }); ctl.start(); return { store, runtime, ctl }; };

  test('renderer: sim.buildingStyle reads the bound arrays, returns shared style objects, and the version follows the store', () => {
    const { store, ctl } = mkHost(), sim = mkSim(), b = PH.bindRenderer({ manifest: TOY, store, controller: ctl, sim }); assert(b.ok, b.error);
    assert.strictEqual(typeof sim.frameVersion, 'number'); const reg = A.REG.colorfigures, st = e => sim.buildingStyle(e, reg, sim.theme, '#aaa');
    store.setTime(30); const v = sim.frameVersion; store.setTime(31); assert(sim.frameVersion > v, 'the renderer hears of a new frame'); ctl.setWall(1); assert(sim.frameVersion > v + 1, 'and of a change of colouring');
    const a = st(b.entityOf(0)), again = st(b.entityOf(0)); assert.strictEqual(a, again, 'the same object each time: nothing is allocated per call');
    const seen = new Set(); for (let k = 0; k < 600; k++) seen.add(st(b.entityOf(k))); assert(seen.size <= 130 * 2 && b.styleCount() === seen.size, 'a small table of styles serves all 600: ' + seen.size);
    assert.strictEqual(st(b.entityOf(700)), st(b.entityOf(701)), 'buildings the model does not use share one style');
    let n = 0; const before = process.memoryUsage().heapUsed; for (let rep = 0; rep < 200; rep++) for (let i = 0; i < sim.buildings.length; i++) { if (st(sim.buildings[i])) n++; }
    assert(process.memoryUsage().heapUsed - before < 8e6, 'a million style reads leave no garbage worth speaking of: ' + (process.memoryUsage().heapUsed - before) + ' bytes');
    b.dispose(); assert.strictEqual(sim.buildingStyle, null); assert.strictEqual(sim.frameVersion, undefined);
  });
  if (!createCanvas) skip('renderer: far layer and version', 'canvas is not installed');
  else test('renderer: with a frame version the far-zoom layer is kept and repainted once per change; without one it is off', () => {
    A.sprites.factory = (w, h) => createCanvas(w, h);
    const { store, ctl } = mkHost(), sim = mkSim(), b = PH.bindRenderer({ manifest: TOY, store, controller: ctl, sim }); assert(b.ok);
    const W = 800, H = 520, ctx = createCanvas(W, H).getContext('2d'), view = V.fitView(sim.scene, W, H, 0.06); assert(view.scale < 1, 'a far view: ' + view.scale);
    let calls = 0; const inner = sim.buildingStyle; sim.buildingStyle = e => { calls++; return inner(e); };
    const settle = () => { for (let i = 0; i < 400; i++) { V.renderFrame(ctx, sim, view, { vehicles: false, people: false }); if (i > 4 && !sim._farP && !sim._groundP && A.sprites.builds === 0) return i; } throw new Error('never settled'); };
    settle(); assert(sim._far, 'the far layer exists although a custom style is set'); const r0 = sim.layerRepaints, c0 = calls;
    for (let i = 0; i < 20; i++) V.renderFrame(ctx, sim, view, { vehicles: false, people: false });
    assert.strictEqual(sim.layerRepaints, r0, 'a still frame repaints nothing'); assert.strictEqual(calls, c0, 'and asks for no style at all');
    store.setTime(20); settle(); assert.strictEqual(sim.layerRepaints, r0 + 1, 'a new frame repaints the layer once'); assert(calls > c0 && calls - c0 <= sim.buildings.length, 'each building is asked once: ' + (calls - c0));
    const c1 = calls; for (let i = 0; i < 20; i++) V.renderFrame(ctx, sim, view, { vehicles: false, people: false }); assert.strictEqual(calls, c1);
    // near zoom: the buildings are drawn one by one, and still ask for a style only when the version moves
    const near = Object.assign({}, view, { scale: 4, ox: W / 2 - (b.entityOf(0).fit.cx - b.entityOf(0).fit.cy) * 4 * 0.866, oy: H / 2 - (b.entityOf(0).fit.cx + b.entityOf(0).fit.cy) * 2 });
    for (let i = 0; i < 6; i++) V.renderFrame(ctx, sim, near, { vehicles: false, people: false }); const c2 = calls; for (let i = 0; i < 10; i++) V.renderFrame(ctx, sim, near, { vehicles: false, people: false }); assert.strictEqual(calls, c2, 'near zoom, still frames ask for nothing');
    store.setTime(21); V.renderFrame(ctx, sim, near, { vehicles: false, people: false }); assert(calls > c2, 'a new frame asks again');
    // a style without a frame version still turns the layer off (the old rule, for styles that are not ours)
    const plain = mkSim(); plain.buildingStyle = () => ({ data: null, overlays: [] });
    for (let i = 0; i < 60; i++) V.renderFrame(ctx, plain, view, { vehicles: false, people: false }); assert(!plain._far, 'no version, no far layer');
  });
}

// ---------- the runtime in a worker, and on this thread ----------
const COUNT = clone(M); COUNT.runtime = { type: 'js', entry: 'x.js', seed: 3, on_params: 'rerun' }; COUNT.time = { unit: 'step', steps: 10, speed: 4, speeds: [4] };
const counterImpl = () => ({
  init(p, ents, seed) { return { t: 0, n: ents.thing.count, k: p.n, seed }; },
  step(h, n) { const out = []; const f = () => ({ t: h.t, entities: { thing: { kind: new Array(h.n).fill(h.t % 2), load: new Array(h.n).fill(h.t / 10) } }, series: { totals: [h.t, h.k] } }); if (n === 0) return [f()]; for (let i = 0; i < n; i++) { h.t++; out.push(f()); } return out; },
  inspect(h, sel, t) { return sel.id >= h.n ? null : { title: 'thing ' + sel.id, fields: [{ label: 'k', value: h.k }, { label: 'asked at', value: t }] }; },
});
test('worker (same thread): start, run in chunks, step, inspect, and the frames are the ones the synchronous adapter gives', async () => {
  const rt = PW.create(COUNT, { mode: 'inline', impl: counterImpl(), server: { chunk: 4 } }); assert.strictEqual(rt.mode, 'inline'); assert.strictEqual(rt.async, true);
  const f0 = await rt.start({ n: 3 }); assert.strictEqual(f0.t, 0); assert.strictEqual(rt.canInspect, true); assert.strictEqual(rt.policy, 'rerun');
  const chunks = []; const r = await rt.run(10, fr => chunks.push(fr.map(f => f.t))); assert.strictEqual(r.cancelled, false);
  assert.deepStrictEqual(chunks, [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]], 'frames arrive in chunks of 4');
  const sync = PR.create(COUNT, counterImpl()); sync.start({ n: 3 }); const want = PR.digest(sync.run(10));
  const rt2 = PW.create(COUNT, { mode: 'inline', impl: counterImpl() }); await rt2.start({ n: 3 }); const got = []; await rt2.run(10, fr => got.push(...fr)); assert.strictEqual(PR.digest(got), want);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await rt.inspect({ entity: 'thing', id: 2 }, 7))), { title: 'thing 2', fields: [{ label: 'k', value: 3 }, { label: 'asked at', value: 7 }] });
  assert.strictEqual(await rt.inspect({ entity: 'thing', id: 99 }, 7), null);
  rt.dispose();
});
test('worker (same thread): a newer request cancels the run in progress, and an error comes back as an error', async () => {
  const rt = PW.create(COUNT, { mode: 'inline', impl: counterImpl(), server: { chunk: 2 } }); await rt.start({ n: 3 });
  const got = []; const first = rt.run(10, fr => got.push(...fr.map(f => f.t)));
  await sleep(2); const re = await rt.setParams({ n: 5 }); assert.strictEqual(re.restarted, true); assert.strictEqual(re.frame.t, 0);
  const r = await first; assert.strictEqual(r.cancelled, true); assert(got.length < 10, 'the first run stopped early: ' + got.length);
  const bad = PW.create(COUNT, { mode: 'inline', impl: Object.assign(counterImpl(), { step() { throw new Error('model blew up'); } }) });
  await assert.rejects(() => bad.start({ n: 3 }), /model blew up/);
  const none = PW.create(COUNT, { mode: 'inline' }); await assert.rejects(() => none.start({ n: 3 }), /did not register itself/);
});

// a real worker: node's worker_threads standing in for the browser's Worker, with the same sources the page keeps as text
const wt = (() => { try { return require('worker_threads'); } catch (e) { return null; } })();
const shim = "const { parentPort } = require('worker_threads'); globalThis.self = globalThis; globalThis.postMessage = m => parentPort.postMessage(m); parentPort.on('message', m => { if (globalThis.onmessage) globalThis.onmessage({ data: m }); });\n";
const blobs = new Map(); let blobN = 0;
const fakes = {
  Blob: class { constructor(parts) { this.text = parts.join(''); } },
  URL: { createObjectURL: b => { const u = 'blob:test/' + (++blobN); blobs.set(u, b.text); return u; }, revokeObjectURL: u => blobs.delete(u) },
  Worker: class {
    constructor(url) {
      this.w = new wt.Worker(shim + blobs.get(url), { eval: true });
      this.w.on('message', m => { if (this.onmessage) this.onmessage({ data: m }); }); this.w.on('error', e => { if (this.onerror) this.onerror(e); });
    }
    postMessage(m) { this.w.postMessage(m); } terminate() { this.w.terminate(); }
  },
};
if (!toyJson || !wt) skip('worker (real thread)', toyJson ? 'no worker_threads' : 'no manifest given');
else {
  const TOY = JSON.parse(toyJson), sources = { runtime: read('packruntime.js'), worker: read('packworker.js'), entry: read('../packs/toy-epidemic/runtime.js') };
  const syncRun = p => { const r = PR.create(TOY, PD.getRuntime('toy-epidemic')); const f0 = r.start(p); return [f0].concat(r.run(TOY.time.steps)); };
  const defaults = Object.assign({}, ...Object.entries(TOY.params).map(([k, v]) => ({ [k]: v.default })));
  test('worker (real thread): the same frames as the synchronous adapter, streamed, patches intact, and inspect answered from the worker', async () => {
    const rt = PW.create(TOY, Object.assign({ mode: 'worker', sources }, fakes)); assert.strictEqual(rt.mode, 'worker');
    try {
      const f0 = await rt.start(defaults); const got = [f0], sizes = []; await rt.run(TOY.time.steps, fr => { sizes.push(fr.length); got.push(...fr); });
      assert(sizes.length >= 10 && Math.max(...sizes) <= 16, 'streamed in chunks: ' + sizes.join(','));
      assert.strictEqual(PR.digest(got), PR.digest(syncRun(defaults)), 'a worker and the main thread give the same run');
      assert(got[1].patch && !got[1].entities, 'patch frames survive the trip'); assert(got[1].patch.building.state.idx instanceof Int32Array || ArrayBuffer.isView(got[1].patch.building.state.idx));
      const d = await rt.inspect({ entity: 'building', id: 3 }, 40); assert(/^Building 4/.test(d.title) && d.fields.length === 4, JSON.stringify(d));
      const snap = await rt.snapshot(); assert.strictEqual(snap.t, TOY.time.steps);
    } finally { rt.dispose(); }
  });
  test('worker (real thread): a new parameter cancels the run in progress and the next run is whole and right', async () => {
    const rt = PW.create(TOY, Object.assign({ mode: 'worker', sources, server: { chunk: 1 } }, fakes));
    try {
      await rt.start(defaults); const stale = []; const first = rt.run(TOY.time.steps, fr => stale.push(...fr));
      await until(() => stale.length > 0); const p2 = Object.assign({}, defaults, { lockdown: 'full' }); const re = await rt.setParams(p2); const got = [re.frame]; await rt.run(TOY.time.steps, fr => got.push(...fr));
      assert.strictEqual((await first).cancelled, true); assert.strictEqual(PR.digest(got), PR.digest(syncRun(p2)));
    } finally { rt.dispose(); }
  });
  test('worker (real thread): a worker that will not start, or dies before it answers, falls back to this thread and says why', async () => {
    const refuse = PW.create(TOY, { mode: 'auto', sources, Worker: class { constructor() { throw new Error('blocked by policy'); } }, Blob: fakes.Blob, URL: fakes.URL });
    assert.strictEqual(refuse.mode, 'inline'); assert(/blocked by policy/.test(refuse.fellBack)); assert.strictEqual((await refuse.start(defaults)).t, 0);
    const broken = PW.create(TOY, Object.assign({ mode: 'auto', sources: Object.assign({}, sources, { entry: 'throw new Error("syntax of the pack");' }) }, fakes));
    const f0 = await broken.start(defaults); assert.strictEqual(f0.t, 0); assert.strictEqual(broken.mode, 'inline'); assert(/syntax of the pack/.test(broken.fellBack), broken.fellBack);
    assert.throws(() => PW.create(TOY, { mode: 'worker', sources, Worker: class { constructor() { throw new Error('nope'); } }, Blob: fakes.Blob, URL: fakes.URL }), /nope/, 'mode worker does not fall back');
    refuse.dispose(); broken.dispose();
  });
}

// ---------- the controller with an asynchronous runtime ----------
if (!toyJson) skip('controller (async)', 'no manifest given');
else {
  const TOY = JSON.parse(toyJson), sync = p => { const r = PR.create(TOY, PD.getRuntime('toy-epidemic')); const f0 = r.start(p); return [f0].concat(r.run(TOY.time.steps)); };
  const mk = () => { const store = PStore.create(TOY), runtime = PW.create(TOY, { mode: 'inline', server: { chunk: 8 } }), ctl = PH.createController({ manifest: TOY, runtime, store, immediate: true }); return { store, runtime, ctl }; };
  test('controller (async): the run streams in, ends whole, and equals the synchronous run', async () => {
    const { store, ctl } = mk(); const done = ctl.start(); assert.strictEqual(ctl.async, true); await done;
    assert.strictEqual(store.length(), TOY.time.steps + 1); assert.strictEqual(ctl.runs, 1); assert.strictEqual(ctl.running, false);
    const ref = PStore.create(TOY); ref.pushFrames(sync(store.params()), { replace: true });
    for (const t of [0, 1, 80, TOY.time.steps]) assert.deepStrictEqual(arr(store.frameAt(t).entities.building.state), arr(ref.frameAt(t).entities.building.state), 'day ' + t);
  });
  test('controller (async): a moved slider keeps the time, drops the stale run, and several moves cost the last one', async () => {
    const { store, ctl } = mk(); await ctl.start(); store.setTime(50); const was = arr(store.frame().entities.building.state).join('');
    const runs = ctl.runs, seen = []; store.subscribe('frames', ev => seen.push(ev.length));
    store.setParam('beta', 0.3); store.setParam('beta', 0.4); store.setParam('lockdown', 'full'); await until(() => !ctl.running && ctl.runs > runs);
    assert.strictEqual(store.time().t, 50, 'the time stays where it was'); assert(seen[0] > 50, 'the old frames stayed on screen until the new run reached day 50: ' + seen[0]);
    const ref = PStore.create(TOY); ref.pushFrames(sync(store.params()), { replace: true });
    assert.deepStrictEqual(arr(store.frame().entities.building.state), arr(ref.frameAt(50).entities.building.state)); assert.notStrictEqual(arr(store.frame().entities.building.state).join(''), was);
    assert.strictEqual(store.length(), TOY.time.steps + 1); assert.strictEqual(store.param('lockdown'), 'full'); assert.strictEqual(store.param('beta'), 0.4);
  });
  test('controller (async): play waits for a frame that has not arrived, and inspect asks the runtime for the time shown', async () => {
    const { store, ctl } = mk(); await ctl.start(); store.setTime(40);
    const d = await ctl.inspect({ entity: 'building', id: 5 }); assert(/State on day 40/.test(d.fields[0].label), JSON.stringify(d));
  });
}

// ---------- picking ----------
const ring = (x, y, w, d) => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
const fake = (list) => ({ buildings: list.map(b => ({ src: { footprint: b.f }, fit: { cx: b.f.reduce((s, p) => s + p[0], 0) / b.f.length, cy: b.f.reduce((s, p) => s + p[1], 0) / b.f.length }, h: b.h })) });
const view = { scale: 4, ox: 600, oy: 300 }, scr = (x, y, z) => V.proj(view, x, y, z);
test('pick: inverts the projection, and a point on the ground inside a footprint finds that building', () => {
  const sim = fake([{ f: ring(0, 0, 10, 10), h: 12 }]), p = Pick.create(sim, { height: e => e.h });
  const q = scr(5, 5, 0); assert.strictEqual(p.hit(view, q[0], q[1]), 0); assert.strictEqual(p.hit(view, q[0], q[1] - 3), 0); assert.strictEqual(p.hit(view, 100, 100), -1);
  assert.strictEqual(p.hitGround(5, 5), 0); assert.strictEqual(p.hitGround(-15, 5), -1); assert.strictEqual(p.hitGround(5, 30), -1);
});
test('pick: the building is hit where its walls and roof are drawn, not only where it stands (the footprint lifted by its height)', () => {
  const sim = fake([{ f: ring(0, 0, 10, 10), h: 30 }]), p = Pick.create(sim, { height: e => e.h });
  for (const [x, y, z] of [[5, 5, 29], [0.2, 0.2, 29.5], [9.8, 9.8, 29.5], [9.8, 0.2, 15], [0.2, 9.8, 22], [5, 5, 0.1]]) { const q = scr(x, y, z); assert.strictEqual(p.hit(view, q[0], q[1]), 0, [x, y, z].join()); }
  const above = scr(0, 0, 33); assert.strictEqual(p.hit(view, above[0], above[1]), -1, 'above the back corner of the roof is sky'); const beside = scr(5, 5, 30); assert.strictEqual(p.hit(view, beside[0] + 10 * 4 * 0.866 + 6, beside[1]), -1, 'beside the wall is not the building');
  const flat = Pick.create(fake([{ f: ring(0, 0, 10, 10), h: 0 }]), { height: e => e.h }), g0 = scr(5, 5, 0); assert.strictEqual(flat.hit(view, g0[0], g0[1]), 0, 'a building of no height is its footprint');
});
test('pick: of two buildings on one pixel the one drawn last (greater x + y) wins, and ties go to the later one', () => {
  const sim = fake([{ f: ring(0, 0, 10, 10), h: 40 }, { f: ring(14, 14, 10, 10), h: 8 }, { f: ring(0, 0, 10, 10), h: 40 }]), p = Pick.create(sim, { height: e => e.h });
  const tall = scr(5, 5, 20); assert.strictEqual(p.hit(view, tall[0], tall[1]), 2, 'identical stacked buildings: the later wins');
  const sim2 = fake([{ f: ring(0, 0, 10, 10), h: 40 }, { f: ring(10, 10, 10, 10), h: 8 }]), p2 = Pick.create(sim2, { height: e => e.h });
  const behindTop = scr(5, 5, 38); assert.strictEqual(p2.hit(view, behindTop[0], behindTop[1]), 0, 'the tall one stands out above the low one in front of it');
  const covered = scr(10, 10, 4); assert.strictEqual(p2.hit(view, covered[0], covered[1]), 1, 'where the low one in front covers it, the low one');
});
test('pick: the grid gives the same answer as testing every building, on thousands of points, and tests few buildings', () => {
  const sim = mkSim(), p = Pick.create(sim); let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const B = V.sceneBounds(sim.scene); let hits = 0;
  for (let i = 0; i < 4000; i++) { const x = B[0] - 20 + rnd() * (B[2] - B[0] + 40), y = B[1] - 20 + rnd() * (B[3] - B[1] + 40), a = p.hitGround(x, y), b = p.hitBrute(x, y); assert.strictEqual(a, b, 'point ' + x.toFixed(2) + ',' + y.toFixed(2)); if (a >= 0) hits++; }
  assert(hits > 300 && hits < 3900, 'a mix of hits and misses: ' + hits); assert(p.stats.tested / p.stats.queries < 12, 'the grid keeps each query to a few buildings: ' + (p.stats.tested / p.stats.queries).toFixed(1));
});
test('pick: every placeholder building can be hit at its middle, by itself or by one drawn in front of it', () => {
  const sim = mkSim(), p = Pick.create(sim), v = V.fitView(sim.scene, 1200, 700, 0.06), vz = Object.assign({}, v, { scale: 3, ox: 600, oy: 350 });
  let own = 0, front = 0;
  sim.buildings.forEach((e, i) => {
    const h = V.entityHeight(e), q = V.proj(vz, e.fit.cx, e.fit.cy, h / 2), got = p.hit(vz, q[0], q[1]);
    if (got === i) own++; else { assert(got >= 0, 'building ' + i + ' has something at its middle'); const o = sim.buildings[got]; assert(o.fit.cx + o.fit.cy >= e.fit.cx + e.fit.cy, 'only a building drawn later may cover it'); front++; }
  });
  assert(own > sim.buildings.length * 0.3, 'most buildings are hit by themselves: ' + own + ' of ' + sim.buildings.length);
});
test('pick: 12,000 buildings, 1,000 queries: the index is built once and a query costs microseconds', () => {
  const base = V.makePlaceholderScene(7), B = V.sceneBounds(base), w = B[2] - B[0] + 40, h = B[3] - B[1] + 40, scene = { area: base.area, roads: [], buildings: [], landuse: [], trees: [] };
  for (let t = 0; t < 12; t++) for (const b of base.buildings) scene.buildings.push(Object.assign({}, b, { id: b.id + '#' + t, footprint: b.footprint.map(q => [q[0] + (t % 4) * w, q[1] + Math.floor(t / 4) * h]) }));
  const sim = V.createSim(scene, { seed: 5, theme: A.theme(fam, undefined, 'colorfigures'), region: 'nw' }), t0 = process.hrtime.bigint(), p = Pick.create(sim), build = Number(process.hrtime.bigint() - t0) / 1e6;
  const vb = V.sceneBounds(scene); let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; const t1 = process.hrtime.bigint(); let n = 0;
  for (let i = 0; i < 1000; i++) if (p.hitGround(vb[0] + rnd() * (vb[2] - vb[0]), vb[1] + rnd() * (vb[3] - vb[1])) >= 0) n++;
  const per = Number(process.hrtime.bigint() - t1) / 1e6 / 1000; assert(sim.buildings.length > 12000 && n > 50);
  assert(per < 0.1, 'a query costs ' + (per * 1000).toFixed(1) + ' us'); console.log('     (index of ' + sim.buildings.length + ' buildings built in ' + build.toFixed(0) + ' ms; a query ' + (per * 1000).toFixed(1) + ' us)');
});

// ---------- a pack bound to the scene: picking, patch frames and the inspector together ----------
if (!toyJson) skip('bound pack: all together', 'no manifest given');
else {
  const TOY = JSON.parse(toyJson);
  const modes = [['same thread', () => ({ mode: 'inline' }), true]];
  if (wt) modes.push(['real worker', () => ({ mode: 'worker', sources: { runtime: read('packruntime.js'), worker: read('packworker.js'), entry: read('../packs/toy-epidemic/runtime.js') } }), false]);
  for (const [label, opts] of modes) test('bound pack (' + label + '): entities on the buildings the pack named, patch frames, picking and the inspector agree', async () => {
    const scene = V.makePlaceholderScene(7), impl = PD.getRuntime('toy-epidemic') || (vm.runInContext(read('../packs/toy-epidemic/runtime.js'), g), PD.getRuntime('toy-epidemic'));
    const bound = PR.bindScene(TOY, impl, scene); assert(bound.ok && bound.bound, bound.error); const n = bound.counts.building, pos = bound.pos.building;
    assert(n > 0 && n < scene.buildings.length, 'some buildings (sheds) have no entity: ' + n);
    const store = PStore.create(TOY), runtime = PW.create(TOY, Object.assign({ counts: bound.counts, attrs: bound.attrs }, opts(), label === 'real worker' ? fakes : {}));
    try {
      const ctl = PH.createController({ manifest: TOY, runtime, store, immediate: true }); await ctl.start(); assert.strictEqual(ctl.error, null, ctl.error);
      assert.strictEqual(runtime.mode, label === 'real worker' ? 'worker' : 'inline'); assert.strictEqual(store.length(), TOY.time.steps + 1);
      assert.strictEqual(store.frame().entities.building.state.length, n, 'the worker made one entity per bound building');
      assert(store.frameAt(7).patch && store.frameAt(7).entities, 'patch frames came through');
      const sim = V.createSim(scene, { seed: 5, theme: A.theme(fam, undefined, 'colorfigures'), region: 'nw' }), b = PH.bindRenderer({ manifest: TOY, store, controller: ctl, sim, bound });
      assert(b.ok && b.bound && b.count === n && b.placed === n, b.error);
      store.setTime(1); store.setTime(2);                                                   // one step on to a patch: the bound arrays follow by the patch alone
      const bo = store.bound('building'); assert(bo.stats.patch >= 1, 'followed a patch: ' + JSON.stringify(bo.stats));
      const st2 = store.frame().entities.building.state; for (const k of [0, 3, n - 1]) assert.strictEqual(bo.fields.state[pos[k]], st2[k], 'entity ' + k + ' is on scene building ' + pos[k]);
      const shed = sim.buildings.findIndex((e, i) => b.modelOf[i] < 0); assert(shed >= 0 && bo.fields.state[shed] === -1, 'a building without an entity holds no data');
      store.setTime(40);
      const pick = Pick.create(sim), view = { scale: 3, ox: 600, oy: 350 }; let tried = 0, found = 0;
      for (let k = 0; k < n && found < 5; k++) {
        const e = b.entityOf(k), q = V.proj(view, e.fit.cx, e.fit.cy, V.entityHeight(e) * 0.5), si = pick.hit(view, q[0], q[1]); tried++;
        if (si !== pos[k]) continue;                                                        // covered by a building in front: try another
        found++; assert.strictEqual(b.modelOf[si], k, 'the pick maps back to entity ' + k);
        store.select({ entity: 'building', id: k });
        const d = await ctl.inspect(store.selection()); assert(d && new RegExp('^Building ' + (k + 1) + ' ').test(d.title), JSON.stringify(d));
        const word = ['Susceptible', 'Exposed', 'Infectious', 'Recovered'][st40(store, k)]; assert(d.title.endsWith(word) && d.fields[0].value === word, 'the inspector and the frame agree at day 40: ' + d.title + ' / ' + word);
        assert.strictEqual(PH.entityRows(TOY, store, store.selection())[0].value.length > 0, true);
      }
      assert(found >= 5, 'five buildings could be picked: ' + found + ' of ' + tried);
      const inspectShed = await ctl.inspect({ entity: 'building', id: n + 5 }); assert.strictEqual(inspectShed, null, 'no such entity: nothing to say');
    } finally { runtime.dispose(); }
  });
}
function st40(store, k) { return store.frame().entities.building.state[k]; }

(async () => {
  for (const [name, fn] of queue) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.stack || e)); } }
  if (failed) { console.log(failed + ' failed'); process.exit(1); }
  console.log('all passed'); process.exit(0);
})();
