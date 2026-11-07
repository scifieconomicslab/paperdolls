/* Level of detail of the outline and halo channels (declutter): per-building highlights only where a building is big enough, an aggregate on the ground below.
 * Run: node viz/test_declutter.js. Pixel assertions need the node 'canvas' package (NODE_CANVAS, or on the module path) and skip themselves without it. */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const g = { console, Math, Object, Map, WeakMap, Array, Infinity, JSON, Set, Date, Number, String, Promise, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, Uint8Array, ArrayBuffer, performance, setTimeout, clearTimeout }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js', 'packvalidate.js', 'packruntime.js', 'packstore.js', 'replay.js', 'packhost.js', 'packpick.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g, { filename: f });
const A = g.AssetLib, V = g.VizLib, PackHost = g.PackHost, PStore = g.PackStore, root = path.resolve(__dirname, '..');
const pal = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'palettes.json'), 'utf8'));
let createCanvas = null; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { /* no canvas */ }
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); process.exitCode = 1; } }
function skip(name, why) { console.log('SKIP ' + name + ' (' + why + ')'); }

const scene = V.makePlaceholderScene(7), N = scene.buildings.length, RED = '#c0392b';
const mkSim = () => V.createSim(scene, { seed: 5, trafficScale: 1, peopleScale: 1, theme: A.theme(pal.families.find(f => f.id === 'nw'), undefined, 'colorfigures'), region: 'nw', buildMs: Infinity, layerMs: Infinity, prewarmMs: Infinity });
// A Jette-like case: most buildings cannot pay (the flag), the wall shows the retrofit state (a third retrofitted).
const manifest = lod => ({
  spec: 1, id: 'declutter', title: 'Declutter', runtime: { type: 'js', entry: 'r.js' }, time: { unit: 'year', steps: 2, speeds: [1], speed: 1 }, params: {},
  entities: { b: { count: N, fields: { state: { type: 'category', values: ['no', 'part', 'all'] }, cannot: 'boolean' } } },
  mappings: [
    { entity: 'b', field: 'state', channel: 'wall', colour: 'wall+roof', scale: { type: 'categorical', label: 'State', values: { no: { colour: '#c9c2b0', label: 'No' }, part: { colour: '#e0a030', label: 'Some' }, all: { colour: '#2e9d6a', label: 'All' } } } },
    Object.assign({ entity: 'b', field: 'cannot', channel: 'outline', scale: { type: 'categorical', label: 'Cannot pay now', values: { true: { colour: RED, label: 'Cannot' }, false: { colour: null, label: 'Can' } } } }, lod === undefined ? {} : { lod }),
  ],
});
const frames = () => { const state = Int8Array.from({ length: N }, (_, i) => i % 3), cannot = Float32Array.from({ length: N }, (_, i) => (i % 5 === 4 ? 0 : 1)); return [{ t: 0, entities: { b: { state, cannot } }, series: {} }]; };
function bind(lod) {
  const m = manifest(lod), store = PStore.create(m), sim = mkSim(); store.pushFrames(frames(), { replace: true });
  const b = PackHost.bindRenderer({ manifest: m, store, controller: { wall: 0 }, sim }); assert(b.ok, b.error); return { m, store, sim, b };
}
const viewAt = (sim, scale, w, h) => { const bd = V.sceneBounds(sim.scene), cx = (bd[0] + bd[2]) / 2, cy = (bd[1] + bd[3]) / 2; return { w, h, scale, ox: w / 2 - (cx - cy) * scale * 0.8660254, oy: h / 2 - (cx + cy) * scale * 0.5 }; };

// ---- the rules, without pixels ----
test('lod: the default is aggregate below 1.2 px per metre; far show is every zoom; hide draws no marks', () => {
  let { b, sim } = bind(); let l = b.lod().outline; assert.strictEqual(l.far, 'aggregate'); assert.strictEqual(l.minScale, 1.2); assert(sim.groundMarks, 'marks are offered'); b.dispose();
  ({ b, sim } = bind({ far: 'show' })); assert.strictEqual(b.lod().outline.minScale, 0); assert(!sim.groundMarks, 'nothing to aggregate when every zoom is drawn'); b.dispose();
  ({ b, sim } = bind({ far: 'hide', min_scale: 2 })); assert.strictEqual(b.lod().outline.minScale, 2); assert(!sim.groundMarks); b.dispose();
});
test('lod: the aggregate is the share of the model buildings per ground cell that carry the flag, in the flag colour', () => {
  const { b, sim } = bind({ cell: 100 }), h = b.highlights(); assert(h.marks.length > 0);
  let flagged = 0; for (const mk of h.marks) { assert(mk.share > 0 && mk.share <= 1); assert.strictEqual(mk.colour, RED); assert.strictEqual(mk.kind, 'outline'); flagged += mk.flagged; }
  assert.strictEqual(flagged, h.outline[0].idx.length, 'every flagged building is in one cell');
  assert.strictEqual(sim.groundMarks.cells(0, { scale: 5 }).length, 0, 'no marks once buildings are drawn on their own'); assert.strictEqual(sim.groundMarks.cells(0, { scale: 0.4 }).length, h.marks.length);
  b.dispose();
});

