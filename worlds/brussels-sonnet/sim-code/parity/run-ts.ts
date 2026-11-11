// Runs the converted model for N seeds (the model's own `seed` param = seed-base + run), synthetic building table, and writes the CSV the NetLogo
// side writes (run,tick,<pens>). Like tools/agents/parity/run-ts.ts, but sets params (n-buildings, scene-seed, horizon) and uses this world's pens.
//   node run-ts.ts --runs 3 --ticks 360 --seed-base 0 --nb 200 --out ts.csv
import { writeFileSync } from 'node:fs';
import model from '../model.ts';
const arg = (k: string, d: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const runs = +arg('runs', '3'), ticks = +arg('ticks', '360'), seedBase = +arg('seed-base', '0'), nb = +arg('nb', '200'), sceneSeed = +arg('scene-seed', '0'), out = arg('out', 'ts.csv');
const extra = JSON.parse(arg('params', '{}'));
// pens, in the NetLogo metric order (see parity.md): [series, y-name, csv column]
const COLS: [string, string, string][] = [
  ...[0, 1, 2, 3, 4].map(k => ['Adoption by quintile', `Q${k + 1}`, `Q${k + 1}`] as [string, string, string]),
  ['State spend (cumulative)', 'public cost', 'publiccost'], ['Bills saved (cumulative)', 'bills saved', 'billssaved'],
  ['shared measures', 'votes passed', 'votespassed'], ['shared measures', 'units cannot front', 'unitscannotfront'], ['shared measures', 'adopted units', 'adoptedunits'],
  ['building states', 'no retrofit', 'stnot'], ['building states', 'partial', 'stpartial'], ['building states', 'done', 'stdone'], ['building states', 'rental (not modelled)', 'stnotmodelled'],
  ['shared measures', 'pending', 'pending'], ['shared measures', 'approved', 'approved'],
];
const desc = model.describe(); const rows = ['run,tick,' + COLS.map(c => c[2]).join(',')];
for (let r = 0; r < runs; r++) {
  const run = model.start({ params: { 'n-buildings': nb, 'scene-seed': sceneSeed, 'horizon-months': ticks, seed: seedBase + r, ...extra }, scenario: [], world: null, data: {}, seed: seedBase + r });
  const emit = (t: number) => rows.push([String(r + 1), String(t), ...COLS.map(([k, y]) => String(run.frame.series[k][desc.series[k].y.indexOf(y)]))].join(','));
  emit(0); for (let t = 1; t <= ticks && !run.done; t++) { run.step(); emit(t); }
}
writeFileSync(out, rows.join('\n') + '\n'); console.log(`wrote ${out}`);
