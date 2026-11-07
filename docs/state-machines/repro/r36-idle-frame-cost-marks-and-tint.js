/* R36 (issue paperdolls#3, second finding: "enriched far zoom is 10x slower than plain"): what an IDLE settled far frame costs, by what is switched on. Wall-clock (process.hrtime) on node-canvas,
 * so the ratios are the evidence, not the milliseconds. Scene: the 9-tile placeholder (~9,200 buildings), Fit view 1200x700, DPR 1.
 * The far layer and the ground layer are cached, so a plain idle frame is two blits. Ground marks (the far form of outline/halo, vizlib.js drawGroundMarks) are NOT cached: every frame clips and strokes
 * a hatch per cell. Ground tint is cached on (version, view) and costs one blit. Terrain is painted into the cached ground layer only.
 * Run: PAPERDOLLS_NODE_MODULES=<node_modules> node docs/state-machines/repro/r36-idle-frame-cost-marks-and-tint.js */
const R = require('./_render'), { A, V } = R;
const W = 1200, H = 700, scene = R.tiled(9), view = R.fitView(scene, W, H), B = V.sceneBounds(scene);
const ms = () => Number(process.hrtime.bigint()) / 1e6, med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
const whole = s => !s._farP && !s._groundP && !s._farPatch && !(s._far && s._far.rough) && !s._farC && !s._groundC && A.sprites.builds === 0;
function cells(size, share) { const out = []; for (let x = Math.floor(B[0] / size) * size; x < B[2]; x += size) for (let y = Math.floor(B[1] / size) * size; y < B[3]; y += size) out.push({ kind: 'outline', x0: x, y0: y, x1: x + size, y1: y + size, share, colour: '#c0392b', v: share, minScale: 1.2 }); return out; }
function idle(label, setup, terrain) {
  R.resetSprites(); R.clock.set(0.25);
  const sc = JSON.parse(JSON.stringify(scene)); if (terrain) sc.terrain = { x0: B[0], y0: B[1], dx: 200, dy: 200, nx: Math.ceil((B[2] - B[0]) / 200) + 1, ny: Math.ceil((B[3] - B[1]) / 200) + 1, z: Array.from({ length: (Math.ceil((B[2] - B[0]) / 200) + 1) * (Math.ceil((B[3] - B[1]) / 200) + 1) }, (_, i) => 30 + 25 * Math.sin(i / 3)) };
  const sim = R.mkSim(sc, { layerMs: 6 }); if (setup) setup(sim);
  const c = R.ctx2d(W, H); let n = 0; for (; n < 4000; n++) { V.renderFrame(c, sim, view, {}); if (n > 4 && whole(sim)) break; }
  for (let i = 0; i < 5; i++) V.renderFrame(c, sim, view, {});
  R.clock.set(0); const t = []; for (let i = 0; i < 15; i++) { const t0 = ms(); V.renderFrame(c, sim, view, {}); t.push(ms() - t0); }
  console.log(label.padEnd(58) + ' idle frame median ' + med(t).toFixed(2) + ' ms  (min ' + Math.min(...t).toFixed(2) + ', max ' + Math.max(...t).toFixed(2) + ')');
  return med(t);
}
const plain = idle('plain', null);
idle('terrain (relief) only', null, true);
const m1 = idle('+ ground marks, 200 m cells (' + cells(200, 0.5).length + ' cells)', s => { const cs = cells(200, 0.5); s.groundMarks = { cells: () => cs, version: () => 1 }; }, true);
const m2 = idle('+ ground marks, 100 m cells (' + cells(100, 0.5).length + ' cells)', s => { const cs = cells(100, 0.5); s.groundMarks = { cells: () => cs, version: () => 1 }; }, true);
const t1 = idle('+ ground tint, 40 m cells (' + cells(40, 0.5).length + ' cells), opacity .5', s => { const cs = cells(40, 0.5).map(c => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, colour: '#4477aa' })); s.groundTint = { cells: () => cs, opacity: 0.5, version: () => 1 }; }, true);
console.log('ratio to plain: marks(200 m) x' + (m1 / plain).toFixed(1) + ', marks(100 m) x' + (m2 / plain).toFixed(1) + ', tint x' + (t1 / plain).toFixed(1));
