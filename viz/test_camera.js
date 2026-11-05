/* Tests for camera.js and controls.js. Plain Node, no packages: the DOM is a small fake.
 * Run: node viz/test_camera.js */
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const g = { console, Math, Object, Map, Array, Set, JSON, Date, Infinity }; g.globalThis = g; vm.createContext(g);
for (const f of ['camera.js', 'controls.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const { LabCamera, LabControls } = g;
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= (tol || 1e-6), (msg || 'values differ') + ': ' + a + ' vs ' + b);

const BOUNDS = [0, 0, 800, 600], W = 1200, H = 700, C30 = LabCamera.C30;
const fresh = () => LabCamera.create({ bounds: BOUNDS, width: W, height: H });
const project = (cam, x, y) => { const v = cam.view(); return [v.ox + (x - y) * v.scale * C30, v.oy + (x + y) * v.scale * 0.5]; };
// zoom in a little and move off-centre, so a test never runs against the trivial starting view
function inside(cam) { cam.zoomTo(cam.fit * 3); cam.panScreen(-150, 90); return cam; }

// ================= camera =================
test('the starting view fits the whole scene inside the canvas', () => {
  const cam = fresh();
  for (const [x, y] of [[0, 0], [800, 0], [800, 600], [0, 600]]) { const [sx, sy] = project(cam, x, y); assert(sx >= 0 && sx <= W && sy >= 0 && sy <= H, 'corner ' + x + ',' + y + ' at ' + sx + ',' + sy); }
  near(cam.scale, cam.fit, 1e-12); near(cam.cx, 400); near(cam.cy, 300);
});

test('screenToWorld is the inverse of the projection', () => {
  const cam = inside(fresh());
  for (const [x, y] of [[100, 200], [640, 90], [333, 555]]) { const [sx, sy] = project(cam, x, y), [wx, wy] = cam.screenToWorld(sx, sy); near(wx, x, 1e-6); near(wy, y, 1e-6); }
});

test('a drag moves the map by exactly the distance dragged', () => {
  const cam = inside(fresh()), [wx, wy] = cam.screenToWorld(600, 350), before = project(cam, wx, wy);
  cam.panScreen(40, -25);
  const after = project(cam, wx, wy);
  near(after[0] - before[0], 40, 1e-6, 'x'); near(after[1] - before[1], -25, 1e-6, 'y');
});

test('panView is the opposite of panScreen: moving the view left slides the map right', () => {
  const cam = inside(fresh()), [wx, wy] = cam.screenToWorld(600, 350), before = project(cam, wx, wy);
  cam.panView(-30, 0);
  near(project(cam, wx, wy)[0] - before[0], 30, 1e-6);
});

test('zoom keeps the point under the cursor where it is', () => {
  const cam = inside(fresh());
  for (const [px, py, f] of [[200, 120, 1.7], [1000, 600, 0.6], [W / 2, H / 2, 2.1], [10, 690, 1.3]]) {
    const [wx, wy] = cam.screenToWorld(px, py), s0 = cam.scale;
    cam.zoomAt(f, px, py);
    const [sx, sy] = project(cam, wx, wy);
    near(sx, px, 1e-6, 'x at factor ' + f); near(sy, py, 1e-6, 'y at factor ' + f);
    assert(Math.abs(cam.scale / s0 - f) < 1e-9 || cam.scale === cam.minScale || cam.scale === cam.maxScale, 'the factor applies unless a limit stops it');
  }
});

test('zooming in and then out by the same factor returns to the same view', () => {
  const cam = inside(fresh()), s = cam.scale, cx = cam.cx, cy = cam.cy;
  cam.zoomAt(1.5, 300, 200); cam.zoomAt(1 / 1.5, 300, 200);
  near(cam.scale, s, 1e-9); near(cam.cx, cx, 1e-6); near(cam.cy, cy, 1e-6);
});

test('the scale cannot leave its limits, however hard the zoom', () => {
  const cam = fresh();
  cam.zoomAt(1e9, 100, 100); assert.strictEqual(cam.scale, cam.maxScale);
  cam.zoomAt(1e-9, 100, 100); assert.strictEqual(cam.scale, cam.minScale);
  near(cam.minScale, cam.fit * 0.85, 1e-12);
});

test('the centre cannot be dragged far from the scene', () => {
  const cam = fresh();
  cam.panScreen(1e7, 1e7); assert(cam.cx >= -160 - 1e-6 && cam.cx <= 960 + 1e-6 && cam.cy >= -120 - 1e-6 && cam.cy <= 720 + 1e-6, 'centre ' + cam.cx + ',' + cam.cy);
  cam.panScreen(-1e7, -1e7); assert(cam.cx >= -160 - 1e-6 && cam.cx <= 960 + 1e-6 && cam.cy >= -120 - 1e-6 && cam.cy <= 720 + 1e-6);
});

test('the zoom fraction runs 0 to 1 and round-trips', () => {
  const cam = fresh();
  cam.setZoomFraction(0); assert.strictEqual(cam.scale, cam.minScale); near(cam.zoomFraction(), 0, 1e-9);
  cam.setZoomFraction(1); near(cam.scale, cam.maxScale, 1e-9); near(cam.zoomFraction(), 1, 1e-9);
  cam.setZoomFraction(0.37); near(cam.zoomFraction(), 0.37, 1e-9);
});

test('a new scene refits and recentres; a resize keeps the centre and respects the limits', () => {
  const cam = inside(fresh());
  cam.setBounds([1000, 1000, 1400, 1300]);
  near(cam.cx, 1200); near(cam.cy, 1150); near(cam.scale, cam.fit, 1e-12);
  assert(cam.fit > fresh().fit * 1.5, 'a smaller scene fits at a larger scale');
  const cx = cam.cx, cy = cam.cy; cam.zoomTo(cam.fit * 2); cam.resize(800, 500);
  near(cam.cx, cx, 1e-6); near(cam.cy, cy, 1e-6); assert(cam.scale >= cam.minScale && cam.scale <= cam.maxScale);
});

// ================= controls, on a fake DOM =================
function fakeDom(opts) {
  const mk = () => { const l = {}; return { l, addEventListener(t, f) { (l[t] = l[t] || []).push(f); }, removeEventListener(t, f) { l[t] = (l[t] || []).filter(x => x !== f); },
    fire(t, e) { e = Object.assign({ type: t, preventDefault() { this.prevented = true; }, target: null }, e); (l[t] || []).slice().forEach(f => f(e)); return e; }, count: t => (l[t] || []).length }; };
  const win = mk(), doc = mk(), canvas = mk(), frames = [];
  win.requestAnimationFrame = f => { frames.push(f); return frames.length; }; win.cancelAnimationFrame = () => { frames.length = 0; };
  doc.defaultView = win; canvas.ownerDocument = doc; canvas.clientHeight = H;
  const cls = new Set(); canvas.classList = { add: c => cls.add(c), remove: c => cls.delete(c), has: c => cls.has(c) };
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
  canvas.setPointerCapture = () => {};
  return { win, doc, canvas, frames };
}
function setup(o) {
  const dom = fakeDom(), cam = inside(fresh()); let changes = 0;
  const controls = LabControls.attach(dom.canvas, cam, Object.assign({ raf: false, onChange: () => changes++ }, o || {}));
  return Object.assign(dom, { cam, controls, changes: () => changes });
}
const held = d => Array.from(d.controls.held());          // arrays made inside the sandbox have another prototype
const key = (d, k, extra) => d.doc.fire('keydown', Object.assign({ key: k, target: { tagName: 'BODY' } }, extra));
const keyUp = (d, k) => d.doc.fire('keyup', { key: k });

test('dragging with the left button pans, and stops when the button is released', () => {
  const d = setup(), [wx, wy] = d.cam.screenToWorld(500, 300), before = project(d.cam, wx, wy);
  d.canvas.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
  assert(d.canvas.classList.has('dragging'));
  d.canvas.fire('pointermove', { pointerId: 1, clientX: 160, clientY: 130 });
  const after = project(d.cam, wx, wy);
  near(after[0] - before[0], 60, 1e-6); near(after[1] - before[1], 30, 1e-6);
  d.canvas.fire('pointerup', { pointerId: 1 }); assert(!d.canvas.classList.has('dragging'));
  const c = d.changes(); d.canvas.fire('pointermove', { pointerId: 1, clientX: 400, clientY: 400 }); assert.strictEqual(d.changes(), c, 'no pan after release');
});

test('the right mouse button does not pan', () => {
  const d = setup(), cx = d.cam.cx;
  d.canvas.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 100, clientY: 100 });
  d.canvas.fire('pointermove', { pointerId: 1, clientX: 200, clientY: 200 });
  assert.strictEqual(d.cam.cx, cx);
});

