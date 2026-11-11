// Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
// @paperdolls/agents core: a NetLogo-shaped agent library over struct-of-arrays storage (v1, task 1.2; grown from spike 0b).
//
// NetLogo semantics kept, each black-box tested against NetLogo 7.0.4 (test/netlogo.test.ts):
//   ask visits a snapshot in a fresh random order; agents that die first are skipped, agents born during it are not visited; die() ends
//   that agent's block at once, also from nested procedures; hatch copies every turtle variable and runs its block on the child; headings are
//   degrees clockwise from north; the world wraps (or not, per axis) and distances, headings and radii take the short way round; a point's
//   patch is the one whose centre is nearest (a patch spans [p - 0.5, p + 0.5)); diffuse shares among eight neighbours and keeps the shares
//   of missing ones; list statistics use the sample variance.
// The random stream is the library's own (plan D9): the same seed gives the same run, not NetLogo's run.

export type VarType = 'f64' | 'i32' | 'bool';
type Col = Float64Array | Int32Array | Uint8Array;
export type Schema = Record<string, VarType>;
export type AnyAgent = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const COLOR = { black: 0, gray: 5, white: 9.9, red: 15, orange: 25, brown: 35, yellow: 45, green: 55, lime: 65, turquoise: 75, cyan: 85, sky: 95, blue: 105, violet: 115, magenta: 125, pink: 135 } as const;

class Die extends Error {}
const DIE = new Die('die');

