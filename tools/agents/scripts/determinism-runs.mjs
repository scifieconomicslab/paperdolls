// Ten-pass determinism check (README.md Gate 6): the TypeScript model, run with the same
// ten seeds as the NetLogo acceptance run, produces identical trajectories every time.
//   node scripts/determinism-runs.mjs [--model worlds/<name>/sim-code/model.ts] [--out-dir worlds/<name>/sim-code/parity/results]
// Writes <out-dir>/determinism-<date>.json (default tools/agents/parity/results, gitignored); prints a table. Compare with
// `python3 parity/compare.py parity/results/netlogo.csv parity/results/ts.csv --pens sheep,wolves,grass4`.
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
import { resolveParams } from '../library/index.ts';
const modelPath = arg('model', fileURLToPath(new URL('../examples/wolf-sheep.ts', import.meta.url)));
const seedParam = arg('seed-param', '');
const SEEDS = [+arg('seed-base', '1001'), ...Array.from({ length: 9 }, (_, i) => +arg('seed-base', '1001') + i + 1)];
const TICKS = +arg('ticks', '200');
const model = (await import(pathToFileURL(resolve(modelPath)).href)).default;
const baseParams = resolveParams(model.describe(), {}).params;
const baseSeed = +arg('seed-base', '1001');
const paramsFor = seed => seedParam ? { ...baseParams, [seedParam]: seed } : baseParams;
const params = baseParams;

function runAll(seed) {
  const run = model.start({ params: paramsFor(seed), scenario: [], world: null, data: {}, seed });
  const out = [];
  out.push(run.frame.series);
  for (let t = 0; t < TICKS && !run.done; t++) { run.step(); out.push(run.frame.series); }
  return out;
}

const rows = [];
for (const seed of SEEDS) {
  const h1 = createHash('sha256').update(JSON.stringify(runAll(seed))).digest('hex').slice(0, 16);
  const h2 = createHash('sha256').update(JSON.stringify(runAll(seed))).digest('hex').slice(0, 16);
  rows.push({ seed, hashA: h1, hashB: h2, identical: h1 === h2 });
  console.log(`seed ${seed}: ${h1} vs ${h2} ${h1 === h2 ? 'identical' : 'DIFFERS'}`);
}
const ok = rows.every(r => r.identical);

// Cross-seed spread (sanity that the seeds actually discriminate): sheep count at tick 200
const last = SEEDS.map(s => runAll(s).at(-1));
console.log('\nfinal series per seed:');
last.forEach((p, i) => console.log(`  ${SEEDS[i]}: ${JSON.stringify(p)}`));

const outDir = resolve(arg('out-dir', fileURLToPath(new URL('../parity/results/', import.meta.url))));
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `determinism-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), model: modelPath, ticks: TICKS, rows, ok }, null, 1));
console.log('\nwrote ' + out);
process.exit(ok ? 0 : 1);
