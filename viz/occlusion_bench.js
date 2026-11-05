/* Benchmark and equality check for occlusion culling (VizLib renders with sim.opts.occlusion true, against the same scene with it off, which is the default).
 *
 * For each zoom it settles both sims (sprites cached at the exact scale), checks the two frames are identical pixel for pixel, then
 * times many identical frames, the two variants interleaved, and reports the median of each.
 *
 * Usage: node viz/occlusion_bench.js [scene.json] [family]
 * Env:   TALL=1 makes every building 4 to 8 storeys (a worst case for hiding); SCALES=1.7,3,5 sets px per metre; FRAMES=21 sets the sample.
 * Needs the node 'canvas' package. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date, Int32Array, Uint8Array }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib; A.sprites.factory = (w, h) => createCanvas(w, h);
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8'));
const fam = pal.families.find(f => f.id === (process.argv[3] || 'nw'));
const scene = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : V.makePlaceholderScene(7);
if (process.env.TALL) { let s = 12345; scene.buildings.forEach(b => { s = (s * 1103515245 + 12345) & 0x7fffffff; b.levels = 4 + (s % 5); if (['shed', 'villa', 'terrace'].includes(b.archetype)) b.archetype = 'block'; }); }
const W = 1200, H = 700, theme = A.theme(fam, undefined, 'colorfigures'), N = +(process.env.FRAMES || 21);
const mk = occlusion => { const s = V.createSim(scene, { seed: 5, theme, region: fam.id, occlusion }); for (let i = 0; i < 40; i++) V.stepSim(s, 0.1); return s; };
const B = V.sceneBounds(scene), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2;
const med = x => x.sort((p, q) => p - q)[x.length >> 1];
console.log(`scene: ${scene.buildings.length} buildings, ${scene.trees.length} trees${process.env.TALL ? ' (every building made 4 to 8 storeys)' : ''}`);
console.log('px/m | items | tested | culled | identical | occlusion off | occlusion on | change');
for (const k of (process.env.SCALES || '1.7,3,5,8').split(',').map(Number)) {
  const view = { w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * 0.8660254, oy: H / 2 - (cx + cy) * k * 0.5 };
  const on = mk(true), off = mk(false), con = createCanvas(W, H).getContext('2d'), coff = createCanvas(W, H).getContext('2d');
  const run = (s, c) => { const t0 = process.hrtime.bigint(); V.renderFrame(c, s, view, {}); return Number(process.hrtime.bigint() - t0) / 1e6; };
  for (let i = 0; i < 60; i++) { run(on, con); run(off, coff); }                                   // settle: sprites at the exact scale on both
  const a = con.getImageData(0, 0, W, H).data, b = coff.getImageData(0, 0, W, H).data; let same = true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
  const t1 = [], t0 = []; for (let i = 0; i < N; i++) { t0.push(run(off, coff)); t1.push(run(on, con)); }
  const st = on.occlusionStats || { tested: 0, culled: 0, items: 0 }, m0 = med(t0), m1 = med(t1);
  console.log(`${String(k).padEnd(4)} | ${String(st.items).padEnd(5)} | ${String(st.tested).padEnd(6)} | ${String(st.culled).padEnd(6)} | ${same ? 'yes' : 'NO'}       | ${m0.toFixed(1).padStart(6)} ms | ${m1.toFixed(1).padStart(6)} ms | ${((m1 / m0 - 1) * 100).toFixed(0)}%`);
}
