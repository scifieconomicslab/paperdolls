/* Tests for the model-pack system: the manifest validator, the store, the runtime adapter, the shell's controller and renderer binding, and the toy epidemic.
 * Run: node viz/test_pack.js [--manifest-json '<the toy pack.yaml as JSON>']
 * Without the manifest the toy pack's own tests print SKIP (node has no YAML reader); tests/test_pack.py passes it.
 * Also: node viz/test_pack.js --dump docs.json   prints {name: {errors, warnings}} for each manifest in the file (used to check the two validators agree). */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const g = { console, Math, Object, Map, WeakMap, Array, Infinity, JSON, Set, Date, Number, String, Promise, Int8Array, Int16Array, Float32Array, ArrayBuffer }; g.globalThis = g; vm.createContext(g);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js', 'replay.js', 'packvalidate.js', 'packstore.js', 'packruntime.js', 'packhost.js']) load(f);
const A = g.AssetLib, V = g.VizLib, PS = g.PackSpec, PStore = g.PackStore, PR = g.PackRuntime, PH = g.PackHost, PD = g.PaperDolls;
const arg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const clone = o => JSON.parse(JSON.stringify(o));

if (arg('--dump')) {
  const docs = JSON.parse(fs.readFileSync(arg('--dump'), 'utf8')), out = {};
  for (const [k, m] of Object.entries(docs)) { const r = PS.validate(m); out[k] = { errors: r.errors, warnings: r.warnings }; }
  console.log(JSON.stringify(out)); process.exit(0);
}

let failed = 0;
function test(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.stack || e)); } }
function skip(name, why) { console.log('SKIP ' + name + ' (' + why + ')'); }

// ---------- the validator, on the shared cases ----------
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'pack_cases.json'), 'utf8'));
function patched(base, patch) {
  const m = clone(base);
  for (const [p, v] of Object.entries(patch)) {
    const parts = p.split('.'); let cur = m;
    for (const k of parts.slice(0, -1)) { if (cur[k] === undefined) cur[k] = {}; cur = cur[k]; }
    const last = parts[parts.length - 1];
    if (v === '$delete') { if (Array.isArray(cur)) cur.splice(+last, 1); else delete cur[last]; } else cur[last] = v;
  }
  return m;
}
for (const c of CASES.cases) test('validator: ' + c.name, () => {
  const r = PS.validate(patched(CASES.base, c.patch));
  for (const w of c.errors) assert(r.errors.some(e => e.includes(w)), 'expected an error with "' + w + '", got ' + JSON.stringify(r.errors));
  for (const w of c.warnings) assert(r.warnings.some(e => e.includes(w)), 'expected a warning with "' + w + '", got ' + JSON.stringify(r.warnings));
  if (!c.errors.length) assert.deepStrictEqual(Array.from(r.errors), []);
});

