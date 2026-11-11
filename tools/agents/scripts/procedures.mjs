// Procedure-level parity tests against desktop NetLogo 7.0.4 (see parity/METHOD.md, and spikes/0b-agents as the method's origin).
//   NETLOGO_HOME=... node scripts/procedures.mjs            # run the three procedure gates live, exit 0/1
//   node scripts/procedures.mjs --record                    # re-record test/fixtures/procedures-7.0.4.json instead of comparing
//
// 1. grow-grass (deterministic): six patches in fixed states, one call each; results must match exactly.
// 2. move (random): one turtle calls move 5,000 times; the per-call heading change must match in distribution (KS test).
// 3. the wolves' turn in go (random, order matters): a fixture with one wolf and one sheep on the wolf's patch; 2,000 repeats;
//    the share of repeats in which the sheep was eaten must match.
//
// The TS side runs the actual example model's procedures (examples/wolf-sheep.ts `procs`), not a copy: if the example
// changes semantics, this test changes with it. NetLogo is needed only for the fixture regeneration (or the live gate);
// the offline test (test/procedures.test.ts) replays the recorded fixtures and needs no NetLogo.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentWorld, COLOR } from '../library/index.ts';
import { procs, default as _mdl } from '../examples/wolf-sheep.ts';
import { resolveParams } from '../library/index.ts';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const record = process.argv.includes('--record');
const home = process.env.NETLOGO_HOME || new URL('../../../tools/NetLogo/', import.meta.url).pathname;
const model = join(home, 'models/Sample Models/Biology/Wolf Sheep Predation.nlogox');
const dir = mkdtempSync(join(tmpdir(), 'nlp-'));
const v = (n, x) => `<enumeratedValueSet variable="${n}"><value value="${x}" /></enumeratedValueSet>`;
const consts = `${v('model-version', '&quot;sheep-wolves-grass&quot;')} ${v('initial-number-sheep', 0)} ${v('initial-number-wolves', 0)} ${v('sheep-gain-from-food', 4)} ${v('wolf-gain-from-food', 20)} ${v('sheep-reproduce', 4)} ${v('wolf-reproduce', 5)} ${v('grass-regrowth-time', 30)} ${v('show-energy?', 'false')}`;

function netlogo(name, { reps = 1, ticks = 1, setup, go, metrics, every = false }) {
  const xml = `<?xml version="1.0" encoding="utf-8"?><experiments><experiment name="${name}" repetitions="${reps}" sequentialRunOrder="true" runMetricsEveryStep="${every}" timeLimit="${ticks}">
    <setup>${setup}</setup><go>${go}</go><metrics>${metrics.map(m => `<metric>${m}</metric>`).join('')}</metrics><constants>${consts}</constants></experiment></experiments>`;
  const f = join(dir, name + '.xml'), table = join(dir, name + '.csv');
  writeFileSync(f, xml);
  execFileSync(join(home, 'netlogo-headless.sh'), ['--model', model, '--setup-file', f, '--experiment', name, '--table', table, '--threads', '8'], { stdio: ['ignore', 'ignore', 'inherit'] });
  const lines = readFileSync(table, 'utf8').trim().split('\n');
  const hi = lines.findIndex(l => l.startsWith('"[run number]"'));
  const cols = csvLine(lines[hi]);
  return lines.slice(hi + 1).map(l => Object.fromEntries(cols.map((k, i) => [k, csvLine(l)[i]])));
}
function csvLine(l) { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => (x !== '' && !isNaN(+x)) ? +x : x); }
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2)));
const ks = (a, b) => { a = [...a].sort((x, y) => x - y); b = [...b].sort((x, y) => x - y); let i = 0, j = 0, d = 0; while (i < a.length && j < b.length) { const x = Math.min(a[i], b[j]); while (i < a.length && a[i] <= x) i++; while (j < b.length && b[j] <= x) j++; d = Math.max(d, Math.abs(i / a.length - j / b.length)); } const en = Math.sqrt(a.length * b.length / (a.length + b.length)), l = (en + 0.12 + 0.11 / en) * d; let p = 0; for (let k = 1; k <= 100; k++) p += 2 * (-1) ** (k - 1) * Math.exp(-2 * k * k * l * l); return { d, p: Math.max(0, Math.min(1, l > 0 ? p : 1)) }; };

// TS-side context for calling the example's procedures, the same shape defineModel builds (createAgentWorld + params/globals/breeds).
function testCtx(seed, paramOverrides = {}) {
  const w = createAgentWorld({ minPxcor: -25, maxPxcor: 25, minPycor: -25, maxPycor: 25, seed });
  w.turtlesOwn({ energy: 'f64' });
  w.patchesOwn({ countdown: 'f64' });
  const breeds = { sheep: w.breed('sheep'), wolves: w.breed('wolves') };
  const desc = _mdl.describe();
  const params = { ...resolveParams(desc, {}).params, ...paramOverrides };
  return Object.assign(Object.create(w), { params, globals: { 'max-sheep': 30000 }, breeds, linkBreeds: {}, world: null, data() { throw new Error('no data in the fixture test'); } });
}

const results = [];
const out = { growGrass: null, move: null, wolfTurn: null, netlogo: '7.0.4', when: new Date().toISOString() };

