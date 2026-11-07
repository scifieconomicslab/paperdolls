/* Regression tests for the pack runtime layer (store, worker client, run controller, play clock, A/B compare, inspector), one group per fixed issue.
 * They are the repros of docs/state-machines/repro/ (r01..r13) turned into assertions: each failed on `main` aa2d936 before its fix (see the commit messages).
 * The real PackWorker.createServer, PackRuntime, PackStore, PackHost.createController and PackDash.createCompare run in Node; only the thread boundary and the event loop are
 * faked by the harness (docs/state-machines/repro/_harness.js: queued messages, a yield promise the test releases by hand, no timers).
 * The mountUI cases need jsdom (the ones that do skip without it).
 * Run: node viz/test_pack_runtime.js */
const path = require('path'), assert = require('assert');
let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (e) { try { ({ JSDOM } = require(path.join(process.env.PAPERDOLLS_NODE_MODULES || 'node_modules', 'jsdom'))); } catch (e2) { JSDOM = null; } }
const H = require(path.join(__dirname, '..', 'docs', 'state-machines', 'repro', '_harness.js')), { G } = H;
let failed = 0, skipped = 0; const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const testDom = (name, fn) => queue.push([name, JSDOM ? fn : () => { throw Object.assign(new Error('jsdom'), { skip: true }); }]);
const quiet = () => { console.error = () => {}; console.warn = () => {}; };
const state = p => { let s = 'pending'; p.then(() => { s = 'resolved'; }, e => { s = 'rejected(' + e.message + ')'; }); return () => s; };
const settleStart = async (env, ctl) => { const p = ctl.start(); await env.drain(); await env.yieldAll(); await p; };

// A page-like set-up: store A on a controller, a compare B, the real mountUI over the compare's view, the inspector wired through compare.inspect as packhost.html does.
async function pageWithCompare(o) {
  o = o || {};
  const env = H.makeEnv(Object.assign({ chunk: 40 }, o.env || {}));
  env.manifest.mappings = [{ entity: 'thing', field: 'load', channel: 'wall', scale: { type: 'sequential', label: 'Load', colours: ['#000000', '#ffffff'], domain: [0, 1000] } }];       // the tooltip leads with the wall field
  env.manifest.layout = { left: [{ control: 'params' }], right: [{ control: 'legend' }], bottom: [{ control: 'timeline' }, { control: 'compare' }] };
  const A = G.PackStore.create(env.manifest), runtime = env.worker(), ctl = G.PackHost.createController({ manifest: env.manifest, runtime, store: A });
  await settleStart(env, ctl);
  const cmp = G.PackDash.createCompare({ manifest: env.manifest, store: A, createRuntime: () => env.worker(), schedule() {} });
  const orig = ctl.inspect; ctl.inspect = sel => cmp.inspect(sel, orig);
  const doc = new JSDOM('<!doctype html><body><div id=l></div><div id=r></div><div id=b></div><div id=m></div><div id=tip hidden></div></body>').window.document, $ = id => doc.getElementById(id);
  const view = cmp.viewStore;
  const ui = G.PackHost.mountUI({ manifest: env.manifest, store: view, controller: ctl, compare: cmp, register: 'colorfigures', doc, regions: { left: $('l'), right: $('r'), bottom: $('b'), inspector: $('m') }, display: [] });
  cmp.enable(true); await env.drain(); await env.yieldAll();
  const dd = () => [...doc.querySelectorAll('.pk-inspector dl.pk-fields:not(.pk-extra) dd')].map(x => x.textContent).join(' | ');
  const extra = () => [...doc.querySelectorAll('.pk-inspector dl.pk-extra dd')].map(x => x.textContent);
  const readout = () => (doc.querySelector('.pk-readout') || {}).textContent;
  return { env, A, ctl, cmp, view, doc, $, ui, dd, extra, readout };
}

// =====================================================================================================================================================
// Issue #4: what is on screen is one run; the inspector, the readout and the tooltip follow it; a failed B is visible
// =====================================================================================================================================================

