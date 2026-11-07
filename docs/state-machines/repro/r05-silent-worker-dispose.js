/* [FIXED aa30227] R05: nothing detects a worker that goes silent, and a disposed adapter accepts requests it will never answer.
 *  (a) the worker never answers init            -> start() pending forever, ctl.running stays true, ctl.error stays null, no banner
 *  (b) dispose(), then any request              -> the promise neither resolves nor rejects
 *  (c) the worker reports an error and dies     -> in-flight requests reject, but every later request is posted to the dead worker and hangs
 * Run: node docs/state-machines/repro/r05-silent-worker-dispose.js */
const H = require('./_harness');
const fakeTimers = () => { let now = 0, id = 0; const t = new Map(); return { set(fn, ms) { const i = ++id; t.set(i, { fn, at: now + ms }); return i; }, clear(i) { t.delete(i); }, advance(ms) { now += ms; for (const [i, x] of [...t]) if (x.at <= now) { t.delete(i); x.fn(); } } }; };
const state = p => { let s = 'pending'; p.then(() => { s = 'resolved'; }, e => { s = 'rejected(' + e.message + ')'; }); return () => s; };
(async () => {
  console.error = () => {}; console.warn = () => {};
  { // (a)
    const env = H.makeEnv(); env.silentInit = true; const tm = fakeTimers();
    const { store } = { store: H.G.PackStore.create(env.manifest) }, rt = env.worker({ timers: tm, timeoutMs: 1000 }), ctl = H.G.PackHost.createController({ manifest: env.manifest, runtime: rt, store });
    const s = state(ctl.start()); await env.drain(); await env.yieldAll();
    console.log('(a) silent init: start() is ' + s() + ', ctl.running=' + ctl.running + ', ctl.error=' + JSON.stringify(ctl.error) + ', frames=' + store.length());
    tm.advance(1000); await env.drain(); await env.yieldAll();
    console.log('    after the 1 s watchdog (mode worker, no fallback): start() is ' + s() + ', running=' + ctl.running + ' error=' + JSON.stringify(ctl.error));
    store.setParam('rate', 0.7); ctl.flush(); await env.drain();
    console.log('    after a slider move: running=' + ctl.running + ' error=' + JSON.stringify(ctl.error) + ' (refused at once, nothing queued behind the dead init)');
  }
  { // (b)
    const env = H.makeEnv(), rt = env.worker();
    await env.drain(); rt.dispose(); rt.dispose();
    const s = state(rt.start({ rate: 0.5 })); await env.drain(); await env.yieldAll();
    console.log('(b) after dispose() x2: URL.revoked=' + JSON.stringify(env.URL.revoked) + ' (once), start() is ' + s());
  }
  { // (c)
    const { env, store, ctl } = H.makePage({ chunk: 8 });
    const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
    const w = env.workers[0]; store.setParam('rate', 0.6); ctl.flush(); await env.drain();
    w.fail('worker out of memory'); w.crash(); await env.drain();
    console.log('(c) worker died mid-run (mode worker): ctl.error=' + JSON.stringify(ctl.error) + ' running=' + ctl.running);
    const posted = env.toServer.length; store.setParam('rate', 0.7); ctl.flush(); await env.drain(); await env.yieldAll();
    console.log('    next slider move: running=' + ctl.running + ' error=' + JSON.stringify(ctl.error) + ' frames=' + store.length() + ' messages posted to the dead worker: ' + (env.toServer.length - posted));
  }
  { // (d) the same in auto mode: the run is repeated on the main thread
    const env = H.makeEnv({ chunk: 8 }); const store = H.G.PackStore.create(env.manifest), rt = env.worker({ mode: 'auto', server: { chunk: 8, yieldFn: () => new Promise(r => env.yields.push(r)) } }), ctl = H.G.PackHost.createController({ manifest: env.manifest, runtime: rt, store });
    const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
    store.setParam('rate', 0.6); ctl.flush(); await env.drain(); env.workers[0].fail('worker out of memory'); env.workers[0].crash(); await env.drain(); await env.yieldAll(); await env.drain(); await env.yieldAll();
    console.log('(d) the same in auto mode: mode=' + rt.mode + ' ctl.error=' + JSON.stringify(ctl.error) + ' frames=' + store.length() + ' load@3=' + H.frameLoad(store, 3) + ' notice=' + JSON.stringify(ctl.notice));
  }
})();
