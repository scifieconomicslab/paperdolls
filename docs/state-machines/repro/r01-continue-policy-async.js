/* R01: a pack with runtime.on_params "continue" on the page's (asynchronous) adapter never gets more than frame 0.
 * Run: node docs/state-machines/repro/r01-continue-policy-async.js */
const H = require('./_harness');
(async () => {
  const { env, store, ctl, runtime } = H.makePage({ continue: true });
  const events = []; store.subscribe('time', e => events.push(e.what));
  const started = ctl.start(); await env.drain(); await env.yieldAll(); await started;
  console.log('policy=' + runtime.policy + ' frames after start+drain: ' + store.length() + ' (horizon ' + env.manifest.time.steps + ')');
  store.setPlaying(true); for (let i = 0; i < 100; i++) ctl.advance(0.05);       // five seconds of clock at speed 4
  console.log('after 100 clock ticks: t=' + store.time().t + ' playing=' + store.time().playing + ' time events=[' + events.join(',') + ']');
  store.setParam('rate', 0.8); ctl.flush(); await env.drain(); await env.yieldAll();
  console.log('after a slider move: frames=' + store.length() + ' frame0 load=' + H.frameLoad(store, 0) + ' (rate 0.5 -> 500, 0.8 -> 800)');
  console.log('model steps executed by the server: ' + env.impl.steps);
})();