test('the wheel zooms about the cursor and stops the page scrolling', () => {
  const d = setup(), px = 300, py = 220, [wx, wy] = d.cam.screenToWorld(px, py), s0 = d.cam.scale;
  const e = d.canvas.fire('wheel', { deltaY: -120, deltaMode: 0, clientX: px, clientY: py });
  assert(e.prevented, 'preventDefault');
  assert(d.cam.scale > s0, 'a wheel up zooms in');
  const [sx, sy] = project(d.cam, wx, wy); near(sx, px, 1e-6); near(sy, py, 1e-6);
  const s1 = d.cam.scale; d.canvas.fire('wheel', { deltaY: 120, deltaMode: 0, clientX: px, clientY: py }); assert(d.cam.scale < s1, 'a wheel down zooms out');
});

test('wheel units are normalised: a notch counted in lines zooms like the same distance in pixels', () => {
  const a = setup(), b = setup(), c = setup();
  a.canvas.fire('wheel', { deltaY: -3, deltaMode: 1, clientX: 500, clientY: 300 });
  b.canvas.fire('wheel', { deltaY: -48, deltaMode: 0, clientX: 500, clientY: 300 });
  near(a.cam.scale, b.cam.scale, 1e-9);
  c.canvas.fire('wheel', { deltaY: -48, deltaMode: 0, ctrlKey: true, clientX: 500, clientY: 300 });
  assert(c.cam.scale > b.cam.scale, 'a trackpad pinch (ctrlKey) takes a bigger step');
});