// ---------- random numbers: mulberry32, the generator the lab's models already share ----------
export class Random {
  private s: number;
  private spare: number | null = null;
  constructor(seed: number) { this.s = seed >>> 0; }
  float(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** NetLogo `random n`: an integer in [0, n) for n > 0, (n, 0] for n < 0, 0 for 0. A non-integer is truncated first. */
  int(n: number): number { n = Math.trunc(n); if (n === 0) return 0; return n > 0 ? Math.floor(this.float() * n) : -Math.floor(this.float() * -n); }
  /** NetLogo `random-float x`. */
  real(x: number): number { return this.float() * x; }
  /** NetLogo `random-normal mean sd` (Marsaglia polar method). */
  normal(mean: number, sd: number): number {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return mean + sd * v; }
    let u, v, s;
    do { u = this.float() * 2 - 1; v = this.float() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s); this.spare = v * m; return mean + sd * u * m;
  }
  /** NetLogo `random-poisson mean`. */
  poisson(mean: number): number {
    if (mean < 30) { const L = Math.exp(-mean); let k = 0, p = 1; do { k++; p *= this.float(); } while (p > L); return k - 1; }
    const v = Math.round(this.normal(mean, Math.sqrt(mean))); return Math.max(0, v);           // large means: the normal approximation
  }
  /** NetLogo `random-exponential mean`. */
  exponential(mean: number): number { return -mean * Math.log(1 - this.float()); }
  shuffle(a: Int32Array, n: number): void { for (let i = n - 1; i > 0; i--) { const j = Math.floor(this.float() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } }
}

export interface Breed { readonly name: string; readonly id: number }
export interface LinkBreed { readonly name: string; readonly id: number; readonly directed: boolean }
export type Kind = 'turtle' | 'patch' | 'link';

/** An agentset: a snapshot of slots, with the ids they held (so a reused slot is not mistaken for the old agent). */
export class AgentSet {
  readonly kind: Kind; readonly ids: Int32Array; readonly gens: Float64Array | null; readonly n: number;
  constructor(kind: Kind, ids: Int32Array, gens: Float64Array | null, n: number) { this.kind = kind; this.ids = ids; this.gens = gens; this.n = n; }
}

export interface WorldOptions { minPxcor: number; maxPxcor: number; minPycor: number; maxPycor: number; wrapX?: boolean; wrapY?: boolean; seed: number }

export function createAgentWorld(o: WorldOptions) {
  if (!(o.maxPxcor >= o.minPxcor && o.maxPycor >= o.minPycor)) throw new Error('world: max must not be below min');
  const W = o.maxPxcor - o.minPxcor + 1, H = o.maxPycor - o.minPycor + 1, NP = W * H;
  const wrapX = o.wrapX !== false, wrapY = o.wrapY !== false;
  const xmin = o.minPxcor - 0.5, xmax = o.maxPxcor + 0.5, ymin = o.minPycor - 0.5, ymax = o.maxPycor + 0.5;
  const rng = new Random(o.seed);
  const breeds: Breed[] = [], linkBreeds: LinkBreed[] = [];

  // ---- turtles (SoA). Columns grow by doubling; slots are reused after die.
  let cap = 1024, count = 0, nextWho = 0;
  const T = {
    alive: new Uint8Array(cap), breed: new Int16Array(cap), who: new Float64Array(cap),
    x: new Float64Array(cap), y: new Float64Array(cap), h: new Float64Array(cap),
    patch: new Int32Array(cap), next: new Int32Array(cap), prev: new Int32Array(cap),
  };
  const tcols: Record<string, Col> = {}, tschema: Schema = {};
  const free: number[] = []; let high = 0;
  const growT = () => { const nc = cap * 2; for (const k of Object.keys(T) as (keyof typeof T)[]) { const a = T[k], b = new (a.constructor as any)(nc); b.set(a); (T as any)[k] = b; } for (const k of Object.keys(tcols)) { const a = tcols[k], b = new (a.constructor as any)(nc); b.set(a); tcols[k] = b; } cap = nc; };

  // ---- patches (SoA) and the per-patch list of turtles
  const pcolor = new Float64Array(NP), pcols: Record<string, Col> = { pcolor }, pschema: Schema = { pcolor: 'f64' };
  const head = new Int32Array(NP).fill(-1);
  const pIndex = (px: number, py: number) => (py - o.minPycor) * W + (px - o.minPxcor);
  /** The patch containing (x, y), or -1 off a world that does not wrap. */
  const patchAtXY = (x: number, y: number): number => {
    if (wrapX) x = wrapC(x, xmin, xmax); else if (x < xmin || x >= xmax) return -1;
    if (wrapY) y = wrapC(y, ymin, ymax); else if (y < ymin || y >= ymax) return -1;
    let px = Math.round(x), py = Math.round(y);
    if (px > o.maxPxcor) px = wrapX ? o.minPxcor : o.maxPxcor; if (py > o.maxPycor) py = wrapY ? o.minPycor : o.maxPycor;   // x just under xmax rounds up
    return pIndex(px, py);
  };
  const link = (i: number, p: number) => { T.patch[i] = p; T.prev[i] = -1; T.next[i] = head[p]; if (head[p] >= 0) T.prev[head[p]] = i; head[p] = i; };
  const unlink = (i: number) => { const p = T.patch[i]; if (T.prev[i] >= 0) T.next[T.prev[i]] = T.next[i]; else head[p] = T.next[i]; if (T.next[i] >= 0) T.prev[T.next[i]] = T.prev[i]; };
  function wrapC(v: number, lo: number, hi: number) { const span = hi - lo; v = (v - lo) % span; if (v < 0) v += span; return v + lo; }
  /** The short way from a to b along an axis that may wrap. */
  const dX = (a: number, b: number) => { let d = b - a; if (wrapX) d -= W * Math.round(d / W); return d; };
  const dY = (a: number, b: number) => { let d = b - a; if (wrapY) d -= H * Math.round(d / H); return d; };

  // ---- links (SoA)
  let lcap = 256, lhigh = 0, nextLinkId = 0;
  const Lk = { alive: new Uint8Array(lcap), breed: new Int16Array(lcap), a: new Int32Array(lcap), b: new Int32Array(lcap), aw: new Float64Array(lcap), bw: new Float64Array(lcap), id: new Float64Array(lcap) };
  const lcols: Record<string, Col> = {}, lschema: Schema = {}, lfree: number[] = [];
  const growL = () => { const nc = lcap * 2; for (const k of Object.keys(Lk) as (keyof typeof Lk)[]) { const a = Lk[k], b = new (a.constructor as any)(nc); b.set(a); (Lk as any)[k] = b; } for (const k of Object.keys(lcols)) { const a = lcols[k], b = new (a.constructor as any)(nc); b.set(a); lcols[k] = b; } lcap = nc; };

  const colFor = (t: VarType, n: number): Col => t === 'f64' ? new Float64Array(n) : t === 'i32' ? new Int32Array(n) : new Uint8Array(n);
  const prop = (cols: Record<string, Col>, k: string, t: VarType): PropertyDescriptor => t === 'bool'
    ? { get(this: AnyAgent) { return cols[k][this.i] === 1; }, set(this: AnyAgent, v: boolean) { cols[k][this.i] = v ? 1 : 0; } }
    : { get(this: AnyAgent) { return cols[k][this.i]; }, set(this: AnyAgent, v: number) { cols[k][this.i] = v; } };

  // ---- cursors: an object bound to a slot, with getters and setters straight onto the columns (no allocation per agent visited)
  let TP: AnyAgent = null, PP: AnyAgent = null, LP: AnyAgent = null;
  const tcur = (i: number) => { if (!TP) build(); const c = Object.create(TP); c.i = i; return c; };
  const pcur = (i: number) => { if (!PP) build(); const c = Object.create(PP); c.i = i; return c; };
  const lcur = (i: number) => { if (!LP) build(); const c = Object.create(LP); c.i = i; return c; };
  const xyOf = (a: AnyAgent): [number, number] => a.kind === 'patch' ? [(a.i % W) + o.minPxcor, Math.floor(a.i / W) + o.minPycor] : [T.x[a.i], T.y[a.i]];
  function build() {
    TP = {
      kind: 'turtle',
      get who() { return T.who[this.i]; }, get breed() { return breeds[T.breed[this.i]]; },
      get xcor() { return T.x[this.i]; }, set xcor(v: number) { setxy(this.i, v, T.y[this.i]); },
      get ycor() { return T.y[this.i]; }, set ycor(v: number) { setxy(this.i, T.x[this.i], v); },
      get heading() { return T.h[this.i]; }, set heading(v: number) { T.h[this.i] = norm(v); },
      get dx() { return Math.sin(T.h[this.i] * Math.PI / 180); }, get dy() { return Math.cos(T.h[this.i] * Math.PI / 180); },
      fd(d: number) { const i = this.i, r = T.h[i] * Math.PI / 180; setxy(i, T.x[i] + d * Math.sin(r), T.y[i] + d * Math.cos(r)); },
      bk(d: number) { this.fd(-d); },
      rt(a: number) { T.h[this.i] = norm(T.h[this.i] + a); }, lt(a: number) { T.h[this.i] = norm(T.h[this.i] - a); },
      setxy(x: number, y: number) { setxy(this.i, x, y); },
      moveTo(a: AnyAgent) { const [x, y] = xyOf(a); setxy(this.i, x, y); },
      towards(a: AnyAgent) { const [x, y] = xyOf(a); return towardsXY(T.x[this.i], T.y[this.i], x, y); },
      towardsxy(x: number, y: number) { return towardsXY(T.x[this.i], T.y[this.i], x, y); },
      face(a: AnyAgent) { const [x, y] = xyOf(a); if (dX(T.x[this.i], x) !== 0 || dY(T.y[this.i], y) !== 0) T.h[this.i] = towardsXY(T.x[this.i], T.y[this.i], x, y); },
      facexy(x: number, y: number) { if (dX(T.x[this.i], x) !== 0 || dY(T.y[this.i], y) !== 0) T.h[this.i] = towardsXY(T.x[this.i], T.y[this.i], x, y); },
      distance(a: AnyAgent) { const [x, y] = xyOf(a); return Math.hypot(dX(T.x[this.i], x), dY(T.y[this.i], y)); },
      distancexy(x: number, y: number) { return Math.hypot(dX(T.x[this.i], x), dY(T.y[this.i], y)); },
      die(): never { killT(this.i); throw DIE; },
      hatch(n: number, fn?: (c: AnyAgent) => void) { hatch(this.i, n, fn); },
      patchHere() { return pcur(T.patch[this.i]); },
      patchAt(dx: number, dy: number) { const p = patchAtXY(T.x[this.i] + dx, T.y[this.i] + dy); return p < 0 ? null : pcur(p); },
      patchAhead(d: number) { const r = T.h[this.i] * Math.PI / 180, p = patchAtXY(T.x[this.i] + d * Math.sin(r), T.y[this.i] + d * Math.cos(r)); return p < 0 ? null : pcur(p); },
      turtlesHere(b?: Breed) { return here(T.patch[this.i], b); },
      createLinkWith(t: AnyAgent, lb?: LinkBreed, fn?: (l: AnyAgent) => void) { makeLink(this.i, t.i, lb, false, fn); },
      createLinkTo(t: AnyAgent, lb?: LinkBreed, fn?: (l: AnyAgent) => void) { makeLink(this.i, t.i, lb, true, fn); },
      linkNeighbors() { return linkNbrs(this.i, 'undirected'); }, outLinkNeighbors() { return linkNbrs(this.i, 'out'); }, inLinkNeighbors() { return linkNbrs(this.i, 'in'); },
      myLinks() { return myLinks(this.i, 'undirected'); }, myOutLinks() { return myLinks(this.i, 'out'); }, myInLinks() { return myLinks(this.i, 'in'); },
    };
    for (const [k, t] of Object.entries(tschema)) Object.defineProperty(TP, k, prop(tcols, k, t));
    PP = {
      kind: 'patch',
      get pxcor() { return (this.i % W) + o.minPxcor; }, get pycor() { return Math.floor(this.i / W) + o.minPycor; },
      turtlesHere(b?: Breed) { return here(this.i, b); },
      neighbors() { return nbrs(this.i, 8); }, neighbors4() { return nbrs(this.i, 4); },
      patchAt(dx: number, dy: number) { const p = patchAtXY(this.pxcor + dx, this.pycor + dy); return p < 0 ? null : pcur(p); },
      distance(a: AnyAgent) { const [x, y] = xyOf(a); return Math.hypot(dX(this.pxcor, x), dY(this.pycor, y)); },
      distancexy(x: number, y: number) { return Math.hypot(dX(this.pxcor, x), dY(this.pycor, y)); },
      sprout(b: Breed, n: number, fn?: (t: AnyAgent) => void) { create(b, n, fn, this.pxcor, this.pycor); },
    };
    for (const [k, t] of Object.entries(pschema)) Object.defineProperty(PP, k, prop(pcols, k, t));
    LP = {
      kind: 'link',
      get id() { return Lk.id[this.i]; }, get breed() { return linkBreeds[Lk.breed[this.i]]; },
      get end1() { return tcur(Lk.a[this.i]); }, get end2() { return tcur(Lk.b[this.i]); },
      get directed() { return linkBreeds[Lk.breed[this.i]].directed; },
      die(): never { killL(this.i); throw DIE; },
    };
    for (const [k, t] of Object.entries(lschema)) Object.defineProperty(LP, k, prop(lcols, k, t));
  }
  const norm = (h: number) => ((h % 360) + 360) % 360;
  function towardsXY(x0: number, y0: number, x1: number, y1: number) {
    const dx = dX(x0, x1), dy = dY(y0, y1);
    if (dx === 0 && dy === 0) throw new Error(`towards: no heading is defined from a point (${x0},${y0}) to that same point`);
    return norm(Math.atan2(dx, dy) * 180 / Math.PI);
  }
  function setxy(i: number, x: number, y: number) {
    if (wrapX) x = wrapC(x, xmin, xmax); else if (x < xmin || x >= xmax) throw new Error(`setxy: x ${x} is outside a world that does not wrap`);
    if (wrapY) y = wrapC(y, ymin, ymax); else if (y < ymin || y >= ymax) throw new Error(`setxy: y ${y} is outside a world that does not wrap`);
    T.x[i] = x; T.y[i] = y;
    const p = patchAtXY(x, y);
    if (p !== T.patch[i]) { unlink(i); link(i, p); }
  }
  function alloc(b: number): number {
    let i: number;
    if (free.length) i = free.pop()!; else { if (high >= cap) growT(); i = high++; }
    T.alive[i] = 1; T.breed[i] = b; T.who[i] = nextWho++; count++;
    for (const k of Object.keys(tcols)) tcols[k][i] = 0;
    return i;
  }
  function killT(i: number) {
    if (!T.alive[i]) return;
    for (let l = 0; l < lhigh; l++) if (Lk.alive[l] && (Lk.a[l] === i || Lk.b[l] === i)) killL(l);       // a turtle's links die with it
    unlink(i); T.alive[i] = 0; free.push(i); count--;
  }
  function killL(l: number) { if (!Lk.alive[l]) return; Lk.alive[l] = 0; lfree.push(l); }
  function create(b: Breed, n: number, fn: ((t: AnyAgent) => void) | undefined, x = 0, y = 0) {
    const born: number[] = [];
    for (let k = 0; k < n; k++) { const i = alloc(b.id); T.x[i] = x; T.y[i] = y; T.h[i] = rng.int(360); link(i, patchAtXY(x, y)); born.push(i); }
    if (fn) runEach('turtle', born, fn);
  }
  function hatch(parent: number, n: number, fn?: (c: AnyAgent) => void) {
    const born: number[] = [];
    for (let k = 0; k < n; k++) {
      const i = alloc(T.breed[parent]);
      T.x[i] = T.x[parent]; T.y[i] = T.y[parent]; T.h[i] = T.h[parent];
      for (const c of Object.keys(tcols)) tcols[c][i] = tcols[c][parent];
      link(i, T.patch[parent]); born.push(i);
    }
    if (fn) runEach('turtle', born, fn);
  }
  function makeLink(a: number, b: number, lb: LinkBreed | undefined, directed: boolean, fn?: (l: AnyAgent) => void) {
    if (a === b) throw new Error('a turtle cannot link to itself');
    const breed = lb || (directed ? defaultDirected() : defaultUndirected());
    if (breed.directed !== directed) throw new Error(`link breed ${breed.name} is ${breed.directed ? 'directed' : 'undirected'}`);
    for (let l = 0; l < lhigh; l++) if (Lk.alive[l] && Lk.breed[l] === breed.id && ((Lk.a[l] === a && Lk.b[l] === b) || (!directed && Lk.a[l] === b && Lk.b[l] === a))) return;   // already linked: nothing
    let l: number; if (lfree.length) l = lfree.pop()!; else { if (lhigh >= lcap) growL(); l = lhigh++; }
    const [lo, hi] = !directed && T.who[b] < T.who[a] ? [b, a] : [a, b];     // undirected: end1 is the lower who, as in NetLogo
    Lk.alive[l] = 1; Lk.breed[l] = breed.id; Lk.a[l] = lo; Lk.b[l] = hi; Lk.aw[l] = T.who[lo]; Lk.bw[l] = T.who[hi]; Lk.id[l] = nextLinkId++;
    for (const k of Object.keys(lcols)) lcols[k][l] = 0;
    if (fn) runEach('link', [l], fn);
  }
  let dirB: LinkBreed | null = null, undB: LinkBreed | null = null;
  const defaultDirected = () => dirB || (dirB = world.linkBreed('directed-links', true));
  const defaultUndirected = () => undB || (undB = world.linkBreed('links', false));
  function linkNbrs(i: number, mode: 'undirected' | 'out' | 'in'): AgentSet {
    const out = new Set<number>();
    for (let l = 0; l < lhigh; l++) {
      if (!Lk.alive[l]) continue; const d = linkBreeds[Lk.breed[l]].directed;
      if (mode === 'undirected' && !d) { if (Lk.a[l] === i) out.add(Lk.b[l]); else if (Lk.b[l] === i) out.add(Lk.a[l]); }
      if (mode === 'out' && d && Lk.a[l] === i) out.add(Lk.b[l]);
      if (mode === 'in' && d && Lk.b[l] === i) out.add(Lk.a[l]);
    }
    return turtleSet([...out]);
  }
  function myLinks(i: number, mode: 'undirected' | 'out' | 'in'): AgentSet {
    const ids: number[] = [];
    for (let l = 0; l < lhigh; l++) {
      if (!Lk.alive[l]) continue; const d = linkBreeds[Lk.breed[l]].directed;
      if ((mode === 'undirected' && !d && (Lk.a[l] === i || Lk.b[l] === i)) || (mode === 'out' && d && Lk.a[l] === i) || (mode === 'in' && d && Lk.b[l] === i)) ids.push(l);
    }
    return new AgentSet('link', Int32Array.from(ids), Float64Array.from(ids.map(l => Lk.id[l])), ids.length);
  }
  const turtleSet = (slots: number[]) => new AgentSet('turtle', Int32Array.from(slots), Float64Array.from(slots.map(s => T.who[s])), slots.length);
  function here(p: number, b?: Breed): AgentSet { const s: number[] = []; for (let i = head[p]; i >= 0; i = T.next[i]) if (!b || T.breed[i] === b.id) s.push(i); return turtleSet(s); }
  function nbrs(p: number, k: 4 | 8): AgentSet {
    const px = (p % W) + o.minPxcor, py = Math.floor(p / W) + o.minPycor, out: number[] = [];
    const d = k === 8 ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] : [[0, -1], [-1, 0], [1, 0], [0, 1]];
    for (const [dx, dy] of d) {
      let x = px + dx, y = py + dy;
      if (x < o.minPxcor || x > o.maxPxcor) { if (!wrapX) continue; x = x < o.minPxcor ? o.maxPxcor : o.minPxcor; }
      if (y < o.minPycor || y > o.maxPycor) { if (!wrapY) continue; y = y < o.minPycor ? o.maxPycor : o.minPycor; }
      const q = pIndex(x, y); if (q !== p && !out.includes(q)) out.push(q);
    }
    return new AgentSet('patch', Int32Array.from(out), null, out.length);
  }
  const live = (s: AgentSet, k: number) => s.kind === 'patch' || (s.kind === 'turtle' ? T.alive[s.ids[k]] === 1 && T.who[s.ids[k]] === s.gens![k] : Lk.alive[s.ids[k]] === 1 && Lk.id[s.ids[k]] === s.gens![k]);
  const cursorOf = (kind: Kind) => kind === 'turtle' ? tcur(0) : kind === 'patch' ? pcur(0) : lcur(0);
  function runEach(kind: Kind, slots: number[], fn: (a: AnyAgent) => void) {
    const c = cursorOf(kind);
    for (const i of slots) { if (kind === 'turtle' ? !T.alive[i] : kind === 'link' ? !Lk.alive[i] : false) continue; c.i = i; try { fn(c); } catch (e) { if (e !== DIE) throw e; } }
  }
  const liveSlots = (s: AgentSet) => { const out: number[] = []; for (let k = 0; k < s.n; k++) if (live(s, k)) out.push(s.ids[k]); return out; };
  const subset = (s: AgentSet, slots: number[]) => new AgentSet(s.kind, Int32Array.from(slots), s.kind === 'patch' ? null : Float64Array.from(slots.map(i => s.kind === 'turtle' ? T.who[i] : Lk.id[i])), slots.length);
  function turtlesOf(b?: Breed): AgentSet { const s: number[] = []; for (let i = 0; i < high; i++) if (T.alive[i] && (!b || T.breed[i] === b.id)) s.push(i); return turtleSet(s); }
  function linksOf(lb?: LinkBreed): AgentSet { const s: number[] = []; for (let l = 0; l < lhigh; l++) if (Lk.alive[l] && (!lb || Lk.breed[l] === lb.id)) s.push(l); return new AgentSet('link', Int32Array.from(s), Float64Array.from(s.map(l => Lk.id[l])), s.length); }
  const allPatches = new AgentSet('patch', Int32Array.from({ length: NP }, (_, i) => i), null, NP);
  const asSet = (s: AgentSet | Breed | LinkBreed): AgentSet => s instanceof AgentSet ? s : ('directed' in s ? linksOf(s) : turtlesOf(s));
  const valuesOf = (s: AgentSet, fn: (a: AnyAgent) => number) => { const c = cursorOf(s.kind), slots = liveSlots(s); return { slots, vals: slots.map(i => { c.i = i; return fn(c); }) }; };
  const pickTies = (slots: number[], vals: number[], best: number) => { const t = slots.filter((_, k) => vals[k] === best); return t[rng.int(t.length)]; };

