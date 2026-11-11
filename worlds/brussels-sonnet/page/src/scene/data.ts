// Scene step 7: data in the world. Only model-declared fields change appearance: building retrofit state (top colour, 3 states + not modelled),
// shared-measure status (roof pennant), adoption progress (cladded storeys). Colours come from the art bible's ramp; the legend samples these same functions.
import * as THREE from 'three';
import { P, oklch, hex, LCH, ramp } from './palette';
import { lensU } from './lens';
import type { BuildingsHandle, Bd } from './buildings';
import type { Pipeline } from './pipeline';

export const STATE_NAMES = ['No unit retrofitted', 'Partly retrofitted', 'Fully retrofitted', 'Rental: not modelled'];
export const rampColor = (s: number): string => (s <= 0 ? hex(P.rampA) : s === 1 ? hex(P.rampB) : s === 2 ? hex(P.rampC) : hex(P.noData));
/** state t in [0,1] along the ramp: 0 none, 0.5 partial, 1 done */
export const rampAt = (t: number) => (t <= 0.5 ? ramp(t * 2, P.rampA, P.rampB) : ramp((t - 0.5) * 2, P.rampB, P.rampC));
export const CLAD: LCH = [0.80, 0.035, 295];
export const neutral = (c: THREE.Color): THREE.Color => { const o = { h: 0, s: 0, l: 0 }; c.getHSL(o); return new THREE.Color().setHSL(o.h, o.s * 0.15, o.l); };

export interface DataHandle {
  group: THREE.Group;
  setFrame(f: { bstate: ArrayLike<number>; adopted: ArrayLike<number>; units: ArrayLike<number>; shared: ArrayLike<number>; anchor: ArrayLike<number> }): void;
  setLens(on: boolean): void; lens(): boolean; setView(viewW: number): void; reset(): void;
  stateOf(bi: number): number; sharedOf(bi: number): number; frac(bi: number): number;
}

