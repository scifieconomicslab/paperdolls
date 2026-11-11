// Step 6: decorative life — traffic on the road graph, parked cars, paper-doll pedestrians on the pavements,
// chimney smoke and a flock of gulls. All seeded, labelled decorative, frozen by `clock=` in snapshots,
// stopped under prefers-reduced-motion. The model tracks no mobile agents. recipes: life.md
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, hex } from './palette.ts';
import { houseMat, rng, pick, canvasTex, NO_INK, ZERO } from './util.ts';
import type { Layout, V2 } from './layout.ts';

interface Edge { a: number; b: number; pts: V2[]; len: number; speed: number; cls: string }
interface Car { e: number; s: number; dir: 1 | -1; wait: number; speedK: number }
interface Walker { loop: V2[]; len: number; s: number; v: number; phase: number }

export interface LifeOut {
  group: THREE.Group;
  step(dt: number): void;
  setVisible(viewWidth: number): void;
  stats: Record<string, number>;
}

const SPEED = { avenue: 13 * 0.5, local: 7 * 0.5 };   // life.md: halve real speeds if frantic

function carGeos() {
  // body (instance colour) and glass + wheels (dark) as two merged geometries, car points along +x
  const body = new THREE.BoxGeometry(4.3, 1.8, 0.8); body.translate(0, 0, 0.35 + 0.4);
  const cabin = new THREE.BoxGeometry(2.3, 1.6, 0.6); cabin.translate(-0.2, 0, 1.15 + 0.3);
  const glass = new THREE.BoxGeometry(2.4, 1.62, 0.42); glass.translate(-0.2, 0, 1.12 + 0.21);
  const wheels: THREE.BufferGeometry[] = [];
  for (const [x, y] of [[1.35, 0.85], [-1.35, 0.85], [1.35, -0.85], [-1.35, -0.85]]) { const w = new THREE.BoxGeometry(0.7, 0.25, 0.7); w.translate(x, y, 0.35); wheels.push(w); }
  return { body: mergeGeometries([body, cabin]), dark: mergeGeometries([glass, ...wheels]) };
}
function busGeos() {
  const body = new THREE.BoxGeometry(12, 2.5, 2.7); body.translate(0, 0, 0.35 + 1.35);
  const glass = new THREE.BoxGeometry(11.4, 2.54, 0.9); glass.translate(0.1, 0, 2.0);
  const wheels: THREE.BufferGeometry[] = [];
  for (const [x, y] of [[4, 1.2], [-4, 1.2], [4, -1.2], [-4, -1.2]]) { const w = new THREE.BoxGeometry(1, 0.3, 1); w.translate(x, y, 0.5); wheels.push(w); }
  return { body, dark: mergeGeometries([glass, ...wheels]) };
}

