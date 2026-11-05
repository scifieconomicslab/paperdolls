/* Drives the built viewer page headlessly: load a scene file, pan, zoom, change region and look, load bad files.
 * Needs jsdom and the node 'canvas' package (npm install jsdom canvas). Usage: node viz/test_viewer.js scene.json
 * Exits 0 and prints SKIP when jsdom is not installed. */
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); } catch (e) { console.log('SKIP (jsdom not installed)'); process.exit(0); }
const fs = require('fs'), path = require('path'), assert = require('assert');
const errs = [], vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push((e.detail && e.detail.stack) || e.message)); vc.on('error', e => errs.push(String(e)));
const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'viewer_built.html'), 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, resources: 'usable' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Wait for a condition, never for a fixed time: a loaded CI runner is several times slower than a laptop, and a test that counts on 500 ms is a flaky test.
const until = async (cond, ms = 15000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await sleep(20); return cond(); };
(async () => {
  assert(await until(() => dom.window.labViewer && dom.window.labViewer.frames() > 2), 'the viewer started and drew frames');
  const w = dom.window, d = w.document, cv = d.getElementById('stage');
  const frames = async n => { const f0 = w.labViewer.frames(); assert(await until(() => w.labViewer.frames() >= f0 + n), 'the viewer keeps drawing frames'); };
  Object.defineProperty(cv, 'clientWidth', { value: 1200 }); Object.defineProperty(cv, 'clientHeight', { value: 700 }); w.dispatchEvent(new w.Event('resize'));
  const text = d.getElementById('attrib'), stats = d.getElementById('bstats');
  const load = async (body, name) => { const inp = d.getElementById('sceneFile'); Object.defineProperty(inp, 'files', { value: [new w.File([body], name)], configurable: true }); const before = stats.textContent + '|' + text.textContent; inp.dispatchEvent(new w.Event('change')); assert(await until(() => stats.textContent + '|' + text.textContent !== before), 'the page answered the file: ' + name); await frames(4); };
  const ev = (id, v) => { const el = d.getElementById(id); if (v !== undefined) el.value = v; el.dispatchEvent(new w.Event('change')); };
  assert(/Placeholder scene/.test(text.textContent), 'starts on the placeholder');

  const scene = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  await load(JSON.stringify(scene), 'scene.json');
  assert(text.textContent.includes(scene.area.name) && text.textContent.includes('OpenStreetMap contributors'), 'attribution shown: ' + text.textContent.slice(0, 80));
  assert(text.textContent.includes(scene.area.rotation_deg + ' degrees') && text.textContent.includes(scene.area.north_on_screen_deg + ' degrees clockwise'), 'rotation and north are explained');
  const m = /OSM scene\. Buildings: (\d+) drawn from assets, (\d+) as generic extrusions/.exec(stats.textContent);
  assert(m && +m[1] + +m[2] === scene.buildings.length && +m[1] > 0, 'stats line counts every building: ' + stats.textContent.slice(0, 120));
  assert(stats.className === 'note', 'no error shown for a valid scene');

  // ---- camera and input, through the real page ----
  const cam = w.labViewer.camera, zoom = d.getElementById('zoom'), W = cv.clientWidth, H = cv.clientHeight;
  const px = (x, y) => { const v = cam.view(); return [v.ox + (x - y) * v.scale * LabC30, v.oy + (x + y) * v.scale * 0.5]; }, LabC30 = 0.8660254;
  const kd = (k, target) => (target || d.body).dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true })), ku = k => d.body.dispatchEvent(new w.KeyboardEvent('keyup', { key: k, bubbles: true }));
  const holdUntil = async (k, cond) => { kd(k); await until(cond); ku(k); await sleep(60); };                  // hold the key until the view has moved enough, however many frames that takes
  w.document.getElementById('fit').click();
  assert(Math.abs(cam.scale - cam.fit) < 1e-9, 'Fit shows the whole scene');

  const [cwx, cwy] = cam.screenToWorld(W / 2, H / 2), s0 = cam.scale;                 // the ground point at the middle of the canvas
  await holdUntil('d', () => px(cwx, cwy)[0] < W / 2 - 100);
  const afterD = px(cwx, cwy)[0];
  assert(afterD < W / 2 - 80 && afterD > W / 2 - 400, 'D moves the view right, so the map slides left by about 520 px per second: ' + (afterD - W / 2));
  await holdUntil('a', () => px(cwx, cwy)[0] > afterD + 90);
  assert(Math.abs(px(cwx, cwy)[0] - afterD) > 80 && px(cwx, cwy)[0] > afterD, 'A moves it back');
  await holdUntil('w', () => cam.scale > s0 * 1.25); assert(cam.scale > s0 * 1.2, 'W zooms in: ' + cam.scale / s0);
  assert(Math.abs(+zoom.value - cam.zoomFraction()) < 0.01, 'the zoom slider follows the camera');
  const sW = cam.scale; await holdUntil('s', () => cam.scale < sW * 0.8); assert(cam.scale < sW * 0.85, 'S zooms out');

  const sel = d.getElementById('look'), x0 = cam.cx; kd('d', sel); await sleep(250); ku('d');
  assert.strictEqual(cam.cx, x0, 'a key pressed in a menu does not pan the map');

  const [ax, ay] = cam.screenToWorld(300, 220), sc = cam.scale;
  const we = new w.Event('wheel', { bubbles: true, cancelable: true }); we.deltaY = -120; we.deltaMode = 0; we.clientX = 300; we.clientY = 220; cv.dispatchEvent(we);
  assert(await until(() => cam.scale > sc && w.labViewer.controls.pendingZoom() === 0), 'the wheel zoom eases in and stops');   // eased over a few frames
  assert(we.defaultPrevented && cam.scale > sc, 'the wheel zooms in and stops the page scrolling');
  assert(Math.abs(px(ax, ay)[0] - 300) < 1e-6 && Math.abs(px(ax, ay)[1] - 220) < 1e-6, 'the point under the cursor stays under the cursor');

  const [gx, gy] = cam.screenToWorld(600, 350), p0 = px(gx, gy);
  const pe = (type, x, y, extra) => { const e = new w.Event(type, { bubbles: true }); Object.assign(e, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0 }, extra); cv.dispatchEvent(e); };
  pe('pointerdown', 100, 100); pe('pointermove', 160, 130); pe('pointerup', 160, 130);
  const p1 = px(gx, gy); assert(Math.abs(p1[0] - p0[0] - 60) < 1e-6 && Math.abs(p1[1] - p0[1] - 30) < 1e-6, 'a drag moves the map by the distance dragged');
  pe('pointerdown', 100, 100, { button: 2 }); pe('pointermove', 300, 300); pe('pointerup', 300, 300);
  assert(Math.abs(px(gx, gy)[0] - p1[0]) < 1e-6, 'the right button does not pan');
  w.document.getElementById('fit').click(); assert(Math.abs(cam.scale - cam.fit) < 1e-9 && Math.abs(+zoom.value) < 0.05, 'Fit returns to the whole scene and the slider follows');

  ev('region', 'se'); await frames(6); ev('look', d.getElementById('look').options[1].value); await frames(6); d.getElementById('rF').click(); await frames(6);
  assert(text.textContent.includes(scene.area.name), 'the scene survives a change of region, look and register');

  await load('{not json', 'bad.json');
  assert(stats.className === 'note err' && /Not a scene file/.test(stats.textContent), 'a file that is not JSON is reported');
  await load(JSON.stringify({ roads: [{ class: 'motorway', pts: [[0, 0]] }], buildings: [], landuse: [], trees: [] }), 'invalid.json');
  assert(/Invalid scene: road 0: unknown class motorway/.test(stats.textContent), 'an invalid scene is reported with a reason');
  assert(text.textContent.includes(scene.area.name), 'the previous scene stays loaded after a bad file');
  d.getElementById('scenePlaceholder').click(); await until(() => /Placeholder scene/.test(text.textContent));
  assert(/Placeholder scene/.test(text.textContent), 'the placeholder button restores the placeholder');
  // a frame that throws must not stop the viewer for good: it is skipped, reported, and the next frame is scheduled
  { const real = w.VizLib.renderFrame; let thrown = 0; w.VizLib.renderFrame = function () { thrown++; throw new Error('boom'); };
    const until = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await sleep(25); return cond(); };       // wait for the condition, not for a time: a loaded CI runner is slow
    assert(await until(() => thrown > 2, 8000), 'the throwing renderer was called on several frames: ' + thrown);
    w.VizLib.renderFrame = real; const f0 = w.labViewer.frames();
    assert(await until(() => w.labViewer.frames() > f0 + 5, 8000), 'frames keep coming after the failures: ' + (w.labViewer.frames() - f0));
    assert(/A frame failed and was skipped: boom/.test(stats.textContent), 'the failure is shown: ' + stats.textContent.slice(0, 80)); }
  errs.length = 0;                                                                     // the expected failures above were caught by the page; none may have escaped it
  await frames(4);
  assert.strictEqual(errs.length, 0, 'no page errors: ' + errs.slice(0, 2).join(' | ').slice(0, 300));
  console.log('PASS viewer: load, attribution, drag, A and D, wheel, W and S, slider, Fit, region, look, register, bad files, placeholder');
  process.exit(0);
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
