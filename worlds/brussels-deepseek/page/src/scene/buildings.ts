// Steps 2 + 4: masses, roofs, facades, roof furniture, the signature motif (speklagen:
// cream limestone bands across brick facades) and the landmark church. recipes: buildings.md
import * as THREE from 'three';
import { P, hex } from './palette.ts';
import { Parts, houseMat, mat, rng, unitBox, unitGable, unitHip, unitWedge, varied, col, shade, canvasTex, pick, ZERO, type DataSlots } from './util.ts';
import type { Layout, Struct, Face } from './layout.ts';

const TINT = 0.08;  // data-in-the-world §2: <= 10 % on roofs; the ridge/coping band carries the full colour
const TILE = 250;   // metres; detail parts are tiled so frustum culling works at street zoom
const BAY: Record<string, number> = { villa: 2.6, terrace: 2.5, block: 3.2, shophouse: 3.2, tower: 3.0, shed: 6.0, civic: 4.0 };
type Roof = 'gable' | 'hip' | 'flat' | 'mono' | 'church';

export interface BuildingsOut {
  group: THREE.Group;
  lod: { mid: THREE.Object3D[]; near: THREE.Object3D[] };
  dataMeshes: THREE.InstancedMesh[];
  pickMesh: THREE.InstancedMesh;
  flags: { mesh: THREE.InstancedMesh; pole: THREE.InstancedMesh; mats: THREE.Matrix4[] };
  cladding: { mesh: THREE.InstancedMesh; mats: THREE.Matrix4[]; struct: Int32Array; level: Int32Array; levels: Int32Array };
  chimneys: THREE.Vector3[];
  tops: Float32Array;
  roofKind: Roof[];
  stats: Record<string, number>;
}

class TiledParts {
  map = new Map<string, Parts>();
  get(kind: string, x: number, y: number): Parts {
    const key = kind + '|' + Math.floor(x / TILE) + ':' + Math.floor(y / TILE);
    let p = this.map.get(key);
    if (!p) { p = new Parts(kind); this.map.set(key, p); }
    return p;
  }
  build(group: THREE.Group, geo: (kind: string) => THREE.BufferGeometry, mt: (kind: string) => THREE.Material, o: (kind: string) => { cast?: boolean; receive?: boolean; lit?: boolean } = () => ({})) {
    const out: THREE.InstancedMesh[] = [];
    for (const [key, p] of this.map) {
      if (!p.count) continue;
      const kind = key.slice(0, key.indexOf('|'));
      const mesh = p.build(geo(kind), mt(kind), o(kind));
      mesh.name = kind + '-' + key.slice(key.indexOf('|') + 1);
      group.add(mesh); out.push(mesh);
    }
    return out;
  }
}

