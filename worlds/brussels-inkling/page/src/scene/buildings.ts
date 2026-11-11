// Steps 2 + 4 of the build order: masses, roofs, facades, roof furniture, the signature motif
// (crow-stepped gables + Jette's polychrome brick string courses) and the landmark (UZ Brussel slab).
// recipes: buildings.md. Jette: mostly pitched brick terraces and interwar blocks; the hospital landmark is a real structure.
import * as THREE from 'three';
import { P, hex } from './palette.ts';
import { Parts, houseMat, mat, rng, unitBox, unitGable, unitHip, unitWedge, varied, col, shade, canvasTex, pick, ZERO, type DataSlots } from './util.ts';
import type { Layout, Struct, Face } from './layout.ts';

const STOREY = 3.1;
// beauty-view roof tint toward the ramp. data-in-the-world §2 says 45 %; at 45 % data covered ~40 % of building
// pixels (house style: <= 15 %) and the pale ramp end lifted dark roofs above the walls. 18 % + a full ridge cap instead.
const TINT = 0.08;
const BAY: Record<string, number> = { villa: 2.9, terrace: 2.7, block: 3.2, shophouse: 3.4, shed: 6.5, tower: 3.0, church: 4.6 };
type Roof = 'gable' | 'hip' | 'flat' | 'mono';

export interface Cladding {
  mesh: THREE.InstancedMesh;
  setShares(shares: Float32Array): void;   // retrofit share per structure, 0..1; bottom-up storeys re-clad
}
export interface BuildingsOut {
  group: THREE.Group;
  lod: { mid: THREE.Object3D[]; near: THREE.Object3D[] };
  dataMeshes: THREE.InstancedMesh[];
  pickMesh: THREE.InstancedMesh;
  flags: { mesh: THREE.InstancedMesh; pole: THREE.InstancedMesh; mats: THREE.Matrix4[] };
  clad: Cladding;
  chimneys: THREE.Vector3[];
  tops: Float32Array;           // wall-top z per structure
  roofKind: Roof[];
  stats: Record<string, number>;
}

