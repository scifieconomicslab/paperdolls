// Ten-pass determinism check for the world's TypeScript model (Gate 6).
// Run twice per seed with the same parameters and compare a hash of the whole series stream.
//   node sim-code/parity/determinism-ts.mjs [--ticks 360] [--seed-base 1]
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveParams } from '../../../../tools/agents/library/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const TICKS = +arg('ticks', '360');
const BASE = +arg('seed-base', '1');
const model = (await import(resolve(HERE, '../model.ts'))).default;
const base = resolveParams(model.describe(), {});
if (!base.ok) { console.error(base.errors); process.exit(2); }

function runAll(seed) {
  const params = { ...base.params, seed };
  const run = model.start({ params, scenario: [], world: null, data: {}, seed });
  const out = [run.frame.series];
  for (let t = 0; t < TICKS && !run.done; t++) { run.step(); out.push(run.frame.series); }
  return out;
}

const rows = [];
for (let i = 0; i < 10; i++) {
  const seed = BASE + i;
  const h1 = createHash('sha256').update(JSON.stringify(runAll(seed))).digest('hex');
  const h2 = createHash('sha256').update(JSON.stringify(runAll(seed))).digest('hex');
  rows.push({ seed, h1: h1.slice(0, 16), h2: h2.slice(0, 16), identical: h1 === h2 });
  console.log(`seed ${seed}: ${h1.slice(0, 16)} vs ${h2.slice(0, 16)} ${h1 === h2 ? 'identical' : 'DIFFERS'}`);
}
const ok = rows.every((r) => r.identical);
mkdirSync(resolve(HERE, 'results'), { recursive: true });
writeFileSync(resolve(HERE, 'results/determinism-ts.json'), JSON.stringify({ when: new Date().toISOString(), ticks: TICKS, rows, ok }, null, 1));
console.log(ok ? 'PASS: ten passes identical' : 'FAIL: ten passes differ');
process.exit(ok ? 0 : 1);
