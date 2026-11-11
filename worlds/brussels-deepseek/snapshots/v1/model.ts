// Brussels Deepseek — The Great Retrofit v3, converted from NetLogo 7.0.4.
//
// Source: netlogomodels/great-retrofit-v3.nlogox (CC BY 4.0, Sci-Fi Economics Lab).
// EVERY NUMBER IN THE MODEL IS A PLACEHOLDER. Nothing computed here is a finding.
//
// Conversion rules followed (skills/paperdolls-netlogo-to-ts §3):
//  - one procedure at a time, the NetLogo source above each converted procedure;
//  - the model's own mulberry32 + hash_uniform port is kept byte-for-byte, because the
//    NetLogo file and the Python reference depend on it;
//  - iteration is in unit (who) order everywhere, as in NetLogo;
//  - the world binding reads the real Jette dwellings from `input.world`; with no world
//    (parity runs) it builds the model's synthetic scene exactly as NetLogo does.
import { defineModel, type Ctx } from '../../../tools/agents/library/index.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Tenure = 'owner_occupied' | 'condo' | 'rental';
interface Bld {
  idx: number; id: string; anchor: number; levels: number; footprint: number;
  nu: number; gross: number; areas: number[]; floor: number;
  tenure: Tenure; needsShared: boolean; approved: boolean; adopted: number;
}
interface Loan { pay: number; last: number }
interface HH {
  uid: number; bidx: number; tenure: Tenure; area: number;
  income: number; savings: number; horizon: number; queueDraw: number;
  quintile: number; freeHours: number; taxLeft: number;
  unitBase: number; sharedBase: number; needsShared: boolean;
  unitDone: boolean; sharedPaid: boolean; supporter: boolean;
  complete: boolean; paidAny: boolean;
  savingFrac: number; paidPrice: number; paidBase: number; cashNet: number;
  loans: Loan[];
}
interface Quote {
  eligible: boolean; price: number; upfront: number; requiresFinancing: boolean;
  statePays: number; rebate: number; lag: number; capacityLimited: boolean;
}
interface Candidate {
  u: HH; eligible: boolean; price: number; upfront: number; fromSavings: number;
  loan: number; limit: number; rate: number; npv: number; statePays: number;
  rebate: number; lag: number; capacityLimited: boolean; base: number; frac: number;
  kind: 'unit' | 'whole' | 'shared';
}
interface State {
  b: Bld[]; h: HH[]; byBuilding: HH[][];
  publicCost: number; billsSaved: number; priceSum: number; baseSum: number;
  nComplete: number; votesPassed: number; unitsCannotFront: number;
  qTotal: number[]; qPrice: number[]; qTrans: number[]; qAdopt: number[];
  carry: number; quota: number; pending: [number, number, number][];
  mDiscount: number; mGrowth: number; rngState: number;
  adoptionByQuintile: number[]; rebatePerEuro: number[]; canFront: number[];
  costPerRetrofit: number; costPartsBase: number; costPartsMarkup: number;
  canvassHours: number[]; leisureHours: number[]; netCash: number[];
  sharedPending: number; sharedApproved: number;
  stateNotRetrofitted: number; statePartial: number; stateRetrofitted: number; stateNotModelled: number;
  tenureOwner: number; tenureCondo: number; tenureRental: number;
  dwellingCount: number;
  worldDwellings?: { id: string; anchor: number; levels: number; footprint: number; units: number; gross: number }[] | null;
}
let S: State; // one run at a time: parity and the page both run sequentially

// ---------------------------------------------------------------------------
// PRNG: mulberry32 + hash_uniform, byte-compatible port of v3/common/rng.py
// NetLogo source: sections nl-bit-and / imul / xor32 / mix32 / hash-uniform /
// rng-next-u32 / rng-random / rng-randint / rng-gaussian / rng-lognormal / rng-uniform.
// ---------------------------------------------------------------------------
const U32 = 4294967296;
const mix32 = (h0: number): number => {
  let h = h0 >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
};
export function hashUniform(s: number, i: number, j: number): number {
  let h = mix32((((s >>> 0) ^ Math.imul(i >>> 0, 0x9e3779b1)) >>> 0));
  h = mix32((h ^ Math.imul(j >>> 0, 0x85ebca6b)) >>> 0);
  return h / U32;
}
function rngNextU32(): number {
  S.rngState = (S.rngState + 0x6d2b79f5) >>> 0;
  let t = S.rngState;
  t = Math.imul((t ^ (t >>> 15)) >>> 0, (t | 1) >>> 0) >>> 0;
  t = (t ^ ((t + Math.imul((t ^ (t >>> 7)) >>> 0, (t | 61) >>> 0)) >>> 0)) >>> 0;
  return (t ^ (t >>> 14)) >>> 0;
}
const rngRandom = (): number => rngNextU32() / U32;
const rngRandint = (n: number): number => Math.floor(rngRandom() * n);
const rngGaussian = (): number => Math.sqrt(-2 * Math.log(1 - rngRandom())) * Math.cos(2 * Math.PI * rngRandom());
const rngLognormal = (mu: number, sigma: number): number => Math.exp(mu + sigma * rngGaussian());
const rngUniform = (lo: number, hi: number): number => lo + (hi - lo) * rngRandom();
const rnd = (x: number): number => (x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5)); // NetLogo round: half away from zero

// ---------------------------------------------------------------------------
// Pure economics — one function per to-report, NetLogo source above each.
// ---------------------------------------------------------------------------

// to-report monthly-rate [annual]  ->  (1 + annual) ^ (1/12) - 1
export function monthlyRate(annual: number): number { return Math.pow(1 + annual, 1 / 12) - 1; }