export function buildBuildings(lay: Layout): BuildingsOut {
  const box = unitBox();
  const parts = {
    wall: new Parts('wall'), infill: new Parts('gable-infill'),
    gable: new Parts('roof-gable'), hip0: new Parts('roof-hip0'), hip3: new Parts('roof-hip3'), hip6: new Parts('roof-hip6'),
    mono: new Parts('roof-mono'), flat: new Parts('roof-flat'), cap: new Parts('data-cap'),
    trimMajor: new Parts('trim-major'), trim: new Parts('trim-detail'), glass: new Parts('glass'), glassMid: new Parts('glass-mid'),
    accent: new Parts('accent'), awning: new Parts('awning'), dark: new Parts('dark'), metal: new Parts('metal'), roller: new Parts('roller'),
    spire: new Parts('spire'), flag: new Parts('flag'), pole: new Parts('flag-pole'),
    clad: new Parts('clad'),
  };
  const m = new THREE.Matrix4();
  const cladItems: { s: number; k: number; m: THREE.Matrix4 }[] = [];
  const chimneys: THREE.Vector3[] = [];
  const tops = new Float32Array(lay.structs.length);
  const roofKind: Roof[] = [];
  const flagMats: THREE.Matrix4[] = [];
  const stats: Record<string, number> = { crowStepped: 0, pitched: 0, flat: 0, shopfronts: 0, doors: 0, windows: 0, chimneys: 0, awnings: 0, litWindows: 0 };
  const trimC = col(P.trim), darkC = col(P.dark), glassC = col(P.glass);

  // neighbour-aware wall colour choice (palette-method §5, buildings §3)
  const wallBase: number[] = [];
  for (const s of lay.structs) {
    const r = rng(s.seed);
    let k: number;
    if (s.landmark) k = 0;
    else if (s.arch === 'shed') k = 3;
    else if (s.arch === 'villa') k = pick(r, [0, 1, 2, 3, 0, 1]);
    else if (s.arch === 'terrace') k = s.idx % 2 === 0 ? 0 : 1;
    else k = pick(r, [0, 0, 1, 1, 2, 3]);
    for (const n of s.neighbours) if (n < s.idx && wallBase[n] === k && s.arch !== 'terrace') k = (k + 1) % 4;
    wallBase.push(k);
    (s as any).wallIdx = k;
  }

  for (const s of lay.structs) {
    const r = rng(s.seed ^ 0x9e3779b9);
    const wallC = s.landmark ? varied([0.80, 0.014, 88], r, 0.01, 1) : varied(P.walls[wallBase[s.idx]], r, 0.03, 4);
    if (s.arch === 'shed') wallC.copy(varied(pick(r, [P.concrete, [0.70, 0.02, 60], P.walls[1]]), r, 0.03, 4));
    const roofC = varied(s.arch === 'shed' ? P.metal : s.arch === 'terrace' ? P.roofs[(Math.floor(s.idx / 4) % 2) ? 0 : 1] : pick(r, P.roofs), r, 0.02, 2);
    const groundH = s.arch === 'shophouse' || (s.arch === 'block' && s.distCentre < 160) ? 3.8 : s.arch === 'shed' ? 4.2 : 3.0;
    const storeyH = s.arch === 'shed' ? 3.6 : STOREY;
    const H = groundH + (s.levels - 1) * storeyH;
    tops[s.idx] = H;

    // ---- roof choice ----
    let roof: Roof;
    const u = r();
    if (s.landmark) roof = 'flat';
    else if (s.arch === 'tower') roof = 'flat';
    else if (s.arch === 'villa') roof = u < 0.6 ? 'gable' : 'hip';
    else if (s.arch === 'terrace') roof = 'gable';
    else if (s.arch === 'shophouse') roof = u < 0.7 ? 'gable' : 'flat';
    else if (s.arch === 'shed') roof = u < 0.5 ? 'mono' : 'gable';
    else roof = s.levels >= 6 ? (u < 0.6 ? 'flat' : 'hip') : (u < 0.5 ? 'gable' : u < 0.75 ? 'hip' : 'flat');
    roofKind.push(roof);

    // ridge direction: long axis by default; terraces run the ridge along the row; shophouses turn the gable to the street
    let rx = s.ax, ry = s.ay, RL = s.L, RW = s.W;
    const swap = () => { rx = s.ay; ry = [-s.ax[0], -s.ax[1]]; RL = s.W; RW = s.L; };
    if (s.arch === 'terrace' && s.neighbours.length) {
      const o = lay.structs[s.neighbours[0]];
      const d = [o.c[0] - s.c[0], o.c[1] - s.c[1]];
      if (Math.abs(d[0] * s.ay[0] + d[1] * s.ay[1]) > Math.abs(d[0] * s.ax[0] + d[1] * s.ax[1])) swap();
    }
    if (s.arch === 'shophouse' && roof === 'gable') {
      const mf = s.faces.find((f) => f.main)!;
      if (Math.abs(mf.n[0] * s.ax[0] + mf.n[1] * s.ax[1]) < 0.5) swap();   // gable end faces the main street
    }
    const ryaw = Math.atan2(rx[1], rx[0]);
    const pitch = THREE.MathUtils.degToRad(s.arch === 'shed' ? (roof === 'mono' ? 12 : 18) : s.arch === 'villa' ? 42 : 38);
    const rh = Math.min((RW / 2) * Math.tan(pitch), s.arch === 'shed' ? 4 : 14);
    const crow = roof === 'gable' && s.arch !== 'shed' && (s.arch === 'shophouse' ? r() < 0.75 : s.arch === 'terrace' ? s.neighbours.length < 2 && r() < 0.8 : r() < 0.3);
    const oh = s.arch === 'shed' ? 0.3 : 0.4;
    const [cx, cy] = s.c;

    // ---- masses (buildings §1) ----
    parts.wall.add(mat(cx, cy, 0, s.yaw, s.L, s.W, H), wallC, s.idx, H);
    // plinth band, wall L-0.08
    parts.wall.add(mat(cx, cy, 0, s.yaw, s.L + 0.3, s.W + 0.3, 0.7), shade(wallC, 0.78), s.idx, H);
    if (roof === 'flat') {
      stats.flat++;
      // cornice, parapet, coping band (data), roof slab
      parts.trimMajor.add(mat(cx, cy, H - 0.45, s.yaw, s.L + 0.5, s.W + 0.5, 0.4), trimC);
      const pH = 1.0, t = 0.28;
      const ring = (fn: (x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number) => void, z: number, hh: number, tt: number, grow = 0) => {
        fn(cx + s.ay[0] * (s.W / 2 - tt / 2 + grow / 2), cy + s.ay[1] * (s.W / 2 - tt / 2 + grow / 2), z, s.yaw, s.L + grow, tt, hh);
        fn(cx - s.ay[0] * (s.W / 2 - tt / 2 + grow / 2), cy - s.ay[1] * (s.W / 2 - tt / 2 + grow / 2), z, s.yaw, s.L + grow, tt, hh);
        fn(cx + s.ax[0] * (s.L / 2 - tt / 2 + grow / 2), cy + s.ax[1] * (s.L / 2 - tt / 2 + grow / 2), z, s.yaw, tt, s.W + grow, hh);
        fn(cx - s.ax[0] * (s.L / 2 - tt / 2 + grow / 2), cy - s.ax[1] * (s.L / 2 - tt / 2 + grow / 2), z, s.yaw, tt, s.W + grow, hh);
      };
      ring((x, y, z, yw, a, b, c) => parts.wall.add(mat(x, y, z, yw, a, b, c), wallC, s.idx, H), H, pH, t);
      ring((x, y, z, yw, a, b, c) => parts.cap.add(mat(x, y, z, yw, a, b, c), trimC, s.idx, H, 1), H + pH, 0.14, t + 0.12, 0.1);
      parts.flat.add(mat(cx, cy, H, s.yaw, s.L - 0.4, s.W - 0.4, 0.12), varied([0.47, 0.010, 250], r, 0.03, 3), s.idx, H, 0);
      // roof furniture (buildings §6)
      const nObj = 1 + Math.floor(r() * 4);
      for (let k = 0; k < nObj; k++) {
        const fx = (r() - 0.5) * (s.L - 4), fy = (r() - 0.5) * (s.W - 4);
        const px = cx + s.ax[0] * fx + s.ay[0] * fy, py = cy + s.ax[1] * fx + s.ay[1] * fy;
        const kind = r();
        if (kind < 0.25 && s.L > 10) parts.wall.add(mat(px, py, H, s.yaw, 2.5, 3, 2.6), shade(wallC, 0.95), s.idx, H);           // stair bulkhead
        else if (kind < 0.75) parts.metal.add(mat(px, py, H, s.yaw, 1.0, 0.8, 0.8), col(P.metal));                                  // AC unit
        else { parts.metal.add(mat(px, py, H, 0, 0.35, 0.35, 1.6), col([0.5, 0.01, 250])); }                                        // vent stack
      }
      if (s.arch === 'tower' || s.levels >= 6) {
        parts.metal.add(mat(cx - s.ax[0] * s.L * 0.2, cy - s.ax[1] * s.L * 0.2, H, s.yaw, 1.6, 1.6, 2.2), col([0.55, 0.012, 60]));  // water tank / lift room
      }
    } else if (roof === 'gable') {
      stats.pitched++;
      const endOh = crow ? 0 : oh;
      parts.gable.add(mat(cx, cy, H, ryaw, RL + 2 * endOh, RW + 2 * oh, rh + oh * Math.tan(pitch)), roofC, s.idx, H, TINT);
      parts.infill.add(mat(cx, cy, H, ryaw, RL, RW, rh - 0.05), wallC, s.idx, H);
      parts.cap.add(mat(cx, cy, H + rh + oh * Math.tan(pitch) - 0.12, ryaw, RL + 2 * endOh, 0.75, 0.3), trimC, s.idx, H, 1);
      parts.dark.add(mat(cx, cy, H - 0.14, ryaw, RL + 2 * endOh, RW + 2 * oh, 0.14), darkC);
      if (crow) {
        stats.crowStepped++;
        const N = 5;
        for (const sgn of [-1, 1]) {
          const ex = cx + rx[0] * sgn * (RL / 2 - 0.2), ey = cy + rx[1] * sgn * (RL / 2 - 0.2);
          for (let i = 0; i < N; i++) {
            const wI = RW * (1 - i / N), z0 = H + (i * rh) / N, hh = rh / N + 0.02;
            parts.wall.add(mat(ex, ey, z0, ryaw, 0.42, wI, hh), wallC, s.idx, H);
            // coping on each step's shoulders
            parts.trim.add(mat(ex, ey, z0 + hh, ryaw, 0.5, wI + 0.06, 0.07), trimC);
          }
          parts.wall.add(mat(ex, ey, H + rh, ryaw, 0.42, (RW / N) * 0.6, 0.9), wallC, s.idx, H);
          parts.trimMajor.add(mat(ex, ey, H + rh + 0.9, ryaw, 0.5, (RW / N) * 0.6 + 0.1, 0.08), trimC);
        }
      }
    } else if (roof === 'hip') {
      stats.pitched++;
      const ratio = Math.max(0, (RL - RW) / RL);
      const pk = ratio < 0.15 ? parts.hip0 : ratio < 0.45 ? parts.hip3 : parts.hip6;
      const rr = ratio < 0.15 ? 0 : ratio < 0.45 ? 0.3 : 0.6;
      parts.wall.add(mat(cx, cy, H, ryaw, RL, RW, 0.05), wallC, s.idx, H);
      pk.add(mat(cx, cy, H, ryaw, RL + 2 * oh, RW + 2 * oh, rh + oh * Math.tan(pitch)), roofC, s.idx, H, TINT);
      if (rr > 0) parts.cap.add(mat(cx, cy, H + rh + oh * Math.tan(pitch) - 0.12, ryaw, (RL + 2 * oh) * rr, 0.55, 0.28), trimC, s.idx, H, 1);
      else parts.cap.add(mat(cx, cy, H + rh + oh * Math.tan(pitch) - 0.3, ryaw, 0.7, 0.7, 0.5), trimC, s.idx, H, 1);
      parts.dark.add(mat(cx, cy, H - 0.14, ryaw, RL + 2 * oh, RW + 2 * oh, 0.14), darkC);
    } else if (roof === 'mono') {
      stats.pitched++;
      parts.mono.add(mat(cx, cy, H, ryaw, RL + 2 * oh, RW + 2 * oh, rh), roofC, s.idx, H, TINT);
      parts.cap.add(mat(cx + ry[0] * (RW / 2 + oh - 0.3), cy + ry[1] * (RW / 2 + oh - 0.3), H + rh - 0.05, ryaw, RL + 2 * oh, 0.6, 0.25), trimC, s.idx, H, 1);
      // skylight strip
      parts.glassMid.add(mat(cx, cy, H + rh * 0.5, ryaw, RL * 0.7, 1.2, 0.12), glassC);
    }

    // chimneys on pitched houses (cold region: 50-80 %)
    if ((roof === 'gable' || roof === 'hip') && s.arch !== 'shed' && r() < 0.7) {
      const nC = s.arch === 'block' && RL > 14 ? 2 : 1;
      for (let k = 0; k < nC; k++) {
        const fx = (k === 0 ? -0.3 : 0.3) * RL, fy = (r() - 0.5) * RW * 0.3;
        const slopeZ = H + rh * (1 - Math.abs(fy) / (RW / 2));
        const px = cx + rx[0] * fx + ry[0] * fy, py = cy + rx[1] * fx + ry[1] * fy;
        const top = slopeZ + 1.3;
        parts.wall.add(mat(px, py, H, ryaw, 0.75, 0.75, top - H), shade(col(P.walls[0]), 0.85), s.idx, H);
        parts.trimMajor.add(mat(px, py, top, ryaw, 0.95, 0.95, 0.12), trimC);
        chimneys.push(new THREE.Vector3(px, py, top + 0.15));
        stats.chimneys++;
      }
    }

    // cladding (adoption-progress reading): one proud zinc band per storey, revealed bottom-up
    for (let stI = 0; stI < s.levels; stI++) {
      const z0 = stI === 0 ? 0 : groundH + (stI - 1) * storeyH;
      const sh = stI === 0 ? groundH : storeyH;
      const cm = mat(cx, cy, z0 + 0.12, s.yaw, s.L + 0.18, s.W + 0.18, sh - 0.22);
      cladItems.push({ s: s.idx, k: stI, m: cm });
      parts.clad.add(cm, new THREE.Color(1, 1, 1), s.idx);
    }

    // flag (data treatment: approved -> pennant on a 2 m pole at the roof corner)
    {
      const fx = s.L / 2 - 0.8, fy = s.W / 2 - 0.8;
      const px = cx + s.ax[0] * fx + s.ay[0] * fy, py = cy + s.ax[1] * fx + s.ay[1] * fy;
      const z0 = roof === 'flat' ? H + 1.0 : H + 0.2;
      const pm = mat(px, py, z0, 0, 0.09, 0.09, 2.6);
      const fm = mat(px + 0.55, py, z0 + 1.85, 0, 1.1, 0.06, 0.7);
      parts.pole.add(pm, col(P.metal), s.idx);
      parts.flag.add(fm, new THREE.Color(1, 1, 1), s.idx);
      flagMats.push(pm.clone(), fm.clone());
    }

    // ---- landmark: the UZ Brussel slab gets a rooftop penthouse + water tanks (real structure, labelled) ----
    if (s.landmark) {
      parts.wall.add(mat(cx - s.ax[0] * s.L * 0.18, cy - s.ax[1] * s.L * 0.18, H, s.yaw, 6.0, 4.0, 2.8), shade(wallC, 0.92), s.idx, H);
      parts.trimMajor.add(mat(cx - s.ax[0] * s.L * 0.18, cy - s.ax[1] * s.L * 0.18, H + 2.8, s.yaw, 6.2, 4.2, 0.14), trimC);
      parts.metal.add(mat(cx + s.ax[0] * s.L * 0.22, cy + s.ax[1] * s.L * 0.22, H, s.yaw, 2.2, 2.2, 2.6), col([0.68, 0.010, 60]));   // water tank
      parts.metal.add(mat(cx + s.ax[0] * s.L * 0.02, cy + s.ax[1] * s.L * 0.02, H, s.yaw, 1.1, 1.1, 3.4), col(P.metal));               // lift/antenna stub
    }

    // ---- facades (buildings §4) ----
    facades(s, H, groundH, storeyH, roof, wallC, r, parts, stats);
  }

  // ---- materials + meshes ----
  const glassTex = canvasTex(32, 64, (g) => {
    g.fillStyle = hex(P.glass); g.fillRect(0, 0, 32, 64);
    g.fillStyle = hex([P.glass[0] - 0.08, P.glass[1], P.glass[2]]); g.fillRect(0, 0, 32, 16);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.moveTo(4, 64); g.lineTo(14, 64); g.lineTo(30, 24); g.lineTo(24, 24); g.fill();
    g.fillStyle = hex(P.trim); g.fillRect(15, 0, 2, 64); g.fillRect(0, 26, 32, 2);
  });
  const rollerTex = canvasTex(8, 64, (g) => { g.fillStyle = hex([0.66, 0.01, 250]); g.fillRect(0, 0, 8, 64); g.fillStyle = hex([0.56, 0.01, 250]); for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 8, 1); });
  const wallMat = houseMat({ data: 'wall' });
  const roofMat = houseMat({ data: 'roof' });
  const capMat = houseMat({ data: 'cap' });
  const plain = houseMat({});
  const glassMat = houseMat({ map: glassTex, lit: true, lensK: 0.7 });
  const group = new THREE.Group(); group.name = 'buildings';
  const mk = (p: Parts, geo: THREE.BufferGeometry, mt: THREE.Material, o: Parameters<Parts['build']>[2] = {}) => { const mesh = p.build(geo, mt, o); group.add(mesh); return mesh; };
  const wall = mk(parts.wall, box, wallMat, { cast: true, data: true });
  const dataMeshes = [wall,
    mk(parts.infill, unitGable(), wallMat, { cast: true, data: true }),
    mk(parts.gable, unitGable(), roofMat, { cast: true, data: true }),
    mk(parts.hip0, unitHip(0), roofMat, { cast: true, data: true }),
    mk(parts.hip3, unitHip(0.3), roofMat, { cast: true, data: true }),
    mk(parts.hip6, unitHip(0.6), roofMat, { cast: true, data: true }),
    mk(parts.mono, unitWedge(), roofMat, { cast: true, data: true }),
    mk(parts.flat, box.clone(), roofMat, { data: true }),
    mk(parts.cap, box.clone(), capMat, { data: true }),
    mk(parts.spire, new THREE.ConeGeometry(0.5, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5), roofMat, { cast: true, data: true }),
  ];
  mk(parts.trimMajor, box, plain, { cast: true });
  const dark = mk(parts.dark, box, plain);
  const metal = mk(parts.metal, box, plain, { cast: true });
  const trim = mk(parts.trim, box, plain);
  const glass = mk(parts.glass, box, glassMat, { lit: true });
  mk(parts.glassMid, box, glassMat, { lit: true });
  const accent = mk(parts.accent, box, plain);
  const awn = mk(parts.awning, unitWedge(), plain, { cast: true });
  const roller = mk(parts.roller, box, houseMat({ map: rollerTex }));
  const cladTex = canvasTex(64, 64, (g) => {
    g.fillStyle = hex([0.52, 0.016, 248]); g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(22,28,36,0.42)'; for (let x = 0; x < 64; x += 6) g.fillRect(x, 0, 2, 64);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, 64, 4);
  }, true);
  const cladMesh = mk(parts.clad, box.clone(), houseMat({ map: cladTex, lensK: 0.35 }));
  cladMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // per-item stored matrices, visible set decided by retrofit share per building
  const cladMats = cladItems.map((it) => it.m.clone());
  const clad: Cladding = {
    mesh: cladMesh,
    setShares(shares: Float32Array) {
      const levelsOf = new Map<number, number>();
      for (const it of cladItems) levelsOf.set(it.s, Math.max(levelsOf.get(it.s) ?? 0, it.k + 1));
      for (let i = 0; i < cladItems.length; i++) {
        const it = cladItems[i];
        const lv = levelsOf.get(it.s) ?? 1;
        const rv = Math.round(Math.min(1, Math.max(0, shares[it.s] || 0)) * lv);
        cladMesh.setMatrixAt(i, it.k < rv ? cladMats[i] : ZERO);
      }
      cladMesh.instanceMatrix.needsUpdate = true;
    },
  };
  clad.setShares(new Float32Array(lay.structs.length));
  const flagMesh = mk(parts.flag, box, houseMat({ lensK: 0 }));
  const poleMesh = mk(parts.pole, box, plain);
  void dark; void metal;
  return {
    group, lod: { mid: [glass, awn, roller, metal, accent], near: [trim] },
    dataMeshes, pickMesh: wall, chimneys, tops, roofKind, stats,
    flags: { mesh: flagMesh, pole: poleMesh, mats: flagMats },
    clad,
  };
}

