/* R13: smaller cases, each printed on its own line.
 *  (a) a runtime that throws the empty string is taken for a success (packworker.js:96 tests m.error for truthiness); an Error with an empty message is not
 *  (b) pushFrames(replace) that throws half way leaves the store half replaced with no event and a stale bound view (packstore.js:140-144)
 *  (c) switching compare off leaves B's worker running and still re-running (packdash.js:89 never disposes)
 *  (d) a preset value that is off the parameter's step is stored snapped, so isPreset() can never be true (packstore.js:85,90)
 *  (e) scrubbing beyond what a running re-run has produced is clamped to the last frame and the wish is lost (packstore.js:96)
 * Run: node docs/state-machines/repro/r13-store-and-small-cases.js */
const H = require('./_harness'), { G } = H;
(async () => {
  console.error = () => {};
  { // (a)
    const impl = H.makeImpl(); const orig = impl.step; impl.step = (h, n) => { if (n > 0) throw (global.THROW_PRIMITIVE ? '' : new Error('')); return orig(h, n); };
    const { env, store, ctl } = H.makePage({ impl, chunk: 8 }); const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
    console.log('(a1) runtime threw new Error(""): ctl.error=' + JSON.stringify(ctl.error) + ' frames=' + store.length() + ' -> reported (REFUTED: message becomes "Error")');
  }
  { // (a2)
    global.THROW_PRIMITIVE = true;
    const impl = H.makeImpl(); const orig = impl.step; impl.step = (h, n) => { if (n > 0) throw ''; return orig(h, n); };
    const { env, store, ctl } = H.makePage({ impl, chunk: 8 }); const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
    console.log('(a2) runtime threw the empty string: ctl.error=' + JSON.stringify(ctl.error) + ' frames=' + store.length() + ' ctl.runs=' + ctl.runs + ' (error "" is falsy, so the client takes the failure for a success)');
    global.THROW_PRIMITIVE = false;
  }
  { // (b)
    const s = G.PackStore.create(H.MANIFEST()); const fr = t => ({ t, entities: { thing: { kind: Int8Array.from([0, 0, 0, 0, 0]), load: Float32Array.from([t, 0, 0, 0, 0]) } }, series: { totals: [t, 0] } });
    s.bindScene('thing', { count: 5, index: [0, 1, 2, 3, 4] }); s.pushFrames([fr(0), fr(1), fr(2)], { replace: true }); s.setTime(2); const first = s.bound('thing').fields.load[0];
    const ev = []; s.subscribe('*', e => ev.push(e.topic));
    let err = null; try { s.pushFrames([fr(0), fr(1), fr(5)], { replace: true }); } catch (e) { err = e.message; }
    console.log('(b) pushFrames threw "' + err + '": length=' + s.length() + ' (was 3), events=' + JSON.stringify(ev) + ', time.t=' + s.time().t + ', frame() is ' + (s.frame() ? 'present' : 'null') + ', bound load[0]=' + s.bound('thing').fields.load[0] + ' (stale value from the replaced run: ' + first + ')');
  }
  { // (c)
    const env = H.makeEnv(); const A = G.PackStore.create(env.manifest), ctlA = G.PackHost.createController({ manifest: env.manifest, runtime: env.worker(), store: A });
    let p = ctlA.start(); await env.drain(); await env.yieldAll(); await p;
    const cmp = G.PackDash.createCompare({ manifest: env.manifest, store: A, createRuntime: () => env.worker(), schedule() {} });
    cmp.enable(true); await env.drain(); await env.yieldAll(); cmp.enable(false);
    const runsBefore = cmp.ctlB.runs; cmp.B.setParam('rate', 0.35); cmp.flush(); await env.drain(); await env.yieldAll();
    console.log('(c) compare off: B worker dead=' + env.workers[1].dead + ', B re-ran anyway after enable(false): ' + (cmp.ctlB.runs - runsBefore) + ' run(s)');
  }
  { // (d)
    const m = H.MANIFEST(); m.presets.push({ id: 'odd', label: 'Odd', params: { rate: 0.22 } });
    const v = G.PackSpec.validate(m); const s = G.PackStore.create(m); s.applyPreset('odd');
    console.log('(d) validator ok=' + v.ok + ' (errors: ' + JSON.stringify(v.errors) + '); after applyPreset("odd") rate=' + s.param('rate') + ' isPreset("odd")=' + s.isPreset('odd'));
  }
  { // (e)
    const { env, store, ctl } = H.makePage({ chunk: 8 }); const p = ctl.start(); await env.drain();
    store.setTime(30); const during = store.time().t; await env.yieldAll(); await p;
    console.log('(e) setTime(30) while 9 frames exist: t=' + during + '; after the run completed (41 frames) t=' + store.time().t);
  }
})();
