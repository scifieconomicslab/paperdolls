// Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
// Black-box tests of each primitive against desktop NetLogo 7.0.4 (task 1.2). The NetLogo side is recorded in fixtures/netlogo-7.0.4.json by
// scripts/netlogo-fixtures.mjs from the scenarios in scenarios.mjs; each test here builds the same case with the library.
// Exact where NetLogo is exact (to 1e-9); random primitives are compared as distributions (two-sample KS or chi-square, p > 0.001),
// because the library's random stream is its own (plan D9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAgentWorld, mean, median, variance, standardDeviation, sum, max, min, subtractHeadings } from '../library/index.ts';
import { POS } from './scenarios.mjs';

const NL = JSON.parse(readFileSync(new URL('./fixtures/netlogo-7.0.4.json', import.meta.url), 'utf8')).scenarios;
const near = (a: number[], b: number[], what: string, tol = 1e-9) => { assert.equal(a.length, b.length, `${what}: length`); a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= tol * Math.max(1, Math.abs(b[i])), `${what}[${i}]: ${x} vs NetLogo ${b[i]}`)); };
const world = (r: number, seed = 1, wrap = true) => createAgentWorld({ minPxcor: -r, maxPxcor: r, minPycor: -r, maxPycor: r, wrapX: wrap, wrapY: wrap, seed });
const code = (p: any) => p.pxcor * 1000 + p.pycor; // eslint-disable-line @typescript-eslint/no-explicit-any
const sorted = (xs: number[]) => xs.slice().sort((a, b) => a - b);

