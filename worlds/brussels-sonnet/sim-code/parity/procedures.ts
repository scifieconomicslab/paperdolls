// Procedure gates: every pure reporter of the NetLogo model is evaluated in NetLogo (as BehaviorSpace metrics, after `setup`) and in TypeScript
// with the same arguments; the two must agree to 1e-12 relative. The stateful procedures (setup draws, pay-part, cash-phase, go phases, votes,
// queue) are gated by matrix.mjs, which compares every pen at every tick in 13 parameter configurations.
//   NETLOGO_HOME=... node procedures.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { procs } from '../model.ts';
const { hashUniform, mix32, monthlyRate, annuityPv, npvRetrofit, loanPayment, planFinancing, rebateAmount } = procs;
const here = dirname(fileURLToPath(import.meta.url)); const repo = join(here, '../../../..');
const T: [string, () => number][] = [
  ['hash-uniform 7 3 5', () => hashUniform(7, 3, 5)], ['hash-uniform 123456 99 1073741825', () => hashUniform(123456, 99, 1073741825)], ['hash-uniform 0 0 0', () => hashUniform(0, 0, 0)],
  ['hash-uniform 999 2000000 400', () => hashUniform(999, 2000000, 400)], ['hash-uniform 4294967295 4294967295 4294967295', () => hashUniform(4294967295, 4294967295, 4294967295)],
  ['mix32 12345', () => mix32(12345)], ['mix32 4294967295', () => mix32(4294967295)], ['imul 4000000000 3000000000', () => Math.imul(4000000000, 3000000000) >>> 0],
  ['monthly-rate 0.04', () => monthlyRate(0.04)], ['monthly-rate 0', () => monthlyRate(0)],
  ['annuity-pv 100 0.003 120 0.002', () => annuityPv(100, 0.003, 120, 0.002)], ['annuity-pv 100 0.003 0 0', () => annuityPv(100, 0.003, 0, 0)], ['annuity-pv 100 0.003 60 0.003', () => annuityPv(100, 0.003, 60, 0.003)],
  ['npv-retrofit 50 100 0.003 0.002 1000 20 120 500 12', () => npvRetrofit(50, 100, 0.003, 0.002, 1000, 20, 120, 500, 12)], ['npv-retrofit 50 100 0.003 0.002 1000 20 120 0 0', () => npvRetrofit(50, 100, 0.003, 0.002, 1000, 20, 120, 0, 0)],
  ['loan-payment 10000 0.04 120', () => loanPayment(10000, 0.04, 120)], ['loan-payment 5000 0 60', () => loanPayment(5000, 0, 60)], ['loan-payment 0 0.04 60', () => loanPayment(0, 0.04, 60)],
  ['rebate-amount 3000 0.3 800 false', () => rebateAmount(3000, 0.3, 800, false)], ['rebate-amount 3000 0.3 800 true', () => rebateAmount(3000, 0.3, 800, true)], ['rebate-amount 100 0.3 800 false', () => rebateAmount(100, 0.3, 800, false)],
  ['item 0 plan-financing 5000 3000 1500 1', () => planFinancing(5000, 3000, 1500, 1)[0]], ['item 1 plan-financing 5000 3000 1500 1', () => planFinancing(5000, 3000, 1500, 1)[1]],
  ['ifelse-value (item 2 plan-financing 5000 3000 1500 0.5) [1] [0]', () => (planFinancing(5000, 3000, 1500, 0.5)[2] ? 1 : 0)], ['ifelse-value (item 2 plan-financing 5000 3000 3600 0.5) [1] [0]', () => (planFinancing(5000, 3000, 3600, 0.5)[2] ? 1 : 0)],
];
const dir = mkdtempSync(join(tmpdir(), 'pp-')); const out = join(dir, 'nl.csv');
execFileSync('node', [join(repo, 'tools/agents/parity/run-netlogo.mjs'), '--model', join(repo, 'netlogomodels/great-retrofit-v3.nlogox'), '--runs', '1', '--ticks', '1', '--out', out,
  '--metrics', T.map(t => t[0]).join(','), '--pens', T.map((_, i) => 'p' + i).join(','), '--constants', '', '--setup', 'set n-buildings 10 setup', '--threads', '1'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, NETLOGO_HOME: join(repo, 'tools/NetLogo') } });
const row = readFileSync(out, 'utf8').trim().split('\n')[1].split(',').slice(2).map(Number);
let bad = 0; T.forEach(([expr, f], i) => { const a = row[i], b = f(); const rel = Math.abs(a - b) / Math.max(1e-300, Math.abs(a), Math.abs(b)); const ok = a === b || rel < 1e-12; if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${expr.padEnd(66)} netlogo ${a}  ts ${b}`); });
console.log(bad ? `${bad} procedure gate(s) FAILED` : `all ${T.length} procedure gates PASS`); process.exit(bad ? 1 : 0);
