/* [FIXED 4eadbf1] R03: while a re-run is in flight the old frames keep playing; when the new run's frames replace them the playhead is clamped back, silently
 * (no 'time' event), and the picture switches runs at a different time.
 * Run: node docs/state-machines/repro/r03-playhead-jump-on-replace.js */
const H = require('./_harness');
(async () => {
  const { env, store, ctl } = H.makePage({ chunk: 8 });
  const p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  const tev = []; store.subscribe('time', e => tev.push(e.what + '@' + store.time().t)); const fev = []; store.subscribe('frames', e => fev.push((e.replace ? 'replace' : 'extend') + ':' + e.length));
  store.setTime(30); store.setPlaying(true); tev.length = 0;
  store.setParam('rate', 0.8); ctl.flush(); await env.drain();                  // setParams answered, run 1 chunk delivered (9 frames); nothing replaced yet (want=30)
  console.log('run in flight: store holds ' + store.length() + ' frames, load at t=30 is ' + H.frameLoad(store, 30) + ' (old run, rate 0.5)');
  for (let i = 0; i < 8; i++) ctl.advance(0.25);                                  // the clock runs on over the OLD frames
  console.log('clock after 8 ticks while the new run catches up: t=' + store.time().t + ' (held; old frames, load ' + H.frameLoad(store, store.time().t) + ')');
  const before = store.time().t; tev.length = 0; fev.length = 0;
  await env.yieldOne(); await env.yieldOne(); await env.yieldOne();             // chunks 2..4: the 4th brings the held frames past t=30 and replaces
  console.log('after replace: t=' + store.time().t + ' (was ' + before + '), frames=' + store.length() + ', load at t is ' + H.frameLoad(store, store.time().t) + ' (new run, rate 0.8)');
  console.log('time events during the jump: [' + tev.join(',') + ']  frames events: [' + fev.join(',') + ']');
})();