export function buildBuildings(lay: Layout): BuildingsOut {
  const box = unitBox();
  const parts = {
    wall: new Parts('wall'), infill: new Parts('gable-infill'), gable: new Parts('roof-gable'),
    hip0: new Parts('roof-hip0'), hip3: new Parts('roof-hip3'), hip6: new Parts('roof-hip6'),
    mono: new Parts('roof-mono'), flat: new Parts('roof-flat'), cap: new Parts('data-cap'),
    parapet: new Parts('parapet'), dark: new Parts('fascia'), metal: new Parts('metal'),
    door: new Parts('door'), accent: new Parts('accent'), balcony: new Parts('balcony'), railing: new Parts('railing'),
    spire: new Parts('spire'), pole: new Parts('flag-pole'), flag: new Parts('flag'), clad: new Parts('cladding'),
  };
  const detail = new TiledParts();   // trim, glass, shop, awning, spek
  const m = new THREE.Matrix4();
  const chimneys: THREE.Vector3[] = [];
  const tops = new Float32Array(lay.structs.length);
  const roofKind: Roof[] = [];
  const flagMats: THREE.Matrix4[] = [];
  const cladMats: THREE.Matrix4[] = [];
  const cladStruct: number[] = [];
  const cladLevel: number[] = [];
  const cladLevels: number[] = [];
  const stats: Record<string, number> = {
    pitched: 0, flat: 0, speklagen: 0, shopfronts: 0, doors: 0, windows: 0, balconies: 0,
    chimneys: 0, dormers: 0, awnings: 0, landmark: 0, irregular: 0,
  };
  const trimC = col(P.trim), darkC = col(P.dark), glassC = col(P.glass);

  // wall colour by class + seed, avoiding a run of identical neighbours along the same side
  const wallBase: number[] = [];
  for (const s of lay.structs) {
    const r = rng(s.seed);
    let k: number;
    if (s.landmark) k = 0;
    else if (s.cls === 'apartments') k = pick(r, [0, 1, 0, 3, 1, 2]);
    else if (s.cls === 'house' || s.cls === 'detached' || s.cls === 'terrace') k = pick(r, [0, 0, 1, 3, 0, 2]);
    else if (s.cls === 'civic' || s.cls === 'school' || s.cls === 'hospital' || s.cls === 'university' || s.cls === 'government') k = pick(r, [3, 2, 3]);
    else k = pick(r, [0, 1, 2, 3]);
    wallBase.push(k);
  }

  for (const s of lay.structs) {
    const r = rng(s.seed ^ 0x9e3779b9);
    const wallC = varied(s.landmark ? [0.50, 0.080, 33] : P.walls[wallBase[s.idx]], r, 0.025, 4);
    const storeyH = 3.05 + r() * 0.25;
    const groundH = s.arch === 'shophouse' ? 3.7 : s.arch === 'shed' ? 4.0 : 3.0;
    const H = s.landmark ? 16.5 : Math.max(3, s.levels * storeyH + (groundH - storeyH));
    tops[s.idx] = H;
    if (s.rectangularity < 0.82 || Math.min(s.L, s.W) < 3) stats.irregular++;

    // ---- roof choice ----
    let roof: Roof;
    const u = r();
    const civic = ['civic', 'school', 'hospital', 'university', 'government', 'office', 'supermarket', 'warehouse', 'industrial'].includes(s.cls);
    if (s.landmark) roof = 'church';
    else if (s.arch === 'shed') roof = u < 0.55 ? 'mono' : 'flat';
    else if (civic || s.levels >= 5) roof = u < 0.7 ? 'flat' : 'hip';
    else if (s.arch === 'villa') roof = u < 0.62 ? 'gable' : u < 0.86 ? 'hip' : 'flat';
    else roof = u < 0.52 ? 'gable' : u < 0.78 ? 'hip' : 'flat';
    roofKind.push(roof);
    if (roof === 'flat') stats.flat++; else stats.pitched++;

    // ridge direction: along the long axis
    const ryaw = Math.atan2(s.ax[1], s.ax[0]);
    const pitch = THREE.MathUtils.degToRad(roof === 'church' ? 52 : s.arch === 'shed' ? 12 : 43);
    const rh = Math.min((s.W / 2) * Math.tan(pitch), s.arch === 'shed' ? 3.5 : 12);
    const oh = s.arch === 'shed' ? 0.25 : 0.42;
    const [cx, cy] = s.c;

    // ---- mass (buildings §1) ----
    parts.wall.add(mat(cx, cy, 0, s.yaw, s.L, s.W, H), wallC, s.idx, H);
    parts.wall.add(mat(cx, cy, 0, s.yaw, s.L + 0.3, s.W + 0.3, 0.7), shade(wallC, 0.78), s.idx, H);

    if (roof === 'flat') {
      // cornice, parapet ring and data coping band
      parts.parapet.add(mat(cx, cy, H - 0.45, s.yaw, s.L + 0.5, s.W + 0.5, 0.42), trimC);
      const pH = 0.9, t = 0.26;
      const ring = (fn: (x: number, y: number, z: number, yw: number, a: number, b: number, c: number) => void, z: number, hh: number, tt: number, grow = 0) => {
        fn(cx + s.ay[0] * (s.W / 2 - tt / 2 + grow / 2), cy + s.ay[1] * (s.W / 2 - tt / 2 + grow / 2), z, s.yaw, s.L + grow, tt, hh);
        fn(cx - s.ay[0] * (s.W / 2 - tt / 2 + grow / 2), cy - s.ay[1] * (s.W / 2 - tt / 2 + grow / 2), z, s.yaw, s.L + grow, tt, hh);
        fn(cx + s.ax[0] * (s.L / 2 - tt / 2 + grow / 2), cy + s.ax[1] * (s.L / 2 - tt / 2 + grow / 2), z, s.yaw, tt, s.W + grow, hh);
        fn(cx - s.ax[0] * (s.L / 2 - tt / 2 + grow / 2), cy - s.ax[1] * (s.L / 2 - tt / 2 + grow / 2), z, s.yaw, tt, s.W + grow, hh);
      };
      ring((x, y, z, yw, a, b, c) => parts.wall.add(mat(x, y, z, yw, a, b, c), wallC, s.idx, H), H, pH, t);
      ring((x, y, z, yw, a, b, c) => parts.cap.add(mat(x, y, z, yw, a, b, c), trimC, s.idx, H, 1), H + pH, 0.14, t + 0.12, 0.1);
      parts.flat.add(mat(cx, cy, H, s.yaw, s.L - 0.4, s.W - 0.4, 0.14), varied([0.40, 0.010, 250], r, 0.02, 3), s.idx, H, 0);
      // roof furniture
      const nObj = 1 + Math.floor(r() * 4);
      for (let k = 0; k < nObj; k++) {
        const fx = (r() - 0.5) * Math.max(0, s.L - 4), fy = (r() - 0.5) * Math.max(0, s.W - 4);
        const px = cx + s.ax[0] * fx + s.ay[0] * fy, py = cy + s.ax[1] * fx + s.ay[1] * fy;
        const kind = r();
        if (kind < 0.22 && s.L > 10) parts.wall.add(mat(px, py, H, s.yaw, 2.5, 3, 2.6), shade(wallC, 0.95), s.idx, H);
        else if (kind < 0.8) parts.metal.add(mat(px, py, H, s.yaw, 1.0, 0.8, 0.8), col(P.metal));
        else parts.metal.add(mat(px, py, H, 0, 0.35, 0.35, 1.5), col([0.5, 0.01, 250]));
      }
    } else if (roof === 'gable' || roof === 'church') {
      const roofC = varied(s.landmark ? [0.34, 0.018, 255] : P.roofs[(Math.floor(s.idx / 6) % 5 === 0) ? 1 : 0], r, 0.02, 2);
      parts.gable.add(mat(cx, cy, H, ryaw, s.L + 2 * oh, s.W + 2 * oh, rh + oh * Math.tan(pitch)), roofC, s.idx, H, TINT);
      parts.infill.add(mat(cx, cy, H, ryaw, s.L, s.W, rh - 0.05), wallC, s.idx, H);
      parts.cap.add(mat(cx, cy, H + rh + oh * Math.tan(pitch) - 0.12, ryaw, s.L + 2 * oh, 0.78, 0.3), trimC, s.idx, H, 1);
      parts.dark.add(mat(cx, cy, H - 0.14, ryaw, s.L + 2 * oh, s.W + 2 * oh, 0.14), darkC);
      // dormers on the long roof, facing the main street
      const mf = s.faces.find((f) => f.main)!;
      if (!s.landmark && s.arch !== 'shed' && s.L > 11 && r() < 0.45) {
        const side = Math.abs(mf.n[0] * s.ay[0] + mf.n[1] * s.ay[1]) > 0.5 ? 1 : -1;
        const nD = 1 + Math.floor(r() * 2);
        for (let k = 0; k < nD; k++) {
          const along = (k - (nD - 1) / 2) * 3.2;
          const px = cx + s.ax[0] * along + s.ay[0] * side * (s.W * 0.22);
          const py = cy + s.ax[1] * along + s.ay[1] * side * (s.W * 0.22);
          parts.wall.add(mat(px, py, H + rh * 0.32, ryaw, 1.7, 1.4, 1.5), wallC, s.idx, H);
          parts.gable.add(mat(px, py, H + rh * 0.32 + 1.5, ryaw, 1.9, 1.6, 0.8), roofC, s.idx, H, 0);
          detail.get('glass', px, py).add(mat(px + mf.n[0] * 0.7, py + mf.n[1] * 0.7, H + rh * 0.32 + 0.35, ryaw, 0.9, 0.06, 0.85), glassC);
          stats.dormers++;
        }
      }
      // chimneys
      if (s.arch !== 'shed' && r() < 0.72) {
        const nC = s.L > 14 ? 2 : 1;
        for (let k = 0; k < nC; k++) {
          const fx = (k === 0 ? -0.28 : 0.28) * s.L, fy = (r() - 0.5) * s.W * 0.25;
          const slopeZ = H + rh * (1 - Math.abs(fy) / (s.W / 2));
          const px = cx + s.ax[0] * fx + s.ay[0] * fy, py = cy + s.ax[1] * fx + s.ay[1] * fy;
          const top = slopeZ + 1.1;
          parts.wall.add(mat(px, py, H, ryaw, 0.66, 0.66, top - H), shade(wallC, 0.85), s.idx, H);
          parts.parapet.add(mat(px, py, top, ryaw, 0.86, 0.86, 0.12), trimC);
          chimneys.push(new THREE.Vector3(px, py, top + 0.15));
          stats.chimneys++;
        }
      }
    } else if (roof === 'hip') {
      const roofC = varied(P.roofs[0], r, 0.02, 2);
      const ratio = Math.max(0, (s.L - s.W) / Math.max(1, s.L));
      const pk = ratio < 0.15 ? parts.hip0 : ratio < 0.45 ? parts.hip3 : parts.hip6;
      const rr = ratio < 0.15 ? 0 : ratio < 0.45 ? 0.3 : 0.6;
      parts.wall.add(mat(cx, cy, H, s.yaw, s.L, s.W, 0.05), wallC, s.idx, H);
      pk.add(mat(cx, cy, H, ryaw, s.L + 2 * oh, s.W + 2 * oh, rh + oh * Math.tan(pitch)), roofC, s.idx, H, TINT);
      parts.cap.add(mat(cx, cy, H + rh + oh * Math.tan(pitch) - 0.12, ryaw, rr > 0 ? (s.L + 2 * oh) * rr : 0.7, rr > 0 ? 0.55 : 0.7, rr > 0 ? 0.28 : 0.5), trimC, s.idx, H, 1);
      parts.dark.add(mat(cx, cy, H - 0.14, ryaw, s.L + 2 * oh, s.W + 2 * oh, 0.14), darkC);
    } else if (roof === 'mono') {
      const roofC = varied(P.roofs[2], r, 0.02, 2);
      parts.mono.add(mat(cx, cy, H, ryaw, s.L + 2 * oh, s.W + 2 * oh, rh), roofC, s.idx, H, TINT);
      parts.cap.add(mat(cx + s.ay[0] * (s.W / 2 + oh - 0.3), cy + s.ay[1] * (s.W / 2 + oh - 0.3), H + rh - 0.05, ryaw, s.L + 2 * oh, 0.6, 0.25), trimC, s.idx, H, 1);
    }

    // ---- landmark tower + spire ----
    if (roof === 'church') {
      const ts = Math.min(11, s.W * 0.6);
      const tx = cx - s.ax[0] * (s.L / 2 - ts / 2 - 1.2), ty = cy - s.ax[1] * (s.L / 2 - ts / 2 - 1.2);
      const TH = 48;
      parts.wall.add(mat(tx, ty, 0, ryaw, ts, ts, TH), col([0.80, 0.020, 85]));
      parts.wall.add(mat(tx, ty, 0, ryaw, ts + 0.5, ts + 0.5, 1.0), shade(col([0.80, 0.020, 85]), 0.85));
      for (const z of [10.5, 19, TH - 0.8]) parts.parapet.add(mat(tx, ty, z, ryaw, ts + 0.3, ts + 0.3, 0.45), trimC);
      for (let k = 0; k < 4; k++) {
        const a = ryaw + (k * Math.PI) / 2;
        const px = tx + Math.cos(a) * (ts / 2 + 0.03), py = ty + Math.sin(a) * (ts / 2 + 0.03);
        detail.get('glass', px, py).add(mat(px, py, 21, a + Math.PI / 2, 1.3, 0.1, 4.4), glassC);
        detail.get('trim', px, py).add(mat(px, py, 15.4, a + Math.PI / 2, 2.4, 0.1, 2.4), trimC);
      }
      parts.spire.add(mat(tx, ty, TH, ryaw + Math.PI / 8, ts * 0.9, ts * 0.9, 28), col([0.55, 0.055, 165]));
      parts.metal.add(mat(tx, ty, TH + 28, 0, 0.1, 0.1, 2.4), col([0.70, 0.08, 85]));
      stats.landmark++;
    }

    // ---- pennant (data treatment: approved -> a teal pennant on a 2 m pole) ----
    {
      const fx = s.L / 2 - 0.8, fy = s.W / 2 - 0.8;
      const px = cx + s.ax[0] * fx + s.ay[0] * fy, py = cy + s.ax[1] * fx + s.ay[1] * fy;
      const z0 = roof === 'flat' ? H + 1.0 : H + (roof === 'church' ? 14 : 0.3);
      const pm = mat(px, py, z0, 0, 0.09, 0.09, 2.6);
      const fm = mat(px + 0.55, py, z0 + 1.85, 0, 1.1, 0.06, 0.7);
      parts.pole.add(pm, col(P.metal), s.idx);
      parts.flag.add(fm, new THREE.Color(1, 1, 1), s.idx);
      flagMats.push(pm.clone(), fm.clone());
    }

    // ---- cladding (data treatment: adoption -> completed storeys bottom-up) ----
    {
      const mf = s.faces.find((f) => f.main)!;
      const levels = Math.max(1, Math.min(s.levels, 12));
      for (let st = 0; st < levels; st++) {
        const z = st * storeyH + 0.05;
        const px = mf.mid[0] + mf.n[0] * 0.09;
        const py = mf.mid[1] + mf.n[1] * 0.09;
        const yw = Math.atan2(mf.n[1], mf.n[0]) - Math.PI / 2;
        const cm = mat(px, py, z, yw, mf.len - 0.5, 0.06, storeyH - 0.18);
        parts.clad.add(cm, col(P.cladding), s.idx);
        cladMats.push(cm.clone()); cladStruct.push(s.idx); cladLevel.push(st); cladLevels.push(levels);
      }
    }

    // ---- facades (buildings §4) ----
    facades(s, H, groundH, storeyH, roof, wallC, r, detail, parts, stats, wallBase[s.idx]);
  }

  // ---- materials + meshes ----
  const glassTex = canvasTex(32, 64, (g) => {
    g.fillStyle = hex(P.glass); g.fillRect(0, 0, 32, 64);
    g.fillStyle = hex([P.glass[0] - 0.08, P.glass[1], P.glass[2]]); g.fillRect(0, 0, 32, 16);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.moveTo(4, 64); g.lineTo(14, 64); g.lineTo(30, 24); g.lineTo(24, 24); g.fill();
    g.fillStyle = hex(P.trim); g.fillRect(15, 0, 2, 64); g.fillRect(0, 26, 32, 2);
  });
  const wallMat = houseMat({ data: 'wall' });
  const roofMat = houseMat({ data: 'roof' });
  const capMat = houseMat({ data: 'cap' });
  const plain = houseMat({});
  const glassMat = houseMat({ map: glassTex, lensK: 0.7 });
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
  mk(parts.parapet, box, plain, { cast: true });
  mk(parts.dark, box, plain);
  mk(parts.metal, box, plain, { cast: true });
  const doorMesh = mk(parts.door, box, plain, { cast: true });
  mk(parts.accent, box, plain);
  mk(parts.balcony, box, plain, { cast: true });
  mk(parts.railing, box, plain);
  const poleMesh = mk(parts.pole, box, plain);
  const flagMesh = mk(parts.flag, box, houseMat({ lensK: 0 }));
  const claddingMesh = mk(parts.clad, box, houseMat({ lensK: 0.8 }), {});
  void doorMesh;

  // detail: tiled so the street zoom culls most of the city
  const detailMeshes = detail.build(group,
    (kind) => (kind === 'awning' ? unitWedge() : unitBox()),
    (kind) => (kind === 'glass' ? glassMat : kind === 'awning' ? plain : plain),
    (kind) => ({ cast: kind !== 'glass', receive: true }));
  void detailMeshes;

  return {
    group,
    lod: { mid: [], near: [...group.children].filter((o) => o.name.includes('|') || o.name.startsWith('trim-') || o.name.startsWith('glass-')) },
    dataMeshes, pickMesh: wall, chimneys, tops, roofKind, stats,
    flags: { mesh: flagMesh, pole: poleMesh, mats: flagMats },
    cladding: {
      mesh: claddingMesh, mats: cladMats,
      struct: Int32Array.from(cladStruct), level: Int32Array.from(cladLevel), levels: Int32Array.from(cladLevels),
    },
  };
}