  let ticks = -1;
  const world = {
    rng, kinds: { W, H, NP, wrapX, wrapY, ...o },
    get ticks() { if (ticks < 0) throw new Error('ticks: the tick counter has not been started yet (reset-ticks)'); return ticks; },
    resetTicks() { ticks = 0; }, tick() { if (ticks < 0) throw new Error('tick: reset-ticks first'); ticks++; },
    get count() { return count; },

    breed(name: string): Breed { const b = { name, id: breeds.length }; breeds.push(b); TP = null; return b; },
    linkBreed(name: string, directed: boolean): LinkBreed { const b = { name, id: linkBreeds.length, directed }; linkBreeds.push(b); LP = null; return b; },
    turtlesOwn(s: Schema) { for (const [k, t] of Object.entries(s)) { tschema[k] = t; tcols[k] = colFor(t, cap); } TP = null; },
    patchesOwn(s: Schema) { for (const [k, t] of Object.entries(s)) { pschema[k] = t; pcols[k] = colFor(t, NP); } PP = null; },
    linksOwn(s: Schema) { for (const [k, t] of Object.entries(s)) { lschema[k] = t; lcols[k] = colFor(t, lcap); } LP = null; },

    get patches() { return allPatches; },
    turtles(b?: Breed) { return turtlesOf(b); },
    links(lb?: LinkBreed) { return linksOf(lb); },
    turtle(who: number) { for (let i = 0; i < high; i++) if (T.alive[i] && T.who[i] === who) return tcur(i); return null; },
    patch(x: number, y: number) { const px = Math.round(x), py = Math.round(y); if (px < o.minPxcor || px > o.maxPxcor || py < o.minPycor || py > o.maxPycor) return null; return pcur(pIndex(px, py)); },
    createTurtles(b: Breed, n: number, fn?: (t: AnyAgent) => void) { create(b, n, fn); },

    /** NetLogo ask: a snapshot, in random order; the dead are skipped; die() ends that agent's block. */
    ask(set: AgentSet | Breed | LinkBreed, fn: (a: AnyAgent) => void) {
      const s = asSet(set), order = new Int32Array(s.n); for (let k = 0; k < s.n; k++) order[k] = k;
      rng.shuffle(order, s.n);
      const c = cursorOf(s.kind);
      for (let q = 0; q < s.n; q++) { const k = order[q]; if (!live(s, k)) continue; c.i = s.ids[k]; try { fn(c); } catch (e) { if (e !== DIE) throw e; } }
    },
    askOne(agent: AnyAgent, fn: (a: AnyAgent) => void) { if (!agent) return; try { fn(agent); } catch (e) { if (e !== DIE) throw e; } },
    with(set: AgentSet | Breed | LinkBreed, pred: (a: AnyAgent) => boolean): AgentSet { const s = asSet(set), c = cursorOf(s.kind); return subset(s, liveSlots(s).filter(i => { c.i = i; return pred(c); })); },
    countOf(set: AgentSet | Breed | LinkBreed): number { return liveSlots(asSet(set)).length; },
    any(set: AgentSet | Breed | LinkBreed): boolean { return world.countOf(set) > 0; },
    other(set: AgentSet | Breed | LinkBreed, me: AnyAgent): AgentSet { const s = asSet(set); return subset(s, liveSlots(s).filter(i => !(me && me.kind === s.kind && me.i === i))); },
    /** NetLogo one-of: a random member, or null (nobody). */
    oneOf(set: AgentSet | Breed | LinkBreed): AnyAgent { const s = asSet(set), l = liveSlots(s); if (!l.length) return null; const c = cursorOf(s.kind); c.i = l[rng.int(l.length)]; return c; },
    /** NetLogo n-of: n distinct members at random; an error if there are fewer. */
    nOf(n: number, set: AgentSet | Breed | LinkBreed): AgentSet {
      const s = asSet(set), l = liveSlots(s);
      if (n > l.length) throw new Error(`n-of: asked for ${n} agents from an agentset of only ${l.length}`);
      const a = Int32Array.from(l); for (let k = 0; k < n; k++) { const j = k + rng.int(a.length - k); const t = a[k]; a[k] = a[j]; a[j] = t; }
      return subset(s, Array.from(a.subarray(0, n)).sort((x, y) => x - y));
    },
    upToNOf(n: number, set: AgentSet | Breed | LinkBreed): AgentSet { const s = asSet(set); return world.nOf(Math.min(n, world.countOf(s)), s); },
    maxOneOf(set: AgentSet | Breed, fn: (a: AnyAgent) => number): AnyAgent { const s = asSet(set), { slots, vals } = valuesOf(s, fn); if (!slots.length) return null; const c = cursorOf(s.kind); c.i = pickTies(slots, vals, Math.max(...vals)); return c; },
    minOneOf(set: AgentSet | Breed, fn: (a: AnyAgent) => number): AnyAgent { const s = asSet(set), { slots, vals } = valuesOf(s, fn); if (!slots.length) return null; const c = cursorOf(s.kind); c.i = pickTies(slots, vals, Math.min(...vals)); return c; },
    maxNOf(n: number, set: AgentSet | Breed, fn: (a: AnyAgent) => number): AgentSet { return nBy(n, asSet(set), fn, -1); },
    minNOf(n: number, set: AgentSet | Breed, fn: (a: AnyAgent) => number): AgentSet { return nBy(n, asSet(set), fn, 1); },
    /** NetLogo `[reporter] of agentset`, in a random order as NetLogo gives it. */
    of<V>(set: AgentSet | Breed | LinkBreed, fn: (a: AnyAgent) => V): V[] { const s = asSet(set), l = liveSlots(s), order = Int32Array.from(l); rng.shuffle(order, order.length); const c = cursorOf(s.kind); return Array.from(order, i => { c.i = i; return fn(c); }); },
    /** NetLogo sort-on: the agents in ascending order of the reporter (ties by who, or by patch order), as separate cursors. */
    sortOn(set: AgentSet | Breed, fn: (a: AnyAgent) => number): AnyAgent[] { const s = asSet(set), { slots, vals } = valuesOf(s, fn); return slots.map((i, k) => [i, vals[k]] as const).sort((a, b) => a[1] - b[1] || (s.kind === 'turtle' ? T.who[a[0]] - T.who[b[0]] : a[0] - b[0])).map(([i]) => s.kind === 'turtle' ? tcur(i) : s.kind === 'patch' ? pcur(i) : lcur(i)); },
    /** NetLogo in-radius: members of the set within r of the agent (itself included), the short way round a wrapping world. */
    inRadius(from: AnyAgent, set: AgentSet | Breed, r: number): AgentSet { const s = asSet(set), [x0, y0] = xyOf(from); return subset(s, liveSlots(s).filter(i => { const [x, y] = s.kind === 'patch' ? xyOf({ kind: 'patch', i }) : [T.x[i], T.y[i]]; return Math.hypot(dX(x0, x), dY(y0, y)) <= r; })); },
    /** NetLogo in-cone: within r and within angle/2 of the turtle's heading. */
    inCone(from: AnyAgent, set: AgentSet | Breed, r: number, angle: number): AgentSet {
      const s = asSet(set), x0 = T.x[from.i], y0 = T.y[from.i], h = T.h[from.i];
      return subset(s, liveSlots(s).filter(i => {
        const [x, y] = s.kind === 'patch' ? xyOf({ kind: 'patch', i }) : [T.x[i], T.y[i]], dx = dX(x0, x), dy = dY(y0, y), d = Math.hypot(dx, dy);
        if (d > r) return false; if (d === 0) return true;
        const diff = Math.abs(((norm(Math.atan2(dx, dy) * 180 / Math.PI) - h + 540) % 360) - 180); return diff <= angle / 2;
      }));
    },
    /** NetLogo diffuse: every patch gives `rate` of its value in eight equal shares to its neighbours, all at once; a patch keeps the shares of neighbours it lacks. */
    diffuse(name: string, rate: number) { diffuseN(name, rate, 8); },
    diffuse4(name: string, rate: number) { diffuseN(name, rate, 4); },

    random: (n: number) => rng.int(n), randomFloat: (x: number) => rng.real(x), randomNormal: (m: number, sd: number) => rng.normal(m, sd),
    randomPoisson: (m: number) => rng.poisson(m), randomExponential: (m: number) => rng.exponential(m),
    randomXcor: () => xmin + rng.float() * (xmax - xmin), randomYcor: () => ymin + rng.float() * (ymax - ymin),
    randomPxcor: () => o.minPxcor + rng.int(W), randomPycor: () => o.minPycor + rng.int(H),
    oneOfList<X>(xs: readonly X[]): X { if (!xs.length) throw new Error('one-of: the list is empty'); return xs[rng.int(xs.length)]; },
    shuffleList<X>(xs: readonly X[]): X[] { const a = xs.slice(), ix = Int32Array.from(a.keys()); rng.shuffle(ix, ix.length); return Array.from(ix, i => a[i]); },

    /** Typed views of the columns, for frames. Turtles and links: slots [0, high) with alive flags; valid until the next agent is created. */
    columns() { return { high, alive: T.alive, breed: T.breed, who: T.who, x: T.x, y: T.y, heading: T.h, vars: tcols }; },
    linkColumns() { return { high: lhigh, alive: Lk.alive, breed: Lk.breed, a: Lk.a, b: Lk.b, aw: Lk.aw, bw: Lk.bw, id: Lk.id, vars: lcols }; },
    patchColumns() { return { width: W, height: H, vars: pcols }; },
    breedList() { return breeds.slice(); }, linkBreedList() { return linkBreeds.slice(); },
  };
  function nBy(n: number, s: AgentSet, fn: (a: AnyAgent) => number, dir: 1 | -1): AgentSet {
    const { slots, vals } = valuesOf(s, fn);
    if (n > slots.length) throw new Error(`${dir < 0 ? 'max' : 'min'}-n-of: asked for ${n} agents from an agentset of only ${slots.length}`);
    const ix = Int32Array.from(slots.keys()); rng.shuffle(ix, ix.length);                          // random order first, so ties are broken at random
    const chosen = Array.from(ix).sort((a, b) => dir * (vals[a] - vals[b])).slice(0, n).map(k => slots[k]);
    return subset(s, chosen.sort((a, b) => a - b));
  }
  function diffuseN(name: string, rate: number, k: 4 | 8) {
    const col = pcols[name]; if (!col) throw new Error(`diffuse: ${name} is not a patch variable`);
    if (!(rate >= 0 && rate <= 1)) throw new Error(`diffuse: the rate ${rate} is not between 0 and 1`);
    const out = Float64Array.from(col);
    for (let p = 0; p < NP; p++) {
      const share = col[p] * rate / k, ns = nbrs(p, k);
      out[p] -= share * ns.n;
      for (let q = 0; q < ns.n; q++) out[ns.ids[q]] += share;
    }
    col.set(out);
  }
  return world;
}

export type AgentWorld = ReturnType<typeof createAgentWorld>;

// ---------- list statistics (NetLogo: variance and standard-deviation are the sample ones) ----------
const nonEmpty = (xs: readonly number[], what: string) => { if (!xs.length) throw new Error(`${what}: the list is empty`); };
export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: readonly number[]) => { nonEmpty(xs, 'mean'); return sum(xs) / xs.length; };
export const max = (xs: readonly number[]) => { nonEmpty(xs, 'max'); return Math.max(...xs); };
export const min = (xs: readonly number[]) => { nonEmpty(xs, 'min'); return Math.min(...xs); };
export const median = (xs: readonly number[]) => { nonEmpty(xs, 'median'); const a = xs.slice().sort((p, q) => p - q), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
export const variance = (xs: readonly number[]) => { if (xs.length < 2) throw new Error('variance: needs at least two numbers'); const m = mean(xs); return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1); };
export const standardDeviation = (xs: readonly number[]) => Math.sqrt(variance(xs));
/** NetLogo subtract-headings: the smallest signed turn from h2 to h1, in (-180, 180]. */
export const subtractHeadings = (h1: number, h2: number) => { const d = ((h1 - h2) % 360 + 540) % 360 - 180; return d === -180 ? 180 : d; };
