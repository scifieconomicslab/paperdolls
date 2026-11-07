/* [FIXED f5765bd] R09: flipping the map between A and B (the B key, or the A/B buttons) emits only 'view'. The inspector (selection, time, frames) and the timeline readout
 * (params, time, frames) listen to none of those, so after a flip they keep showing the run that was on screen BEFORE the flip until time moves.
 * Needs jsdom: PAPERDOLLS_NODE_MODULES=<node_modules dir>. Run: node docs/state-machines/repro/r09-ab-flip-leaves-inspector-and-readout-stale.js */
const path = require('path'); let JSDOM;
try { ({ JSDOM } = require(path.join(process.env.PAPERDOLLS_NODE_MODULES || 'node_modules', 'jsdom'))); } catch (e) { console.log('SKIP (jsdom not found; set PAPERDOLLS_NODE_MODULES)'); process.exit(0); }
const H = require('./_harness'), { G } = H;
(async () => {
  const env = H.makeEnv({ chunk: 40 }); env.manifest.layout = { left: [{ control: 'params' }], right: [{ control: 'legend' }], bottom: [{ control: 'timeline' }, { control: 'compare' }] };
  const A = G.PackStore.create(env.manifest), runtime = env.worker(), ctl = G.PackHost.createController({ manifest: env.manifest, runtime, store: A });
  let p = ctl.start(); await env.drain(); await env.yieldAll(); await p;
  const cmp = G.PackDash.createCompare({ manifest: env.manifest, store: A, createRuntime: () => env.worker(), schedule() {} });
  const orig = ctl.inspect; ctl.inspect = sel => cmp.inspect(sel, orig);
  const doc = new JSDOM('<!doctype html><body><div id=l></div><div id=r></div><div id=b></div><div id=m></div></body>').window.document, $ = id => doc.getElementById(id);
  const view = cmp.viewStore;
  G.PackHost.mountUI({ manifest: env.manifest, store: view, controller: ctl, compare: cmp, register: 'colorfigures', doc, regions: { left: $('l'), right: $('r'), bottom: $('b'), inspector: $('m') }, display: [] });
  cmp.enable(true); await env.drain(); await env.yieldAll();
  view.select({ entity: 'thing', id: 0 }); await env.drain();
  const dd = () => [...doc.querySelectorAll('.pk-inspector dl.pk-fields:not(.pk-extra) dd')].map(x => x.textContent).join(' | ');
  const extra = () => [...doc.querySelectorAll('.pk-inspector dl.pk-extra dd')].slice(0, 1).map(x => 'rate of this run ' + x.textContent).join('');
  const readout = () => (doc.querySelector('.pk-readout') || {}).textContent;
  console.log('showing A  : map load[0]=' + view.frame().entities.thing.load[0].toFixed(0) + ' | inspector fields: ' + dd() + ' | ' + extra() + ' | readout: ' + readout());
  cmp.show('b'); await env.drain();
  console.log('after flip : map load[0]=' + view.frame().entities.thing.load[0].toFixed(0) + ' | inspector fields: ' + dd() + ' | ' + extra() + ' | readout: ' + readout());
  view.setTime(1); await env.drain();
  console.log('time moved : map load[0]=' + view.frame().entities.thing.load[0].toFixed(0) + ' | inspector fields: ' + dd() + ' | ' + extra() + ' | readout: ' + readout());
})();
