import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, hex } from './palette';
import { noiseTexture, worldUV, mulberry32, V2 } from './util';
import type { Pipeline } from './pipeline';

type Ring = V2[]; type Poly = Ring[]; // [outer, ...holes], scene coords (x east, y south)
export interface GroundData { carriage: Poly[]; sidewalk: Poly[]; pedestrian: Poly[]; cycle: Poly[]; tram: V2[][]; boundary: Poly[]; avenues: V2[][]; lines: V2[][] }
export interface LandUse { kind: string; fp: V2[] }

const fl = (p: V2): THREE.Vector2 => new THREE.Vector2(p[0], -p[1]); // scene -> world (north up)
function shapeOf(poly: Poly): THREE.Shape {
  const s = new THREE.Shape(poly[0].map(fl));
  for (let i = 1; i < poly.length; i++) s.holes.push(new THREE.Path(poly[i].map(fl)));
  return s;
}
function flat(polys: Poly[], z: number, scale = 60): THREE.BufferGeometry {
  const gs = polys.map((p) => new THREE.ShapeGeometry(shapeOf(p)));
  const g = mergeGeometries(gs, false)!; gs.forEach((x) => x.dispose());
  g.translate(0, 0, z); worldUV(g, scale); return g;
}
function raised(polys: Poly[], z0: number, depth: number, scale = 60): THREE.BufferGeometry {
  const gs = polys.map((p) => new THREE.ExtrudeGeometry(shapeOf(p), { depth, bevelEnabled: false }));
  const g = mergeGeometries(gs, false)!; gs.forEach((x) => x.dispose());
  g.translate(0, 0, z0); worldUV(g, scale); return g;
}

