/* Times the renderer on a big synthetic scene: the placeholder tiled N times (default 12 tiles, about 12,300 buildings).
 * Usage: node viz/scale_bench.js     Env: TILES=12 (columns of 4), SCALES=0.7,1.7,4 sets px per metre, FRAMES=15 the sample.
 * Reports first frame, settled frame and a panning frame, median of FRAMES, on a 1200 by 700 node-canvas. Needs the 'canvas' package. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date, Int32Array, Uint8Array }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib; A.sprites.factory = (w, h) => createCanvas(w, h);
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
const tiles = +(process.env.TILES || 12), scene = tiled(tiles), theme = A.theme(fam, undefined, 'colorfigures'), N = +(process.env.FRAMES || 15), W = 1200, H = 700;
const B = V.sceneBounds(scene), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2, med = x => x.sort((p, q) => p - q)[x.length >> 1];
const sim = V.createSim(scene, { seed: 5, theme, region: 'nw' }); for (let i = 0; i < 20; i++) V.stepSim(sim, 0.1);
console.log(`scene: ${scene.buildings.length} buildings, ${scene.trees.length} trees, ${sim.agents.length} agents`);
console.log('px/m | first frame | settled | pan');
for (const k of (process.env.SCALES || '0.7,1.7,4').split(',').map(Number)) {
  const view = { w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * 0.8660254, oy: H / 2 - (cx + cy) * k * 0.5 }, c = createCanvas(W, H).getContext('2d');
  const run = v => { const t0 = process.hrtime.bigint(); V.renderFrame(c, sim, v, {}); return Number(process.hrtime.bigint() - t0) / 1e6; };
  const first = run(view); for (let i = 0; i < 80; i++) run(view);
  const still = [], pan = []; for (let i = 0; i < N; i++) still.push(run(view));
  for (let i = 0; i < N; i++) pan.push(run(Object.assign({}, view, { ox: view.ox + 3 * (i + 1), oy: view.oy + 1.5 * (i + 1) })));
  console.log(`${String(k).padEnd(4)} | ${first.toFixed(0).padStart(8)} ms | ${med(still).toFixed(1).padStart(5)} ms | ${med(pan).toFixed(1).padStart(5)} ms`);
}
