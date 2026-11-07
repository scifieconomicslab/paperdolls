/* Times the far-zoom ('Fit') view of a big scene: the first paint, and playback while colours change month by month.
 * Usage: node viz/far_bench.js
 * Env: SCENE=path to a scene json (default: the placeholder tiled TILES=9 times, about 9,200 buildings; the Jette commune scene is 9,214),
 *      PATCH=300 buildings whose state changes each month, MONTHS=24 patches per second of playback, SECONDS=6 length of the playback run,
 *      FPS=60 the display rate the loop pretends to have (a frame that takes longer delays the next one), W=1200 H=700 the canvas.
 * Reports, on a node-canvas (software rendering; a browser's GPU canvas blits faster):
 *   first paint: the frames drawn from a cold start until nothing is left to paint: the first, the worst, how many took over 100 ms, how many frames until whole.
 *   playback: the frames drawn while the pack sends MONTHS patches a second: median, p95, worst, how many took over 50 ms, and how long a colour change
 *             took to reach the screen (ms from the patch until no building on screen was in its old colour).
 * Needs the 'canvas' package (NODE_CANVAS=path). The numbers are recorded in viz/README.md and docs/known-issues.md. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date, Int32Array, Uint8Array }; g.globalThis = g; vm.createContext(g);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js']) load(f);
for (const k of ['Float32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Promise', 'WeakMap', 'Number', 'String', 'setTimeout', 'clearTimeout']) g[k] = global[k];
for (const f of ['replay.js', 'packvalidate.js', 'packstore.js', 'packhost.js']) load(f);
const A = g.AssetLib, V = g.VizLib; A.sprites.factory = (w, h) => createCanvas(w, h);
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8')), fam = pal.families.find(f => f.id === 'nw');
function tiled(tiles) {
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
const W = +(process.env.W || 1200), H = +(process.env.H || 700);
const scene = process.env.SCENE ? JSON.parse(fs.readFileSync(process.env.SCENE, 'utf8')) : tiled(+(process.env.TILES || 9));
const theme = A.theme(fam, undefined, 'colorfigures'), B = V.sceneBounds(scene), N = scene.buildings.length;
const ms0 = () => Number(process.hrtime.bigint()) / 1e6;
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const C30 = 0.8660254, S = Math.max(B[2] - B[0], B[3] - B[1]);
// the 'Fit' view (viz/camera.js): the whole scene with a 6% margin, centred
const k = Math.max(1e-4, Math.min(W * 0.94 / ((B[2] - B[0] + B[3] - B[1]) * C30 + 1), H * 0.94 / ((B[2] - B[0] + B[3] - B[1]) * 0.5 + 1))), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2;
const view = { w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * C30, oy: H / 2 - (cx + cy) * k * 0.5 };

// a pack whose building state is S/E/I/R, wall colour by state, bound to a fresh sim exactly as the pack page does (frame version, bound arrays)
const COL = ['#a9c5a0', '#e9b44c', '#c8452f', '#5b8db8'], names = ['S', 'E', 'I', 'R'];
const PATCH = +(process.env.PATCH || 300), MONTHS = +(process.env.MONTHS || 24), SECONDS = +(process.env.SECONDS || 6), FPS = +(process.env.FPS || 60), STEPS = Math.ceil(MONTHS * SECONDS) + 4;
const man = { id: 'bench', title: 'bench', time: { unit: 'step', steps: STEPS, speeds: [1], speed: 1 }, params: {},
  entities: { building: { count: N, fields: { state: { type: 'category', values: names } } } },
  mappings: [{ entity: 'building', field: 'state', channel: 'wall', scale: { type: 'categorical', label: 'State', values: Object.fromEntries(names.map((n, i) => [n, { colour: COL[i], label: n }])) } }] };
let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const cur = Int8Array.from({ length: N }, () => Math.floor(rnd() * 4)), frames = [{ t: 0, entities: { building: { state: Int8Array.from(cur) } }, series: {} }];
for (let t = 1; t <= STEPS; t++) {
  const idx = new Int32Array(PATCH), val = new Int8Array(PATCH), start = Math.floor(rnd() * N);
  for (let j = 0; j < PATCH; j++) { const i = (start + j * 7919) % N; cur[i] = (cur[i] + 1) & 3; idx[j] = i; val[j] = cur[i]; }
  frames.push({ t, patch: { building: { state: { idx, val } } }, series: {} });
}
function fresh() {
  const sim = V.createSim(scene, { seed: 5, theme, region: 'nw' }), store = g.PackStore.create(man); store.pushFrames(frames, { replace: true });
  const b = g.PackHost.bindRenderer({ manifest: man, store, controller: null, sim }); if (!b.ok) throw new Error(b.error);
  if (process.env.WINDOWLODPX !== undefined) sim.opts.windowLodPx = +process.env.WINDOWLODPX;
  for (const key of ['layerMs']) if (process.env[key.toUpperCase()]) sim.opts[key] = +process.env[key.toUpperCase()];
  return { sim, store, ctx: createCanvas(W, H).getContext('2d') };
}
const render = (R) => { const t0 = ms0(); V.renderFrame(R.ctx, R.sim, view, {}); return ms0() - t0; };
const whole = (R) => !R.sim._farP && !R.sim._groundP && !R.sim._farPatch && !(R.sim._far && R.sim._far.rough) && A.sprites.builds === 0;
console.log(`scene: ${N} buildings, ${(scene.trees || []).length} trees; Fit view at ${k.toFixed(3)} px/m on ${W} by ${H} (node-canvas, software)`);

// ---- first paint ----
{
  const R = fresh(), ms = [];
  const dump = (n) => { if (process.env.DUMP) fs.writeFileSync(process.env.DUMP + n + '.png', R.ctx.canvas.toBuffer('image/png')); };
  for (let i = 0; i < 2000; i++) { ms.push(render(R)); if (i === 0) dump('_frame1'); if (i === 5) dump('_frame6'); if (i > 3 && whole(R)) break; }
  dump('_whole');
  const t = ms.reduce((a, b) => a + b, 0);
  console.log(`first paint:  first frame ${ms[0].toFixed(0)} ms | worst ${Math.max(...ms).toFixed(0)} ms | frames over 100 ms: ${ms.filter(x => x > 100).length} | frames to whole: ${ms.length} | total ${t.toFixed(0)} ms`);
  const still = []; for (let i = 0; i < 10; i++) still.push(render(R));
  console.log(`              settled frame ${pct(still, 0.5).toFixed(1)} ms`);
  globalThis.__fp = R;
}

// ---- playback ----
{
  const R = fresh(); for (let i = 0; i < 2000; i++) { render(R); if (i > 3 && whole(R)) break; }
  const tick = 1000 / FPS, per = 1000 / MONTHS, ms = [], lag = []; let virt = 0, nextPatch = per, month = 0; const pending = [];
  while (virt < SECONDS * 1000) {
    let cost = 0;
    if (virt >= nextPatch && month < STEPS - 2) { const t0 = ms0(); R.store.setTime(++month); cost += ms0() - t0; nextPatch += per; pending.push({ ver: R.sim.frameVersion, t: virt }); }
    cost += render(R); ms.push(cost);
    const L = R.sim._far, done = L && L.ver ? +String(L.ver).slice(1) : -1;                      // the far layer shows every version up to L.ver (its last painted pass)
    while (pending.length && pending[0].ver <= done) lag.push(virt + Math.max(tick, cost) - pending.shift().t);
    virt += Math.max(tick, cost);
  }
  console.log(`playback ${MONTHS} months/s, ${PATCH} buildings changed a month, ${ms.length} frames: median ${pct(ms, 0.5).toFixed(1)} ms | p95 ${pct(ms, 0.95).toFixed(1)} ms | worst ${Math.max(...ms).toFixed(0)} ms | over 50 ms: ${ms.filter(x => x > 50).length}`);
  console.log(`              a patch was on screen after: median ${lag.length ? pct(lag, 0.5).toFixed(0) : 'never'} ms, p95 ${lag.length ? pct(lag, 0.95).toFixed(0) : '-'} ms (${lag.length} of ${month} patches shown by the end); layer repaints: ${R.sim.layerRepaints || 0}, patches: ${R.sim.farPatches || 0} (${R.sim.farRectsPainted || 0} rects), fallbacks: ${R.sim.farPatchFallbacks || 0}`);
}
