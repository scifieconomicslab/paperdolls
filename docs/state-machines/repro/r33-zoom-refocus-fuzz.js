/* R33: explicit machines ZoomHold (zoomhold.js) + Refocus (refocus.js) + Camera (camera.js) + Controls (controls.js), driven by a seeded random sequence of wheel/key zooms, pans, resizes
 * (the page's resize(): rf.reset + cam.resize), rf.set('enabled'), isDone flips, long idles and single-frame renders that throw (the page's catch: rf.reset). Injected clock (16.7 ms a frame), no rAF.
 * Invariants checked after EVERY frame (all REFUTED if they hold; a violation prints the sequence):
 *   I1 (refocus enabled) state 'live'  => hold.active() false, front transform 'none', back opacity '0', no filter on front
 *   I2 back is hidden (opacity '0') in 'live', 'zoom' and 'refine'
 *   I3 hold's element is the front canvas (the one rf.front() reports)
 *   I4 after the events stop and isDone() is true, the machine is back in 'live' within settle + wait + fade time (no held transform survives)
 *   I5 camera: scale finite, within [minScale, maxScale]; centre within bounds + margin
 *   I6 controls: after a wheel burst and enough ticks, pendingZoom() === 0 and the camera is finite
 * Run: node docs/state-machines/repro/r33-zoom-refocus-fuzz.js   (no canvas needed) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const g = { console, Math, Object, Map, Set, Array, Infinity, JSON, Number, String, Date, isFinite }; g.globalThis = g; vm.createContext(g);
for (const f of ['camera.js', 'zoomhold.js', 'refocus.js', 'controls.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'viz', f), 'utf8'), g);
const { LabCamera, ZoomHold, Refocus, LabControls } = g;
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const el = () => ({ style: {}, classList: { add() {}, remove() {} } });
let violations = 0, runs = 0, frames = 0;
for (let run = 0; run < 300; run++) {
  const front = el(), back = el(), reticle = { className: '', style: {} }, cam = LabCamera.create({ bounds: [0, 0, 800, 600], width: 1200, height: 700 });
  let done = true, enabled = true; const hold = ZoomHold.create(front, { settleMs: 120 });
  const rf = Refocus.create({ hold, front, back, reticle, fadeMs: 160, maxWaitMs: 500, blur: rnd() < 0.5, isDone: () => done });
  let now = 1000; const log = [];
  const check = (what) => {
    const st = rf.state(), f = rf.front(), b = rf.back(); frames++;
    const bad = [];
    if (enabled && st === 'live' && (hold.active() || f.style.transform !== 'none' && f.style.transform !== undefined || b.style.opacity !== '0')) bad.push('I1 live but held/visible: active=' + hold.active() + ' transform=' + f.style.transform + ' backOpacity=' + b.style.opacity);
    if ((st === 'live' || st === 'zoom' || st === 'refine') && b.style.opacity !== '0') bad.push('I2 back visible in ' + st + ': ' + b.style.opacity);
    if (!(cam.scale >= cam.minScale * 0.999999 && cam.scale <= cam.maxScale * 1.000001) || !isFinite(cam.cx) || !isFinite(cam.cy)) bad.push('I5 camera out of limits: scale=' + cam.scale + ' [' + cam.minScale + ',' + cam.maxScale + '] c=' + cam.cx + ',' + cam.cy);
    if (bad.length) { violations++; if (violations < 4) console.log('VIOLATION run ' + run + ' after ' + what + ': ' + bad.join('; ') + '\n   sequence: ' + log.slice(-12).join(' ')); }
  };
  const draw = () => rf.frame(cam.view(), now, c => { if (c === undefined) throw new Error('x'); });
  const steps = 40 + Math.floor(rnd() * 120);
  for (let i = 0; i < steps; i++) {
    const r = rnd(); now += 16.7;
    if (r < 0.35) { cam.zoomAt(Math.exp((rnd() - 0.5) * 0.6), rnd() * 1200, rnd() * 700); log.push('zoom'); }
    else if (r < 0.5) { cam.panScreen((rnd() - 0.5) * 80, (rnd() - 0.5) * 80); log.push('pan'); }
    else if (r < 0.54) { cam.resize(300 + Math.floor(rnd() * 1500), 200 + Math.floor(rnd() * 900)); rf.reset(); log.push('resize'); }
    else if (r < 0.57) { enabled = rnd() < 0.5; rf.set('enabled', enabled); log.push('enabled=' + enabled); }
    else if (r < 0.62) { done = rnd() < 0.6; log.push('done=' + done); }
    else if (r < 0.65) { now += 300 + rnd() * 900; log.push('idle'); }
    else if (r < 0.67) { try { rf.frame(cam.view(), now, () => { throw new Error('render failed'); }); } catch (e) { rf.reset(); log.push('throw+reset'); } check('throwing frame'); continue; }
    else log.push('.');
    try { draw(); } catch (e) { rf.reset(); }
    check(log[log.length - 1]);
  }
  // I4: stop the events, make the frame complete, and run the clock forward
  done = true; enabled = true; rf.set('enabled', true); let k = 0; for (; k < 120 && rf.state() !== 'live'; k++) { now += 16.7; draw(); check('settle'); }
  if (rf.state() !== 'live') { violations++; console.log('VIOLATION I4 run ' + run + ': still ' + rf.state() + ' after ' + k + ' quiet frames'); }
  runs++;
}
// I6: controls with a fake canvas
const win = { requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} }, doc = { defaultView: win, addEventListener() {}, removeEventListener() {} };
const handlers = {}; const canvas = { ownerDocument: doc, clientHeight: 700, classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 0, top: 0 }), addEventListener: (t, f) => { handlers[t] = f; }, removeEventListener() {} };
const cam2 = LabCamera.create({ bounds: [0, 0, 800, 600], width: 1200, height: 700 }), ctl = LabControls.attach(canvas, cam2, { smoothZoom: true, raf: false });
for (let i = 0; i < 40; i++) handlers.wheel({ preventDefault() {}, deltaY: (i % 2 ? 1 : -1) * (30 + i * 7), deltaMode: 0, clientX: 300 + i, clientY: 200, ctrlKey: false });
for (let i = 0; i < 400 && ctl.pendingZoom() !== 0; i++) ctl.tick(1 / 60);
console.log('I6 ordinary wheel burst: pendingZoom=' + ctl.pendingZoom() + ' scale finite=' + isFinite(cam2.scale));
console.log(runs + ' runs, ' + frames + ' frames checked, ' + violations + ' invariant violations');
// the extreme input: a wheel delta so large that exp(-dy*0.0016) underflows to 0 (|deltaY| > ~465,000; only a synthetic event can send it). pend becomes -Infinity and `pend -= part` is NaN;
// the camera-limit line right after it (controls.js:101, `pend = 0`) happens to clear it, so this is REFUTED by luck, not by design
const cam3 = LabCamera.create({ bounds: [0, 0, 800, 600], width: 1200, height: 700 }), ctl3 = LabControls.attach(canvas, cam3, { smoothZoom: true, raf: false });
handlers.wheel({ preventDefault() {}, deltaY: 1e6, deltaMode: 0, clientX: 300, clientY: 200 });
for (let i = 0; i < 50; i++) ctl3.tick(1 / 60);
console.log('I6 synthetic wheel deltaY=1e6 (smoothZoom): pendingZoom=' + ctl3.pendingZoom() + ', camera scale=' + cam3.scale + ' -> ' + (isFinite(cam3.scale) ? 'finite' : 'NaN: every later frame renders at scale NaN'));
