// Parity runner for brussels-inkling: N seeds × T ticks of the converted model into the CSV shape
// run-netlogo.mjs writes, for parity comparison per tools/agents/parity/METHOD.md.
// Lives in the world's sim-code/ because tools/ is read-only for this run.
//   node parity-run-ts.mjs --model model.ts --runs 200 --ticks 360 --seed-base 0 \
//     --params '{"n-buildings":200,"horizon-months":360}' --out results/ts.csv
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveParams } from '../../../tools/agents/library/index.ts';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const runs = +arg('runs', '200'), ticks = +arg('ticks', '360'), seedBase = +arg('seed-base', '0'), out = arg('out', 'ts.csv');
const overrides = JSON.parse(arg('params', '{}'));

const model = (await import(pathToFileURL(resolve(arg('model', 'model.ts'))).href)).default;
const desc = model.describe();
const resolved = resolveParams(desc, { ...overrides });
if (!resolved.ok) { console.error('params do not resolve:', resolved.errors); process.exit(2); }
const baseParams = resolved.params;

// pens emitted, in order; each maps to a series and one of its y entries
const PENS = [
  ['adoptionQ1', 'adoption', 0], ['adoptionQ2', 'adoption', 1], ['adoptionQ3', 'adoption', 2], ['adoptionQ4', 'adoption', 3], ['adoptionQ5', 'adoption', 4],
  ['publiccost', 'state', 0], ['billssaved', 'bills', 0], ['votespassed', 'monitor:votesPassed', 0],
];

const rows = ['run,tick,' + PENS.map(([p]) => p).join(',')];
for (let r = 0; r < runs; r++) {
  const params = { ...baseParams, seed: seedBase + r };
  const run = model.start({ params, scenario: [], world: null, data: {}, seed: seedBase + r });
  const emit = (t) => {
    const s = run.frame.series;
    rows.push([String(r), String(t), ...PENS.map(([, ser, i]) => { const v = s[ser]?.[i]; return Number.isFinite(v) ? String(v) : 'NaN'; })].join(','));
  };
  emit(0);
  for (let t = 1; t <= ticks && !run.done; t++) { run.step(); emit(t); }
}
writeFileSync(out, rows.join('\n') + '\n');
console.log(`wrote ${out} (${rows.length - 1} rows)`);
