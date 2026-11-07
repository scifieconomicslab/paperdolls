/* R34: the sprite cache has one cliff: when it passes maxPixels (90 Mpx) evict() drops sprites more than 2.7x away in scale, and if it is still over 80% (72 Mpx) it clears EVERYTHING,
 * including the sprites the frame on screen is using (assetlib.js evict, buildSprite). On a 1920x1080 window at DPR 2 and 10 px/m the placeholder city alone settles at ~80 Mpx, i.e. 8 Mpx
 * under the cliff and above the 72 Mpx clear line, so the next few new sprites (a pan) empty the cache; every visible sprite is rebuilt, 60 per frame (build budget) while the
 * frames in between draw nothing or scaled stand-ins. Also shown: the same pan at the cap of a fixed small `maxPixels` gives the same sawtooth, never settling.
 * Run: PAPERDOLLS_NODE_MODULES=<node_modules> node docs/state-machines/repro/r34-sprite-cache-cliff.js */
const R = require('./_render'), { A, V } = R;
const W = 1920, H = 1080, dpr = 2, k = 10, scene = V.makePlaceholderScene(7);
R.resetSprites(); A.sprites.dpr = dpr; R.clock.set(0.05);
const sim = R.mkSim(JSON.parse(JSON.stringify(scene)), {}), c = R.ctx2d(W * dpr, H * dpr); c.scale(dpr, dpr);
const view = R.viewAt(scene, k, W, H);
for (let n = 0; n < 150; n++) V.renderFrame(c, sim, view, {});
console.log('settled (150 still frames): ' + A.sprites.cache.size + ' sprites, ' + (A.sprites.pixels / 1e6).toFixed(1) + ' Mpx of 90 Mpx cap; clear-all line at ' + (A.sprites.maxPixels * 0.8 / 1e6) + ' Mpx');
let clears = 0, prev = A.sprites.cache.size, first = -1, builtAfter = 0, worst = 0;
for (let n = 0; n < 400; n++) {
  const v = { w: W, h: H, scale: k, ox: view.ox - n * 4, oy: view.oy - n * 2 };            // a slow pan: 4 px/frame
  V.renderFrame(c, sim, v, {});
  const s = A.sprites.cache.size;
  if (s < prev - 20) { clears++; if (first < 0) first = n; worst = Math.max(worst, prev - s); }
  prev = s;
}
console.log('pan of 400 frames: cache dropped by more than 20 sprites at ' + clears + ' frame(s); first at frame ' + first + ', largest drop ' + worst + ' sprites; pixels now ' + (A.sprites.pixels / 1e6).toFixed(1) + ' Mpx');
// the recovery after a clear: frames until a still view has built nothing
let frames = 0; const hist = [];
A.sprites.cache.clear(); A.sprites.index.clear(); A.sprites.pixels = 0;                         // what evict() does
for (; frames < 400; frames++) { V.renderFrame(c, sim, view, {}); hist.push(A.sprites.builds); if (frames > 3 && A.sprites.builds === 0) break; }
console.log('after a clear-all, frames until the still view is sharp and builds nothing: ' + frames + ' (builds per frame at 60 max: ' + hist.slice(0, 8).join(',') + ',...)');