export function buildGround(pipe: Pipeline, G: GroundData, LU: LandUse[]) {
  const group = new THREE.Group(); group.name = 'ground';
  const noiseA = noiseTexture(11, 512, 0.07, 20);   // +-3.5 % lightness, ~60 m repeat
  const noiseB = noiseTexture(23, 256, 0.05, 8); const noiseLU = noiseTexture(37, 512, 0.11, 22);
  const mat = (col: string, map: THREE.Texture | null, po = 0) => {
    const m = new THREE.MeshLambertMaterial({ color: col, map, polygonOffset: po !== 0, polygonOffsetFactor: -po, polygonOffsetUnits: -po });
    return m;
  };
  const add = (g: THREE.BufferGeometry, m: THREE.Material, cast = false, name = '') => {
    const o = new THREE.Mesh(g, m); o.receiveShadow = true; o.castShadow = cast; o.name = name; group.add(o); return o;
  };

  // --- world edge: diorama plinth shaped like the commune ---
  const bnd = G.boundary;
  const baseG = flat(bnd, 0, 70);
  add(baseG, mat(hex(P.ground), noiseA, 0), false, 'ground-base');
  const sideTex = (() => {
    const c = document.createElement('canvas'); c.width = 8; c.height = 128; const x = c.getContext('2d')!;
    const bands: [number, string][] = [[0, hex([0.62, 0.025, 70])], [0.10, hex(P.soil)], [0.42, hex(P.rock)], [0.72, hex([0.40, 0.022, 52])]];
    for (let i = 0; i < bands.length; i++) { x.fillStyle = bands[i][1]; x.fillRect(0, bands[i][0] * 128, 8, (i + 1 < bands.length ? bands[i + 1][0] : 1) * 128 - bands[i][0] * 128); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  const PLINTH = 10;
  const pg = bnd.map((p) => new THREE.ExtrudeGeometry(shapeOf([p[0]]), { depth: PLINTH, bevelEnabled: false }));
  const plinthG = mergeGeometries(pg, false)!; plinthG.translate(0, 0, -PLINTH - 0.02);
  const pp = plinthG.getAttribute('position'), puv = plinthG.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) puv.setXY(i, 0.5, (pp.getZ(i) + PLINTH) / PLINTH);
  const plinth = new THREE.Mesh(plinthG, new THREE.MeshLambertMaterial({ map: sideTex, color: 0xdddddd }));
  plinth.receiveShadow = true; plinth.name = 'plinth'; group.add(plinth);
  // pale stone lip: the ground base shaped outline raised 0.3 m
  const lipOuter = bnd[0][0];
  const lipShape = new THREE.Shape(lipOuter.map(fl)); // ring only: use a slightly smaller hole via offset not available -> thin extruded outline from line segments
  const lipPts: number[] = [];
  const lipBox = new THREE.BoxGeometry(1, 1, 1);
  const lipMesh = new THREE.InstancedMesh(lipBox, new THREE.MeshLambertMaterial({ color: hex(P.kerb) }), lipOuter.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  for (let i = 0; i < lipOuter.length; i++) {
    const a = fl(lipOuter[i]), b = fl(lipOuter[(i + 1) % lipOuter.length]); const len = a.distanceTo(b); if (len < 0.01) continue;
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(b.y - a.y, b.x - a.x));
    ps.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0.15); sc.set(len + 0.4, 0.9, 0.3); m4.compose(ps, q, sc); lipMesh.setMatrixAt(i, m4);
  }
  lipMesh.receiveShadow = true; group.add(lipMesh); void lipShape; void lipPts;

  // --- land use (parks, gardens, water, squares) below the roads ---
  const LUc: Record<string, [string, number]> = {
    park: [hex([0.80, 0.075, 125]), 0.004], garden: [hex([P.lawn[0] + 0.02, P.lawn[1] * 0.85, P.lawn[2]]), 0.003],
    water: [hex(P.water), 0.005], square: [hex([0.90, 0.014, 80]), 0.006],
  };
  const byKind: Record<string, Poly[]> = {};
  for (const l of LU) { (byKind[l.kind] ??= []).push([l.fp]); }
  for (const [k, polys] of Object.entries(byKind)) {
    const c = LUc[k] ?? LUc.park; const g = flat(polys, c[1], 45);
    add(g, mat(c[0], k === 'park' || k === 'garden' ? noiseLU : noiseB, 1), false, 'lu-' + k);
  }

  // --- roads ---
  const roadMat = mat(hex(P.road), noiseA, 2);
  add(flat(G.carriage, 0.01, 60), roadMat, false, 'carriage');
  if (G.pedestrian.length) add(flat(G.pedestrian, 0.014, 40), mat(hex([0.84, 0.014, 80]), noiseB, 3), false, 'pedestrian');
  if (G.cycle.length) add(flat(G.cycle, 0.016, 40), mat(hex([0.66, 0.06, 40]), noiseB, 4), false, 'cycle');
  // sidewalks: raised 0.15 m, the step gives the kerb crease + shadow sliver
  add(raised(G.sidewalk, 0, 0.15, 40), mat(hex(P.sidewalk), noiseB, 0), true, 'sidewalk');

  // --- tram: dark bed + two rails ---
  const bed: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [];
  const ribbon = (pts: THREE.Vector2[], half: number, z: number, off = 0) => {
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      pos.push(pts[i].x + nx * (off - half), pts[i].y + ny * (off - half), z, pts[i].x + nx * (off + half), pts[i].y + ny * (off + half), z);
      if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    // flat ribbons must face +z
    const n = g.getAttribute('normal'); if (n.getZ(0) < 0) { const ix = g.getIndex()!; for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); } g.computeVertexNormals(); }
    return g;
  };
  for (const line of G.tram) {
    if (line.length < 2) continue; const pts = line.map(fl);
    bed.push(ribbon(pts, 1.25, 0.03)); rails.push(ribbon(pts, 0.05, 0.05, 0.72), ribbon(pts, 0.05, 0.05, -0.72));
  }
  if (bed.length) {
    add(mergeGeometries(bed)!, mat(hex([0.42, 0.012, 70]), null, 5), false, 'tram-bed');
    add(mergeGeometries(rails)!, mat(hex([0.86, 0.01, 250]), null, 6), false, 'tram-rails');
  }
  return { group, bounds: bnd[0][0].map(fl) };
}