export function buildLife(lay: Layout, parking: { x: number; y: number; yaw: number }[], chimneys: THREE.Vector3[], seed: number): LifeOut {
  const r = rng(seed);
  const group = new THREE.Group(); group.name = 'life';
  const stats: Record<string, number> = {};

  // ---- road graph (life §1) ----
  const nv = lay.vroads.length, nh = lay.hroads.length;
  const nodeId = (i: number, j: number) => i * nh + j;
  const nodePos: V2[] = []; for (let i = 0; i < nv; i++) for (let j = 0; j < nh; j++) nodePos.push(lay.nodes[i][j]);
  const edges: Edge[] = []; const adj: number[][] = nodePos.map(() => []);
  const addEdge = (a: number, b: number, cls: string) => {
    const pa = nodePos[a], pb = nodePos[b];
    const e: Edge = { a, b, pts: [pa, pb], len: Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), speed: SPEED[cls as 'avenue' | 'local'], cls };
    adj[a].push(edges.length); adj[b].push(edges.length); edges.push(e);
  };
  for (let i = 0; i < nv; i++) for (let j = 0; j < nh - 1; j++) addEdge(nodeId(i, j), nodeId(i, j + 1), lay.vroads[i].cls);
  for (let j = 0; j < nh; j++) for (let i = 0; i < nv - 1; i++) addEdge(nodeId(i, j), nodeId(i + 1, j), lay.hroads[j].cls);

  // ---- moving vehicles: density per 100 m from the bible (local 0.5, avenue 1.5) ----
  const cars: Car[] = [], buses: Car[] = [];
  for (let e = 0; e < edges.length; e++) {
    const E = edges[e];
    const per100 = E.cls === 'avenue' ? 2.0 : 1.0;
    const n = Math.floor((E.len / 100) * per100 + r());
    for (let k = 0; k < n; k++) cars.push({ e, s: r() * E.len, dir: r() < 0.5 ? 1 : -1, wait: 0, speedK: 0.85 + r() * 0.3 });
    if (E.cls === 'avenue' && r() < 0.06) buses.push({ e, s: r() * E.len, dir: r() < 0.5 ? 1 : -1, wait: 0, speedK: 0.8 });
  }
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
  // parked cars (static, after the moving ones)
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
    const E = edges[c.e];
    const [pa, pb] = c.dir === 1 ? [E.pts[0], E.pts[1]] : [E.pts[1], E.pts[0]];
    const t = c.s / E.len;
    const dx = (pb[0] - pa[0]) / E.len, dy = (pb[1] - pa[1]) / E.len;
    const lane = half;                                   // right-hand traffic: offset to the right of travel
    const x = pa[0] + (pb[0] - pa[0]) * t + dy * lane, y = pa[1] + (pb[1] - pa[1]) * t - dx * lane;
    q.setFromAxisAngle(Z, Math.atan2(dy, dx));
    m.compose(p3.set(x, y, 0.02), q, sc);
    meshB.setMatrixAt(i, m); meshD.setMatrixAt(i, m);
  };
  const advance = (c: Car, dt: number) => {
    const E = edges[c.e];
    if (c.wait > 0) { c.wait -= dt; return; }
    const remain = E.len - c.s;
    const v = E.speed * c.speedK * Math.min(1, Math.max(0.15, remain / 8));  // ease to the junction over 8 m
    c.s += v * dt;
    if (c.s >= E.len - 0.5) {
      const node = c.dir === 1 ? E.b : E.a;
      const options = adj[node].filter((k) => k !== c.e);
      const ne = options.length ? options[Math.floor(r() * options.length)] : c.e;
      c.e = ne; c.dir = edges[ne].a === node ? 1 : -1; c.s = 0; c.wait = r() * 1.5;
    }
  };

  // ---- pedestrians: paper dolls looping around block pavements (life §3) ----
  const walkers: Walker[] = [];
  for (const b of lay.blocks) {
    const loop = b.walk.map(([x, y]) => [x, y] as V2);
    // centreline of the pavement: pull 1.1 m inward from the kerb edge toward the block centre
    const cx = (b.rect[0] + b.rect[2]) / 2, cy = (b.rect[1] + b.rect[3]) / 2;
    const inner = loop.map(([x, y]) => { const dx = cx - x, dy = cy - y, l = Math.hypot(dx, dy) || 1; return [x + (dx / l) * 1.0, y + (dy / l) * 1.0] as V2; });
    let len = 0; for (let k = 0; k < inner.length; k++) { const a = inner[k], c = inner[(k + 1) % inner.length]; len += Math.hypot(c[0] - a[0], c[1] - a[1]); }
    const mult = b.use === 'square' ? 3 : b.use === 'shophouse' || b.use === 'block' ? 1.6 : 1;
    const n = Math.floor((len / 100) * 3 * mult + r());
    for (let k = 0; k < n; k++) {
      const v = (1.2 + r() * 0.3) * 0.7 * (r() < 0.5 ? 1 : -1);
      const s0 = r() * len;
      walkers.push({ loop: inner, len, s: s0, v, phase: r() * 6.28 });
      if (r() < 0.2) walkers.push({ loop: inner, len, s: s0 + 0.7, v, phase: r() * 6.28 });   // pairs
    }
  }
  // square: a few standing / strolling around the pond
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
    let s = ((w.s % w.len) + w.len) % w.len;
    for (let k = 0; k < w.loop.length; k++) {
      const a = w.loop[k], c = w.loop[(k + 1) % w.loop.length];
      const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (s <= l) { const t = s / (l || 1); out[0] = a[0] + (c[0] - a[0]) * t; out[1] = a[1] + (c[1] - a[1]) * t; return Math.atan2(c[1] - a[1], c[0] - a[0]); }
      s -= l;
    }
    out[0] = w.loop[0][0]; out[1] = w.loop[0][1]; return 0;
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

  // ---- gulls: one flock of 7 V-shapes arcing over the square and pond ----
  const gullGeo = new THREE.BufferGeometry();
  gullGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.35, 0.55, 0.12, 0.15, 0, 0, 0, 0, 0, 0.15, 0, 0, -0.35, -0.55, 0.12], 3));
  gullGeo.computeVertexNormals();
  const gulls = new THREE.InstancedMesh(gullGeo, new THREE.MeshBasicMaterial({ color: hex([0.97, 0.005, 90]), side: THREE.DoubleSide }), 7);
  gulls.frustumCulled = false;
  group.add(gulls);
  const gullOff = Array.from({ length: 7 }, (_, i) => [(i % 3) * 2.2 - 2 + r(), Math.floor(i / 3) * 2 - 2 + r(), r() * 1.5]);

  let time = 0;
  const pos2: V2 = [0, 0];
  const camQ = new THREE.Quaternion();
  function write() {
    cars.forEach((c, i) => place(c, carBody, carDark, i, edges[c.e].cls === 'avenue' ? 2.2 : 1.4));
    buses.forEach((c, i) => place(c, busBody, busDark, i, 2.3));
    carBody.instanceMatrix.needsUpdate = carDark.instanceMatrix.needsUpdate = true;
    busBody.instanceMatrix.needsUpdate = busDark.instanceMatrix.needsUpdate = true;
    walkers.forEach((w, i) => {
      const yaw = walkPos(w, pos2) + (w.v < 0 ? Math.PI : 0);
      const bob = Math.abs(Math.sin(time * Math.PI * 2 * 2 * 0.5 + w.phase)) * 0.04;
      q.setFromAxisAngle(Z, yaw); m.compose(p3.set(pos2[0], pos2[1], 0.15 + bob), q, sc);
      garmentMesh.setMatrixAt(i, m); headMesh.setMatrixAt(i, m);
    });
    garmentMesh.instanceMatrix.needsUpdate = headMesh.instanceMatrix.needsUpdate = true;
    // smoke: rise 0.6 m/s, grow, fade over 6 s (fade via scale to zero at the end)
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
      const [ox, oy, oz] = gullOff[i];
      const flap = Math.sin(time * 5 + i) * 0.25;
      q.setFromAxisAngle(Z, a + Math.PI / 2);
      m.compose(p3.set(cx + Math.cos(a) * 70 + ox, cy + Math.sin(a) * 45 + oy, 34 + oz + flap), q, new THREE.Vector3(1.4, 1.4, 1.4));
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
      for (const w of walkers) w.s += w.v * dt;
      write();
    },
    setVisible(viewWidth: number) {
      garmentMesh.visible = headMesh.visible = viewWidth < 260;
      puffMesh.visible = viewWidth < 600;
      gulls.visible = viewWidth < 700;
      (group.userData as any).camQ = camQ;
    },
    // camera quaternion for billboards
    get camQ() { return camQ; },
  } as LifeOut & { camQ: THREE.Quaternion };
}
