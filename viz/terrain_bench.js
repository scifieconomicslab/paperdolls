/* Measures what terrain costs, and renders comparison images.
 * Usage: node viz/terrain_bench.js            Env: SCENE=path to a scene.json (default: the placeholder tiled 12 times, about 12,300 buildings),
 *   RELIEF=38 metres of synthetic relief, CELL=25 grid cell in metres, FRAMES=15 the sample, IMAGES=dir to write PNGs into (skipped if unset),
 *   VIEWS=0.5,3 the scales (px per metre) timed. Needs the 'canvas' package.
 * Modes: flat (no terrain, as before), shade (grid present, relief 0: shading only, no vertical offset), offset (relief 1: true heights),
 *   x3 (relief 3: heights exaggerated). The terrain is synthetic (terrainlib.js): Jette-like in size, not data. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date, Int32Array, Uint8Array, Float32Array }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js', 'terrainlib.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib, Tr = g.Terrain; A.sprites.factory = (w, h) => createCanvas(w, h);
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8')), fam = pal.families.find(f => f.id === 'nw');
function tiled(tiles) {
  const base = V.makePlaceholderScene(7), B = V.sceneBounds(base), w = B[2] - B[0] + 40, h = B[3] - B[1] + 40, out = { area: base.area, roads: [], buildings: [], landuse: [], trees: [] };
  const sh = (p, dx, dy) => [p[0] + dx, p[1] + dy];
  for (let t = 0; t < tiles; t++) {
    const dx = (t % 4) * w, dy = Math.floor(t / 4) * h, tag = '#' + t;
    for (const r of base.roads) out.roads.push(Object.assign({}, r, { id: r.id + tag, pts: r.pts.map(p => sh(p, dx, dy)) }));
    for (const b of base.buildings) out.buildings.push(Object.assign({}, b, { id: b.id + tag, footprint: b.footprint.map(p => sh(p, dx, dy)) }));
    for (const l of base.landuse) out.landuse.push(Object.assign({}, l, { id: l.id + tag, footprint: l.footprint.map(p => sh(p, dx, dy)) }));
    for (const r of base.trees) out.trees.push([r[0] + dx, r[1] + dy].concat(r.slice(2)));
  }
  return out;
}
const load = () => process.env.SCENE ? JSON.parse(fs.readFileSync(process.env.SCENE, 'utf8')) : tiled(12);
const RELIEF = +(process.env.RELIEF || 38), CELL = +(process.env.CELL || 25), N = +(process.env.FRAMES || 15), W = 1200, H = 700, med = x => x.sort((p, q) => p - q)[x.length >> 1];
const theme = A.theme(fam, undefined, 'colorfigures');
const ALL_MODES = { flat: { terrain: false, relief: 1 }, shade: { terrain: true, relief: 0 }, offset: { terrain: true, relief: 1 }, x3: { terrain: true, relief: 3 }, x6: { terrain: true, relief: 6 } };
const MODES = process.env.MODES ? Object.fromEntries(process.env.MODES.split(',').map(m => [m, ALL_MODES[m]])) : Object.fromEntries(['flat', 'shade', 'offset', 'x3'].map(m => [m, ALL_MODES[m]]));
function build(mode) {
  const scene = load(), B = V.sceneBounds(scene);
  if (MODES[mode].terrain) Tr.attach(scene, Tr.synthetic(B, { cell: CELL, relief: RELIEF }));
  const sim = V.createSim(scene, { seed: 5, theme, region: 'nw', relief: MODES[mode].relief }); for (let i = 0; i < 20; i++) V.stepSim(sim, 0.1);
  return { scene, sim, B };
}
const viewFor = (B, zmax, k, focus) => { const cx = focus ? focus[0] : (B[0] + B[2]) / 2, cy = focus ? focus[1] : (B[1] + B[3]) / 2; return { w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * 0.8660254, oy: H / 2 - (cx + cy) * k * 0.5 + (focus ? (focus[2] || 0) * k : zmax * k / 2) }; };
// a dense part of the scene on a real slope, for the close views: of 400 buildings spread through the scene, the one on the steepest ground with at least 110 neighbours within 120 m
function slopeFocus(scene, T) {
  if (process.env.FOCUS) return process.env.FOCUS.split(',').map(Number);
  const bs = scene.buildings, step = Math.max(1, Math.floor(bs.length / 400)); let best = null;
  const c = b => { const f = b.footprint; return [f.reduce((a, p) => a + p[0], 0) / f.length, f.reduce((a, p) => a + p[1], 0) / f.length]; };
  const cs = bs.map(c);
  for (let i = 0; i < bs.length; i += step) {
    const [x, y] = cs[i]; let n = 0; for (const q of cs) if (Math.abs(q[0] - x) < 120 && Math.abs(q[1] - y) < 120) n++;
    if (n < 110) continue; const gx = (Tr.sample(T, x + 20, y) - Tr.sample(T, x - 20, y)) / 40, gy = (Tr.sample(T, x, y + 20) - Tr.sample(T, x, y - 20)) / 40, sl = Math.hypot(gx, gy);
    if (!best || sl > best.sl) best = { x, y, sl };
  }
  console.log('close views at', best.x.toFixed(0), best.y.toFixed(0), 'slope', (best.sl * 100).toFixed(1) + '%'); return [best.x, best.y];
}
const results = [];
if (process.env.TIMES !== '0') {
  const scales = (process.env.VIEWS || '0.5,3').split(',').map(Number);
  console.log('mode   | px/m | ground layer | first frame | settled | pan  | sprites (all built) | buildings');
  for (const mode of Object.keys(MODES)) for (const k of scales) {
    A.sprites.cache.clear(); A.sprites.pixels = 0; A.sprites.index && A.sprites.index.clear();
    const { sim, B } = build(mode), c = createCanvas(W, H).getContext('2d'), view = viewFor(B, sim.zmax, k);
    const run = v => { const t0 = process.hrtime.bigint(); V.renderFrame(c, sim, v, {}); return Number(process.hrtime.bigint() - t0) / 1e6; };
    const first = run(view); for (let i = 0; i < 100; i++) run(view);
    // the ground layer alone: a fresh sim, the layer painted whole (sliceLayers off), without sprites
    const { sim: s2 } = build(mode); s2.opts.sliceLayers = false; const t0 = process.hrtime.bigint(); V.renderFrame(c, s2, view, { buildings: false, trees: false, vehicles: false, people: false }); const gl = Number(process.hrtime.bigint() - t0) / 1e6;
    // how many distinct sprites the view needs once every one is built (the sprite key has no height in it, so this must not grow with terrain)
    A.sprites.cache.clear(); A.sprites.pixels = 0; { const { sim: s3 } = build(mode); s3.opts.buildMs = 1e9; s3.opts.sliceLayers = false; s3.opts.prewarm = false; for (let i = 0; i < 6; i++) V.renderFrame(c, s3, view, {}); }
    const nSprites = A.sprites.cache.size;
    const still = [], pan = []; for (let i = 0; i < N; i++) still.push(run(view));
    for (let i = 0; i < N; i++) pan.push(run(Object.assign({}, view, { ox: view.ox + 3 * (i + 1), oy: view.oy + 1.5 * (i + 1) })));
    console.log(`${mode.padEnd(6)} | ${String(k).padEnd(4)} | ${gl.toFixed(0).padStart(8)} ms | ${first.toFixed(0).padStart(7)} ms | ${med(still).toFixed(1).padStart(5)} ms | ${med(pan).toFixed(1).padStart(4)} | ${String(nSprites).padStart(8)} | ${sim.buildings.length}`);
  }
}
const dir = process.env.IMAGES; let FOC = null;
if (dir) {
  // For each view, the four modes side by side in one 2 x 2 image (each panel 600 x 350: the middle of the view at 1:1, or the whole view halved for the overview),
  // labelled, saved as JPEG. SHOTS=overview,street,steep (steep: the same hills at 6 times their height, to show where the method breaks).
  fs.mkdirSync(dir, { recursive: true });
  const shots = (process.env.SHOTS || 'overview,street').split(','), shots2 = {}, label = { flat: 'flat (no terrain)', shade: 'relief shading only', offset: 'true heights + shading', x3: 'heights x3 + shading', x6: 'heights x6 + shading' };
  for (const mode of Object.keys(MODES)) {
    const { sim, B } = build(mode);
    for (const shot of shots) {
      if (shot === 'steep' && mode !== 'x6' && mode !== 'flat' && mode !== 'offset') continue;
      A.sprites.cache.clear(); A.sprites.pixels = 0; sim._ground = sim._far = null; sim._zoom = sim._warm = null;
      let view;
      if (shot === 'overview') view = viewFor(B, sim.zmax, +(process.env.OVK || 0.42));
      else { const f = FOC || (FOC = slopeFocus(sim.scene, sim.terrain || Tr.synthetic(B, { cell: CELL, relief: RELIEF }))); view = viewFor(B, sim.zmax, +(process.env[shot.toUpperCase() + 'K'] || (shot === 'mid' ? 1.2 : 3.2)), [f[0], f[1], sim.terrain ? sim.terrain.at(f[0], f[1]) * sim.relief : 0]); }
      const cv = createCanvas(W, H), c = cv.getContext('2d'); sim.opts.sliceLayers = false; sim.opts.buildMs = 1e9;
      for (let i = 0; i < 8; i++) V.renderFrame(c, sim, view, {});
      (shots2[shot] = shots2[shot] || {})[mode] = cv;
    }
  }
  for (const shot of Object.keys(shots2)) {
    const modes = Object.keys(shots2[shot]), cols = 2, rows = Math.ceil(modes.length / cols), out = createCanvas(600 * cols, 350 * rows), o = out.getContext('2d');
    modes.forEach((m, i) => {
      const x = (i % cols) * 600, y = Math.floor(i / cols) * 350, src = shots2[shot][m];
      if (shot === 'overview') o.drawImage(src, 0, 0, W, H, x, y, 600, 350); else o.drawImage(src, 300, 175, 600, 350, x, y, 600, 350);
      o.fillStyle = 'rgba(255,255,255,0.85)'; o.fillRect(x, y, 230, 22); o.fillStyle = '#222'; o.font = '13px sans-serif'; o.fillText(label[m] || m, x + 8, y + 15);
      o.strokeStyle = '#fff'; o.lineWidth = 2; o.strokeRect(x, y, 600, 350);
    });
    fs.writeFileSync(path.join(dir, `terrain-${shot}.jpg`), out.toBuffer('image/jpeg', { quality: 0.88 }));
  }
  console.log('images written to', dir);
}
