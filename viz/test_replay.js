/* Tests for replay.js: a trajectory and a mapping turned into building styles, a week and a legend. Run: node viz/test_replay.js */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const g = { console, Math, Object, Map, WeakMap, Array, Infinity, JSON, Set, Date, Number, String }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js', 'replay.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib, R = g.Replay;
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8')), fam = pal.families.find(f => f.id === 'nw');
let failed = 0;
function test(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message)); } }
const mkSim = () => V.createSim(V.makePlaceholderScene(7), { seed: 5, theme: A.theme(fam, undefined, 'colorfigures'), region: 'nw' });
const reg = A.REG.colorfigures, N = 4, nan = NaN;
const wall = (r, e) => { const st = r.sim.buildingStyle(e, reg, r.sim.theme, '#aaaaaa') || {}; return { data: st.data, overlays: Array.from(st.overlays || []) }; };   // Array.from: arrays made inside the vm context compare by prototype
const WEALTH = { variable: 'building.wealth', channel: 'wall', scale: { type: 'sequential', domain: [0, 10], colours: ['#000000', '#ff0000', '#ffffff'], label: 'Wealth' } };
const KIND = { variable: 'building.kind', channel: 'wall', scale: { type: 'categorical', values: { '1': { colour: '#112233', label: 'Mill' }, '2': { colour: '#445566', label: 'Farm' } } } };
const FIRE = { variable: 'building.fire', channel: 'overlay', scale: { type: 'categorical', values: { '0': { overlay: null, label: 'Safe' }, '1': { overlay: 'scaffold', label: 'Burning' } } } };

