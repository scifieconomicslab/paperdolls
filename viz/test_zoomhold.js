/* Tests for zoomhold.js: while the wheel is zooming, the canvas that is already drawn is moved and scaled by the compositor (a CSS transform)
 * and nothing is redrawn; a real frame is drawn once the scale has been still for settleMs, or when the zoom has gone too far to stretch.
 * Run: node viz/test_zoomhold.js */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const g = { console, Math, Object, Number, String }; g.globalThis = g; vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'zoomhold.js'), 'utf8'), g);
const Z = g.ZoomHold;
let failed = 0;
function test(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message)); } }
const view = (scale, ox, oy) => ({ w: 1000, h: 600, scale, ox: ox === undefined ? 500 - 100 * scale : ox, oy: oy === undefined ? 300 - 50 * scale : oy });
const mk = () => { const el = { style: {} }; return { el, z: Z.create(el, { settleMs: 120 }) }; };
// one frame: the caller asks, draws if told to, and reports the draw
function frame(z, v, t) { const draw = z.shouldRender(v, t); if (draw) z.rendered(v); return draw; }

test('the first frame, and every frame while the view is not zooming, is drawn', () => {
  const { z, el } = mk();
  assert.strictEqual(frame(z, view(2), 0), true);
  for (let t = 16; t < 400; t += 16) assert.strictEqual(frame(z, view(2, 500 - 200 + t, 250), t), true, 'a pan is drawn every frame');
  assert.strictEqual(el.style.transform || 'none', 'none');
});
test('while the scale keeps changing, nothing is drawn and the canvas is moved and scaled to match', () => {
  const { z, el } = mk(); frame(z, view(2), 0);
  const v = view(2.6, 500 - 100 * 2.6 + 7, 300 - 50 * 2.6 - 4);
  assert.strictEqual(frame(z, v, 16), false);
  const r = 2.6 / 2, d = view(2);
  assert.strictEqual(el.style.transformOrigin, '0 0');
  assert.strictEqual(el.style.transform, 'translate(' + (v.ox - d.ox * r) + 'px, ' + (v.oy - d.oy * r) + 'px) scale(' + r + ')');
});
test('events that arrive every few frames still count as one zoom: no draw between them', () => {
  const { z } = mk(); frame(z, view(2), 0);
  assert.strictEqual(frame(z, view(2.2), 16), false);
  for (let t = 32; t < 120; t += 16) assert.strictEqual(frame(z, view(2.2), t), false, 'a frame with no wheel event at ' + t);   // scale unchanged, but the wheel only paused
  assert.strictEqual(frame(z, view(2.4), 128), false);
});
test('once the scale has been still for the settle time a real frame is drawn and the transform is cleared', () => {
  const { z, el } = mk(); frame(z, view(2), 0); frame(z, view(2.4), 16);
  assert.ok(el.style.transform && el.style.transform !== 'none');
  assert.strictEqual(frame(z, view(2.4), 16 + 100), false, 'not yet');
  assert.strictEqual(frame(z, view(2.4), 16 + 130), true);
  assert.strictEqual(el.style.transform, 'none');
});
test('a zoom beyond the stretch limits draws for real and becomes the new base', () => {
  const { z } = mk(); frame(z, view(1), 0);
  assert.strictEqual(frame(z, view(1.5), 16), false);
  assert.strictEqual(frame(z, view(8.8), 32), true, 'more than 8 times: drawn');
  assert.strictEqual(frame(z, view(10), 48), false, 'stretching from the new base');
  assert.strictEqual(frame(z, view(1.2), 64), true, 'below 0.3 times of the base: drawn');
});
test('a change of size, or reset, draws for real', () => {
  const { z, el } = mk(); frame(z, view(2), 0); frame(z, view(2.4), 16);
  const big = Object.assign(view(2.4), { w: 1200 });
  assert.strictEqual(frame(z, big, 32), true); assert.strictEqual(el.style.transform, 'none');
  frame(z, view(2.4, big.ox, big.oy), 48); z.reset(); assert.strictEqual(frame(z, view(2.4), 64), true);
});
test('ratio and active say how far the picture is stretched, and rebind moves the transform to another canvas', () => {
  const { z, el } = mk(); frame(z, view(2), 0);
  assert.strictEqual(z.active(), false); assert.strictEqual(z.ratio(), 1);
  frame(z, view(3), 16); assert.strictEqual(z.active(), true); assert.strictEqual(z.ratio(), 1.5);
  const other = { style: {} }; z.rebind(other); z.rendered(view(3));                                  // the new canvas takes over, showing a sharp frame at 3
  assert.strictEqual(other.style.transform, 'none'); assert.strictEqual(z.active(), false); assert.strictEqual(z.ratio(), 1);
  frame(z, view(3.6), 32); assert.ok(other.style.transform.indexOf('scale(' + 3.6 / 3 + ')') > 0, 'later stretches go to the new canvas, from the new base');
  assert.ok(el.style.transform === 'none' || el.style.transform.indexOf('scale(1.5)') > 0, 'the old canvas is left alone');
});
test('a scale that is only creeping (an easing tail) is not a zoom: the real frame comes after the settle time', () => {
  const { z } = mk(); frame(z, view(2), 0); frame(z, view(2.4), 16);
  let s = 2.4, t = 16; for (let i = 0; i < 6; i++) { s *= 1.0005; t += 16; frame(z, view(s), t); }       // 0.05 percent a frame: invisible
  assert.strictEqual(frame(z, view(s * 1.0005), 16 + 130), true, 'drawn once 120 ms have passed since the last real movement, creep or not');
  const { z: z2 } = mk(); frame(z2, view(2), 0); let u = 2, tt = 0; for (let i = 0; i < 12; i++) { u *= 1.02; tt += 16; assert.strictEqual(frame(z2, view(u), tt), false, 'a steady zoom of 2 percent a frame is still a zoom'); }
});
test('place() moves the stretched picture to follow a pan without ending the zoom or changing the base', () => {
  const { z, el } = mk(); frame(z, view(2), 0); frame(z, view(2.4), 16); const before = el.style.transform;
  const panned = view(2.4, view(2.4).ox + 50, view(2.4).oy - 20); z.place(panned);
  const r = 1.2, d = view(2); assert.strictEqual(el.style.transform, 'translate(' + (panned.ox - d.ox * r) + 'px, ' + (panned.oy - d.oy * r) + 'px) scale(' + r + ')');
  assert.notStrictEqual(el.style.transform, before); assert.strictEqual(z.active(), true);
});
if (failed) { console.log(failed + ' failed'); process.exit(1); } else console.log('all passed');