// ---------- the store ----------
const M = CASES.base;
const mkStore = () => PStore.create(clone(M));
test('store: starts at the declared defaults and time 0', () => {
  const s = mkStore(); assert.deepStrictEqual({ ...s.params() }, { rate: 0.5, n: 3, flag: false, mode: 'x' });
  assert.strictEqual(s.time().t, 0); assert.strictEqual(s.time().speed, 4); assert.strictEqual(s.time().horizon, 10); assert.strictEqual(s.frame(), null); assert.strictEqual(s.selection(), null);
});
test('store: setParam clamps to the range, snaps to the step and rounds integers', () => {
  const s = mkStore();
  s.setParam('rate', 7); assert.strictEqual(s.param('rate'), 1); s.setParam('rate', -3); assert.strictEqual(s.param('rate'), 0);
  s.setParam('rate', 0.33); assert.strictEqual(s.param('rate'), 0.35);                         // step 0.05
  s.setParam('rate', '0.7'); assert.strictEqual(s.param('rate'), 0.7);                          // a slider hands over a string
  s.setParam('n', 4.6); assert.strictEqual(s.param('n'), 5); s.setParam('n', 99); assert.strictEqual(s.param('n'), 9);
});
test('store: an unknown name or an illegal value is refused and changes nothing', () => {
  const s = mkStore(); let n = 0; s.subscribe('params', () => n++);
  assert.strictEqual(s.setParam('ghost', 1), false); assert.strictEqual(s.setParam('mode', 'z'), false); assert.strictEqual(s.setParam('flag', 'yes'), false); assert.strictEqual(s.setParam('rate', 'abc'), false);
  assert.strictEqual(s.setParams({ rate: 0.9, mode: 'z' }), false); assert.strictEqual(s.param('rate'), 0.5);          // all or nothing
  assert.strictEqual(n, 0);
});
test('store: subscribers hear a change once, and not a repeat of the same value', () => {
  const s = mkStore(), seen = []; const off = s.subscribe('params', ev => seen.push(ev.changed.join()));
  s.setParam('rate', 0.8); s.setParam('rate', 0.8); s.setParams({ rate: 0.8, n: 5 });
  assert.deepStrictEqual(seen, ['rate', 'n']); off(); s.setParam('rate', 0.1); assert.strictEqual(seen.length, 2);
});
test('store: a preset is complete, so parameters it does not name return to their defaults', () => {
  const s = mkStore(); s.setParam('n', 8); assert.strictEqual(s.applyPreset('fast'), true);
  assert.deepStrictEqual({ ...s.params() }, { rate: 0.9, n: 3, flag: true, mode: 'x' }); assert.strictEqual(s.isPreset('fast'), true);
  s.setParam('n', 4); assert.strictEqual(s.isPreset('fast'), false); assert.strictEqual(s.applyPreset('nope'), false);
});
test('store: frames are held in order, the series grows with them and time stays inside them', () => {
  const s = mkStore(); const fr = t => ({ t, entities: {}, series: { totals: [t, 10 - t] } });
  assert.throws(() => s.pushFrames([fr(1)]), /out of order/);
  s.pushFrames([0, 1, 2, 3].map(fr), { replace: true });
  assert.strictEqual(s.length(), 4); assert.strictEqual(s.series('totals').length, 4); assert.strictEqual(s.setTime(99), true); assert.strictEqual(s.time().t, 3);
  assert.deepStrictEqual(Array.from(s.latest('totals')), [3, 7]); s.setTime(1); assert.deepStrictEqual(Array.from(s.latest('totals')), [1, 9]);
  s.pushFrames([fr(4)]); assert.strictEqual(s.length(), 5); assert.strictEqual(s.time().t, 1);
  s.pushFrames([0, 1].map(fr), { replace: true }); assert.strictEqual(s.series('totals').length, 2); assert.strictEqual(s.time().t, 1);
  s.pushFrames([0].map(fr), { replace: true }); assert.strictEqual(s.time().t, 0);              // a shorter run pulls time back inside it
});
test('store: time, play state, speed and selection are events too, and a throwing subscriber does not stop the rest', () => {
  const s = mkStore(), log = []; const quiet = g.console.error; g.console.error = () => {};
  s.subscribe('*', ev => { if (ev.topic === 'time') throw new Error('boom'); }); s.subscribe('*', ev => log.push(ev.topic + (ev.what ? ':' + ev.what : '')));
  s.pushFrames([0, 1, 2].map(t => ({ t, entities: {}, series: {} })), { replace: true }); log.length = 0;
  s.setTime(2); s.setPlaying(true); s.setPlaying(true); s.setSpeed(8); s.setSpeed(-1); s.select({ entity: 'thing', id: 3 }); s.select({ entity: 'thing', id: 3 }); s.select(null);
  g.console.error = quiet;
  assert.deepStrictEqual(Array.from(log), ['time:t', 'time:playing', 'time:speed', 'selection', 'selection']);
  assert.throws(() => s.subscribe('nonsense', () => {}), /unknown topic/);
});