test('A and D pan at a steady speed; D moves the view right so the map slides left', () => {
  const d = setup(), [wx, wy] = d.cam.screenToWorld(600, 350), x0 = project(d.cam, wx, wy)[0];
  key(d, 'd'); assert.deepStrictEqual(held(d), ['right']);
  d.controls.tick(0.5); near(project(d.cam, wx, wy)[0] - x0, -260, 1e-6, '520 px per second for half a second');
  keyUp(d, 'd'); key(d, 'a'); d.controls.tick(0.5); near(project(d.cam, wx, wy)[0] - x0, 0, 1e-6, 'A undoes it');
});

test('W zooms in and S zooms out about the middle of the canvas', () => {
  const d = setup(), s0 = d.cam.scale, mid = d.cam.screenToWorld(W / 2, H / 2);
  key(d, 'w'); d.controls.tick(0.5); near(d.cam.scale, s0 * Math.exp(0.45), 1e-9);
  const [sx, sy] = project(d.cam, mid[0], mid[1]); near(sx, W / 2, 1e-6); near(sy, H / 2, 1e-6);
  keyUp(d, 'w'); key(d, 's'); d.controls.tick(0.5); near(d.cam.scale, s0, 1e-9);
});

test('held keys are tracked, capital letters work, and opposite keys cancel', () => {
  const d = setup(), cx = d.cam.cx, cy = d.cam.cy;
  key(d, 'D'); key(d, 'A'); assert.deepStrictEqual(held(d), ['left', 'right']);
  d.controls.tick(0.2); near(d.cam.cx, cx, 1e-9); near(d.cam.cy, cy, 1e-9);
  keyUp(d, 'D'); keyUp(d, 'a'); assert.deepStrictEqual(held(d), []);
});

