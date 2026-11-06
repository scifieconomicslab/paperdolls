/* Tests for the embedded SVG chart module (viz/packcharts.js): line, stacked area, bar and KPI tiles; accessibility (title, description, labelled legend, marker shapes),
 * colour-blind-safe palettes in both registers, the A/B overlay (dashed), the cursor and the hover readout. Needs jsdom (skips without it).
 * Run: node viz/test_pack_charts.js */
let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (e) { console.log('SKIP (jsdom not installed)'); process.exit(0); }
const fs = require('fs'), path = require('path'), assert = require('assert');
const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' }), w = dom.window, d = w.document;
w.eval(fs.readFileSync(path.join(__dirname, 'packcharts.js'), 'utf8'));
const PC = w.PackCharts;
let failed = 0; const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const ramp = (n, f) => Array.from({ length: n + 1 }, (_, t) => f(t));
const lines = (extra) => Object.assign({ type: 'line', title: 'Adoption', unit: '%', xUnit: 'Day', horizon: 100, cursor: 10,
  series: [{ key: 'q1', label: 'Q1', values: ramp(100, t => t * 0.2) }, { key: 'q2', label: 'Q2', values: ramp(100, t => t * 0.5) }, { key: 'q3', label: 'Q3', values: ramp(100, t => Math.min(80, t)) }] }, extra);
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('line: one path per series, a title, a described role=img svg and a legend naming every series', () => {
  const c = PC.create(d, lines());
  assert.strictEqual(c.el.querySelector('figcaption').textContent, 'Adoption (%)');
  assert.strictEqual(c.svg.getAttribute('role'), 'img');
  const ids = c.svg.getAttribute('aria-labelledby').split(' '); assert.strictEqual(ids.length, 2); for (const id of ids) assert(d.getElementById(id) || c.el.querySelector('#' + id), 'labelled by an element that exists: ' + id);
  assert.strictEqual(c.svg.querySelectorAll('path[data-series]').length, 3);
  const desc = c.svg.querySelector('desc').textContent; assert(/Line chart of Adoption/.test(desc) && /Q1: 0 at Day 0, 20 at Day 100/.test(desc) && /Q3: 0 at Day 0, 80 at Day 100, highest 80/.test(desc), desc);
  assert.deepStrictEqual([...c.legend.querySelectorAll('button')].map(b => b.textContent), ['Q1', 'Q2', 'Q3']);
  assert(c.svg.getAttribute('viewBox') && c.svg.style.width === '100%', 'responsive: sized by viewBox, not by pixels');
  assert(!/width="\d/.test(c.svg.outerHTML.split('>')[0]), 'no fixed pixel width on the svg element');
});
test('line: the y axis starts at zero, covers the data with nice ticks, and the x axis spans the whole horizon', () => {
  const [t, lo, hi] = PC.niceTicks(0, 80, 4); assert.strictEqual(lo, 0); assert(hi >= 80); assert.strictEqual(t.slice(0, 3).join(), '0,20,40');
  const c = PC.create(d, lines()); const txt = [...c.svg.querySelectorAll('text')].map(x => x.textContent);
  assert(txt.includes('0') && txt.includes('100') && txt.includes('80'), txt.join(','));
  assert(txt.includes('days'), 'x axis label from the unit');
});
test('line: NaN breaks the line instead of drawing a zero', () => {
  const v = ramp(10, t => (t === 5 ? NaN : t)); const c = PC.create(d, lines({ horizon: 10, series: [{ key: 'a', label: 'A', values: v }] }));
  assert.strictEqual((c.svg.querySelector('path[data-series=a]').getAttribute('d').match(/M/g) || []).length, 2);
});
test('series are told apart by more than colour: every one has its own marker shape, and the palettes are colour-blind safe', () => {
  assert.strictEqual(new Set(PC.MARKERS.slice(0, 5)).size, 5);
  const c = PC.create(d, lines()); const sw = [...c.legend.querySelectorAll('svg')].map(s => s.innerHTML);
  assert.strictEqual(new Set(sw).size, 3, 'legend swatches differ in shape as well as colour');
  assert(PC.PALETTES.colorfigures.includes('#0072b2') && PC.PALETTES.colorfigures.includes('#d55e00'), 'Okabe-Ito blue and vermillion');
  assert(PC.PALETTES.formal[0] === '#6929c4' && PC.PALETTES.formal[1] === '#1192e8', 'Carbon categorical order');
  for (const reg of ['colorfigures', 'formal']) for (const col of PC.PALETTES[reg]) assert(contrast(col, '#ffffff') >= 3, reg + ' ' + col + ' has at least 3:1 against white (graphics)');
  assert(contrast(PC.THEME.formal.muted, PC.THEME.formal.paper) >= 4.5 && contrast(PC.THEME.colorfigures.muted, PC.THEME.colorfigures.paper) >= 4.5, 'axis text is legible in both registers');
});
test('registers: formal and colorfigures draw with their own palette and font, and say so on the figure', () => {
  const a = PC.create(d, lines({ register: 'colorfigures' })), b = PC.create(d, lines({ register: 'formal' }));
  assert.strictEqual(a.el.getAttribute('data-register'), 'colorfigures'); assert.strictEqual(b.el.getAttribute('data-register'), 'formal');
  assert(a.svg.innerHTML.includes('#0072b2') && !a.svg.innerHTML.includes('#6929c4')); assert(b.svg.innerHTML.includes('#6929c4') && !b.svg.innerHTML.includes('#0072b2'));
  assert(/Plex/.test(b.svg.innerHTML) && !/Plex/.test(a.svg.innerHTML));
});
test('line: a comparison series is dashed, in the colour of the series it compares with, and named in the legend', () => {
  const s = lines().series; const b = s.map((x, i) => ({ key: x.key + '@b', label: x.label + ' (B)', values: x.values.map(v => v * 0.5), b: true, colourIndex: i }));
  const c = PC.create(d, lines({ series: s.concat(b) }));
  const dashed = [...c.svg.querySelectorAll('path[data-b]')], solid = [...c.svg.querySelectorAll('path[data-series]:not([data-b])')];
  assert.strictEqual(dashed.length, 3); assert(dashed.every(p => p.getAttribute('stroke-dasharray')), 'dashed'); assert(solid.every(p => !p.getAttribute('stroke-dasharray')));
  assert.deepStrictEqual(dashed.map(p => p.getAttribute('stroke')), solid.map(p => p.getAttribute('stroke')));
  assert(/Q1 \(B\)/.test(c.legend.textContent));
});
test('line: the y axis grows to include the comparison run', () => {
  const lo = PC.create(d, lines({ series: [{ key: 'a', label: 'A', values: [0, 10] }], horizon: 1 }));
  const hi = PC.create(d, lines({ series: [{ key: 'a', label: 'A', values: [0, 10] }, { key: 'b', label: 'B', values: [0, 90], b: true }], horizon: 1 }));
  const top = c => Math.max(...[...c.svg.querySelectorAll('text')].map(x => +x.textContent).filter(Number.isFinite));
  assert(top(hi) >= 90 && top(lo) < 90);
});
test('line: the legend hides and shows a series (a real button with aria-pressed)', () => {
  const c = PC.create(d, lines()); const btn = c.legend.querySelector('button'); assert.strictEqual(btn.getAttribute('aria-pressed'), 'true');
  btn.click(); assert.strictEqual(c.svg.querySelectorAll('path[data-series]').length, 2); assert.strictEqual(c.legend.querySelector('button').getAttribute('aria-pressed'), 'false');
  c.legend.querySelector('button').click(); assert.strictEqual(c.svg.querySelectorAll('path[data-series]').length, 3);
});
test('cursor and hover: the cursor line sits at the time, the readout gives each series value there, and hover is a second dotted line', () => {
  const seen = []; const c = PC.create(d, lines({ onHover: t => seen.push(t) }));
  assert.strictEqual(c.readout.textContent, 'Day 10: Q1 2 % · Q2 5 % · Q3 10 %');
  const x = () => +c.svg.querySelector('line[data-cursor=time]').getAttribute('x1'); const x10 = x(); c.setCursor(60); assert(x() > x10); assert(/^Day 60: Q1 12 %/.test(c.readout.textContent));
  c.hoverAt(30); assert(c.svg.querySelector('line[data-cursor=hover]')); assert(/^Day 30 \(pointer\): Q1 6 %/.test(c.readout.textContent)); assert.deepStrictEqual(seen, [30]);
  c.hoverAt(null); assert(!c.svg.querySelector('line[data-cursor=hover]')); assert(/^Day 60:/.test(c.readout.textContent)); assert.deepStrictEqual(seen, [30, null]);
  const marks = c.svg.querySelectorAll('.pc-cursor circle, .pc-cursor rect, .pc-cursor path'); assert(marks.length >= 3, 'a marker per series at the cursor');
});
test('pointer: an x position maps to the nearest time, a pointer event hovers, leaving clears, a click picks', () => {
  const log = { h: [], p: [] }; const c = PC.create(d, lines({ onHover: t => log.h.push(t), onPick: t => log.p.push(t) }));
  c.svg.getBoundingClientRect = () => ({ left: 100, top: 0, width: 440, height: 236 });                         // 1 px = 1 viewBox unit
  assert.strictEqual(c.tFromX(100 + 46), 0); assert.strictEqual(c.tFromX(100 + 46 + (440 - 46 - 14) / 2), 50); assert.strictEqual(c.tFromX(99999), 100); assert.strictEqual(c.tFromX(-5), 0);
  c.svg.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 100 + 46 + (440 - 60) * 0.25 })); assert.deepStrictEqual(log.h, [25]);
  c.svg.dispatchEvent(new w.MouseEvent('click', { clientX: 100 + 46 + (440 - 60) * 0.75 })); assert.deepStrictEqual(log.p, [75]);
  c.svg.dispatchEvent(new w.MouseEvent('pointerleave')); assert.deepStrictEqual(log.h, [25, null]);
});
test('area: series are stacked, the stack top equals the sum, and a comparison is a dashed line along its own stack', () => {
  const c = PC.create(d, { type: 'area', title: 'Households', horizon: 4, cursor: 4, xUnit: 'Year', series: [{ key: 'a', label: 'Done', values: [0, 1, 2, 3, 4] }, { key: 'b', label: 'To do', values: [4, 3, 2, 1, 0] }] });
  assert.strictEqual(c.svg.querySelectorAll('path[data-series]').length, 2);
  const txt = [...c.svg.querySelectorAll('text')].map(x => +x.textContent).filter(Number.isFinite); assert(Math.max(...txt) >= 4 && Math.max(...txt) < 8, 'domain is the stack total (4), not the sum of maxima: ' + txt);
  assert(/Stacked area chart/.test(c.svg.querySelector('desc').textContent));
  c.update({ series: c.spec.series.concat([{ key: 'a@b', label: 'Done (B)', values: [0, 2, 4, 6, 8], b: true, colourIndex: 0 }]) });
  assert.strictEqual(c.svg.querySelectorAll('path[data-b]').length, 1);
  assert(Math.max(...[...c.svg.querySelectorAll('text')].map(x => +x.textContent).filter(Number.isFinite)) >= 8, 'the axis includes the B stack');
});
test('bar: a bar per category with its value, an accessible description, and labels that wrap', () => {
  const cats = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'].map((q, i) => ({ label: q, value: 10 + i * 5 }));
  const c = PC.create(d, { type: 'bar', title: 'Rebate per euro of subsidy', unit: '€', categories: cats });
  assert.strictEqual(c.svg.querySelectorAll('rect[data-cat]').length, 5); assert(c.svg.querySelector('rect[data-cat=Q5] title').textContent === 'Q5: 30 €');
  assert(/Bar chart of Rebate per euro of subsidy\. Q1 10 €; Q2 15 €/.test(c.svg.querySelector('desc').textContent));
  const h = r => +r.getAttribute('height'); assert(h(c.svg.querySelector('rect[data-cat=Q5]')) > h(c.svg.querySelector('rect[data-cat=Q1]')));
  const d2 = PC.create(d, { type: 'bar', title: 'Cost', categories: [{ label: 'Pay the vendor direct', value: 3 }, { label: 'Rebate only', value: 2 }, { label: 'Loan', value: 2 }, { label: 'Co-op managed delivery', value: 1 }, { label: 'Tax credit', value: 1 }] });
  assert(d2.svg.querySelectorAll('text').length > 4 && [...d2.svg.querySelectorAll('text')].some(t => /^(vendor|direct|the vendor|managed|delivery)/.test(t.textContent)), 'a long label is split over lines');
});
test('bar: missing data says so and is not drawn as zero; comparison bars are dashed outlines beside the bar; negatives hang below zero', () => {
  const c = PC.create(d, { type: 'bar', title: 'X', categories: [{ label: 'A', value: NaN }, { label: 'B', value: 4, valueB: 6 }, { label: 'C', value: -2 }] });
  assert(![...c.svg.querySelectorAll('rect')].some(r => r.getAttribute('data-cat') === 'A'), 'no rect for no data'); assert([...c.svg.querySelectorAll('text')].some(t => t.textContent === 'no data'));
  assert.strictEqual(c.svg.querySelectorAll('rect[data-b]').length, 1); assert(c.svg.querySelector('rect[data-b]').getAttribute('stroke-dasharray'));
  assert(/comparison 6/.test(c.svg.querySelector('desc').textContent));
  assert(/B \(comparison\)/.test(c.legend.textContent), 'legend explains the dashed bars');
  const cy = +c.svg.querySelector('rect[data-cat=C]').getAttribute('y'), by = +c.svg.querySelector('rect[data-cat=B]:not([data-b])').getAttribute('y'); assert(cy > by);
});
test('bar: updating redraws in place', () => {
  const c = PC.create(d, { type: 'bar', title: 'X', categories: [{ label: 'A', value: 1 }] }); const h0 = +c.svg.querySelector('rect[data-cat=A]').getAttribute('height');
  c.update({ categories: [{ label: 'A', value: 1 }, { label: 'B', value: 5 }] }); assert.strictEqual(c.svg.querySelectorAll('rect[data-cat]').length, 2); assert(+c.svg.querySelector('rect[data-cat=A]').getAttribute('height') < h0);
});
test('kpis: value with unit; with a comparison, B and the delta are shown in words and signs, not by colour', () => {
  const k = PC.kpis(d, [{ label: 'Public cost', value: 1200000, unit: '€' }, { label: 'Bills saved', value: 50, unit: '€', valueB: 80, decimals: 0 }, { label: 'Same', value: 5, valueB: 5 }, { label: 'Lower', value: 10, valueB: 4 }]);
  const tiles = [...k.el.querySelectorAll('.pc-kpi')]; assert.strictEqual(tiles.length, 4);
  assert.strictEqual(tiles[0].querySelector('.pc-kpi-value').textContent, '1.2 m €'); assert(!tiles[0].querySelector('.pc-kpi-cmp'));
  assert.strictEqual(tiles[1].querySelector('.pc-kpi-cmp').textContent, 'B 80 € · ▲ +30 (+60%) vs A');
  assert(/= ±0/.test(tiles[2].querySelector('.pc-kpi-cmp').textContent)); assert(/▼ −6 \(−60%\)/.test(tiles[3].querySelector('.pc-kpi-cmp').textContent));
  assert(tiles[1].getAttribute('aria-label').includes('Bills saved'));
  k.update([{ label: 'N', value: NaN }]); assert.strictEqual(k.el.querySelector('.pc-kpi-value').textContent, 'no data');
});
test('text is escaped: a label with markup cannot inject elements', () => {
  const c = PC.create(d, lines({ title: '<img src=x onerror=alert(1)>', series: [{ key: 'a', label: '</text><script>x</script>', values: [1, 2] }], horizon: 1 }));
  assert(!c.el.querySelector('script') && !c.el.querySelector('img')); assert(c.svg.querySelector('desc').textContent.includes('<script>'));
});
test('the module is dependency-free and reaches nothing outside the page', () => {
  const src = fs.readFileSync(path.join(__dirname, 'packcharts.js'), 'utf8'); assert(!/https?:\/\/(?!www\.w3\.org)/.test(src) && !/\bimport\(|\brequire\(|XMLHttpRequest|fetch\(/.test(src));
});

(async () => {
  for (const [name, fn] of queue) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.message) + (e && e.stack ? '\n  ' + e.stack.split('\n').slice(1, 3).join(' ').replace(/\s+/g, ' ') : '')); } }
  console.log(failed ? failed + ' failed' : 'all passed'); process.exit(failed ? 1 : 0);
})();