// r09 / B-1
testDom('#4 r09: flipping A/B redraws the inspector rows, the readout and asks the model of the run now on screen', async () => {
  const P = await pageWithCompare();
  P.view.select({ entity: 'thing', id: 0 }); await P.env.drain();
  assert.strictEqual(P.view.frame().entities.thing.load[0].toFixed(0), '500');
  assert.strictEqual(P.dd(), 'a | 500'); assert.strictEqual(P.extra()[0], '0.5'); assert(/load 500/.test(P.readout()), P.readout());
  assert(P.cmp.showing === 'a');
  P.cmp.show('b'); await P.env.drain();
  assert.strictEqual(P.view.frame().entities.thing.load[0].toFixed(0), '200');
  assert.strictEqual(P.dd(), 'a | 200', 'frame rows follow the flip at once: ' + P.dd());
  assert.strictEqual(P.extra()[0], '0.2', 'the model rows come from the B run: ' + P.extra());
  assert(/load 200/.test(P.readout()), 'readout follows the flip: ' + P.readout());
  P.cmp.show('a'); await P.env.drain();
  assert.strictEqual(P.dd(), 'a | 500'); assert.strictEqual(P.extra()[0], '0.5'); assert(/load 500/.test(P.readout()));
});
testDom('#4 r09: the hover tooltip follows an A/B flip', async () => {
  const P = await pageWithCompare();
  const tip = P.$('tip'), box = P.doc.createElement('div'); box.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const binding = { entity: 'thing', modelOf: Int32Array.from([0, 1, 2, 3, 4]), count: 5, index: Int32Array.from([0, 1, 2, 3, 4]), sceneInfo: null }, pick = { hit: () => 0, silhouette: () => null };
  const inter = G.PackHost.bindInteraction({ manifest: P.env.manifest, store: P.view, sim: {}, binding, pick, box, camera: { view: () => ({}) }, doc: P.doc, tip, controller: P.ctl });
  const ev = new (P.doc.defaultView.Event)('pointermove'); ev.clientX = 5; ev.clientY = 5; box.dispatchEvent(ev);
  assert(/500/.test(tip.textContent), tip.textContent);
  P.cmp.show('b');
  assert(/200/.test(tip.textContent) && !/500/.test(tip.textContent), 'tooltip after the flip: ' + tip.textContent);
  inter.dispose();
});

// r11 / I-1
test('#4 r11: while a re-run is in flight the controller does not answer inspect from the new run', async () => {
  const { env, store, ctl } = H.makePage({ chunk: 8 });
  await settleStart(env, ctl);
  store.setTime(30); store.setParam('rate', 0.8); ctl.flush(); await env.drain();            // the worker is at t=8 of the new run; the store still shows the rate-0.5 run
  assert.strictEqual(H.frameLoad(store, 30), 530);
  let held; const q = ctl.inspect({ entity: 'thing', id: 0 }).then(d => { held = d; }); await env.drain(); await q;
  assert(!held || !held.fields || held.stale, 'an answer for the run being computed must not be offered for the run on screen: ' + JSON.stringify(held));
  assert.strictEqual(ctl.shown !== ctl.gen, true, 'the controller knows the run on screen is not the run being computed');
  await env.yieldAll();
  assert.strictEqual(ctl.shown, ctl.gen);
  let after; const q2 = ctl.inspect({ entity: 'thing', id: 0 }).then(d => { after = d; }); await env.drain(); await q2;
  assert.strictEqual(after.fields[0].value, 0.8, 'once the new run is on screen the model speaks for it');
});
testDom('#4 r11: the inspector keeps the old run\'s rows while a re-run is in flight and shows the new run\'s once it replaced them', async () => {
  const P = await pageWithCompare({ env: { chunk: 8 } });
  P.view.setTime(30); P.view.select({ entity: 'thing', id: 0 }); await P.env.drain();
  assert.strictEqual(P.extra()[0], '0.5');
  P.A.setParam('rate', 0.8); P.ctl.flush(); await P.env.drain();
  P.view.setTime(31); await P.env.drain();                                  // the clock ticking while the re-run is computed asks the model again
  assert.strictEqual(P.dd(), 'b | 531', 'the frame still belongs to the old run');
  assert.strictEqual(P.extra()[0], '0.5', 'the model rows must still describe the old run, not the partial new one: ' + P.extra());
  await P.env.yieldAll(); await P.env.drain();
  assert.strictEqual(P.dd(), 'b | 831'); assert.strictEqual(P.extra()[0], '0.8'); assert.strictEqual(P.extra()[2], '40', 'the new run is complete: ' + P.extra());
});
test('#4: the run on screen has an id that changes when its frames are replaced', async () => {
  const { env, store, ctl } = H.makePage({ chunk: 8 });
  await settleStart(env, ctl); const a = store.runId();
  store.setParam('rate', 0.8); ctl.flush(); await env.drain(); await env.yieldAll();
  assert.notStrictEqual(store.runId(), a);
});

