/* Compares the opt-in detail pass (sim.opts.detail = true) against the default: writes a PNG of each and times settled and panning frames.
 * Usage: node viz/detail_bench.js [outdir]    Env: SCALE=4 sets px per metre, FAM=nw the region, FRAMES=15 the sample. Needs the node 'canvas' package. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date, Int32Array, Uint8Array }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib; A.sprites.factory = (w, h) => createCanvas(w, h);
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8'));
const fam = pal.families.find(f => f.id === (process.env.FAM || 'nw')), out = process.argv[2] || '.';
const scene = V.makePlaceholderScene(7), theme = A.theme(fam, undefined, 'colorfigures'), N = +(process.env.FRAMES || 15), k = +(process.env.SCALE || 4), W = 1200, H = 700;
const B = V.sceneBounds(scene), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2;
const view = { w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * 0.8660254, oy: H / 2 - (cx + cy) * k * 0.5 };
const med = x => x.sort((p, q) => p - q)[x.length >> 1];
for (const detail of [false, true]) {
  const sim = V.createSim(scene, { seed: 5, theme, region: fam.id, detail }); for (let i = 0; i < 40; i++) V.stepSim(sim, 0.1);
  const cv = createCanvas(W, H), c = cv.getContext('2d');
  const run = v => { const t0 = process.hrtime.bigint(); V.renderFrame(c, sim, v, {}); return Number(process.hrtime.bigint() - t0) / 1e6; };
  const first = run(view); for (let i = 0; i < 60; i++) run(view);
  const still = []; for (let i = 0; i < N; i++) still.push(run(view));
  const pan = []; for (let i = 0; i < N; i++) pan.push(run(Object.assign({}, view, { ox: view.ox + 3 * (i + 1), oy: view.oy + 1.5 * (i + 1) })));
  run(view); for (let i = 0; i < 60; i++) run(view);
  fs.writeFileSync(path.join(out, 'detail_' + (detail ? 'on' : 'off') + '.png'), cv.toBuffer('image/png'));
  console.log(`detail ${detail ? 'on ' : 'off'}: first frame ${first.toFixed(0)} ms, settled ${med(still).toFixed(1)} ms, pan ${med(pan).toFixed(1)} ms, sprites cached ${A.sprites.cache.size}`);
}