/** avenue centre dashes + zebra crossings, as instanced thin quads */
export function buildMarkings(avenues: V2[][]) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: hex([0.92, 0.012, 90]), transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
  const items: THREE.Matrix4[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  for (const line of avenues) {
    const pts = line.map(fl); let carry = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1]; const len = a.distanceTo(b); const ang = Math.atan2(b.y - a.y, b.x - a.x);
      for (let d = 3 - (carry % 9); d < len - 3; d += 9) {
        const t = d / len; ps.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 0.022); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang); sc.set(3, 0.14, 1);
        items.push(m4.clone().compose(ps, q, sc));
      }
      carry += len;
    }
  }
  const mesh = new THREE.InstancedMesh(quad, mat, items.length); items.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.receiveShadow = true; mesh.name = 'markings';
  return mesh;
}

/** street lamps every ~30 m, alternating sides (decorative, labelled) */
export function buildLamps(lines: V2[][], avenues: Set<string> | null = null) {
  void avenues;
  const poleG = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff });
  const pole = new THREE.InstancedMesh(poleG, mat, 20000), head = new THREE.InstancedMesh(poleG, mat, 20000), arm = new THREE.InstancedMesh(poleG, mat, 20000);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3();
  const poleCol = new THREE.Color(hex([0.34, 0.015, 250])), headCol = new THREE.Color(hex([0.88, 0.04, 90]));
  let n = 0; let side = 1;
  for (const ln of lines) {
    const pts = ln.map(fl); let acc = 15 + (pts[0].x * 7 % 15);
    for (let i = 0; i + 1 < pts.length && n < 19990; i++) {
      const a = pts[i], b = pts[i + 1]; const len = a.distanceTo(b); const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
      for (let d = acc; d < len; d += 24) {
        side = -side; const off = 4.3 * side; const x = a.x + dx * d - dy * off, y = a.y + dy * d + dx * off;
        const ang = Math.atan2(dy, dx);
        q.identity(); ps.set(x, y, 0.15); sc.set(0.22, 0.22, 5.8); m.compose(ps, q, sc); pole.setMatrixAt(n, m); pole.setColorAt(n, poleCol);
        q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang); const ox = -dy * -side * 0.6, oy = dx * -side * 0.6;
        ps.set(x + ox * 1.0, y + oy * 1.0, 5.85); sc.set(0.16, 1.4, 0.16); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang + Math.PI / 2); m.compose(ps, q, sc); arm.setMatrixAt(n, m); arm.setColorAt(n, poleCol);
        ps.set(x + ox * 2.0, y + oy * 2.0, 5.7); sc.set(0.7, 0.35, 0.28); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang); m.compose(ps, q, sc); head.setMatrixAt(n, m); head.setColorAt(n, headCol);
        n++;
      }
      acc = ((acc - len) % 30 + 30) % 30;
    }
  }
  const g = new THREE.Group(); g.name = 'lamps';
  for (const o of [pole, arm, head]) { o.count = n; o.castShadow = o === pole; o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true; o.computeBoundingSphere(); g.add(o); }
  return g;
}