// r02 / C-2
test('#4 r02: a later B failure is reported, B\'s old run is not presented under the new label and the differences do not describe it', async () => {
  quiet();
  const env = H.makeEnv({ impl: H.makeImpl({ failAbove: 0.9 }) });
  const A = G.PackStore.create(env.manifest), ctlA = G.PackHost.createController({ manifest: env.manifest, runtime: env.worker(), store: A });
  await settleStart(env, ctlA);
  const cmp = G.PackDash.createCompare({ manifest: env.manifest, store: A, createRuntime: () => env.worker(), schedule() {} });
  const changes = []; cmp.onChange(w => changes.push(w));
  cmp.enable(true); await env.drain(); await env.yieldAll();
  assert.strictEqual(cmp.error, null); assert.strictEqual(H.frameLoad(cmp.B, 5), 205);
  cmp.setB({ preset: 'bad' }); cmp.flush(); await env.drain(); await env.yieldAll();
  assert(/comparison run failed.*refuses rate 0\.95/.test(cmp.error), 'cmp.error: ' + cmp.error);
  assert(changes.includes('error'), 'listeners are told: ' + changes);
  assert.deepStrictEqual(cmp.differences(), [], 'B has no run for the new settings, so there is nothing to compare');
  assert.strictEqual(cmp.bOk(), false);
  assert(/Low/.test(cmp.bLabel()) && /fail/.test(cmp.bLabel()) && !/Bad/.test(cmp.bLabel().replace(/fail.*/, '')), 'the badge says which run it really shows: ' + cmp.bLabel());
  // recovery: a legal preset clears the error and the label
  changes.length = 0; cmp.setB({ preset: 'low' }); cmp.flush(); await env.drain(); await env.yieldAll();
  assert.strictEqual(cmp.error, null); assert(changes.includes('error')); assert.strictEqual(cmp.bOk(), true); assert.strictEqual(cmp.bLabel(), 'Low');
  assert.strictEqual(cmp.differences().length, 1);
});
test('#4 r02: a B failure in its first start is also cleared once B recovers', async () => {
  quiet();
  const env = H.makeEnv({ impl: H.makeImpl({ failAbove: 0.9 }) });
  const A = G.PackStore.create(env.manifest), ctlA = G.PackHost.createController({ manifest: env.manifest, runtime: env.worker(), store: A });
  await settleStart(env, ctlA);
  const cmp = G.PackDash.createCompare({ manifest: env.manifest, store: A, createRuntime: () => env.worker(), schedule() {} });
  cmp.setB({ preset: 'bad' }); cmp.enable(true); await env.drain(); await env.yieldAll();
  assert(/comparison run failed/.test(cmp.error), String(cmp.error));
  cmp.setB({ preset: 'low' }); cmp.flush(); await env.drain(); await env.yieldAll();
  assert.strictEqual(cmp.error, null);
});

// =====================================================================================================================================================
// Issue #5: failures are seen: a silent or dead worker, a failing callback, a short run, a setParams that throws
// =====================================================================================================================================================
function fakeTimers() {
  let now = 0, id = 0; const t = new Map();
  return { set(fn, ms) { const i = ++id; t.set(i, { fn, at: now + ms }); return i; }, clear(i) { t.delete(i); }, pending: () => t.size,
    advance(ms) { now += ms; for (const [i, x] of [...t]) if (x.at <= now) { t.delete(i); x.fn(); } } };
}
const inlineOf = env => ({ chunk: 8, yieldFn: () => new Promise(r => env.yields.push(r)) });
const pageWith = (env, extra) => { const store = G.PackStore.create(env.manifest), tm = fakeTimers(), runtime = env.worker(Object.assign({ mode: 'auto', timers: tm, timeoutMs: 1000, server: inlineOf(env) }, extra || {})); return { store, tm, runtime, ctl: G.PackHost.createController({ manifest: env.manifest, runtime, store }) }; };

