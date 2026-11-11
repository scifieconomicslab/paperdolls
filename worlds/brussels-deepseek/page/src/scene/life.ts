// Step 6: decorative life — traffic on the real road polylines, parked cars, paper-doll
// pedestrians on the pavements, chimney smoke and a small flock. Seeded, labelled decorative,
// frozen by `clock=` in snapshots, stopped under prefers-reduced-motion. The model tracks no
// mobile agents. recipes: life.md
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, hex } from './palette.ts';
import { houseMat, rng, pick, canvasTex, NO_INK, ZERO } from './util.ts';
import type { Layout, V2 } from './layout.ts';

interface Path { pts: V2[]; len: number[]; total: number; cls: string; width: number; sidewalk: number }
interface Car { p: number; s: number; dir: 1 | -1; wait: number; speedK: number }
interface Walker { p: number; s: number; dir: 1 | -1; v: number; side: 1 | -1; phase: number }

export interface LifeOut {
  group: THREE.Group;
  step(dt: number): void;
  setVisible(viewWidth: number): void;
  stats: Record<string, number>;
}

const SPEED = { avenue: 7.5, local: 4.5 };   // halved from real speeds: 13 and 7 m/s read frantic

function carGeos() {
  const body = new THREE.BoxGeometry(4.3, 1.8, 0.8); body.translate(0, 0, 0.75);
  const cabin = new THREE.BoxGeometry(2.3, 1.6, 0.6); cabin.translate(-0.2, 0, 1.45);
  const glass = new THREE.BoxGeometry(2.4, 1.62, 0.42); glass.translate(-0.2, 0, 1.42);
  const wheels: THREE.BufferGeometry[] = [];
  for (const [x, y] of [[1.35, 0.85], [-1.35, 0.85], [1.35, -0.85], [-1.35, -0.85]]) { const w = new THREE.BoxGeometry(0.7, 0.25, 0.7); w.translate(x, y, 0.35); wheels.push(w); }
  return { body: mergeGeometries([body, cabin]), dark: mergeGeometries([glass, ...wheels]) };
}
function busGeos() {
  const body = new THREE.BoxGeometry(11, 2.5, 2.7); body.translate(0, 0, 1.7);
  const glass = new THREE.BoxGeometry(10.4, 2.54, 0.9); glass.translate(0.1, 0, 2.1);
  const wheels: THREE.BufferGeometry[] = [];
  for (const [x, y] of [[3.6, 1.2], [-3.6, 1.2], [3.6, -1.2], [-3.6, -1.2]]) { const w = new THREE.BoxGeometry(1, 0.3, 1); w.translate(x, y, 0.5); wheels.push(w); }
  return { body, dark: mergeGeometries([glass, ...wheels]) };
}

