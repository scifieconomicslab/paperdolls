// Wolf Sheep Predation (NetLogo models library, Uri Wilensky 1997) as a defineModel: the reference shape of a converted model (task 1.2).
// Procedures keep their NetLogo names and order; the NetLogo source is in the comment above each. Shape, colour, size and labels are left out.
import { defineModel, COLOR, type Ctx, type AnyAgent } from '../library/index.ts';

export default defineModel({
  title: 'Wolf Sheep Predation',
  time: { unit: 'tick', horizon: 500 },
  world: { minPxcor: -25, maxPxcor: 25, minPycor: -25, maxPycor: 25 },
  params: {
    'model-version': { type: 'choice', values: [{ value: 'sheep-wolves' }, { value: 'sheep-wolves-grass' }], default: 'sheep-wolves-grass', tier: 'structural' },
    'initial-number-sheep': { type: 'integer', min: 0, max: 250, step: 1, default: 100, tier: 'lever' },
    'initial-number-wolves': { type: 'integer', min: 0, max: 250, step: 1, default: 50, tier: 'lever' },
    'sheep-gain-from-food': { type: 'number', min: 0, max: 50, step: 1, default: 4 },
    'wolf-gain-from-food': { type: 'number', min: 0, max: 100, step: 1, default: 20 },
    'sheep-reproduce': { type: 'number', min: 1, max: 20, step: 1, default: 4 },
    'wolf-reproduce': { type: 'number', min: 0, max: 20, step: 1, default: 5 },
    'grass-regrowth-time': { type: 'integer', min: 0, max: 100, step: 1, default: 30, activeWhen: { 'model-version': 'sheep-wolves-grass' } },
  },
  turtlesOwn: { energy: 'f64' },
  patchesOwn: { countdown: 'f64' },
  breeds: { sheep: { label: 'Sheep' }, wolves: { label: 'Wolves' } },
  globals: { 'max-sheep': 30000 },
  setup(m) {
    // to setup
    const grassOn = m.params['model-version'] === 'sheep-wolves-grass';
    if (grassOn) m.ask(m.patches, (q: AnyAgent) => { q.pcolor = m.oneOfList([COLOR.green, COLOR.brown]); q.countdown = q.pcolor === COLOR.green ? +m.params['grass-regrowth-time'] : m.random(+m.params['grass-regrowth-time']); });
    else m.ask(m.patches, (q: AnyAgent) => { q.pcolor = COLOR.green; });
    m.createTurtles(m.breeds.sheep, +m.params['initial-number-sheep'], (t: AnyAgent) => { t.energy = m.random(2 * +m.params['sheep-gain-from-food']); t.setxy(m.randomXcor(), m.randomYcor()); });
    m.createTurtles(m.breeds.wolves, +m.params['initial-number-wolves'], (t: AnyAgent) => { t.energy = m.random(2 * +m.params['wolf-gain-from-food']); t.setxy(m.randomXcor(), m.randomYcor()); });
    m.resetTicks();
  },
  go(m) {
    // to go
    if (!m.any(m.turtles())) return false;
    if (!m.any(m.breeds.wolves) && m.countOf(m.breeds.sheep) > +m.globals['max-sheep']) return false;
    const grassOn = m.params['model-version'] === 'sheep-wolves-grass';
    m.ask(m.breeds.sheep, (t: AnyAgent) => { move(m, t); if (grassOn) { t.energy = t.energy - 1; eatGrass(m, t); death(t); } reproduce(m, t, +m.params['sheep-reproduce']); });
    m.ask(m.breeds.wolves, (t: AnyAgent) => { move(m, t); t.energy = t.energy - 1; eatSheep(m, t); death(t); reproduce(m, t, +m.params['wolf-reproduce']); });
    if (grassOn) m.ask(m.patches, (q: AnyAgent) => growGrass(m, q));
    m.tick();
  },
  plots: { populations: { pens: { sheep: m => m.countOf(m.breeds.sheep), wolves: m => m.countOf(m.breeds.wolves), 'grass / 4': m => m.countOf(m.with(m.patches, (q: AnyAgent) => q.pcolor === COLOR.green)) / 4 } } },
  monitors: { sheep: { value: m => m.countOf(m.breeds.sheep) }, wolves: { value: m => m.countOf(m.breeds.wolves) } },
  interventions: {
    'add-wolves': { label: 'Release wolves', args: { n: { type: 'integer', min: 1, max: 100, default: 10 } }, run: (m, a) => m.createTurtles(m.breeds.wolves, +a.n, (t: AnyAgent) => { t.energy = 2 * +m.params['wolf-gain-from-food']; t.setxy(m.randomXcor(), m.randomYcor()); }) },
  },
});

// Procedures are exported for the parity harness (test/procedures.test.ts, parity/procedures.mjs).
// The NetLogo source stays in the comment above each function. Shape is untouched: one defineModel default export.
export const procs = { move, eatGrass, reproduce, eatSheep, death, growGrass };

// to move: rt random 50  lt random 50  fd 1
function move(m: Ctx, t: AnyAgent) { t.rt(m.random(50)); t.lt(m.random(50)); t.fd(1); }
// to eat-grass: if pcolor = green [ set pcolor brown  set energy energy + sheep-gain-from-food ]
function eatGrass(m: Ctx, t: AnyAgent) { const ph = t.patchHere(); if (ph.pcolor === COLOR.green) { ph.pcolor = COLOR.brown; t.energy = t.energy + +m.params['sheep-gain-from-food']; } }
// to reproduce-*: if random-float 100 < rate [ set energy (energy / 2)  hatch 1 [ rt random-float 360 fd 1 ] ]
function reproduce(m: Ctx, t: AnyAgent, rate: number) { if (m.randomFloat(100) < rate) { t.energy = t.energy / 2; t.hatch(1, (c: AnyAgent) => { c.rt(m.randomFloat(360)); c.fd(1); }); } }
// to eat-sheep: let prey one-of sheep-here  if prey != nobody [ ask prey [ die ]  set energy energy + wolf-gain-from-food ]
function eatSheep(m: Ctx, t: AnyAgent) { const prey = m.oneOf(t.turtlesHere(m.breeds.sheep)); if (prey !== null) { m.askOne(prey, (a: AnyAgent) => a.die()); t.energy = t.energy + +m.params['wolf-gain-from-food']; } }
// to death: if energy < 0 [ die ]
function death(t: AnyAgent) { if (t.energy < 0) t.die(); }
// to grow-grass: if pcolor = brown [ ifelse countdown <= 0 [ set pcolor green  set countdown grass-regrowth-time ] [ set countdown countdown - 1 ] ]
function growGrass(m: Ctx, q: AnyAgent) { if (q.pcolor === COLOR.brown) { if (q.countdown <= 0) { q.pcolor = COLOR.green; q.countdown = +m.params['grass-regrowth-time']; } else q.countdown = q.countdown - 1; } }