// r05 a / T-1: nothing answers init
test('#5 r05a: a worker that never answers init is replaced by the main thread after the timeout and the run completes', async () => {
  quiet(); const env = H.makeEnv({ chunk: 8 }); env.silentInit = true; const { store, tm, runtime, ctl } = pageWith(env);
  const p = ctl.start(); await env.drain(); assert.strictEqual(ctl.running, true);
  tm.advance(1000); await env.drain(); await env.yieldAll(); await p;
  assert.strictEqual(ctl.error, null); assert.strictEqual(store.length(), 41); assert.strictEqual(runtime.mode, 'inline'); assert(/did not answer/.test(runtime.fellBack), String(runtime.fellBack));
  assert.strictEqual(ctl.running, false); assert.deepStrictEqual(env.URL.revoked, ['blob:fake/1']); assert.strictEqual(tm.pending(), 0, 'no timer outlives the work');
});
test('#5 r05a: with mode "worker" (no fallback) a silent worker ends the run with a visible error, and later requests fail at once instead of hanging', async () => {
  quiet(); const env = H.makeEnv({ chunk: 8 }); env.silentInit = true; const { store, tm, ctl } = pageWith(env, { mode: 'worker' });
  const p = ctl.start(); await env.drain(); tm.advance(1000); await env.drain(); await p;
  assert(/did not answer/.test(ctl.error), String(ctl.error)); assert.strictEqual(ctl.running, false);
  store.setParam('rate', 0.7); ctl.flush(); await env.drain();
  assert.strictEqual(ctl.running, false, 'the next slider move does not hang'); assert(/did not answer/.test(ctl.error));
});
// r05 c: the worker dies after it was ready
test('#5 r05c: a worker that dies silently in a run is replaced by the main thread; the run is repeated and the page says so', async () => {
  quiet(); const env = H.makeEnv({ chunk: 8 }); const { store, tm, runtime, ctl } = pageWith(env);
  const p = ctl.start(); await env.drain(); env.workers[0].crash();
  tm.advance(1000); await env.drain(); await env.yieldAll(); await env.drain(); await env.yieldAll(); await p;
  assert.strictEqual(ctl.error, null); assert.strictEqual(store.length(), 41); assert.strictEqual(runtime.mode, 'inline'); assert.strictEqual(ctl.mode, 'inline', 'ctl.mode follows the adapter');
  assert(/main thread/.test(ctl.notice), String(ctl.notice)); assert.strictEqual(ctl.running, false); assert.strictEqual(tm.pending(), 0);
});
test('#5 r05c: a worker that reports an error and dies: the run falls back to the main thread, the next slider move works', async () => {
  quiet(); const env = H.makeEnv({ chunk: 8 }); const { store, tm, ctl } = pageWith(env);
  let p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  const w = env.workers[0]; store.setParam('rate', 0.6); ctl.flush(); await env.drain();
  w.fail('worker out of memory'); w.crash(); await env.drain(); await env.yieldAll(); await env.drain(); await env.yieldAll();
  assert.strictEqual(ctl.error, null); assert.strictEqual(ctl.running, false); assert.strictEqual(H.frameLoad(store, 3), 603);
  store.setParam('rate', 0.7); ctl.flush(); await env.drain(); await env.yieldAll();
  assert.strictEqual(ctl.running, false); assert.strictEqual(store.length(), 41); assert.strictEqual(H.frameLoad(store, 3), 703);
});
test('#5 r05c: with mode "worker" the error is shown and a later request is refused with it, not posted to the dead worker', async () => {
  quiet(); const env = H.makeEnv({ chunk: 8 }); const { store, ctl } = pageWith(env, { mode: 'worker' });
  let p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  const w = env.workers[0]; store.setParam('rate', 0.6); ctl.flush(); await env.drain(); w.fail('worker out of memory'); w.crash(); await env.drain();
  assert(/out of memory/.test(ctl.error)); assert.strictEqual(ctl.running, false);
  const posted = env.toServer.length; store.setParam('rate', 0.7); ctl.flush(); await env.drain();
  assert.strictEqual(env.toServer.length, posted, 'nothing is sent to the dead worker'); assert.strictEqual(ctl.running, false); assert(/out of memory/.test(ctl.error));
});
// r05 b / T-2
test('#5 r05b: after dispose() every request is rejected, the Blob URL is revoked once and no timer is left', async () => {
  const env = H.makeEnv(), tm = fakeTimers(), rt = env.worker({ timers: tm, timeoutMs: 1000 });
  await env.drain(); rt.dispose(); rt.dispose();
  const s = state(rt.start({ rate: 0.5 })); await env.drain(); await env.yieldAll();
  assert.strictEqual(s(), 'rejected(disposed)'); assert.deepStrictEqual(env.URL.revoked, ['blob:fake/1']); assert.strictEqual(tm.pending(), 0);
});
// r07 / R-1
test('#5 r07: a lost chunk ends the run with an error (not a quiet truncated timeline), no exception leaves the message handler, and the server stops', async () => {
  quiet(); const { env, store, ctl } = H.makePage({ chunk: 8 });
  let n = 0; env.dropClient = m => m.partial && ++n === 3;
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  assert(/out of order/.test(ctl.error), String(ctl.error)); assert.strictEqual(ctl.running, false); assert.deepStrictEqual(env.uncaught, []);
  assert(env.impl.steps < 40, 'the cancelled run stops computing: steps ' + env.impl.steps);
  assert.strictEqual(store.length(), 17, 'the frames that did arrive in order stay');
});
test('#5 r07: a run whose last chunk is lost delivered too few frames and is reported', async () => {
  quiet(); const { env, store, ctl } = H.makePage({ chunk: 8 });
  let n = 0; env.dropClient = m => m.partial && ++n === 5;
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  assert(/33 of 41/.test(ctl.error), String(ctl.error)); assert.strictEqual(ctl.running, false); assert.strictEqual(store.length(), 33);
});
test('#5 r07: a complete run is not reported (the frame count check has no false alarm)', async () => {
  const { env, store, ctl } = H.makePage({ chunk: 8 });
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  assert.strictEqual(ctl.error, null); assert.strictEqual(store.length(), 41);
});
// r13 a2
test('#5 r13a2: a runtime that throws the empty string is a failure, with a message', async () => {
  quiet(); const impl = H.makeImpl(), orig = impl.step; impl.step = (h, n) => { if (n > 0) throw ''; return orig(h, n); };
  const { env, ctl } = H.makePage({ impl, chunk: 8 }); const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  assert(ctl.error && /repro/.test(ctl.error), 'ctl.error: ' + JSON.stringify(ctl.error));
});
// r13 b / F-1
test('#5 r13b: a pushFrames that throws leaves the store as it was (no half replaced timeline)', () => {
  const s = G.PackStore.create(H.MANIFEST()), fr = t => ({ t, entities: { thing: { kind: Int8Array.from([0, 0, 0, 0, 0]), load: Float32Array.from([t, 0, 0, 0, 0]) } }, series: { totals: [t, 0] } });
  s.bindScene('thing', { count: 5, index: [0, 1, 2, 3, 4] }); s.pushFrames([fr(0), fr(1), fr(2)], { replace: true }); s.setTime(2);
  const ev = []; s.subscribe('*', e => ev.push(e.topic)); const gen = s.runId();
  assert.throws(() => s.pushFrames([fr(0), fr(1), fr(5)], { replace: true }), /out of order/);
  assert.strictEqual(s.length(), 3); assert.deepStrictEqual(ev, []); assert.strictEqual(s.time().t, 2); assert.strictEqual(s.frame().t, 2);
  assert.strictEqual(s.series('totals').length, 3); assert.strictEqual(s.runId(), gen); assert.strictEqual(s.bound('thing').fields.load[0], 2);
  assert.throws(() => s.pushFrames([fr(3), fr(9)]), /out of order/); assert.strictEqual(s.length(), 3, 'an extending push is atomic as well');
});
// r04 / P-2
test('#5 r04: Play stops at the end of a run that failed part way', async () => {
  quiet(); const { env, store, ctl } = H.makePage({ chunk: 8, impl: H.makeImpl({ throwAtStep: 20 }) });
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  assert(ctl.error); assert.strictEqual(store.length(), 17);
  ctl.togglePlay(); for (let i = 0; i < 400; i++) ctl.advance(0.05);
  assert.strictEqual(store.time().playing, false, 'the button must not stay on Pause'); assert.strictEqual(store.time().t, 16);
});
test('#5 r04: Play stops at the end of a truncated timeline after a lost chunk, and keeps waiting while the run is still coming', async () => {
  quiet(); const { env, store, ctl } = H.makePage({ chunk: 8 });
  const p = ctl.start(); await env.drain();                                      // 9 frames so far, the run goes on
  store.setPlaying(true); for (let i = 0; i < 100; i++) ctl.advance(0.05);
  assert.strictEqual(store.time().playing, true, 'waiting for frames that are on their way is not an end'); assert.strictEqual(store.time().t, 8);
  await env.yieldAll(); await p; for (let i = 0; i < 100; i++) ctl.advance(0.05);
  assert(store.time().t > 8, 'the clock goes on when the frames arrived');
  let n = 0; env.dropClient = m => m.partial && ++n === 2; store.setParam('rate', 0.8); ctl.flush(); await env.drain(); await env.yieldAll();
  store.setTime(0); store.setPlaying(true); for (let i = 0; i < 400; i++) ctl.advance(0.05);
  assert(ctl.error); assert.strictEqual(store.time().playing, false);
});
// r08 / S-1
test('#5 r08: a setParams that throws cancels the run in flight (no more chunks computed for nobody)', async () => {
  quiet(); const { env, store, ctl } = H.makePage({ chunk: 8, impl: H.makeImpl({ failAbove: 0.9 }) });
  const p = ctl.start(); await env.drain(); const before = env.impl.steps;
  store.setParam('rate', 0.95); ctl.flush(); await env.drain();
  assert(/refuses rate 0\.95/.test(ctl.error)); const d0 = env.delivered.filter(m => m.partial).length;
  await env.yieldAll(); await p;
  assert.strictEqual(env.delivered.filter(m => m.partial).length - d0, 0, 'the old run sends nothing more'); assert.strictEqual(env.impl.steps, before);
});
test('#5 r08: a start that throws leaves the adapter\'s parameters with its handle', () => {
  const impl = H.makeImpl({ failAbove: 0.9 }); impl.snapshot = h => ({ p: h.p, t: h.t, log: h.log.slice() }); impl.restore = (h, st) => ({ p: st.p, t: st.t, log: st.log.slice() });
  const env = H.makeEnv({ impl }), rt = G.PackRuntime.create(env.manifest, impl);
  rt.start({ rate: 0.5 }); assert.throws(() => rt.start({ rate: 0.95 }), /refuses/);
  assert.strictEqual(rt.snapshot().params.rate, 0.5); assert.strictEqual(rt.t, 0);
});

