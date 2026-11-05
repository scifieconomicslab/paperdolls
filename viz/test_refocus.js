/* Tests for refocus.js: the zoom's stretched picture stays up while the sharp frame is drawn on a second canvas, and the two cross-fade when it is
 * whole; a reticle seeks while it is working and locks when it is done; the picture can blur like a lens out of focus. Run: node viz/test_refocus.js */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const g = { console, Math, Object, Number, String }; g.globalThis = g; vm.createContext(g);
for (const f of ['zoomhold.js', 'refocus.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const Z = g.ZoomHold, R = g.Refocus;
let failed = 0;
function test(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message)); } }
const view = (scale, ox, oy) => ({ w: 1000, h: 600, scale, ox: ox === undefined ? 500 - 100 * scale : ox, oy: oy === undefined ? 300 - 50 * scale : oy });
function mk(o) {
  const front = { name: 'A', style: {} }, back = { name: 'B', style: {} }, reticle = { className: '', style: {} }, drawn = [], st = { done: false };
  const hold = Z.create(front, { settleMs: 120 });
  const rf = R.create(Object.assign({ hold, front, back, reticle, isDone: () => st.done, fadeMs: 160, maxWaitMs: 500, lockMs: 700 }, o || {}));
  const render = c => drawn.push(c.name);
  return { rf, hold, front, back, reticle, drawn, st, render, f: (v, t) => rf.frame(v, t, render) };
}
// a settled start at scale 2, then a zoom to 3 over a few frames, then still
function zoomThenStill(m, t0) { m.f(view(2), t0); m.f(view(2.4), t0 + 16); m.f(view(3), t0 + 32); return t0 + 32; }

