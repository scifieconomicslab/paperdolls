// Scenario matrix: NetLogo vs TypeScript, same seeds, same parameter overrides, every code path of `go`. The model is deterministic given its seeds
// (all randomness is its own mulberry32 / hash_uniform), so the gate is exact: every pen at every tick must agree to 1e-12 relative.
//   NETLOGO_HOME=... node matrix.mjs [--runs 2] [--nb 200] [--ticks 360]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)); const repo = join(here, '../../../..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const runs = +arg('runs', '2'), nb = +arg('nb', '200'), ticks = +arg('ticks', '360');
const MET = 'item 0 adoption-by-quintile,item 1 adoption-by-quintile,item 2 adoption-by-quintile,item 3 adoption-by-quintile,item 4 adoption-by-quintile,public-cost,bills-saved,votes-passed,units-cannot-front,n-complete,state-not-retrofitted,state-partial,state-retrofitted,state-not-modelled,shared-pending,shared-approved';
const PENS = 'Q1,Q2,Q3,Q4,Q5,publiccost,billssaved,votespassed,unitscannotfront,adoptedunits,stnot,stpartial,stdone,stnotmodelled,pending,approved';
const CONFIGS = {
  baseline: {}, passthrough: { 'delivery-mode': 'passthrough' }, public_service: { 'delivery-mode': 'public_service' },
  public_means: { 'delivery-mode': 'public_service', 'means-test?': true, 'means-test-max-quintile': 3 },
  rebate_refundable_means: { 'refundable?': true, 'means-test?': true },
  credit_none: { 'credit-access': 'none' }, credit_open: { 'credit-access': 'open' },
  energy_flat: { 'energy-scenario': 'flat' }, energy_shock: { 'energy-scenario': 'shock', 'rebate-lag-months': 0 },
  no_shared: { 'shared-measure?': false }, no_peer_low_vote: { 'peer-effect?': false, 'vote-threshold': 0.5, 'canvass-boost': 0.5 },
  rich_savings: { 'savings-usable-share': 0.5, 'savings-scale': 2.0, 'deduction-rate': 0.8, 'consider-prob-base': 0.2 },
  small_seeded: { 'scene-seed': 7, 'n-buildings': 50, 'rental-share-multi': 0.1, 'public-capacity': 0.2, 'delivery-mode': 'public_service' },
};
const nlVal = (v) => (typeof v === 'string' ? `&quot;${v}&quot;` : String(v));
let failed = 0;
for (const [name, ov] of Object.entries(CONFIGS)) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-'));
  const p = { 'n-buildings': nb, 'scene-seed': 0, ...ov };
  const setup = ['set seed behaviorspace-run-number - 1', `set horizon-months ${ticks}`, ...Object.entries(p).map(([k, v]) => `set ${k} ${nlVal(v)}`), 'setup'].join('\n');
  const nl = join(dir, 'nl.csv'), ts = join(dir, 'ts.csv');
  execFileSync('node', [join(repo, 'tools/agents/parity/run-netlogo.mjs'), '--model', join(repo, 'netlogomodels/great-retrofit-v3.nlogox'), '--runs', String(runs), '--ticks', String(ticks), '--out', nl, '--metrics', MET, '--pens', PENS, '--constants', '', '--setup', setup, '--threads', '4'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, NETLOGO_HOME: join(repo, 'tools/NetLogo') } });
  execFileSync('node', [join(here, 'run-ts.ts'), '--runs', String(runs), '--ticks', String(ticks), '--seed-base', '0', '--nb', String(p['n-buildings']), '--scene-seed', String(p['scene-seed']), '--params', JSON.stringify(ov), '--out', ts], { stdio: ['ignore', 'ignore', 'inherit'] });
  let out = ''; try { out = execFileSync('node', [join(here, 'exact.mjs'), nl, ts], { encoding: 'utf8' }); } catch (e) { out = e.stdout; failed++; }
  const final = readFileSync(nl, 'utf8').trim().split('\n').pop().split(',');
  console.log(`${name.padEnd(24)} ${out.trim().split('\n')[0]}   [final tick: adopted units ${final[11]}, votes ${final[9]}, public cost ${Math.round(+final[7])}]`);
}
console.log(failed ? `${failed} configuration(s) DIFFER` : 'ALL configurations agree');
process.exit(failed ? 1 : 0);
