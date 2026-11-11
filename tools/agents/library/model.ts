// Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0). World import path only.
// defineModel (plan 3.1): a converted NetLogo model is one call. It gives the engine a Model (describe, start) and does everything a model
// would otherwise write by hand: the world, the random stream, frames from the struct-of-arrays columns, plots and monitors as series and KPIs,
// interventions applied at their tick, and the stop condition.
import { createAgentWorld, type AgentWorld, type Breed, type LinkBreed, type Schema, type AnyAgent } from './core.ts';
import { checkFrame, columnFor, resolveParams, type Column, type DataTable, type Description, type EntitySpec, type FieldSpec, type Frame, type Intervention, type Model, type ParamSpec, type ParamValue, type Run, type RunInput, type Scalar } from './contract.ts';
import type { World } from './world.ts';

export interface BreedSpec {
  own?: Schema;                                         // the breed's own variables (<breed>-own)
  kind?: 'mobile' | 'anchored' | 'unplaced';            // mobile (default): x, y in frames; anchored: needs an `anchor` variable (an index into world.layers[layer])
  layer?: string;
  privacy?: 'aggregate';
  label?: string;
  frame?: string[];                                     // variables sent in frames (default: all of turtles-own and the breed's own, except anchor)
  categories?: Record<string, string[]>;                // an i32 variable shown as a category: its values are indices into this list
}
export interface ModelSpec<P extends Record<string, ParamSpec> = Record<string, ParamSpec>> {
  title: string;
  time: { unit: string; horizon: number };
  world: { minPxcor: number; maxPxcor: number; minPycor: number; maxPycor: number; wrapX?: boolean; wrapY?: boolean } | ((params: Record<string, ParamValue>) => { minPxcor: number; maxPxcor: number; minPycor: number; maxPycor: number; wrapX?: boolean; wrapY?: boolean });
  params: P;
  turtlesOwn?: Schema;
  patchesOwn?: Schema;
  breeds?: Record<string, BreedSpec>;
  linkBreeds?: Record<string, { directed: boolean; own?: Schema; label?: string; frame?: boolean }>;
  globals?: Record<string, Scalar>;
  reads?: { world?: string[]; data?: string[] };
  setup(m: Ctx): void;
  go(m: Ctx): void | false;                              // one tick: must call m.tick(); false stops the run (NetLogo `stop`)
  plots?: Record<string, { label?: string; unit?: string; pens: Record<string, (m: Ctx) => number> }>;
  monitors?: Record<string, { label?: string; unit?: string; value: (m: Ctx) => number }>;
  interventions?: Record<string, { label?: string; args: Record<string, ParamSpec>; run: (m: Ctx, args: Record<string, Scalar>) => void }>;
  stop?: (m: Ctx) => boolean;
}
export type Ctx = AgentWorld & {
  params: Record<string, ParamValue>; globals: Record<string, Scalar>;
  breeds: Record<string, Breed>; linkBreeds: Record<string, LinkBreed>;
  world: World | null; data(name: string): DataTable;
};

const TYPE: Record<string, FieldSpec['type']> = { f64: 'f64', i32: 'i32', bool: 'bool' };

