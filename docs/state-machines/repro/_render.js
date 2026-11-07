/* Shared helper for the rendering-engine repros (part 30). Loads the REAL viz/*.js into a vm context with node-canvas, and makes the clock deterministic.
 *
 *  - clock: `performance.now()` inside the engine is replaced by a counter that advances `step` ms per call (default 0.25), so every time budget in the engine
 *    (layerMs, buildMs, prewarmMs, COARSE_MS) is "so many clock reads", identical on every run and machine. `R.clock.set(step)` changes it; 0 freezes it.
 *  - canvas census: `R.tally` counts getImageData / putImageData / drawImage(canvas) / canvases created, per phase. `R.census(fn)` runs fn and returns the counts.
 *  - no sleeps, no rAF: callers drive renderFrame themselves, one call = one frame.
 * Needs node-canvas: PAPERDOLLS_NODE_MODULES=<node_modules dir> (or NODE_CANVAS=<path to canvas>). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..', '..'), VIZ = path.join(ROOT, 'viz');
let createCanvas;
try { createCanvas = require(process.env.NODE_CANVAS || path.join(process.env.PAPERDOLLS_NODE_MODULES || 'node_modules', 'canvas')).createCanvas; }
catch (e) { console.log('SKIP (node-canvas not found; set PAPERDOLLS_NODE_MODULES)'); process.exit(0); }

const clock = { t: 0, step: 0.25, calls: 0, set(s) { this.step = s; }, now() { this.calls++; this.t += this.step; return this.t; } };
const g = { console, Math, Object, Map, WeakMap, Array, Infinity, JSON, Set, Date, Number, String, Promise, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, Uint8Array, Uint32Array, ArrayBuffer, isFinite, isNaN, parseInt, parseFloat, Error, TypeError, performance: { now: () => clock.now() }, setTimeout, clearTimeout };
g.globalThis = g; vm.createContext(g);
const load = f => vm.runInContext(fs.readFileSync(path.join(VIZ, f), 'utf8'), g, { filename: f });
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js', 'replay.js', 'packvalidate.js', 'packruntime.js', 'packstore.js', 'packhost.js', 'packpick.js', 'camera.js', 'zoomhold.js', 'refocus.js']) load(f);
const A = g.AssetLib, V = g.VizLib;

// ---- canvas census ----
const tally = { created: 0, createdPx: 0, getImageData: 0, putImageData: 0, drawCanvas: 0, drawCanvasPx: 0, readPx: 0, byRole: {} };
const reset = () => { for (const k of Object.keys(tally)) tally[k] = k === 'byRole' ? {} : 0; };
let viewPx = 0;                                           // area of the view in device px: a canvas source bigger than this is a "layer", else a "sprite"
function wrap(cv) {
  const orig = cv.getContext.bind(cv);
  cv.getContext = (...a) => {
    const ctx = orig(...a); if (!ctx || ctx.__w) return ctx;
    const gi = ctx.getImageData.bind(ctx), pi = ctx.putImageData.bind(ctx), di = ctx.drawImage.bind(ctx);
    ctx.getImageData = (x, y, w, h) => { tally.getImageData++; tally.readPx += w * h; return gi(x, y, w, h); };
    ctx.putImageData = (...b) => { tally.putImageData++; return pi(...b); };
    ctx.drawImage = (src, ...b) => {
      if (src && typeof src.getContext === 'function') {
        const px = src.width * src.height, role = px > viewPx ? 'layer' : 'sprite'; tally.drawCanvas++; tally.drawCanvasPx += px;
        const r = tally.byRole[role] || (tally.byRole[role] = { n: 0, px: 0 }); r.n++; r.px += px;
      }
      return di(src, ...b);
    };
    ctx.__w = true; return ctx;
  };
  return cv;
}
A.sprites.factory = (w, h) => { tally.created++; tally.createdPx += w * h; return wrap(createCanvas(w, h)); };
const snap = () => JSON.parse(JSON.stringify(tally));
function census(fn, view) { reset(); if (view) viewPx = view.w * view.h * (A.sprites.dpr || 1) ** 2; fn(); return snap(); }

const pal = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'palettes.json'), 'utf8'));
const fam = id => pal.families.find(f => f.id === (id || 'nw'));
const theme = (id, look, reg) => A.theme(fam(id), look, reg || 'colorfigures');
function tiled(tiles) {                                   // the placeholder scene repeated: 9 tiles ~ the 9,214 buildings of the Jette commune (viz/far_bench.js)
  const base = V.makePlaceholderScene(7), B = V.sceneBounds(base), w = B[2] - B[0] + 40, h = B[3] - B[1] + 40, out = { area: base.area, roads: [], buildings: [], landuse: [], trees: [] };
  const sh = (p, dx, dy) => [p[0] + dx, p[1] + dy];
  for (let t = 0; t < tiles; t++) {
    const dx = (t % 3) * w, dy = Math.floor(t / 3) * h, tag = '#' + t;
    for (const r of base.roads) out.roads.push(Object.assign({}, r, { id: r.id + tag, pts: r.pts.map(p => sh(p, dx, dy)) }));
    for (const b of base.buildings) out.buildings.push(Object.assign({}, b, { id: b.id + tag, footprint: b.footprint.map(p => sh(p, dx, dy)) }));
    for (const l of base.landuse) out.landuse.push(Object.assign({}, l, { id: l.id + tag, footprint: l.footprint.map(p => sh(p, dx, dy)) }));
    for (const r of base.trees) out.trees.push([r[0] + dx, r[1] + dy].concat(r.slice(2)));
  }
  return out;
}
const C30 = 0.8660254;
const fitView = (scene, W, H) => { const B = V.sceneBounds(scene), k = Math.max(1e-4, Math.min(W * 0.94 / ((B[2] - B[0] + B[3] - B[1]) * C30 + 1), H * 0.94 / ((B[2] - B[0] + B[3] - B[1]) * 0.5 + 1))), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2; return { w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * C30, oy: H / 2 - (cx + cy) * k * 0.5 }; };
const viewAt = (scene, k, W, H) => { const B = V.sceneBounds(scene), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2; return { w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * C30, oy: H / 2 - (cx + cy) * k * 0.5 }; };
const mkSim = (scene, opts) => V.createSim(scene, Object.assign({ seed: 11, theme: theme(), region: 'nw' }, opts || {}));
const ctx2d = (W, H) => wrap(createCanvas(W, H)).getContext('2d');
const resetSprites = () => { A.sprites.cache.clear(); A.sprites.index.clear(); A.sprites.pixels = 0; A.sprites.dpr = 1; };
module.exports = { g, A, V, clock, tally, census, reset, createCanvas, wrap, ctx2d, theme, fam, pal, tiled, fitView, viewAt, mkSim, resetSprites, ROOT, VIZ, C30,
                   setViewPx: (w, h) => { viewPx = w * h * (A.sprites.dpr || 1) ** 2; } };
