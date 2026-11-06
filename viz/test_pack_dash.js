/* Drives a built pack page headlessly (jsdom) for the dashboard layer (P5): the layout engine draws the manifest's charts, KPI tiles, compare panel and a reduced,
 * reordered Display group; charts follow the store and the timeline; the A/B compare runs a second handle, overlays B (dashed) and gives KPI deltas; the map can flip to B.
 * Usage: node viz/test_pack_dash.js toy.html     Needs jsdom and canvas (npm ci). Prints SKIP when jsdom is not installed. */
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); } catch (e) { console.log('SKIP (jsdom not installed)'); process.exit(0); }
const fs = require('fs'), assert = require('assert');
const errs = [], vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push((e.detail && e.detail.stack) || e.message)); vc.on('error', e => errs.push(String(e)));
const html = fs.readFileSync(process.argv[2], 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, resources: 'usable', url: 'http://localhost/#worker=0' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (cond, ms = 20000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await sleep(20); return cond(); };
let failed = 0;
async function test(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message) + (e && e.stack ? '\n  ' + e.stack.split('\n').slice(1, 3).join(' ').replace(/\s+/g, ' ') : '')); } }
(async () => {
  assert(await until(() => dom.window.labPack), 'the page made a pack: ' + errs.slice(0, 2).join(' | ').slice(0, 300));
  const w = dom.window, d = w.document, P = w.labPack, M = P.manifest, store = P.store, ctl = P.controller, cmp = P.compare;
  const cv = d.getElementById('stage'); Object.defineProperty(cv, 'clientWidth', { value: 1000 }); Object.defineProperty(cv, 'clientHeight', { value: 600 }); w.dispatchEvent(new w.Event('resize'));
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const settled = () => until(() => !ctl.dirty && !ctl.running && store.length() === M.time.steps + 1);
  const settledB = () => until(() => cmp.ctlB && !cmp.ctlB.dirty && !cmp.ctlB.running && cmp.B.length() === M.time.steps + 1);
  assert(await settled(), 'the first run finished');
  const R = d.getElementById('right'), Bt = d.getElementById('bottom'), L = d.getElementById('left');
  const lineBox = () => R.querySelector('[data-chart-series=counts] .pc-line').closest('.pk-chart');
  const colA = i => store.series('counts').map(p => p[i]);

  await test('layout: the manifest places charts, KPI tiles, compare, legend and display in their regions, in order', () => {
    assert.deepStrictEqual([...R.children].map(n => n.getAttribute('data-item')).filter(Boolean).slice(0, 4), ['legend', 'chart', 'chart', 'display']);
    assert.deepStrictEqual([...Bt.children].map(n => n.getAttribute('data-item')), ['timeline', 'kpis']);
    assert.deepStrictEqual([...L.children].map(n => n.getAttribute('data-item')).filter(Boolean), ['params', 'presets', 'compare']);
    assert.strictEqual(R.querySelectorAll('svg.pc-svg').length, 2);
  });
  await test('layout: the Display group is reduced and reordered by the pack, not removed', () => {
    const labels = [...R.querySelectorAll('.pk-display label')].map(l => l.textContent.trim());
    assert.deepStrictEqual(labels, ['fog', 'ink outline', 'pixel', 'people', 'vehicles']);
    const fog = R.querySelector('.pk-display input'); fog.checked = true; fire(fog, 'change'); assert.strictEqual(P.sim.opts.fog, true, 'a switch still drives the viewer');
  });
  await test('chart: the line chart has a series per state, a title from the manifest, an accessible description and follows the data', () => {
    const c = lineBox(); assert.strictEqual(c.querySelector('figcaption').textContent, 'Buildings by state over time (buildings)');
    assert.strictEqual(c.querySelectorAll('path[data-series]').length, 4); assert.deepStrictEqual([...c.querySelectorAll('.pc-legend button')].map(b => b.textContent), ['S', 'E', 'I', 'R']);
    const desc = c.querySelector('desc').textContent; assert(new RegExp('S: ' + colA(0)[0] + ' at Day 0, ' + colA(0)[M.time.steps] + ' at Day ' + M.time.steps).test(desc), desc);
    assert.strictEqual(c.querySelector('svg').getAttribute('role'), 'img');
  });
  await test('chart: the cursor follows the timeline and the readout gives the values at that time', () => {
    store.setTime(30); const c = lineBox(), rd = c.querySelector('.pc-readout').textContent;
    assert.strictEqual(rd, 'Day 30: ' + ['S', 'E', 'I', 'R'].map((n, i) => n + ' ' + colA(i)[30] + ' buildings').join(' · '));
    const x30 = +c.querySelector('line[data-cursor=time]').getAttribute('x1'); store.setTime(90); assert(+c.querySelector('line[data-cursor=time]').getAttribute('x1') > x30);
  });
  await test('chart: hovering a chart shows its value at that time on every chart, clicking it moves the timeline', () => {
    const c = lineBox(), svg = c.querySelector('svg'); svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 440, height: 236 });
    const hover = x => svg.dispatchEvent(new w.MouseEvent('pointermove', { clientX: x }));
    hover(46 + (440 - 60) * 0.5); assert(/^Day 80 \(pointer\):/.test(c.querySelector('.pc-readout').textContent), c.querySelector('.pc-readout').textContent);
    assert(c.querySelector('line[data-cursor=hover]'));
    svg.dispatchEvent(new w.MouseEvent('pointerleave')); assert(!c.querySelector('line[data-cursor=hover]'));
    svg.dispatchEvent(new w.MouseEvent('click', { clientX: 46 + (440 - 60) * 0.25 })); assert.strictEqual(store.time().t, 40); assert(/^Day 40:/.test(c.querySelector('.pc-readout').textContent));
  });
  await test('chart: the bar chart shows the buildings in each state on the day shown, and changes with the time', () => {
    const c = R.querySelector('[data-chart=bar]'); assert.strictEqual(c.querySelectorAll('rect[data-cat]').length, 4);
    store.setTime(0); const t0 = c.querySelector('rect[data-cat=S] title').textContent; store.setTime(100); const t100 = c.querySelector('rect[data-cat=S] title').textContent;
    assert.strictEqual(t0, 'S: ' + colA(0)[0] + ' buildings'); assert.notStrictEqual(t0, t100); assert.strictEqual(t100, 'S: ' + colA(0)[100] + ' buildings');
  });
  await test('chart: moving a slider re-runs the model and the lines move with it', async () => {
    const before = lineBox().querySelector('path[data-series=I]').getAttribute('d'), runs = ctl.runs;
    const s = d.querySelector('[data-param=beta]'); s.value = '0.9'; fire(s, 'input'); assert(await until(() => ctl.runs > runs)); assert(await settled());
    assert.notStrictEqual(lineBox().querySelector('path[data-series=I]').getAttribute('d'), before);
    d.querySelector('[data-preset=baseline]').click(); assert(await until(() => store.param('beta') === M.params.beta.default)); assert(await settled());
  });
  await test('kpis: the tiles read the series (the highest, the day shown, the end of the run)', () => {
    store.setTime(25); const tiles = Object.fromEntries([...Bt.querySelectorAll('.pc-kpi')].map(t => [t.querySelector('.pc-kpi-label').textContent, t.querySelector('.pc-kpi-value').textContent]));
    assert.strictEqual(tiles['Peak infectious'], Math.max(...colA(2)) + ' buildings');
    assert.strictEqual(tiles['Susceptible on the day shown'], colA(0)[25] + ' buildings');
    assert.strictEqual(tiles['Recovered by the end'], colA(3)[M.time.steps] + ' buildings');
    assert(!Bt.querySelector('.pc-kpi-cmp'), 'no comparison yet');
  });
  await test('presets: buttons say whether they are pressed, and Reset returns the defaults', async () => {
    const b = d.querySelector('[data-preset=lockdown]'); assert.strictEqual(b.getAttribute('aria-pressed'), 'false'); b.click();
    assert(await until(() => b.getAttribute('aria-pressed') === 'true')); assert.strictEqual(d.querySelector('[data-preset=baseline]').getAttribute('aria-pressed'), 'false');
    d.querySelector('[data-reset]').click(); assert.strictEqual(store.param('lockdown'), 'none'); assert.strictEqual(d.querySelector('[data-preset=baseline]').getAttribute('aria-pressed'), 'true');
    assert(await settled());
  });

  // ---- A/B compare ----
  await test('compare: nothing runs until it is switched on; then B (the first preset that differs) runs on its own handle', async () => {
    assert.strictEqual(cmp.ctlB, null); assert.strictEqual(cmp.B.length(), 0);
    const t = d.querySelector('[data-compare]'); t.checked = true; fire(t, 'change');
    assert.strictEqual(cmp.enabled, true); assert(cmp.ctlB && cmp.runtimeB && cmp.runtimeB !== P.runtime, 'a second runtime handle');
    assert(await settledB(), 'B finished'); assert.strictEqual(JSON.stringify(cmp.bSource), '{"preset":"lockdown"}'); assert.strictEqual(cmp.B.param('lockdown'), 'full');
    assert.strictEqual(store.param('lockdown'), 'none', 'A is untouched');
    assert.strictEqual(d.querySelector('[data-compare-b]').value, 'p:lockdown');
    assert(/lockdown: A None, B Full/i.test(d.querySelector('.pk-diff').textContent), d.querySelector('.pk-diff').textContent);
  });
  await test('compare: B is overlaid on the line chart as dashed lines in the colours of A, and named in the legend', () => {
    const c = lineBox(), dashed = [...c.querySelectorAll('path[data-b]')], solid = [...c.querySelectorAll('path[data-series]:not([data-b])')];
    assert.strictEqual(dashed.length, 4); assert(dashed.every(p => p.getAttribute('stroke-dasharray'))); assert.deepStrictEqual(dashed.map(p => p.getAttribute('stroke')), solid.map(p => p.getAttribute('stroke')));
    assert(/I \(B\)/.test(c.querySelector('.pc-legend').textContent));
    const rd = c.querySelector('.pc-readout').textContent; assert(/I \(B\)/.test(rd) && /I \d+ buildings/.test(rd), rd);
    const bI = cmp.B.series('counts').map(p => p[2]); assert(Math.max(...bI) < Math.max(...colA(2)), 'a full lockdown flattens the curve');
  });
  await test('compare: the bar chart gets dashed outlines for B and a legend that explains them', () => {
    const c = R.querySelector('[data-chart=bar]'); assert.strictEqual(c.querySelectorAll('rect[data-b]').length, 4); assert(/B \(comparison\)/.test(c.querySelector('.pc-legend').textContent));
  });
  await test('compare: KPI tiles show B and the difference with a sign and an arrow', () => {
    const tile = [...Bt.querySelectorAll('.pc-kpi')].find(t => t.getAttribute('data-kpi') === 'Peak infectious'), cm = tile.querySelector('.pc-kpi-cmp');
    const a = Math.max(...colA(2)), b = Math.max(...cmp.B.series('counts').map(p => p[2])); assert(cm, 'a comparison line');
    assert(cm.textContent.startsWith('B ' + b + ' buildings · ▼ −' + (a - b)), cm.textContent); assert.strictEqual(+cm.getAttribute('data-delta'), b - a);
  });
  await test('compare: B stays put while A changes, and a moved A slider re-runs only A', async () => {
    const bRuns = cmp.ctlB.runs, aRuns = ctl.runs, s = d.querySelector('[data-param=contacts]'); s.value = '9'; fire(s, 'input');
    assert(await until(() => ctl.runs > aRuns)); assert(await settled()); await sleep(80); assert.strictEqual(cmp.ctlB.runs, bRuns, 'B did not re-run'); assert.strictEqual(cmp.B.param('contacts'), M.params.contacts.default);
    assert(/Contacts per day: A 9, B 5/.test(d.querySelector('.pk-diff').textContent), d.querySelector('.pk-diff').textContent);
    d.querySelector('[data-reset]').click(); assert(await settled());
  });
  await test('compare: the time is shared; B follows A on the timeline', () => {
    store.setTime(50); assert.strictEqual(cmp.B.time().t, 50); store.setTime(70); assert.strictEqual(cmp.B.time().t, 70);
  });
  await test('compare: the map shows A, and flips to B (its frames, its bound colours) and back, by button or by the B key', async () => {
    store.setTime(60); const bound = P.binding, fieldsOf = () => Array.from(P.view.bound(bound.entity).fields.state).join('');
    const a = fieldsOf(), va = P.sim.frameVersion, badge = d.getElementById('mapbadge'); assert(badge.hidden);
    d.querySelector('[data-show=b]').click(); assert.strictEqual(cmp.showing, 'b');
    const b = fieldsOf(); assert.notStrictEqual(a, b, 'the bound arrays now hold B'); assert.strictEqual(b, (() => { const g = Array(P.sim.buildings.length).fill(-1); for (let k = 0; k < bound.count; k++) if (bound.index[k] >= 0) g[bound.index[k]] = cmp.B.frameAt(60).entities.building.state[k]; return g.join(''); })());
    assert(P.sim.frameVersion !== va, 'the renderer is told the picture changed'); assert(!badge.hidden && /Map shows B: Full lockdown/.test(badge.textContent), badge.textContent);
    assert.strictEqual(d.querySelector('[data-show=b]').getAttribute('aria-pressed'), 'true');
    store.setTime(61); assert.strictEqual(P.view.frame().t, 61); assert.strictEqual(P.view.frame(), cmp.B.frameAt(61));
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'b', bubbles: true })); assert.strictEqual(cmp.showing, 'a'); assert(badge.hidden);
    store.setTime(60); assert.strictEqual(fieldsOf(), a, 'back to A');
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'B', bubbles: true })); assert.strictEqual(cmp.showing, 'b'); cmp.show('a');
  });
  await test('compare: the tooltip and inspector read the run on screen', async () => {
    cmp.show('b'); const k = 0; store.select({ entity: 'building', id: k }); const rows = require_entityRows(w, P, k);
    assert.strictEqual(rows.find(r => r.label === 'state').value, w.PackHost.entityRows(M, P.view, { entity: 'building', id: k }).find(r => r.label === 'state').value);
    const bState = cmp.B.frame().entities.building.state[k]; assert.strictEqual(rows.find(r => r.label === 'state').value, ['Susceptible', 'Exposed', 'Infectious', 'Recovered'][bState]);
    cmp.show('a'); store.select(null);
  });
  await test('compare: hold current settings keeps a snapshot of A as B; the snapshot is listed and used', async () => {
    const s = d.querySelector('[data-param=beta]'); s.value = '0.5'; fire(s, 'input'); assert(await settled());
    d.querySelector('[data-compare-hold]').click(); assert.strictEqual(cmp.snapshotsList.length, 1); assert.strictEqual(JSON.stringify(cmp.bSource), '{"snapshot":"s1"}');
    assert.strictEqual(cmp.B.param('beta'), 0.5); assert(await settledB()); assert.strictEqual(d.querySelector('[data-compare-b]').value, 's:s1');
    assert(/Snapshot 1/.test(d.querySelector('[data-compare-b] optgroup[label=Snapshots]').textContent));
    assert.strictEqual(d.querySelector('.pk-diff').textContent, 'B has the same settings as A.');
    const kp = [...Bt.querySelectorAll('.pc-kpi')].map(t => t.querySelector('.pc-kpi-cmp').getAttribute('data-delta')); assert(kp.every(x => +x === 0), 'identical settings, identical results: ' + kp);
    s.value = String(M.params.beta.default); fire(s, 'input'); assert(await settled());
    assert(/Transmission per contact[^:]*: A 0\.08 share, B 0\.5 share/.test(d.querySelector('.pk-diff').textContent), d.querySelector('.pk-diff').textContent);
  });
  await test('compare: switching it off removes the overlay and the deltas and returns the map to A', async () => {
    cmp.show('b'); const t = d.querySelector('[data-compare]'); t.checked = false; fire(t, 'change');
    assert.strictEqual(cmp.enabled, false); assert.strictEqual(cmp.showing, 'a'); assert.strictEqual(lineBox().querySelectorAll('path[data-b]').length, 0); assert(!Bt.querySelector('.pc-kpi-cmp'));
    assert.strictEqual(d.getElementById('mapbadge').hidden, true);
  });
  await test('page: no errors while all of this ran', () => { assert.strictEqual(d.getElementById('problem').textContent, ''); assert.deepStrictEqual(errs, []); });
  // ---- a variant of the pack: a stacked area chart in the bottom region, the formal register, a single-chart layout without compare ----
  if (process.argv[3]) {
    const vdom = new JSDOM(fs.readFileSync(process.argv[3], 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, resources: 'usable', url: 'http://localhost/#worker=0&register=formal' });
    assert(await until(() => vdom.window.labPack), 'the variant page made a pack: ' + errs.slice(0, 2).join(' | ').slice(0, 300));
    const V = vdom.window, vd = V.document, VP = V.labPack;
    await until(() => !VP.controller.running && VP.store.length() === VP.manifest.time.steps + 1);
    await test('variant: an area chart in the bottom region, drawn in the formal register, stacks to the number of buildings', () => {
      const c = vd.querySelector('#bottom [data-chart=area]'); assert(c, 'an area chart'); assert.strictEqual(c.getAttribute('data-register'), 'formal'); assert.strictEqual(VP.register, 'formal');
      assert.strictEqual(vd.body.getAttribute('data-register'), 'formal');
      assert(c.innerHTML.includes('#6929c4') && !c.innerHTML.includes('#0072b2'), 'the Carbon palette'); assert.strictEqual(c.querySelectorAll('path[data-series]').length, 4);
      const top = Math.max(...[...c.querySelectorAll('text')].map(x => +x.textContent).filter(Number.isFinite)), n = VP.store.series('counts')[0].reduce((a, b) => a + b, 0); assert(top >= n && top < n * 1.5, 'the axis covers the stack total ' + n + ': ' + top);
    });
    await test('variant: without a compare item there is no compare panel, and the map still reads the store through the view', () => {
      assert(!vd.querySelector('[data-compare]')); assert.strictEqual(VP.compare.enabled, false); assert.strictEqual(VP.view.frame(), VP.store.frame());
      assert.strictEqual(vd.querySelector('#right [data-item=display]'), null, 'a layout that leaves Display out has none');
    });
    await test('variant: a one-value series may be a bare number (the chart reads it)', () => {
      const D = V.PackDash; assert.strictEqual(D.valueOf(5, 0), 5); assert(Number.isNaN(D.valueOf(5, 1))); assert.strictEqual(D.valueOf([1, 2], 1), 2); assert.strictEqual(D.valueOf(new V.Float32Array([3, 4]), 1), 4); assert.strictEqual(D.column([1, 2, 3], 0).join(), '1,2,3');
    });
  }
  console.log(failed ? failed + ' failed' : 'all passed'); process.exit(failed ? 1 : 0);
})();
function require_entityRows(w, P, k) { return w.PackHost.entityRows(P.manifest, P.view, { entity: 'building', id: k }); }
