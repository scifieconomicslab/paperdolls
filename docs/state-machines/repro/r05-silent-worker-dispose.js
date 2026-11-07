/* R05: nothing detects a worker that goes silent, and a disposed adapter accepts requests it will never answer.
 *  (a) the worker never answers init            -> start() pending forever, ctl.running stays true, ctl.error stays null, no banner
 *  (b) dispose(), then any request              -> the promise neither resolves nor rejects
 *  (c) the worker reports an error and dies     -> in-flight requests reject, but every later request is posted to the dead worker and hangs
 * Run: node docs/state-machines/repro/r05-silent-worker-dispose.js */
const H = require('./_harness');
const state = p => { let s = 'pending'; p.then(() => { s = 'resolved'; }, e => { s = 'rejected(' + e.message + ')'; }); return () => s; };
(async () => {
  console.error = () => {};
  { // (a)
    const env = H.makeEnv(); env.silentInit = true;
    const { store } = { store: H.G.PackStore.create(env.manifest) }, rt = env.worker(), ctl = H.G.PackHost.createController({ manifest: env.manifest, runtime: rt, store });
    const s = state(ctl.start()); await env.drain(); await env.yieldAll();
    console.log('(a) silent init: start() is ' + s() + ', ctl.running=' + ctl.running + ', ctl.error=' + JSON.stringify(ctl.error) + ', frames=' + store.length());
    store.setParam('rate', 0.7); ctl.flush(); await env.drain();
    console.log('    after a slider move: running=' + ctl.running + ' error=' + JSON.stringify(ctl.error) + ' gen=' + ctl.gen + ' (a new request is queued behind the dead init; still nothing)');
  }
  { // (b)
    const env = H.makeEnv(), rt = env.worker();
    await env.drain(); rt.dispose(); rt.dispose();
    const s = state(rt.start({ rate: 0.5 })); await env.drain(); await env.yieldAll();
    console.log('(b) after dispose() x2: URL.revoked=' + JSON.stringify(env.URL.revoked) + ' (revoked twice), start() is ' + s());
  }
  { // (c)
    const { env, store, ctl } = H.makePage({ chunk: 8 });
    const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
    const w = env.workers[0]; store.setParam('rate', 0.6); ctl.flush(); await env.drain();
    w.fail('worker out of memory'); w.crash(); await env.drain();
    console.log('(c) worker died mid-run: ctl.error=' + JSON.stringify(ctl.error) + ' running=' + ctl.running);
    store.setParam('rate', 0.7); ctl.flush(); await env.drain(); await env.yieldAll();
    console.log('    next slider move: running=' + ctl.running + ' error=' + JSON.stringify(ctl.error) + ' frames=' + store.length() + ' (posted to the dead worker; the runtime never switches to inline)');
  }
})();
