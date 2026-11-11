// The Great Retrofit v3 — NetLogo port → TypeScript (paperdolls conversion).
// Source of truth: netlogomodels/great-retrofit-v3.nlogox (NetLogo 7.0.4, single file).
// Converted procedure by procedure; the NetLogo source is attached as a comment above each procedure.
// Every number in the model is a placeholder, as in the NetLogo original; nothing computed here is a finding.
//
// Determinism: every model draw flows through the model's own mulberry32 (+ hash_uniform for
// per-household, per-month draws), ported byte-identically from the NetLogo source. The library's own
// stream is used only by createTurtles (headings; unused by the model). Iteration is always in unit
// order (who order), as in the NetLogo original.
//
// Real-scene (world) mode: when the page passes `world.layers.buildings` (the OSM Jette structures),
// the scene is derived from it — dwellings are the structures whose `residential` attribute is
// 'residential' or 'probable' (433 + 7,672 = 8,105 in OSM relation 58258); other buildings render
// but carry no households. Storeys come from `attrs.levels` (99% assumed, not measured), floor area
// from `attrs.area`; anything the ingest guessed flows in labelled. `n-buildings` is ignored in world
// mode. Without a world, the synthetic NetLogo scene is built from `n-buildings` (parity path).
import { defineModel, type AnyAgent, type Ctx } from '../../../tools/agents/library/index.ts';

const TWO32 = 4294967296;

// =============================================================================
// PRNG: mulberry32 + hash_uniform (NetLogo: nl-bit-and, nl-bit-or, imul, xor32,
// mix32, hash-uniform, rng-next-u32, rng-random, rng-randint, rng-gaussian,
// rng-lognormal, rng-uniform). All integer ops are exact in doubles (< 2^53).
// =============================================================================

const nlBitAnd = (a: number, b: number): number => (a & b) >>> 0;              // native 32-bit ops — identical results for values < 2^32
const nlBitOr = (a: number, b: number): number => (a | b) >>> 0;
const imul32 = (a: number, b: number): number => Math.imul(a, b) >>> 0;
const xor32 = (a: number, b: number): number => (a ^ b) >>> 0;
const mix32 = (h0: number): number => {              // ;; to-report mix32 (murmur3 fmix32 finaliser)
  let h = h0 >>> 0;
  h = xor32(h, h >>> 16);
  h = imul32(h, 2246822507);
  h = xor32(h, h >>> 13);
  h = imul32(h, 3266489909);
  h = xor32(h, h >>> 16);
  return h;
};
const hashUniform = (s: number, i: number, j: number): number => {  // ;; to-report hash-uniform [s i j]
  let h = mix32(xor32(s % TWO32, imul32(i % TWO32, 2654435761)));
  h = mix32(xor32(h, imul32(j % TWO32, 2246822507)));
  return h / TWO32;
};
const netlogoRound = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x));    // `round`: half away from zero
const netlogoInt = Math.trunc;                                                     // `int`: toward zero
const netlogoMod = (a: number, n: number) => ((a % n) + n) % n;                    // NetLogo `mod` is floored

interface RunState {
  rngState: number;
  bTenure: string[]; bNu: number[]; bFloor: number[]; bNeedsShared: boolean[];
  bApproved: boolean[]; bAdopted: number[]; bAreas: number[][];
  uByB: number[][]; nUnits: number; nBuildings: number; anchors: number[];
  agents: AnyAgent[]; byBuilding: AnyAgent[][];
  publicCost: number; billsSaved: number; priceSum: number; baseSum: number;
  nComplete: number; votesPassed: number; unitsCannotFront: number;
  qTotal: number[]; qPrice: number[]; qTrans: number[]; qAdopt: number[];
  carry: number; quota: number;
  pending: [number, number, number][]; // [arrival tick, slot, amount]
  mDiscount: number; mGrowth: number;
  adoptionByQuintile: number[]; rebatePerEuro: number[]; canFrontCost: number[];
  costPerRetrofit: number; costPartsBase: number; costPartsMarkup: number;
  canvassHours: number[]; leisureHours: number[]; netCashByQuintile: number[];
  sharedPending: number; sharedApproved: number;
  stateNotRetrofitted: number; statePartial: number; stateRetrofitted: number; stateNotModelled: number;
  tenureOwner: number; tenureCondo: number; tenureRental: number;
  loans: { pay: number; last: number }[][]; // per slot
}
const STATES = new WeakMap<object, RunState>();
const st = (m: Ctx): RunState => { const s = STATES.get(m); if (!s) throw new Error('model state missing'); return s; };

const rngNextU32 = (s: RunState): number => {       // ;; to-report rng-next-u32 (stateful, scene/population stream)
  s.rngState = (s.rngState + 1831565813) % TWO32;
  let t = s.rngState;
  t = imul32(xor32(t, Math.trunc(t / 32768)), nlBitOr(t, 1));
  t = xor32(t, (t + imul32(xor32(t, Math.trunc(t / 128)), nlBitOr(t, 61))) % TWO32);
  return xor32(t, Math.trunc(t / 16384));
};
const rngRandom = (s: RunState) => rngNextU32(s) / TWO32;                        // ;; to-report rng-random
const rngRandint = (s: RunState, n: number) => Math.trunc(rngRandom(s) * n);     // ;; to-report rng-randint [n]
const rngGaussian = (s: RunState): number => {                                   // ;; to-report rng-gaussian (Box-Muller)
  const u1 = 1.0 - rngRandom(s), u2 = rngRandom(s);
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(360.0 * u2 * Math.PI / 180.0); // NetLogo cos takes degrees: 360 * u2 is 2π·u2 rad
};
const rngLognormal = (s: RunState, mu: number, sigma: number) => Math.exp(mu + sigma * rngGaussian(s)); // ;; to-report rng-lognormal [mu sigma]
const rngUniform = (s: RunState, lo: number, hi: number) => lo + (hi - lo) * rngRandom(s);              // ;; to-report rng-uniform [lo hi]

// =============================================================================
// Pure economics (NetLogo: monthly-rate, annuity-pv, npv-retrofit, loan-payment,
// plan-financing, rebate-amount, credit-limit-of, loan-rate-of, energy-growth-annual,
// quote-of, evaluate, ownership-can-adopt, ownership-shared-parts, advocate?, spend-of)
// =============================================================================
const monthlyRate = (annual: number) => Math.pow(1.0 + annual, 1.0 / 12.0) - 1.0;                        // ;; to-report monthly-rate [annual]

