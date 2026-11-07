/* R07: an exception in the run's onFrames callback (store.pushFrames refusing an out-of-order chunk) is thrown from the transport's message handler, not
 * through the run's promise: the controller never sees it. With one chunk lost the run "succeeds" with a truncated timeline and no error anywhere.
 * (postMessage does not lose messages; this injects the fault to show what the controller does with ANY exception thrown by pushFrames during a stream.)
 * Run: node docs/state-machines/repro/r07-dropped-chunk-silent-truncation.js */
const H = require('./_harness');
(async () => {
  console.error = () => {};
  const { env, store, ctl } = H.makePage({ chunk: 8 });
  let n = 0; env.dropClient = m => m.partial && ++n === 3;
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  console.log('dropped ' + env.dropped.length + ' partial message; frames in store=' + store.length() + ' of ' + (env.manifest.time.steps + 1) + ' ctl.error=' + JSON.stringify(ctl.error) + ' ctl.running=' + ctl.running + ' ctl.runs=' + ctl.runs);
  console.log('exceptions thrown out of the message handler (uncaught in a browser): ' + JSON.stringify(env.uncaught));
  ctl.togglePlay(); for (let i = 0; i < 200; i++) ctl.advance(0.05);
  console.log('Play: playing=' + store.time().playing + ' t=' + store.time().t);
})();
