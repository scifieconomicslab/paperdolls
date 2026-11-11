// Step 6: decorative life — cars and trams on the road polylines, parked cars, paper-doll pedestrians
// on the pavements, chimney smoke and pigeons. All seeded, labelled decorative, frozen by `clock=`
// in snapshots, stopped under prefers-reduced-motion. The model tracks no mobile agents.
// Jette has no junction graph in the data; vehicles and walkers travel back and forth along a single
// road (ping-pong) rather than routing through turns. recipes: life.md
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, hex } from './palette.ts';
import { houseMat, rng, pick, canvasTex, NO_INK, ZERO } from './util.ts';
import { arclength, pointAtLength, type Layout, type V2 } from './layout.ts';

interface Car { road: number; s: number; dir: 1 | -1; speedK: number }
interface Walker { road: number; s: number; v: number; phase: number }

export interface LifeOut {
  group: THREE.Group;
  step(dt: number): void;
  setVisible(viewWidth: number): void;
  stats: Record<string, number>;
}

const SPEED = { avenue: 10, local: 6, tramway: 8 } as Record<string, number>;

function carGeos() {
  const body = new THREE.BoxGeometry(4.3, 1.8, 0.8); body.translate(0, 0, 0.35 + 0.4);
  const cabin = new THREE.BoxGeometry(2.3, 1.6, 0.6); cabin.translate(-0.2, 0, 1.15 + 0.3);
  const glass = new THREE.BoxGeometry(2.4, 1.62, 0.42); glass.translate(-0.2, 0, 1.12 + 0.21);
  const wheels: THREE.BufferGeometry[] = [];
  for (const [x, y] of [[1.35, 0.85], [-1.35, 0.85], [1.35, -0.85], [-1.35, -0.85]]) { const w = new THREE.BoxGeometry(0.7, 0.25, 0.7); w.translate(x, y, 0.35); wheels.push(w); }
  return { body: mergeGeometries([body, cabin]), dark: mergeGeometries([glass, ...wheels]) };
}
function tramGeos() {
  const body = new THREE.BoxGeometry(16, 2.5, 2.6); body.translate(0, 0, 0.35 + 1.3);
  const glass = new THREE.BoxGeometry(15.2, 2.54, 0.8); glass.translate(0.1, 0, 1.9);
  const wheels: THREE.BufferGeometry[] = [];
  for (const [x, y] of [[5, 1.1], [-5, 1.1], [5, -1.1], [-5, -1.1]]) { const w = new THREE.BoxGeometry(1.2, 0.3, 1.1); w.translate(x, y, 0.5); wheels.push(w); }
  return { body, dark: mergeGeometries([glass, ...wheels]) };
}