// ---------- the runtime adapter ----------
const counter = () => ({
  init(p, ents, seed) { return { t: 0, n: ents.thing.count, k: p.n, seed }; },
  step(h, n) { const out = []; if (n === 0) return [frame(h)]; for (let i = 0; i < n; i++) { h.t++; out.push(frame(h)); } return out; },
  snapshot(h) { return { t: h.t, k: h.k }; }, restore(h, s) { h.t = s.t; h.k = s.k; return h; },
});
const frame = h => ({ t: h.t, entities: { thing: { kind: new Array(h.n).fill(h.t % 2), load: new Array(h.n).fill(h.t / 10) } }, series: { totals: [h.t, h.k] } });
test('adapter: start gives frame 0, step and run extend it, and every frame is checked against the manifest', () => {
  const r = PR.create(clone(M), counter()), f0 = r.start({ n: 3 });
  assert.strictEqual(f0.t, 0); assert.deepStrictEqual(Array.from(r.step(2).map(f => f.t)), [1, 2]); assert.deepStrictEqual(Array.from(r.run(6).map(f => f.t)), [3, 4, 5, 6]);
  assert.strictEqual(r.t, 6); assert.deepStrictEqual(Array.from(r.run(99).map(f => f.t)), [7, 8, 9, 10]);               // clamped to the horizon
});
test('adapter: a bad frame is reported with its place', () => {
  const bad = counter(); bad.step = (h, n) => [{ t: h.t + n, entities: { thing: { kind: [0, 1], load: [0, 0, 0, 0, 0] } }, series: { totals: [1, 2] } }];
  assert.throws(() => PR.create(clone(M), bad).start({ n: 3 }), /thing\.kind has 2 values, expected 5/);
  const idx = counter(); idx.step = (h, n) => [{ t: h.t, entities: { thing: { kind: [0, 1, 2, 0, 0], load: [0, 0, 0, 0, 0] } }, series: { totals: [1, 2] } }];
  assert.throws(() => PR.create(clone(M), idx).start({ n: 3 }), /not an index into a\/b/);
  const ser = counter(); ser.step = (h, n) => [{ t: h.t, entities: { thing: { kind: [0, 1, 0, 0, 0], load: [0, 0, 0, 0, 0] } }, series: { ghost: [1] } }];
  assert.throws(() => PR.create(clone(M), ser).start({ n: 3 }), /series\.ghost is not declared/);
  const off = counter(); off.step = (h, n) => [{ t: 5, entities: {}, series: {} }];
  assert.throws(() => PR.create(clone(M), off).start({ n: 3 }), /t is 5, expected 0/);
});
test('adapter: the interface is checked, and setParams is needed only for "continue"', () => {
  assert.deepStrictEqual(Array.from(PR.checkInterface(clone(M), { init() {} })), ['step is missing']);
  const cont = clone(M); cont.runtime.on_params = 'continue';
  assert.deepStrictEqual(Array.from(PR.checkInterface(cont, counter())), ['setParams is missing (runtime.on_params is "continue")']);
  assert.deepStrictEqual(Array.from(PR.checkInterface(clone(M), Object.assign(counter(), { restore: undefined }))), ['snapshot and restore go together']);
  assert.throws(() => PD.registerRuntime('x', { init() {} }), /needs init/);
});
test('adapter: "rerun" starts again on new parameters, "continue" keeps the state', () => {
  const rr = PR.create(clone(M), counter()); rr.start({ n: 3 }); rr.run(5);
  const a = rr.setParams({ n: 9 }); assert.strictEqual(a.restarted, true); assert.strictEqual(a.frame.t, 0); assert.strictEqual(rr.t, 0);
  const cont = clone(M); cont.runtime.on_params = 'continue'; const impl = counter(); impl.setParams = (h, p) => { h.k = p.n; return h; };
  const rc = PR.create(cont, impl); rc.start({ n: 3 }); rc.run(5);
  const b = rc.setParams({ n: 9 }); assert.strictEqual(b.restarted, false); assert.strictEqual(rc.t, 5); assert.strictEqual(Array.from(rc.step(1))[0].series.totals[1], 9);
});
test('adapter: snapshot and restore carry on exactly, and a handle that does not is caught', () => {
  assert.deepStrictEqual(Array.from(PR.checkRuntime(clone(M), counter(), { n: 3 })), []);
  const leaky = counter(); let calls = 0; const step = leaky.step; leaky.step = (h, n) => { const f = step(h, n); calls++; f.forEach(x => { x.series.totals[1] = calls; }); return f; };
  assert(PR.checkRuntime(clone(M), leaky, { n: 3 }).some(e => /not deterministic/.test(e)), 'state outside the handle is caught');
});