test('keys are ignored in text fields and menus, with Ctrl held, and for other keys', () => {
  const d = setup();
  key(d, 'd', { target: { tagName: 'INPUT', type: 'text' } }); key(d, 'd', { target: { tagName: 'SELECT' } }); key(d, 'd', { target: { tagName: 'TEXTAREA' } });
  key(d, 'd', { target: { tagName: 'DIV', isContentEditable: true } }); key(d, 'd', { target: { tagName: 'INPUT', type: 'number' } });
  key(d, 'd', { ctrlKey: true }); key(d, 'd', { metaKey: true }); key(d, 'd', { altKey: true }); key(d, 'ArrowLeft'); key(d, 'x');
  assert.deepStrictEqual(held(d), []);
  key(d, 'd', { target: { tagName: 'INPUT', type: 'range' } }); assert.deepStrictEqual(held(d), ['right'], 'a slider does not swallow letters');
  assert(LabControls.isTyping({ tagName: 'input', type: 'search' }) && !LabControls.isTyping({ tagName: 'INPUT', type: 'checkbox' }) && !LabControls.isTyping({ tagName: 'BUTTON' }));
});

test('losing the window focus releases every key', () => {
  const d = setup(); key(d, 'd'); key(d, 'w'); assert.strictEqual(held(d).length, 2);
  d.win.fire('blur'); assert.deepStrictEqual(held(d), []);
});

test('motion does not depend on the frame rate', () => {
  const a = setup(), b = setup(); key(a, 'd'); key(b, 'd'); key(a, 'w'); key(b, 'w');
  a.controls.tick(0.5); for (let i = 0; i < 30; i++) b.controls.tick(0.5 / 30);
  near(a.cam.scale, b.cam.scale, 1e-9, 'zoom is exactly rate independent, even while panning');
  const p = setup(), q = setup(); key(p, 'd'); key(q, 'd'); p.controls.tick(0.6); for (let i = 0; i < 36; i++) q.controls.tick(0.6 / 36);
  near(p.cam.cx, q.cam.cx, 1e-9, 'pure pan is exactly rate independent'); near(p.cam.cy, q.cam.cy, 1e-9);
  // panning while zooming is not: the scale changes under the pan. That is expected, and is not tested for equality.
});

test('the animation loop runs while a key is held and stops after it is released', () => {
  const d = setup({ raf: true }), x0 = d.cam.cx;
  key(d, 'd'); assert.strictEqual(d.frames.length, 1, 'one frame requested');
  let cb = d.frames.pop(); cb(1000); assert.strictEqual(d.frames.length, 1, 'it asks for the next frame'); near(Math.abs(d.cam.cx - x0) > 0 ? 1 : 0, 1, 0, 'the first frame moves the view');
  cb = d.frames.pop(); cb(1016); const moved = d.cam.cx;
  keyUp(d, 'd'); cb = d.frames.pop(); cb(1032); assert.strictEqual(d.frames.length, 0, 'no further frame once nothing is held'); assert.strictEqual(d.cam.cx, moved, 'and no further movement');
  key(d, 'd'); cb = d.frames.pop(); cb(5000); cb = d.frames.pop(); const before = d.cam.cx; cb(9000);
  assert(Math.abs(d.cam.cx - before) < 520 * 0.05 * 1.01 * 4, 'a long pause between frames cannot make the view jump');
});

test('two fingers moving apart zoom in, and the midpoint stays put', () => {
  const d = setup(), s0 = d.cam.scale, [wx, wy] = d.cam.screenToWorld(600, 350);
  d.canvas.fire('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 550, clientY: 350 });
  d.canvas.fire('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 650, clientY: 350 });
  d.canvas.fire('pointermove', { pointerId: 1, clientX: 500, clientY: 350 });
  d.canvas.fire('pointermove', { pointerId: 2, clientX: 700, clientY: 350 });
  assert(d.cam.scale > s0 * 1.5, 'the scale grew: ' + (d.cam.scale / s0));
  const [sx, sy] = project(d.cam, wx, wy); near(sx, 600, 3, 'x'); near(sy, 350, 3, 'y');
});

test('destroy removes every listener', () => {
  const d = setup(), cx = d.cam.cx; d.controls.destroy();
  assert.strictEqual(d.canvas.count('wheel') + d.canvas.count('pointerdown') + d.doc.count('keydown') + d.win.count('blur'), 0);
  key(d, 'd'); d.canvas.fire('wheel', { deltaY: -100, clientX: 1, clientY: 1 }); assert.strictEqual(d.cam.cx, cx);
});

console.log(passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);
