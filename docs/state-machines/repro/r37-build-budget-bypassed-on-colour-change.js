/* R37: the per-frame sprite build budget (SPRITE_BUILDS_PER_FRAME = 60, BUILD_MS_PER_FRAME = 8; vizlib.js:820-821, assetlib.js drawSprite) does not hold when colours change on a settled view.
 * Over budget, drawSprite re-enters itself with exact=false/zooming=true (assetlib.js:405-407) to "show the bucketed sprite and sharpen later", but that fallback only reuses a sprite
 * already HELD under the same ikey (same asset, same colours). A new colour has none held, so the inner call builds the octave sprite anyway (assetlib.js:409 `if (!sp)`), and the outer budget check never
 * stops it. One model month that recolours N visible buildings builds ~N sprites in ONE frame, then the exact-scale ones at the budgeted rate in later frames.
 * Setup: placeholder city at 2.2 px/m (buildings are drawn one by one: the far layer is only below 1 px/m), 1200x700, settled; then the 400 visible buildings change state to "finished".
 * Run: PAPERDOLLS_NODE_MODULES=<node_modules> node docs/state-machines/repro/r37-build-budget-bypassed-on-colour-change.js */
const R = require('./_render'), { A, V } = R;
const W = 1200, H = 700, k = 2.2, sc = V.makePlaceholderScene(7);
R.resetSprites(); R.clock.set(0.25);
const sim = R.mkSim(JSON.parse(JSON.stringify(sc)), {}), c = R.ctx2d(W, H), v = R.viewAt(sc, k, W, H);
for (let n = 0; n < 60; n++) V.renderFrame(c, sim, v, {});
const vis = sim.buildings.filter(e => { const p = V.proj(v, e.fit.cx, e.fit.cy, e.z); return p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H; });
console.log('settled: builds in the last frame ' + A.sprites.builds + ', ' + A.sprites.cache.size + ' sprites cached, ' + vis.length + ' buildings on screen; budget per frame: maxBuilds ' + A.sprites.maxBuilds + ' (during a frame it is 60), 8 ms');
vis.slice(0, 400).forEach(e => { e.src.state = 'finished'; });
for (let n = 0; n < 6; n++) {
  const t0 = process.hrtime.bigint(); R.clock.set(0.25); V.renderFrame(c, sim, v, {});
  console.log('frame after the change +' + n + ': sprites built ' + A.sprites.builds + (n === 0 ? '   <-- budget is 60' : '') + ', wall ' + (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0) + ' ms');
}
