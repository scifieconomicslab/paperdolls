/* [FIXED aa30227] R06: the worker -> inline fallback ("auto" mode).
 *  (a) the worker errors before it answers init: falls back, terminates and revokes once; the controller's `mode` is a stale copy ('worker')
 *  (b) a second error event before the first inline answer: a second inline server is built and init is sent again (an extra runtime per event)
 *  (c) `new Worker` throws after the Blob URL was made: the URL is never revoked
 * Run: node docs/state-machines/repro/r06-fallback-paths.js */
const H = require('./_harness'), { G } = H;
const inlineServer = env => ({ chunk: 8, yieldFn: () => new Promise(r => env.yields.push(r)) });
(async () => {
  console.error = () => {};
  { // (a)
    const env = H.makeEnv(), rt = env.worker({ mode: 'auto', server: inlineServer(env) }), store = G.PackStore.create(env.manifest);
    const ctl = G.PackHost.createController({ manifest: env.manifest, runtime: rt, store });
    console.log('(a) before the error: rt.mode=' + rt.mode + ' ctl.mode=' + ctl.mode);
    env.workers[0].fail('SyntaxError in worker script');
    const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
    console.log('    after: rt.mode=' + rt.mode + ' ctl.mode=' + ctl.mode + ' fellBack=' + JSON.stringify(rt.fellBack) + ' frames=' + store.length() + ' revoked=' + JSON.stringify(env.URL.revoked) + ' log=' + JSON.stringify(env.log));
  }
  { // (b)
    const env = H.makeEnv(), made = []; const orig = G.PackRuntime.create; G.PackRuntime.create = (...a) => { made.push(a[0].id); return orig(...a); };
    const rt = env.worker({ mode: 'auto', server: inlineServer(env) });
    env.workers[0].fail('first'); env.workers[0].fail('second');
    await env.drain(); await env.settle(); G.PackRuntime.create = orig;
    console.log('(b) two error events before init is answered: PackRuntime.create called ' + made.length + ' times (expected 1, was 2 on aa2d936); revoked=' + JSON.stringify(env.URL.revoked) + '; mode=' + rt.mode);
  }
  { // (c)
    const env = H.makeEnv(); env.failConstruct = true;
    const rt = env.worker({ mode: 'auto', server: inlineServer(env) });
    await env.drain();
    console.log('(c) new Worker() throws: URL.created=' + env.URL.created + ' URL.revoked=' + JSON.stringify(env.URL.revoked) + ' mode=' + rt.mode + ' fellBack=' + JSON.stringify(rt.fellBack));
  }
})();