/** parked cars along local streets (bible: "parked cars on locals"); decorative, static, seeded */
export function buildParked(pipe: Pipeline, lines: V2[][]) {
  const toon = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: pipe.toon });
  const boxZ = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  const body = new THREE.InstancedMesh(boxZ, toon, 30000), cab = new THREE.InstancedMesh(boxZ, toon, 30000), under = new THREE.InstancedMesh(boxZ, toon, 30000);
  const rnd = mulberry32(777); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
  const cols = [hex([0.84, 0.01, 90]), hex([0.62, 0.012, 250]), hex([0.36, 0.012, 250]), hex([0.74, 0.02, 80]), hex([0.45, 0.05, 235]), hex([0.52, 0.08, 40])].map((c) => new THREE.Color(c));
  const dark = new THREE.Color(hex(P.ink)), glass = new THREE.Color(hex([0.45, 0.03, 235]));
  let n = 0;
  for (const ln of lines) {
    const pts = ln.map(fl);
    for (let i = 0; i + 1 < pts.length && n < 29990; i++) {
      const a = pts[i], b = pts[i + 1]; const len = a.distanceTo(b); const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len; const ang = Math.atan2(dy, dx);
      const side = rnd() < 0.5 ? 1 : -1;
      for (let d = 10; d < len - 10; d += 5.8) {
        if (rnd() > 0.32) continue;
        const off = 1.75 * side; const x = a.x + dx * d - dy * off, y = a.y + dy * d + dx * off;
        q.setFromAxisAngle(up, ang + (rnd() < 0.5 ? 0 : Math.PI)); const col = cols[Math.floor(rnd() * cols.length)];
        ps.set(x, y, 0.35); sc.set(4.0, 1.75, 0.65); m.compose(ps, q, sc); body.setMatrixAt(n, m); body.setColorAt(n, col);
        ps.set(x, y, 0.95); sc.set(2.1, 1.6, 0.6); m.compose(ps, q, sc); cab.setMatrixAt(n, m); cab.setColorAt(n, glass);
        ps.set(x, y, 0.12); sc.set(3.7, 1.5, 0.3); m.compose(ps, q, sc); under.setMatrixAt(n, m); under.setColorAt(n, dark);
        n++;
      }
    }
  }
  const g = new THREE.Group(); g.name = 'parked-cars';
  for (const o of [under, body, cab]) { o.count = n; o.castShadow = true; o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true; o.computeBoundingSphere(); g.add(o); }
  return { group: g, count: n };
}

/** zebra crossings + stop lines where a local street meets an avenue: seven metres back from the junction on the local arm (streets-and-ground §3) */
export function buildCrossings(lines: V2[][], avenues: V2[][]) {
  const quad = new THREE.PlaneGeometry(1, 1); const mat = new THREE.MeshLambertMaterial({ color: hex([0.94, 0.01, 90]), transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9 });
  const ave = avenues.map((l) => l.map(fl)); const mats: THREE.Matrix4[] = []; const q = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1); const m4 = new THREE.Matrix4();
  const dseg = (p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)); return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)); };
  const nearAve = (p: THREE.Vector2) => { let d = 1e9; for (const l of ave) for (let i = 0; i + 1 < l.length; i++) d = Math.min(d, dseg(p, l[i], l[i + 1])); return d; };
  for (const ln of lines) {
    const pts = ln.map(fl); if (pts.length < 2) continue;
    for (const end of [0, 1]) {
      const e = end ? pts[pts.length - 1] : pts[0], nx = end ? pts[pts.length - 2] : pts[1]; if (nearAve(e) > 14) continue;
      const dx = nx.x - e.x, dy = nx.y - e.y, l = Math.hypot(dx, dy); if (l < 12) continue; const ux = dx / l, uy = dy / l; const ang = Math.atan2(uy, ux);
      const cx = e.x + ux * 9, cy = e.y + uy * 9; // crossing centre on the local arm
      for (let k = -3; k <= 3; k++) { const ox = -uy * k * 0.9, oy = ux * k * 0.9; q.setFromAxisAngle(up, ang); ps.set(cx + ox, cy + oy, 0.026); sc.set(3.4, 0.5, 1); m4.compose(ps, q, sc); mats.push(m4.clone()); }
      q.setFromAxisAngle(up, ang + Math.PI / 2); ps.set(e.x + ux * 12.5, e.y + uy * 12.5, 0.026); sc.set(5.2, 0.4, 1); m4.compose(ps, q, sc); mats.push(m4.clone());
    }
  }
  const mesh = new THREE.InstancedMesh(quad, mat, mats.length); mats.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.receiveShadow = true; mesh.name = 'crossings'; return mesh;
}