export function buildLife(lay: Layout, parking: { x: number; y: number; yaw: number }[], chimneys: THREE.Vector3[], seed: number): LifeOut {
  const r = rng(seed);
  const group = new THREE.Group(); group.name = 'life';
  const stats: Record<string, number> = {};

  const paths: Path[] = lay.roads.filter((rd) => (rd.cls === 'avenue' || rd.cls === 'local') && rd.pts.length > 1).map((rd) => {
    const len: number[] = [];
    let total = 0;
    for (let k = 0; k < rd.pts.length - 1; k++) { const d = Math.hypot(rd.pts[k + 1][0] - rd.pts[k][0], rd.pts[k + 1][1] - rd.pts[k][1]); len.push(d); total += d; }
    return { pts: rd.pts, len, total, cls: rd.cls, width: rd.width, sidewalk: rd.sidewalk };
  });
  const totalLen = paths.reduce((a, p) => a + p.total, 0);
  const pickPath = (): number => {
    let x = r() * totalLen;
    for (let i = 0; i < paths.length; i++) { x -= paths[i].total; if (x <= 0) return i; }
    return Math.max(0, paths.length - 1);
  };
  const pointAt = (p: Path, s: number): { x: number; y: number; yaw: number } => {
    let acc = s;
    for (let k = 0; k < p.len.length; k++) {
      if (acc <= p.len[k] || k === p.len.length - 1) {
        const t = Math.max(0, Math.min(1, acc / (p.len[k] || 1)));
        const a = p.pts[k], b = p.pts[k + 1];
        return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, yaw: Math.atan2(b[1] - a[1], b[0] - a[0]) };
      }
      acc -= p.len[k];
    }
    return { x: p.pts[0][0], y: p.pts[0][1], yaw: 0 };
  };

  // ---- moving cars (cap 700), plus a deliberate cluster near the street frame ----
  const cars: Car[] = [];
  const nCars = Math.min(700, Math.round((totalLen / 100) * 1.15));
  for (let i = 0; i < nCars; i++) {
    const p = pickPath();
    cars.push({ p, s: r() * paths[p].total, dir: r() < 0.5 ? 1 : -1, wait: 0, speedK: 0.85 + r() * 0.3 });
  }
  for (let k = 0; k < 12; k++) {
    // seed a few vehicles along the roads nearest the street-shot target
    let best = 0, bestD = Infinity;
    for (let i = 0; i < paths.length; i++) {
      const q = pointAt(paths[i], paths[i].total / 2);
      const d = Math.hypot(q.x - lay.streetTarget[0], q.y - lay.streetTarget[1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    cars.push({ p: best, s: r() * paths[best].total, dir: k % 2 ? 1 : -1, wait: 0, speedK: 0.8 + r() * 0.25 });
  }
  const buses: Car[] = [];
  for (let i = 0; i < 14; i++) { const p = pickPath(); buses.push({ p, s: r() * paths[p].total, dir: r() < 0.5 ? 1 : -1, wait: 0, speedK: 0.8 }); }

  const cg = carGeos(), bg = busGeos();
  const neutral = [[0.95, 0.005, 90], [0.78, 0.005, 250], [0.55, 0.008, 250], [0.27, 0.01, 250]];
  const muted = [[0.55, 0.07, 35], [0.50, 0.06, 240], [0.62, 0.05, 140], [0.70, 0.07, 85], [0.45, 0.05, 20]];
  const carColour = () => new THREE.Color(hex((r() < 0.65 ? pick(r, neutral) : pick(r, muted)) as [number, number, number]));
  const bodyMat = houseMat({ lensK: 0.95 }), darkMat = houseMat({ color: hex([0.30, 0.015, 240]), lensK: 0.5 });
  const total = cars.length + parking.length;
  const carBody = new THREE.InstancedMesh(cg.body, bodyMat, Math.max(1, total));
  const carDark = new THREE.InstancedMesh(cg.dark, darkMat, Math.max(1, total));
  carBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage); carDark.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1), sc = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3();
  for (let i = 0; i < total; i++) carBody.setColorAt(i, carColour());
  parking.forEach((pk, k) => {
    const i = cars.length + k;
    q.setFromAxisAngle(Z, pk.yaw + (r() < 0.5 ? Math.PI : 0)); m.compose(p3.set(pk.x, pk.y, 0.02), q, sc);
    carBody.setMatrixAt(i, m); carDark.setMatrixAt(i, m);
  });
  carBody.castShadow = carDark.castShadow = true; carBody.receiveShadow = true;
  carBody.frustumCulled = carDark.frustumCulled = false;
  const busBody = new THREE.InstancedMesh(bg.body, bodyMat, Math.max(1, buses.length));
  const busDark = new THREE.InstancedMesh(bg.dark, darkMat, Math.max(1, buses.length));
  buses.forEach((_, i) => busBody.setColorAt(i, new THREE.Color(hex(P.accent[1]))));
  busBody.count = busDark.count = buses.length;
  busBody.castShadow = true; busBody.frustumCulled = busDark.frustumCulled = false;
  group.add(carBody, carDark, busBody, busDark);
  stats.movingCars = cars.length; stats.parkedCars = parking.length; stats.buses = buses.length;

  const place = (c: Car, meshB: THREE.InstancedMesh, meshD: THREE.InstancedMesh, i: number, half: number) => {
    const P0 = paths[c.p];
    const q0 = pointAt(P0, c.s);
    const yaw = q0.yaw + (c.dir === -1 ? Math.PI : 0);
    const lane = half;                                              // right-hand traffic: offset right of travel
    const x = q0.x + Math.cos(yaw + Math.PI / 2) * lane, y = q0.y + Math.sin(yaw + Math.PI / 2) * lane;
    q.setFromAxisAngle(Z, yaw);
    m.compose(p3.set(x, y, 0.02), q, sc);
    meshB.setMatrixAt(i, m); meshD.setMatrixAt(i, m);
  };
  const advance = (c: Car, dt: number) => {
    const P0 = paths[c.p];
    if (c.wait > 0) { c.wait -= dt; return; }
    const v = (SPEED[P0.cls as 'avenue' | 'local'] ?? 5) * c.speedK;
    c.s += v * dt;
    if (c.s >= P0.total - 0.4) {
      c.p = pickPath();
      c.s = 0;
      c.dir = r() < 0.5 ? 1 : -1;
      c.wait = r() * 1.2;
    }
  };

  // ---- pedestrians on the pavements ----
  const walkers: Walker[] = [];
  const nWalkers = Math.min(1200, Math.round((totalLen / 100) * 2.4));
  for (let i = 0; i < nWalkers; i++) {
    let p = pickPath();
    if (paths[p].sidewalk <= 0) p = pickPath();
    walkers.push({ p, s: r() * paths[p].total, dir: r() < 0.5 ? 1 : -1, v: (1.15 + r() * 0.35), side: r() < 0.5 ? 1 : -1, phase: r() * 6.28 });
  }
  // visibility floor in the street frame: 12 walkers cast along the nearest pavement,
  // inside the 64 m shot. Without this the avenue's trees hide the distributed walkers.
  {
    let best = 0, bestD = Infinity, bestS = 0;
    for (let i = 0; i < paths.length; i++) {
      if (paths[i].sidewalk <= 0) continue;
      const P0 = paths[i];
      for (let s0 = 0; s0 < P0.total; s0 += 4) {
        const q0 = pointAt(P0, s0);
        const d = Math.hypot(q0.x - lay.streetTarget[0], q0.y - lay.streetTarget[1]);
        if (d < bestD) { bestD = d; best = i; bestS = s0; }
      }
    }
    for (let k = 0; k < 24; k++) {
      const P0 = paths[best];
      const s0 = Math.max(2, Math.min(P0.total - 2, bestS + (k - 12) * 3.2 + r() * 2));
      walkers.push({ p: best, s: s0, dir: k % 2 ? 1 : -1, v: 1.15 + r() * 0.3, side: k % 4 < 2 ? 1 : -1, phase: r() * 6.28 });
    }
  }
  const bodyGeo = new THREE.CapsuleGeometry(0.22, 0.8, 3, 8).rotateX(Math.PI / 2).translate(0, 0, 0.62);
  const headGeo = new THREE.SphereGeometry(0.17, 8, 6).translate(0, 0, 1.42);
  const garments = [[0.45, 0.06, 250], [0.35, 0.03, 40], [0.60, 0.05, 60], [0.50, 0.08, 150], [0.72, 0.04, 85], [0.30, 0.02, 260], [0.55, 0.09, 30]];
  const garmentMesh = new THREE.InstancedMesh(bodyGeo, houseMat({ lensK: 0.9 }), Math.max(1, walkers.length));
  const headMesh = new THREE.InstancedMesh(headGeo, houseMat({ color: hex(P.paper), lensK: 0.3 }), Math.max(1, walkers.length));
  walkers.forEach((_, i) => garmentMesh.setColorAt(i, new THREE.Color(hex((r() < 0.15 ? pick(r, P.accent) : pick(r, garments)) as [number, number, number]))));
  garmentMesh.castShadow = true; garmentMesh.frustumCulled = headMesh.frustumCulled = false;
  garmentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(garmentMesh, headMesh);
  stats.pedestrians = walkers.length;

  const walkPos = (w: Walker, out: V2): number => {
    const P0 = paths[w.p];
    const q0 = pointAt(P0, w.s);
    const side = w.side * (P0.width / 2 + Math.max(0.4, P0.sidewalk * 0.55));
    out[0] = q0.x + Math.cos(q0.yaw + Math.PI / 2) * side;
    out[1] = q0.y + Math.sin(q0.yaw + Math.PI / 2) * side;
    return q0.yaw;
  };

  // ---- chimney smoke: 120 smokers nearest the opening view ----
  const near = chimneys.slice().sort((a, b) => a.distanceToSquared(new THREE.Vector3(lay.focus[0], lay.focus[1], 0)) - b.distanceToSquared(new THREE.Vector3(lay.focus[0], lay.focus[1], 0))).slice(0, 120);
  const smokers = near.filter(() => r() < 0.55);
  const PUFFS = 5;
  const puffTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(240,236,230,0.75)'); gr.addColorStop(0.6, 'rgba(235,230,224,0.28)'); gr.addColorStop(1, 'rgba(235,230,224,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  const puffMat = new THREE.MeshBasicMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0.75, fog: true });
  const puffMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), puffMat, Math.max(1, smokers.length * PUFFS));
  puffMesh.layers.set(NO_INK); puffMesh.frustumCulled = false; puffMesh.renderOrder = 5;
  puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(puffMesh);
  stats.smokingChimneys = smokers.length;

  // ---- a small flock over the opening view ----
  const gullGeo = new THREE.BufferGeometry();
  gullGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.35, 0.55, 0.12, 0.15, 0, 0, 0, 0, 0, 0.15, 0, 0, -0.35, -0.55, 0.12], 3));
  gullGeo.computeVertexNormals();
  const gulls = new THREE.InstancedMesh(gullGeo, new THREE.MeshBasicMaterial({ color: hex([0.97, 0.005, 90]), side: THREE.DoubleSide }), 9);
  gulls.frustumCulled = false;
  group.add(gulls);
  const gullOff = Array.from({ length: 9 }, (_, i) => [(i % 3) * 2.2 - 2 + r(), Math.floor(i / 3) * 2 - 2 + r(), r() * 1.5]);

  let time = 0;
  const pos2: V2 = [0, 0];
  const camQ = new THREE.Quaternion();
  function write() {
    cars.forEach((c, i) => place(c, carBody, carDark, i, paths[c.p].cls === 'avenue' ? 2.0 : 1.3));
    buses.forEach((c, i) => place(c, busBody, busDark, i, 2.1));
    carBody.instanceMatrix.needsUpdate = carDark.instanceMatrix.needsUpdate = true;
    busBody.instanceMatrix.needsUpdate = busDark.instanceMatrix.needsUpdate = true;
    walkers.forEach((w, i) => {
      const yaw = walkPos(w, pos2) + (w.dir === -1 ? Math.PI : 0);
      const bob = Math.abs(Math.sin(time * Math.PI * 2 * 2 * 0.5 + w.phase)) * 0.04;
      q.setFromAxisAngle(Z, yaw); m.compose(p3.set(pos2[0], pos2[1], 0.15 + bob), q, sc);
      garmentMesh.setMatrixAt(i, m); headMesh.setMatrixAt(i, m);
    });
    garmentMesh.instanceMatrix.needsUpdate = headMesh.instanceMatrix.needsUpdate = true;
    smokers.forEach((c, k) => {
      for (let j = 0; j < PUFFS; j++) {
        const age = ((time + (j * 6) / PUFFS + k * 0.37) % 6) / 6;
        const s = (0.5 + age * 2.2) * (age > 0.85 ? (1 - age) / 0.15 : 1);
        m.compose(p3.set(c.x + age * 2.4, c.y + age * 0.9, c.z + age * 3.4), camQ, new THREE.Vector3(s, s, s));
        puffMesh.setMatrixAt(k * PUFFS + j, m);
      }
    });
    puffMesh.instanceMatrix.needsUpdate = true;
    const a = time * 0.11;
    for (let i = 0; i < 9; i++) {
      const [ox, oy, oz] = gullOff[i];
      const flap = Math.sin(time * 5 + i) * 0.25;
      q.setFromAxisAngle(Z, a + Math.PI / 2);
      m.compose(p3.set(lay.focus[0] + Math.cos(a) * 60 + ox, lay.focus[1] + Math.sin(a) * 40 + oy, 36 + oz + flap), q, new THREE.Vector3(1.3, 1.3, 1.3));
      gulls.setMatrixAt(i, m);
    }
    gulls.instanceMatrix.needsUpdate = true;
  }
  if (!smokers.length) puffMesh.setMatrixAt(0, ZERO);

  return {
    group, stats,
    step(dt: number) {
      time += dt;
      for (const c of cars) advance(c, dt);
      for (const c of buses) advance(c, dt);
      for (const w of walkers) {
        w.s += w.dir * w.v * dt;
        const P0 = paths[w.p];
        if (w.s > P0.total - 0.5) { w.s = P0.total - 0.5; w.dir = -1; }
        else if (w.s < 0.5) { w.s = 0.5; w.dir = 1; }
      }
      write();
    },
    setVisible(viewWidth: number) {
      garmentMesh.visible = headMesh.visible = viewWidth < 320;
      puffMesh.visible = viewWidth < 900;
      gulls.visible = viewWidth < 900;
    },
    get camQ() { return camQ; },
  } as LifeOut & { camQ: THREE.Quaternion };
}
