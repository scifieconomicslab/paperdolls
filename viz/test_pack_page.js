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
async function test(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message)); } }
(async () => {
  assert(await until(() => dom.window.labPack), 'the page made a pack: ' + errs.slice(0, 2).join(' | ').slice(0, 300));
  const w = dom.window, d = w.document, P = w.labPack, M = P.manifest, store = P.store, ctl = P.controller;
  const cv = d.getElementById('stage'); Object.defineProperty(cv, 'clientWidth', { value: 1000 }); Object.defineProperty(cv, 'clientHeight', { value: 600 }); w.dispatchEvent(new w.Event('resize'));
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
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
    store.setTime(40); const runs = ctl.runs, before = states(), series = JSON.stringify(store.series('counts').slice(-1));
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
  await test('page: the renderer is styled from the store, and the page draws without errors', async () => {
    assert.strictEqual(typeof P.sim.buildingStyle, 'function'); assert.strictEqual(P.binding.count, 600);
    await sleep(400);
    assert.strictEqual(errs.length, 0, 'no page errors: ' + errs.slice(0, 2).join(' | ').slice(0, 300));
  });
  if (failed) { console.log(failed + ' failed'); process.exit(1); }
  console.log('PASS pack page: controls, live re-run, presets, timeline, legend, banner'); process.exit(0);
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