function annuityPv(firstPayment: number, rate: number, nMonths: number, growth: number): number {         // ;; to-report annuity-pv [first-payment rate n-months growth]
  if (nMonths <= 0 || firstPayment === 0.0) return 0.0;
  const q = (1.0 + growth) / (1.0 + rate);
  if (Math.abs(q - 1.0) < 1e-12) return (firstPayment / (1.0 + rate)) * nMonths;
  return (firstPayment / (1.0 + rate)) * (1.0 - Math.pow(q, nMonths)) / (1.0 - q);
}

function npvRetrofit(monthlySaving: number, nMonths: number, mDisc: number, mGr: number,
                     cash: number, loanPay: number, loanMonths: number, rebate: number, rebateLag: number): number { // ;; to-report npv-retrofit [monthly-saving n-months m-disc m-gr cash loan-pay loan-months rebate rebate-lag]
  const pvSavings = annuityPv(monthlySaving, mDisc, nMonths, mGr);
  let pvRebate = 0.0;
  if (rebate > 0.0) pvRebate = rebate / Math.pow(1.0 + mDisc, rebateLag);
  const pvLoan = annuityPv(loanPay, mDisc, loanMonths, 0.0);
  return pvSavings + pvRebate - cash - pvLoan;
}

const loanPayment = (principal: number, annualRate: number, months: number): number => {                  // ;; to-report loan-payment [principal annual-rate months]
  if (principal <= 0 || months <= 0) return 0.0;
  const r = monthlyRate(annualRate);
  if (r === 0.0) return principal / months;
  return (principal * r) / (1.0 - Math.pow(1.0 + r, -months));
};

const planFinancing = (upfront: number, liquid: number, limit: number, usableShare: number) => {          // ;; to-report plan-financing [upfront liquid limit usable-share]
  const usable = Math.max(0.0, liquid) * usableShare;
  const fromSavings = Math.min(usable, upfront);
  const loan = upfront - fromSavings;
  return { fromSavings, loan, feasible: loan <= limit + 1e-9 };
};

const rebateAmount = (cost: number, rate: number, taxCapacity: number, refundFlag: boolean): number => {  // ;; to-report rebate-amount [cost rate tax-capacity refund-flag]
  const gross = Math.max(0.0, rate * cost);
  if (refundFlag) return Math.min(gross, cost);
  return Math.min(Math.min(gross, Math.max(0.0, taxCapacity)), cost);
};

const creditLimitOf = (params: Record<string, any>, inc: number): number => {                             // ;; to-report credit-limit-of [inc]
  if (params['credit-access'] === 'none') return 0.0;
  if (params['credit-access'] === 'open') return +params['credit-loan-to-income'] * inc;
  return inc >= +params['credit-income-threshold'] ? +params['credit-loan-to-income'] * inc : 0.0;
};
const loanRateOf = (params: Record<string, any>, inc: number): number =>                                  // ;; to-report loan-rate-of [inc]
  +params['loan-rate'] + (inc < +params['credit-income-threshold'] ? +params['loan-rate-risk-premium'] : 0.0);

const energyGrowthAnnual = (params: Record<string, any>): number => {                                     // ;; to-report energy-growth-annual
  if (params['energy-scenario'] === 'flat') return 0.0;   // PLACEHOLDER flat
  if (params['energy-scenario'] === 'rising') return 0.03; // PLACEHOLDER rising (default)
  return 0.08;                                             // PLACEHOLDER shock
};

interface Quote { eligible: boolean; price: number; upfront: number; financing: boolean; statePaysNow: number; rebate: number; rebateLag: number; capacityLimited: boolean } // ;; quote-of record
const quoteOf = (params: Record<string, any>, u: AnyAgent, baseCost: number): Quote => {                                   // ;; to-report quote-of [u base-cost]
  const eligible = !params['means-test?'] || (u.quintile <= +params['means-test-max-quintile']);
  if (!eligible) {
    // ;; A household outside the means test buys on the market: full price with vendor margin, own financing, no subsidy.
    const price = baseCost * (1.0 + +params['vendor-margin']);
    return { eligible: false, price, upfront: price, financing: true, statePaysNow: 0.0, rebate: 0.0, rebateLag: 0.0, capacityLimited: false };
  }
  if (params['delivery-mode'] === 'rebate_market') {
    const price = baseCost * (1.0 + +params['vendor-margin']);
    const reb = rebateAmount(price, +params['deduction-rate'], u.tax_left, !!params['refundable?']);
    return { eligible: true, price, upfront: price, financing: true, statePaysNow: 0.0, rebate: reb, rebateLag: +params['rebate-lag-months'], capacityLimited: false };
  }
  if (params['delivery-mode'] === 'passthrough') {
    const price = baseCost * (1.0 + +params['vendor-margin']);
    return { eligible: true, price, upfront: 0.0, financing: false, statePaysNow: price, rebate: 0.0, rebateLag: 0.0, capacityLimited: false };
  }
  const price = baseCost * (1.0 + +params['public-overhead']);                                     // public_service
  return { eligible: true, price, upfront: 0.0, financing: false, statePaysNow: price, rebate: 0.0, rebateLag: 0.0, capacityLimited: true };
};

interface Evaluation {                       // ;; evaluate record + make-candidate suffix (base-cost saved-fraction kind)
  u: AnyAgent; eligible: boolean; price: number; upfront: number; fromSavings: number;
  loan: number; limit: number; rate: number; npv: number;
  statePaysNow: number; rebate: number; rebateLag: number; capacityLimited: boolean;
  base: number; frac: number; kind: string;
}
const evaluateAt = (s: RunState, params: Record<string, any>, u: AnyAgent, baseCost: number, frac: number, t: number, level: number, kind: string): Evaluation | false => { // ;; to-report evaluate [u base-cost frac t level] + make-candidate
  const q = quoteOf(params, u, baseCost);
  let lim = 0.0, fromSav = 0.0, loan = 0.0;
  const rate = loanRateOf(params, u.income);
  if (q.financing) {                       // requires financing
    lim = creditLimitOf(params, u.income);
    const plan = planFinancing(q.upfront, u.savings, lim, +params['savings-usable-share']);
    if (!plan.feasible) return false;
    fromSav = plan.fromSavings; loan = plan.loan;
  }
  const monthlySaving = u.area * +params['saving-per-m2-year'] / 12.0 * frac * level;
  const npv = npvRetrofit(monthlySaving, Math.max(0, u.horizon - t), s.mDiscount, s.mGrowth,
    fromSav, loanPayment(loan, rate, +params['loan-term-months']), +params['loan-term-months'], q.rebate, q.rebateLag);
  return { u, eligible: q.eligible, price: q.price, upfront: q.upfront, fromSavings: fromSav, loan, limit: lim, rate, npv,
           statePaysNow: q.statePaysNow, rebate: q.rebate, rebateLag: q.rebateLag, capacityLimited: q.capacityLimited,
           base: baseCost, frac, kind };
};

