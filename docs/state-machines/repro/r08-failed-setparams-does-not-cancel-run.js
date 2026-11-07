/* R08: a setParams that throws in the worker does not bump the server's epoch, so the run in flight is not cancelled: it keeps computing to the horizon
 * for nobody (the client drops its chunks by ctl.gen). Wasted work, and the store keeps the truncated old-run frames.
 * Run: node docs/state-machines/repro/r08-failed-setparams-does-not-cancel-run.js */
const H = require('./_harness');
(async () => {
  console.error = () => {};
  const { env, store, ctl } = H.makePage({ chunk: 8, impl: H.makeImpl({ failAbove: 0.9 }) });
  const p = ctl.start(); await env.drain();                              // chunk 1 delivered, the server is waiting at its yield
  const stepsBefore = env.impl.steps;
  store.setParam('rate', 0.95); ctl.flush(); await env.drain();            // setParams(0.95) throws in init
  console.log('setParams failed: ctl.error=' + JSON.stringify(ctl.error) + ' frames=' + store.length() + ' pending yields=' + env.yields.length);
  const d0 = env.delivered.filter(m => m.partial).length;
  await env.yieldAll(); await p;
  console.log('after releasing the server: ' + (env.delivered.filter(m => m.partial).length - d0) + ' more partial chunks sent by the old run, model steps ' + stepsBefore + ' -> ' + env.impl.steps + ' (horizon ' + env.manifest.time.steps + '); store still ' + store.length() + ' frames of rate ' + H.frameLoad(store, 0));
})();
