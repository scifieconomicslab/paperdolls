/* Drives a built replay page headlessly: it plays, scrubs, draws the legend from the mapping and shows no retrofit wording for another model.
 * Usage: node viz/test_replay_page.js replay.html     Needs jsdom and canvas (npm ci). Prints SKIP when jsdom is not installed. */
let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); } catch (e) { console.log('SKIP (jsdom not installed)'); process.exit(0); }
const fs = require('fs'), assert = require('assert');
const errs = [], vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push((e.detail && e.detail.stack) || e.message)); vc.on('error', e => errs.push(String(e)));
const dom = new JSDOM(fs.readFileSync(process.argv[2], 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, resources: 'usable' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await sleep(700);
  const w = dom.window, d = w.document, cv = d.getElementById('stage');
  Object.defineProperty(cv, 'clientWidth', { value: 1200 }); Object.defineProperty(cv, 'clientHeight', { value: 700 }); w.dispatchEvent(new w.Event('resize'));
  const R = w.labReplay(); assert(R, 'the page made a replay');
  assert(d.getElementById('replaybar').style.display !== 'none', 'the replay bar is shown');
  assert.strictEqual(d.getElementById('rpLabel').textContent, 'Week 0 of ' + (R.weeks - 1));
  const slider = d.getElementById('rpWeek'); slider.value = 3; slider.dispatchEvent(new w.Event('input'));
  assert.strictEqual(R.week, 3); assert.strictEqual(d.getElementById('rpLabel').textContent, 'Week 3 of ' + (R.weeks - 1));
  const sp = d.getElementById('rpSpeed'); sp.value = '1'; sp.dispatchEvent(new w.Event('change')); assert.strictEqual(R.speed, 1);
  d.getElementById('rpPlay').click(); assert.strictEqual(R.playing, true); await sleep(1500);
  assert(R.week > 3, 'playing moves the week: ' + R.week); d.getElementById('rpPlay').click(); assert.strictEqual(R.playing, false);
  const text = (d.getElementById('rpLegend').textContent + ' ' + d.getElementById('rpNote').textContent);
  assert(/Placement invented/.test(text), 'the page says placement is invented');
  if (process.env.EXPECT_LEGEND) for (const t of process.env.EXPECT_LEGEND.split('|')) assert(text.includes(t), 'legend has ' + t + ': ' + text.slice(0, 200));
  if (process.env.FORBID_WORD) assert(!text.toLowerCase().includes(process.env.FORBID_WORD), 'the picture does not say ' + process.env.FORBID_WORD + ': ' + text.slice(0, 200));
  assert.strictEqual(errs.length, 0, 'no page errors: ' + errs.slice(0, 2).join(' | ').slice(0, 300));
  console.log('PASS replay page: bar, scrub, play, pause, legend, placement note');
  process.exit(0);
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
