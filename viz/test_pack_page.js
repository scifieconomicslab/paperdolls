/* Drives a built pack page headlessly (jsdom): the manifest becomes controls, a moved slider re-runs the model and changes the map's data, presets apply,
 * the timeline scrubs and plays, the legend is made from the mapping, and the page says its placement is invented.
 * Usage: node viz/test_pack_page.js toy.html     Needs jsdom and canvas (npm ci). Prints SKIP when jsdom is not installed. */
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); } catch (e) { console.log('SKIP (jsdom not installed)'); process.exit(0); }
const fs = require('fs'), assert = require('assert');
const errs = [], vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push((e.detail && e.detail.stack) || e.message)); vc.on('error', e => errs.push(String(e)));
const dom = new JSDOM(fs.readFileSync(process.argv[2], 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, resources: 'usable' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (cond, ms = 15000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await sleep(20); return cond(); };
let failed = 0;
async function test(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message) + (e && e.stack ? '\n  ' + e.stack.split('\n').slice(1, 3).join(' ').replace(/\s+/g, ' ') : '')); } }
(async () => {
  assert(await until(() => dom.window.labPack), 'the page made a pack: ' + errs.slice(0, 2).join(' | ').slice(0, 300));
  const w = dom.window, d = w.document, P = w.labPack, M = P.manifest, store = P.store, ctl = P.controller;
  const cv = d.getElementById('stage'); Object.defineProperty(cv, 'clientWidth', { value: 1000 }); Object.defineProperty(cv, 'clientHeight', { value: 600 }); w.dispatchEvent(new w.Event('resize'));
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  const settled = () => until(() => !ctl.running && store.length() === M.time.steps + 1);           // the run streams in from the worker (here: the same-thread fallback), so wait for it
  const states = () => Array.from(store.frame().entities.building.state).join('');

  await test('page: every parameter has a control with its label, unit and group', () => {
    for (const [name, p] of Object.entries(M.params)) {
      const el = d.querySelector('[data-param=' + name + ']'); assert(el, 'control for ' + name);
      const label = d.querySelector('label[for=' + el.id + ']'); assert(label && label.textContent.startsWith(p.label || name), 'label for ' + name + ': ' + (label && label.textContent));
      if (p.unit && p.type !== 'boolean') assert(label.textContent.includes(p.unit), 'unit for ' + name);
      assert.strictEqual(el.closest('fieldset').querySelector('legend').textContent, p.group, 'group of ' + name);
    }
    assert.strictEqual(d.querySelector('[data-param=beta]').type, 'range'); assert.strictEqual(d.querySelector('[data-param=masks]').type, 'checkbox'); assert.strictEqual(d.querySelector('[data-param=lockdown]').tagName, 'SELECT');
    assert.strictEqual(d.querySelector('[data-param=lockdown]').options[1].textContent, 'Partial');
  });
  await test('page: the sliders start at the defaults and show their value', () => {
    for (const [name, p] of Object.entries(M.params)) if (p.type === 'number') assert.strictEqual(+d.querySelector('[data-param=' + name + ']').value, p.default);
    assert.strictEqual(d.querySelector('output[for=' + d.querySelector('[data-param=beta]').id + ']').textContent, String(M.params.beta.default));
  });
  await test('page: moving a slider re-runs the model live and the frames change', async () => {
    assert(await settled(), 'the first run finished'); store.setTime(40); const runs = ctl.runs, before = states(), series = JSON.stringify(store.series('counts').slice(-1));
    const s = d.querySelector('[data-param=beta]'); s.value = '0.9'; fire(s, 'input');
    assert(await until(() => ctl.runs > runs), 'the model re-ran'); assert.strictEqual(store.param('beta'), 0.9);
    assert.strictEqual(store.time().t, 40, 'the time stays where it was');
    assert.notStrictEqual(states(), before, 'the map data at day 40 changed'); assert.strictEqual(d.querySelector('output[for=' + s.id + ']').textContent, '0.9');
    assert.notStrictEqual(JSON.stringify(store.series('counts').slice(-1)), series);
  });
  await test('page: a toggle and a select change the model too', async () => {
    const runs = ctl.runs, m = d.querySelector('[data-param=masks]'); m.checked = true; fire(m, 'change'); assert(await until(() => ctl.runs > runs)); assert.strictEqual(store.param('masks'), true);
    const b = d.querySelector('[data-param=beta]'); b.value = String(M.params.beta.default); fire(b, 'input');
    const l = d.querySelector('[data-param=lockdown]'); l.value = 'full'; fire(l, 'change'); assert(await until(() => store.param('lockdown') === 'full'));
    assert(await until(() => Math.max(...store.series('counts').map(p => p[2])) <= 5), 'a full lockdown stops the outbreak');
  });
  await test('page: many input events in one go cost one re-run', async () => {
    await sleep(50); const runs = ctl.runs, s = d.querySelector('[data-param=contacts]');
    for (const v of [2, 3, 4, 5, 6]) { s.value = String(v); fire(s, 'input'); }
    assert(await until(() => ctl.runs > runs)); await sleep(100); assert.strictEqual(ctl.runs, runs + 1); assert.strictEqual(store.param('contacts'), 6);
  });
  await test('page: a preset sets its parameters, resets the rest, and the controls follow', async () => {
    const btn = d.querySelector('[data-preset=lockdown]'); btn.click();
    assert(await until(() => store.param('lockdown') === 'full')); assert.strictEqual(d.querySelector('[data-param=lockdown]').value, 'full'); assert.strictEqual(+d.querySelector('[data-param=beta]').value, M.params.beta.default);
    assert.strictEqual(d.querySelector('[data-param=masks]').checked, false); assert(btn.classList.contains('on')); assert(!d.querySelector('[data-preset=baseline]').classList.contains('on'));
    d.querySelector('[data-preset=baseline]').click(); assert(await until(() => store.param('lockdown') === 'none')); assert(d.querySelector('[data-preset=baseline]').classList.contains('on'));
    await until(() => !ctl.dirty);
  });
  await test('page: the timeline scrubs, plays, pauses and changes speed', async () => {
    assert(await settled(), 'the run finished');
    const slider = d.querySelector('[data-time]'), label = d.querySelector('.pk-time'), play = d.querySelector('[data-play]');
    assert.strictEqual(+slider.max, M.time.steps); assert.strictEqual(label.textContent, 'Day ' + store.time().t + ' of ' + M.time.steps);
    slider.value = '25'; fire(slider, 'input'); assert.strictEqual(store.time().t, 25); assert.strictEqual(label.textContent, 'Day 25 of ' + M.time.steps);
    assert(/Buildings by state: S \d+ · E \d+ · I \d+ · R \d+/.test(d.querySelector('.pk-readout').textContent), d.querySelector('.pk-readout').textContent);
    const sp = d.querySelector('[data-speed]'); sp.value = String(M.time.speeds[2]); fire(sp, 'change'); assert.strictEqual(store.time().speed, M.time.speeds[2]);
    play.click(); assert.strictEqual(play.textContent, 'Pause'); assert(await until(() => store.time().t > 25), 'playing moves the time: ' + store.time().t);
    play.click(); assert.strictEqual(store.time().playing, false); assert.strictEqual(play.textContent, 'Play');
  });
  await test('page: the legend is made from the mappings, with a colour chooser for the two wall mappings', () => {
    const text = d.getElementById('right').textContent;
    for (const t of ['Infection state', 'Susceptible', 'Exposed', 'Infectious', 'Recovered', 'No data', 'Exposure today', 'marker on the building']) assert(text.includes(t), 'legend has ' + t);
    const sel = d.querySelector('[data-wall]'); assert(sel && sel.options.length === 2); sel.value = '1'; fire(sel, 'change'); assert.strictEqual(ctl.wall, 1);
  });
  await test('page: the display switches are there and the banner says placement is invented', () => {
    for (const l of ['people', 'vehicles', 'ink outline', 'pixel', 'fog']) assert(d.getElementById('right').textContent.includes(l), l);
    const b = d.getElementById('banner').textContent; assert(b.includes(M.banner) && /Placement invented/.test(b), b);
    assert.strictEqual(d.getElementById('problem').textContent, '');
  });
  // ---- picking, hover, selection, inspector, keys ----
  const cam = w.labViewer.camera, VZ = w.VizLib, ptr = (type, x, y, extra) => d.getElementById('stagebox').dispatchEvent(new w.MouseEvent(type, Object.assign({ bubbles: true, clientX: x, clientY: y }, extra || {})));
  const key = (k, target) => (target || d).dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  const spot = () => {                                       // a model building and a pixel on it that really hits it (not covered by a building in front)
    const view = cam.view(), W = 1000, H = 600;
    for (let k = 0; k < 600; k++) {
      const si = P.binding.index[k], sh = P.pick.silhouette(si), c = sh.footprint.reduce((a, p) => [a[0] + p[0] / sh.footprint.length, a[1] + p[1] / sh.footprint.length], [0, 0]), q = VZ.proj(view, c[0], c[1], sh.h * 0.5);
      if (q[0] > 20 && q[0] < W - 20 && q[1] > 20 && q[1] < H - 20 && P.pick.hit(view, q[0], q[1]) === si) return { k, x: q[0], y: q[1] };
    }
    throw new Error('no building in view');
  };
  await test('pick: hovering names the building under the pointer, and leaving hides the name', async () => {
    assert(await settled()); const s0 = spot(), tip = P.tip; assert(tip.hidden, 'hidden at first');
    ptr('pointermove', s0.x, s0.y); assert(!tip.hidden, 'shown over a building'); assert(tip.textContent.startsWith('Building ' + (s0.k + 1) + ': '), tip.textContent);
    assert(/^Building \d+: \w+ \S+/.test(tip.textContent), tip.textContent); assert.strictEqual(P.interaction.hovered(), s0.k);
    ptr('pointermove', 2, 2); assert(tip.hidden, 'hidden over the sky'); ptr('pointermove', s0.x, s0.y); ptr('pointerleave', s0.x, s0.y); assert(tip.hidden);
    ptr('pointermove', s0.x, s0.y); store.setTime(store.time().t === 12 ? 13 : 12); assert(!tip.hidden && tip.textContent.startsWith('Building'), 'the tooltip follows the time');
  });
  await test('pick: a click selects the building, the inspector shows it and asks the model for more, the time moves it on', async () => {
    const s0 = spot(), box = d.querySelector('.pk-inspector'); assert(box.hidden, 'no inspector without a selection');
    ptr('pointerdown', s0.x, s0.y); ptr('pointerup', s0.x, s0.y);
    assert.deepStrictEqual({ ...store.selection() }, { entity: 'building', id: s0.k }); assert(!box.hidden); assert.strictEqual(box.querySelector('.pk-ititle').textContent.split(' · ')[0], 'Building ' + (s0.k + 1));
    assert(box.querySelector('.pk-fields').textContent.includes('state'), 'the frame values show at once');
    assert(await until(() => /Exposed/.test(box.querySelector('.pk-extra').textContent)), 'the runtime was asked and answered: ' + box.querySelector('.pk-extra').textContent);
    const t = store.time().t === 30 ? 31 : 30; store.setTime(t);
    assert(await until(() => box.querySelector('.pk-extra dt').textContent === 'State on day ' + t), 'asked again for the new time: ' + box.querySelector('.pk-extra dt').textContent);
    P.interaction.drawHighlight(Object.assign({ log: [] }, ...['clearRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke', 'save', 'restore', 'setLineDash'].map(n => ({ [n]() { this.log.push(n); } }))), cam.view());
  });
  await test('pick: a drag does not select, a click on nothing clears, Esc clears, and the buttons work', async () => {
    let s0 = spot(); const box = d.querySelector('.pk-inspector'); store.select({ entity: 'building', id: s0.k }); assert.strictEqual(store.selection().id, s0.k, 'set up');
    ptr('pointerdown', s0.x, s0.y); ptr('pointermove', s0.x + 40, s0.y + 10, { buttons: 1 }); ptr('pointerup', s0.x + 40, s0.y + 10); assert.strictEqual(store.selection().id, s0.k, 'a drag leaves the selection alone');
    s0 = spot();                                             // the drag panned the camera
    ptr('pointerdown', 3, 3); ptr('pointerup', 3, 3); assert.strictEqual(store.selection(), null); assert(box.hidden);
    ptr('pointerdown', s0.x, s0.y); ptr('pointerup', s0.x, s0.y); assert.strictEqual(store.selection().id, s0.k); key('Escape'); assert.strictEqual(store.selection(), null); assert(box.hidden);
    ptr('pointerdown', s0.x, s0.y); ptr('pointerup', s0.x, s0.y); box.querySelector('[data-clear]').click(); assert.strictEqual(store.selection(), null);
  });
  await test('pick: the arrow keys step the time (and pause), except on a slider that has the focus', async () => {
    store.setTime(10); store.setPlaying(true); key('ArrowRight'); assert.strictEqual(store.time().t, 11); assert.strictEqual(store.time().playing, false);
    key('ArrowLeft'); key('ArrowLeft'); assert.strictEqual(store.time().t, 9); key('ArrowRight', d.querySelector('[data-time]')); assert.strictEqual(store.time().t, 9, 'a focused slider keeps its own keys');
    store.setTime(0); key('ArrowLeft'); assert.strictEqual(store.time().t, 0);
  });
  await test('patch: the page is running a worker-shaped runtime (here the same-thread fallback) and the frames after day 0 are patches', async () => {
    assert.strictEqual(P.runtime.async, true); assert.strictEqual(P.runtime.mode, 'inline', 'jsdom has no Worker'); assert(P.binding.styleCount() > 0);
    assert(store.frameAt(5).patch && store.frameAt(5).entities, 'the store holds whole frames that remember their patch');
    assert.strictEqual(typeof P.sim.frameVersion, 'number');
  });
  await test('page: the renderer is styled from the store, and the page draws without errors', async () => {
    assert.strictEqual(typeof P.sim.buildingStyle, 'function'); assert.strictEqual(P.binding.count, 600);
    await sleep(400);
    assert.strictEqual(errs.length, 0, 'no page errors: ' + errs.slice(0, 2).join(' | ').slice(0, 300));
  });
  if (failed) { console.log(failed + ' failed'); process.exit(1); }
  console.log('PASS pack page: controls, live re-run, presets, timeline, legend, banner'); process.exit(0);
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