const ownershipCanAdopt = (tenure: string) => tenure !== 'rental';                        // ;; to-report ownership-can-adopt [bi]
const ownershipSharedParts = (tenure: string, nu: number) => tenure === 'condo' && nu >= 2; // ;; to-report ownership-shared-parts [bi]
const advocate = (u: AnyAgent) => u.supporter || u.paid_any;                              // ;; to-report advocate? [u]
const spendOf = (params: Record<string, any>, u: AnyAgent, tenure: string, nu: number): number => { // ;; to-report spend-of [u]
  if (!advocate(u)) return 0.0;
  if (!ownershipSharedParts(tenure, nu)) return 0.0;
  return Math.min(u.free_hours, +params['canvass-target-hours']);
};

// =============================================================================
// Setup
// =============================================================================

// ;; to-report split-areas [k n gross]
function splitAreas(s: RunState, sceneSeed: number, k: number, n: number, gross: number): number[] {
  const oldState = s.rngState;
  s.rngState = netlogoInt(hashUniform(sceneSeed, k, 2) * TWO32);
  const raws: number[] = [];
  for (let i = 0; i < n; i++) raws.push(1.0 + 0.2 * (2.0 * rngRandom(s) - 1.0)); // PLACEHOLDER spread 0.2
  s.rngState = oldState;
  const sum = raws.reduce((a, b) => a + b, 0);
  return raws.map((r) => (gross * r) / sum);
}

interface SceneBuild { tenure: string[]; nu: number[]; floor: number[]; needsShared: boolean[]; areas: number[][]; anchors: number[] } // anchors[k] = index into world.layers.buildings (synthetic mode: k)

// ;; to build-scene  — synthetic path (NetLogo original) or real-scene path (world provided)
function buildScene(s: RunState, params: Record<string, any>, world: any | null): SceneBuild {
  const sceneSeed = +params['scene-seed'];
  if (world && world.layers && Array.isArray(world.layers.buildings) && world.layers.buildings.length > 0) {
    // real-scene path: dwellings only, in layer order
    const out: SceneBuild = { tenure: [], nu: [], floor: [], needsShared: [], areas: [], anchors: [] };
    world.layers.buildings.forEach((feat: any, layerIdx: number) => {
      const res = feat?.attrs?.residential;
      if (res !== 'residential' && res !== 'probable') return;          // non-dwellings render, carry no households
      const footprint = Number(feat?.attrs?.area ?? 0);
      const storeys = Math.max(1, netlogoRound(Number(feat?.attrs?.levels ?? Math.max(1, Number(feat?.attrs?.height ?? 6.2) / 3.1))));
      const gross = footprint * storeys * 0.8;                                   // PLACEHOLDER usable fraction
      let nu = Math.max(1, netlogoRound(gross / 80.0));                          // PLACEHOLDER avg unit area 80 m2
      if (nu > 1000) nu = 1000;                                                  // MAX_UNITS_PER_BUILDING
      const share = nu === 1 ? +params['rental-share-single'] : +params['rental-share-multi'];
      const draw = hashUniform(sceneSeed, out.tenure.length, 1);
      let tenure = 'owner_occupied';
      if (draw < share) tenure = 'rental';
      if (tenure !== 'rental' && nu > 1) tenure = 'condo';
      const areas = splitAreas(s, sceneSeed, out.tenure.length, nu, gross);
      out.tenure.push(tenure); out.nu.push(nu); out.floor.push(areas.reduce((a, b) => a + b, 0));
      out.needsShared.push(!!params['shared-measure?'] && tenure === 'condo' && nu >= 2);
      out.areas.push(areas); out.anchors.push(layerIdx);
    });
    if (out.tenure.length === 0) throw new Error('world: no dwellings (residential=residential|probable) in the buildings layer');
    return out;
  }
  // synthetic path — the NetLogo original, unchanged
  const nB = +params['n-buildings'];
  const out: SceneBuild = { tenure: [], nu: [], floor: [], needsShared: [], areas: [], anchors: [] };
  s.rngState = netlogoMod(sceneSeed, TWO32);
  for (let k = 0; k < nB; k++) {
    const footprint = rngLognormal(s, 4.7, 0.4);                                   // PLACEHOLDER footprint (lognormal)
    const storeys = [1, 2, 2, 3, 3, 4, 5, 6][rngRandint(s, 8)];                    // PLACEHOLDER
    const gross = footprint * storeys * 0.8;                                       // PLACEHOLDER usable fraction
    let nu = Math.max(1, netlogoRound(gross / 80.0));
    if (nu > 1000) nu = 1000;
    const share = nu === 1 ? +params['rental-share-single'] : +params['rental-share-multi'];
    const draw = hashUniform(sceneSeed, k, 1);
    let tenure = 'owner_occupied';
    if (draw < share) tenure = 'rental';
    if (tenure !== 'rental' && nu > 1) tenure = 'condo';
    const areas = splitAreas(s, sceneSeed, k, nu, gross);
    out.tenure.push(tenure); out.nu.push(nu); out.floor.push(areas.reduce((a, b) => a + b, 0));
    out.needsShared.push(!!params['shared-measure?'] && tenure === 'condo' && nu >= 2);
    out.areas.push(areas); out.anchors.push(k);
  }
  return out;
}

// ;; to draw-population  — PLACEHOLDER household population, drawn in unit order (rng seeded by `seed`)
function drawPopulation(s: RunState, params: Record<string, any>, scene: SceneBuild, create: (k: number, i: number) => AnyAgent) {
  s.rngState = netlogoMod(+params['seed'], TWO32);
  for (let k = 0; k < scene.nu.length; k++) {
    const nu = scene.nu[k], areasList = scene.areas[k];
    for (let i = 0; i < nu; i++) {
      const u = create(k, i);
      u.area = areasList[i];
      u.income = rngLognormal(s, 10.3, 0.5);                                       // PLACEHOLDER income distribution
      u.savings = rngLognormal(s, 0.0, 0.8) * +params['savings-scale'] * +params['savings-months-of-income'] * u.income / 12.0;
      const yrs = rngUniform(s, +params['years-in-dwelling-min'], +params['years-in-dwelling-max']);
      u.queue_draw = rngRandom(s);
      u.horizon = netlogoInt(netlogoRound(yrs * 12.0));
      u.tax_left = Math.max(0.0, 0.25 * (u.income - 10000.0));                     // PLACEHOLDER flat tax + allowance
      u.unit_done = false; u.shared_paid = false; u.supporter = false;
      u.complete = false; u.paid_any = false;
      u.saving_frac = 0.0; u.paid_price = 0.0; u.paid_base = 0.0; u.cash_net = 0.0;
      u.needs_shared = false; u.unit_base = 0.0; u.shared_base = 0.0;
      u.quintile = 0; u.free_hours = 0.0; u.bidx = k;
      u.retrofit_share = 0.0; u.shared_pending = false; u.b_tenure = ['owner_occupied', 'condo', 'rental'].indexOf(scene.tenure[k]);
    }
  }
}

