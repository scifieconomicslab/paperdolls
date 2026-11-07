/* R11: ctl.inspect is answered by whatever the worker holds now, with no tie to the run on screen. While a re-run is in flight the store still shows
 * the OLD run's frames, but inspect() is answered from the NEW run's partial state, for a time that run has not reached. The inspector accepts the
 * answer (it checks selection and time only, packhost.js:498-505) and puts it next to the old run's field values.
 * Run: node docs/state-machines/repro/r11-inspect-answers-from-partial-run.js */
const H = require('./_harness');
(async () => {
  const { env, store, ctl } = H.makePage({ chunk: 8 });
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  store.setTime(30);
  store.setParam('rate', 0.8); ctl.flush(); await env.drain();            // new run has simulated to t=8; the store still shows the rate-0.5 run
  let detail; const q = ctl.inspect({ entity: 'thing', id: 0 }).then(d => { detail = d; }); await env.drain(); await q;
  console.log('on screen at t=' + store.time().t + ': load ' + H.frameLoad(store, 30) + ' (old run, rate 0.5)');
  console.log('inspect answer: ' + detail.fields.map(f => f.label + '=' + f.value).join('; '));
})();
