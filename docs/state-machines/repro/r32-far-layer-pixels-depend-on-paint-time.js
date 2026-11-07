/* R32: the far layer's key leaves out the sprite "exact" flag (vizlib.js:971 skey, comment at :974), so a layer painted while the view is younger than 2 frames (A.sprites.exact false: octave-bucket sprites,
 * scaled) is kept for good: nothing repaints it when the view settles. The settled picture then depends on WHEN the layer was painted, not only on what it shows. This happens after every
 * rebuild() / new sim (fresh `_zoom`, still = 0), a region switch, and after any zoom that ends with the layer painted inside the first two still frames.
 * Compared: the same sim, same view, same data, painted (a) the way the page does it (cold start: exact = false for the first two frames) and (b) with exactness forced from frame 0 (what viz/test_farlayer.js does:
 * `s._zoom = { scale, still: 10 }`). Both run to "whole" and 5 more frames. A difference = a settled picture that is not the exact one and never will be.
 * Run: PAPERDOLLS_NODE_MODULES=<node_modules> node docs/state-machines/repro/r32-far-layer-pixels-depend-on-paint-time.js */
const R = require('./_render'), { A, V } = R;
const W = 900, H = 600, base = V.makePlaceholderScene(7);
const whole = s => !s._farP && !s._groundP && !s._farPatch && !(s._far && s._far.rough) && !s._farC && !s._groundC && A.sprites.builds === 0;
function run(dpr, k, forceExact) {
  R.resetSprites(); A.sprites.dpr = dpr; R.clock.set(0.25);
  const s = R.mkSim(JSON.parse(JSON.stringify(base)), { layerMs: 6, prewarm: false }), c = R.ctx2d(W * dpr, H * dpr); c.scale(dpr, dpr), v = R.viewAt(base, k, W, H);
  if (forceExact) s._zoom = { scale: k, still: 10 };
  let n = 0; for (; n < 3000; n++) { V.renderFrame(c, s, v, {}); if (n > 3 && whole(s)) break; } for (let i = 0; i < 5; i++) V.renderFrame(c, s, v, {});
  return { px: c.getImageData(0, 0, W * dpr, H * dpr).data, frames: n, exactAtPaint: null };
}
var v;
const diff = (a, b) => { let n = 0, mx = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { n++; if (d > mx) mx = d; } } return [n, mx]; };
for (const [dpr, k] of [[1, 0.47], [2, 0.47], [2, 0.8]]) {
  const a = run(dpr, k, false), b = run(dpr, k, true), [n, mx] = diff(a.px, b.px);
  console.log('DPR ' + dpr + ', ' + k + ' px/m: cold start vs exact-from-frame-0 -> ' + n + ' of ' + a.px.length + ' bytes differ, largest channel difference ' + mx + '  (frames to whole: ' + a.frames + ' / ' + b.frames + ')');
}