// =====================================================================================================================================================
// Issue #6: on_params "continue" works on the page: frames are made as the clock (or a scrub) reaches them, a moved parameter changes the frames made after it
// =====================================================================================================================================================
const play = async (env, ctl, ticks, dt) => { for (let i = 0; i < ticks; i++) { ctl.advance(dt || 0.05); await env.drain(); } };
test('#6 r01: with continue, Play makes the frames as the clock reaches them', async () => {
  const { env, store, ctl, runtime } = H.makePage({ continue: true });
  assert.strictEqual(runtime.policy, 'continue');
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  assert.strictEqual(store.length(), 1, 'lazy: only frame 0 until the clock asks');
  store.setPlaying(true); await play(env, ctl, 100);                    // five seconds at speed 4
  assert(store.time().t >= 15 && store.time().t <= 21, 't=' + store.time().t); assert(store.length() <= store.time().t + 2, 'no frames beyond the one the clock asked for: ' + store.length());
  assert.strictEqual(env.impl.steps, store.length() - 1, 'the model ran only for the frames asked for');
  assert.strictEqual(store.time().playing, true); assert.strictEqual(ctl.error, null);
  await play(env, ctl, 300);                                           // on to the horizon
  assert.strictEqual(store.time().t, 40); assert.strictEqual(store.length(), 41); assert.strictEqual(store.time().playing, false, 'the clock stops at the horizon'); assert.strictEqual(env.impl.steps, 40);
});
test('#6 r01: with continue, a moved slider changes the frames made from then on, and keeps the ones already made', async () => {
  const { env, store, ctl } = H.makePage({ continue: true });
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  store.setPlaying(true); await play(env, ctl, 40);
  const t0 = store.length() - 1; assert(t0 >= 5);
  store.setParam('rate', 0.8); ctl.flush(); await env.drain();
  assert.strictEqual(ctl.error, null); assert.strictEqual(ctl.running, false); assert.strictEqual(store.length(), t0 + 1, 'nothing is thrown away or re-run');
  await play(env, ctl, 60);
  assert(store.length() > t0 + 3); assert.strictEqual(H.frameLoad(store, t0), 500 + t0, 'frames made before the move keep their run'); assert.strictEqual(H.frameLoad(store, t0 + 2), 802 + t0, 'frames made after it use the new value');
  assert.strictEqual(env.impl.inits, 1, 'one model start, no re-run');
});
test('#6 r01: with continue, a scrub (slider, chart click) asks for the frames up to it', async () => {
  const { env, store, ctl } = H.makePage({ continue: true });
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  ctl.ensure(30); await env.drain();
  assert.strictEqual(store.length(), 31); store.setTime(30); assert.strictEqual(store.time().t, 30); assert.strictEqual(H.frameLoad(store, 30), 530);
  ctl.ensure(99); await env.drain(); assert.strictEqual(store.length(), 41, 'never past the horizon');
});
test('#6 r01: with continue, a model that fails on a step is reported and stops Play there', async () => {
  quiet(); const impl = H.makeImpl({ throwAtStep: 10 }); impl.setParams = (h, p) => { h.p = Object.assign({}, p); return h; };
  const env = H.makeEnv({ impl }); env.manifest.runtime.on_params = 'continue'; const store = G.PackStore.create(env.manifest), ctl = G.PackHost.createController({ manifest: env.manifest, runtime: env.worker(), store });
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  store.setPlaying(true); await play(env, ctl, 150);
  assert(/exploded at step 10/.test(ctl.error), String(ctl.error)); assert.strictEqual(store.time().playing, false); assert.strictEqual(store.length(), 10);
  const calls = impl.steps; await play(env, ctl, 20); assert.strictEqual(impl.steps, calls, 'the failed step is not retried on every tick');
});
test('#6 r01: with rerun the controller still makes the whole timeline at once (continue changed nothing for it)', async () => {
  const { env, store, ctl } = H.makePage({ chunk: 8 });
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p; assert.strictEqual(store.length(), 41);
});

