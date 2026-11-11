// Ten-pass NetLogo determinism check (README.md Gate 6). The same ten
// BehaviorSpace runs, twice, must produce byte-identical CSVs.
//   node scripts/determinism-netlogo.mjs [--out-dir worlds/<name>/sim-code/parity/results]
//        [--model … --setup … --go … --metrics … --pens … --constants …]   (passed through to parity/run-netlogo.mjs)
// The TS half is scripts/determinism-runs.mjs. NetLogo must be vendored at
// tools/NetLogo or NETLOGO_HOME must point at it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const runs = arg('runs', '10');
const ticks = arg('ticks', '200');
const runner = fileURLToPath(new URL('../parity/run-netlogo.mjs', import.meta.url));
const outDir = resolve(arg('out-dir', fileURLToPath(new URL('../parity/results/', import.meta.url))));
const PASS = ['model', 'setup', 'go', 'metrics', 'pens', 'constants', 'name', 'threads'];
const passThrough = PASS.flatMap((k) => (process.argv.includes('--' + k) ? ['--' + k, arg(k, '')] : []));
mkdirSync(outDir, { recursive: true });
const a = resolve(outDir, 'determinism-netlogo-a.csv');
const b = resolve(outDir, 'determinism-netlogo-b.csv');

for (const out of [a, b]) {
  execFileSync(process.execPath, [runner, '--runs', runs, '--ticks', ticks, '--out', out, ...passThrough], { stdio: 'inherit' });
}
const bufA = readFileSync(a), bufB = readFileSync(b);
const hA = createHash('sha256').update(bufA).digest('hex');
const hB = createHash('sha256').update(bufB).digest('hex');
const identical = hA === hB;
const result = { when: new Date().toISOString(), runs: Number(runs), ticks: Number(ticks), hashA: hA, hashB: hB, identical };
const out = resolve(outDir, `determinism-netlogo-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`NetLogo ${runs} runs x ${ticks} ticks: ${hA.slice(0, 16)} vs ${hB.slice(0, 16)} ${identical ? 'identical' : 'DIFFERS'}`);
console.log('wrote ' + out);
process.exit(identical ? 0 : 1);