export function buildData(pipe: Pipeline, B: BuildingsHandle, bound: Uint8Array | boolean[]): DataHandle {
  const group = new THREE.Group(); group.name = 'data';
  const bds = B.bds; const n = bds.length;
  const state = new Int8Array(n).fill(-1), sharedS = new Int8Array(n), fracA = new Float32Array(n), nunits = new Int16Array(n);
  let lens = false;
  const rampCol = [0, 1, 2].map((s) => new THREE.Color(rampColor(s))); const noData = new THREE.Color(hex(P.noData));
  const tmp = new THREE.Color(); const trim = new THREE.Color(hex(P.trim));

  // ---- pennants (shared measure): pole + pennant on the roof corner of condo buildings that need a shared measure; and cladding bands for progress
  const toon = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: pipe.toon });
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  const tri = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0.5, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0.5], 3)); g.computeVertexNormals(); return g; })();
  const poleI = new THREE.InstancedMesh(box, toon, n), flagI = new THREE.InstancedMesh(tri, toon, n), cladI = new THREE.InstancedMesh(box, toon, n * 4);
  for (const o of [poleI, flagI, cladI]) { o.count = 0; o.castShadow = o === poleI; o.frustumCulled = false; group.add(o); }
  poleI.name = 'pennant-poles'; flagI.name = 'pennants'; cladI.name = 'cladding';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3(), zz = new THREE.Vector3(0, 0, 1);
  const flagM = new Map<number, THREE.Matrix4>(); const poleM = new Map<number, THREE.Matrix4>();
  const flagIdx = new Int32Array(n).fill(-1);           // building -> slot in poleI/flagI
  const cladIdx = new Int32Array(n).fill(-1);           // building -> first slot in cladI (lv slots)
  const flagBuildings: number[] = []; let nc = 0;
  const poleCol = new THREE.Color(hex([0.30, 0.012, 250]));
  for (const b of bds) {
    if (!bound[b.i]) continue;
    // cladding: one overlay box per storey on rect bodies
    if (b.fits && b.roof !== 'low' && b.roof !== 'ext') { cladIdx[b.i] = nc; nc += b.lv; }
  }
  cladI.count = nc;
  const clad = new THREE.Color(hex(CLAD));
  for (const b of bds) {
    if (cladIdx[b.i] < 0) continue; const R = b.rect;
    for (let s = 0; s < b.lv; s++) {
      const z0 = s === 0 ? 0.85 : 3.2 + (s - 1) * 3.1, h = s === 0 ? 2.3 : 3.1 - 0.3;
      q.setFromAxisAngle(zz, R.ang); ps.set(R.cx, R.cy, z0 + (s === 0 ? 0 : 0.2)); sc.set(R.L + 0.05, R.W + 0.05, 0.001); m4.compose(ps, q, sc); cladI.setMatrixAt(cladIdx[b.i] + s, m4); cladI.setColorAt(cladIdx[b.i] + s, clad);
      void h;
    }
  }
  // (cladding overlay boxes start collapsed; setFrame sizes the ones whose storey is complete)
  cladI.instanceMatrix.needsUpdate = true; if (cladI.instanceColor) cladI.instanceColor.needsUpdate = true;

  const setClad = (b: Bd, k: number) => { // k storeys cladded from the bottom
    const R = b.rect; const base = cladIdx[b.i]; if (base < 0) return;
    for (let s = 0; s < b.lv; s++) {
      const on = s < k; const z0 = s === 0 ? 0.85 : 3.2 + (s - 1) * 3.1; const h = s === 0 ? 2.35 : 3.1;
      q.setFromAxisAngle(zz, R.ang); ps.set(R.cx, R.cy, z0); sc.set(R.L + 0.06, R.W + 0.06, on ? h : 0.0001); m4.compose(ps, q, sc); cladI.setMatrixAt(base + s, m4);
    }
  };
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const showFlag = (slot: number, on: boolean) => { flagI.setMatrixAt(slot, on ? flagM.get(slot)! : zero); poleI.setMatrixAt(slot, on ? poleM.get(slot)! : zero); poleI.instanceMatrix.needsUpdate = true; flagI.instanceMatrix.needsUpdate = true; };
  const setFlag = (b: Bd, st: number) => { // st 1 pending, 2 approved
    let slot = flagIdx[b.i]; if (slot < 0) { slot = flagBuildings.length; flagBuildings.push(b.i); flagIdx[b.i] = slot; poleI.count = flagBuildings.length; flagI.count = flagBuildings.length;
      const R = b.rect; const ca = Math.cos(R.ang), sa = Math.sin(R.ang); const cx = R.cx + ca * (R.L / 2 - 0.7) - sa * (R.W / 2 - 0.7), cy = R.cy + sa * (R.L / 2 - 0.7) + ca * (R.W / 2 - 0.7);
      const top = b.roof === 'gable' || b.roof === 'hip' ? b.Hb + 1.8 : b.Hb + 0.1;
      q.identity(); ps.set(cx, cy, top); sc.set(0.1, 0.1, 2.4); m4.compose(ps, q, sc); poleM.set(slot, m4.clone()); poleI.setColorAt(slot, poleCol);
      q.setFromAxisAngle(zz, R.ang + 0.4); ps.set(cx, cy, top + 1.1); sc.set(1.5, 1, 1.2); m4.compose(ps, q, sc); flagM.set(slot, m4.clone());
    }
    flagI.setColorAt(slot, st === 2 ? rampCol[2] : rampCol[0]); showFlag(slot, st === 2 || lens); if (flagI.instanceColor) flagI.instanceColor.needsUpdate = true;
  };

  // ---- top colour: caps carry the ramp (ridge cap / coping), roofs a <= 8 % tint (100 % in the lens)
  const colorBuilding = (bi: number) => {
    const s = state[bi]; const noD = s === 3 || s < 0; const rc = s === 3 ? noData : s < 0 ? null : rampCol[s];
    for (const pt of B.partsOf(bi)) {
      if (pt.kind === 'body') continue; const aH = pt.mesh.geometry.getAttribute('aHatch') as THREE.InstancedBufferAttribute | undefined;
      const base = pt.mesh.userData.base as Float32Array; tmp.setRGB(base[pt.i * 3], base[pt.i * 3 + 1], base[pt.i * 3 + 2]);
      if (rc === null) { /* unbound scenery or before the first frame: default colours */ }
      else if (pt.kind === 'cap') tmp.copy(rc);
      else tmp.lerp(rc, lens ? 1 : (s === 1 || s === 2 ? 0.08 : 0));
      pt.mesh.setColorAt(pt.i, tmp); if (aH) aH.setX(pt.i, noD && rc !== null && (pt.kind === 'cap' || lens) ? 1 : 0);
    }
    const top = B.extTop(bi); const em = B.extMesh();
    if (top && em) { const col = em.geometry.getAttribute('color') as THREE.BufferAttribute; const c = bds[bi].roofCol.clone(); if (rc) c.lerp(rc, lens ? 1 : (s === 1 || s === 2 ? 0.08 : 0)); for (const v of top) col.setXYZ(v, c.r, c.g, c.b); col.needsUpdate = true; }
  };
  const dirty = new Set<THREE.InstancedMesh>();
  const flush = () => { for (const m of B.group.children) { const im = m as THREE.InstancedMesh; if (im.isInstancedMesh) { if (im.instanceColor) im.instanceColor.needsUpdate = true; const a = im.geometry.getAttribute('aHatch'); if (a) a.needsUpdate = true; } } void dirty; };

  function setFrame(f: Parameters<DataHandle['setFrame']>[0]) {
    let changed = false; let cladChanged = false; let flagChanged = false;
    for (let k = 0; k < f.anchor.length; k++) {
      const bi = f.anchor[k]; const s = f.bstate[k], sh = f.shared[k]; const fr = f.units[k] > 0 ? f.adopted[k] / f.units[k] : 0;
      if (state[bi] !== s) { state[bi] = s; colorBuilding(bi); changed = true; }
      if (sharedS[bi] !== sh || flagIdx[bi] < 0 && sh > 0) { sharedS[bi] = sh; if (sh > 0) { setFlag(bds[bi], sh); flagChanged = true; } }
      if (Math.abs(fracA[bi] - fr) > 1e-6 || nunits[bi] !== f.units[k]) { fracA[bi] = fr; nunits[bi] = f.units[k]; const bd = bds[bi]; setClad(bd, Math.round(fr * bd.lv)); cladChanged = true; }
    }
    if (changed) flush(); if (cladChanged) cladI.instanceMatrix.needsUpdate = true; if (flagChanged) { flagI.instanceColor && (flagI.instanceColor.needsUpdate = true); poleI.instanceColor && (poleI.instanceColor.needsUpdate = true); }
  }
  function setLens(on: boolean) {
    lens = on; lensU.value = on ? 1 : 0; for (const bi of flagBuildings) showFlag(flagIdx[bi], sharedS[bi] === 2 || on);
    for (let bi = 0; bi < n; bi++) {
      if (state[bi] !== -1) { colorBuilding(bi); continue; }
      for (const pt of B.partsOf(bi)) { if (pt.kind === 'body') continue; const base = pt.mesh.userData.base as Float32Array; tmp.setRGB(base[pt.i * 3], base[pt.i * 3 + 1], base[pt.i * 3 + 2]); pt.mesh.setColorAt(pt.i, on ? neutral(tmp) : tmp); }
    }
    flush();
  }
  function reset() {
    for (let bi = 0; bi < n; bi++) { if (state[bi] === -1 && sharedS[bi] === 0 && fracA[bi] === 0) continue; state[bi] = -1; sharedS[bi] = 0; fracA[bi] = 0; nunits[bi] = 0; setClad(bds[bi], 0);
      for (const pt of B.partsOf(bi)) { if (pt.kind === 'body') continue; const base = pt.mesh.userData.base as Float32Array; tmp.setRGB(base[pt.i * 3], base[pt.i * 3 + 1], base[pt.i * 3 + 2]); pt.mesh.setColorAt(pt.i, lens ? neutral(tmp) : tmp); const aH = pt.mesh.geometry.getAttribute('aHatch') as THREE.InstancedBufferAttribute | undefined; if (aH) aH.setX(pt.i, 0); }
      const top = B.extTop(bi), em = B.extMesh(); if (top && em) { const col = em.geometry.getAttribute('color') as THREE.BufferAttribute; const c = bds[bi].roofCol; for (const v of top) col.setXYZ(v, c.r, c.g, c.b); col.needsUpdate = true; } }
    flagBuildings.length = 0; flagIdx.fill(-1); poleI.count = 0; flagI.count = 0; cladI.instanceMatrix.needsUpdate = true; flush();
  }
  function setView(viewW: number) { const show = viewW < 460; flagI.visible = show; poleI.visible = show; cladI.visible = viewW < 700; }
  return { group, setFrame, setLens, lens: () => lens, setView, reset, stateOf: (bi) => state[bi], sharedOf: (bi) => sharedS[bi], frac: (bi) => fracA[bi] };
}
void oklch;
