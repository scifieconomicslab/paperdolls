// Repros for the bindScene flow (viz/packruntime.js bindScene) with the toy pack's runtime as the implementation.
// Run: PAPERDOLLS_NODE_MODULES=... node docs/state-machines/repro/bindscene_repro.js
// Prints one line per case: B0x REPRODUCED / REFUTED and the evidence. No DOM and no network needed.
const fs = require('fs'), path = require('path'), vm = require('vm');
const viz = path.join(__dirname, '..', '..', '..', 'viz'), pack = path.join(__dirname, '..', '..', '..', 'packs', 'toy-epidemic');
const PR = require(path.join(viz, 'packruntime.js'));
const yaml = null;
// the toy runtime registers itself on PaperDolls; load it in a context that shares PackRuntime
const ctx = { PackRuntime: PR, PaperDolls: globalThis.PaperDolls, console, Math, Object, Array, Map, Set, Int32Array, Float64Array, Float32Array, Int8Array, Uint8Array, Number, JSON, String, Error, Date, isFinite, isNaN, Infinity, NaN };
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(pack, 'runtime.js'), 'utf8'), ctx);
const impl = (ctx.PaperDolls || globalThis.PaperDolls).runtimes['toy-epidemic'];
const manifest = { entities: { building: { count: 600, from: 'scene', fields: { state: { type: 'category', values: ['S', 'E', 'I', 'R'] }, exposure: 'number' } } } };
const bld = (id, extra) => Object.assign({ id, footprint: [[0, 0], [5, 0], [5, 5]], levels: 2, archetype: 'villa', state: 'none', investor: false, area: 12, residential: 'residential', levels_assumed: false }, extra || {});
const show = (tag, hit, ev) => console.log(tag + ' ' + (hit ? 'REPRODUCED' : 'REFUTED') + ': ' + ev);

// B01 duplicate scene ids: the second building with the same id is never drawn, and the first one's neighbours are overwritten. No warning anywhere.
{
  const scene = { buildings: [bld('w1'), bld('w1'), bld('w2')] };
  const r = PR.bindScene(manifest, impl, scene);
  const p = Array.from(r.pos.building);
  show('B01 duplicate scene ids', r.ok && p.join() === '0,-1,2' || p.join() === '0,0,2', 'entity->scene index = [' + p + '] warnings=' + JSON.stringify(r.warnings) + ' (3 residential buildings in the scene, 3 entities; the entity for the 2nd w1 has pos ' + p[1] + ')');
}
// B02 id type mismatch: scene ids are strings ("w1"); a runtime that returns numbers (or the other way round) binds nothing, only a warning.
{
  const scene = { buildings: [bld(1), bld(2)] };
  const impl2 = { init() {}, step() {}, bindScene: () => ({ entities: { building: { count: 2 } }, sceneIndex: { building: ['1', '2'] } }) };
  const r = PR.bindScene(manifest, impl2, scene);
  show('B02 "1" vs 1', r.ok && Array.from(r.pos.building).every(v => v === -1), 'pos=' + Array.from(r.pos.building) + ' ok=' + r.ok + ' warnings=' + JSON.stringify(r.warnings));
}
// B03 an entity the manifest declares `from: scene` that bindScene does not return: no pos, no count; ok:true, bound:true, no warning.
{
  const impl3 = { init() {}, step() {}, bindScene: () => ({ entities: {}, sceneIndex: {} }) };
  const r = PR.bindScene(manifest, impl3, { buildings: [bld('w1')] });
  show('B03 entity omitted by bindScene', r.ok && r.bound && !('building' in r.pos) && r.warnings.length === 0, 'ok=' + r.ok + ' bound=' + r.bound + ' counts=' + JSON.stringify(r.counts) + ' pos keys=' + Object.keys(r.pos) + ' warnings=' + r.warnings.length + ' (packhost.bindRenderer then falls back to the invented placement because bound.pos[en] is undefined)');
}
// B04 scene with zero buildings: the toy bindScene throws; PackRuntime turns it into ok:false. A scene with buildings but none residential is the same.
{
  const r0 = PR.bindScene(manifest, impl, { buildings: [] });
  const r1 = PR.bindScene(manifest, impl, { buildings: [bld('w1', { residential: 'other' })] });
  show('B04 no residential building', !r0.ok && !r1.ok, 'empty scene -> ok=' + r0.ok + ' "' + r0.error + '"; all other -> ok=' + r1.ok + ' "' + r1.error + '" (the page must show this, see sm-runtime)');
}
// B05 neighbours naming ids the scene does not have, or itself, or duplicates: filtered silently, kept as given otherwise
{
  const scene = { buildings: [bld('w1', { neighbours: ['w2', 'ghost', 'w1', 'w2'] }), bld('w2', { neighbours: ['w1'] })] };
  const b = impl.bindScene(scene);
  show('B05 dirty neighbours', JSON.stringify(b.entities.building.attrs.neighbours) !== '[[1],[0]]', 'attrs.neighbours=' + JSON.stringify(b.entities.building.attrs.neighbours) + ' (self link and the repeated w2 survive; the unknown id is dropped)');
}
// B06 building ids that are missing (null/undefined) are addressed "#<index>", two buildings with id null never collide; id 0 and "0"
{
  const scene = { buildings: [bld(null), bld(undefined), bld(0), bld('0')] };
  const r = PR.bindScene(manifest, impl, scene);
  show('B06 missing / falsy ids', Array.from(r.pos.building).join() !== '0,1,2,3', 'pos=' + Array.from(r.pos.building) + ' keys=' + JSON.stringify(scene.buildings.map(PR.sceneKey)) + ' warnings=' + JSON.stringify(r.warnings));
}
// B07 entity count larger than the residential buildings is impossible through the toy bindScene (count = residential count) but allowed for any other runtime: extra entities have -1.
{
  const impl7 = { init() {}, step() {}, bindScene: s => ({ entities: { building: { count: 5 } }, sceneIndex: { building: ['w1', 'w2', null, undefined, 'nope'] } }) };
  const r = PR.bindScene(manifest, impl7, { buildings: [bld('w1'), bld('w2')] });
  show('B07 count above buildings', Array.from(r.pos.building).join() === '0,1,-1,-1,-1', 'pos=' + Array.from(r.pos.building) + ' warnings=' + JSON.stringify(r.warnings) + ' (only the unknown id warns; null/undefined are silent by design)');
}
// B08 a building with NaN / non-finite footprint coordinates, or fewer than 3 points, is bound like any other: bindScene does not look at geometry (the toy computes area from the footprint when `area` is missing)
{
  const bad = bld('w1', { area: undefined, footprint: [[NaN, 0], [1, Infinity]] });
  const b = impl.bindScene({ buildings: [bad] });
  show('B08 bad geometry reaches the model', Number.isNaN(b.entities.building.attrs.area[0]), 'attrs.area=' + JSON.stringify(b.entities.building.attrs.area) + ' (NaN area; the model derives units/hub from it)');
}
