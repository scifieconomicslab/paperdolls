/* Times the renderer on a big synthetic scene: the placeholder tiled N times (default 12 tiles, about 12,300 buildings).
 * Usage: node viz/scale_bench.js     Env: TILES=12 (columns of 4), SCALES=0.7,1.7,4 sets px per metre, FRAMES=15 the sample. The second table (patch frames) is described below.
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
for (const k of (process.env.FIRST === '0' ? [] : (process.env.SCALES || '0.7,1.7,4').split(',').map(Number))) {
  const view = { w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * 0.8660254, oy: H / 2 - (cx + cy) * k * 0.5 }, c = createCanvas(W, H).getContext('2d');
  const run = v => { const t0 = process.hrtime.bigint(); V.renderFrame(c, sim, v, {}); return Number(process.hrtime.bigint() - t0) / 1e6; };
  const first = run(view); for (let i = 0; i < 80; i++) run(view);
  const still = [], pan = []; for (let i = 0; i < N; i++) still.push(run(view));
  for (let i = 0; i < N; i++) pan.push(run(Object.assign({}, view, { ox: view.ox + 3 * (i + 1), oy: view.oy + 1.5 * (i + 1) })));
  console.log(`${String(k).padEnd(4)} | ${first.toFixed(0).padStart(8)} ms | ${med(still).toFixed(1).padStart(5)} ms | ${med(pan).toFixed(1).padStart(5)} ms`);
}

// ---- patch frames (model packs): the time a frame takes when a patch touching thousands of buildings arrives ----
// A pack's runtime sends frames as patches. The page applies one to the store, which updates its typed arrays and bumps the frame version, and the next
// frame is drawn. This measures that next frame (the store update included) and the frames after it until the picture is whole again, at each zoom:
//   P2 path: the store's bound arrays and sim.frameVersion (packhost.bindRenderer): far-zoom layer kept, repainted in slices; a style is asked once per building per change.
//   P1 path: a style that reads the frame by a Map lookup and allocates, with no version: the far layer is off and every building is styled in every frame.
// Env: PATCH=4000 buildings changed per patch, TRIALS=8 patches measured per row, PACK=0 skips this part, FIRST=0 skips the table above,
// LAYERMS=6 the wall time per frame a layer may spend repainting in slices (the renderer's default).
if (process.env.PACK !== '0') {
  const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
  for (const k of ['Float32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Promise', 'WeakMap', 'Number', 'String', 'setTimeout', 'clearTimeout']) g[k] = global[k];
  for (const f of ['replay.js', 'packvalidate.js', 'packstore.js', 'packhost.js']) load(f);
  const N = scene.buildings.length, P = +(process.env.PATCH || 4000), TR = +(process.env.TRIALS || 8), STEPS = TR + 2;
  const COL = ['#a9c5a0', '#e9b44c', '#c8452f', '#5b8db8'], names = ['S', 'E', 'I', 'R'];
  const man = { id: 'bench', title: 'bench', time: { unit: 'step', steps: STEPS, speeds: [1], speed: 1 }, params: {},
    entities: { building: { count: N, fields: { state: { type: 'category', values: names } } } },
    mappings: [{ entity: 'building', field: 'state', channel: 'wall', scale: { type: 'categorical', label: 'State', values: Object.fromEntries(names.map((n, i) => [n, { colour: COL[i], label: n }])) } },
               { entity: 'building', field: 'state', channel: 'overlay', scale: { type: 'categorical', values: { S: { overlay: null, label: 'S' }, E: { overlay: null, label: 'E' }, I: { overlay: 'marker', label: 'I' }, R: { overlay: null, label: 'R' } } } }] };
  // frame 0: a random state per building; each later frame is a patch of P buildings, each moved on one state, taken from a stride through the list
  let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const cur = Int8Array.from({ length: N }, () => Math.floor(rnd() * 4)), frames = [{ t: 0, entities: { building: { state: Int8Array.from(cur) } }, series: {} }];
  for (let t = 1; t <= STEPS; t++) {
    const idx = new Int32Array(P), val = new Int8Array(P), start = Math.floor(rnd() * N), stride = 7919;       // 7919 is prime, so N values apart never repeat within a patch
    for (let j = 0; j < P; j++) { const i = (start + j * stride) % N; cur[i] = (cur[i] + 1) & 3; idx[j] = i; val[j] = cur[i]; }
    frames.push({ t, patch: { building: { state: { idx, val } } }, series: {} });
  }
  const mkSimP = () => { const s = V.createSim(scene, { seed: 5, theme, region: 'nw' }); for (let i = 0; i < 20; i++) V.stepSim(s, 0.1); if (process.env.LAYERMS) s.opts.layerMs = +process.env.LAYERMS; return s; };
  const row = (k, legacy) => {
    const sim = mkSimP(), store = g.PackStore.create(man);
    store.pushFrames(frames, { replace: true });
    let b;
    if (legacy) {
      const pl = g.Replay.place(sim.scene, N), rank = new Map(); sim.buildings.forEach((e, i) => rank.set(e, pl.rank[i]));
      sim.buildingStyle = e => { const kk = rank.get(e); if (kk === undefined || kk >= N) return { data: null, overlays: [] }; const s = store.frame().entities.building.state[kk]; return { data: COL[s], overlays: s === 2 ? ['marker'] : [] }; };
    } else { b = g.PackHost.bindRenderer({ manifest: man, store, controller: null, sim }); if (!b.ok) throw new Error(b.error); }
    const view = { w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * 0.8660254, oy: H / 2 - (cx + cy) * k * 0.5 }, c = createCanvas(W, H).getContext('2d');
    const frameMs = () => { const t0 = process.hrtime.bigint(); V.renderFrame(c, sim, view, {}); return Number(process.hrtime.bigint() - t0) / 1e6; };
    const whole = () => !sim._farP && !sim._groundP && A.sprites.builds === 0;
    for (let i = 0; i < 400; i++) { frameMs(); if (i > 3 && whole()) break; }                    // frame 0 settled: caches warm
    const steady = []; for (let i = 0; i < 8; i++) steady.push(frameMs());
    const first = [], worst = [], settle = [], apply = [];
    for (let t = 1; t <= TR; t++) {
      const t0 = process.hrtime.bigint(); store.setTime(t); const ta = Number(process.hrtime.bigint() - t0) / 1e6;
      const ms = [frameMs() + ta]; for (let i = 0; i < 400 && (i < 2 || !whole()); i++) ms.push(frameMs());
      first.push(ms[0]); worst.push(Math.max(...ms)); settle.push(ms.length); apply.push(ta);
    }
    return { steady: med(steady), apply: med(apply), first: med(first), worst: med(worst), frames: med(settle), layers: sim.layerRepaints || 0 };
  };
  console.log(`\npatch frames: ${N} buildings, ${P} changed per patch, median of ${TR} patches (node-canvas, software; a browser's GPU canvas is faster at blits)`);
  console.log('px/m | path | steady | store apply | frame after patch | worst frame | frames to settle');
  for (const k of (process.env.SCALES || '0.7,1.7,4').split(',').map(Number)) for (const legacy of [true, false]) {
    const r = row(k, legacy);
    console.log(`${String(k).padEnd(4)} | ${(legacy ? 'P1' : 'P2').padEnd(4)} | ${r.steady.toFixed(1).padStart(5)} ms | ${r.apply.toFixed(2).padStart(7)} ms | ${r.first.toFixed(1).padStart(10)} ms | ${r.worst.toFixed(1).padStart(8)} ms | ${String(r.frames).padStart(6)}`);
  }
}
