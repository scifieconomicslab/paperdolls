/* [FIXED aa30227..d40e29a: implemented in the controller] R01: a pack with runtime.on_params "continue" on the page's (asynchronous) adapter never gets more than frame 0.
 * Run: node docs/state-machines/repro/r01-continue-policy-async.js */
const H = require('./_harness');
(async () => {
  const { env, store, ctl, runtime } = H.makePage({ continue: true });
  const events = []; store.subscribe('time', e => events.push(e.what));
  const started = ctl.start(); await env.drain(); await env.yieldAll(); await started;
  console.log('policy=' + runtime.policy + ' frames after start+drain: ' + store.length() + ' (horizon ' + env.manifest.time.steps + ')');
  const tick = async n => { for (let i = 0; i < n; i++) { ctl.advance(0.05); await env.drain(); } };             // the model answers between two ticks
  store.setPlaying(true); await tick(100);                                       // five seconds of clock at speed 4
  const t0 = store.time().t;
  console.log('after 100 clock ticks: t=' + t0 + ' frames=' + store.length() + ' playing=' + store.time().playing + ' time events=' + events.filter(e => e === 't').length + 'x t');
  store.setParam('rate', 0.8); ctl.flush(); await env.drain(); await env.yieldAll(); await tick(60);
  console.log('after a slider move and 3 s more: frame ' + t0 + ' load=' + H.frameLoad(store, t0) + ' (made before: rate 0.5), frame ' + (t0 + 3) + ' load=' + H.frameLoad(store, t0 + 3) + ' (made after: rate 0.8)');
  console.log('model starts: ' + env.impl.inits + ', steps executed by the server: ' + env.impl.steps + ' (= frames made - 1: ' + (store.length() - 1) + ')');
})();