// ---------- the toy epidemic ----------
const toyJson = arg('--manifest-json') || process.env.PACK_MANIFEST_JSON;
if (!toyJson) skip('toy: all', 'no manifest given');
else {
  const TOY = JSON.parse(toyJson); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'packs', 'toy-epidemic', 'runtime.js'), 'utf8'), g);
  const impl = PD.getRuntime('toy-epidemic'), peak = (fr, i) => Math.max(...fr.map(f => f.series.counts[i]));
  const runAll = (over, m) => { const man = m || TOY, p = Object.assign({}, ...Object.entries(man.params).map(([k, v]) => ({ [k]: v.default })), over || {}), r = PR.create(man, impl); const f0 = r.start(p); return [f0].concat(r.run(man.time.steps)); };
  test('toy: the manifest validates with no errors and no warnings', () => { const r = PS.validate(TOY); assert.deepStrictEqual([Array.from(r.errors), Array.from(r.warnings)], [[], []]); });
  test('toy: deterministic, and a snapshot restores exactly', () => { assert.deepStrictEqual(Array.from(PR.checkRuntime(TOY, impl)), []); });
  test('toy: every building is in one state, and the counts add up in every frame', () => {
    const fr = runAll(); assert.strictEqual(fr.length, TOY.time.steps + 1);
    for (const f of fr) { assert.strictEqual(f.entities.building.state.length, 600); assert.strictEqual(f.series.counts.reduce((a, b) => a + b, 0), 600); }
    assert.strictEqual(fr[0].series.counts[2], TOY.params.initial_cases.default);
  });
  test('toy: parameters do something: lockdown, immunity and transmission change the epidemic', () => {
    const base = runAll(), lock = runAll({ lockdown: 'full' }), imm = runAll({ immunity: 0.9, initial_cases: 3 }), none = runAll({ beta: 0 });
    assert(peak(lock, 2) < peak(base, 2) / 10, 'lockdown flattens the peak: ' + peak(lock, 2) + ' vs ' + peak(base, 2));
    assert(imm.slice(-1)[0].series.counts[3] >= 500 && peak(imm, 2) < peak(base, 2), 'high immunity leaves few to infect');
    assert.strictEqual(peak(none, 1), 0, 'with no transmission nobody is exposed');
    assert(peak(runAll({ masks: true, beta: 0.2 }), 2) <= peak(runAll({ beta: 0.2 }), 2), 'masks do not make it worse');
  });
  test('toy: a different seed gives a different run, the same seed the same one', () => {
    const a = runAll(), m2 = clone(TOY); m2.runtime.seed = 99; const b = runAll({}, m2);
    assert.notStrictEqual(PR.digest(a), PR.digest(b)); assert.strictEqual(PR.digest(a), PR.digest(runAll()));
  });
  test('toy: run and step give the same frames, and "continue" gives the same run as "rerun"', () => {
    const p = Object.assign({}, ...Object.entries(TOY.params).map(([k, v]) => ({ [k]: v.default })));
    const r = PR.create(TOY, impl); r.start(p); const stepped = []; for (let i = 0; i < 20; i++) stepped.push(r.step(1)[0]);
    assert.strictEqual(PR.digest(stepped), PR.digest(runAll().slice(1, 21)));
    const cont = clone(TOY); cont.runtime.on_params = 'continue'; const rc = PR.create(cont, impl); rc.start(p); rc.run(10); rc.setParams(Object.assign({}, p, { lockdown: 'full' })); const tail = rc.run(40);
    const un = runAll(), after = tail[tail.length - 1].series.counts;
    assert(after[0] > un[40].series.counts[0] + 100, 'a lockdown brought in on day 10 leaves more buildings uninfected on day 40: ' + after[0] + ' vs ' + un[40].series.counts[0]);
  });

  // ---------- the shell ----------
  const mkHost = (over) => {
    const man = over || TOY, store = PStore.create(man), runtime = PR.create(man, impl), ctl = PH.createController({ manifest: man, runtime, store, immediate: true });
    ctl.start(); return { man, store, runtime, ctl };
  };
  test('shell: the controller fills the timeline and a moved parameter re-runs once, keeping the time', () => {
    const { store, ctl } = mkHost(); assert.strictEqual(store.length(), TOY.time.steps + 1);
    store.setTime(50); const was = Array.from(store.frame().entities.building.state).join('');
    const runs = ctl.runs; store.setParam('lockdown', 'full'); assert.strictEqual(ctl.runs, runs + 1); assert.strictEqual(store.time().t, 50);
    assert.notStrictEqual(Array.from(store.frame().entities.building.state).join(''), was);
    store.setParam('lockdown', 'full'); assert.strictEqual(ctl.runs, runs + 1, 'no change, no run');
  });
  test('shell: without immediate mode the re-runs wait for flush and many events cost one run', () => {
    const man = TOY, store = PStore.create(man), runtime = PR.create(man, impl), ctl = PH.createController({ manifest: man, runtime, store }); ctl.start();
    store.setParam('beta', 0.3); store.setParam('beta', 0.4); store.setParam('contacts', 7); assert.strictEqual(ctl.runs, 0);
    assert.strictEqual(ctl.flush(), true); assert.strictEqual(ctl.runs, 1); assert.strictEqual(ctl.flush(), false);
  });
  test('shell: play advances time at the speed and stops at the end', () => {
    const { store, ctl } = mkHost(); store.setSpeed(10); store.setPlaying(true);
    ctl.advance(0.35); assert.strictEqual(store.time().t, 3); ctl.advance(1); assert.strictEqual(store.time().t, 13);
    ctl.advance(100); assert.strictEqual(store.time().t, TOY.time.steps); assert.strictEqual(store.time().playing, false);
    ctl.togglePlay(); assert.strictEqual(store.time().t, 0); assert.strictEqual(store.time().playing, true);       // play at the end starts over
  });
  test('shell: a "continue" model makes frames only as the clock reaches them', () => {
    const cont = clone(TOY); cont.runtime.on_params = 'continue'; const { store, ctl } = mkHost(cont);
    assert.strictEqual(store.length(), 1); store.setSpeed(10); store.setPlaying(true); ctl.advance(1); assert.strictEqual(store.time().t, 10); assert.strictEqual(store.length(), 11);
    store.setParam('lockdown', 'full'); assert.strictEqual(store.length(), 11, 'frames already made are kept'); ctl.advance(1); assert.strictEqual(store.length(), 21);
  });
  test('shell: the legend is made from the mappings and names every value', () => {
    const L = PH.legendFor(TOY); assert.deepStrictEqual(Array.from(L.map(s => s.title)), ['Infection state', 'Exposure today', 'Infectious']);
    assert.deepStrictEqual(Array.from(L[0].items.map(i => i.label)), ['Susceptible', 'Exposed', 'Infectious', 'Recovered', 'No data']);
    assert.strictEqual(L[1].kind, 'ramp'); assert.deepStrictEqual(Array.from(L[2].items.map(i => i.overlay)), [null, 'marker']);
    assert(L[2].items[0].label.includes('Susceptible') && L[2].items[0].label.includes('Recovered'));
  });
  const fam = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8')).families.find(f => f.id === 'nw');
  const mkSim = () => V.createSim(V.makePlaceholderScene(7), { seed: 5, theme: A.theme(fam, undefined, 'colorfigures'), region: 'nw' });
  test('shell: the renderer draws building k with the colour of entity k in the current frame, and leaves the extras alone', () => {
    const { man, store, ctl } = mkHost(), sim = mkSim(), b = PH.bindRenderer({ manifest: man, store, controller: ctl, sim }); assert(b.ok, b.error);
    const reg = A.REG.colorfigures, style = e => { const s = sim.buildingStyle(e, reg, sim.theme, '#aaaaaa'); return { data: s.data, overlays: Array.from(s.overlays) }; };
    const COL = { 0: '#a9c5a0', 1: '#e9b44c', 2: '#c8452f', 3: '#5b8db8' };
    for (const t of [0, 30]) {
      store.setTime(t); const st = store.frame().entities.building.state;
      for (const k of [0, 1, 2, 77, 599]) { const s = style(b.entityOf(k)); assert.strictEqual(s.data, COL[st[k]], 'entity ' + k + ' at t=' + t); assert.deepStrictEqual(s.overlays, st[k] === 2 ? ['marker'] : []); }
    }
    assert.deepStrictEqual(style(b.entityOf(600)), { data: null, overlays: [] }); assert.strictEqual(sim.buildings.length, 1023);
    ctl.setWall(1); store.setTime(30); const ex = store.frame().entities.building.exposure, s5 = style(b.entityOf(5));
    assert.strictEqual(s5.data, A && g.Replay.sequential(['#f4e9c8', '#e9b44c', '#c8452f'], [0, 1], ex[5]));
  });
  test('shell: a scene with fewer buildings than the model says so and draws nothing', () => {
    const { man, store, ctl } = mkHost(), small = V.makePlaceholderScene(7); small.buildings = small.buildings.slice(0, 10);
    const sim = V.createSim(small, { seed: 5, theme: A.theme(fam, undefined, 'colorfigures'), region: 'nw' });
    const b = PH.bindRenderer({ manifest: man, store, controller: ctl, sim }); assert.strictEqual(b.ok, false); assert(/at least as many/.test(b.error)); assert.strictEqual(sim.buildingStyle, null);
  });

  // ---------- the real renderer: a frame and a parameter change change the pixels ----------
  let createCanvas = null; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { /* no canvas package */ }
  if (!createCanvas) skip('shell: pixels follow the frame', 'canvas is not installed');
  else test('shell: pixels follow the frame and the parameters', () => {
    A.sprites.factory = (w, h) => createCanvas(w, h);
    const { man, store, ctl } = mkHost(), sim = mkSim(), b = PH.bindRenderer({ manifest: man, store, controller: ctl, sim }); assert(b.ok);
    const W = 800, H = 520, cv = createCanvas(W, H), ctx = cv.getContext('2d'), view = V.fitView(sim.scene, W, H, 0.06);
    const shot = () => { for (let i = 0; i < 6; i++) V.renderFrame(ctx, sim, view, { vehicles: false, people: false }); return ctx.getImageData(0, 0, W, H).data; };
    const diff = (a, c) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - c[i]) + Math.abs(a[i + 1] - c[i + 1]) + Math.abs(a[i + 2] - c[i + 2]) > 30) n++; return n; };
    store.setTime(0); const p0 = shot(); assert(diff(p0, shot()) === 0, 'a still frame is stable');
    store.setTime(60); const p60 = shot(); assert(diff(p0, p60) > 300, 'day 60 looks different from day 0: ' + diff(p0, p60) + ' pixels');
    store.setParam('lockdown', 'full'); const lock60 = shot(); assert(diff(p60, lock60) > 300, 'a lockdown changes day 60: ' + diff(p60, lock60) + ' pixels');
    store.setParam('lockdown', 'none'); assert.strictEqual(diff(p60, shot()), 0, 'putting the slider back restores the picture');
  });

  // ---------- bindScene: model entities generated from the real scene ----------
  const loadScene = f => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')); } catch (e) { return null; } };
  const mkSimOf = scene => V.createSim(scene, { seed: 5, theme: A.theme(fam, undefined, 'colorfigures'), region: 'nw' });
  const isDwelling = b => (b.residential !== undefined ? b.residential !== 'other' : b.archetype !== 'shed');
  const bindOn = scene => { const b = PR.bindScene(TOY, impl, scene); assert(b.ok, b.error); return b; };
  test('bindScene: the placeholder gets one entity per non-shed building, and each stands on the building it names', () => {
    const scene = V.makePlaceholderScene(7), b = bindOn(scene), want = scene.buildings.filter(isDwelling);
    assert(b.bound && b.counts.building === want.length && want.length > 0 && want.length < scene.buildings.length, 'count ' + b.counts.building);
    const pos = b.pos.building; assert.strictEqual(pos.length, want.length);
    pos.forEach((si, k) => assert.strictEqual(scene.buildings[si].id, want[k].id));
    assert.strictEqual(b.warnings.length, 0); assert.strictEqual(b.attrs.building.area.length, want.length);
  });
  test('bindScene: the page binding paints entity k on scene building pos[k], and buildings without an entity are left alone', () => {
    const scene = V.makePlaceholderScene(7), b = bindOn(scene), man = TOY, store = PStore.create(man), runtime = PR.create(man, impl, { counts: b.counts, attrs: b.attrs });
    const ctl = PH.createController({ manifest: man, runtime, store, immediate: true }); ctl.start();
    const sim = mkSimOf(scene), br = PH.bindRenderer({ manifest: man, store, controller: ctl, sim, bound: b }); assert(br.ok && br.bound, br.error);
    assert.strictEqual(br.count, b.counts.building); assert.strictEqual(br.placed, b.counts.building); assert.strictEqual(store.frame().entities.building.state.length, b.counts.building);
    const reg = A.REG.colorfigures, style = e => sim.buildingStyle(e, reg, sim.theme, '#aaaaaa'), COL = ['#a9c5a0', '#e9b44c', '#c8452f', '#5b8db8'], st = store.frame().entities.building.state;
    for (const k of [0, 1, 5, b.counts.building - 1]) { assert.strictEqual(br.entityOf(k).id, scene.buildings[b.pos.building[k]].id); assert.strictEqual(style(br.entityOf(k)).data, COL[st[k]]); }
    const shed = sim.buildings.find((e, i) => !isDwelling(scene.buildings[i])); assert(shed, 'the placeholder has a shed'); assert.deepStrictEqual({ data: style(shed).data, n: style(shed).overlays.length }, { data: null, n: 0 });
  });
  test('bindScene: an id the scene does not have, a null, and a repeated id are warnings; those entities are not drawn and the model still runs', () => {
    const scene = V.makePlaceholderScene(7), ids = scene.buildings.map(b => b.id), bad = { bindScene: () => ({ entities: { building: { count: 5 } }, sceneIndex: { building: [ids[0], 'nope', null, ids[0], ids[3]] } }) };
    const b = PR.bindScene(TOY, bad, scene); assert(b.ok);
    assert.deepStrictEqual(Array.from(b.pos.building), [0, -1, -1, -1, 3]); assert.strictEqual(b.warnings.length, 2, JSON.stringify(b.warnings));
    assert(/does not have/.test(b.warnings[0]) && /nope/.test(b.warnings[0]) && /share a scene building/.test(b.warnings[1]));
    const man = TOY, store = PStore.create(man), rt = PR.create(man, impl, { counts: b.counts }), ctl = PH.createController({ manifest: man, runtime: rt, store, immediate: true }); ctl.start();
    const sim = mkSimOf(scene), br = PH.bindRenderer({ manifest: man, store, controller: ctl, sim, bound: b }); assert(br.ok && br.placed === 2 && br.count === 5 && br.entityOf(1) === null);
  });
  test('bindScene: a scene whose buildings have no ids is bound by "#<index>"', () => {
    const scene = V.makePlaceholderScene(7); scene.buildings.forEach(b => { delete b.id; });
    const b = bindOn(scene); assert.strictEqual(b.warnings.length, 0); assert(b.bound && b.pos.building[0] >= 0 && b.pos.building.every(x => x >= 0));
    const first = scene.buildings.findIndex(isDwelling); assert.strictEqual(b.pos.building[0], first);
  });
  test('bindScene: a malformed result is an error that says what is wrong; a pack without bindScene is unbound', () => {
    const scene = V.makePlaceholderScene(7), run = r => PR.bindScene(TOY, { bindScene: () => r }, scene);
    assert(/must return/.test(run({}).error)); assert(/not declared/.test(run({ entities: { ghost: { count: 1 } }, sceneIndex: {} }).error));
    assert(/sceneIndex.building has 1 entries for 2/.test(run({ entities: { building: { count: 2 } }, sceneIndex: { building: ['a'] } }).error));
    assert(/must be a scene building id/.test(run({ entities: { building: { count: 1 } }, sceneIndex: { building: [{}] } }).error));
    assert(/boom/.test(PR.bindScene(TOY, { bindScene() { throw new Error('boom'); } }, scene).error));
    assert.deepStrictEqual({ ok: PR.bindScene(TOY, {}, scene).ok, bound: PR.bindScene(TOY, {}, scene).bound }, { ok: true, bound: false });
  });
  test('bindScene: the model receives the counts and the real attributes; neighbours are entity indices', () => {
    const scene = loadScene('samples/osm_fixture_scene.json'); assert(scene && scene.buildings[0].neighbours, 'fixture scene with the entity table');
    const b = bindOn(scene), n = b.counts.building, nb = b.attrs.building.neighbours; let seen = null;
    const spy = Object.assign({}, impl, { init(p, e, sd) { seen = e; return impl.init(p, e, sd); } }); PR.create(TOY, spy, { counts: b.counts, attrs: b.attrs }).start(Object.fromEntries(Object.entries(TOY.params).map(([k, v]) => [k, v.default])));
    assert.strictEqual(seen.building.count, n); assert.strictEqual(seen.building.attrs.area.length, n); assert(seen.building.attrs.area.every(a => a > 0));
    nb.forEach((l, k) => l.forEach(j => { assert(j >= 0 && j < n && j !== k); assert(nb[j].includes(k), 'neighbours are symmetric'); }));
  });
  const jette = loadScene('cache/jette-bbox-scene.json');
  if (!jette) skip('bindScene: Jette extract', 'cache/jette-bbox-scene.json is not there; python -m paperdolls ingest cache/jette-bbox-extract.json --bbox 50.874,4.325,50.88,4.338');
  else test('bindScene: on the 2,162-building Jette extract every dwelling gets exactly one entity, on its own building', () => {
    assert.strictEqual(jette.buildings.length, 2162); assert(V.validateScene(jette).ok);
    const b = bindOn(jette), want = jette.buildings.filter(isDwelling), pos = b.pos.building;
    assert.strictEqual(b.counts.building, want.length); assert(want.length > 1500 && want.length < 2162, 'dwellings: ' + want.length);
    assert.strictEqual(new Set(pos).size, pos.length); assert(pos.every(i => i >= 0 && isDwelling(jette.buildings[i])));
    assert.strictEqual(jette.buildings.filter(x => x.residential === 'residential' || x.residential === 'probable').length, want.length);
    const sim = mkSimOf(jette), man = TOY, store = PStore.create(man), rt = PR.create(man, impl, { counts: b.counts, attrs: b.attrs }), ctl = PH.createController({ manifest: man, runtime: rt, store, immediate: true }); ctl.start();
    const br = PH.bindRenderer({ manifest: man, store, controller: ctl, sim, bound: b }); assert(br.ok && br.placed === want.length);
    assert.strictEqual(store.length(), TOY.time.steps + 1);
  });
  test('scene: old scenes (no entity table) and new scenes both validate; bad new fields are errors', () => {
    const old = V.makePlaceholderScene(7); assert(V.validateScene(old).ok);
    const sc = loadScene('samples/osm_fixture_scene.json'); assert(V.validateScene(sc).ok, JSON.stringify(V.validateScene(sc).errors));
    const bad = clone(sc); Object.assign(bad.buildings[0], { area: -1, centroid: [1], height: 0, levels_assumed: 'yes', residential: 'maybe', neighbours: [{}] });
    const r = V.validateScene(bad); assert.strictEqual(r.errors.length, 6, JSON.stringify(r.errors));
    const dang = clone(sc); dang.buildings[0].neighbours = ['ghost']; const d = V.validateScene(dang); assert(d.ok && d.warnings.some(w => /neighbour id/.test(w)));
  });
}

if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('all passed');