type Detail = TiledParts;

function facades(s: Struct, H: number, groundH: number, storeyH: number, roof: Roof, wallC: THREE.Color, r: () => number, detail: Detail, parts: Record<string, Parts>, stats: Record<string, number>, wallIdx: number) {
  const trimC = col(P.trim), darkC = col(P.dark), glassC = col(P.glass);
  const winK = 0.9 + r() * 0.22;
  const doorC = col(pick(r, [P.accent[0], P.accent[1], [0.36, 0.06, 150], [0.30, 0.03, 40]] as any));
  const commercial = ['retail', 'mixed_use', 'supermarket', 'kiosk'].includes(s.cls);
  const bayW = BAY[s.landmark ? 'civic' : s.arch] ?? 3.0;
  const brick = wallIdx <= 2;
  const spek = brick && r() < 0.38;
  if (spek) stats.speklagen++;

  for (const f of s.faces) {
    if (!f.street && !f.main) continue;
    const bays = Math.max(1, Math.round(f.len / bayW));
    const bw = f.len / bays;
    const yaw = Math.atan2(f.n[1], f.n[0]) - Math.PI / 2;
    const at = (b: number, out: number): [number, number] => {
      const along = -f.len / 2 + (b + 0.5) * bw;
      return [f.mid[0] + f.u[0] * along + f.n[0] * out, f.mid[1] + f.u[1] * along + f.n[1] * out];
    };
    const doorBay = f.main ? Math.floor(r() * bays) : -1;
    const trimTile = detail.get('trim', f.mid[0], f.mid[1]);
    const domestic = ['house', 'terrace', 'detached', 'villa', 'bungalow', 'apartments', 'residential'].includes(s.cls);
    if (domestic && f.main) {
      // a raised stone plinth, so the residential ground floor is not the floor above
      trimTile.add(mat(f.mid[0] + f.n[0] * 0.055, f.mid[1] + f.n[1] * 0.055, 0, yaw, f.len, 0.1, 1.0), col([0.56, 0.014, 72]));
    }

    // speklagen: a cream limestone band at every storey line, and a sill course
    if (spek && !s.landmark) {
      for (let st = 1; st < Math.max(1, s.levels); st++) {
        const z = st * storeyH + (groundH - storeyH);
        trimTile.add(mat(f.mid[0] + f.n[0] * 0.055, f.mid[1] + f.n[1] * 0.055, z - 0.08, yaw, f.len, 0.11, 0.17), trimC);
      }
      trimTile.add(mat(f.mid[0] + f.n[0] * 0.05, f.mid[1] + f.n[1] * 0.05, groundH - 0.12, yaw, f.len, 0.1, 0.16), trimC);
    }

    if (s.landmark) {
      // tall lancet windows and an arched door
      for (let b = 0; b < bays; b++) {
        const [x, y] = at(b, 0);
        if (f.main && b === doorBay) { door(x, y, yaw, 2.6, 4.4, true); continue; }
        window_(x, y, yaw, 1.5, 3.2, 6.4, false, r);
      }
      continue;
    }
    if (s.arch === 'shed') {
      for (let b = 0; b < bays; b++) {
        const [x, y] = at(b, 0);
        if (f.street && b % 2 === 0) {
          const rw = Math.min(4.0, bw - 1.2), rh = Math.min(3.8, H - 1.0);
          detail.get('shop', x, y).add(mat(x + f.n[0] * 0.04, y + f.n[1] * 0.04, 0.15, yaw, rw, 0.08, rh), darkC);
          detail.get('trim', x, y).add(mat(x, y, 0.15, yaw, rw + 0.3, 0.05, rh + 0.2), col(P.metal));
        } else {
          detail.get('glass', x, y).add(mat(x + f.n[0] * 0.04, y + f.n[1] * 0.04, H * 0.72, yaw, bw * 0.7, 0.06, 0.8), glassC);
        }
      }
      continue;
    }

    for (let st = 0; st < Math.max(1, s.levels); st++) {
      const z0 = st === 0 ? 0 : groundH + (st - 1) * storeyH;
      const sh = st === 0 ? groundH : storeyH;
      for (let b = 0; b < bays; b++) {
        const [x, y] = at(b, 0);
        if (st === 0 && b === doorBay) { door(x, y, yaw, 1.1, 2.25, false); continue; }
        if (st === 0 && commercial && f.street) {
          const gw = bw - 0.5, gh = sh - 1.5;
          parts.wall.add(mat(x + f.n[0] * 0.04, y + f.n[1] * 0.04, 0, yaw, bw - 0.1, 0.1, 0.55), shade(wallC, 0.7), s.idx, H);
          detail.get('glass', x, y).add(mat(x + f.n[0] * 0.05, y + f.n[1] * 0.05, 0.55, yaw, gw, 0.06, gh), glassC);
          trimTile.add(mat(x + f.n[0] * 0.03, y + f.n[1] * 0.03, 0.5, yaw, gw + 0.2, 0.05, gh + 0.15), trimC);
          stats.shopfronts++;
          continue;
        }
        const ww = Math.min(bw * 0.44 * winK, 1.55);
        const wh = sh * (st === 0 ? 0.55 : 0.52);
        const zz = z0 + (st === 0 ? 1.15 : Math.max(0.85, sh * 0.3));
        window_(x, y, yaw, ww, zz, wh, false, r);
        if (st === 0 && s.residential === 'probable' && r() < 0.3) {
          // a low railing in front of the ground-floor window
          trimTile.add(mat(x + f.n[0] * 0.16, y + f.n[1] * 0.16, zz - 0.05, yaw, ww + 0.25, 0.04, 0.5), col(P.metal));
        }
      }
      // balconies on 20 % of apartment street faces, stacked in one bay
      if (st > 0 && s.arch === 'block' && f.main && r() < 0.2) {
        const [x, y] = at(Math.floor(bays / 2), 0.85);
        parts.balcony.add(mat(x, y, z0 + 0.05, yaw, Math.min(2.4, bw - 0.4), 1.15, 0.12), col(P.concrete));
        for (const dz of [0, 0.5, 0.95]) {
          parts.railing.add(mat(x + f.n[0] * 0.55, y + f.n[1] * 0.55, z0 + dz + 0.12, yaw, Math.min(2.4, bw - 0.4), 0.05, 0.05), col(P.metal));
        }
        stats.balconies++;
      }
    }
    // shop fascia and awnings
    if (commercial && f.street) {
      const fz = groundH - 0.9;
      detail.get('trim', f.mid[0], f.mid[1]).add(mat(f.mid[0] + f.n[0] * 0.1, f.mid[1] + f.n[1] * 0.1, fz, yaw, f.len - 0.2, 0.18, 0.62), col(pick(r, P.accent)));
      for (let b = 0; b < bays; b++) {
        if (b === doorBay || r() > 0.5) continue;
        const [x, y] = at(b, 0.8);
        detail.get('awning', x, y).add(mat(x, y, fz - 0.95, yaw + Math.PI, bw - 0.3, 1.5, 0.7), r() < 0.5 ? col(P.accent[1]) : col([0.90, 0.02, 85]));
        stats.awnings++;
      }
    }
  }

  function window_(x: number, y: number, yaw: number, w: number, z: number, h: number, lancet: boolean, r2: () => number) {
    const n = [Math.cos(yaw + Math.PI / 2), Math.sin(yaw + Math.PI / 2)];
    const o = (d: number): [number, number] => [x + n[0] * d, y + n[1] * d];
    const tr = detail.get('trim', x, y), gl = detail.get('glass', x, y);
    let p = o(0.018); tr.add(mat(p[0], p[1], z - 0.08, yaw, w + 0.22, 0.035, h + 0.16), trimC);
    p = o(0.03); gl.add(mat(p[0], p[1], z, yaw, w, 0.06, h), glassC);
    p = o(0.06); tr.add(mat(p[0], p[1], z - 0.1, yaw, w + 0.3, 0.14, 0.08), trimC);
    p = o(0.05); tr.add(mat(p[0], p[1], z + h + 0.08, yaw, w + 0.32, 0.1, lancet ? 0.4 : 0.12), trimC);
    stats.windows++;
    void r2;
  }
  function door(x: number, y: number, yaw: number, w: number, h: number, grand: boolean) {
    const n = [Math.cos(yaw + Math.PI / 2), Math.sin(yaw + Math.PI / 2)];
    const o = (d: number): [number, number] => [x + n[0] * d, y + n[1] * d];
    let p = o(0.02); detail.get('trim', x, y).add(mat(p[0], p[1], 0.12, yaw, w + 0.28, 0.04, h + 0.2), darkC);
    p = o(0.04); detail.get('shop', x, y).add(mat(p[0], p[1], 0.15, yaw, w, 0.07, h), grand ? col([0.32, 0.04, 40]) : doorC);
    p = o(0.03); detail.get('glass', x, y).add(mat(p[0], p[1], 0.15 + h + 0.1, yaw, w, 0.06, 0.4), glassC);
    p = o(0.05); detail.get('trim', x, y).add(mat(p[0], p[1], 0.15 + h + 0.55, yaw, w + 0.45, 0.12, 0.14), trimC);
    p = o(0.28); detail.get('trim', x, y).add(mat(p[0], p[1], 0, yaw, w + 0.55, 0.55, 0.15), col(P.kerb));
    p = o(0.16); detail.get('trim', x, y).add(mat(p[0], p[1], 0, yaw, w + 0.45, 0.35, 0.3), col([0.78, 0.012, 80]));
    stats.doors++;
  }
}

/** Write per-structure data state and colour into the data-bearing meshes.
 *  state: -1 = not a model entity (keep the material), 0 = entity with no data (hatch), 1 = value. */
export function applyData(meshes: THREE.InstancedMesh[], colour: Float32Array, state: Int8Array) {
  for (const mesh of meshes) {
    const sl = mesh.userData.slots as DataSlots | undefined;
    if (!sl) continue;
    const d = sl.data.array as Float32Array, inf = sl.info.array as Float32Array;
    for (let i = 0; i < mesh.count; i++) {
      const s = sl.struct[i];
      if (s < 0) continue;
      d[i * 3] = colour[s * 3]; d[i * 3 + 1] = colour[s * 3 + 1]; d[i * 3 + 2] = colour[s * 3 + 2];
      inf[i * 3] = state[s];
    }
    sl.data.needsUpdate = true; sl.info.needsUpdate = true;
  }
}
