import * as THREE from 'three';
import { P, hex } from './palette';
import { hash01 } from './util';
import type { Pipeline } from './pipeline';

export function buildTrees(pipe: Pipeline, trees: (number | string)[][]) {
  const group = new THREE.Group(); group.name = 'trees';
  const toon = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: pipe.toon });
  const trunkG = new THREE.CylinderGeometry(0.14, 0.2, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const crownG = new THREE.IcosahedronGeometry(1, 1).translate(0, 0, 0);
  const coneG = new THREE.ConeGeometry(1, 2.4, 7).rotateX(Math.PI / 2).translate(0, 0, 1.2);
  const n = trees.length;
  const trunks = new THREE.InstancedMesh(trunkG, toon, n); const crowns = new THREE.InstancedMesh(crownG, toon, n); const cones = new THREE.InstancedMesh(coneG, toon, n);
  const trunkCol = new THREE.Color(hex([0.38, 0.03, 55]));
  const veg = P.veg.map((c) => new THREE.Color(hex(c)));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  let nc = 0, nk = 0, nt = 0; const c = new THREE.Color();
  trees.forEach((t, i) => {
    const x = t[0] as number, y = -(t[1] as number); const kind = (t[2] as string) ?? 'oak'; const sc = typeof t[3] === 'number' ? (t[3] as number) : 1;
    const r = hash01('t' + i); const conifer = kind === 'conifer';
    const rad = (kind === 'columnar' ? 1.6 : 2.4 + r * 1.6) * sc; const trunkH = conifer ? 1.2 : 2.2 + r * 0.8;
    p.set(x, y, 0.12); s.set(1, 1, trunkH); q.identity(); m.compose(p, q, s); trunks.setMatrixAt(nt, m); trunks.setColorAt(nt, trunkCol); nt++;
    const tone = veg[Math.floor(r * 3)]; c.copy(tone); const off = (hash01('u' + i) - 0.5) * 0.04; c.offsetHSL(0, 0, off);
    if (kind === 'blossom') c.set(hex([0.86, 0.05, 5]));
    if (conifer) { s.set(rad * 0.7, rad * 0.7, rad * 1.5); p.set(x, y, trunkH * 0.7); q.identity(); m.compose(p, q, s); cones.setMatrixAt(nk, m); cones.setColorAt(nk, c.clone().multiplyScalar(0.8)); nk++; }
    else { s.set(rad, rad * (kind === 'columnar' ? 1.7 : 0.9), rad * (kind === 'columnar' ? 2.4 : 0.95)); p.set(x, y, trunkH + rad * 0.6); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), r * 6); m.compose(p, q, s); crowns.setMatrixAt(nc, m); crowns.setColorAt(nc, c); nc++; }
  });
  trunks.count = nt; crowns.count = nc; cones.count = nk;
  for (const o of [trunks, crowns, cones]) { o.castShadow = true; o.receiveShadow = false; o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true; o.computeBoundingSphere(); group.add(o); }
  return group;
}
