// Offline replay of the procedure gates against fixtures recorded from NetLogo 7.0.4
// (test/fixtures/procedures-7.0.4.json; regeneration: NETLOGO_HOME=... node scripts/procedures.mjs --record).
// Exact where NetLogo is exact (grow-grass); KS where random (move); z on shares (wolves' turn). No NetLogo required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAgentWorld, COLOR, resolveParams } from '../library/index.ts';
import { procs, default as _mdl } from '../examples/wolf-sheep.ts';
import type { Ctx } from '../library/index.ts';

const fx = JSON.parse(readFileSync(new URL('./fixtures/procedures-7.0.4.json', import.meta.url), 'utf8'));
const N = 5000, R = 2000;

function testCtx(seed: number): Ctx {
  const w = createAgentWorld({ minPxcor: -25, maxPxcor: 25, minPycor: -25, maxPycor: 25, seed });
  w.turtlesOwn({ energy: 'f64' });
  w.patchesOwn({ countdown: 'f64' });
  const breeds = { sheep: w.breed('sheep'), wolves: w.breed('wolves') };
  const desc = _mdl.describe();
  const resolved = resolveParams(desc, {});
  if (!resolved.ok) throw new Error('model defaults do not resolve: ' + resolved.errors.join('; '));
  const params = resolved.params as Record<string, number | boolean | string | number[]>;
  return Object.assign(Object.create(w), { params, globals: { 'max-sheep': 30000 }, breeds, linkBreeds: {}, world: null, data() { throw new Error('no data in the fixture test'); } }) as Ctx;
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => Math.sqrt(mean(a.map(x => (x - mean(a)) ** 2)));
const ks = (a: number[], b: number[]) => { a = [...a].sort((x, y) => x - y); b = [...b].sort((x, y) => x - y); let i = 0, j = 0, d = 0; while (i < a.length && j < b.length) { const x = Math.min(a[i], b[j]); while (i < a.length && a[i] <= x) i++; while (j < b.length && b[j] <= x) j++; d = Math.max(d, Math.abs(i / a.length - j / b.length)); } const en = Math.sqrt(a.length * b.length / (a.length + b.length)), l = (en + 0.12 + 0.11 / en) * d; let p = 0; for (let k = 1; k <= 100; k++) p += 2 * (-1) ** (k - 1) * Math.exp(-2 * k * k * l * l); return { d, p: Math.max(0, Math.min(1, l > 0 ? p : 1)) }; };

test('grow-grass: exact match on the six fixture patches', () => {
  const states = [[COLOR.brown, -1], [COLOR.brown, 0], [COLOR.brown, 1], [COLOR.brown, 5], [COLOR.green, 0], [COLOR.green, 3]] as const;
  const m = testCtx(1);
  const ts = states.map(([c, n], k) => {
    let out: string | null = null;
    m.ask(m.patches, q => { if (q.pxcor === k && q.pycor === 0) { q.pcolor = c; q.countdown = n; procs.growGrass(m, q); out = `${q.pcolor}:${q.countdown}`; } });
    return out;
  });
  assert.deepEqual(ts, fx.growGrass.want);
});

test('move: heading change per call matches NetLogo in distribution (5,000 calls, KS p > 0.01)', () => {
  const dh = (a: number, b: number) => { let d = b - a; d = ((d + 540) % 360) - 180; return d; };
  const nlH: number[] = fx.move.nlH;
  const m = testCtx(7);
  const tsH: number[] = [];
  m.createTurtles(m.breeds.sheep, 1, t => { t.heading = 0; t.setxy(0, 0); for (let k = 0; k < N; k++) { const h0 = t.heading; procs.move(m, t); tsH.push(dh(h0, t.heading)); } });
  const { p } = ks(nlH, tsH);
  assert.ok(p > 0.01, `KS p ${p}`);
});

test("wolves' turn from a fixture: the share of repeats in which the sheep was eaten matches (2,000 repeats, |z| < 4)", () => {
  const nlShare = fx.wolfTurn.nlEaten / fx.wolfTurn.R;
  let tsEatenN = 0;
  for (let r = 0; r < R; r++) {
    const m = testCtx(500 + r);
    m.ask(m.patches, q => { q.pcolor = COLOR.green; });
    m.createTurtles(m.breeds.sheep, 1, t => { t.setxy(0, 0); t.energy = 10; });
    m.createTurtles(m.breeds.wolves, 1, t => { t.setxy(0, 0); t.energy = 10; });
    m.ask(m.breeds.wolves, t => {
      procs.move(m, t); t.energy = t.energy - 1; procs.eatSheep(m, t); procs.death(t); procs.reproduce(m, t, +m.params['wolf-reproduce']);
    });
    if (m.countOf(m.breeds.sheep) === 0) tsEatenN++;
  }
  const tsShare = tsEatenN / R;
  const se = Math.sqrt((nlShare * (1 - nlShare) + tsShare * (1 - tsShare)) / R) || 1e-9, z = (tsShare - nlShare) / se;
  assert.ok(Math.abs(z) < 4, `z ${z}`);
});