// ---- 1. grow-grass, exact
{
  const states = [[COLOR.brown, -1], [COLOR.brown, 0], [COLOR.brown, 1], [COLOR.brown, 5], [COLOR.green, 0], [COLOR.green, 3]];
  const setup = 'ca resize-world 0 5 0 0 ' + states.map(([c, n], k) => `ask patch ${k} 0 [ set pcolor ${c} set countdown ${n} ]`).join(' ') + ' reset-ticks';
  const nl = netlogo('grow', { setup, go: 'ask patches [ grow-grass ] tick', metrics: states.map((_, k) => `[ (word pcolor ":" countdown) ] of patch ${k} 0`) })[0];
  const want = states.map((_, k) => String(nl[`[ (word pcolor ":" countdown) ] of patch ${k} 0`]));
  const m = testCtx(1);
  const ts = states.map(([c, n], k) => {
    let out = null;
    m.ask(m.patches, q => { if (q.pxcor === k && q.pycor === 0) { q.pcolor = c; q.countdown = n; procs.growGrass(m, q); out = `${q.pcolor}:${q.countdown}`; } });
    return out;
  });
  const bad = ts.map((t, k) => [t, want[k], states[k]]).filter(([t, w]) => t !== w);
  out.growGrass = { want, got: ts };
  results.push({ test: 'grow-grass (exact, 6 fixture patches)', pass: bad.length === 0, detail: bad.length ? 'mismatch: ' + bad.map(([t, w, s]) => `from ${s.join('/')} TS ${t} NetLogo ${w}`).join('; ') : 'all 6 equal' });
}

// ---- 2. move, distribution of heading change over 5,000 calls
{
  const N = 5000;
  const rows = netlogo('move', { ticks: N, every: true, setup: 'ca random-seed 7 crt 1 [ set heading 0 setxy 0 0 ] reset-ticks', go: 'ask turtles [ move ] tick', metrics: ['[ heading ] of turtle 0'] });
  rows.sort((a, b) => a['[step]'] - b['[step]']);
  const dh = (a, b) => { let d = b - a; d = ((d + 540) % 360) - 180; return d; };
  const nlH = [];
  for (let k = 1; k < rows.length; k++) nlH.push(dh(rows[k - 1]['[ heading ] of turtle 0'], rows[k]['[ heading ] of turtle 0']));
  const m = testCtx(7); const sheep = m.breeds.sheep; const tsH = [];
  m.createTurtles(sheep, 1, t => { t.heading = 0; t.setxy(0, 0); for (let k = 0; k < N; k++) { const h0 = t.heading; procs.move(m, t); tsH.push(dh(h0, t.heading)); } });
  const k = ks(nlH, tsH), z = (mean(tsH) - mean(nlH)) / Math.sqrt(sd(nlH) ** 2 / nlH.length + sd(tsH) ** 2 / tsH.length);
  out.move = { nlH };
  results.push({ test: 'move (heading change per call, 5,000 calls)', pass: k.p > 0.01 && Math.abs(z) < 4, detail: `NetLogo mean ${mean(nlH).toFixed(2)}, TS mean ${mean(tsH).toFixed(2)}, z ${z.toFixed(2)}, KS p ${k.p.toFixed(3)}` });
}

// ---- 3. the wolves' turn from a fixture: one wolf and one sheep on patch 0 0; does the wolf eat it?
{
  const R = 2000;
  const rows = netlogo('wolfturn', { reps: R, setup: 'ca random-seed (500 + behaviorspace-run-number) ask patches [ set pcolor green ] create-sheep 1 [ setxy 0 0 set energy 10 ] create-wolves 1 [ setxy 0 0 set energy 10 ] reset-ticks', go: 'ask wolves [ move set energy energy - 1 eat-sheep death reproduce-wolves ] tick', metrics: ['count sheep'] });
  const nlEaten = rows.filter(r => r['[step]'] === 1 && r['count sheep'] === 0).length;
  let tsEatenN = 0;
  for (let r = 0; r < R; r++) {
    const m = testCtx(500 + r);
    m.ask(m.patches, (q) => { q.pcolor = COLOR.green; });
    m.createTurtles(m.breeds.sheep, 1, t => { t.setxy(0, 0); t.energy = 10; });
    m.createTurtles(m.breeds.wolves, 1, t => { t.setxy(0, 0); t.energy = 10; });
    m.ask(m.breeds.wolves, t => {
      procs.move(m, t); t.energy = t.energy - 1; procs.eatSheep(m, t); procs.death(t); procs.reproduce(m, t, +m.params['wolf-reproduce']);
    });
    if (m.countOf(m.breeds.sheep) === 0) tsEatenN++;
  }
  const nlShare = nlEaten / R, tsShare = tsEatenN / R;
  const se = Math.sqrt((nlShare * (1 - nlShare) + tsShare * (1 - tsShare)) / R) || 1e-9, z = (tsShare - nlShare) / se;
  out.wolfTurn = { R, nlEaten };
  results.push({ test: "wolves' turn from a fixture (2,000 repeats)", pass: Math.abs(z) < 4, detail: `sheep eaten: NetLogo ${(100 * nlShare).toFixed(1)}%, TS ${(100 * tsShare).toFixed(1)}%, z ${Number.isFinite(z) ? z.toFixed(2) : z}` });
}

if (record) {
  writeFileSync(new URL('../test/fixtures/procedures-7.0.4.json', import.meta.url), JSON.stringify(out, null, 1));
  console.log('wrote test/fixtures/procedures-7.0.4.json');
} else {
  console.log('procedure tests (live vs NetLogo ' + '7.0.4' + '):');
  for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.test}: ${r.detail}`);
  process.exit(results.every(r => r.pass) ? 0 : 1);
}