// ---- statistics for the random primitives
function ks(a: number[], b: number[]) {
  a = sorted(a); b = sorted(b); let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) { const x = Math.min(a[i], b[j]); while (i < a.length && a[i] <= x) i++; while (j < b.length && b[j] <= x) j++; d = Math.max(d, Math.abs(i / a.length - j / b.length)); }
  const en = Math.sqrt(a.length * b.length / (a.length + b.length)), l = (en + 0.12 + 0.11 / en) * d;
  let p = 0; for (let k = 1; k <= 100; k++) p += 2 * (-1) ** (k - 1) * Math.exp(-2 * k * k * l * l);
  return { d, p: l > 0 ? Math.max(0, Math.min(1, p)) : 1 };
}
/** Two-sample chi-square test of homogeneity over categories (Wilson-Hilferty approximation of the p value). */
function chi2(a: Map<string, number>, b: Map<string, number>) {
  const keys = [...new Set([...a.keys(), ...b.keys()])], na = [...a.values()].reduce((x, y) => x + y, 0), nb = [...b.values()].reduce((x, y) => x + y, 0);
  let x2 = 0;
  for (const k of keys) { const oa = a.get(k) || 0, ob = b.get(k) || 0, tot = oa + ob, ea = tot * na / (na + nb), eb = tot * nb / (na + nb); x2 += (oa - ea) ** 2 / ea + (ob - eb) ** 2 / eb; }
  const df = keys.length - 1, z = (Math.cbrt(x2 / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  const p = 0.5 * (1 - erf(z / Math.SQRT2)); return { x2, df, p };
}
function erf(x: number) { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
const tally = (xs: unknown[]) => { const m = new Map<string, number>(); for (const x of xs) { const k = JSON.stringify(x); m.set(k, (m.get(k) || 0) + 1); } return m; };

test('distance, towards, patch-at, patch-ahead, distancexy on a wrapping world', () => {
  const w = world(10), b = w.breed('t'), f = NL['geometry-wrap'];
  for (const [x, y] of POS) w.createTurtles(b, 1, t => t.setxy(x, y));
  const T = (k: number) => w.turtle(k)!;
  T(0).heading = 33;
  const pairs = [[0, 1], [0, 2], [1, 2], [2, 3], [3, 0], [1, 3]];
  near(pairs.map(([a, c]) => T(a).distance(T(c))), f.distance, 'distance');
  near(pairs.map(([a, c]) => T(a).towards(T(c))), f.towards, 'towards');
  const pa = T(0).patchAt(2, 3), pb = T(0).patchAt(-1.6, 0.4);
  assert.deepEqual([pa.pxcor, pa.pycor, pb.pxcor, pb.pycor], f.patchAt);
  const ah = T(0).patchAhead(2.5); assert.deepEqual([ah.pxcor, ah.pycor], f.patchAhead);
  near([T(2).distancexy(10, -10), T(2).distancexy(-3.3, 4.4)], f.distancexy, 'distancexy');
});

test('fd, rt, lt, bk wrap the same way', () => {
  const w = world(10), b = w.breed('t');
  w.createTurtles(b, 1, t => { t.setxy(0, 0); t.heading = 0; for (let k = 0; k < 50; k++) { t.rt(37); t.fd(1.3); } t.lt(400); t.bk(2.2); });
  const t = w.turtle(0)!; near([t.xcor, t.ycor, t.heading], NL['motion-wrap'].state, 'state', 1e-9);
});

test('in-radius and in-cone, the short way round', () => {
  const w = world(10), b = w.breed('t'), f = NL['radius-cone'];
  w.createTurtles(b, 1, t => { t.setxy(9.6, -0.2); t.heading = 60; });
  for (const [x, y] of [[-9.8, 0.1], [9, 3], [5, -0.2], [-8.9, -1]]) w.createTurtles(b, 1, t => t.setxy(x, y));
  const me = w.turtle(0)!;
  assert.deepEqual(sorted(w.of(w.inRadius(me, w.patches, 3.5), code)), f.patchesInRadius);
  assert.deepEqual(sorted(w.of(w.inRadius(me, w.turtles(), 2.5), t => t.who)), f.turtlesInRadius);
  assert.deepEqual(sorted(w.of(w.inCone(me, w.patches, 4, 70), code)), f.patchesInCone);
});

test('neighbors and neighbors4, wrapping and not', () => {
  for (const [name, wrap] of [['neighbors-wrap', true], ['neighbors-box', false]] as const) {
    const w = world(4, 1, wrap), f = NL[name];
    assert.deepEqual(sorted(w.of(w.patch(-4, -4)!.neighbors(), code)), f.n8corner, `${name} n8corner`);
    assert.deepEqual(sorted(w.of(w.patch(-4, -4)!.neighbors4(), code)), f.n4corner, `${name} n4corner`);
    if (wrap) assert.deepEqual(sorted(w.of(w.patch(1, 2)!.neighbors(), code)), f.n8mid);
    else assert.deepEqual(sorted(w.of(w.patch(0, 4)!.neighbors(), code)), f.n8edge);
  }
});

test('diffuse and diffuse4 give the same values (sort patches: top row first, left to right)', () => {
  for (const [name, wrap, steps] of [['diffuse-wrap', true, [[8, 0.5], [8, 0.3]]], ['diffuse-box', false, [[8, 0.5], [8, 0.3]]], ['diffuse4-wrap', true, [[4, 0.4]]]] as const) {
    const w = world(3, 1, wrap); w.patchesOwn({ countdown: 'f64' });
    w.ask(w.patches, p => { p.countdown = p.pxcor * 3 + p.pycor * p.pycor; });
    for (const [k, r] of steps) if (k === 8) w.diffuse('countdown', r); else w.diffuse4('countdown', r);
    const vals: number[] = []; for (let y = 3; y >= -3; y--) for (let x = -3; x <= 3; x++) vals.push(w.patch(x, y)!.countdown);
    near(vals, NL[name].values, name, 1e-9);
  }
});

test('list statistics (sample variance)', () => {
  const L = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5];
  near([mean(L), median(L), variance(L), standardDeviation(L), sum(L), max(L), min(L), median([4, 1, 3, 2])], NL.lists.stats, 'stats');
});

test('hatch copies the parent and runs its block; sprout makes turtles at the patch centre', () => {
  const w = world(10), b = w.breed('t'); w.turtlesOwn({ energy: 'f64' });
  w.createTurtles(b, 1, t => { t.setxy(1.5, 2.5); t.heading = 77; t.energy = 12.5; t.hatch(2, (c: any) => { c.fd(1); c.energy = c.energy + 1; }); }); // eslint-disable-line @typescript-eslint/no-explicit-any
  w.patch(2, -3)!.sprout(b, 3, (t: any) => { t.energy = 7; }) // eslint-disable-line @typescript-eslint/no-explicit-any;
  const rows = w.sortOn(w.turtles(), t => t.who).map(t => [t.who, t.xcor, t.ycor, t.energy]);
  rows.forEach((r, i) => near(r, NL['hatch-sprout'].turtles[i], `turtle ${i}`));
  assert.deepEqual(w.sortOn(w.with(w.turtles(), t => t.who < 3), t => t.who).map(t => t.heading), NL['hatch-sprout'].hatchedHeadings);
});

test('undirected links: no duplicates, end1 is the lower who, links die with their turtles', () => {
  for (const name of ['links-undirected', 'links-die']) {
    const w = world(10), b = w.breed('t'), f = NL[name];
    w.createTurtles(b, 6);
    const T = (k: number) => w.turtle(k)!;
    w.askOne(T(0), me => w.ask(w.other(w.turtles(), me), o => me.createLinkWith(o)));
    T(1).createLinkWith(T(2));
    if (name === 'links-undirected') { T(1).createLinkWith(T(0)); }
    else w.askOne(T(0), t => t.die());
    assert.equal(w.countOf(w.links()), f.links);
    assert.deepEqual(sorted(w.of(T(1).linkNeighbors(), t => t.who)), f.n1);
    if (name === 'links-undirected') {
      assert.equal(w.countOf(T(0).linkNeighbors()), f.n0); assert.equal(w.countOf(T(1).myLinks()), f.my1);
      const ends = w.of(w.links(), l => [l.end1.who, l.end2.who]).sort((p, q) => p[0] - q[0] || p[1] - q[1]); assert.deepEqual(ends, f.ends);
    }
  }
});

test('directed links', () => {
  const w = world(10), b = w.breed('t'), f = NL['links-directed'];
  w.createTurtles(b, 5); const T = (k: number) => w.turtle(k)!;
  T(3).createLinkTo(T(4)); T(3).createLinkTo(T(0)); T(4).createLinkTo(T(3)); T(3).createLinkTo(T(4));
  assert.equal(w.countOf(w.links()), f.links);
  assert.deepEqual(sorted(w.of(T(3).outLinkNeighbors(), t => t.who)), f.out3);
  assert.deepEqual(sorted(w.of(T(3).inLinkNeighbors(), t => t.who)), f.in3);
  assert.equal(w.countOf(T(4).myOutLinks()), f.myOut4); assert.equal(w.countOf(T(0).myInLinks()), f.myIn0);
});

test('sort-on, max-n-of, min-n-of, max-one-of, min-one-of', () => {
  const w = world(16), b = w.breed('t'), f = NL.sorting; w.turtlesOwn({ energy: 'f64' });
  w.createTurtles(b, 6, t => { t.energy = (t.who * 7) % 11; });
  assert.deepEqual(w.sortOn(w.turtles(), t => t.energy).map(t => t.who), f.sortOn);
  assert.deepEqual(sorted(w.of(w.maxNOf(3, w.turtles(), t => t.energy), t => t.who)), f.maxN);
  assert.deepEqual(sorted(w.of(w.minNOf(2, w.turtles(), t => t.energy), t => t.who)), f.minN);
  assert.equal(w.maxOneOf(w.turtles(), t => t.energy).who, f.maxOne); assert.equal(w.minOneOf(w.turtles(), t => t.energy).who, f.minOne);
});

test('subtract-headings', () => { near([[10, 350], [350, 10], [0, 180], [180, 0], [90, 271], [45.5, 300]].map(([a, b]) => subtractHeadings(a, b)), NL.headings.subtract, 'subtract-headings'); });

test('random-normal, random-poisson, random-exponential, random, random-float: the same distributions', () => {
  const w = world(3, 4321), f = NL.random, n = (k: number, g: () => number) => Array.from({ length: k }, g);
  for (const [name, sample] of [['normal', n(3000, () => w.randomNormal(10, 3))], ['poisson', n(3000, () => w.randomPoisson(4))], ['poisson40', n(2000, () => w.randomPoisson(40))],
    ['exponential', n(3000, () => w.randomExponential(2))], ['float', n(3000, () => w.randomFloat(5))]] as const) {
    const r = ks(sample as number[], f[name]); assert.ok(r.p > 0.001, `${name}: KS p ${r.p.toFixed(4)} (d ${r.d.toFixed(4)})`);
  }
  const r = chi2(tally(n(3000, () => w.random(7))), tally(f.int7)); assert.ok(r.p > 0.001, `random 7: chi-square p ${r.p.toFixed(4)}`);
});

test('n-of and one-of sample like NetLogo; ask visits in a uniformly random order', () => {
  const w = world(3, 99), b = w.breed('t'); w.createTurtles(b, 5);
  const pairs = Array.from({ length: 2000 }, () => sorted(w.of(w.nOf(2, w.turtles()), t => t.who)));
  let r = chi2(tally(pairs), tally(NL.sampling.nOf2)); assert.ok(r.p > 0.001, `n-of 2: p ${r.p.toFixed(4)}`);
  r = chi2(tally(Array.from({ length: 3000 }, () => w.oneOf(w.turtles()).who)), tally(NL.sampling.oneOf)); assert.ok(r.p > 0.001, `one-of: p ${r.p.toFixed(4)}`);
  const firsts = Array.from({ length: 2000 }, () => { let first = -1; w.ask(w.turtles(), t => { if (first < 0) first = t.who; }); return first; });
  r = chi2(tally(firsts), tally(NL['ask-order'].first)); assert.ok(r.p > 0.001, `ask order: p ${r.p.toFixed(4)}`);
});