// =====================================================================================================================================================
// Issue #7: the playhead, and the small leaks and ordering oddities of the runtime layer
// =====================================================================================================================================================
// r03 / P-1
test('#7 r03: a moved slider while Play runs holds the clock until the new run has reached the time on screen; the playhead does not jump back', async () => {
  const { env, store, ctl } = H.makePage({ chunk: 8 });
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  const tev = []; store.subscribe('time', e => tev.push(e.what + '@' + store.time().t));
  store.setTime(30); store.setPlaying(true); tev.length = 0;
  store.setParam('rate', 0.8); ctl.flush(); await env.drain();
  for (let i = 0; i < 8; i++) ctl.advance(0.25);                         // the clock must not run on over the old frames
  assert.strictEqual(store.time().t, 30); assert.strictEqual(H.frameLoad(store, 30), 530, 'the old run is still the picture');
  await env.yieldOne(); await env.yieldOne(); await env.yieldOne();
  assert.strictEqual(store.time().t, 30, 'no jump'); assert.strictEqual(H.frameLoad(store, 30), 830, 'the new run replaced it at the time being looked at'); assert.deepStrictEqual(tev, []);
  for (let i = 0; i < 4; i++) ctl.advance(0.25);
  assert(store.time().t > 30, 'Play goes on over the new frames'); assert.strictEqual(store.time().playing, true);
});
test('#7 r03: a pushFrames that makes the playhead fall back announces it with a time event, and the playhead returns when the frames arrive', () => {
  const s = G.PackStore.create(H.MANIFEST()), fr = t => ({ t, entities: { thing: { kind: Int8Array.from([0, 0, 0, 0, 0]), load: Float32Array.from([t, 0, 0, 0, 0]) } }, series: { totals: [t, 0] } });
  s.pushFrames([0, 1, 2, 3, 4].map(fr), { replace: true }); s.setTime(4);
  const ev = []; s.subscribe('time', e => ev.push(e.what + '@' + s.time().t));
  s.pushFrames([0, 1].map(fr), { replace: true });
  assert.strictEqual(s.time().t, 1); assert.deepStrictEqual(ev, ['t@1'], 'the clamp is an event'); assert.strictEqual(s.frame().t, 1);
  s.pushFrames([2, 3, 4].map(fr)); assert.strictEqual(s.time().t, 4, 'back where it was looking'); assert.strictEqual(s.frame().t, 4);
});
// r13 e / P-3
test('#7 r13e: a scrub beyond the frames computed so far is remembered and reached when they arrive', async () => {
  const { env, store, ctl } = H.makePage({ chunk: 8 });
  const p = ctl.start(); await env.drain();
  store.setTime(30); assert.strictEqual(store.time().t, 8, 'clamped for now');
  await env.yieldAll(); await p;
  assert.strictEqual(store.time().t, 30);
  store.setTime(5); await env.drain(); assert.strictEqual(store.time().t, 5, 'a later scrub forgets the wish');
});
// r06 / T-3 T-4 T-5
test('#7 r06a: after the fallback ctl.mode says inline', async () => {
  quiet(); const env = H.makeEnv(), rt = env.worker({ mode: 'auto', server: inlineOf(env) }), store = G.PackStore.create(env.manifest), ctl = G.PackHost.createController({ manifest: env.manifest, runtime: rt, store });
  assert.strictEqual(ctl.mode, 'worker'); env.workers[0].fail('SyntaxError in worker script');
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  assert.strictEqual(rt.mode, 'inline'); assert.strictEqual(ctl.mode, 'inline'); assert.strictEqual(store.length(), 41); assert.deepStrictEqual(env.URL.revoked, ['blob:fake/1']);
});
test('#7 r06b: a second error event of the same worker builds no second runtime and revokes the URL once', async () => {
  quiet(); const env = H.makeEnv(), made = [], orig = G.PackRuntime.create; G.PackRuntime.create = (...a) => { made.push(a[0].id); return orig(...a); };
  try { const rt = env.worker({ mode: 'auto', server: inlineOf(env) }); env.workers[0].fail('first'); env.workers[0].fail('second'); await env.drain(); await env.settle(); assert.strictEqual(made.length, 1); assert.strictEqual(rt.mode, 'inline'); assert.deepStrictEqual(env.URL.revoked, ['blob:fake/1']); }
  finally { G.PackRuntime.create = orig; }
});
test('#7 r06c: a Worker that cannot be constructed leaves no Blob URL behind', async () => {
  const env = H.makeEnv(); env.failConstruct = true; const rt = env.worker({ mode: 'auto', server: inlineOf(env) }); await env.drain();
  assert.strictEqual(env.URL.created, 1); assert.deepStrictEqual(env.URL.revoked, ['blob:fake/1']); assert.strictEqual(rt.mode, 'inline'); assert(/blocked/.test(rt.fellBack));
});
test('#7 r06: the fallback after a failed Worker keeps the runtime that was passed in', async () => {
  const env = H.makeEnv(), reg = G.PaperDolls.runtimes[env.manifest.id]; delete G.PaperDolls.runtimes[env.manifest.id];
  try { const rt = env.worker({ mode: 'auto', impl: env.impl, server: inlineOf(env) }); env.workers[0].fail('boom'); const s = state(rt.start({ rate: 0.5 })); await env.drain(); assert.strictEqual(s(), 'resolved'); }
  finally { G.PaperDolls.runtimes[env.manifest.id] = reg; }
});
// r13 c / B-3 and "no resource outlives dispose()"
test('#7 r13c: switching the compare off stops B\'s worker; switching it on again starts a fresh one', async () => {
  const env = H.makeEnv(); const A = G.PackStore.create(env.manifest), ctlA = G.PackHost.createController({ manifest: env.manifest, runtime: env.worker(), store: A });
  await settleStart(env, ctlA);
  const cmp = G.PackDash.createCompare({ manifest: env.manifest, store: A, createRuntime: () => env.worker(), schedule() {} });
  cmp.enable(true); await env.drain(); await env.yieldAll(); assert.strictEqual(H.frameLoad(cmp.B, 5), 205);
  cmp.enable(false);
  assert.strictEqual(env.workers[1].dead, true, 'B\'s worker is terminated'); assert(env.URL.revoked.includes('blob:fake/2'));
  cmp.B.setParam('rate', 0.35); assert.strictEqual(cmp.flush(), false); await env.drain(); await env.yieldAll();
  assert.strictEqual(H.frameLoad(cmp.B, 5), 205, 'nothing re-ran'); assert.strictEqual(env.workers.length, 2);
  cmp.enable(true); await env.drain(); await env.yieldAll();
  assert.strictEqual(env.workers.length, 3); assert.strictEqual(H.frameLoad(cmp.B, 5), 355, 'B runs again with the settings it was left with'); assert.strictEqual(cmp.error, null);
});
test('#7: dispose() of a controller ends its run, its worker and its subscription', async () => {
  const env = H.makeEnv({ chunk: 8 }); const { store, tm, runtime, ctl } = pageWith(env);
  const p = state(ctl.start()); await env.drain(); ctl.dispose(); await env.drain(); await env.yieldAll();
  assert.strictEqual(env.workers[0].dead, true); assert.deepStrictEqual(env.URL.revoked, ['blob:fake/1']); assert.strictEqual(tm.pending(), 0);
  const posted = env.toServer.length; store.setParam('rate', 0.7); assert.strictEqual(ctl.flush(), false); await env.drain(); assert.strictEqual(env.toServer.length, posted, 'a disposed controller asks for nothing');
  assert(store.length() <= 9, 'no frames arrive after dispose: ' + store.length());
});
// r10 / F-2
test('#7 r10a: a subscriber unsubscribed during an emit is not called', () => {
  const s = G.PackStore.create(H.MANIFEST()), log = []; let off2; s.subscribe('params', () => off2()); off2 = s.subscribe('params', () => log.push('called'));
  s.setParam('rate', 0.6); assert.deepStrictEqual(log, []);
});
test('#7 r10b: an event raised inside a handler is delivered after the one in progress, in order, to every subscriber', () => {
  const t = G.PackStore.create(H.MANIFEST()), seen = []; let first = true;
  t.subscribe('params', ev => { if (first) { first = false; t.setParam('rate', 0.9); } });
  t.subscribe('params', ev => seen.push('v' + ev.version));
  t.setParam('rate', 0.6); assert.deepStrictEqual(seen, ['v1', 'v2']);
  assert.strictEqual(t.param('rate'), 0.9);
});
test('#7 r10: a handler that throws does not stop the queue', () => {
  quiet(); const t = G.PackStore.create(H.MANIFEST()), seen = []; t.subscribe('params', () => { throw new Error('x'); }); t.subscribe('params', ev => seen.push(ev.version));
  t.setParam('rate', 0.6); t.setParam('rate', 0.7); assert.deepStrictEqual(seen, [1, 2]);
});
// r13 d
test('#7 r13d: a preset whose value is off the parameter step is active once applied', () => {
  const m = H.MANIFEST(); m.presets.push({ id: 'odd', label: 'Odd', params: { rate: 0.22 } });
  const s = G.PackStore.create(m); assert.strictEqual(s.isPreset('odd'), false); s.applyPreset('odd'); assert.strictEqual(s.param('rate'), 0.2); assert.strictEqual(s.isPreset('odd'), true);
  s.setParam('rate', 0.5); assert.strictEqual(s.isPreset('odd'), false);
});
// SM-13
test('#7 SM-13: PackRuntime.step(0) after start() returns the current frame without advancing', () => {
  const env = H.makeEnv(), rt = G.PackRuntime.create(env.manifest, env.impl); rt.start({ rate: 0.5 });
  let f = rt.step(0); assert.strictEqual(f.length, 1); assert.strictEqual(f[0].t, 0); assert.strictEqual(rt.t, 0);
  rt.run(5); f = rt.step(0); assert.strictEqual(f[0].t, 5); assert.strictEqual(rt.t, 5); assert.strictEqual(rt.step(2).map(x => x.t).join(), '6,7');
});

// =====================================================================================================================================================
(async () => {
  for (const [name, fn] of queue) {
    let timer; const guard = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('hang: the test never finished (a promise that is never settled)')), 4000); });
    try { await Promise.race([fn(), guard]); clearTimeout(timer); console.log('PASS ' + name); }
    catch (e) { clearTimeout(timer); if (e && e.skip) { skipped++; console.log('SKIP ' + name + ' (jsdom not installed)'); } else { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message) + (e && e.stack ? '\n  ' + e.stack.split('\n').slice(1, 4).join('\n  ') : '')); } }
  }
  console.log(failed ? failed + ' failed' : 'all passed' + (skipped ? ' (' + skipped + ' skipped)' : '')); process.exit(failed ? 1 : 0);
})();
