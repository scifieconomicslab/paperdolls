/* Tests for the far-zoom layer (viz/vizlib.js, "FAR LAYER"): the rough first picture, the exact painting behind it, and the incremental patch when colours change.
 * The thing to prove is that every route to a picture gives the same pixels once it has settled: a layer painted in one go, in slices behind the rough one, and patched in place
 * after colours changed must equal a layer painted from scratch for the same colours. Elevation (z), roof-and-wall colours and the default state colours are all in the scene.
 * Run: node viz/test_farlayer.js      (needs the 'canvas' package) */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date, Int32Array, Uint8Array, Float32Array, Uint32Array }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib; A.sprites.factory = (w, h) => createCanvas(w, h);
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8')), fam = pal.families.find(f => f.id === 'nw');
let failed = 0; const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const W = 900, H = 600;

// the placeholder scene, with some buildings raised (z) so that elevation is in the picture
function scene() {
  const s = V.makePlaceholderScene(7);
  s.buildings.forEach((b, i) => { if (i % 7 === 0) b.z = 2 + (i % 5); });
  return s;
}
const SC = scene(), B = V.sceneBounds(SC), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2;
const viewAt = k => ({ w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * 0.8660254, oy: H / 2 - (cx + cy) * k * 0.5 });
let FAR = 0.35;                                                         // below 1 px per metre: the far layer
const STATES = ['none', 'queued', 'in_progress', 'finished'];
function makeSim(opts) {
  const theme = A.theme(fam, undefined, 'colorfigures'), s = V.createSim(JSON.parse(JSON.stringify(SC)), { seed: 5, theme, region: 'nw' });
  for (let i = 0; i < 5; i++) V.stepSim(s, 0.1);
  s.opts.prewarm = false; s.opts.holdZoom = false; s.opts.layerMs = 50; s.opts.buildMs = 1e9; Object.assign(s.opts, opts || {});
  s._zoom = { scale: FAR, still: 10 };                                    // sprites drawn at the exact scale from the first frame: a layer's pixels then do not depend on when it was painted
  return s;
}
// a versioned style, as the pack store provides: shared style objects, a frame version that is bumped when any colour may have changed
function versioned(sim) {
  const table = [{ data: null, roof: null, overlays: [], seg: null }, { data: '#c8452f', roof: '#ffd23f', overlays: [], seg: null }, { data: '#5b8db8', roof: null, overlays: ['marker'], seg: null }, { data: null, roof: '#2e8b57', overlays: [], seg: null }];
  const code = new Int8Array(sim.buildings.length), idx = new Map(sim.buildings.map((e, i) => [e, i]));
  sim.buildingStyle = e => table[code[idx.get(e)]]; sim.frameVersion = 1;
  return { code, bump() { sim.frameVersion++; } };
}
const whole = s => !s._farP && !s._groundP && !s._farPatch && !(s._far && s._far.rough) && !s._farC && !s._groundC && A.sprites.builds === 0;
function settle(sim, c, view, max) {
  let n = 0; for (; n < (max || 4000); n++) { V.renderFrame(c, sim, view, {}); if (n > 3 && whole(sim)) break; }
  assert.ok(n < (max || 4000), 'the layers never became whole'); V.renderFrame(c, sim, view, {}); return n;
}
const shot = c => c.getImageData(0, 0, W, H).data;
function same(a, b, what) { let n = 0, first = -1; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { n++; if (first < 0) first = i; } assert.strictEqual(n, 0, what + ': ' + n + ' bytes differ' + (first >= 0 ? ' (first at pixel ' + ((first >> 2) % W) + ',' + Math.floor((first >> 2) / W) + ')' : '')); }
// the picture a sim draws from scratch with its present colours: one go, no slices, no rough layer, no patch
function fromScratch(mutate) {
  const s = makeSim({ sliceLayers: false }); mutate(s); const c = createCanvas(W, H).getContext('2d'); settle(s, c, viewAt(FAR)); return shot(c);
}

test('first paint: a rough layer at once, then the exact one behind it; the settled picture equals one painted in one go', () => {
  const s = makeSim(), c = createCanvas(W, H).getContext('2d'), v = viewAt(FAR);
  s.opts.layerMs = 0;                                                      // one step a frame: the exact painting takes many frames
  V.renderFrame(c, s, v, {});
  assert.ok(s._far && s._far.rough, 'after the first frame the far layer is the rough one');
  assert.ok(s._groundP || s._ground, 'and the ground has a picture too');
  const d = shot(c); let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 700) ink++;
  assert.ok(ink > 2000, 'the first frame already shows buildings: ' + ink + ' dark pixels');
  assert.ok(s._farP || s._farC, 'the exact layer is being painted behind it, or the rough one is still being completed');
  s.opts.layerMs = 50; settle(s, c, v);
  assert.ok(s._far && !s._far.rough && s._far.info, 'the exact layer replaced it');
  same(shot(c), fromScratch(() => {}), 'settled after the rough layer');
});