export function defineModel<P extends Record<string, ParamSpec>>(spec: ModelSpec<P>): Model {
  const own = (b: BreedSpec) => ({ ...(spec.turtlesOwn || {}), ...(b.own || {}) });
  const entities: Record<string, EntitySpec> = {};
  for (const [name, b] of Object.entries(spec.breeds || {})) {
    const kind = b.kind || 'mobile', vars = own(b);
    if (kind === 'anchored' && vars.anchor !== 'i32') throw new Error(`breed ${name}: an anchored breed needs an i32 variable named anchor`);
    const fields: Record<string, FieldSpec> = {};
    for (const v of b.frame || Object.keys(vars).filter(k => k !== 'anchor')) {
      if (!(v in vars)) throw new Error(`breed ${name}: frame variable ${v} is not one of its variables`);
      fields[v] = b.categories && b.categories[v] ? { type: 'category', values: b.categories[v] } : { type: TYPE[vars[v]] };
    }
    entities[name] = { kind, fields, ...(b.layer ? { layer: b.layer } : {}), ...(b.privacy ? { privacy: b.privacy } : {}), ...(b.label ? { label: b.label } : {}) };
  }
  for (const [name, l] of Object.entries(spec.linkBreeds || {})) if (l.frame !== false) {
    const fields: Record<string, FieldSpec> = {}; for (const [k, t] of Object.entries(l.own || {})) fields[k] = { type: TYPE[t] };
    entities[name] = { kind: 'link', fields, ...(l.label ? { label: l.label } : {}) };
  }
  const series: Description['series'] = {}, kpis: Description['kpis'] = {};
  for (const [name, p] of Object.entries(spec.plots || {})) series[name] = { label: p.label, unit: p.unit, y: Object.keys(p.pens) };
  for (const [name, m] of Object.entries(spec.monitors || {})) { series['monitor:' + name] = { label: m.label, unit: m.unit, y: ['value'] }; kpis[name] = { label: m.label, unit: m.unit, series: 'monitor:' + name }; }
  const interventions: Description['interventions'] = {};
  for (const [name, iv] of Object.entries(spec.interventions || {})) interventions[name] = { label: iv.label, args: iv.args };
  const desc: Description = { title: spec.title, time: spec.time, params: spec.params, entities, series, kpis, interventions, reads: { world: spec.reads?.world || [], data: spec.reads?.data || [] } };

  return {
    describe: () => desc,
    start(input: RunInput): Run {
      const r = resolveParams(desc, input.params);
      if (!r.ok) throw new Error('parameters: ' + r.errors.join('; '));
      const scenario = input.scenario.map((iv) => {
        const spec = interventions[iv.name];
        if (!spec) throw new Error(`scenario: ${iv.name} is not an intervention of this model`);
        const resolved = resolveParams({ ...desc, params: spec.args }, iv.args);
        if (!resolved.ok) throw new Error(`scenario ${iv.name}: ${resolved.errors.join('; ')}`);
        return { ...iv, args: resolved.params as Record<string, Scalar> };
      });
      const params = r.params, wo = typeof spec.world === 'function' ? spec.world(params) : spec.world;
      const w = createAgentWorld({ ...wo, seed: input.seed });
      if (spec.turtlesOwn) w.turtlesOwn(spec.turtlesOwn);
      for (const b of Object.values(spec.breeds || {})) if (b.own) w.turtlesOwn(b.own);           // every variable is a column of the turtle table
      if (spec.patchesOwn) w.patchesOwn(spec.patchesOwn);
      const breeds: Record<string, Breed> = {}, linkBreeds: Record<string, LinkBreed> = {};
      for (const name of Object.keys(spec.breeds || {})) breeds[name] = w.breed(name);
      for (const [name, l] of Object.entries(spec.linkBreeds || {})) { linkBreeds[name] = w.linkBreed(name, l.directed); if (l.own) w.linksOwn(l.own); }
      const m = Object.assign(Object.create(w), {
        params, globals: { ...(spec.globals || {}) }, breeds, linkBreeds, world: input.world,
        data(name: string) { const d = input.data[name]; if (!d) throw new Error(`data: no table named ${name}`); return d; },
      }) as Ctx;
      scenario.sort((a, b) => a.t - b.t);
      let next = 0, done = false;
      spec.setup(m);
      try { void w.ticks; } catch { w.resetTicks(); }                                                    // setup without reset-ticks: start the clock at 0
      const frameNow = (): Frame => {
        const cols = w.columns(), ents: Frame['entities'] = {};
        for (const [name, b] of Object.entries(spec.breeds || {})) {
          const bid = breeds[name].id, slots: number[] = [];
          for (let i = 0; i < cols.high; i++) if (cols.alive[i] && cols.breed[i] === bid) slots.push(i);
          const e: Record<string, Column> = { id: Int32Array.from(slots, i => cols.who[i]) };
          const kind = entities[name].kind;
          if (kind === 'mobile') { e.x = Float32Array.from(slots, i => cols.x[i]); e.y = Float32Array.from(slots, i => cols.y[i]); }
          if (kind === 'anchored') e.anchor = Int32Array.from(slots, i => cols.vars.anchor[i]);
          for (const [f, fs] of Object.entries(entities[name].fields)) { const src = cols.vars[f], c = columnFor(fs.type, slots.length); slots.forEach((i, k) => { c[k] = src[i]; }); e[f] = c; }
          void b; ents[name] = e;
        }
        if (spec.linkBreeds) {
          const L = w.linkColumns();
          for (const [name, l] of Object.entries(spec.linkBreeds)) {
            if (l.frame === false) continue;
            const lid = linkBreeds[name].id, slots: number[] = [];
            for (let i = 0; i < L.high; i++) if (L.alive[i] && L.breed[i] === lid) slots.push(i);
            const e: Record<string, Column> = { id: Int32Array.from(slots, i => L.id[i]), from: Int32Array.from(slots, i => L.aw[i]), to: Int32Array.from(slots, i => L.bw[i]) };
            for (const f of Object.keys(entities[name].fields)) { const src = L.vars[f], c = columnFor(entities[name].fields[f].type, slots.length); slots.forEach((i, k) => { c[k] = src[i]; }); e[f] = c; }
            ents[name] = e;
          }
        }
        const ser: Frame['series'] = {};
        for (const [name, p] of Object.entries(spec.plots || {})) ser[name] = Object.values(p.pens).map(fn => fn(m));
        for (const [name, mo] of Object.entries(spec.monitors || {})) ser['monitor:' + name] = [mo.value(m)];
        const f = { t: w.ticks, entities: ents, series: ser };
        const errs = checkFrame(desc, f); if (errs.length) throw new Error('frame: ' + errs.join('; '));
        return f;
      };
      let frame = frameNow();
      return {
        get frame() { return frame; }, get done() { return done; },
        step(): Frame {
          if (done) return frame;
          const t = w.ticks;
          while (next < scenario.length && scenario[next].t <= t) { const iv = scenario[next++]; if (iv.t === t) spec.interventions![iv.name].run(m, iv.args); }   // at tick t, before the step from t to t + 1
          const go = spec.go(m);
          if (go === false && w.ticks === t) { done = true; return frame; }                       // NetLogo `stop`: the run ends where it is
          if (w.ticks !== t + 1) throw new Error(`go did not advance the clock by one tick (from ${t} to ${w.ticks})`);
          frame = frameNow();
          if (go === false || w.ticks >= spec.time.horizon || (spec.stop && spec.stop(m))) done = true;
          return frame;
        },
      };
    },
  };
}
export type { AnyAgent };