// ;; to compute-quintiles  — rank of income over ALL units in the scene (rental included); ties by unit id
const byWho = (a: AnyAgent, b: AnyAgent) => a.who - b.who;
const computeQuintiles = (agents: AnyAgent[]) => {
  const order = agents.slice().sort((a, b) => (a.income - b.income) || (a.who - b.who));
  const n = order.length;
  order.forEach((u, rank) => { u.quintile = Math.min(5, 1 + Math.trunc((rank * 5) / n)); });
};

// ;; to compute-free-hours  — PLACEHOLDER: long hours at both ends of the income scale
const FREE_BASE = [42.0, 38.0, 36.0, 40.0, 48.0];
const computeFreeHours = (params: Record<string, any>, agents: AnyAgent[], seed: number) => {
  for (const u of agents.slice().sort(byWho)) {
    const base = Math.max(0.0, 112.0 - 50.0 - FREE_BASE[u.quintile - 1]);
    const spread = 1.0 + +params['free-time-spread'] * (2.0 * hashUniform(seed, u.who, 1073741825) - 1.0);
    u.free_hours = Math.max(0.0, base * spread);
  }
};

// ;; to prepare-costs
const prepareCosts = (params: Record<string, any>, scene: SceneBuild, byBuilding: AnyAgent[][]) => {
  for (let k = 0; k < scene.nu.length; k++) {
    const floorv = scene.floor[k];
    const sharedTotal = +params['shared-share'] * +params['cost-per-m2'] * floorv;
    for (const u of byBuilding[k]) {
      u.needs_shared = scene.needsShared[k];
      if (u.needs_shared) {
        u.unit_base = u.area * +params['cost-per-m2'] * (1.0 - +params['shared-share']);
        u.shared_base = (sharedTotal * u.area) / floorv;
      } else {
        u.unit_base = u.area * +params['cost-per-m2'];
      }
    }
  }
};

// =============================================================================
// The model spec
// =============================================================================

