// Ten-pass determinism, both sides: the same three seeds are run ten times in TypeScript and ten times in NetLogo (separate processes);
// every pass must produce a byte-identical CSV (sha256 equal to pass 1).
//   NETLOGO_HOME=... node determinism.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const repo = join(here, '../../../..');
const MET = 'item 0 adoption-by-quintile,item 4 adoption-by-quintile,public-cost,bills-saved,votes-passed,n-complete,state-partial,state-retrofitted'; const PENS = 'Q1,Q5,publiccost,billssaved,votespassed,adoptedunits,stpartial,stdone';
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const dir = mkdtempSync(join(tmpdir(), 'det-')); const ts = [], nl = [];
for (let i = 0; i < 10; i++) {
  const t = join(dir, `ts${i}.csv`); execFileSync('node', [join(here, 'run-ts.ts'), '--runs', '3', '--ticks', '360', '--seed-base', '0', '--nb', '200', '--out', t], { stdio: 'ignore' }); ts.push(sha(t));
  const n = join(dir, `nl${i}.csv`);
  execFileSync('node', [join(repo, 'tools/agents/parity/run-netlogo.mjs'), '--model', join(repo, 'netlogomodels/great-retrofit-v3.nlogox'), '--runs', '3', '--ticks', '360', '--out', n, '--metrics', MET, '--pens', PENS, '--constants', '', '--setup', 'set seed behaviorspace-run-number - 1 set n-buildings 200 set horizon-months 360 setup', '--threads', '3'], { stdio: 'ignore', env: { ...process.env, NETLOGO_HOME: join(repo, 'tools/NetLogo') } }); nl.push(sha(n));
}
const same = (a) => a.every(x => x === a[0]);
console.log(`TypeScript: ${same(ts) ? 'PASS' : 'FAIL'} - 10 passes, ${new Set(ts).size} distinct hash(es) ${ts[0].slice(0, 16)}`);
console.log(`NetLogo:    ${same(nl) ? 'PASS' : 'FAIL'} - 10 passes, ${new Set(nl).size} distinct hash(es) ${nl[0].slice(0, 16)}`);
process.exit(same(ts) && same(nl) ? 0 : 1);