if (!createCanvas) skip('declutter pixels', 'canvas is not installed');
else {
  A.sprites.factory = (w, h) => createCanvas(w, h);
  const W = 900, H = 600, LAYERS = { buildings: true, vehicles: false, people: false, trees: false };
  // Render the map and the highlight canvas above it, as the page does. Returns the composite and the render of the buildings alone, without any highlight.
  function shoot(lod, scale, extra) {
    const { sim, b, store } = bind(lod), view = viewAt(sim, scale, W, H), map = createCanvas(W, H).getContext('2d'), top = createCanvas(W, H).getContext('2d');
    for (let i = 0; i < 40; i++) V.renderFrame(map, sim, view, LAYERS);
    const base = map.getImageData(0, 0, W, H).data; b.drawChannels(top, view); if (extra) extra(top, view, b);
    const hat = (() => { const ts = sim.groundMarks; return ts; })();
    const comp = createCanvas(W, H).getContext('2d'); comp.drawImage(map.canvas, 0, 0); comp.drawImage(top.canvas, 0, 0);
    // buildings alone: the same render with no highlight at all
    const sim0 = mkSim(), m0 = manifest(); m0.mappings.pop(); const st0 = PStore.create(m0); st0.pushFrames(frames(), { replace: true });
    const b0 = PackHost.bindRenderer({ manifest: m0, store: st0, controller: { wall: 0 }, sim: sim0 }), m0c = createCanvas(W, H).getContext('2d'); for (let i = 0; i < 40; i++) V.renderFrame(m0c, sim0, view, LAYERS);
    const clean = m0c.getImageData(0, 0, W, H).data, bare = createCanvas(W, H).getContext('2d'); const rawBg = (() => { const c = createCanvas(W, H).getContext('2d'); const s2 = mkSim(); s2.buildings.length = 0; V.renderFrame(c, s2, view, LAYERS); return c.getImageData(0, 0, W, H).data; })();
    b.dispose(); b0.dispose();
    return { comp: comp.getImageData(0, 0, W, H).data, clean, rawBg, withMap: base, sim, hasMarks: !!hat };
  }
  const STATE = ['#c9c2b0', '#e0a030', '#2e9d6a'].map(h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)));
  const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 24;
  // building pixels: where the render with buildings differs from the render with none. covered: those of them that the highlight changed.
  function stats(sh) {
    const isBld = i => STATE.some(c => Math.abs(sh.clean[i] - c[0]) + Math.abs(sh.clean[i + 1] - c[1]) + Math.abs(sh.clean[i + 2] - c[2]) < 30) && Math.abs(sh.clean[i] - sh.rawBg[i]) + Math.abs(sh.clean[i + 1] - sh.rawBg[i + 1]) + Math.abs(sh.clean[i + 2] - sh.rawBg[i + 2]) > 12;   // a roof (or lit wall) in the colour of its retrofit state, not the ground
    const changed = i => Math.abs(sh.comp[i] - sh.clean[i]) + Math.abs(sh.comp[i + 1] - sh.clean[i + 1]) + Math.abs(sh.comp[i + 2] - sh.clean[i + 2]) > 30;
    let bld = 0, covered = 0, hatchPx = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = (y * W + x) * 4;
      if (isBld(i) && isBld(i - 4) && isBld(i + 4) && isBld(i - W * 4) && isBld(i + W * 4)) { bld++; if (changed(i)) covered++; }      // interior pixels only: the antialiased rim is not counted
      else if (!isBld(i) && changed(i)) hatchPx++;
    }
    return { bld, covered, hatchPx, fraction: covered / Math.max(1, bld) };
  }
  // the colour of the building pixels is the retrofit state's, untouched, where no outline was drawn
  test('declutter far: by default the flag covers few building pixels (a hairline ring per cell) and shows as a hatch on the ground; show is the old per-building outline', () => {
    const def = shoot(undefined, 0.5), old = shoot({ far: 'show' }, 0.5), sd = stats(def), so = stats(old);
    assert(sd.bld > 400, 'there are buildings to cover: ' + sd.bld);
    assert(so.fraction > 0.04, 'the old far outline covers a lot of building pixels: ' + so.fraction.toFixed(3));
    assert(sd.fraction < 0.08, 'far, building pixels covered by the flag: ' + sd.fraction.toFixed(4) + ' (show: ' + so.fraction.toFixed(3) + ')');
    assert(sd.fraction * 8 < so.fraction, 'at least eight times fewer (only the hairline ring of a cell reaches a roof; the old outline covers ' + so.fraction.toFixed(3) + ')');
  });
  test('declutter far: the hatch is on the ground in the flag colour (the aggregate is visible where the flagged buildings are)', () => {
    const def = shoot(undefined, 0.5), none = shoot({ far: 'hide' }, 0.5);
    const redish = d => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] < 110 && d[i + 2] < 100 && d[i] - d[i + 1] > 70) n++; return n; };
    const hatched = redish(def.comp) - redish(none.comp); assert(hatched > 150, 'red hatch pixels: ' + hatched);
    assert(hatched < 0.08 * W * H, 'a subtle hatch, not a flood: ' + hatched);
  });
  test('declutter mid: below min_scale it is still aggregate; hide draws nothing on buildings or ground', () => {
    const mid = stats(shoot(undefined, 0.9)); assert(mid.fraction < 0.08, 'mid: ' + mid.fraction);
    const hid = stats(shoot({ far: 'hide' }, 0.5)); assert.strictEqual(hid.covered, 0, 'hide: no building pixel changes'); assert.strictEqual(hid.hatchPx, 0, 'hide: no ground pixel changes');
  });
  test('declutter near: from min_scale up the outlines are exactly what they were, whatever far says', () => {
    const a = shoot(undefined, 6), b = shoot({ far: 'show' }, 6), c = shoot({ far: 'hide' }, 6), sa = stats(a);
    assert(sa.covered > 200, 'outlines near: ' + sa.covered); assert.deepStrictEqual(stats(b), sa, 'show equals default near'); assert.deepStrictEqual(stats(c), sa, 'hide equals default near');
    let diff = 0; for (let i = 0; i < a.comp.length; i++) if (a.comp[i] !== b.comp[i]) diff++; assert.strictEqual(diff, 0, 'pixel for pixel');
  });
  test('declutter: the selection and hover halo is drawn at every zoom (it is not part of the level of detail)', () => {
    const m = manifest(), isBlue = (r, gg, bb) => bb > 150 && r < 80 && gg < 120;
    for (const scale of [0.3, 0.5, 0.9, 2, 6]) {
      const { sim, store, b } = bind(), view = viewAt(sim, scale, W, H), top = createCanvas(W, H).getContext('2d'), listeners = {};
      const fake = { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
      const inter = PackHost.bindInteraction({ manifest: m, store, sim, binding: b, pick: g.Pick.create(sim), box: fake, camera: { view: () => view }, doc: fake, tip: null });
      store.select({ entity: 'b', id: 7 }); inter.drawHighlight(top, view); const d = top.getImageData(0, 0, W, H).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40 && isBlue(d[i], d[i + 1], d[i + 2])) n++;
      assert(n > 4, 'selection at scale ' + scale + ': ' + n); inter.dispose(); b.dispose();
    }
  });
}

// ---- validator ----
test('lod: the validator accepts the three modes and refuses nonsense', () => {
  const ok = lod => { const m = manifest(lod), r = g.PackSpec.validate(m); return r.errors; };
  assert.strictEqual(ok({ min_scale: 1.5, far: 'aggregate', cell: 80 }).length, 0); assert.strictEqual(ok({ far: 'hide' }).length, 0); assert.strictEqual(ok({ far: 'show' }).length, 0);
  assert(ok({ far: 'blur' }).some(e => /lod\.far/.test(e))); assert(ok({ min_scale: -1 }).some(e => /lod\.min_scale/.test(e))); assert(ok({ cell: 5 }).some(e => /lod\.cell/.test(e))); assert(ok({ nope: 1 }).some(e => /lod\.nope/.test(e)));
  const m = manifest(); m.mappings[0].lod = { far: 'hide' }; assert(g.PackSpec.validate(m).errors.some(e => /lod/.test(e)), 'a wall mapping has no lod');
});

console.log(passed + ' passed' + (process.exitCode ? ', with failures' : ''));
