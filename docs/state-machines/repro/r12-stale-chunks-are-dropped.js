/* R12 (REFUTED candidate): results of an older run arriving after a newer setParams. Chunks in flight from run 1 are delivered AFTER the client moved to
 * run 2; ctl.gen (packhost.js:90) drops them and the store ends up holding only run-2 frames. Also: a run that completes while the user scrubs/pauses
 * only extends the store (packstore.js:149) and leaves t alone.
 * Run: node docs/state-machines/repro/r12-stale-chunks-are-dropped.js */
const H = require('./_harness');
(async () => {
  const { env, store, ctl } = H.makePage({ chunk: 8 });
  const p1 = ctl.start(); await env.drain(); await env.yieldAll(); await p1;
  store.setTime(3);                                                           // scrub to t=3, paused
  store.setParam('rate', 0.8); ctl.flush(); await env.drain();                // run 2 started, first chunk (9 frames) held back? want=3 -> replaced at once
  env.yields.shift()();                                                       // the server computes chunk 2 of run 2 ...
  await env.settle();                                                         // ... and it sits in toClient, undelivered
  store.setParam('rate', 0.9); ctl.flush();                                   // the client moves on to run 3 before that chunk arrives
  const inFlight = env.toClient.filter(e => e.m.partial).length;
  await env.drain(); await env.yieldAll();
  const rates = new Set(); for (let t = 0; t < store.length(); t++) rates.add(Math.floor(H.frameLoad(store, t) / 1000 * 10) / 10);
  console.log('chunks in flight when run 3 started: ' + inFlight + '; frames now ' + store.length() + '; distinct runs among frames: ' + JSON.stringify([...rates]) + '; t=' + store.time().t + ' (never moved by the run completing)');
})();