export function buildLife(lay: Layout, parking: { x: number; y: number; yaw: number }[], chimneys: THREE.Vector3[], seed: number): LifeOut {
  const r = rng(seed);
  const group = new THREE.Group(); group.name = 'life';
  const stats: Record<string, number> = {};
  const carRoads = lay.roads.filter((rd) => rd.cls === 'avenue' || rd.cls === 'local');
  const tramRoads = lay.roads.filter((rd) => rd.tram || rd.cls === 'tramway');
  const arcs = lay.roads.map((rd) => arclength(rd.pts));

  // ---- moving vehicles (density per 100 m: avenue 1.5, local 0.7 — bible) ----
  const cars: Car[] = [];
  carRoads.forEach((rd, ri) => {
    const total = arcs[ri][arcs[ri].length - 1];
    const per100 = rd.cls === 'avenue' ? 1.5 : 0.7;
    const n = Math.floor((total / 100) * per100 + r());
    for (let k = 0; k < n; k++) cars.push({ road: ri, s: r() * total, dir: r() < 0.5 ? 1 : -1, speedK: 0.85 + r() * 0.3 });
  });
  const trams: Car[] = [];
  for (const tr of tramRoads) {
    const ri = lay.roads.indexOf(tr);
    const total = arcs[ri][arcs[ri].length - 1];
    if (total < 200) continue;
    trams.push({ road: ri, s: r() * total, dir: 1, speedK: 1 });
    if (total > 800) trams.push({ road: ri, s: r() * total, dir: -1, speedK: 1 });
  }
  const cg = carGeos(), tg = tramGeos();
  const neutral = [[0.95, 0.005, 90], [0.78, 0.005, 250], [0.55, 0.008, 250], [0.27, 0.01, 250]];
  const muted = [[0.55, 0.07, 35], [0.50, 0.06, 240], [0.50, 0.08, 160], [0.70, 0.07, 85], [0.45, 0.05, 20]];
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
  const tramBody = new THREE.InstancedMesh(tg.body, bodyMat, Math.max(1, trams.length));
  const tramDark = new THREE.InstancedMesh(tg.dark, darkMat, Math.max(1, trams.length));
  trams.forEach((_, i) => tramBody.setColorAt(i, new THREE.Color(hex(P.accent[1]))));
  tramBody.count = tramDark.count = trams.length;
  tramBody.castShadow = true; tramBody.frustumCulled = tramDark.frustumCulled = false;
  tramBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage); tramDark.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(carBody, carDark, tramBody, tramDark);
  stats.movingCars = cars.length; stats.parkedCars = parking.length; stats.trams = trams.length;

  const laneOf = (rdCls: string) => (rdCls === 'avenue' ? 2.0 : 1.3);
  const place = (c: Car, meshB: THREE.InstancedMesh, meshD: THREE.InstancedMesh, i: number) => {
    const rd = lay.roads[c.road];
    const { p, n, yaw } = pointAtLength(rd.pts, arcs[c.road], c.s);
    const lane = laneOf(rd.cls);
    const x = p[0] + n[0] * lane, y = p[1] + n[1] * lane;
    q.setFromAxisAngle(Z, yaw + (c.dir === 1 ? 0 : Math.PI));
    m.compose(p3.set(x, y, 0.02), q, sc);
    meshB.setMatrixAt(i, m); meshD.setMatrixAt(i, m);
  };
  const advance = (c: Car, dt: number) => {
    const rd = lay.roads[c.road];
    const total = arcs[c.road][arcs[c.road].length - 1];
    const v = (rd.cls === 'tramway' ? SPEED.tramway : SPEED[rd.cls]) * c.speedK;
    c.s += v * dt * c.dir;
    if (c.s >= total) { c.s = total; c.dir = -1; }
    else if (c.s <= 0) { c.s = 0; c.dir = 1; }
  };

  // ---- pedestrians: paper dolls pacing along pavements (life §3) ----
  const walkers: Walker[] = [];
  carRoads.forEach((rd, ri) => {
    const total = arcs[ri][arcs[ri].length - 1];
    const mult = rd.cls === 'avenue' ? 1.6 : 1.0;
    const n = Math.floor((total / 100) * 2.5 * mult + r());
    for (let k = 0; k < n; k++) {
      const v = (1.2 + r() * 0.3) * 0.7 * (r() < 0.5 ? 1 : -1);
      walkers.push({ road: ri, s: r() * total, v, phase: r() * 6.28 });
    }
  });
  const bodyGeo = new THREE.CapsuleGeometry(0.22, 0.8, 3, 8).rotateX(Math.PI / 2).translate(0, 0, 0.62);
  const headGeo = new THREE.SphereGeometry(0.17, 10, 8).translate(0, 0, 1.42);
  const garments = [[0.45, 0.06, 250], [0.35, 0.03, 40], [0.60, 0.05, 60], [0.50, 0.08, 150], [0.72, 0.04, 85], [0.30, 0.02, 260], [0.55, 0.09, 30]];
  const garmentMesh = new THREE.InstancedMesh(bodyGeo, houseMat({ lensK: 0.9 }), Math.max(1, walkers.length));
  const headMesh = new THREE.InstancedMesh(headGeo, houseMat({ color: hex(P.paper), lensK: 0.3 }), Math.max(1, walkers.length));
  walkers.forEach((_, i) => garmentMesh.setColorAt(i, new THREE.Color(hex((r() < 0.15 ? pick(r, P.accent) : pick(r, garments)) as [number, number, number]))));
  garmentMesh.castShadow = true; garmentMesh.frustumCulled = headMesh.frustumCulled = false;
  garmentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(garmentMesh, headMesh);
  stats.pedestrians = walkers.length;
  const walkPos = (w: Walker, out: V2): number => {
    const rd = lay.roads[w.road];
    const total = arcs[w.road][arcs[w.road].length - 1];
    const { p, n, yaw } = pointAtLength(rd.pts, arcs[w.road], w.s);
    const off = rd.cls === 'avenue' ? rd.width / 2 + 1.4 : rd.width / 2 + 1.0;
    out[0] = p[0] + n[0] * off; out[1] = p[1] + n[1] * off;
    return yaw;
  };

  // ---- chimney smoke: 30 % of chimneys, 5 billboard puffs each (NO_INK) ----
  const smokers = chimneys.filter(() => r() < 0.3);
  const PUFFS = 5;
  const puffTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(240,236,230,0.85)'); gr.addColorStop(0.6, 'rgba(235,230,224,0.35)'); gr.addColorStop(1, 'rgba(235,230,224,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  const puffMat = new THREE.MeshBasicMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0.8, fog: true });
  const puffMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), puffMat, Math.max(1, smokers.length * PUFFS));
  puffMesh.layers.set(NO_INK); puffMesh.frustumCulled = false; puffMesh.renderOrder = 5;
  puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(puffMesh);
  stats.smokingChimneys = smokers.length;

  // ---- pigeons: one flock of 7 over the market square ----
  const pigeonGeo = new THREE.BufferGeometry();
  pigeonGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.3, 0.45, 0.1, 0.12, 0, 0, 0, 0, 0, 0.12, 0, 0, -0.3, -0.45, 0.1], 3));
  pigeonGeo.computeVertexNormals();
  const pigeons = new THREE.InstancedMesh(pigeonGeo, new THREE.MeshBasicMaterial({ color: hex([0.62, 0.01, 250]), side: THREE.DoubleSide }), 7);
  pigeons.frustumCulled = false;
  group.add(pigeons);
  const pigeonOff = Array.from({ length: 7 }, (_, i) => [(i % 3) * 1.8 - 1.6 + r(), Math.floor(i / 3) * 1.6 - 1.6 + r(), r() * 1.2]);

  let time = 0;
  const pos2: V2 = [0, 0];
  const camQ = new THREE.Quaternion();
  function write() {
    cars.forEach((c, i) => place(c, carBody, carDark, i));
    trams.forEach((c, i) => place(c, tramBody, tramDark, i));
    carBody.instanceMatrix.needsUpdate = carDark.instanceMatrix.needsUpdate = true;
    tramBody.instanceMatrix.needsUpdate = tramDark.instanceMatrix.needsUpdate = true;
    walkers.forEach((w, i) => {
      const yaw = walkPos(w, pos2) + (w.v < 0 ? Math.PI : 0);
      const bob = Math.abs(Math.sin(time * Math.PI * 2 * 2 * 0.5 + w.phase)) * 0.04;
      q.setFromAxisAngle(Z, yaw); m.compose(p3.set(pos2[0], pos2[1], 0.15 + bob), q, sc);
      garmentMesh.setMatrixAt(i, m); headMesh.setMatrixAt(i, m);
    });
    garmentMesh.instanceMatrix.needsUpdate = headMesh.instanceMatrix.needsUpdate = true;
    smokers.forEach((c, k) => {
      for (let j = 0; j < PUFFS; j++) {
        const age = ((time + (j * 6) / PUFFS + k * 0.37) % 6) / 6;
        const s = (0.5 + age * 2.2) * (age > 0.85 ? (1 - age) / 0.15 : 1);
        m.compose(p3.set(c.x + age * 2.5, c.y + age * 1.0, c.z + age * 3.6), camQ, new THREE.Vector3(s, s, s));
        puffMesh.setMatrixAt(k * PUFFS + j, m);
      }
    });
    puffMesh.instanceMatrix.needsUpdate = true;
    const [cx, cy] = lay.centre;
    const a = time * 0.12;
    for (let i = 0; i < 7; i++) {
      const [ox, oy, oz] = pigeonOff[i];
      const flap = Math.sin(time * 5 + i) * 0.25;
      q.setFromAxisAngle(Z, a + Math.PI / 2);
      m.compose(p3.set(cx + Math.cos(a) * 40 + ox, cy + Math.sin(a) * 26 + oy, 16 + oz + flap), q, new THREE.Vector3(1.1, 1.1, 1.1));
      pigeons.setMatrixAt(i, m);
    }
    pigeons.instanceMatrix.needsUpdate = true;
  }
  if (!smokers.length) puffMesh.setMatrixAt(0, ZERO);

  return {
    group, stats,
    step(dt: number) {
      time += dt;
      for (const c of cars) advance(c, dt);
      for (const c of trams) advance(c, dt);
      for (const w of walkers) {
        const total = arcs[w.road][arcs[w.road].length - 1];
        w.s += w.v * dt;
        if (w.s >= total) { w.s = total; w.v = -Math.abs(w.v); } else if (w.s <= 0) { w.s = 0; w.v = Math.abs(w.v); }
      }
      write();
    },
    setVisible(viewWidth: number) {
      garmentMesh.visible = headMesh.visible = viewWidth < 260;
      puffMesh.visible = viewWidth < 600;
      pigeons.visible = viewWidth < 700;
      (group.userData as any).camQ = camQ;
    },
    get camQ() { return camQ; },
  } as LifeOut & { camQ: THREE.Quaternion };
}
