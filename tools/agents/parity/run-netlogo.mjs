// Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0), parameterized (--model/--setup/--go/--metrics/--pens).
// Runs a model in desktop NetLogo 7.0.4, headless, through BehaviorSpace, and writes a CSV common to both sides (run-ts.ts reads the same shape).
//   NETLOGO_HOME=... node parity/run-netlogo.mjs --runs 50 --ticks 500 --out results/netlogo.csv [--size 25]
// Defaults run the Wolf Sheep Predation sample model. For a converted model, point --model at its .nlogox, --setup/*--go at its setup/go, and
// --metrics at the plot pens you want in the CSV (comma separated, in column order). See parity/METHOD.md and parity/run-ts.ts.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const runs = +arg('runs', '50'), ticks = +arg('ticks', '500'), size = +arg('size', '25'), out = arg('out', 'results/netlogo.csv'), initScale = +arg('init-scale', '1'), threads = arg('threads', '8');
// --constants: raw XML constants fragment replacing the Wolf Sheep defaults (for converted models).
//   The setup expression can also set slider-globals per run, e.g. `set seed behaviorspace-run-number - 1`.
const constantsArg = process.argv.includes('--constants') ? arg('constants', '') : null; // explicit --constants (even empty) replaces the defaults
const home = process.env.NETLOGO_HOME || new URL('../../../tools/NetLogo/', import.meta.url).pathname;
const model = arg('model', join(home, 'models/Sample Models/Biology/Wolf Sheep Predation.nlogox'));
const setup = arg('setup', `resize-world ${-size} ${size} ${-size} ${size}\nrandom-seed (1000 + behaviorspace-run-number)\nset initial-number-sheep ${Math.round(100 * initScale)} set initial-number-wolves ${Math.round(50 * initScale)}\nsetup`);
const go = arg('go', 'go');
const metrics = arg('metrics', 'count sheep,count wolves,count grass / 4').split(',').map(s => s.trim());
const pens = arg('pens', 'sheep,wolves,grass4').split(',').map(s => s.trim());
if (pens.length !== metrics.length) { console.error(`--pens (${pens.length}) and --metrics (${metrics.length}) must have the same number of items, in the same order`); process.exit(2); }
const name = arg('name', 'ensemble');
const dir = mkdtempSync(join(tmpdir(), 'nl-'));
const v = (name, value) => `<enumeratedValueSet variable="${name}"><value value="${value}" /></enumeratedValueSet>`;
const xml = `<?xml version="1.0" encoding="utf-8"?>
<experiments>
  <experiment name="${name}" repetitions="${runs}" sequentialRunOrder="true" runMetricsEveryStep="true" timeLimit="${ticks}">
    <setup>${setup}</setup>
    <go>${go}</go>
    <metrics>${metrics.map(m => `<metric>${m}</metric>`).join('')}</metrics>
    <constants>
      ${constantsArg !== null ? constantsArg : `${v('model-version', '&quot;sheep-wolves-grass&quot;')}
      ${v('sheep-gain-from-food', 4)} ${v('wolf-gain-from-food', 20)}
      ${v('sheep-reproduce', 4)} ${v('wolf-reproduce', 5)} ${v('grass-regrowth-time', 30)} ${v('show-energy?', 'false')}`}
    </constants>
  </experiment>
</experiments>`;
writeFileSync(join(dir, 'exp.xml'), xml);
const table = join(dir, 'table.csv');
const t0 = Date.now();
execFileSync(join(home, 'netlogo-headless.sh'), ['--model', model, '--setup-file', join(dir, 'exp.xml'), '--experiment', name, '--table', table, '--threads', threads], { stdio: ['ignore', 'ignore', 'inherit'] });
const secs = (Date.now() - t0) / 1000;
// The table: 6 header lines, then a column header, then one row per run and step.
const lines = readFileSync(table, 'utf8').trim().split('\n');
const hi = lines.findIndex(l => l.startsWith('"[run number]"'));
const cols = JSON.parse('[' + lines[hi] + ']');
const ix = n => cols.indexOf(n);
const rows = ['run,tick,' + pens.join(',')];
for (const l of lines.slice(hi + 1)) {
  const c = JSON.parse('[' + l + ']');
  rows.push([c[ix('[run number]')], c[ix('[step]')], ...metrics.map(m => c[ix(m)])].join(','));
}
// BehaviorSpace writes completed runs in scheduler order, which is not stable
// between invocations. Sort by (run, tick) so the CSV is comparable byte-for-byte.
const body = rows.slice(1).sort((a, b) => {
  const [ar, at] = a.split(','), [br, bt] = b.split(',');
  return Number(ar) - Number(br) || Number(at) - Number(bt);
});
writeFileSync(out, [rows[0], ...body].join('\n') + '\n');
console.log(`wrote ${out} (${rows.length - 1} rows) in ${secs.toFixed(1)} s`);
