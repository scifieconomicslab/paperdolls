// The Great Retrofit v3 (NetLogo port, netlogomodels/great-retrofit-v3.nlogox) as a defineModel. EVERY NUMBER IN THE SOURCE MODEL IS A PLACEHOLDER.
// Converted procedure by procedure; the NetLogo source is in the comment above each. Procedure names are kept (camelCased).
//
// Two ways to get the building table:
//   * synthetic (input.world === null): build-scene exactly as NetLogo does it (lognormal footprints, random storeys, seeded). This is the mode the
//     parity gate runs, because NetLogo only has this table.
//   * map (input.world has a `buildings` layer): the real residential buildings of Jette replace the *footprint and storeys* draws of build-scene;
//     everything after that (units per building, tenure draw, split of areas, population, decisions) is the same code. Storeys are ASSUMED (the
//     map has almost no height tags); tenure is the model's seeded draw, not real tenure.
import { defineModel, type Ctx, type AnyAgent, type ParamSpec } from '../../../tools/agents/library/index.ts';

// ---------------------------------------------------------------- PRNG: mulberry32 + hash_uniform (byte-compatible with v3/common/rng.py)
const U32 = 4294967296;
// to-report hash-uniform [s i j]: h = mix32 (xor32 (s mod 2^32) (imul (i mod 2^32) 2654435761));  h = mix32 (xor32 h (imul (j mod 2^32) 2246822507));  report h / 2^32
function mix32(h0: number): number { let h = h0 >>> 0; h = (h ^ (h >>> 16)) >>> 0; h = Math.imul(h, 0x85ebca6b) >>> 0; h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 0xc2b2ae35) >>> 0; return (h ^ (h >>> 16)) >>> 0; }
export function hashUniform(s: number, i: number, j: number): number {
  // NetLogo `mod` on non-negative values; `>>> 0` is the same reduction mod 2^32 for any non-negative double below 2^53
  let h = mix32(((s % U32) ^ Math.imul(i % U32, 2654435761)) >>> 0);
  h = mix32((h ^ Math.imul(j % U32, 2246822507)) >>> 0);
  return h / U32;
}
class Rng {
  state = 0;
  nextU32(): number { // to-report rng-next-u32
    this.state = (this.state + 1831565813) % U32; let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0; t = (t ^ ((t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0)) >>> 0; return (t ^ (t >>> 14)) >>> 0;
  }
  random(): number { return this.nextU32() / U32; }                         // rng-random
  randint(n: number): number { return Math.trunc(this.random() * n); }       // rng-randint: int (rng-random * n)
  gaussian(): number { const u1 = 1.0 - this.random(), u2 = this.random(); return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos((360.0 * u2 * Math.PI) / 180); } // NetLogo cos takes degrees
  lognormal(mu: number, sigma: number): number { return Math.exp(mu + sigma * this.gaussian()); }
  uniform(lo: number, hi: number): number { return lo + (hi - lo) * this.random(); }
}

// ---------------------------------------------------------------- pure economics
const monthlyRate = (annual: number) => Math.pow(1.0 + annual, 1.0 / 12.0) - 1.0;                    // to-report monthly-rate
function annuityPv(first: number, rate: number, n: number, growth: number): number {                  // to-report annuity-pv
  if (n <= 0 || first === 0.0) return 0.0;
  const q = (1.0 + growth) / (1.0 + rate);
  if (Math.abs(q - 1.0) < 1e-12) return (first / (1.0 + rate)) * n;
  return (first / (1.0 + rate)) * (1.0 - Math.pow(q, n)) / (1.0 - q);
}
function npvRetrofit(monthlySaving: number, n: number, mDisc: number, mGr: number, cash: number, loanPay: number, loanMonths: number, rebate: number, lag: number): number { // to-report npv-retrofit
  const pvSav = annuityPv(monthlySaving, mDisc, n, mGr);
  let pvReb = 0.0; if (rebate > 0.0) pvReb = rebate / Math.pow(1.0 + mDisc, lag);
  const pvLoan = annuityPv(loanPay, mDisc, loanMonths, 0.0);
  return pvSav + pvReb - cash - pvLoan;
}
function loanPayment(principal: number, annualRate: number, months: number): number {                  // to-report loan-payment
  if (principal <= 0 || months <= 0) return 0.0;
  const r = monthlyRate(annualRate); if (r === 0.0) return principal / months;
  return (principal * r) / (1.0 - Math.pow(1.0 + r, -months));
}
function planFinancing(upfront: number, liquid: number, limit: number, usableShare: number): [number, number, boolean] { // to-report plan-financing
  const usable = Math.max(0.0, liquid) * usableShare; const fromSav = Math.min(usable, upfront); const loan = upfront - fromSav;
  return [fromSav, loan, loan <= limit + 1e-9];
}
function rebateAmount(cost: number, rate: number, taxCap: number, refund: boolean): number {          // to-report rebate-amount
  const gross = Math.max(0.0, rate * cost); if (refund) return Math.min(gross, cost);
  return Math.min(Math.min(gross, Math.max(0.0, taxCap)), cost);
}

// ---------------------------------------------------------------- parameters (the model's 40 widgets; defaults are the NetLogo defaults except the user's two changes)
const num = (min: number, max: number, def: number, step: number, tier: 'lever' | 'assumption' | 'structural', group: string, unit?: string): ParamSpec => ({ type: 'number', min, max, default: def, step, tier, group, ...(unit ? { unit } : {}) });
const int = (min: number, max: number, def: number, step: number, tier: 'lever' | 'assumption' | 'structural', group: string, unit?: string): ParamSpec => ({ type: 'integer', min, max, default: def, step, tier, group, ...(unit ? { unit } : {}) });
const bool = (def: boolean, tier: 'lever' | 'assumption' | 'structural', group: string): ParamSpec => ({ type: 'boolean', default: def, tier, group });
const choice = (vals: string[], def: string, tier: 'lever' | 'assumption' | 'structural', group: string): ParamSpec => ({ type: 'choice', values: vals.map(value => ({ value })), default: def, tier, group });
const PARAMS = {
  'seed': int(0, 999, 0, 1, 'structural', 'Run'), 'scene-seed': int(0, 999, 0, 1, 'structural', 'Run'),
  'n-buildings': int(10, 12000, 8105, 10, 'structural', 'Run'),   // NetLogo default 200, max 400. User: = the residential buildings found in Jette (8,105); in map mode the first n-buildings of them
  'horizon-months': int(12, 360, 360, 12, 'structural', 'Run', 'months'), // NetLogo default 180; user doubled it
  'delivery-mode': choice(['rebate_market', 'passthrough', 'public_service'], 'rebate_market', 'lever', 'Policy'),
  'credit-access': choice(['income_tested', 'open', 'none'], 'income_tested', 'lever', 'Policy'),
  'energy-scenario': choice(['flat', 'rising', 'shock'], 'rising', 'assumption', 'Assumptions'),
  'refundable?': bool(false, 'lever', 'Policy'), 'means-test?': bool(false, 'lever', 'Policy'),
  'means-test-max-quintile': int(1, 5, 2, 1, 'lever', 'Policy'),
  'deduction-rate': num(0, 1, 0.3, 0.01, 'lever', 'Policy'), 'rebate-lag-months': int(0, 36, 12, 1, 'lever', 'Policy', 'months'),
  'loan-rate': num(0, 0.2, 0.04, 0.001, 'lever', 'Policy'), 'loan-rate-risk-premium': num(0, 0.1, 0.02, 0.001, 'lever', 'Policy'),
  'vendor-margin': num(0, 1, 0.15, 0.01, 'lever', 'Policy'), 'public-overhead': num(0, 1, 0.1, 0.01, 'lever', 'Policy'), 'public-capacity': num(0, 0.2, 0.05, 0.005, 'lever', 'Policy'),
  'shared-measure?': bool(true, 'lever', 'Shared parts'), 'shared-share': num(0, 1, 0.4, 0.01, 'assumption', 'Shared parts'), 'vote-threshold': num(0, 1, 0.67, 0.01, 'lever', 'Shared parts'),
  'consider-prob-base': num(0, 1, 0.05, 0.01, 'assumption', 'Behaviour'), 'neighbour-boost': num(0, 1, 0.3, 0.01, 'assumption', 'Behaviour'), 'peer-effect?': bool(true, 'assumption', 'Behaviour'),
  'free-time-spread': num(0, 1, 0.3, 0.05, 'assumption', 'Behaviour'), 'canvass-target-hours': num(0, 6, 2.0, 0.5, 'assumption', 'Behaviour', 'h/week'),
  'canvass-boost': num(0, 1, 0.2, 0.01, 'assumption', 'Behaviour'), 'canvass-saturation-hours': num(1, 12, 6.0, 0.5, 'assumption', 'Behaviour', 'h/week'),
  'cost-per-m2': num(50, 1000, 300, 10, 'assumption', 'Costs', 'EUR/m2'), 'saving-per-m2-year': num(1, 100, 20, 1, 'assumption', 'Costs', 'EUR/m2/yr'), 'discount-rate': num(0, 0.2, 0.04, 0.001, 'assumption', 'Costs'),
  'loan-term-months': int(12, 360, 120, 12, 'assumption', 'Finance', 'months'), 'credit-income-threshold': num(0, 100000, 25000, 1000, 'assumption', 'Finance', 'EUR/yr'),
  'credit-loan-to-income': num(0, 3, 1.0, 0.1, 'assumption', 'Finance'), 'savings-scale': num(0, 3, 1.0, 0.1, 'assumption', 'Households'), 'savings-usable-share': num(0, 1, 1.0, 0.05, 'assumption', 'Households'),
  'savings-months-of-income': num(0, 12, 3.0, 0.5, 'assumption', 'Households', 'months'),
  'years-in-dwelling-min': int(1, 25, 5, 1, 'assumption', 'Households', 'years'), 'years-in-dwelling-max': int(1, 40, 25, 1, 'assumption', 'Households', 'years'),
  'rental-share-single': num(0, 1, 0.1, 0.01, 'assumption', 'Stock'), 'rental-share-multi': num(0, 1, 0.3, 0.01, 'assumption', 'Stock'),
} satisfies Record<string, ParamSpec>;

const TENURES = ['owner_occupied', 'condo', 'rental'];
const BSTATE = ['not retrofitted', 'partial', 'retrofitted', 'not modelled'];
const SHARED = ['none', 'pending', 'approved'];
const HSTATE = ['none', 'own part paid', 'complete'];
const QN = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'];

// ---------------------------------------------------------------- per-run state (the NetLogo globals and households-own, as arrays in unit order)
interface Cand { u: number; eligible: boolean; price: number; upfront: number; fromSav: number; loan: number; lim: number; rate: number; npv: number; statePays: number; rebate: number; lag: number; capLimited: boolean; base: number; frac: number; kind: 'unit' | 'whole' | 'shared' }
interface Quote { eligible: boolean; price: number; upfront: number; requires: boolean; statePays: number; rebate: number; lag: number; capLimited: boolean }
export interface State {
  tick: number; bLayerIndex: number[]; p: (k: keyof typeof PARAMS) => number; ps: (k: keyof typeof PARAMS) => string; pb: (k: keyof typeof PARAMS) => boolean;
  nB: number; bTenure: Uint8Array; bNuits: Int32Array; bFloor: Float64Array; bNeedsShared: Uint8Array; bApproved: Uint8Array; bAdopted: Int32Array; bAreas: number[][];
  nU: number; bidx: Int32Array; area: Float64Array; income: Float64Array; savings: Float64Array; horizon: Int32Array; queueDraw: Float64Array; quintile: Int32Array; freeHours: Float64Array;
  taxLeft: Float64Array; unitBase: Float64Array; sharedBase: Float64Array; needsShared: Uint8Array; unitDone: Uint8Array; sharedPaid: Uint8Array; supporter: Uint8Array; complete: Uint8Array; paidAny: Uint8Array;
  savingFrac: Float64Array; paidPrice: Float64Array; paidBase: Float64Array; cashNet: Float64Array; loans: number[][][]; uByB: number[][];
  publicCost: number; billsSaved: number; priceSum: number; baseSum: number; nComplete: number; votesPassed: number; unitsCannotFront: number;
  qTotal: number[]; qPrice: number[]; qTrans: number[]; qAdopt: number[]; carry: number; quota: number; pending: [number, number, number][]; mDiscount: number; mGrowth: number; rng: Rng;
  // series metrics
  adoptionByQ: number[]; rebatePerEuro: number[]; canFront: number[]; costPerRetrofit: number; costPartsBase: number; costPartsMarkup: number; canvassHours: number[]; leisureHours: number[]; netCashByQ: number[];
  sharedPending: number; sharedApproved: number; stNot: number; stPartial: number; stDone: number; stNotModelled: number; tOwner: number; tCondo: number; tRental: number;
}
const states = new WeakMap<object, State>();
export const stateOf = (m: Ctx): State => states.get(m)!;

// to-report energy-growth-annual
const energyGrowthAnnual = (s: State) => { const e = s.ps('energy-scenario'); return e === 'flat' ? 0.0 : e === 'rising' ? 0.03 : 0.08; };
// to-report credit-limit-of [inc]
const creditLimitOf = (s: State, inc: number) => { const c = s.ps('credit-access'); if (c === 'none') return 0.0; if (c === 'open') return s.p('credit-loan-to-income') * inc; return inc >= s.p('credit-income-threshold') ? s.p('credit-loan-to-income') * inc : 0.0; };
// to-report loan-rate-of [inc]
const loanRateOf = (s: State, inc: number) => s.p('loan-rate') + (inc < s.p('credit-income-threshold') ? s.p('loan-rate-risk-premium') : 0.0);

// to-report quote-of [u base-cost]  (see the NetLogo source for the full text)
function quoteOf(s: State, u: number, base: number): Quote {
  const eligible = !s.pb('means-test?') || s.quintile[u] <= s.p('means-test-max-quintile');
  if (!eligible) { const price = base * (1.0 + s.p('vendor-margin')); return { eligible: false, price, upfront: price, requires: true, statePays: 0, rebate: 0, lag: 0, capLimited: false }; }
  const dm = s.ps('delivery-mode');
  if (dm === 'rebate_market') { const price = base * (1.0 + s.p('vendor-margin')); const reb = rebateAmount(price, s.p('deduction-rate'), s.taxLeft[u], s.pb('refundable?')); return { eligible: true, price, upfront: price, requires: true, statePays: 0, rebate: reb, lag: s.p('rebate-lag-months'), capLimited: false }; }
  if (dm === 'passthrough') { const price = base * (1.0 + s.p('vendor-margin')); return { eligible: true, price, upfront: 0, requires: false, statePays: price, rebate: 0, lag: 0, capLimited: false }; }
  const price = base * (1.0 + s.p('public-overhead')); return { eligible: true, price, upfront: 0, requires: false, statePays: price, rebate: 0, lag: 0, capLimited: true };
}
// to-report evaluate [u base-cost frac t level]: `false` if the household cannot finance the part; otherwise the record (index 8 is the NPV)
function evaluate(s: State, u: number, base: number, frac: number, t: number, level: number): Omit<Cand, 'base' | 'frac' | 'kind'> | null {
  const q = quoteOf(s, u, base); let lim = 0.0, fromSav = 0.0, loan = 0.0; const rate = loanRateOf(s, s.income[u]);
  if (q.requires) { lim = creditLimitOf(s, s.income[u]); const plan = planFinancing(q.upfront, s.savings[u], lim, s.p('savings-usable-share')); if (!plan[2]) return null; fromSav = plan[0]; loan = plan[1]; }
  const monthlySaving = (s.area[u] * s.p('saving-per-m2-year')) / 12.0 * frac * level;
  const npv = npvRetrofit(monthlySaving, s.horizon[u] - t, s.mDiscount, s.mGrowth, fromSav, loanPayment(loan, rate, s.p('loan-term-months')), s.p('loan-term-months'), q.rebate, q.lag);
  return { u, eligible: q.eligible, price: q.price, upfront: q.upfront, fromSav, loan, lim, rate, npv, statePays: q.statePays, rebate: q.rebate, lag: q.lag, capLimited: q.capLimited };
}
const canAdopt = (s: State, bi: number) => s.bTenure[bi] !== 2;                                         // ownership-can-adopt: tenure != "rental"
const sharedParts = (s: State, bi: number) => s.bTenure[bi] === 1 && s.bNuits[bi] >= 2;                 // ownership-shared-parts
const advocate = (s: State, u: number) => !!(s.supporter[u] || s.paidAny[u]);                           // advocate?
const spendOf = (s: State, u: number) => { if (!advocate(s, u)) return 0.0; if (!sharedParts(s, s.bidx[u])) return 0.0; return Math.min(s.freeHours[u], s.p('canvass-target-hours')); }; // spend-of

// ---------------------------------------------------------------- setup
export interface BuildingInput { footprintM2: number; storeys: number }
// to-report split-areas [k n gross]
//   let old-state rng-state   set rng-state int (hash-uniform scene-seed k 2 * 4294967296)  ...  (4 lines of draws, then restore)
// NetLogo parses a prefix reporter's arguments WITHOUT infix operators (`random 10 + 5` is `(random 10) + 5`), so this is int((hash-uniform scene-seed k 2) * 2^32), as in the
// Python original. (A first reading, hash-uniform with j = 2 * 2^32, gave areas that failed the NetLogo parity check; recorded in parity.md.)
function splitAreas(s: State, k: number, n: number, gross: number): number[] {
  const old = s.rng.state; s.rng.state = Math.trunc(hashUniform(s.p('scene-seed'), k, 2) * U32); const raws: number[] = [];
  for (let i = 0; i < n; i++) raws.push(1.0 + 0.2 * (2.0 * s.rng.random() - 1.0));
  s.rng.state = old; const sum = raws.reduce((a, b) => a + b, 0); return raws.map(r => (gross * r) / sum);
}
/* to build-scene
     set rng-state scene-seed mod 4294967296 ; loop k: footprint = rng-lognormal 4.7 0.4; storeys = item (rng-randint 8) [1 2 2 3 3 4 5 6]; gross = footprint * storeys * 0.8
     nu = max (list 1 round (gross / 80.0)), capped 1000; share = rental-share-single | multi; draw = hash-uniform scene-seed k 1; tenure rental | condo | owner_occupied; areas = split-areas ... */
function buildScene(s: State, world: BuildingInput[] | null) {
  const n = world ? Math.min(world.length, s.p('n-buildings')) : s.p('n-buildings'); s.nB = n;
  s.bTenure = new Uint8Array(n); s.bNuits = new Int32Array(n); s.bFloor = new Float64Array(n); s.bNeedsShared = new Uint8Array(n); s.bApproved = new Uint8Array(n); s.bAdopted = new Int32Array(n); s.bAreas = [];
  s.rng.state = s.p('scene-seed') % U32;
  for (let k = 0; k < n; k++) {
    let footprint: number, storeys: number;
    if (world) { footprint = world[k].footprintM2; storeys = world[k].storeys; }                          // map mode: real footprint, assumed storeys (no rng draws)
    else { footprint = s.rng.lognormal(4.7, 0.4); storeys = [1, 2, 2, 3, 3, 4, 5, 6][s.rng.randint(8)]; }
    const gross = footprint * storeys * 0.8; let nu = Math.max(1, Math.floor(gross / 80.0 + 0.5)); if (nu > 1000) nu = 1000;   // round: half up (gross is positive)
    const share = nu === 1 ? s.p('rental-share-single') : s.p('rental-share-multi'); const draw = hashUniform(s.p('scene-seed'), k, 1);
    let tenure = 0; if (draw < share) tenure = 2; if (tenure !== 2 && nu > 1) tenure = 1;
    const areas = splitAreas(s, k, nu, gross);
    s.bTenure[k] = tenure; s.bNuits[k] = nu; s.bFloor[k] = areas.reduce((a, b) => a + b, 0); s.bAreas.push(areas);
    s.bNeedsShared[k] = s.pb('shared-measure?') && tenure === 1 && nu >= 2 ? 1 : 0;
  }
}
/* to draw-population
     set rng-state seed mod 4294967296; for each building, each unit: income rng-lognormal 10.3 0.5; savings (rng-lognormal 0 0.8) * savings-scale * savings-months-of-income * income / 12;
     yrs rng-uniform years-in-dwelling-min years-in-dwelling-max; queue-draw rng-random; horizon int round (yrs * 12); tax-left max 0 (0.25 * (income - 10000)) */
function drawPopulation(s: State) {
  let total = 0; for (let k = 0; k < s.nB; k++) total += s.bNuits[k]; s.nU = total;
  const f = () => new Float64Array(total), b = () => new Uint8Array(total);
  Object.assign(s, { bidx: new Int32Array(total), area: f(), income: f(), savings: f(), horizon: new Int32Array(total), queueDraw: f(), quintile: new Int32Array(total), freeHours: f(), taxLeft: f(), unitBase: f(), sharedBase: f(),
    needsShared: b(), unitDone: b(), sharedPaid: b(), supporter: b(), complete: b(), paidAny: b(), savingFrac: f(), paidPrice: f(), paidBase: f(), cashNet: f(), loans: Array.from({ length: total }, () => [] as number[][]) });
  s.rng.state = s.p('seed') % U32; let u = 0;
  for (let k = 0; k < s.nB; k++) for (let i = 0; i < s.bNuits[k]; i++, u++) {
    s.bidx[u] = k; s.area[u] = s.bAreas[k][i];
    s.income[u] = s.rng.lognormal(10.3, 0.5);
    s.savings[u] = s.rng.lognormal(0.0, 0.8) * s.p('savings-scale') * s.p('savings-months-of-income') * s.income[u] / 12.0;
    const yrs = s.rng.uniform(s.p('years-in-dwelling-min'), s.p('years-in-dwelling-max')); s.queueDraw[u] = s.rng.random();
    s.horizon[u] = Math.trunc(Math.floor(yrs * 12.0 + 0.5)); s.taxLeft[u] = Math.max(0.0, 0.25 * (s.income[u] - 10000.0));
  }
}
// to compute-quintiles: rank of income over ALL units (rental included); ties by unit id; quintile = min 5 (1 + int (rank * 5 / n))
function computeQuintiles(s: State) {
  const order = Array.from({ length: s.nU }, (_, i) => i).sort((a, b) => s.income[a] < s.income[b] ? -1 : s.income[a] > s.income[b] ? 1 : a - b);
  order.forEach((u, rank) => { s.quintile[u] = Math.min(5, 1 + Math.trunc((rank * 5) / s.nU)); });
}
// to compute-free-hours: base = max 0 (112 - 50 - item (quintile - 1) [42 38 36 40 48]); spread = 1 + free-time-spread * (2 * hash-uniform seed uid 1073741825 - 1); free-hours = max 0 (base * spread)
function computeFreeHours(s: State) {
  for (let u = 0; u < s.nU; u++) { const base = Math.max(0.0, 112.0 - 50.0 - [42.0, 38.0, 36.0, 40.0, 48.0][s.quintile[u] - 1]); const spread = 1.0 + s.p('free-time-spread') * (2.0 * hashUniform(s.p('seed'), u, 1073741825) - 1.0); s.freeHours[u] = Math.max(0.0, base * spread); }
}
// to prepare-costs: shared-total = shared-share * cost-per-m2 * floor; needs-shared -> unit-base = area * cost-per-m2 * (1 - shared-share), shared-base = shared-total * area / floor; else unit-base = area * cost-per-m2
function prepareCosts(s: State) {
  for (let k = 0; k < s.nB; k++) { const floorv = s.bFloor[k], sharedTotal = s.p('shared-share') * s.p('cost-per-m2') * floorv;
    for (const u of s.uByB[k]) { s.needsShared[u] = s.bNeedsShared[k]; if (s.needsShared[u]) { s.unitBase[u] = s.area[u] * s.p('cost-per-m2') * (1.0 - s.p('shared-share')); s.sharedBase[u] = (sharedTotal * s.area[u]) / floorv; } else s.unitBase[u] = s.area[u] * s.p('cost-per-m2'); } }
}
// to setup (the part after build-scene / draw-population: units by building, quintiles, free hours, costs, aggregates)
function setupState(m: Ctx, world: BuildingInput[] | null): State {
  const p = m.params;
  const s = { tick: 0, bLayerIndex: [], p: (k: string) => +p[k], ps: (k: string) => String(p[k]), pb: (k: string) => !!p[k], rng: new Rng() } as unknown as State;
  buildScene(s, world); drawPopulation(s);
  s.uByB = Array.from({ length: s.nB }, () => []); for (let u = 0; u < s.nU; u++) s.uByB[s.bidx[u]].push(u);
  computeQuintiles(s); computeFreeHours(s); prepareCosts(s);
  s.qTotal = [0, 0, 0, 0, 0]; for (let u = 0; u < s.nU; u++) s.qTotal[s.quintile[u] - 1]++;
  s.qPrice = [0, 0, 0, 0, 0]; s.qTrans = [0, 0, 0, 0, 0]; s.qAdopt = [0, 0, 0, 0, 0];
  s.publicCost = 0; s.billsSaved = 0; s.priceSum = 0; s.baseSum = 0; s.nComplete = 0; s.pending = []; s.votesPassed = 0; s.unitsCannotFront = 0;
  s.quota = (s.p('public-capacity') * s.nU) / 12.0; s.carry = 0.0; s.mDiscount = monthlyRate(s.p('discount-rate')); s.mGrowth = monthlyRate(energyGrowthAnnual(s));
  computeSeriesMetrics(s); return s;
}

// ---------------------------------------------------------------- the monthly step
// to pay-part [rec t]
function payPart(s: State, c: Cand, t: number) {
  s.publicCost += c.statePays;
  if (c.rebate > 0.0) { if (c.lag === 0) { s.publicCost += c.rebate; s.cashNet[c.u] += c.rebate; } else s.pending.push([t + c.lag, c.u, c.rebate]); }
  const u = c.u, k = s.quintile[u] - 1;
  s.qPrice[k] += c.price; s.qTrans[k] += c.statePays + c.rebate;
  s.savings[u] -= c.fromSav; s.cashNet[u] -= c.fromSav; s.taxLeft[u] = Math.max(0.0, s.taxLeft[u] - c.rebate);
  if (c.loan > 0.0) s.loans[u].push([loanPayment(c.loan, c.rate, s.p('loan-term-months')), t + s.p('loan-term-months')]);
  s.paidAny[u] = 1; s.paidPrice[u] += c.price; s.paidBase[u] += c.base; s.savingFrac[u] += c.frac;
  if (c.kind === 'shared') s.sharedPaid[u] = 1; if (c.kind !== 'shared') s.unitDone[u] = 1;
  if (s.unitDone[u] && (s.sharedPaid[u] || !s.needsShared[u]) && !s.complete[u]) { s.complete[u] = 1; s.bAdopted[s.bidx[u]]++; s.qAdopt[k]++; s.priceSum += s.paidPrice[u]; s.baseSum += s.paidBase[u]; s.nComplete++; }
}
// to cash-phase [t]: rebates due this month arrive; loan payments fall due
function cashPhase(s: State, t: number) {
  const due = s.pending.filter(r => r[0] === t); s.pending = s.pending.filter(r => r[0] !== t);
  for (const r of due) { s.publicCost += r[2]; s.cashNet[r[1]] += r[2]; }
  for (let u = 0; u < s.nU; u++) for (const l of s.loans[u]) if (t <= l[1]) s.cashNet[u] -= l[0];
}
// to go (phases 1-6 of the header comment)
function go(s: State) {
  const t = s.tick; const level = Math.pow(1.0 + s.mGrowth, t);
  cashPhase(s, t);
  for (let u = 0; u < s.nU; u++) if (s.savingFrac[u] > 0.0 && t < s.horizon[u]) { const bill = (s.area[u] * s.p('saving-per-m2-year')) / 12.0 * s.savingFrac[u] * level; s.billsSaved += bill; s.cashNet[u] += bill; }
  const adoptedSnap = Int32Array.from(s.bAdopted); const spends = new Float64Array(s.nU); const canvTot = new Float64Array(s.nB);
  for (let u = 0; u < s.nU; u++) spends[u] = spendOf(s, u); for (let u = 0; u < s.nU; u++) canvTot[s.bidx[u]] += spends[u];
  let candidates: Cand[] = [];
  for (let u = 0; u < s.nU; u++) {
    const bi = s.bidx[u];
    if (!s.complete[u] && canAdopt(s, bi) && t < s.horizon[u]) {
      const others = Math.max(0.0, canvTot[bi] - spends[u]); const pressure = Math.min(1.0, others / s.p('canvass-saturation-hours'));
      const achare = s.bNuits[bi] > 0 ? adoptedSnap[bi] / s.bNuits[bi] : 0.0; const base = s.p('consider-prob-base'); let prob = base;
      if (s.bTenure[bi] === 1) { const nb = s.pb('peer-effect?') ? s.p('neighbour-boost') : 0.0; prob = Math.min(1.0, base + nb * achare + s.p('canvass-boost') * pressure); }
      const draw = hashUniform(s.p('seed'), u, t);
      if (draw < prob) {
        if (!s.unitDone[u]) { const frac = s.needsShared[u] ? 1.0 - s.p('shared-share') : 1.0; const kind = s.needsShared[u] ? 'unit' : 'whole'; const ev = evaluate(s, u, s.unitBase[u], frac, t, level); if (ev && ev.npv > 0.0) candidates.push({ ...ev, base: s.unitBase[u], frac, kind }); }
        if (s.bNeedsShared[bi] && !s.bApproved[bi] && !s.supporter[u]) { const ev = evaluate(s, u, s.sharedBase[u], s.p('shared-share'), t, level); if (ev && ev.npv > 0.0) s.supporter[u] = 1; }
      }
    }
  }
  let slotsLeft = -1;
  if (s.ps('delivery-mode') === 'public_service') {
    const slots = Math.trunc(s.quota + s.carry); s.carry = s.quota + s.carry - slots;
    const capLim = candidates.filter(c => c.capLimited); capLim.sort((a, b) => s.queueDraw[a.u] < s.queueDraw[b.u] ? -1 : s.queueDraw[a.u] > s.queueDraw[b.u] ? 1 : a.u - b.u);
    const nallow = Math.min(slots, capLim.length); const allowed = new Set(capLim.slice(0, nallow).map(c => c.u));
    candidates = candidates.filter(c => !c.capLimited || allowed.has(c.u)); slotsLeft = slots - allowed.size;
  }
  for (const c of candidates) payPart(s, c, t);
  for (let bi = 0; bi < s.nB; bi++) {
    if (s.bNeedsShared[bi] && !s.bApproved[bi]) {
      const floorv = s.bFloor[bi]; let yes = 0.0; for (const u of s.uByB[bi]) if (s.supporter[u]) yes += s.area[u];
      const yesShare = floorv > 0.0 ? yes / floorv : 0.0;
      if (yesShare + 1e-9 >= s.p('vote-threshold')) {
        let need = 0, fits = true;
        if (slotsLeft !== -1) { need = Math.ceil(s.bNuits[bi] * s.p('shared-share') - 1e-9); if (need > slotsLeft) fits = false; }
        if (fits) {
          const evs: [number, NonNullable<ReturnType<typeof evaluate>>][] = []; let blocked = false;
          for (const u of s.uByB[bi]) if (!blocked) { const ev = evaluate(s, u, s.sharedBase[u], s.p('shared-share'), t, level); if (!ev) blocked = true; else evs.push([u, ev]); }
          if (!blocked) { s.bApproved[bi] = 1; if (slotsLeft !== -1) slotsLeft -= need; s.votesPassed++; for (const [u, ev] of evs) payPart(s, { ...ev, base: s.sharedBase[u], frac: s.p('shared-share'), kind: 'shared' }, t); }
        }
      }
    }
  }
}
// to-report front-feasible? [u upfront]
const frontFeasible = (s: State, u: number, upfront: number) => planFinancing(upfront, s.savings[u], creditLimitOf(s, s.income[u]), s.p('savings-usable-share'))[2];
// to compute-series-metrics
function computeSeriesMetrics(s: State) {
  s.adoptionByQ = s.qAdopt.map((a, k) => (s.qTotal[k] > 0 ? a / s.qTotal[k] : 0.0));
  s.rebatePerEuro = s.qTrans.map((tr, k) => (s.qPrice[k] > 0 ? tr / s.qPrice[k] : NaN));
  const frontOk = [0, 0, 0, 0, 0], frontTot = [0, 0, 0, 0, 0]; s.unitsCannotFront = 0;
  for (let u = 0; u < s.nU; u++) if (!s.complete[u] && canAdopt(s, s.bidx[u])) {
    const remaining = (s.unitDone[u] ? 0.0 : s.unitBase[u]) + (s.needsShared[u] && !s.sharedPaid[u] ? s.sharedBase[u] : 0.0);
    const q = quoteOf(s, u, remaining); const ok = !q.requires || frontFeasible(s, u, q.upfront); const k = s.quintile[u] - 1;
    frontTot[k]++; if (ok) frontOk[k]++; else s.unitsCannotFront++;
  }
  s.canFront = frontOk.map((ok, k) => (frontTot[k] > 0 ? ok / frontTot[k] : NaN));
  s.costPerRetrofit = s.nComplete > 0 ? s.priceSum / s.nComplete : NaN; s.costPartsBase = s.nComplete > 0 ? s.baseSum / s.nComplete : NaN; s.costPartsMarkup = s.nComplete > 0 ? (s.priceSum - s.baseSum) / s.nComplete : NaN;
  const canv = [0, 0, 0, 0, 0], leis = [0, 0, 0, 0, 0], cash = [0, 0, 0, 0, 0], cashN = [0, 0, 0, 0, 0];
  for (let u = 0; u < s.nU; u++) { const k = s.quintile[u] - 1, sp = spendOf(s, u); canv[k] += sp; leis[k] += s.freeHours[u] - sp; if (s.paidAny[u]) { cash[k] += s.cashNet[u]; cashN[k]++; } }
  s.canvassHours = canv.map((c, k) => (s.qTotal[k] > 0 ? c / s.qTotal[k] : 0.0)); s.leisureHours = leis.map((c, k) => (s.qTotal[k] > 0 ? c / s.qTotal[k] : 0.0)); s.netCashByQ = cash.map((c, k) => (cashN[k] > 0 ? c / cashN[k] : NaN));
  s.sharedPending = 0; s.sharedApproved = 0; s.stNot = 0; s.stPartial = 0; s.stDone = 0; s.stNotModelled = 0; s.tOwner = 0; s.tCondo = 0; s.tRental = 0;
  for (let bi = 0; bi < s.nB; bi++) {
    if (s.bNeedsShared[bi]) { if (s.bApproved[bi]) s.sharedApproved++; else s.sharedPending++; }
    if (!canAdopt(s, bi)) s.stNotModelled++; else if (s.bAdopted[bi] === 0) s.stNot++; else if (s.bAdopted[bi] < s.bNuits[bi]) s.stPartial++; else s.stDone++;
    if (s.bTenure[bi] === 0) s.tOwner++; if (s.bTenure[bi] === 1) s.tCondo++; if (s.bTenure[bi] === 2) s.tRental++;
  }
}

// ---------------------------------------------------------------- the model definition
// map mode: the world's `buildings` layer; attrs { footprint_m2, storeys, bound }. Only bound (residential or probable) buildings are households' homes.
function worldBuildings(world: Ctx['world']): { list: BuildingInput[]; layerIndex: number[] } | null {
  const layer = world?.layers?.buildings; if (!layer) return null; const list: BuildingInput[] = [], layerIndex: number[] = [];
  layer.forEach((f, i) => { if (f.attrs.bound) { list.push({ footprintM2: +(f.attrs.footprint_m2 as number), storeys: +(f.attrs.storeys as number) }); layerIndex.push(i); } });
  return { list, layerIndex };
}
function sync(m: Ctx, s: State) {
  const v = m.columns().vars; // household u is slot u; building k is slot nU + k (turtles are created once, in order, and never die)
  for (let u = 0; u < s.nU; u++) {
    v.tenure[u] = s.bTenure[s.bidx[u]]; v.quintile[u] = s.quintile[u]; v.area[u] = s.area[u]; v.income[u] = s.income[u]; v.savings[u] = s.savings[u]; v.horizon[u] = s.horizon[u];
    v.hstate[u] = s.complete[u] ? 2 : s.paidAny[u] ? 1 : 0;
  }
  for (let k = 0; k < s.nB; k++) {
    const i = s.nU + k; v.btenure[i] = s.bTenure[k]; v.units[i] = s.bNuits[k]; v.adopted[i] = s.bAdopted[k];
    v.bstate[i] = !canAdopt(s, k) ? 3 : s.bAdopted[k] === 0 ? 0 : s.bAdopted[k] < s.bNuits[k] ? 1 : 2; v.shared[i] = !s.bNeedsShared[k] ? 0 : s.bApproved[k] ? 2 : 1;
  }
}

export default defineModel({
  title: 'The Great Retrofit v3 (Jette)',
  time: { unit: 'months', horizon: 360 },
  world: { minPxcor: 0, maxPxcor: 24, minPycor: 0, maxPycor: 15 },
  params: PARAMS,
  turtlesOwn: { anchor: 'i32' },
  breeds: {
    households: { kind: 'anchored', layer: 'buildings', label: 'Households (units in a building)', own: { tenure: 'i32', quintile: 'i32', area: 'f64', income: 'f64', savings: 'f64', horizon: 'i32', hstate: 'i32' },
      frame: ['tenure', 'quintile', 'area', 'income', 'savings', 'horizon', 'hstate'], categories: { tenure: TENURES, hstate: HSTATE } },
    buildings: { kind: 'anchored', layer: 'buildings', label: 'Building state (derived from the households; not an agent)', own: { btenure: 'i32', units: 'i32', adopted: 'i32', bstate: 'i32', shared: 'i32' },
      frame: ['btenure', 'units', 'adopted', 'bstate', 'shared'], categories: { btenure: TENURES, bstate: BSTATE, shared: SHARED } },
  },
  reads: { world: ['buildings'], data: [] },
  setup(m) {
    // to setup
    const wb = worldBuildings(m.world); const s = setupState(m, wb ? wb.list : null); states.set(m, s);
    s.bLayerIndex = wb ? wb.layerIndex : Array.from({ length: s.nB }, (_, k) => k);
    m.createTurtles(m.breeds.households, s.nU, (t: AnyAgent) => { t.anchor = s.bLayerIndex[s.bidx[t.who]]; });
    m.createTurtles(m.breeds.buildings, s.nB, (t: AnyAgent) => { t.anchor = s.bLayerIndex[t.who - s.nU]; });
    sync(m, s); m.resetTicks();
  },
  go(m) {
    // to go: if ticks >= horizon-months [ stop ] ... tick ... compute-series-metrics
    const s = stateOf(m); if (s.tick >= s.p('horizon-months')) return false;
    go(s); m.tick(); s.tick = m.ticks; computeSeriesMetrics(s); sync(m, s);
  },
  stop: (m) => stateOf(m).tick >= stateOf(m).p('horizon-months'),
  plots: {
    'Adoption by quintile': { label: 'Adoption by quintile', unit: 'share retrofitted', pens: Object.fromEntries(QN.map((q, k) => [q, (m: Ctx) => stateOf(m).adoptionByQ[k]])) },
    'State spend (cumulative)': { label: 'State spend (cumulative)', unit: 'EUR', pens: { 'public cost': (m: Ctx) => stateOf(m).publicCost } },
    'Bills saved (cumulative)': { label: 'Bills saved (cumulative)', unit: 'EUR', pens: { 'bills saved': (m: Ctx) => stateOf(m).billsSaved } },
    'Cost per retrofit': { label: 'Cost per retrofit', unit: 'EUR', pens: { price: (m: Ctx) => stateOf(m).costPerRetrofit } },
    'cost parts': { label: 'Cost parts (base + markup)', unit: 'EUR', pens: { base: (m: Ctx) => stateOf(m).costPartsBase, markup: (m: Ctx) => stateOf(m).costPartsMarkup } },
    'tenures': { label: 'Tenures', unit: 'buildings', pens: { 'owner-occupied': (m: Ctx) => stateOf(m).tOwner, condo: (m: Ctx) => stateOf(m).tCondo, rental: (m: Ctx) => stateOf(m).tRental } },
    'building states': { label: 'Building states', unit: 'buildings', pens: { 'no retrofit': (m: Ctx) => stateOf(m).stNot, partial: (m: Ctx) => stateOf(m).stPartial, done: (m: Ctx) => stateOf(m).stDone, 'rental (not modelled)': (m: Ctx) => stateOf(m).stNotModelled } },
    'can front cost by quintile': { label: 'Can front cost, by quintile', unit: 'share', pens: Object.fromEntries(QN.map((q, k) => [q, (m: Ctx) => stateOf(m).canFront[k]])) },
    'rebate per euro by quintile': { label: 'Rebate per euro, by quintile', unit: 'EUR/EUR', pens: Object.fromEntries(QN.map((q, k) => [q, (m: Ctx) => stateOf(m).rebatePerEuro[k]])) },
    'net cash by quintile': { label: 'Net cash, by quintile', unit: 'EUR', pens: Object.fromEntries(QN.map((q, k) => [q, (m: Ctx) => stateOf(m).netCashByQ[k]])) },
    'shared measures': { label: 'Shared measures (model globals, not on the dashboard)', pens: { pending: (m: Ctx) => stateOf(m).sharedPending, approved: (m: Ctx) => stateOf(m).sharedApproved, 'votes passed': (m: Ctx) => stateOf(m).votesPassed, 'units cannot front': (m: Ctx) => stateOf(m).unitsCannotFront, 'adopted units': (m: Ctx) => stateOf(m).nComplete } },
  },
  monitors: {
    month: { label: 'Month', unit: 'months', value: (m: Ctx) => stateOf(m).tick },
    'adopted units': { label: 'Adopted units', value: (m: Ctx) => stateOf(m).nComplete },
    'public cost': { label: 'Public cost', unit: 'EUR', value: (m: Ctx) => stateOf(m).publicCost },
    'bills saved': { label: 'Bills saved', unit: 'EUR', value: (m: Ctx) => stateOf(m).billsSaved },
    'cost per retrofit': { label: 'Cost per retrofit', unit: 'EUR', value: (m: Ctx) => stateOf(m).costPerRetrofit },
  },
});

// Procedures exported for the procedure gates (test/procedures.test.ts-style checks against NetLogo).
export const procs = { hashUniform, mix32, Rng, monthlyRate, annuityPv, npvRetrofit, loanPayment, planFinancing, rebateAmount, setupState, go, computeSeriesMetrics };
