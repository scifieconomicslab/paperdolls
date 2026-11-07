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
const quiet = () => { console.error = () => {}; };
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
(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { if (e && e.skip) { skipped++; console.log('SKIP ' + name + ' (jsdom not installed)'); } else { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message) + (e && e.stack ? '\n  ' + e.stack.split('\n').slice(1, 4).join('\n  ') : '')); } }
  }
  console.log(failed ? failed + ' failed' : 'all passed' + (skipped ? ' (' + skipped + ' skipped)' : '')); process.exit(failed ? 1 : 0);
})();
