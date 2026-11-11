// Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0). World import path only.
// The model contract (plan 3.1): what every model gives the engine, and what the engine gives a run. Converted NetLogo models get it from
// defineModel; the legacy packs get it from @paperdolls/session's adapter. Nothing else crosses between a model and the engine.
import type { World } from './world.ts';

export type Scalar = number | string | boolean;
export type ParamValue = Scalar | number[];

interface ParamBase { label?: string; unit?: string; group?: string; help?: string; tier?: 'lever' | 'assumption' | 'structural'; exposable?: boolean; activeWhen?: Record<string, Scalar> }
export type ParamSpec =
  | (ParamBase & { type: 'number' | 'integer'; min: number; max: number; step?: number; default: number })
  | (ParamBase & { type: 'boolean'; default: boolean })
  | (ParamBase & { type: 'choice'; values: { value: string; label?: string }[]; default: string })
  | (ParamBase & { type: 'array'; length: number; min: number; max: number; step?: number; default: number[] });

export type FieldType = 'f64' | 'f32' | 'i32' | 'i16' | 'i8' | 'u8' | 'bool' | 'category';
export interface FieldSpec { type: FieldType; values?: string[]; label?: string }
export type EntityKind = 'anchored' | 'mobile' | 'unplaced' | 'link';
/** anchored: has `anchor` (an index into world.layers[layer]); mobile: has `x` and `y`; link: has `from` and `to` (entity ids); every kind has `id`. */
export interface EntitySpec { kind: EntityKind; layer?: string; fields: Record<string, FieldSpec>; privacy?: 'aggregate'; label?: string }
export interface SeriesSpec { label?: string; unit?: string; y: string[] }
export interface KpiSpec { label?: string; unit?: string; series: string; y?: string }
export interface InterventionSpec { label?: string; args: Record<string, ParamSpec> }
export interface Description {
  title: string;
  time: { unit: string; horizon: number };
  params: Record<string, ParamSpec>;
  entities: Record<string, EntitySpec>;
  series: Record<string, SeriesSpec>;
  kpis: Record<string, KpiSpec>;
  interventions: Record<string, InterventionSpec>;
  reads: { world: string[]; data: string[] };
}

export type Column = Float64Array | Float32Array | Int32Array | Int16Array | Int8Array | Uint8Array;
export interface ModelEvent { type: string; t: number; entity?: [string, number]; data?: Record<string, Scalar> }
/** One tick: per entity kind, one typed array per field (all the same length, the kind's count at that tick); per series, one value per name. */
export interface Frame { t: number; entities: Record<string, Record<string, Column>>; series: Record<string, number[]>; events?: ModelEvent[] }
export interface Intervention { t: number; name: string; args: Record<string, Scalar> }
export interface DataTable { columns: string[]; rows: Scalar[][] }
export interface RunInput { params: Record<string, ParamValue>; scenario: Intervention[]; world: World | null; data: Record<string, DataTable>; seed: number }
export interface Run { readonly frame: Frame; step(): Frame; readonly done: boolean }
export interface Model { describe(): Description; start(input: RunInput): Run }

const COLUMN = { f64: Float64Array, f32: Float32Array, i32: Int32Array, i16: Int16Array, i8: Int8Array, u8: Uint8Array, bool: Uint8Array, category: Int16Array } as const;
export function columnFor(t: FieldType, n: number): Column { return new COLUMN[t](n); }

/** Parameters made complete (defaults for what is missing) and checked: numbers in range (snapped to step only if asked), integers whole, choices
 * known, arrays the right length. All or nothing: an error leaves nothing applied. */
export function resolveParams(desc: Description, given: Record<string, ParamValue>, o: { snap?: boolean } = {}): { ok: true; params: Record<string, ParamValue> } | { ok: false; errors: string[] } {
  const errors: string[] = [], out: Record<string, ParamValue> = {};
  for (const k of Object.keys(given)) if (!(k in desc.params)) errors.push(`params.${k}: not a parameter of this model`);
  for (const [k, s] of Object.entries(desc.params)) {
    const v = k in given ? given[k] : s.default;
    const where = `params.${k}`;
    if (s.type === 'number' || s.type === 'integer') {
      if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${where}: ${JSON.stringify(v)} is not a finite number`); continue; }
      if (s.type === 'integer' && !Number.isInteger(v)) { errors.push(`${where}: ${v} is not a whole number`); continue; }
      if (v < s.min || v > s.max) { errors.push(`${where}: ${v} is outside ${s.min} to ${s.max}`); continue; }
      out[k] = o.snap && s.step ? Math.min(s.max, Math.max(s.min, s.min + Math.round((v - s.min) / s.step) * s.step)) : v;
    } else if (s.type === 'boolean') {
      if (typeof v !== 'boolean') { errors.push(`${where}: ${JSON.stringify(v)} is not true or false`); continue; }
      out[k] = v;
    } else if (s.type === 'choice') {
      if (!s.values.some(c => c.value === v)) { errors.push(`${where}: ${JSON.stringify(v)} is not one of ${s.values.map(c => c.value).join(', ')}`); continue; }
      out[k] = v;
    } else {
      const a = s as Extract<ParamSpec, { type: 'array' }>;
      if (!Array.isArray(v) || v.length !== a.length || v.some(x => typeof x !== 'number' || !Number.isFinite(x) || x < a.min || x > a.max)) { errors.push(`${where}: needs ${a.length} numbers from ${a.min} to ${a.max}`); continue; }
      out[k] = v.slice();
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, params: out };
}

/** Problems with a frame against the description: missing or extra kinds and fields, wrong lengths, missing ids, anchors or positions, series
 * of the wrong width. An empty list means the frame is good. */
export function checkFrame(desc: Description, f: Frame, expectT?: number): string[] {
  const errs: string[] = [];
  if (!Number.isInteger(f.t) || f.t < 0) errs.push(`t: ${f.t} is not a tick`);
  if (expectT !== undefined && f.t !== expectT) errs.push(`t: ${f.t}, expected ${expectT}`);
  for (const [kind, spec] of Object.entries(desc.entities)) {
    const cols = f.entities[kind];
    if (!cols) { errs.push(`entities.${kind}: missing`); continue; }
    const need = ['id', ...(spec.kind === 'anchored' ? ['anchor'] : spec.kind === 'mobile' ? ['x', 'y'] : spec.kind === 'link' ? ['from', 'to'] : []), ...Object.keys(spec.fields)];
    const n = cols.id ? cols.id.length : -1;
    for (const field of need) {
      const c = cols[field];
      if (!c) { errs.push(`entities.${kind}.${field}: missing`); continue; }
      if (!ArrayBuffer.isView(c)) { errs.push(`entities.${kind}.${field}: not a typed array`); continue; }
      if (c.length !== n) errs.push(`entities.${kind}.${field}: length ${c.length}, the kind has ${n}`);
    }
    for (const field of Object.keys(cols)) if (!need.includes(field)) errs.push(`entities.${kind}.${field}: not declared`);
  }
  for (const kind of Object.keys(f.entities)) if (!(kind in desc.entities)) errs.push(`entities.${kind}: not declared`);
  for (const [name, s] of Object.entries(desc.series)) {
    const v = f.series[name];
    if (!v) errs.push(`series.${name}: missing`);
    else if (v.length !== s.y.length) errs.push(`series.${name}: ${v.length} values, expected ${s.y.length}`);
  }
  return errs;
}