export default defineModel({
  title: 'The Great Retrofit v3 — Jette',
  time: { unit: 'months', horizon: 360 },
  world: { minPxcor: 0, maxPxcor: 24, minPycor: 0, maxPycor: 15 },
  params: {
    seed: { type: 'integer', min: 0, max: 999, step: 1, default: 0, tier: 'assumption', label: 'seed', help: 'population draw seed (model PRNG)' },
    'scene-seed': { type: 'integer', min: 0, max: 999, step: 1, default: 0, tier: 'assumption', label: 'scene-seed', help: 'scene derivation seed' },
    'n-buildings': { type: 'integer', min: 1, max: 10000, step: 1, default: 8105, tier: 'structural', label: 'n-buildings', help: 'synthetic path only; world mode derives the scene from the OSM dwellings (8,105)' },
    'horizon-months': { type: 'integer', min: 12, max: 360, step: 12, default: 360, tier: 'assumption', label: 'horizon-months', unit: 'months', help: 'simulation length and consideration horizon (world doubles the 180 default to 360)' },
    'delivery-mode': { type: 'choice', values: [{ value: 'rebate_market' }, { value: 'passthrough' }, { value: 'public_service' }], default: 'rebate_market', tier: 'lever', label: 'delivery-mode' },
    'credit-access': { type: 'choice', values: [{ value: 'income_tested' }, { value: 'open' }, { value: 'none' }], default: 'income_tested', tier: 'lever', label: 'credit-access' },
    'energy-scenario': { type: 'choice', values: [{ value: 'flat' }, { value: 'rising' }, { value: 'shock' }], default: 'rising', tier: 'assumption', label: 'energy-scenario' },
    'refundable?': { type: 'boolean', default: false, tier: 'lever', label: 'refundable?', help: 'rebates not capped by remaining tax capacity' },
    'means-test?': { type: 'boolean', default: false, tier: 'lever', label: 'means-test?' },
    'means-test-max-quintile': { type: 'integer', min: 1, max: 5, step: 1, default: 2, tier: 'lever', label: 'means-test-max-quintile' },
    'shared-measure?': { type: 'boolean', default: true, tier: 'lever', label: 'shared-measure?' },
    'peer-effect?': { type: 'boolean', default: true, tier: 'assumption', label: 'peer-effect?' },
    'deduction-rate': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.3, tier: 'lever', label: 'deduction-rate', unit: 'share' },
    'rebate-lag-months': { type: 'integer', min: 0, max: 36, step: 1, default: 12, tier: 'lever', label: 'rebate-lag-months', unit: 'months' },
    'loan-rate': { type: 'number', min: 0, max: 0.2, step: 0.001, default: 0.04, tier: 'lever', label: 'loan-rate', unit: 'p.a.' },
    'loan-rate-risk-premium': { type: 'number', min: 0, max: 0.1, step: 0.001, default: 0.02, tier: 'lever', label: 'loan-rate-risk-premium', unit: 'p.a.' },
    'vendor-margin': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.15, tier: 'lever', label: 'vendor-margin', unit: 'share' },
    'public-overhead': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.1, tier: 'lever', label: 'public-overhead', unit: 'share' },
    'public-capacity': { type: 'number', min: 0, max: 0.2, step: 0.005, default: 0.05, tier: 'lever', label: 'public-capacity', unit: 'share of units / year' },
    'shared-share': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.4, tier: 'lever', label: 'shared-share', unit: 'share of cost' },
    'vote-threshold': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.67, tier: 'lever', label: 'vote-threshold', unit: 'floor-area share' },
    'consider-prob-base': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.05, tier: 'assumption', label: 'consider-prob-base', unit: '/month' },
    'neighbour-boost': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.3, tier: 'assumption', label: 'neighbour-boost' },
    'free-time-spread': { type: 'number', min: 0, max: 1, step: 0.05, default: 0.3, tier: 'assumption', label: 'free-time-spread' },
    'canvass-target-hours': { type: 'number', min: 0, max: 6, step: 0.5, default: 2.0, tier: 'assumption', label: 'canvass-target-hours', unit: 'h / week' },
    'canvass-boost': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.2, tier: 'assumption', label: 'canvass-boost' },
    'canvass-saturation-hours': { type: 'number', min: 1, max: 12, step: 0.5, default: 6.0, tier: 'assumption', label: 'canvass-saturation-hours', unit: 'h / week' },
    'cost-per-m2': { type: 'number', min: 50, max: 1000, step: 10, default: 300, tier: 'lever', label: 'cost-per-m2', unit: '€ / m2' },
    'saving-per-m2-year': { type: 'number', min: 1, max: 100, step: 1, default: 20, tier: 'assumption', label: 'saving-per-m2-year', unit: '€ / m2 / year' },
    'discount-rate': { type: 'number', min: 0, max: 0.2, step: 0.001, default: 0.04, tier: 'assumption', label: 'discount-rate', unit: 'p.a.' },
    'loan-term-months': { type: 'integer', min: 12, max: 360, step: 12, default: 120, tier: 'lever', label: 'loan-term-months', unit: 'months' },
    'credit-income-threshold': { type: 'number', min: 0, max: 100000, step: 1000, default: 25000, tier: 'lever', label: 'credit-income-threshold', unit: '€ / year' },
    'credit-loan-to-income': { type: 'number', min: 0, max: 3, step: 0.1, default: 1.0, tier: 'lever', label: 'credit-loan-to-income' },
    'savings-scale': { type: 'number', min: 0, max: 3, step: 0.1, default: 1.0, tier: 'assumption', label: 'savings-scale' },
    'savings-usable-share': { type: 'number', min: 0, max: 1, step: 0.05, default: 1.0, tier: 'assumption', label: 'savings-usable-share', unit: 'share' },
    'savings-months-of-income': { type: 'number', min: 0, max: 12, step: 0.5, default: 3.0, tier: 'assumption', label: 'savings-months-of-income', unit: 'months' },
    'years-in-dwelling-min': { type: 'integer', min: 1, max: 25, step: 1, default: 5, tier: 'assumption', label: 'years-in-dwelling-min', unit: 'years' },
    'years-in-dwelling-max': { type: 'integer', min: 1, max: 40, step: 1, default: 25, tier: 'assumption', label: 'years-in-dwelling-max', unit: 'years' },
    'rental-share-single': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.1, tier: 'assumption', label: 'rental-share-single', unit: 'share' },
    'rental-share-multi': { type: 'number', min: 0, max: 1, step: 0.01, default: 0.3, tier: 'assumption', label: 'rental-share-multi', unit: 'share' },
  },
  turtlesOwn: {
    bidx: 'i32', b_tenure: 'i32',
    area: 'f64', income: 'f64', savings: 'f64', horizon: 'i32', queue_draw: 'f64', quintile: 'i32',
    free_hours: 'f64', tax_left: 'f64', unit_base: 'f64', shared_base: 'f64',
    needs_shared: 'bool', unit_done: 'bool', shared_paid: 'bool', supporter: 'bool',
    complete: 'bool', paid_any: 'bool', saving_frac: 'f64', paid_price: 'f64', paid_base: 'f64', cash_net: 'f64',
    retrofit_share: 'f64', shared_pending: 'bool',
  },
  breeds: {
    households: { kind: 'anchored', layer: 'buildings', own: { anchor: 'i32' }, categories: { b_tenure: ['owner_occupied', 'condo', 'rental'] }, frame: ['bidx', 'b_tenure', 'quintile', 'area', 'income', 'savings', 'horizon', 'saving_frac', 'complete', 'unit_done', 'shared_paid', 'supporter', 'paid_any', 'cash_net', 'paid_price', 'retrofit_share', 'shared_pending'], label: 'Households (one per unit)' },
  },
  // =============================================================================
  // Setup
  // =============================================================================
  setup(m: Ctx) {
    // ;; to setup  — clear-all, reset-ticks, build-scene, draw-population, u-by-b,
    // ;; compute-quintiles, compute-free-hours, prepare-costs, aggregates, compute-series-metrics
    const params = m.params;
    const seed = +params['seed'];
    const s: RunState = {
      rngState: netlogoMod(seed, TWO32),
      bTenure: [], bNu: [], bFloor: [], bNeedsShared: [], bApproved: [], bAdopted: [], bAreas: [],
      uByB: [], nUnits: 0, nBuildings: 0, anchors: [], agents: [], byBuilding: [],
      publicCost: 0.0, billsSaved: 0.0, priceSum: 0.0, baseSum: 0.0,
      nComplete: 0, votesPassed: 0, unitsCannotFront: 0,
      qTotal: [0, 0, 0, 0, 0], qPrice: [0.0, 0.0, 0.0, 0.0, 0.0], qTrans: [0.0, 0.0, 0.0, 0.0, 0.0], qAdopt: [0, 0, 0, 0, 0],
      carry: 0.0, quota: 0.0,
      pending: [], mDiscount: 0.0, mGrowth: 0.0,
      adoptionByQuintile: [0, 0, 0, 0, 0], rebatePerEuro: [NaN, NaN, NaN, NaN, NaN], canFrontCost: [NaN, NaN, NaN, NaN, NaN],
      costPerRetrofit: NaN, costPartsBase: NaN, costPartsMarkup: NaN,
      canvassHours: [0, 0, 0, 0, 0], leisureHours: [0, 0, 0, 0, 0], netCashByQuintile: [NaN, NaN, NaN, NaN, NaN],
      sharedPending: 0, sharedApproved: 0,
      stateNotRetrofitted: 0, statePartial: 0, stateRetrofitted: 0, stateNotModelled: 0,
      tenureOwner: 0, tenureCondo: 0, tenureRental: 0,
      loans: [],
    };
    STATES.set(m, s);
    const scene = buildScene(s, params, (m as any).world ?? null);
    s.bTenure = scene.tenure; s.bNu = scene.nu; s.bFloor = scene.floor; s.bNeedsShared = scene.needsShared;
    s.bApproved = scene.tenure.map(() => false); s.bAdopted = scene.tenure.map(() => 0);
    s.bAreas = scene.areas; s.anchors = scene.anchors; s.nBuildings = scene.tenure.length;
    // ;; draw-population (unit order); one anchored agent per unit, anchor = layer index
    const created: AnyAgent[] = [];
    drawPopulation(s, params, scene, (k, i) => {
      let u: AnyAgent = null as any;
      m.createTurtles(m.breeds['households'], 1, (t: AnyAgent) => {
        t.anchor = scene.anchors[k];
        u = t;
      });
      created.push(u);
      return u;
    });
    // ;; set u-by-b (map … (range n-buildings)) — unit order preserved
    s.uByB = scene.tenure.map(() => []);
    for (const u of created) s.uByB[u.bidx].push(u.i as unknown as number);
    s.nUnits = created.length;
    s.loans = new Array(created.length + 1).fill(null).map(() => []);
    // agents sorted by who for all ordered iteration
    const agents = created.slice().sort(byWho);
    computeQuintiles(agents);
    computeFreeHours(params, agents, seed);
    const byBuildingAgents = s.uByB.map((slots) => slots.map((i) => created[i]) as AnyAgent[]);
    prepareCosts(params, scene, byBuildingAgents);
    s.agents = agents;
    s.byBuilding = scene.tenure.map((_, k) => byBuildingAgents[k]);
    // ;; aggregates (q-total …)
    for (const u of agents) s.qTotal[u.quintile - 1] += 1;
    s.quota = +params['public-capacity'] * s.nUnits / 12.0;
    s.carry = 0.0;
    s.mDiscount = monthlyRate(+params['discount-rate']);
    s.mGrowth = monthlyRate(energyGrowthAnnual(params));
    computeSeriesMetrics(s, params, agents);
    writeBuildingConstants(s, s.byBuilding);
    m.resetTicks();
  },

  // =============================================================================
  // One month (one tick)
  // =============================================================================
  go(m: Ctx) {
    // ;; to go  — if ticks >= horizon-months [ stop ]; t = ticks; level = (1 + m-growth) ^ t
    const s = st(m);
    const params = m.params;
    const t = m.ticks;
    if (t >= +params['horizon-months']) return false;
    const level = Math.pow(1.0 + s.mGrowth, t);
    // --- 1. cash arriving and leaving
    cashPhase(s, t);
    // bills saved accrue (only while the household expects to stay)
    for (const u of s.agents) {
      if (u.saving_frac > 0.0 && t < u.horizon) {
        const bill = u.area * +params['saving-per-m2-year'] / 12.0 * u.saving_frac * level;
        s.billsSaved += bill;
        u.cash_net += bill;
      }
    }
    // --- 2. snapshot: adoption shares and canvassing pressure read as they stood at the start of the month
    const adoptedSnap = s.bAdopted.slice();
    const canvTot = new Array(s.nBuildings).fill(0.0);
    for (const u of s.agents) {
      canvTot[u.bidx] += spendOf(params, u, s.bTenure[u.bidx], s.bNu[u.bidx]);
    }
    // --- 3. considerations
    let candidates: Evaluation[] = [];
    const seed = +params['seed'];
    for (const u of s.agents) {
      const bi = u.bidx;
      if (!u.complete && ownershipCanAdopt(s.bTenure[bi]) && t < u.horizon) {
        const mySpend = spendOf(params, u, s.bTenure[bi], s.bNu[bi]);
        const others = Math.max(0.0, canvTot[bi] - mySpend);
        const pressure = Math.min(1.0, others / +params['canvass-saturation-hours']);
        const adoptFrac = s.bNu[bi] > 0 ? adoptedSnap[bi] / s.bNu[bi] : 0.0;
        const base = +params['consider-prob-base'];
        let prob = base;
        if (s.bTenure[bi] === 'condo') {
          const nb = params['peer-effect?'] ? +params['neighbour-boost'] : 0.0;
          prob = Math.min(1.0, base + nb * adoptFrac + +params['canvass-boost'] * pressure);
        }
        const draw = hashUniform(seed, u.who, t);
        if (draw < prob) {
          // (a) own part: NPV and financing must both pass
          if (!u.unit_done) {
            const frac = u.needs_shared ? 1.0 - +params['shared-share'] : 1.0;
            const kind = u.needs_shared ? 'unit' : 'whole';
            const ev = evaluateAt(s, params, u, u.unit_base, frac, t, level, kind);
            if (ev !== false && ev.npv > 0.0) candidates.push(ev);
          }
          // (b) shared measure: support it (permanent) if your share works
          if (s.bNeedsShared[bi] && !s.bApproved[bi] && !u.supporter) {
            const ev = evaluateAt(s, params, u, u.shared_base, +params['shared-share'], t, level, 'shared');
            if (ev !== false && ev.npv > 0.0) u.supporter = true;
          }
        }
      }
    }
    // --- 4. public-service capacity, then payment
    let slotsLeft = -1;                                     // -1 = not applicable (not public_service)
    if (params['delivery-mode'] === 'public_service') {
      const slots = Math.trunc(s.quota + s.carry);          // \ int — whole slots per month; remainder carried
      s.carry = s.quota + s.carry - slots;
      const capLim = candidates.filter((c) => c.capacityLimited);
      const sorted = capLim.slice().sort((a, b) => (a.u.queue_draw - b.u.queue_draw) || (a.u.who - b.u.who));
      const nallow = Math.min(slots, sorted.length);
      const allowed = new Set(sorted.slice(0, nallow).map((c) => c.u as AnyAgent));
      candidates = candidates.filter((c) => !c.capacityLimited || allowed.has(c.u));
      slotsLeft = slots - nallow;
    }
    for (const c of candidates) payPart(s, params, c, t);
    // --- 5. shared-measure votes
    for (let bi = 0; bi < s.nBuildings; bi++) {
      if (!(s.bNeedsShared[bi] && !s.bApproved[bi])) continue;
      const floorv = s.bFloor[bi];
      let yes = 0.0;
      for (const u of s.byBuilding[bi]) if (u.supporter) yes += u.area;
      const yesShare = floorv > 0.0 ? yes / floorv : 0.0;
      if (yesShare + 1e-9 >= +params['vote-threshold']) {
        let need = 0, fits = true;
        if (slotsLeft !== -1) {
          need = Math.ceil(s.bNu[bi] * +params['shared-share'] - 1e-9);
          if (need > slotsLeft) fits = false;
        }
        if (fits) {
          const evs: { u: AnyAgent; ev: Evaluation }[] = [];
          let blocked = false;
          for (const u of s.byBuilding[bi]) {               // every owner must be able to finance their share
            if (blocked) break;
            const evl = evaluateAt(s, params, u, u.shared_base, +params['shared-share'], t, level, 'shared');
            if (evl === false) blocked = true; else evs.push({ u, ev: evl });
          }
          if (!blocked) {                                   // the measure passes
            s.bApproved[bi] = true;
            if (slotsLeft !== -1) slotsLeft -= need;
            s.votesPassed += 1;
            for (const { ev } of evs) payPart(s, params, ev, t);
          }
        }
      }
    }
    m.tick();
    // ;; color-buildings / refresh-plots — the renderer and the framework do this
    computeSeriesMetrics(s, params, s.agents);
    writeBuildingConstants(s, s.byBuilding);
  },
  plots: {
    adoption: { label: 'Adoption by quintile', unit: 'share', pens: {
      Q1: (m: Ctx) => st(m).adoptionByQuintile[0], Q2: (m: Ctx) => st(m).adoptionByQuintile[1],
      Q3: (m: Ctx) => st(m).adoptionByQuintile[2], Q4: (m: Ctx) => st(m).adoptionByQuintile[3],
      Q5: (m: Ctx) => st(m).adoptionByQuintile[4] } },
    state: { label: 'State spend (cumulative)', unit: 'euros', pens: {
      'public cost': (m: Ctx) => st(m).publicCost } },
    bills: { label: 'Bills saved (cumulative)', unit: 'euros', pens: {
      'bills saved': (m: Ctx) => st(m).billsSaved } },
    cost: { label: 'Cost per retrofit', unit: 'euros', pens: {
      price: (m: Ctx) => st(m).costPerRetrofit } },
    'can-front': { label: 'Can front cost by quintile', unit: 'share', pens: {
      Q1: (m: Ctx) => st(m).canFrontCost[0], Q2: (m: Ctx) => st(m).canFrontCost[1],
      Q3: (m: Ctx) => st(m).canFrontCost[2], Q4: (m: Ctx) => st(m).canFrontCost[3],
      Q5: (m: Ctx) => st(m).canFrontCost[4] } },
    'rebate-per-euro': { label: 'Rebate per euro by quintile', unit: 'ratio', pens: {
      Q1: (m: Ctx) => st(m).rebatePerEuro[0], Q2: (m: Ctx) => st(m).rebatePerEuro[1],
      Q3: (m: Ctx) => st(m).rebatePerEuro[2], Q4: (m: Ctx) => st(m).rebatePerEuro[3],
      Q5: (m: Ctx) => st(m).rebatePerEuro[4] } },
    'net-cash': { label: 'Net cash by quintile', unit: 'euros', pens: {
      Q1: (m: Ctx) => st(m).netCashByQuintile[0], Q2: (m: Ctx) => st(m).netCashByQuintile[1],
      Q3: (m: Ctx) => st(m).netCashByQuintile[2], Q4: (m: Ctx) => st(m).netCashByQuintile[3],
      Q5: (m: Ctx) => st(m).netCashByQuintile[4] } },
    'canvass-hours': { label: 'Canvass hours by quintile', unit: 'hours / week', pens: {
      Q1: (m: Ctx) => st(m).canvassHours[0], Q2: (m: Ctx) => st(m).canvassHours[1],
      Q3: (m: Ctx) => st(m).canvassHours[2], Q4: (m: Ctx) => st(m).canvassHours[3],
      Q5: (m: Ctx) => st(m).canvassHours[4] } },
    'leisure-hours': { label: 'Leisure hours by quintile', unit: 'hours / week', pens: {
      Q1: (m: Ctx) => st(m).leisureHours[0], Q2: (m: Ctx) => st(m).leisureHours[1],
      Q3: (m: Ctx) => st(m).leisureHours[2], Q4: (m: Ctx) => st(m).leisureHours[3],
      Q5: (m: Ctx) => st(m).leisureHours[4] } },
  },
  monitors: {
    month: { label: 'month', unit: 'months', value: (m: Ctx) => m.ticks },
    adopted: { label: 'adopted units', unit: 'units', value: (m: Ctx) => st(m).nComplete },
    publicCost: { label: 'public cost', unit: 'euros', value: (m: Ctx) => st(m).publicCost },
    billsSaved: { label: 'bills saved', unit: 'euros', value: (m: Ctx) => st(m).billsSaved },
    costPerRetrofit: { label: 'cost per retrofit', unit: 'euros', value: (m: Ctx) => st(m).costPerRetrofit },
    costPartsBase: { label: 'cost parts — base', unit: 'euros', value: (m: Ctx) => st(m).costPartsBase },
    costPartsMarkup: { label: 'cost parts — markup', unit: 'euros', value: (m: Ctx) => st(m).costPartsMarkup },
    tenureOwner: { label: 'tenures — owner-occupied', unit: 'buildings', value: (m: Ctx) => st(m).tenureOwner },
    tenureCondo: { label: 'tenures — condo', unit: 'buildings', value: (m: Ctx) => st(m).tenureCondo },
    tenureRental: { label: 'tenures — rental', unit: 'buildings', value: (m: Ctx) => st(m).tenureRental },
    stateNotRetrofitted: { label: 'building states — no retrofit', unit: 'buildings', value: (m: Ctx) => st(m).stateNotRetrofitted },
    statePartial: { label: 'building states — partial', unit: 'buildings', value: (m: Ctx) => st(m).statePartial },
    stateRetrofitted: { label: 'building states — done', unit: 'buildings', value: (m: Ctx) => st(m).stateRetrofitted },
    stateNotModelled: { label: 'building states — rental (not modelled)', unit: 'buildings', value: (m: Ctx) => st(m).stateNotModelled },
    sharedPending: { label: 'shared measures pending', unit: 'buildings', value: (m: Ctx) => st(m).sharedPending },
    sharedApproved: { label: 'shared measures approved', unit: 'buildings', value: (m: Ctx) => st(m).sharedApproved },
    votesPassed: { label: 'shared-measure votes passed', unit: 'votes', value: (m: Ctx) => st(m).votesPassed },
  },
});

