// Rewritten for this project, shaped on run-ts.ts from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
// Runs a converted model (defineModel from library/index.ts) for N seeds and T ticks, and writes a CSV the NetLogo side matches:
// header 'run,tick,<series...>', one row per run and tick. Series y-names are sanitised to [A-Za-z0-9_] ('grass / 4' -> 'grass4'),
// matching compare.py's pens. The 'monitor:*' series are the same values as the population pens, so they are skipped by default;
// override with --series 'populations,monitor:sheep' or --series all.
//   node parity/run-ts.ts --model examples/wolf-sheep.ts --runs 50 --ticks 500 --out results/ts.csv [--seed-base 1001] [--seed-param name]
//   --seed-param sets the named numeric param to seedBase + r for each run r (models whose randomness flows
//   through declared params rather than the run seed, e.g. the NetLogo ports' own PRNG streams).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveParams } from '../library/index.ts';
import type { Description } from '../library/index.ts';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const runs = +arg('runs', '50'), ticks = +arg('ticks', '500'), seedBase = +arg('seed-base', '1001'), out = arg('out', 'results/ts.csv'), seedParam = arg('seed-param', '');

const model = (await import(pathToFileURL(resolve(arg('model', 'examples/wolf-sheep.ts'))).href)).default as unknown as {
  describe(): Description;
  start(input: { params: Record<string, number | boolean | string | number[]>; scenario: never[]; world: null; data: Record<string, never>; seed: number }): { frame: { series: Record<string, number[]> }; step(): { series: Record<string, number[]> }; readonly done: boolean };
};
const desc = model.describe();

const picked = arg('series', '') === '' ? Object.keys(desc.series).filter(k => !k.startsWith('monitor:'))
  : arg('series', '') === 'all' ? Object.keys(desc.series)
  : arg('series', '').split(',').map(s => s.trim());
const columns = picked.flatMap(k => desc.series[k].y.map(y => [k, y] as [string, string]));
const used = new Set<string>();
const col = ([k, y]: [string, string]) => { const base = y.replace(/[^A-Za-z0-9_]/g, ''); let n = base; while (used.has(n)) n = base + '_' + k.replace(/[^A-Za-z0-9_]/g, ''); used.add(n); return n; };

const resolved = resolveParams(desc, {});
if (!resolved.ok) { console.error('model defaults do not resolve:', resolved.errors); process.exit(2); }
const baseParams = resolved.params;

const rows = ['run,tick,' + columns.map(col).join(',')];
for (let r = 0; r < runs; r++) {
  const params = seedParam ? { ...baseParams, [seedParam]: seedBase + r } : baseParams;
  const run = model.start({ params, scenario: [], world: null, data: {}, seed: seedBase + r });
  const emit = (t: number) => { const s = run.frame.series; rows.push([String(r), String(t), ...columns.map(([k, y]) => String(s[k][desc.series[k].y.indexOf(y)]))].join(',')); };
  emit(0);
  for (let t = 1; t <= ticks && !run.done; t++) { run.step(); emit(t); }
}
writeFileSync(out, rows.join('\n') + '\n');
console.log(`wrote ${out} (${rows.length - 1} rows)`);
