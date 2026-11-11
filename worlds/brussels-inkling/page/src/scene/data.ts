// Step 7: data in the world. Only the binding's declared fields change appearance:
// top_color `retrofit_share` -> roof tint <= 8 % + ridge cap (pitched) / coping band (flat),
// architecture `shared_pending` -> azure pennant (mark/flag),
// architecture `retrofit_share` -> storey "cladding" bands bottom-up (extent/segments).
// Missing data is "no data" + 45° hatch. recipes: data-in-the-world.md
import * as THREE from 'three';
import { plum, NO_DATA, RAMP_STOPS } from './palette.ts';
import { applyData, type BuildingsOut } from './buildings.ts';
import { ZERO } from './util.ts';

export interface DataLayer {
  apply(frame: any | null): void;
  valueOf(structIdx: number): { depth: number | null; approved: boolean | null };
}

export function createDataLayer(b: BuildingsOut, binding: any, nStructs: number): DataLayer {
  const top = binding.bindings?.[0]?.top_color;
  const field: string = top?.field ?? 'retrofit_share';
  const entity: string = binding.bindings?.[0]?.entity ?? 'households';
  const [d0, d1] = top?.domain ?? [0, 1];
  const arch = (binding.architecture ?? []).find((a: any) => a.preset === 'flag');
  const flagField: string | undefined = arch?.field;
  const flagColour = new THREE.Color(arch?.scale?.palette?.['true'] ?? '#398ccc');
  const colour = new Float32Array(nStructs * 3);
  const has = new Uint8Array(nStructs);
  const depth = new Float64Array(nStructs).fill(NaN);
  const shares = new Float32Array(nStructs).fill(0);
  const approved = new Int8Array(nStructs).fill(-1);
  // pre-computed ramp in linear space (256 steps) so the per-frame loop does no colour maths
  const lut = new Float32Array(256 * 3);
  const c = new THREE.Color();
  for (let i = 0; i < 256; i++) { c.set(plum(i / 255)); lut[i * 3] = c.r; lut[i * 3 + 1] = c.g; lut[i * 3 + 2] = c.b; }
  const nd = new THREE.Color(NO_DATA);
  for (let i = 0; i < b.flags.mesh.count; i++) b.flags.mesh.setColorAt(i, flagColour);

  function apply(frame: any | null) {
    has.fill(0); depth.fill(NaN); approved.fill(-1); shares.fill(0);
    const e = frame?.entities?.[entity];
    if (e && e.anchor) {
      const vals = e[field], ap = flagField ? e[flagField] : null;
      for (let k = 0; k < e.anchor.length; k++) {
        const s = e.anchor[k];
        if (s < 0 || s >= nStructs) continue;
        const v = vals?.[k];
        if (v === undefined || v === null || Number.isNaN(v)) continue;
        const t = Math.min(1, Math.max(0, (v - d0) / ((d1 - d0) || 1)));
        const li = Math.round(t * 255) * 3;
        colour[s * 3] = lut[li]; colour[s * 3 + 1] = lut[li + 1]; colour[s * 3 + 2] = lut[li + 2];
        has[s] = 1; depth[s] = v; shares[s] = t;
        if (ap) approved[s] = ap[k] ? 1 : 0;
      }
    }
    for (let s = 0; s < nStructs; s++) if (!has[s]) { colour[s * 3] = nd.r; colour[s * 3 + 1] = nd.g; colour[s * 3 + 2] = nd.b; }
    applyData(b.dataMeshes, colour, has);
    b.clad.setShares(shares);
    // flags: one pole + pennant per structure, shown while a shared-measure vote is pending
    const fm = b.flags.mesh, pm = b.flags.pole, st = fm.userData.struct as Int32Array;
    for (let i = 0; i < fm.count; i++) {
      const on = approved[st[i]] === 1;
      fm.setMatrixAt(i, on ? b.flags.mats[i * 2 + 1] : ZERO);
      pm.setMatrixAt(i, on ? b.flags.mats[i * 2] : ZERO);
    }
    fm.instanceMatrix.needsUpdate = pm.instanceMatrix.needsUpdate = true;
  }
  return {
    apply,
    valueOf: (s) => ({ depth: Number.isNaN(depth[s]) ? null : depth[s], approved: approved[s] < 0 ? null : approved[s] === 1 }),
  };
}

/** Legend swatches sampled from the same function that colours the scene (data-in-the-world §7). */
export const LEGEND = { stops: RAMP_STOPS, css: `linear-gradient(90deg, ${RAMP_STOPS.join(',')})`, noData: NO_DATA };
