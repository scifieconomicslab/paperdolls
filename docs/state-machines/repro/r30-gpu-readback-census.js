/* R30 (issue paperdolls#3): which canvases the far view touches per frame, counted at the canvas API. Node cannot measure a GPU; it can count what the draw path asks of the canvas.
 * Scene: the 9-tile placeholder (~9,200 buildings, as viz/far_bench.js), Fit view, 1200x700, DPR 1 and 2. Phases: first paint -> idle (settled) -> idle with a model patch each frame -> pan -> zoom end.
 * Run: PAPERDOLLS_NODE_MODULES=<node_modules> node docs/state-machines/repro/r30-gpu-readback-census.js */
const R = require('./_render'), { A, V } = R;
const W = 1200, H = 700, scene = R.tiled(9), view = R.fitView(scene, W, H);
function run(dpr, opts, label) {
  R.resetSprites(); A.sprites.dpr = dpr; R.clock.set(0.25);
  const sim = R.mkSim(JSON.parse(JSON.stringify(scene)), Object.assign({ layerMs: 6 }, opts || {})), c = R.ctx2d(W * dpr, H * dpr); c.scale(dpr, dpr); R.setViewPx(W, H);
  let n = 0; const whole = () => !sim._farP && !sim._groundP && !sim._farPatch && !(sim._far && sim._far.rough) && !sim._farC && !sim._groundC;
  const first = R.census(() => { while (n < 3000) { V.renderFrame(c, sim, view, {}); n++; if (n > 4 && whole()) break; } }, view);
  const out = { label, dpr, frames_to_whole: n, first_paint: first };
    out.idle = R.census(() => { for (let i = 0; i < 10; i++) V.renderFrame(c, sim, view, {}); }, view);
  // a pack frame every frame: 150 buildings change state each time (versioned style not used: the default state style)
  const S = ['none', 'queued', 'in_progress', 'finished'];
  // one model frame changes 150 buildings (every 61st), then frames are drawn until the patch has been painted: totals for the whole patch, and how many frames it took
  let pf = 0; for (let k = 0; k < sim.buildings.length; k += 61) sim.buildings[k].src.state = S[(k + 1) & 3];
  out.patching = R.census(() => { for (; pf < 2000; pf++) { V.renderFrame(c, sim, view, {}); if (pf > 2 && whole()) { pf++; break; } } }, view); out.patchFrames = pf;
  const pv = { w: view.w, h: view.h, scale: view.scale, ox: view.ox + 40, oy: view.oy + 25 };
  out.pan = R.census(() => { for (let i = 0; i < 10; i++) V.renderFrame(c, sim, { w: pv.w, h: pv.h, scale: pv.scale, ox: pv.ox + i * 3, oy: pv.oy + i }, {}); }, view);
  out.sim = { buildings: sim.buildings.length, layerRepaints: sim.layerRepaints, farPatches: sim.farPatches, farRects: sim.farRectsPainted };
  return out;
}
const show = o => {
  const per = (t, f) => { const x = Object.assign({}, t); for (const k of ['created', 'createdPx', 'getImageData', 'putImageData', 'drawCanvas', 'drawCanvasPx', 'readPx']) x[k] = +(t[k] / f).toFixed(1); return x; };
  console.log('--- ' + o.label + '  (DPR ' + o.dpr + ', whole after ' + o.frames_to_whole + ' frames; ' + JSON.stringify(o.sim) + ')');
  const row = (name, t, f) => { const p = per(t, f); console.log('  ' + name.padEnd(18) + ' per frame: getImageData ' + p.getImageData + '  putImageData ' + p.putImageData + '  drawImage(canvas) ' + p.drawCanvas + ' [' + Object.entries(t.byRole).map(([k, v]) => k + ' ' + (v.n / f).toFixed(1) + ' x ' + Math.round(v.px / Math.max(1, v.n) / 1e3) + 'kpx').join(', ') + ']  canvases created ' + p.created + ' (' + Math.round(p.createdPx / 1e3) + ' kpx)'); };
  console.log('  first paint totals: ' + o.first_paint.created + ' canvases created (' + (o.first_paint.createdPx / 1e6).toFixed(2) + ' Mpx), ' + o.first_paint.drawCanvas + ' canvas-as-source drawImage calls; a 1920x1080 window at this DPR has layer canvases of ' + (Math.ceil(1920 * 1.8 * o.dpr) * Math.ceil(1080 * 1.8 * o.dpr) / 1e6).toFixed(1) + ' Mpx (' + Math.round(Math.ceil(1920 * 1.8 * o.dpr) * Math.ceil(1080 * 1.8 * o.dpr) * 4 / 1e6) + ' MB) each, two of them blitted every frame, and a spare of each kept');
  row('first paint', o.first_paint, o.frames_to_whole); row('idle (settled)', o.idle, 10); row('one patch (150 b.)', o.patching, o.patchFrames); row('pan', o.pan, 10);
};
for (const dpr of [1, 2]) show(run(dpr, {}, 'default options'));
// the opt-in finishes that DO read back
R.resetSprites(); A.sprites.dpr = 1; { const sim = R.mkSim(JSON.parse(JSON.stringify(scene)), { layerMs: 6 }); sim.opts.pixel = 1.5; sim.opts.posterize = 12; const c = R.ctx2d(W, H); R.setViewPx(W, H); const t = R.census(() => { for (let i = 0; i < 6; i++) V.renderFrame(c, sim, view, {}); }, view); console.log('--- pixel + posterize (viewer "pixel" checkbox), 6 frames from cold: getImageData ' + t.getImageData + ', putImageData ' + t.putImageData + ', pixels read ' + (t.readPx / 1e6).toFixed(2) + ' Mpx'); }
