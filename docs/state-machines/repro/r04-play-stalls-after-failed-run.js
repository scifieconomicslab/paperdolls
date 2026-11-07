/* R04: a run that fails part way leaves a truncated timeline; Play then sticks: playing stays true, t stops at the last frame, the clock never advances again.
 * Run: node docs/state-machines/repro/r04-play-stalls-after-failed-run.js */
const H = require('./_harness'), { G } = H;
(async () => {
  console.error = () => {};
  const { env, store, ctl } = H.makePage({ chunk: 8, impl: H.makeImpl({ throwAtStep: 20 }) });
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  console.log('run finished: ctl.error=' + JSON.stringify(ctl.error) + ' running=' + ctl.running + ' frames=' + store.length() + ' of ' + (env.manifest.time.steps + 1));
  ctl.togglePlay(); for (let i = 0; i < 400; i++) ctl.advance(0.05);
  console.log('after 20 s of clock: playing=' + store.time().playing + ' t=' + store.time().t + ' (stuck at the last frame; the Pause button is still showing)');
})();