// =============================================================================
// Payment and cash handling (NetLogo: pay-part, cash-phase)
// =============================================================================
function cashPhase(s: RunState, t: number) {   // ;; to cash-phase [t]
  const due = s.pending.filter((p) => p[0] === t);
  s.pending = s.pending.filter((p) => p[0] !== t);
  for (const [, u, amount] of due) { s.publicCost += amount; u.cash_net += amount; }
  for (const u of s.agents) {
    for (const l of s.loans[u.i as unknown as number]) if (t <= l.last) u.cash_net -= l.pay;
  }
}

function payPart(s: RunState, params: Record<string, any>, rec: Evaluation, t: number) {  // ;; to pay-part [rec t]
  const u = rec.u;
  s.publicCost += rec.statePaysNow;
  if (rec.rebate > 0.0) {
    if (rec.rebateLag === 0) { s.publicCost += rec.rebate; u.cash_net += rec.rebate; }       // lag 0: paid in the month of the retrofit
    else s.pending.push([t + rec.rebateLag, u, rec.rebate]);                                  // lag >= 1: arrives in phase 1 of month t + lag
  }
  const k = u.quintile - 1;
  s.qPrice[k] += rec.price;
  s.qTrans[k] += rec.statePaysNow + rec.rebate;
  u.savings -= rec.fromSavings;
  u.cash_net -= rec.fromSavings;
  u.tax_left = Math.max(0.0, u.tax_left - rec.rebate);
  if (rec.loan > 0.0) {
    const term = +params['loan-term-months'];
    s.loans[u.i as unknown as number].push({ pay: loanPayment(rec.loan, rec.rate, term), last: t + term });
  }
  u.paid_any = true;
  u.paid_price += rec.price;
  u.paid_base += rec.base;
  u.saving_frac += rec.frac;
  if (rec.kind === 'shared') u.shared_paid = true; else u.unit_done = true;
  if (u.unit_done && (u.shared_paid || !u.needs_shared) && !u.complete) {
    u.complete = true;
    const b = u.bidx;
    s.bAdopted[b] += 1;
    s.qAdopt[k] += 1;
    s.priceSum += u.paid_price;
    s.baseSum += u.paid_base;
    s.nComplete += 1;
  }
}