type PartsMap = Record<string, Parts>;

function facades(s: Struct, H: number, groundH: number, storeyH: number, roof: Roof, wallC: THREE.Color, r: () => number, parts: PartsMap, stats: Record<string, number>) {
  const trimC = col(P.trim), darkC = col(P.dark), glassC = col(P.glass);
  const winK = 0.9 + r() * 0.25;
  const lintelC = r() < 0.5 ? trimC : shade(wallC, 0.82);
  const doorC = col(pick(r, [P.accent[0], P.accent[1], P.accent[0], [0.36, 0.06, 150], [0.30, 0.03, 40]] as any));
  const shop = s.arch === 'shophouse' || s.cls === 'retail' || s.cls === 'supermarket' || s.cls === 'mixed_use' || (s.arch === 'block' && s.distCentre < 140 && r() < 0.6);
  const bayW = BAY[s.landmark ? 'church' : s.arch] ?? 3.2;
  const litP = 0.06 + 0.12 * Math.max(0, 1 - s.distCentre / 250);
  const fascia = col(pick(r, P.accent));
  for (const f of s.faces) {
    if (f.party) continue;
    const bays = Math.max(1, Math.round(f.len / bayW));
    const bw = f.len / bays;
    const yaw = Math.atan2(f.n[1], f.n[0]) - Math.PI / 2;
    const at = (b: number, out: number): [number, number] => {
      const along = -f.len / 2 + (b + 0.5) * bw;
      return [f.mid[0] + f.u[0] * along + f.n[0] * out, f.mid[1] + f.u[1] * along + f.n[1] * out];
    };
    const halfDensity = s.arch === 'villa' && !f.street;
    const doorBay = f.main ? Math.floor(r() * bays) : -1;

    if (s.landmark) {
      // tall lancet windows on long faces; a big door on the main face
      for (let b = 0; b < bays; b++) {
        if (f.len < 22 && b !== Math.floor(bays / 2)) continue;
        const [x, y] = at(b, 0);
        if (f.main && b === doorBay) { door(x, y, yaw, 2.4, 4.2, true); continue; }
        window_(x, y, yaw, 2.6, 1.4, 7.0, false, true);
      }
      continue;
    }
    if (s.arch === 'shed') {
      for (let b = 0; b < bays; b++) {
        const [x, y] = at(b, 0);
        if (f.street && b % 2 === 0) {
          const rw = Math.min(4.2, bw - 1.2), rhh = Math.min(4.0, H - 1.0);
          parts.roller.add(mat(x + f.n[0] * 0.03, y + f.n[1] * 0.03, 0.15, yaw, rw, 0.08, rhh), new THREE.Color(1, 1, 1));
          parts.trim.add(mat(x, y, 0.15, yaw, rw + 0.3, 0.05, rhh + 0.2), col(P.metal));
        } else {
          parts.glassMid.add(mat(x + f.n[0] * 0.03, y + f.n[1] * 0.03, H * 0.72, yaw, bw * 0.7, 0.06, 0.8), glassC);
        }
      }
      continue;
    }
    for (let st = 0; st < s.levels; st++) {
      const z0 = st === 0 ? 0 : groundH + (st - 1) * storeyH;
      const sh = st === 0 ? groundH : storeyH;
      for (let b = 0; b < bays; b++) {
        const [x, y] = at(b, 0);
        if (st === 0 && b === doorBay) { door(x, y, yaw, 1.15, 2.3, false); continue; }
        if (st === 0 && shop && f.street) {
          // shopfront: full-bay glass, stall riser, fascia above (buildings §4.3)
          const gw = bw - 0.5, gh = sh - 1.5;
          parts.wall.add(mat(x + f.n[0] * 0.04, y + f.n[1] * 0.04, 0, yaw, bw - 0.1, 0.1, 0.55), shade(wallC, 0.7), s.idx, H);
          parts.glass.add(mat(x + f.n[0] * 0.05, y + f.n[1] * 0.05, 0.55, yaw, gw, 0.06, gh), glassC, -1, 0, 0, r() < 0.35 ? 1 : 0);
          parts.trim.add(mat(x + f.n[0] * 0.03, y + f.n[1] * 0.03, 0.5, yaw, gw + 0.2, 0.05, gh + 0.15), trimC);
          stats.shopfronts++;
          continue;
        }
        if (halfDensity && b % 2 === 1) continue;
        const ww = Math.min(bw * 0.45 * winK, 1.6), wh = sh * (s.arch === 'block' && s.distCentre < 160 ? 0.6 : 0.52);
        window_(x, y, yaw, ww, z0 + Math.max(0.8, sh * 0.3), wh, r() < litP, false);
      }
      // signature motif: polychrome (gault) string course at every storey line on red/brown brick
      const wallIdx = (s as any).wallIdx ?? 0;
      if (st > 0 && (wallIdx === 0 || wallIdx === 1)) {
        const [x, y] = [f.mid[0] + f.n[0] * 0.06, f.mid[1] + f.n[1] * 0.06];
        parts.trim.add(mat(x, y, z0 - 0.14, yaw, f.len + 0.14, 0.09, 0.17), col(P.walls[2]));
      }
    }
    // shop fascia + awnings along the street face
    if (shop && f.street) {
      const fz = groundH - 0.9;
      parts.accent.add(mat(f.mid[0] + f.n[0] * 0.1, f.mid[1] + f.n[1] * 0.1, fz, yaw, f.len - 0.2, 0.18, 0.62), fascia);
      for (let b = 0; b < bays; b++) {
        if (b === doorBay || r() > 0.55) continue;
        const [x, y] = at(b, 0.75);
        // wedge rotated so it slopes down and outward
        parts.awning.add(mat(x, y, fz - 0.95, yaw + Math.PI, bw - 0.3, 1.5, 0.75), b % 2 ? fascia : col([0.90, 0.02, 85]));
        stats.awnings++;
      }
    }
  }

  function window_(x: number, y: number, yaw: number, w: number, z: number, h: number, lit: boolean, lancet: boolean) {
    const n = [Math.cos(yaw + Math.PI / 2), Math.sin(yaw + Math.PI / 2)];
    const o = (d: number): [number, number] => [x + n[0] * d, y + n[1] * d];
    let p = o(0.015); parts.trim.add(mat(p[0], p[1], z - 0.1, yaw, w + 0.22, 0.04, h + 0.2), trimC);
    p = o(0.03); parts.glass.add(mat(p[0], p[1], z, yaw, w, 0.06, h), glassC, -1, 0, 0, lit ? 1 : 0);
    p = o(0.075); parts.trim.add(mat(p[0], p[1], z - 0.12, yaw, w + 0.32, 0.18, 0.09), trimC);
    p = o(0.05); parts.trim.add(mat(p[0], p[1], z + h + 0.1, yaw, w + 0.34, 0.12, lancet ? 0.5 : 0.14), lancet ? trimC : lintelC);
    stats.windows++; if (lit) stats.litWindows++;
  }
  function door(x: number, y: number, yaw: number, w: number, h: number, grand: boolean) {
    const n = [Math.cos(yaw + Math.PI / 2), Math.sin(yaw + Math.PI / 2)];
    const o = (d: number): [number, number] => [x + n[0] * d, y + n[1] * d];
    let p = o(0.02); parts.dark.add(mat(p[0], p[1], 0.15, yaw, w + 0.3, 0.04, h + 0.2), darkC);
    p = o(0.04); parts.accent.add(mat(p[0], p[1], 0.15, yaw, w, 0.07, h), grand ? col([0.32, 0.04, 40]) : doorC);
    p = o(0.03); parts.glass.add(mat(p[0], p[1], 0.15 + h + 0.12, yaw, w, 0.06, 0.45), glassC);
    p = o(0.05); parts.trim.add(mat(p[0], p[1], 0.15 + h + 0.6, yaw, w + 0.5, 0.14, 0.16), trimC);
    p = o(0.25); parts.trim.add(mat(p[0], p[1], 0, yaw, w + 0.6, 0.5, 0.17), col(P.kerb));
    stats.doors++;
  }
}

/** Update data surfaces from per-structure colours (linear) and presence. */
export function applyData(meshes: THREE.InstancedMesh[], colour: Float32Array, has: Uint8Array) {
  for (const mesh of meshes) {
    const sl = mesh.userData.slots as DataSlots | undefined;
    if (!sl) continue;
    const d = sl.data.array as Float32Array, inf = sl.info.array as Float32Array;
    for (let i = 0; i < mesh.count; i++) {
      const s = sl.struct[i];
      if (s < 0) continue;
      d[i * 3] = colour[s * 3]; d[i * 3 + 1] = colour[s * 3 + 1]; d[i * 3 + 2] = colour[s * 3 + 2];
      inf[i * 3] = has[s] ? 1 : 0;
    }
    sl.data.needsUpdate = true; sl.info.needsUpdate = true;
  }
}