// to-report annuity-pv [first-payment rate n-months growth]
export function annuityPv(first: number, rate: number, n: number, growth: number): number {
  if (n <= 0 || first === 0) return 0;
  const q = (1 + growth) / (1 + rate);
  if (Math.abs(q - 1) < 1e-12) return (first / (1 + rate)) * n;
  return (first / (1 + rate)) * (1 - Math.pow(q, n)) / (1 - q);
}

// to-report npv-retrofit [...]
export function npvRetrofit(monthlySaving: number, nMonths: number, mDisc: number, mGr: number,
  cash: number, loanPay: number, loanMonths: number, rebate: number, rebateLag: number): number {
  const pvSavings = annuityPv(monthlySaving, mDisc, nMonths, mGr);
  let pvRebate = 0;
  if (rebate > 0) pvRebate = rebate / Math.pow(1 + mDisc, rebateLag);
  const pvLoan = annuityPv(loanPay, mDisc, loanMonths, 0);
  return pvSavings + pvRebate - cash - pvLoan;
}

// to-report loan-payment [principal annual-rate months]  ->  level monthly annuity
export function loanPayment(principal: number, annualRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = monthlyRate(annualRate);
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

// to-report plan-financing [upfront liquid limit usable-share]
export function planFinancing(upfront: number, liquid: number, limit: number, usableShare: number) {
  const usable = Math.max(0, liquid) * usableShare;
  const fromSavings = Math.min(usable, upfront);
  const loan = upfront - fromSavings;
  return { fromSavings, loan, feasible: loan <= limit + 1e-9 };
}

// to-report rebate-amount [cost rate tax-capacity refund-flag]
export function rebateAmount(cost: number, rate: number, taxCapacity: number, refundable: boolean): number {
  const gross = Math.max(0, rate * cost);
  if (refundable) return Math.min(gross, cost);
  return Math.min(Math.min(gross, Math.max(0, taxCapacity)), cost);
}

// to-report credit-limit-of [inc]
function creditLimitOf(p: Record<string, any>, inc: number): number {
  if (p['credit-access'] === 'none') return 0;
  if (p['credit-access'] === 'open') return p['credit-loan-to-income'] * inc;
  return inc >= p['credit-income-threshold'] ? p['credit-loan-to-income'] * inc : 0;
}

// to-report loan-rate-of [inc]
function loanRateOf(p: Record<string, any>, inc: number): number {
  return p['loan-rate'] + (inc < p['credit-income-threshold'] ? p['loan-rate-risk-premium'] : 0);
}

// to-report energy-growth-annual
function energyGrowthAnnual(mode: string): number {
  if (mode === 'flat') return 0;
  if (mode === 'rising') return 0.03;
  return 0.08;
}

// to-report quote-of [u base-cost]
function quoteOf(p: Record<string, any>, u: HH, baseCost: number): Quote {
  const eligible = !p['means-test?'] || u.quintile <= p['means-test-max-quintile'];
  if (!eligible) {
    const price = baseCost * (1 + p['vendor-margin']);
    return { eligible: false, price, upfront: price, requiresFinancing: true, statePays: 0, rebate: 0, lag: 0, capacityLimited: false };
  }
  if (p['delivery-mode'] === 'rebate_market') {
    const price = baseCost * (1 + p['vendor-margin']);
    const reb = rebateAmount(price, p['deduction-rate'], u.taxLeft, !!p['refundable?']);
    return { eligible: true, price, upfront: price, requiresFinancing: true, statePays: 0, rebate: reb, lag: p['rebate-lag-months'], capacityLimited: false };
  }
  if (p['delivery-mode'] === 'passthrough') {
    const price = baseCost * (1 + p['vendor-margin']);
    return { eligible: true, price, upfront: 0, requiresFinancing: false, statePays: price, rebate: 0, lag: 0, capacityLimited: false };
  }
  const price = baseCost * (1 + p['public-overhead']);
  return { eligible: true, price, upfront: 0, requiresFinancing: false, statePays: price, rebate: 0, lag: 0, capacityLimited: true };
}

// to-report evaluate [u base-cost frac t level]  ->  false (null here) or the candidate record
function evaluate(p: Record<string, any>, u: HH, baseCost: number, frac: number, t: number, level: number): Candidate | null {
  const q = quoteOf(p, u, baseCost);
  let lim = 0, fromSav = 0, loan = 0;
  const rate = loanRateOf(p, u.income);
  if (q.requiresFinancing) {
    lim = creditLimitOf(p, u.income);
    const plan = planFinancing(q.upfront, u.savings, lim, p['savings-usable-share']);
    if (!plan.feasible) return null;
    fromSav = plan.fromSavings;
    loan = plan.loan;
  }
  const monthlySaving = (u.area * p['saving-per-m2-year']) / 12 * frac * level;
  const npv = npvRetrofit(monthlySaving, u.horizon - t, S.mDiscount, S.mGrowth, fromSav,
    loanPayment(loan, rate, p['loan-term-months']), p['loan-term-months'], q.rebate, q.lag);
  return {
    u, eligible: q.eligible, price: q.price, upfront: q.upfront, fromSavings: fromSav, loan, limit: lim,
    rate, npv, statePays: q.statePays, rebate: q.rebate, lag: q.lag, capacityLimited: q.capacityLimited,
    base: baseCost, frac, kind: 'whole',
  };
}

// to-report ownership-can-adopt [bi] / ownership-shared-parts [bi]
const ownershipCanAdopt = (b: Bld): boolean => b.tenure !== 'rental';
const ownershipSharedParts = (b: Bld): boolean => b.tenure === 'condo' && b.nu >= 2;

// to-report advocate? [u] / spend-of [u]
const advocate = (u: HH): boolean => u.supporter || u.paidAny;
function spendOf(p: Record<string, any>, u: HH): number {
  if (!advocate(u)) return 0;
  if (!ownershipSharedParts(S.b[u.bidx])) return 0;
  return Math.min(u.freeHours, p['canvass-target-hours']);
}

// ---------------------------------------------------------------------------
// Setup — NetLogo source kept above each block.
// ---------------------------------------------------------------------------

// to-report split-areas [k n gross]
function splitAreas(sceneSeed: number, k: number, n: number, gross: number): number[] {
  const old = S.rngState;
  S.rngState = Math.floor(hashUniform(sceneSeed, k, 2) * U32) >>> 0;
  const raws: number[] = [];
  for (let i = 0; i < n; i++) raws.push(1 + 0.2 * (2 * rngRandom() - 1));
  S.rngState = old;
  const sum = raws.reduce((a, b) => a + b, 0);
  return raws.map((r) => (gross * r) / sum);
}

const DWELLING_CLASSES = new Set(['apartments', 'house', 'residential', 'detached', 'terrace', 'semidetached_house', 'bungalow', 'mixed_use', 'hut']);

/** The real Jette dwellings, in stable id order. The model's scene rules fill what
 *  OSM does not say: floor area from footprint × storeys × 0.8, units from 80 m²,
 *  tenure from the same seeded draw the placeholder scene uses. */
function dwellingsFromWorld(world: any): { id: string; anchor: number; levels: number; footprint: number; units: number; gross: number }[] | null {
  const feats = world?.layers?.buildings;
  if (!Array.isArray(feats) || !feats.length) return null;
  const picked: { id: string; anchor: number; levels: number; footprint: number; units: number; gross: number }[] = [];
  feats.forEach((f: any, idx: number) => {
    const cls = f.economic_class;
    const residential = f.residential;
    if (f.kind && f.kind !== 'building') return;
    if (!(residential === 'residential' || residential === 'probable')) return;
    if (!DWELLING_CLASSES.has(cls)) return;
    const footprint = Number(f.area) || 50;
    const levels = Math.max(1, Math.round(Number(f.levels) || (Number(f.height) ? Number(f.height) / 3.1 : 2)));
    const gross = footprint * levels * 0.8;
    const units = Math.min(1000, Math.max(1, rnd(gross / 80)));
    picked.push({ id: String(f.id), anchor: idx, levels, footprint, units, gross });
  });
  picked.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return picked.length ? picked : null;
}

// to build-scene  (synthetic branch, exactly as NetLogo; or the world branch described above)
function buildScene(p: Record<string, any>): void {
  const nb = S.dwellingCount;
  const sceneSeed = Number(p['scene-seed']);
  S.b = [];
  for (let k = 0; k < nb; k++) S.b.push({} as Bld);
  if (S.worldDwellings) {
    for (let k = 0; k < nb; k++) {
      const d = S.worldDwellings[k];
      const share = d.units === 1 ? p['rental-share-single'] : p['rental-share-multi'];
      const draw = hashUniform(sceneSeed, k, 1);
      let tenure: Tenure = 'owner_occupied';
      if (draw < share) tenure = 'rental';
      if (tenure !== 'rental' && d.units > 1) tenure = 'condo';
      const areas = splitAreas(sceneSeed, k, d.units, d.gross);
      Object.assign(S.b[k], {
        idx: k, id: d.id, anchor: d.anchor, levels: d.levels, footprint: d.footprint, nu: d.units,
        gross: d.gross, areas, floor: areas.reduce((a, b) => a + b, 0), tenure,
        needsShared: !!p['shared-measure?'] && tenure === 'condo' && d.units >= 2,
        approved: false, adopted: 0,
      });
    }
    return;
  }
  S.rngState = Math.floor(sceneSeed) % U32 >>> 0;
  const STOREYS = [1, 2, 2, 3, 3, 4, 5, 6];
  for (let k = 0; k < nb; k++) {
    const footprint = rngLognormal(4.7, 0.4);
    const storeys = STOREYS[rngRandint(8)];
    const gross = footprint * storeys * 0.8;
    const nu = Math.min(1000, Math.max(1, rnd(gross / 80)));
    const share = nu === 1 ? p['rental-share-single'] : p['rental-share-multi'];
    const draw = hashUniform(sceneSeed, k, 1);
    let tenure: Tenure = 'owner_occupied';
    if (draw < share) tenure = 'rental';
    if (tenure !== 'rental' && nu > 1) tenure = 'condo';
    const areas = splitAreas(sceneSeed, k, nu, gross);
    Object.assign(S.b[k], {
      idx: k, id: 'b' + k, anchor: k, levels: storeys, footprint, nu, gross, areas,
      floor: areas.reduce((a, b) => a + b, 0), tenure,
      needsShared: !!p['shared-measure?'] && tenure === 'condo' && nu >= 2, approved: false, adopted: 0,
    });
  }
}

// to draw-population
function drawPopulation(p: Record<string, any>): void {
  S.rngState = Math.floor(Number(p.seed)) % U32 >>> 0;
  S.h = [];
  for (let k = 0; k < S.b.length; k++) {
    const b = S.b[k];
    for (let i = 0; i < b.nu; i++) {
      const income = rngLognormal(10.3, 0.5);
      const sav = rngLognormal(0, 0.8) * p['savings-scale'] * p['savings-months-of-income'] * income / 12;
      const yrs = rngUniform(p['years-in-dwelling-min'], p['years-in-dwelling-max']);
      const queueDraw = rngRandom();
      const uid = S.h.length;
      S.h.push({
        uid, bidx: k, tenure: b.tenure, area: b.areas[i], income, savings: sav,
        horizon: Math.floor(rnd(yrs * 12)), queueDraw, quintile: 0, freeHours: 0,
        taxLeft: Math.max(0, 0.25 * (income - 10000)), unitBase: 0, sharedBase: 0,
        needsShared: false, unitDone: false, sharedPaid: false, supporter: false,
        complete: false, paidAny: false, savingFrac: 0, paidPrice: 0, paidBase: 0,
        cashNet: 0, loans: [],
      });
    }
  }
}

// to compute-quintiles
function computeQuintiles(): void {
  const order = S.h.map((_, i) => i).sort((a, b) => {
    const ha = S.h[a], hb = S.h[b];
    if (ha.income !== hb.income) return ha.income - hb.income;
    return ha.uid - hb.uid;
  });
  const n = order.length;
  order.forEach((idx, rank) => { S.h[idx].quintile = Math.min(5, 1 + Math.floor((rank * 5) / n)); });
}

// to compute-free-hours
function computeFreeHours(p: Record<string, any>): void {
  const baseProfile = [42, 38, 36, 40, 48];
  for (const u of S.h) {
    const base = Math.max(0, 112 - 50 - baseProfile[u.quintile - 1]);
    const spread = 1 + p['free-time-spread'] * (2 * hashUniform(Number(p.seed), u.uid, 1073741825) - 1);
    u.freeHours = Math.max(0, base * spread);
  }
}

// to prepare-costs
function prepareCosts(p: Record<string, any>): void {
  for (const b of S.b) {
    const sharedTotal = p['shared-share'] * p['cost-per-m2'] * b.floor;
    for (const u of S.byBuilding[b.idx]) {
      u.needsShared = b.needsShared;
      if (u.needsShared) {
        u.unitBase = u.area * p['cost-per-m2'] * (1 - p['shared-share']);
        u.sharedBase = sharedTotal * u.area / b.floor;
      } else {
        u.unitBase = u.area * p['cost-per-m2'];
      }
    }
  }
}

// to setup
function setup(p: Record<string, any>, world: any): void {
  S = {
    b: [], h: [], byBuilding: [], publicCost: 0, billsSaved: 0, priceSum: 0, baseSum: 0,
    nComplete: 0, votesPassed: 0, unitsCannotFront: 0,
    qTotal: [0, 0, 0, 0, 0], qPrice: [0, 0, 0, 0, 0], qTrans: [0, 0, 0, 0, 0], qAdopt: [0, 0, 0, 0, 0],
    carry: 0, quota: 0, pending: [], mDiscount: monthlyRate(p['discount-rate']),
    mGrowth: monthlyRate(energyGrowthAnnual(p['energy-scenario'])), rngState: 0,
    adoptionByQuintile: [0, 0, 0, 0, 0], rebatePerEuro: [NaN, NaN, NaN, NaN, NaN], canFront: [NaN, NaN, NaN, NaN, NaN],
    costPerRetrofit: NaN, costPartsBase: NaN, costPartsMarkup: NaN,
    canvassHours: [0, 0, 0, 0, 0], leisureHours: [0, 0, 0, 0, 0], netCash: [NaN, NaN, NaN, NaN, NaN],
    sharedPending: 0, sharedApproved: 0,
    stateNotRetrofitted: 0, statePartial: 0, stateRetrofitted: 0, stateNotModelled: 0,
    tenureOwner: 0, tenureCondo: 0, tenureRental: 0, dwellingCount: 0,
    worldDwellings: dwellingsFromWorld(world),
  };
  S.dwellingCount = S.worldDwellings ? S.worldDwellings.length : Math.max(1, Math.round(Number(p['n-buildings'])));
  buildScene(p);
  drawPopulation(p);
  S.byBuilding = S.b.map(() => []);
  for (const u of S.h) S.byBuilding[u.bidx].push(u);
  computeQuintiles();
  computeFreeHours(p);
  prepareCosts(p);
  for (const u of S.h) S.qTotal[u.quintile - 1]++;
  S.quota = p['public-capacity'] * S.h.length / 12;
  computeSeriesMetrics(p);
}

// ---------------------------------------------------------------------------
// One month — to go, split into its phases with the NetLogo source above each.
// ---------------------------------------------------------------------------

// to cash-phase [t]
function cashPhase(p: Record<string, any>, t: number): void {
  const due = S.pending.filter((r) => r[0] === t);
  S.pending = S.pending.filter((r) => r[0] !== t);
  for (const r of due) { S.publicCost += r[2]; S.h[r[1]].cashNet += r[2]; }
  for (const u of S.h) for (const l of u.loans) if (t <= l.last) u.cashNet -= l.pay;
}

// to pay-part [rec t]
function payPart(p: Record<string, any>, c: Candidate, t: number): void {
  S.publicCost += c.statePays;
  if (c.rebate > 0) {
    if (c.lag === 0) { S.publicCost += c.rebate; c.u.cashNet += c.rebate; }
    else S.pending.push([t + c.lag, c.u.uid, c.rebate]);
  }
  const k = c.u.quintile - 1;
  S.qPrice[k] += c.price;
  S.qTrans[k] += c.statePays + c.rebate;
  const u = c.u;
  u.savings -= c.fromSavings;
  u.cashNet -= c.fromSavings;
  u.taxLeft = Math.max(0, u.taxLeft - c.rebate);
  if (c.loan > 0) u.loans.push({ pay: loanPayment(c.loan, c.rate, p['loan-term-months']), last: t + p['loan-term-months'] });
  u.paidAny = true;
  u.paidPrice += c.price;
  u.paidBase += c.base;
  u.savingFrac += c.frac;
  if (c.kind === 'shared') u.sharedPaid = true;
  if (c.kind !== 'shared') u.unitDone = true;
  if (u.unitDone && (u.sharedPaid || !u.needsShared) && !u.complete) {
    u.complete = true;
    const b = S.b[u.bidx];
    b.adopted++;
    S.qAdopt[k]++;
    S.priceSum += u.paidPrice;
    S.baseSum += u.paidBase;
    S.nComplete++;
  }
}

// to go — the body, in the order of the model's six numbered phases
function goMonth(p: Record<string, any>, t: number): void {
  const level = Math.pow(1 + S.mGrowth, t);

  // --- 1. cash arriving and leaving ---
  cashPhase(p, t);
  for (const u of S.h) {
    if (u.savingFrac > 0 && t < u.horizon) {
      const bill = (u.area * p['saving-per-m2-year']) / 12 * u.savingFrac * level;
      S.billsSaved += bill;
      u.cashNet += bill;
    }
  }

  // --- 2. snapshot: adoption shares and canvassing pressure at the start of the month
  const adoptedSnap = S.b.map((b) => b.adopted);
  const spends = new Float64Array(S.h.length);
  const canvTot = new Float64Array(S.b.length);
  for (let i = 0; i < S.h.length; i++) {
    const s = spendOf(p, S.h[i]);
    spends[i] = s;
    canvTot[S.h[i].bidx] += s;
  }

  // --- 3. considerations
  const candidates: Candidate[] = [];
  for (let ui = 0; ui < S.h.length; ui++) {
    const u = S.h[ui], b = S.b[u.bidx], bi = u.bidx;
    if (u.complete || !ownershipCanAdopt(b) || t >= u.horizon) continue;
    const mySpend = spends[ui];
    const others = Math.max(0, canvTot[bi] - mySpend);
    const pressure = Math.min(1, others / p['canvass-saturation-hours']);
    const achareFrac = b.nu > 0 ? adoptedSnap[bi] / b.nu : 0;
    let prob = p['consider-prob-base'];
    if (b.tenure === 'condo') {
      const nb = p['peer-effect?'] ? p['neighbour-boost'] : 0;
      prob = Math.min(1, prob + nb * achareFrac + p['canvass-boost'] * pressure);
    }
    const draw = hashUniform(Number(p.seed), u.uid, t);
    if (draw < prob) {
      // (a) own part: NPV and financing must both pass
      if (!u.unitDone) {
        const frac = u.needsShared ? 1 - p['shared-share'] : 1;
        const kind: 'unit' | 'whole' = u.needsShared ? 'unit' : 'whole';
        const ev = evaluate(p, u, u.unitBase, frac, t, level);
        if (ev && ev.npv > 0) { ev.kind = kind; candidates.push(ev); }
      }
      // (b) shared measure: support it (permanent) if your share works
      if (b.needsShared && !b.approved && !u.supporter) {
        const ev = evaluate(p, u, u.sharedBase, p['shared-share'], t, level);
        if (ev && ev.npv > 0) u.supporter = true;
      }
    }
  }

  // --- 4. public-service capacity, then payment
  let slotsLeft = -1;
  if (p['delivery-mode'] === 'public_service') {
    const slots = Math.floor(S.quota + S.carry);
    S.carry = S.quota + S.carry - slots;
    const capLim = candidates.filter((c) => c.capacityLimited);
    const sorted = capLim.slice().sort((a, b) => {
      if (a.u.queueDraw !== b.u.queueDraw) return a.u.queueDraw - b.u.queueDraw;
      return a.u.uid - b.u.uid;
    });
    const nallow = Math.min(slots, sorted.length);
    const allowed = new Set(sorted.slice(0, nallow).map((c) => c.u.uid));
    const kept = candidates.filter((c) => !c.capacityLimited || allowed.has(c.u.uid));
    candidates.length = 0;
    candidates.push(...kept);
    slotsLeft = slots - nallow;
  }
  for (const c of candidates) payPart(p, c, t);

  // --- 5. shared-measure votes
  for (let bi = 0; bi < S.b.length; bi++) {
    const b = S.b[bi];
    if (!b.needsShared || b.approved) continue;
    let yes = 0;
    for (const u of S.byBuilding[bi]) if (u.supporter) yes += u.area;
    const yesShare = b.floor > 0 ? yes / b.floor : 0;
    if (yesShare + 1e-9 >= p['vote-threshold']) {
      let need = 0;
      let fits = true;
      if (slotsLeft !== -1) {
        need = Math.ceil(b.nu * p['shared-share'] - 1e-9);
        if (need > slotsLeft) fits = false;
      }
      if (fits) {
        const evs: { u: HH; ev: Candidate }[] = [];
        let blocked = false;
        for (const u of S.byBuilding[bi]) {
          const evl = evaluate(p, u, u.sharedBase, p['shared-share'], t, level);
          if (evl === null) { blocked = true; break; }
          evs.push({ u, ev: evl });
        }
        if (!blocked) {
          b.approved = true;
          if (slotsLeft !== -1) slotsLeft -= need;
          S.votesPassed++;
          for (const { u, ev } of evs) {
            ev.kind = 'shared';
            ev.base = u.sharedBase;
            ev.frac = p['shared-share'];
            payPart(p, ev, t);
          }
        }
      }
    }
  }
}

// to compute-series-metrics
function computeSeriesMetrics(p: Record<string, any>): void {
  S.adoptionByQuintile = S.qTotal.map((tot, k) => (tot > 0 ? S.qAdopt[k] / tot : 0));
  S.rebatePerEuro = S.qPrice.map((pr, k) => (pr > 0 ? S.qTrans[k] / pr : NaN));
  let frontOk = [0, 0, 0, 0, 0];
  let frontTot = [0, 0, 0, 0, 0];
  S.unitsCannotFront = 0;
  for (const u of S.h) {
    if (u.complete || !ownershipCanAdopt(S.b[u.bidx])) continue;
    const remaining = (u.unitDone ? 0 : u.unitBase) + (u.needsShared && !u.sharedPaid ? u.sharedBase : 0);
    const q = quoteOf(p, u, remaining);
    const ok = !q.requiresFinancing || planFinancing(q.upfront, u.savings, creditLimitOf(p, u.income), p['savings-usable-share']).feasible;
    const k = u.quintile - 1;
    frontTot[k]++;
    if (ok) frontOk[k]++; else S.unitsCannotFront++;
  }
  S.canFront = frontOk.map((ok, k) => (frontTot[k] > 0 ? ok / frontTot[k] : NaN));
  S.costPerRetrofit = S.nComplete > 0 ? S.priceSum / S.nComplete : NaN;
  S.costPartsBase = S.nComplete > 0 ? S.baseSum / S.nComplete : NaN;
  S.costPartsMarkup = S.nComplete > 0 ? (S.priceSum - S.baseSum) / S.nComplete : NaN;

  const canv = [0, 0, 0, 0, 0], leis = [0, 0, 0, 0, 0], cash = [0, 0, 0, 0, 0], cashN = [0, 0, 0, 0, 0];
  for (const u of S.h) {
    const k = u.quintile - 1;
    const s = spendOf(p, u);
    canv[k] += s;
    leis[k] += u.freeHours - s;
    if (u.paidAny) { cash[k] += u.cashNet; cashN[k]++; }
  }
  S.canvassHours = canv.map((s, k) => (S.qTotal[k] > 0 ? s / S.qTotal[k] : 0));
  S.leisureHours = leis.map((s, k) => (S.qTotal[k] > 0 ? s / S.qTotal[k] : 0));
  S.netCash = cash.map((s, k) => (cashN[k] > 0 ? s / cashN[k] : NaN));

  S.sharedPending = 0; S.sharedApproved = 0;
  S.stateNotRetrofitted = 0; S.statePartial = 0; S.stateRetrofitted = 0; S.stateNotModelled = 0;
  S.tenureOwner = 0; S.tenureCondo = 0; S.tenureRental = 0;
  for (const b of S.b) {
    if (b.needsShared) { if (b.approved) S.sharedApproved++; else S.sharedPending++; }
    if (!ownershipCanAdopt(b)) S.stateNotModelled++;
    else if (b.adopted === 0) S.stateNotRetrofitted++;
    else if (b.adopted < b.nu) S.statePartial++;
    else S.stateRetrofitted++;
    if (b.tenure === 'owner_occupied') S.tenureOwner++;
    if (b.tenure === 'condo') S.tenureCondo++;
    if (b.tenure === 'rental') S.tenureRental++;
  }
}

// ---------------------------------------------------------------------------
// Agent sync: write the run's state onto the two anchored breeds' columns.
// ---------------------------------------------------------------------------
const TENURE_IDX: Record<Tenure, number> = { owner_occupied: 0, condo: 1, rental: 2 };

function syncAgents(m: Ctx): void {
  const cols = (m as any).columns();
  const v = cols.vars as Record<string, any>;
  const NB = S.b.length;
  for (let i = 0; i < NB; i++) {
    const b = S.b[i];
    v.anchor[i] = b.anchor;
    v.tenure[i] = TENURE_IDX[b.tenure];
    v.units[i] = b.nu;
    v.adoption[i] = b.nu > 0 ? b.adopted / b.nu : 0;
    v.retrofit_state[i] = b.tenure === 'rental' ? NaN : b.adopted === 0 ? 0 : b.adopted < b.nu ? 1 : 2;
    v.approved[i] = b.approved ? 1 : 0;
    v.shared_state[i] = !b.needsShared ? 0 : b.approved ? 2 : 1;
  }
  for (let i = 0; i < S.h.length; i++) {
    const u = S.h[i], s = NB + i;
    v.anchor[s] = S.b[u.bidx].anchor;
    v.quintile[s] = u.quintile;
    v.complete[s] = u.complete ? 1 : 0;
    v.unit_done[s] = u.unitDone ? 1 : 0;
    v.supporter[s] = u.supporter ? 1 : 0;
    v.saving_frac[s] = u.savingFrac;
    v.income[s] = u.income;
    v.cash_net[s] = u.cashNet;
  }
}

const meanOf = (xs: number[]): number => {
  const ok = xs.filter((x) => Number.isFinite(x));
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN;
};

export default defineModel({
  title: 'The Great Retrofit — Jette',
  time: { unit: 'months', horizon: 360 },
  world: { minPxcor: 0, maxPxcor: 0, minPycor: 0, maxPycor: 0, wrapX: false, wrapY: false },
  params: {
    seed: { type: 'integer', min: 0, max: 999, step: 1, default: 0, tier: 'assumption', group: 'Run', label: 'Household seed' },
    'scene-seed': { type: 'integer', min: 0, max: 999, step: 1, default: 0, tier: 'assumption', group: 'Run', label: 'Scene seed' },
    'n-buildings': { type: 'integer', min: 10, max: 9216, step: 1, default: 200, tier: 'structural', group: 'Run', label: 'Synthetic buildings (inert with the map)' },
    'horizon-months': { type: 'integer', min: 12, max: 360, step: 1, default: 360, tier: 'structural', group: 'Run', label: 'Horizon', unit: 'months' },
    'delivery-mode': {
      type: 'choice', default: 'rebate_market', tier: 'lever', group: 'Policy',
      label: 'Delivery mode', values: [
        { value: 'rebate_market', label: 'Rebate, market vendor' },
        { value: 'passthrough', label: 'State pays the vendor' },
        { value: 'public_service', label: 'Public service, rationed' },
      ],
    },
    'credit-access': {
      type: 'choice', default: 'income_tested', tier: 'lever', group: 'Policy',
      label: 'Credit access', values: [
        { value: 'income_tested', label: 'Income-tested' },
        { value: 'open', label: 'Open' },
        { value: 'none', label: 'None' },
      ],
    },
    'energy-scenario': {
      type: 'choice', default: 'rising', tier: 'assumption', group: 'Policy',
      label: 'Energy prices', values: [
        { value: 'flat', label: 'Flat' },
        { value: 'rising', label: 'Rising 3% a year' },
        { value: 'shock', label: 'Shock, 8% a year' },
      ],
    },
    'refundable?': { type: 'boolean', default: false, tier: 'lever', group: 'Policy', label: 'Refundable rebate' },
    'means-test?': { type: 'boolean', default: false, tier: 'lever', group: 'Policy', label: 'Means test' },
    'means-test-max-quintile': { type: 'integer', min: 1, max: 5, step: 1, default: 2, tier: 'lever', group: 'Policy', label: 'Means test up to quintile' },
    'deduction-rate': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.3, tier: 'lever', group: 'Policy', label: 'Rebate rate' },
    'rebate-lag-months': { type: 'integer', min: 0, max: 36, step: 1, default: 12, tier: 'lever', group: 'Policy', label: 'Rebate lag', unit: 'months' },
    'loan-rate': { type: 'number', min: 0, max: 0.2, step: 0.001, default: 0.04, tier: 'lever', group: 'Finance', label: 'Loan rate' },
    'loan-rate-risk-premium': { type: 'number', min: 0, max: 0.1, step: 0.001, default: 0.02, tier: 'lever', group: 'Finance', label: 'Risk premium below threshold' },
    'vendor-margin': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.15, tier: 'assumption', group: 'Costs', label: 'Vendor margin' },
    'public-overhead': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.1, tier: 'assumption', group: 'Costs', label: 'Public overhead' },
    'public-capacity': { type: 'number', min: 0, max: 0.2, step: 0.005, default: 0.05, tier: 'lever', group: 'Policy', label: 'Public capacity', unit: 'share of units a year' },
    'shared-measure?': { type: 'boolean', default: true, tier: 'lever', group: 'Policy', label: 'Shared-parts measure' },
    'shared-share': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.4, tier: 'assumption', group: 'Policy', label: 'Shared part of the works' },
    'vote-threshold': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.67, tier: 'lever', group: 'Policy', label: 'Vote threshold' },
    'consider-prob-base': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.05, tier: 'assumption', group: 'Behaviour', label: 'Monthly consideration chance' },
    'neighbour-boost': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.3, tier: 'assumption', group: 'Behaviour', label: 'Neighbour effect' },
    'peer-effect?': { type: 'boolean', default: true, tier: 'lever', group: 'Behaviour', label: 'Peer effect' },
    'free-time-spread': { type: 'number', min: 0, max: 1, step: 0.05, default: 0.3, tier: 'assumption', group: 'Behaviour', label: 'Free-time spread' },
    'canvass-target-hours': { type: 'number', min: 0, max: 6, step: 0.5, default: 2, tier: 'assumption', group: 'Behaviour', label: 'Canvassing target', unit: 'hours a week' },
    'canvass-boost': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.2, tier: 'assumption', group: 'Behaviour', label: 'Canvassing effect' },
    'canvass-saturation-hours': { type: 'number', min: 1, max: 12, step: 0.5, default: 6, tier: 'assumption', group: 'Behaviour', label: 'Canvassing saturation', unit: 'hours a week' },
    'cost-per-m2': { type: 'number', min: 50, max: 1000, step: 10, default: 300, tier: 'assumption', group: 'Costs', label: 'Retrofit cost', unit: '€/m²' },
    'saving-per-m2-year': { type: 'number', min: 1, max: 100, step: 1, default: 20, tier: 'assumption', group: 'Costs', label: 'Energy saving', unit: '€/m² a year' },
    'discount-rate': { type: 'number', min: 0, max: 0.2, step: 0.001, default: 0.04, tier: 'assumption', group: 'Finance', label: 'Discount rate' },
    'loan-term-months': { type: 'integer', min: 12, max: 360, step: 12, default: 120, tier: 'lever', group: 'Finance', label: 'Loan term', unit: 'months' },
    'credit-income-threshold': { type: 'number', min: 0, max: 100000, step: 1000, default: 25000, tier: 'lever', group: 'Finance', label: 'Credit income threshold', unit: '€ a year' },
    'credit-loan-to-income': { type: 'number', min: 0, max: 3, step: 0.1, default: 1, tier: 'lever', group: 'Finance', label: 'Loan-to-income cap' },
    'savings-scale': { type: 'number', min: 0, max: 3, step: 0.1, default: 1, tier: 'assumption', group: 'Households', label: 'Savings scale' },
    'savings-usable-share': { type: 'number', min: 0, max: 1, step: 0.05, default: 1, tier: 'lever', group: 'Households', label: 'Usable savings share' },
    'savings-months-of-income': { type: 'number', min: 0, max: 12, step: 0.5, default: 3, tier: 'assumption', group: 'Households', label: 'Savings, months of income' },
    'years-in-dwelling-min': { type: 'integer', min: 1, max: 25, step: 1, default: 5, tier: 'assumption', group: 'Households', label: 'Stay, minimum', unit: 'years' },
    'years-in-dwelling-max': { type: 'integer', min: 1, max: 40, step: 1, default: 25, tier: 'assumption', group: 'Households', label: 'Stay, maximum', unit: 'years' },
    'rental-share-single': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.1, tier: 'assumption', group: 'Households', label: 'Rental share, single-unit' },
    'rental-share-multi': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.3, tier: 'assumption', group: 'Households', label: 'Rental share, multi-unit' },
  },
  turtlesOwn: {},
  breeds: {
    buildings: {
      kind: 'anchored', layer: 'buildings', label: 'Buildings',
      own: {
        anchor: 'i32', tenure: 'i32', units: 'i32', adoption: 'f64', retrofit_state: 'f64',
        approved: 'bool', shared_state: 'i32',
      },
      categories: { tenure: ['owner_occupied', 'condo', 'rental'], shared_state: ['none', 'pending', 'passed'] },
      frame: ['anchor', 'tenure', 'units', 'adoption', 'retrofit_state', 'approved', 'shared_state'],
    },
    households: {
      kind: 'anchored', layer: 'buildings', label: 'Households',
      own: {
        anchor: 'i32', quintile: 'i32', complete: 'bool', unit_done: 'bool',
        supporter: 'bool', saving_frac: 'f64', income: 'f64', cash_net: 'f64',
      },
      frame: ['anchor', 'quintile', 'complete', 'unit_done', 'supporter', 'saving_frac', 'income', 'cash_net'],
    },
  },
  globals: { 'horizon': 360 },
  reads: { world: ['buildings'], data: [] },
  setup(m) {
    const p = m.params as Record<string, any>;
    setup(p, m.world);
    m.resetTicks();
    const nb = S.b.length;
    let bi = 0;
    m.createTurtles(m.breeds.buildings, nb, () => { bi++; });
    const nh = S.h.length;
    let hi = 0;
    m.createTurtles(m.breeds.households, nh, () => { hi++; });
    void bi; void hi;
    syncAgents(m);
  },
  go(m) {
    const p = m.params as Record<string, any>;
    const t = m.ticks;
    if (t >= Number(p['horizon-months'])) return false;
    goMonth(p, t);
    m.tick();
    computeSeriesMetrics(p);
    syncAgents(m);
  },
  plots: {
    adoption: {
      label: 'Adoption by income quintile', unit: 'share of units',
      pens: { Q1: () => S.adoptionByQuintile[0], Q2: () => S.adoptionByQuintile[1], Q3: () => S.adoptionByQuintile[2], Q4: () => S.adoptionByQuintile[3], Q5: () => S.adoptionByQuintile[4] },
    },
    state_spend: { label: 'State spend, cumulative', unit: '€', pens: { publiccost: () => S.publicCost } },
    bills_saved: { label: 'Bills saved, cumulative', unit: '€', pens: { billssaved: () => S.billsSaved } },
    cost_per_retrofit: { label: 'Cost per retrofit', unit: '€', pens: { price: () => S.costPerRetrofit } },
    votes: { label: 'Shared measures', unit: 'measures', pens: { votespassed: () => S.votesPassed } },
  },
  monitors: {
    adopted_units: { label: 'Adopted units', unit: 'units', value: () => S.nComplete },
    public_cost: { label: 'Public cost', unit: '€', value: () => S.publicCost },
    bills_saved: { label: 'Bills saved', unit: '€', value: () => S.billsSaved },
    cost_per_retrofit: { label: 'Cost per retrofit', unit: '€', value: () => S.costPerRetrofit },
    can_front_share: { label: 'Can finance', unit: 'share of units', value: () => meanOf(S.canFront) },
    shared_approved: { label: 'Shared measures', unit: 'measures', value: () => S.sharedApproved },
    votes_passed: { label: 'Votes passed', unit: 'votes', value: () => S.votesPassed },
    units_cannot_front: { label: 'Units that cannot front the cost', unit: 'units', value: () => S.unitsCannotFront },
    dwelling_buildings: { label: 'Dwelling buildings', unit: 'buildings', value: () => S.b.length },
    households: { label: 'Households', unit: 'households', value: () => S.h.length },
    state_not_retrofitted: { label: 'Buildings with no unit done', unit: 'buildings', value: () => S.stateNotRetrofitted },
    state_partial: { label: 'Buildings partly done', unit: 'buildings', value: () => S.statePartial },
    state_retrofitted: { label: 'Buildings done', unit: 'buildings', value: () => S.stateRetrofitted },
    state_not_modelled: { label: 'Rental buildings, not modelled', unit: 'buildings', value: () => S.stateNotModelled },
    tenure_owner: { label: 'Owner-occupied buildings', unit: 'buildings', value: () => S.tenureOwner },
    tenure_condo: { label: 'Condo buildings', unit: 'buildings', value: () => S.tenureCondo },
    tenure_rental: { label: 'Rental buildings', unit: 'buildings', value: () => S.tenureRental },
    rebate_per_euro: { label: 'Public euro per euro of price', unit: '€', value: () => meanOf(S.rebatePerEuro) },
    net_cash: { label: 'Net cash after retrofit', unit: '€', value: () => meanOf(S.netCash) },
    canvass_hours: { label: 'Canvassing hours a week', unit: 'hours', value: () => meanOf(S.canvassHours) },
    leisure_hours: { label: 'Leisure hours a week', unit: 'hours', value: () => meanOf(S.leisureHours) },
  },
});

// Exposed for a world-local fixture test (pure functions only).
export const procs = { monthlyRate, annuityPv, npvRetrofit, loanPayment, planFinancing, rebateAmount, hashUniform };

