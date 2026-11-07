const R = require('./_render'), { A, V } = R;
const W = 900, H = 600, base = V.makePlaceholderScene(7), dpr = 2, k = 0.8;
const whole = s => !s._farP && !s._groundP && !s._farPatch && !(s._far && s._far.rough) && !s._farC && !s._groundC && A.sprites.builds === 0;
function run(force) { R.resetSprites(); A.sprites.dpr = dpr; R.clock.set(0.25);
  const s = R.mkSim(JSON.parse(JSON.stringify(base)), { layerMs: 6, prewarm: false }), c = R.ctx2d(W * dpr, H * dpr); c.scale(dpr, dpr); const v = R.viewAt(base, k, W, H);
  if (force) s._zoom = { scale: k, still: 10 };
  for (let n = 0; n < 3000; n++) { V.renderFrame(c, s, v, {}); if (n > 3 && whole(s)) break; } for (let i = 0; i < 5; i++) V.renderFrame(c, s, v, {});
  return { s, px: c.getImageData(0, 0, W * dpr, H * dpr).data }; }
const a = run(false), b = run(true);
console.log('repaints', a.s.layerRepaints, b.s.layerRepaints, 'exact flags', a.s._far.exact, b.s._far.exact);
const fa = a.s._far.cv.getContext('2d').getImageData(0,0,a.s._far.cv.width,a.s._far.cv.height).data, fb = b.s._far.cv.getContext('2d').getImageData(0,0,b.s._far.cv.width,b.s._far.cv.height).data;
let n=0; for (let i=0;i<fa.length;i++) if (fa[i]!==fb[i]) n++; console.log('layer bytes differ', n, 'of', fa.length, a.s._far.cv.width, b.s._far.cv.width, a.s._far.ox, b.s._far.ox);