test('a sequential scale blends its colours across the domain and clamps outside it', () => {
  const sim = mkSim(), r = R.create(sim, { weeks: [{ vars: { 'building.wealth': [0, 5, 10, 99] } }], mapping: [WEALTH] });
  r.setWeek(0);
  const c = k => wall(r, r.entityOf(k)).data;
  assert.strictEqual(c(0), '#000000'); assert.strictEqual(c(1), '#ff0000'); assert.strictEqual(c(2), '#ffffff');
  assert.strictEqual(c(3), '#ffffff');                                   // above the domain: clamped, not extrapolated
  assert.strictEqual(R.sequential(['#000000', '#ffffff'], [0, 10], 2.5), '#404040');
});
test('a missing value is drawn as no data, never as the low end of the scale', () => {
  const sim = mkSim(), r = R.create(sim, { weeks: [{ vars: { 'building.wealth': [nan, 0, nan, nan] } }], mapping: [WEALTH] });
  r.setWeek(0);
  assert.strictEqual(wall(r, r.entityOf(0)).data, R.NO_DATA); assert.strictEqual(wall(r, r.entityOf(1)).data, '#000000');
});
test('buildings beyond the model, and the model weeks beyond the last, are handled', () => {
  const sim = mkSim(), r = R.create(sim, { weeks: [{ vars: { 'building.wealth': [1, 2, 3, 4] } }], mapping: [WEALTH] });
  r.setWeek(7); assert.strictEqual(r.week, 0);                           // one recorded week: any week is that week
  assert.strictEqual(wall(r, sim.buildings[r.placement.order[N + 3]]).data, R.NO_DATA);     // a scene building the model has no value for
});
test('a categorical wall scale and an overlay scale set colour and geometry', () => {
  const sim = mkSim(), r = R.create(sim, { weeks: [{ vars: { 'building.kind': [1, 2, 3, nan], 'building.fire': [0, 1, 1, nan] } }], mapping: [KIND, FIRE] });
  r.setWeek(0);
  assert.strictEqual(wall(r, r.entityOf(0)).data, '#112233'); assert.strictEqual(wall(r, r.entityOf(1)).data, '#445566');
  assert.strictEqual(wall(r, r.entityOf(2)).data, R.NO_DATA);         // 3 is not a listed value
  assert.deepStrictEqual(wall(r, r.entityOf(0)).overlays, []); assert.deepStrictEqual(wall(r, r.entityOf(1)).overlays, ['scaffold']);
  assert.deepStrictEqual(wall(r, r.entityOf(3)).overlays, []);
});
test('the week changes the style', () => {
  const sim = mkSim(), r = R.create(sim, { weeks: [{ vars: { 'building.fire': [0, 0, 0, 0] } }, { vars: { 'building.fire': [1, 0, 0, 0] } }], mapping: [FIRE] });
  r.setWeek(0); assert.deepStrictEqual(wall(r, r.entityOf(0)).overlays, []);
  r.setWeek(1); assert.deepStrictEqual(wall(r, r.entityOf(0)).overlays, ['scaffold']);
});
test('the legend is generated from the scales and says no data', () => {
  const sim = mkSim(), r = R.create(sim, { weeks: [{ vars: {} }], mapping: [WEALTH, KIND, FIRE] }), L = r.legend();
  assert.deepStrictEqual(L.map(s => s.title), ['Wealth', 'building.kind', 'building.fire']);
  assert.strictEqual(L[0].kind, 'ramp'); assert.deepStrictEqual(L[0].domain, [0, 10]);
  assert.deepStrictEqual(L[1].items.map(i => i.label), ['Mill', 'Farm', 'No data']);
  assert.deepStrictEqual(L[2].items.map(i => i.label), ['Safe', 'Burning']);
  assert.ok(!JSON.stringify(L).toLowerCase().includes('retrofit'));
});
test('with no mapping the four states set the scene, with the labels the page was given', () => {
  const sim = mkSim(), states = [{ key: 'to_do', label: 'Susceptible' }, { key: 'queued', label: 'Exposed' }, { key: 'in_progress', label: 'Infectious' }, { key: 'finished', label: 'Recovered' }];
  const r = R.create(sim, { weeks: [{ codes: [0, 1, 2, 3], investor: [0, 0, 0, 1] }, { codes: [3, 3, 3, 3], investor: [0, 0, 0, 0] }], mapping: [], states });
  r.setWeek(0);
  assert.deepStrictEqual([0, 1, 2, 3].map(k => r.entityOf(k).src.state), ['to_do', 'queued', 'in_progress', 'finished']);
  assert.strictEqual(r.entityOf(3).src.investor, true);
  r.setWeek(1); assert.strictEqual(r.entityOf(0).src.state, 'finished'); assert.strictEqual(r.entityOf(3).src.investor, false);
  assert.deepStrictEqual(r.legend()[0].items.map(i => i.label), ['Susceptible', 'Exposed', 'Infectious', 'Recovered']);
});
test('advance moves the week at the set speed and stops at the end', () => {
  const sim = mkSim(), r = R.create(sim, { weeks: [{}, {}, {}], mapping: [], states: [] });
  r.playing = true; r.speed = 2; r.advance(0.5); assert.strictEqual(r.week, 1); r.advance(5); assert.strictEqual(r.week, 2); assert.strictEqual(r.playing, false);
});
test('model buildings take the scene buildings nearest its centre, in a stable order, and the rest are extras', () => {
  const scene = V.makePlaceholderScene(7), P = R.place(scene, 60), cx = scene.buildings.reduce((a, b) => a + b.footprint[0][0], 0) / scene.buildings.length;
  assert.strictEqual(P.ok, true); assert.strictEqual(P.assigned, 60); assert.strictEqual(P.extra, scene.buildings.length - 60);
  assert.strictEqual(new Set(Array.from(P.order)).size, scene.buildings.length);                          // a permutation: every building exactly once
  const d = i => { const f = scene.buildings[i].footprint[0]; return Math.hypot(f[0] - cx, f[1] - scene.buildings.reduce((a, b) => a + b.footprint[0][1], 0) / scene.buildings.length); };
  assert.ok(d(P.order[0]) <= d(P.order[59]) && d(P.order[59]) <= d(P.order[200]), 'nearer the centre comes first');
  assert.deepStrictEqual(Array.from(R.place(scene, 60).order), Array.from(P.order));                      // the same every time
});
test('a scene with fewer buildings than the model is refused with both numbers', () => {
  const scene = { roads: [], landuse: [], trees: [], buildings: [{ id: 1, footprint: [[0, 0], [5, 0], [5, 5], [0, 5]], levels: 2 }] }, P = R.place(scene, 3);
  assert.strictEqual(P.ok, false); assert.ok(/model has 3 buildings, scene has 1/.test(P.error), P.error);
});
test('create reports the refusal and draws nothing from the model', () => {
  const sim = V.createSim({ roads: [], landuse: [], trees: [], buildings: [{ id: 1, footprint: [[0, 0], [8, 0], [8, 8], [0, 8]], levels: 2 }] }, { seed: 5, theme: A.theme(fam, undefined, 'colorfigures'), region: 'nw' });
  const r = R.create(sim, { weeks: [{ vars: { 'building.wealth': [1, 2, 3] } }], mapping: [WEALTH], n: 3 });
  assert.ok(/model has 3 buildings, scene has 1/.test(r.error)); assert.strictEqual(sim.buildingStyle, null);
});
if (failed) { console.log(failed + ' failed'); process.exit(1); } else console.log('all passed');
