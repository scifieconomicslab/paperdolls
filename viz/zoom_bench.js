/* Times a zoom: the view scale glides from FROM to TO px per metre over STEPS frames about the screen centre (like turning the wheel),
 * then holds still. Reports the slowest frames, the median, sprite rebuilds and layer repaints, for several variants.
 * Usage: node viz/zoom_bench.js     Env: TILES=1 (1 = placeholder, 12 = about 12,000 buildings), FROM=1 TO=4 STEPS=60, VARIANTS=default,replay,detail
 * Needs the node 'canvas' package. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
const g = { console, Math, Object, Map, WeakMap, Array, Infinity, JSON, Set, Date, Number, String, Int32Array, Uint8Array }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js', 'replay.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib, R = g.Replay; A.sprites.factory = (w, h) => createCanvas(w, h);
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8')), fam = pal.families.find(f => f.id === 'nw'), theme = A.theme(fam, undefined, 'colorfigures');
function tiled(n) {
  const base = V.makePlaceholderScene(7), B = V.sceneBounds(base), w = B[2] - B[0] + 40, h = B[3] - B[1] + 40, out = { area: base.area, roads: [], buildings: [], landuse: [], trees: [] };
  for (let t = 0; t < n; t++) {
    const dx = (t % 4) * w, dy = Math.floor(t / 4) * h, sh = p => [p[0] + dx, p[1] + dy], tag = '#' + t;
    for (const r of base.roads) out.roads.push(Object.assign({}, r, { id: r.id + tag, pts: r.pts.map(sh) }));
    for (const b of base.buildings) out.buildings.push(Object.assign({}, b, { id: b.id + tag, footprint: b.footprint.map(sh) }));
    for (const l of base.landuse) out.landuse.push(Object.assign({}, l, { id: l.id + tag, footprint: l.footprint.map(sh) }));
    for (const r of base.trees) out.trees.push([r[0] + dx, r[1] + dy].concat(r.slice(2)));
  }
  return out;
}
const scene = tiled(+(process.env.TILES || 1)), W = 1200, H = 700, FROM = +(process.env.FROM || 1), TO = +(process.env.TO || 4), STEPS = +(process.env.STEPS || 60);
const B = V.sceneBounds(scene), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2, k = s => ({ w: W, h: H, scale: s, ox: W / 2 - (cx - cy) * s * 0.8660254, oy: H / 2 - (cx + cy) * s * 0.5 });
const pick = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
const VAR = {
  default: () => ({}),
  replay: () => ({ replay: true }),
  detail: () => ({ opts: { detail: true, ink: true } }),
};
console.log(`scene: ${scene.buildings.length} buildings. zoom ${FROM} to ${TO} px/m over ${STEPS} frames, then held`);
console.log('variant | frames over 33 ms | worst | p95 | median | sprite builds | layer repaints | settle (frames to <20 ms)');
for (const name of (process.env.VARIANTS || 'default,replay,detail').split(',')) {
  const v = VAR[name](), sim = V.createSim(scene, Object.assign({ seed: 5, theme, region: 'nw' }, v.opts || {}));
  if (v.replay) {
    const n = 60, wk = [{ vars: { 'building.x': Array.from({ length: n }, (_, i) => i) } }];
    R.create(sim, { weeks: wk, mapping: [{ variable: 'building.x', channel: 'wall', scale: { type: 'sequential', domain: [0, n], colours: ['#f4e9c8', '#c8452f'], label: 'x' } }], n });
  }
  const c = createCanvas(W, H).getContext('2d'); let builds = 0; const orig = A.drawSprite;
  const run = view => { const t0 = process.hrtime.bigint(); V.renderFrame(c, sim, view, {}); return Number(process.hrtime.bigint() - t0) / 1e6; };
  for (let i = 0; i < 90; i++) run(k(FROM));                                           // settled at the start
  A.sprites.builds = 0; let totalBuilds = 0; const rep0 = sim.layerRepaints || 0, ms = [];
  const origRF = V.renderFrame;
  for (let i = 1; i <= STEPS; i++) { const s = FROM * Math.pow(TO / FROM, i / STEPS); const t0 = process.hrtime.bigint(); V.renderFrame(c, sim, k(s), {}); ms.push(Number(process.hrtime.bigint() - t0) / 1e6); totalBuilds += A.sprites.builds; }
  const settle = []; for (let i = 0; i < 12; i++) settle.push(run(k(TO)));
  const firstOk = settle.findIndex(x => x < 20);
  console.log(`${name.padEnd(7)} | ${String(ms.filter(x => x > 33).length).padStart(3)} of ${STEPS}        | ${Math.max(...ms).toFixed(0).padStart(4)} ms | ${pick(ms, 0.95).toFixed(0).padStart(3)} ms | ${pick(ms, 0.5).toFixed(0).padStart(3)} ms | ${String(totalBuilds).padStart(6)} | ${String((sim.layerRepaints || 0) - rep0).padStart(3)} | ${firstOk < 0 ? '>12' : firstOk}`);
}
