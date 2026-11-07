/* R02: when B's re-run fails (a preset the model refuses), nothing tells the presenter: cmp.error stays null, B keeps the frames of the PREVIOUS B settings,
 * and the compare panel's "where B differs from A" already describes the new settings. Charts and the map flip then show the old B under the new label.
 * Run: node docs/state-machines/repro/r02-compare-b-failure-silent.js */
const H = require('./_harness'), { G } = H;
(async () => {
  const errs = []; console.error = (...a) => errs.push(String(a[0] && a[0].message || a[0]));
  const env = H.makeEnv({ impl: H.makeImpl({ failAbove: 0.9 }) });
  const A = G.PackStore.create(env.manifest), ctlA = G.PackHost.createController({ manifest: env.manifest, runtime: env.worker(), store: A });
  let p = ctlA.start(); await env.drain(); await env.yieldAll(); await p;
  const cmp = G.PackDash.createCompare({ manifest: env.manifest, store: A, createRuntime: () => env.worker(), schedule() {} });
  const changes = []; cmp.onChange(w => changes.push(w));
  cmp.enable(true); await env.drain(); await env.yieldAll();
  console.log('B source=' + JSON.stringify(cmp.bSource) + ' B rate=' + cmp.B.param('rate') + ' B frames=' + cmp.B.length() + ' B frame5 load=' + H.frameLoad(cmp.B, 5) + ' (expect 205)');
  cmp.setB({ preset: 'bad' }); cmp.flush(); await env.drain(); await env.yieldAll();
  console.log('after setB(bad: rate 0.95, the model throws):');
  console.log('  ctlB.error      = ' + JSON.stringify(cmp.ctlB.error));
  console.log('  cmp.error       = ' + JSON.stringify(cmp.error) + '   (what the page shows in the header and the compare panel)');
  console.log('  onChange events = [' + changes.join(',') + ']  (no "error")');
  console.log('  B.params().rate = ' + cmp.B.param('rate') + '   differences() = ' + JSON.stringify(cmp.differences().map(d => d.label + ': A ' + d.a + ', B ' + d.b)));
  console.log('  B frame5 load   = ' + H.frameLoad(cmp.B, 5) + '   (rate 0.2 run; the 0.95 run never produced a frame)');
  cmp.show('b');
  console.log('  map would show frame with load ' + H.frameLoad(cmp.view, 5) + ' under the label "' + cmp.labelOf(cmp.bSource) + '"');
})();
