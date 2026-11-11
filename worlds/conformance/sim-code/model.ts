// Conformance fixture: a deliberately small retrofit ledger.
// One anchored agent per structure; a declared depth and approved flag.
// Converted as if from NetLogo; there is no NetLogo source for this toy.
import { defineModel, type AnyAgent } from '../../../tools/agents/library/index.ts';

export default defineModel({
  title: 'Conformance retrofit ledger',
  time: { unit: 'weeks', horizon: 160 },
  world: { minPxcor: -20, maxPxcor: 20, minPycor: -20, maxPycor: 20 },
  params: {
    subsidy: { type: 'number', min: 0, max: 1, step: 0.05, default: 0.35, tier: 'lever', unit: 'share', label: 'Subsidy' },
    adoption: { type: 'number', min: 0, max: 1, step: 0.05, default: 0.15, tier: 'lever', unit: '/week', label: 'Adoption rate' },
    weather: { type: 'number', min: 0, max: 1, step: 0.05, default: 0.4, tier: 'assumption', unit: 'index', label: 'Weather drag' },
  },
  turtlesOwn: { depth: 'f64', approved: 'bool' },
  breeds: {
    structures: { kind: 'anchored', layer: 'buildings', own: { anchor: 'i32' }, frame: ['depth', 'approved'], label: 'Structures' },
  },
  globals: { mean_depth: 0, approved_share: 0 },
  setup(m) {
    const n = m.world?.layers?.buildings?.length ?? 64;
    let i = 0;
    m.createTurtles(m.breeds.structures, n, (t: AnyAgent) => {
      t.anchor = i++;
      t.depth = 0;
      t.approved = false;
    });
    m.resetTicks();
  },
  go(m) {
    const subsidy = +m.params.subsidy;
    const adoption = +m.params.adoption;
    const weather = +m.params.weather;
    let total = 0, n = 0, approved = 0;
    m.ask(m.breeds.structures, (t: AnyAgent) => {
      const p = adoption * (0.25 + 0.75 * subsidy) * (1 - 0.5 * weather);
      if (m.randomFloat(1) < p) t.depth = Math.min(1, t.depth + 0.02 + 0.04 * subsidy);
      t.approved = t.depth > 0.4;
      total += t.depth; n += 1; if (t.approved) approved += 1;
    });
    m.globals.mean_depth = n ? total / n : 0;
    m.globals.approved_share = n ? approved / n : 0;
    m.tick();
  },
  plots: {
    retrofit: {
      label: 'Retrofit', unit: 'share',
      pens: {
        'mean depth': (m) => +m.globals.mean_depth,
        'approved share': (m) => +m.globals.approved_share,
      },
    },
  },
  monitors: {
    retrofitted: { label: 'Approved structures', unit: 'structures', value: (m) => Math.round(+m.globals.approved_share * (m.world?.layers?.buildings?.length ?? 0)) },
  },
  interventions: {
    'grant-round': {
      label: 'Grant round',
      args: { boost: { type: 'number', min: 0, max: 0.5, step: 0.05, default: 0.2 } },
      run: (m, a) => { m.ask(m.breeds.structures, (t: AnyAgent) => { t.depth = Math.min(1, t.depth + +a.boost); }); },
    },
  },
});