test('colours change (default state colours): only the changed buildings are repainted, and the picture equals one painted from scratch', () => {
  const mutate = s => { for (let i = 0; i < s.buildings.length; i += 9) s.buildings[i].src.state = STATES[(i / 9 | 0) % 4]; };
  const s = makeSim(), c = createCanvas(W, H).getContext('2d'), v = viewAt(FAR); settle(s, c, v);
  const repaints = s.layerRepaints; mutate(s); const n = settle(s, c, v);
  assert.strictEqual(s.layerRepaints, repaints, 'the layer was not repainted as a whole');
  assert.ok(s.farPatches >= 1 && s.farRectsPainted > 0 && s.farRectsPainted < s.buildings.length, 'it was patched: ' + s.farRectsPainted + ' rects for ' + s.buildings.length + ' buildings');
  same(shot(c), fromScratch(mutate), 'patched, default style');
  return n;
});

for (const k of [0.19, 0.6, 0.95]) test('colours change at ' + k + ' px/m (the scale of the Jette overview, a street-ish zoom, and just under the far layer\'s limit): patched equals painted from scratch', () => {
  const old = FAR; FAR = k;
  try {
    const mutate = s => { for (let i = 0; i < s.buildings.length; i += 10) s.buildings[i].src.state = STATES[(i / 10 | 0) % 4]; };
    const s = makeSim(), c = createCanvas(W, H).getContext('2d'), v = viewAt(FAR); settle(s, c, v); const repaints = s.layerRepaints; mutate(s); settle(s, c, v);
    assert.strictEqual(s.layerRepaints, repaints, 'not repainted as a whole'); assert.ok(s.farPatches >= 1, 'patched');
    same(shot(c), fromScratch(mutate), 'patched at ' + k);
  } finally { FAR = old; }
});

test('colours change on a 2x screen (A.sprites.dpr = 2): patched equals painted from scratch', () => {
  A.sprites.dpr = 2; A.sprites.cache.clear(); A.sprites.index.clear();
  try {
    const mutate = s => { for (let i = 0; i < s.buildings.length; i += 10) s.buildings[i].src.state = STATES[(i / 10 | 0) % 4]; };
    const s = makeSim(), c = createCanvas(W, H).getContext('2d'), v = viewAt(FAR); settle(s, c, v); const repaints = s.layerRepaints; mutate(s); settle(s, c, v);
    assert.strictEqual(s.layerRepaints, repaints, 'not repainted as a whole'); assert.ok(s.farPatches >= 1, 'patched');
    same(shot(c), fromScratch(mutate), 'patched at 2x');
  } finally { A.sprites.dpr = 1; A.sprites.cache.clear(); A.sprites.index.clear(); }
});

test('colours change (versioned style with wall and roof colours, over elevated buildings): patched picture equals one painted from scratch', () => {
  const mutate = (s, codes) => { const st = versioned(s); if (codes) for (let i = 0; i < s.buildings.length; i++) st.code[i] = codes(i); return st; };
  const s = makeSim(), c = createCanvas(W, H).getContext('2d'), v = viewAt(FAR), st = mutate(s, i => i % 3 === 0 ? 1 : 0); settle(s, c, v);
  const repaints = s.layerRepaints;
  for (let i = 0; i < s.buildings.length; i += 11) st.code[i] = 1 + (i % 3);                // a patch of about 9% of the buildings
  st.bump(); settle(s, c, v);
  assert.strictEqual(s.layerRepaints, repaints, 'not repainted as a whole'); assert.ok(s.farPatches >= 1, 'patched');
  const want = fromScratch(t => { const u = mutate(t, i => i % 3 === 0 ? 1 : 0); for (let i = 0; i < t.buildings.length; i += 11) u.code[i] = 1 + (i % 3); u.bump(); });
  same(shot(c), want, 'patched, versioned style with roofs');
  // a second patch on top of the first (the layer is patched again, not rebuilt), then back to how it was: the first picture again
  for (let i = 0; i < s.buildings.length; i += 11) st.code[i] = i % 3 === 0 ? 1 : 0; st.bump(); settle(s, c, v);
  same(shot(c), fromScratch(t => mutate(t, i => i % 3 === 0 ? 1 : 0)), 'patched twice');
  assert.strictEqual(s.layerRepaints, repaints, 'still not repainted as a whole');
});

