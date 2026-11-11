// Step 7: data in the world. Only the binding's declared fields change appearance:
//  - top_color `retrofit_state` (0/1/2, NaN = rental) -> ridge cap / coping band at full strength,
//    roof tint <= 8 % in the beauty view; whole roof + upper 30 % of walls in the lens;
//  - architecture `approved` -> a teal pennant on a 2 m pole;
//  - architecture `adoption` -> completed storeys clad bottom-up in pale sage render.
import * as THREE from 'three';
import { plum, NO_DATA, RAMP_STOPS } from './palette.ts';
import { applyData, type BuildingsOut } from './buildings.ts';
import { ZERO } from './util.ts';

const STATE_LABEL = ['no unit done', 'partly done', 'fully retrofitted'];

export interface DataLayer {
  apply(frame: any | null): void;
  valueOf(structIdx: number): { state: number | null; adoption: number | null; approved: boolean | null; label: string };
  stats: Record<string, number>;
}

export function createDataLayer(b: BuildingsOut, binding: any, nStructs: number): DataLayer {
  const top = binding.bindings?.[0]?.top_color;
  const field: string = top?.field ?? 'retrofit_state';
  const entity: string = binding.bindings?.[0]?.entity ?? 'buildings';
  const [d0, d1] = top?.domain ?? [0, 2];
  const arch = binding.architecture ?? [];
  const flagArch = arch.find((a: any) => a.preset === 'flag');
  const cladArch = arch.find((a: any) => a.preset === 'segments');
  const flagField: string | undefined = flagArch?.field;
  const cladField: string | undefined = cladArch?.field;
  const flagColour = new THREE.Color(flagArch?.scale?.palette?.['true'] ?? '#007c7c');

  const colour = new Float32Array(nStructs * 3);
  const state = new Int8Array(nStructs).fill(-1);     // -1 not an entity, 0 entity no data, 1 value
  const value = new Float64Array(nStructs).fill(NaN);
  const approved = new Int8Array(nStructs).fill(-1);
  const adoption = new Float64Array(nStructs).fill(NaN);
  const lut = new Float32Array(256 * 3);
  const c = new THREE.Color();
  for (let i = 0; i < 256; i++) { c.set(plum(i / 255)); lut[i * 3] = c.r; lut[i * 3 + 1] = c.g; lut[i * 3 + 2] = c.b; }
  const nd = new THREE.Color(NO_DATA);

  for (let i = 0; i < b.flags.mesh.count; i++) b.flags.mesh.setColorAt(i, flagColour);
  const stats = { entities: 0, noData: 0, withData: 0, approved: 0, cladInstances: 0 };

  function apply(frame: any | null) {
    state.fill(-1); value.fill(NaN); approved.fill(-1); adoption.fill(NaN);
    const e = frame?.entities?.[entity];
    if (e && e.anchor) {
      const vals = e[field];
      const ap = flagField ? e[flagField] : null;
      const ad = cladField ? e[cladField] : null;
      for (let k = 0; k < e.anchor.length; k++) {
        const s = e.anchor[k];
        if (s < 0 || s >= nStructs) continue;
        const v = vals?.[k];
        if (v === undefined || Number.isNaN(v)) { state[s] = 0; continue; }
        const t = Math.min(1, Math.max(0, (v - d0) / ((d1 - d0) || 1)));
        const li = Math.round(t * 255) * 3;
        colour[s * 3] = lut[li]; colour[s * 3 + 1] = lut[li + 1]; colour[s * 3 + 2] = lut[li + 2];
        state[s] = 1; value[s] = v;
        if (ap) approved[s] = ap[k] ? 1 : 0;
        if (ad) adoption[s] = ad[k];
      }
    }
    for (let s = 0; s < nStructs; s++) if (state[s] !== 1) { colour[s * 3] = nd.r; colour[s * 3 + 1] = nd.g; colour[s * 3 + 2] = nd.b; }
    applyData(b.dataMeshes, colour, state);

    // pennants: one pole + flag per structure, shown where the shared measure passed
    const fm = b.flags.mesh, pm = b.flags.pole, st = fm.userData.struct as Int32Array;
    for (let i = 0; i < fm.count; i++) {
      const on = approved[st[i]] === 1;
      fm.setMatrixAt(i, on ? b.flags.mats[i * 2 + 1] : ZERO);
      pm.setMatrixAt(i, on ? b.flags.mats[i * 2] : ZERO);
    }
    fm.instanceMatrix.needsUpdate = pm.instanceMatrix.needsUpdate = true;

    // cladding: completed storeys bottom-up, only for modelled buildings with a value
    const cl = b.cladding;
    for (let i = 0; i < cl.mesh.count; i++) {
      const s = cl.struct[i], lv = cl.level[i], levels = cl.levels[i];
      const a = adoption[s];
      const done = state[s] === 1 && Number.isFinite(a) ? Math.round(a * levels) : 0;
      cl.mesh.setMatrixAt(i, lv < done ? cl.mats[i] : ZERO);
    }
    cl.mesh.instanceMatrix.needsUpdate = true;

    let ent = 0, ndc = 0, wd = 0, ap2 = 0, ci = 0;
    for (let s = 0; s < nStructs; s++) {
      if (state[s] >= 0) ent++;
      if (state[s] === 0) ndc++;
      if (state[s] === 1) wd++;
      if (approved[s] === 1) ap2++;
    }
    for (let i = 0; i < cl.mesh.count; i++) {
      const s = cl.struct[i], a = adoption[s];
      if (state[s] === 1 && Number.isFinite(a) && cl.level[i] < Math.round(a * cl.levels[i])) ci++;
    }
    stats.entities = ent; stats.noData = ndc; stats.withData = wd; stats.approved = ap2; stats.cladInstances = ci;
  }
  return {
    apply,
    stats,
    valueOf: (s) => ({
      state: Number.isNaN(value[s]) ? null : value[s],
      adoption: Number.isNaN(adoption[s]) ? null : adoption[s],
      approved: approved[s] < 0 ? null : approved[s] === 1,
      label: Number.isNaN(value[s]) ? 'no data' : STATE_LABEL[Math.round(value[s])] ?? 'no data',
    }),
  };
}

/** Legend swatches sampled from the same function that colours the scene. */
export const LEGEND = { stops: RAMP_STOPS, css: `linear-gradient(90deg, ${RAMP_STOPS.join(',')})`, noData: NO_DATA };
