// Scene step 6: decorative life. Cars (and a few buses and trams) run along the road centre-lines; paper-doll pedestrians walk on the sidewalks.
// NOT tracked by the model: seeded, labelled decorative, frozen in snapshots (clock=<s> drives them), stopped under prefers-reduced-motion.
import * as THREE from 'three';
import { P, hex } from './palette';
import { mulberry32, V2 } from './util';
import type { Pipeline } from './pipeline';

const fl = (p: V2): THREE.Vector2 => new THREE.Vector2(p[0], -p[1]);
interface Mover { line: number; s: number; v: number; dir: 1 | -1; off: number; kind: number; col: number }

export function buildLife(pipe: Pipeline, lines: V2[][], avenues: V2[][], trams: V2[][], focus: THREE.Vector3[]) {
  const group = new THREE.Group(); group.name = 'life';
  const toon = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: pipe.toon });
  const boxZ = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  const rnd = mulberry32(4242);
  const mk = (n: number) => { const i = new THREE.InstancedMesh(boxZ, toon, n); i.frustumCulled = false; i.castShadow = true; group.add(i); return i; };
  const poly = (ls: V2[][]) => ls.filter((l) => l.length > 1).map((l) => { const pts = l.map(fl); const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1])); return { pts, cum, len: cum[cum.length - 1] }; });
  const roads = poly(lines).filter((r) => r.len > 25); const aves = poly(avenues).filter((r) => r.len > 40); const rails = poly(trams).filter((r) => r.len > 60);
  const at = (r: { pts: THREE.Vector2[]; cum: number[]; len: number }, s: number) => {
    let i = 1; while (i < r.cum.length - 1 && r.cum[i] < s) i++; const a = r.pts[i - 1], b = r.pts[i]; const t = (s - r.cum[i - 1]) / Math.max(1e-6, r.cum[i] - r.cum[i - 1]);
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: a.x + dx * t, y: a.y + dy * t, tx: dx / l, ty: dy / l };
  };
  // ---- vehicles: density by the bible (local 1.0, avenue 2.0 per 100 m), capped; a few extra near the street shot so >= 2 move in frame
  const cars: Mover[] = []; const cols = [hex([0.95, 0.008, 90]), hex([0.78, 0.01, 250]), hex([0.55, 0.01, 250]), hex([0.25, 0.01, 250]), hex([0.62, 0.07, 40]), hex([0.58, 0.08, 235]), hex([0.7, 0.07, 100])].map((c) => new THREE.Color(c));
  const lenAll = roads.reduce((a, r) => a + r.len, 0);
  const nCars = Math.min(700, Math.round((lenAll / 100) * 1.0 * 0.9));
  const pickRoad = () => { let x = rnd() * lenAll; for (let i = 0; i < roads.length; i++) { x -= roads[i].len; if (x <= 0) return i; } return 0; };
  for (let i = 0; i < nCars; i++) { const l = pickRoad(); cars.push({ line: l, s: rnd() * roads[l].len, v: 5 + rnd() * 4, dir: rnd() < 0.5 ? 1 : -1, off: 1.4, kind: 0, col: Math.floor(rnd() * cols.length) }); }
  for (const f of focus) { // nearest roads to the street shot targets
    const near = roads.map((r, i) => ({ i, d: Math.min(...r.pts.map((p) => Math.hypot(p.x - f.x, p.y - f.y))) })).sort((a, b) => a.d - b.d).slice(0, 3);
    for (const nr of near) for (let k = 0; k < 4; k++) cars.push({ line: nr.i, s: rnd() * roads[nr.i].len, v: 4 + rnd() * 3, dir: k ? 1 : -1, off: 1.4, kind: 0, col: Math.floor(rnd() * cols.length) });
  }
  const buses: Mover[] = []; for (let i = 0; i < Math.min(40, aves.length); i++) buses.push({ line: i, s: rnd() * aves[i].len, v: 8, dir: rnd() < 0.5 ? 1 : -1, off: 1.6, kind: 1, col: 0 });
  const tramsM: Mover[] = []; for (let i = 0; i < Math.min(12, rails.length); i++) tramsM.push({ line: i, s: rnd() * rails[i].len, v: 9, dir: rnd() < 0.5 ? 1 : -1, off: 0, kind: 2, col: 0 });
  const body = mk(cars.length + 1), cabin = mk(cars.length + 1), busM = mk(buses.length + 1), tramM = mk(tramsM.length + 1);
  const glass = new THREE.Color(hex(P.glass)), accent = new THREE.Color(hex(P.accent[1])), accent2 = new THREE.Color(hex(P.accent[0]));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3(), zz = new THREE.Vector3(0, 0, 1);
  cars.forEach((c, i) => { body.setColorAt(i, cols[c.col]); cabin.setColorAt(i, glass); });
  buses.forEach((_, i) => busM.setColorAt(i, accent)); tramsM.forEach((_, i) => tramM.setColorAt(i, accent2));
  body.count = cabin.count = cars.length; busM.count = buses.length; tramM.count = tramsM.length;
  // ---- pedestrians: capsule-ish (garment box) + paper head; one paper tone for everyone, garments from the palette
  const nPed = Math.min(1500, Math.round(lenAll / 60)); const peds: { line: number; s: number; v: number; side: number }[] = [];
  for (let i = 0; i < nPed; i++) { const l = pickRoad(); peds.push({ line: l, s: rnd() * roads[l].len, v: (1.2 + rnd() * 0.3) * (rnd() < 0.5 ? 1 : -1), side: rnd() < 0.5 ? 1 : -1 }); }
  for (const f of focus) { const near = roads.map((r, i) => ({ i, d: Math.min(...r.pts.map((p) => Math.hypot(p.x - f.x, p.y - f.y))) })).sort((a, b) => a.d - b.d).slice(0, 3); for (const nr of near) for (let k = 0; k < 8; k++) peds.push({ line: nr.i, s: rnd() * roads[nr.i].len, v: (1.2 + rnd() * 0.3) * (k % 2 ? 1 : -1), side: k % 2 ? 1 : -1 }); }
  const sphere = new THREE.SphereGeometry(1, 8, 6).translate(0, 0, 0.0);
  const pBody = mk(peds.length + 1), pHead = new THREE.InstancedMesh(sphere, toon, peds.length + 1); pHead.frustumCulled = false; pHead.castShadow = false; group.add(pHead);
  const garments = [hex([0.5, 0.06, 250]), hex([0.6, 0.07, 40]), hex([0.72, 0.05, 100]), hex([0.4, 0.04, 300]), hex([0.82, 0.02, 90]), hex([0.55, 0.07, 150]), hex([0.34, 0.02, 250])].map((c) => new THREE.Color(c));
  const paper = new THREE.Color(hex([0.9, 0.018, 85]));
  peds.forEach((p, i) => { pBody.setColorAt(i, rnd() < 0.15 ? accent : garments[Math.floor(rnd() * garments.length)]); pHead.setColorAt(i, paper); });
  pBody.count = pHead.count = peds.length;

  let lastClock = 0;
  function update(clock: number, view: number, reduced: boolean) {
    const dt = reduced ? 0 : Math.min(0.1, Math.max(0, clock - lastClock)); lastClock = clock; const t = reduced ? 0 : clock;
    const drive = (list: Mover[], rs: typeof roads, mesh: THREE.InstancedMesh, mesh2: THREE.InstancedMesh | null, dims: [number, number, number], cab: [number, number, number, number]) => {
      list.forEach((c, i) => {
        const r = rs[c.line]; let s = c.s + c.dir * c.v * t * 0.5; const L = r.len; s = ((s % (2 * L)) + 2 * L) % (2 * L); const fwd = s <= L; const sPos = fwd ? s : 2 * L - s;
        const a = at(r, sPos); const dirSign = (fwd ? 1 : -1) * 1; const tx = a.tx * dirSign, ty = a.ty * dirSign; const nx = -ty, ny = tx;
        const x = a.x + nx * c.off * -1, y = a.y + ny * c.off * -1; const ang = Math.atan2(ty, tx);
        q.setFromAxisAngle(zz, ang); ps.set(x, y, 0.1); sc.set(dims[0], dims[1], dims[2]); m4.compose(ps, q, sc); mesh.setMatrixAt(i, m4);
        if (mesh2) { ps.set(x - tx * cab[3], y - ty * cab[3], 0.1 + dims[2] * 0.62); sc.set(cab[0], cab[1], cab[2]); m4.compose(ps, q, sc); mesh2.setMatrixAt(i, m4); }
      });
      mesh.instanceMatrix.needsUpdate = true; if (mesh2) mesh2.instanceMatrix.needsUpdate = true;
    };
    void dt;
    drive(cars, roads, body, cabin, [4.2, 1.8, 0.75], [2.2, 1.6, 0.6, 0.2]); drive(buses, aves, busM, null, [11.5, 2.5, 3.1], [0, 0, 0, 0]); drive(tramsM, rails, tramM, null, [28, 2.5, 3.3], [0, 0, 0, 0]);
    const showPed = view < 260; pBody.visible = pHead.visible = showPed;
    if (showPed) {
      peds.forEach((p, i) => {
        const r = roads[p.line]; const L = r.len; let s = p.s + p.v * t * 0.5; s = ((s % (2 * L)) + 2 * L) % (2 * L); const fwd = s <= L; const sp = fwd ? s : 2 * L - s; const a = at(r, sp);
        const nx = -a.ty, ny = a.tx; const off = (3.9 * p.side); const bob = Math.abs(Math.sin(t * 2 * Math.PI * 1.0 + i)) * 0.04;
        q.identity(); ps.set(a.x + nx * off, a.y + ny * off, 0.15 + bob); sc.set(0.5, 0.35, 1.1); m4.compose(ps, q, sc); pBody.setMatrixAt(i, m4);
        ps.set(a.x + nx * off, a.y + ny * off, 1.42 + bob); sc.set(0.19, 0.19, 0.19); m4.compose(ps, q, sc); pHead.setMatrixAt(i, m4);
      });
      pBody.instanceMatrix.needsUpdate = true; pHead.instanceMatrix.needsUpdate = true;
    }
    for (const o of [body, cabin, busM, tramM, pBody, pHead]) if (o.instanceColor) o.instanceColor.needsUpdate = true;
  }
  return { group, update, counts: { cars: cars.length, buses: buses.length, trams: tramsM.length, pedestrians: peds.length } };
}
