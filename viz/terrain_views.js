/* Renders views of a real scene's ground with node-canvas and times the ground paint, to judge terrain shading by eye and by stopwatch.
 * Usage: node viz/terrain_views.js SCENE.json OUTDIR [label]
 *   env: LOCS='{"valley_1":[1434,-355],...}' (scene metres, default: the Great Retrofit's six relief places), SCALES=2.18,0.35 (px per metre), RELIEF=1,
 *        TERRAIN_CELL=25 (resample the scene's grid to this cell with bilinear interpolation: a stand-in for a finer ingest), TIME=1 prints ground-paint ms.
 * Needs the 'canvas' package. Writes OUTDIR/<name>_<scale>_<label>.jpg (about 60 kB each at 1100 x 700). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date, Int32Array, Uint8Array, Float32Array, Float64Array, Number, String, isFinite, isNaN, performance }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js', 'terrainlib.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib, Tr = g.Terrain; A.sprites.factory = (w, h) => createCanvas(w, h);
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8')), fam = pal.families.find(f => f.id === 'nw');
const [scenePath, outDir, label] = [process.argv[2], process.argv[3], process.argv[4] || 'view'];
const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
const LOCS = JSON.parse(process.env.LOCS || '{"valley_1":[1434,-355],"hill_1":[-380,-1391]}');
const SCALES = (process.env.SCALES || '2.18').split(',').map(Number), W = 1100, H = 700;
if (process.env.TERRAIN_CELL && scene.terrain) {                   // finer grid from the same data, bilinear
  const T = scene.terrain, c = +process.env.TERRAIN_CELL, nx = Math.floor((T.nx - 1) * T.dx / c) + 1, ny = Math.floor((T.ny - 1) * T.dy / c) + 1, z = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z.push(Tr.sample(T, T.x0 + i * c, T.y0 + j * c));
  scene.terrain = { x0: T.x0, y0: T.y0, dx: c, dy: c, nx, ny, z };
}
const sim = V.createSim(scene, { seed: 5, theme: A.theme(fam, undefined, 'colorfigures'), region: 'nw', relief: +(process.env.RELIEF || 1) });
sim.opts.sliceLayers = false; sim.opts.buildMs = 1e9; sim.opts.prewarm = false;
const B = V.sceneBounds(scene);
function frames(cv, view, n) { const c = cv.getContext('2d'); sim._ground = sim._far = sim._zoom = sim._warm = null; A.sprites.cache.clear(); A.sprites.pixels = 0; for (let i = 0; i < n; i++) V.renderFrame(c, sim, view, {}); }
const viewAt = (k, x, y) => ({ w: W, h: H, scale: k, ox: W / 2 - (x - y) * k * 0.8660254, oy: H / 2 - (x + y) * k * 0.5 + 35 * k });
fs.mkdirSync(outDir, { recursive: true });
for (const k of SCALES) {
  for (const [name, [x, y]] of Object.entries(LOCS)) {
    const cv = createCanvas(W, H); frames(cv, viewAt(k, x, y), 8);
    fs.writeFileSync(path.join(outDir, name + '_' + k + '_' + label + '.jpg'), cv.toBuffer('image/jpeg', { quality: 0.7 }));
  }
  if (process.env.TIME) {                                             // the cost of painting the ground alone, cold, median of 7; and the whole first frame
    const ms = []; const th = sim.theme || A.theme(fam, undefined, 'colorfigures');
    const cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2, v = viewAt(Math.min(k, 0.35), cx, cy);
    const cv = createCanvas(W, H), c = cv.getContext('2d');
    for (let i = 0; i < 9; i++) { const t0 = performance.now(); sim._ground = null; V.renderFrame(c, sim, v, { buildings: false, trees: false, vehicles: false, people: false }); ms.push(performance.now() - t0); }
    ms.sort((a, b) => a - b); console.log('scale ' + k + ' (far view at ' + v.scale + '): cold ground frame median ' + ms[4].toFixed(1) + ' ms (min ' + ms[0].toFixed(1) + ', max ' + ms[8].toFixed(1) + ')');
  }
}