// =============================================================================
// Metrics (NetLogo: compute-series-metrics) + building-constant frame fields
// =============================================================================
const frontFeasible = (params: Record<string, any>, u: AnyAgent, upfront: number): boolean => {  // ;; to-report front-feasible? [u upfront]
  const plan = planFinancing(upfront, u.savings, creditLimitOf(params, u.income), +params['savings-usable-share']);
  return plan.feasible;
};

function computeSeriesMetrics(s: RunState, params: Record<string, any>, agents: AnyAgent[]) {        // ;; to compute-series-metrics
  // adoption by quintile (rental units in the denominator)
  s.adoptionByQuintile = s.qAdopt.map((a, i) => (s.qTotal[i] > 0 ? a / s.qTotal[i] : 0.0));
  // rebate per euro of price, by quintile (NaN = no data)
  s.rebatePerEuro = s.qTrans.map((tr, i) => (s.qPrice[i] > 0 ? tr / s.qPrice[i] : NaN));
  // can this quintile's not-yet-retrofitted, modelled units front the remaining cost now?
  const frontOk = [0, 0, 0, 0, 0], frontTot = [0, 0, 0, 0, 0];
  s.unitsCannotFront = 0;
  for (const u of agents) {
    if (u.complete || !ownershipCanAdopt(s.bTenure[u.bidx])) continue;
    const remaining = (u.unit_done ? 0.0 : u.unit_base) + ((u.needs_shared && !u.shared_paid) ? u.shared_base : 0.0);
    const q = quoteOf(params, u, remaining);
    const ok = !q.financing || frontFeasible(params, u, q.upfront);
    const k = u.quintile - 1;
    frontTot[k] += 1;
    if (ok) frontOk[k] += 1; else s.unitsCannotFront += 1;
  }
  s.canFrontCost = frontOk.map((ok, i) => (frontTot[i] > 0 ? ok / frontTot[i] : NaN));
  // cost per retrofit (NaN = none yet); base + markup = cost per retrofit
  s.costPerRetrofit = s.nComplete > 0 ? s.priceSum / s.nComplete : NaN;
  s.costPartsBase = s.nComplete > 0 ? s.baseSum / s.nComplete : NaN;
  s.costPartsMarkup = s.nComplete > 0 ? (s.priceSum - s.baseSum) / s.nComplete : NaN;
  // canvassing and leisure hours per quintile; net cash over households that paid
  const canvSums = [0.0, 0.0, 0.0, 0.0, 0.0], leisSums = [0.0, 0.0, 0.0, 0.0, 0.0];
  const cashSums = [0.0, 0.0, 0.0, 0.0, 0.0], cashN = [0, 0, 0, 0, 0];
  for (const u of agents) {
    const k = u.quintile - 1;
    const spend = spendOf(params, u, s.bTenure[u.bidx], s.bNu[u.bidx]);
    canvSums[k] += spend;
    leisSums[k] += u.free_hours - spend;
    if (u.paid_any) { cashSums[k] += u.cash_net; cashN[k] += 1; }
  }
  s.canvassHours = canvSums.map((x, i) => (s.qTotal[i] > 0 ? x / s.qTotal[i] : 0.0));
  s.leisureHours = leisSums.map((x, i) => (s.qTotal[i] > 0 ? x / s.qTotal[i] : 0.0));
  s.netCashByQuintile = cashSums.map((x, i) => (cashN[i] > 0 ? x / cashN[i] : NaN));
  // shared-measure counts
  s.sharedPending = 0; s.sharedApproved = 0;
  for (let bi = 0; bi < s.nBuildings; bi++) {
    if (s.bNeedsShared[bi]) { if (s.bApproved[bi]) s.sharedApproved += 1; else s.sharedPending += 1; }
  }
  // building states and tenure counts
  s.stateNotRetrofitted = 0; s.statePartial = 0; s.stateRetrofitted = 0; s.stateNotModelled = 0;
  s.tenureOwner = 0; s.tenureCondo = 0; s.tenureRental = 0;
  for (let bi = 0; bi < s.nBuildings; bi++) {
    if (!ownershipCanAdopt(s.bTenure[bi])) s.stateNotModelled += 1;
    else if (s.bAdopted[bi] === 0) s.stateNotRetrofitted += 1;
    else if (s.bAdopted[bi] < s.bNu[bi]) s.statePartial += 1;
    else s.stateRetrofitted += 1;
    if (s.bTenure[bi] === 'owner_occupied') s.tenureOwner += 1;
    else if (s.bTenure[bi] === 'condo') s.tenureCondo += 1;
    else s.tenureRental += 1;
  }
}

// Building-level frame constants: retrofit_share (b-adopted / b-nuits) and shared_pending — constant per building
function writeBuildingConstants(s: RunState, byBuilding: AnyAgent[][]) {
  for (let bi = 0; bi < s.nBuildings; bi++) {
    const share = s.bNu[bi] > 0 ? s.bAdopted[bi] / s.bNu[bi] : 0.0;
    const pending = s.bNeedsShared[bi] && !s.bApproved[bi];
    for (const u of byBuilding[bi]) { u.retrofit_share = share; u.shared_pending = pending; }
  }
}