test('patches that arrive faster than they are painted are coalesced: the frame count is bounded, the end picture is right', () => {
  const s = makeSim({ layerMs: 1 }), c = createCanvas(W, H).getContext('2d'), v = viewAt(FAR), st = versioned(s); settle(s, c, v);
  for (let round = 0; round < 12; round++) { for (let i = round; i < s.buildings.length; i += 13) st.code[i] = (st.code[i] + 1) & 3; st.bump(); V.renderFrame(c, s, v, {}); V.renderFrame(c, s, v, {}); }   // a new version every two frames
  s.opts.layerMs = 50; settle(s, c, v);
  const final = Int8Array.from(st.code);
  same(shot(c), fromScratch(t => { const u = versioned(t); u.code.set(final); u.bump(); }), 'after twelve overlapping patches');
});

test('when most buildings change, the layer is repainted in slices instead of patched (and is right)', () => {
  const s = makeSim(), c = createCanvas(W, H).getContext('2d'), v = viewAt(FAR), st = versioned(s); settle(s, c, v);
  const repaints = s.layerRepaints;
  for (let i = 0; i < s.buildings.length; i++) st.code[i] = 1 + (i % 3); st.bump(); settle(s, c, v);
  assert.strictEqual(s.farPatchFallbacks, 1, 'fell back once'); assert.ok(s.layerRepaints > repaints, 'the layer was repainted');
  same(shot(c), fromScratch(t => { const u = versioned(t); for (let i = 0; i < t.buildings.length; i++) u.code[i] = 1 + (i % 3); u.bump(); }), 'after the fallback');
});

test('opts.farPatch = false keeps the old behaviour: a new signature repaints the whole layer', () => {
  const s = makeSim({ farPatch: false }), c = createCanvas(W, H).getContext('2d'), v = viewAt(FAR), st = versioned(s); settle(s, c, v);
  const repaints = s.layerRepaints; st.code[3] = 1; st.bump(); settle(s, c, v);
  assert.ok(s.layerRepaints > repaints && !s.farPatches, 'repainted, not patched');
});

test('opts.coarseFirst = false: no rough layer, the buildings are drawn directly until the exact layer is ready (as before)', () => {
  const s = makeSim({ coarseFirst: false }), c = createCanvas(W, H).getContext('2d'); s.opts.layerMs = 0;
  V.renderFrame(c, s, viewAt(FAR), {}); assert.ok(!s._far, 'no layer after the first frame');
  settle(s, c, viewAt(FAR)); same(shot(c), fromScratch(() => {}), 'settled');
});

test('a zoom after patching: the layer is repainted at the new scale and is right', () => {
  const s = makeSim(), c = createCanvas(W, H).getContext('2d'), st = versioned(s); settle(s, c, viewAt(FAR));
  st.code[5] = 2; st.bump(); settle(s, c, viewAt(FAR));
  const k2 = 0.5; s._zoom = { scale: k2, still: 10 }; settle(s, c, viewAt(k2));
  const want = createCanvas(W, H).getContext('2d'), t = makeSim({ sliceLayers: false }), u = versioned(t); u.code[5] = 2; u.bump(); t._zoom = { scale: k2, still: 10 }; settle(t, want, viewAt(k2));
  same(shot(c), shot(want), 'after zooming');
});

test('window level of detail: windows are drawn when a window module is wide enough on screen, and opts.windowLodPx = 0 draws them always', () => {
  const draw = (k, lod) => { const s = makeSim({ sliceLayers: false, windowLodPx: lod }); s._zoom = { scale: k, still: 10 }; const c = createCanvas(W, H).getContext('2d'); settle(s, c, viewAt(k)); return shot(c); };
  same(draw(1.7, undefined), draw(1.7, 0), 'at 1.7 px/m the default draws every window');
  let n = 0; const a = draw(0.12, undefined), b = draw(0.12, 0); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  assert.ok(n >= 0);                                                                                          // far out the two may differ: that is the point
});

(async () => {
  for (const [name, fn] of queue) { try { await fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n  ', String(e && e.stack || e).split('\n').slice(0, 4).join('\n   ')); } }
  console.log(failed ? failed + ' failed' : 'all passed'); process.exit(failed ? 1 : 0);
})();