test('a view that is not zooming is drawn on the front canvas and nothing else is shown', () => {
  const m = mk(); m.f(view(2), 0); m.f(view(2), 16);
  assert.deepStrictEqual(m.drawn.slice(), ['A', 'A']); assert.strictEqual(m.rf.state(), 'live'); assert.strictEqual(m.reticle.className, '');
});
test('while the scale changes the picture is stretched, nothing is drawn, and the reticle seeks at the cursor', () => {
  const m = mk(); m.rf.anchor(412, 233); m.f(view(2), 0); m.drawn.length = 0; m.f(view(2.4), 16);
  assert.strictEqual(m.drawn.length, 0); assert.strictEqual(m.rf.state(), 'zoom');
  assert.ok(m.front.style.transform.indexOf('scale(1.2)') > 0); assert.strictEqual(m.reticle.className, 'fx seek');
  assert.strictEqual(m.reticle.style.left, '412px'); assert.strictEqual(m.reticle.style.top, '233px');
});
test('when the zoom stops the sharp frame is drawn on the back canvas while the stretched picture stays up', () => {
  const m = mk(), t = zoomThenStill(m, 0); const tr = m.front.style.transform; m.drawn.length = 0;
  m.f(view(3), t + 150);
  assert.deepStrictEqual(m.drawn.slice(), ['B']); assert.strictEqual(m.rf.state(), 'refine');
  assert.strictEqual(m.back.style.opacity, '0', 'not shown yet'); assert.strictEqual(m.front.style.transform, tr, 'the stretched picture is left as it was');
});
test('the back canvas fades in once its frame is whole, and the roles swap when the fade is over', () => {
  const m = mk(), t = zoomThenStill(m, 0); m.f(view(3), t + 150); m.f(view(3), t + 166);
  assert.strictEqual(m.rf.state(), 'refine', 'sprites or layers still pending: no fade yet'); assert.strictEqual(m.back.style.opacity, '0');
  m.st.done = true; m.f(view(3), t + 182);
  assert.strictEqual(m.rf.state(), 'fade'); assert.strictEqual(m.back.style.opacity, '1'); assert.ok(/opacity 160ms/.test(m.back.style.transition));
  assert.strictEqual(m.reticle.className, 'fx lock', 'the reticle locks as the sharp picture arrives');
  m.f(view(3), t + 182 + 100); assert.strictEqual(m.rf.state(), 'fade'); m.f(view(3), t + 182 + 170);
  assert.strictEqual(m.rf.state(), 'live'); assert.strictEqual(m.rf.front().name, 'B', 'B is the front now'); assert.strictEqual(m.rf.back().name, 'A');
  assert.strictEqual(m.rf.back().style.opacity, '0'); assert.strictEqual(m.rf.back().style.transform, 'none');
  m.drawn.length = 0; m.f(view(3), t + 182 + 190); assert.deepStrictEqual(m.drawn.slice(), ['B'], 'and the next frame is drawn on it');
  m.f(view(3), t + 182 + 170 + 800); assert.strictEqual(m.reticle.className, '', 'the lock fades away');
});
test('zooming again during the refinement goes back to stretching the original picture and hides the back canvas', () => {
  const m = mk(), t = zoomThenStill(m, 0); m.f(view(3), t + 150); m.st.done = true; m.f(view(3), t + 166); assert.strictEqual(m.rf.state(), 'fade');
  m.drawn.length = 0; m.f(view(3.3), t + 182);
  assert.strictEqual(m.rf.state(), 'zoom'); assert.strictEqual(m.back.style.opacity, '0'); assert.strictEqual(m.back.style.transition, 'none'); assert.strictEqual(m.drawn.length, 0);
  assert.ok(m.front.style.transform.indexOf('scale(' + 3.3 / 2 + ')') > 0, 'still stretching the picture that was drawn at 2');
  assert.strictEqual(m.reticle.className, 'fx seek');
});
test('a frame that never finishes is shown after the maximum wait', () => {
  const m = mk(), t = zoomThenStill(m, 0); m.f(view(3), t + 150);
  for (let k = 1; k < 30; k++) m.f(view(3), t + 150 + k * 16);
  assert.strictEqual(m.rf.state(), 'refine', 'still refining after 464 ms'); assert.strictEqual(m.back.style.opacity, '0');
  m.f(view(3), t + 150 + 520); assert.strictEqual(m.rf.state(), 'fade'); assert.strictEqual(m.back.style.opacity, '1', 'shown anyway after 500 ms');
});
test('with the effect off the picture is drawn straight onto the front canvas as before', () => {
  const m = mk({ enabled: false }), t = zoomThenStill(m, 0); m.drawn.length = 0; m.f(view(3), t + 150);
  assert.deepStrictEqual(m.drawn.slice(), ['A']); assert.strictEqual(m.front.style.transform, 'none'); assert.strictEqual(m.reticle.className, '');
});
test('with blur on, the stretched picture is blurred in proportion to the stretch and sharp again after the swap', () => {
  const m = mk({ blur: true }); m.f(view(2), 0); m.f(view(2.4), 16); const small = m.front.style.filter; m.f(view(4), 32); const big = m.front.style.filter;
  const px = f => parseFloat(/blur\(([\d.]+)px\)/.exec(f)[1]); assert.ok(px(big) > px(small) && px(small) > 0, small + ' then ' + big);
  m.f(view(4), 200); m.st.done = true; m.f(view(4), 216); m.f(view(4), 216 + 170); assert.strictEqual(m.rf.back().style.filter, 'none');
});
test('with no fade time (reduced motion) the swap is at once', () => {
  const m = mk({ fadeMs: 0 }), t = zoomThenStill(m, 0); m.f(view(3), t + 150); m.st.done = true; m.f(view(3), t + 166);
  assert.strictEqual(m.rf.state(), 'live'); assert.strictEqual(m.rf.front().name, 'B');
});
test('reset returns to live and hides the second canvas', () => {
  const m = mk(), t = zoomThenStill(m, 0); m.f(view(3), t + 150); m.rf.reset();
  assert.strictEqual(m.rf.state(), 'live'); assert.strictEqual(m.back.style.opacity, '0'); assert.strictEqual(m.reticle.className, '');
  m.drawn.length = 0; m.f(view(3), t + 200); assert.deepStrictEqual(m.drawn.slice(), [m.rf.front().name]);
});
if (failed) { console.log(failed + ' failed'); process.exit(1); } else console.log('all passed');
