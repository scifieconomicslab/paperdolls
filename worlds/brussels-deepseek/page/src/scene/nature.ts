// Step 5: trees — the mapped OSM trees first (data), then decorative street and park trees.
// Jette is leafy: the scene carries 8,705 mapped trees, most of the canopy in the world.
// recipes: nature-and-water.md
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, hex } from './palette.ts';
import { Parts, houseMat, mat, rng, valueNoise } from './util.ts';
import { inPoly, type Layout, type V2 } from './layout.ts';

export interface NatureOut { group: THREE.Group; stats: Record<string, number> }

function canopyGeo(seed: number, kind: 'round' | 'columnar' | 'conifer') {
  const n = valueNoise(seed + 5);
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'round') {
    for (const [rad, ox, oy, oz] of [[1.45, 0, 0, 0], [1.1, 0.6, 0.35, -0.35], [0.95, -0.55, -0.4, -0.2]] as const) {
      const g = new THREE.IcosahedronGeometry(rad, 0); g.translate(ox, oy, oz); parts.push(g);
    }
  } else if (kind === 'columnar') {
    const g = new THREE.IcosahedronGeometry(1, 0); g.scale(0.8, 0.8, 2.2); parts.push(g);
  } else {
    for (let k = 0; k < 3; k++) { const g = new THREE.ConeGeometry(1.35 - k * 0.36, 1.7, 6); g.rotateX(Math.PI / 2); g.translate(0, 0, k * 1.0 - 1.1); parts.push(g); }
  }
  const g = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }));
  const pos = g.getAttribute('position');
  const colors: number[] = [];
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < pos.count; i++) { zmin = Math.min(zmin, pos.getZ(i)); zmax = Math.max(zmax, pos.getZ(i)); }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const j = 1 + (n(x * 1.7 + 3, y * 1.7 + z) - 0.5) * 0.2;
    pos.setXYZ(i, x * j, y * j, z * (1 + (j - 1) * 0.6));
    const t = (z - zmin) / (zmax - zmin || 1);
    const v = 0.78 + 0.3 * t;
    colors.push(v, v, v);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export function buildNature(lay: Layout, streetTrees: V2[], seed: number): NatureOut {
  const r = rng(seed);
  const group = new THREE.Group(); group.name = 'nature';
  const kinds = { round: new Parts('tree-round'), columnar: new Parts('tree-columnar'), conifer: new Parts('tree-conifer') };
  const trunks = new Parts('trunk');
  const stats: Record<string, number> = { dataTrees: 0, streetTrees: 0, skipped: 0 };
  const veg = P.veg;

  // coarse building grid so a tree is never planted inside a building
  const CELL = 40;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < lay.structs.length; i++) {
    const s = lay.structs[i];
    const key = Math.floor(s.c[0] / CELL) + ':' + Math.floor(s.c[1] / CELL);
    const list = grid.get(key); if (list) list.push(i); else grid.set(key, [i]);
  }
  const onBuilding = (p: V2, pad: number) => {
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
      for (const k of grid.get(i + ':' + j) ?? []) {
        const s = lay.structs[k];
        const dx = p[0] - s.c[0], dy = p[1] - s.c[1];
        if (Math.abs(dx * s.ax[0] + dy * s.ax[1]) < s.L / 2 + pad && Math.abs(dx * s.ay[0] + dy * s.ay[1]) < s.W / 2 + pad) return true;
      }
    }
    return false;
  };

  function tree(p: V2, kind: 'round' | 'columnar' | 'conifer', h: number, tone: number) {
    const yaw = r() * Math.PI * 2;
    const s = h / 8;
    const c = new THREE.Color(hex([veg[tone][0] + (r() - 0.5) * 0.04, veg[tone][1], veg[tone][2] + (r() - 0.5) * 6]));
    const crownZ = kind === 'columnar' ? h * 0.55 : kind === 'conifer' ? h * 0.5 : h * 0.62;
    const cs = kind === 'round' ? s * 1.75 : kind === 'columnar' ? s * 1.6 : s * 1.9;
    kinds[kind].add(mat(p[0], p[1], 0.12 + crownZ, yaw, cs, cs, cs), c);
    trunks.add(mat(p[0], p[1], 0.12, 0, 0.3 * s + 0.08, 0.3 * s + 0.08, crownZ), new THREE.Color(hex([0.38, 0.03, 55])));
  }

  // 1. mapped trees (data), placed first
  for (const [x, y, kind, sc] of lay.trees) {
    if (onBuilding([x, y], 0.4)) { stats.skipped++; continue; }
    const k = kind === 'columnar' ? 'columnar' : kind === 'conifer' ? 'conifer' : 'round';
    tree([x, y], k, 6.5 * (sc || 1) + r() * 2.5, Math.floor(r() * 3));
    stats.dataTrees++;
  }
  // 2. decorative street trees, one kind per avenue
  for (const p of streetTrees) {
    if (onBuilding(p, 0.8)) continue;
    tree(p, 'round', 6.2 + r() * 1.5, r() < 0.3 ? 2 : 1);
    stats.streetTrees++;
  }
  // 3. a few park trees where the ingest left clearings (decorative, counted)
  const n = valueNoise(seed + 9);
  for (const lu of lay.landuse) {
    if (lu.kind !== 'park' && lu.kind !== 'garden') continue;
    const poly = lu.poly;
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    if (x1 - x0 < 12 || y1 - y0 < 12) continue;
    for (let k = 0; k < 6; k++) {
      const p: V2 = [x0 + 3 + r() * (x1 - x0 - 6), y0 + 3 + r() * (y1 - y0 - 6)];
      if (!inPoly(p, poly) || onBuilding(p, 1.5) || n(p[0] / 18, p[1] / 18) < 0.5) continue;
      tree(p, r() < 0.7 ? 'round' : r() < 0.5 ? 'conifer' : 'columnar', 6 + r() * 4, Math.floor(r() * 3));
      stats.parkTrees = (stats.parkTrees ?? 0) + 1;
    }
  }

  const leafMat = houseMat({ vertexColors: true, sway: true, lensK: 0.6 });
  const mk = (p: Parts, g: THREE.BufferGeometry, m: THREE.Material, cast: boolean) => { const mesh = p.build(g, m, { cast, receive: true }); group.add(mesh); return mesh; };
  mk(kinds.round, canopyGeo(seed + 1, 'round'), leafMat, true);
  mk(kinds.columnar, canopyGeo(seed + 2, 'columnar'), leafMat, true);
  mk(kinds.conifer, canopyGeo(seed + 3, 'conifer'), leafMat, true);
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.6, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  mk(trunks, trunkGeo, houseMat({}), true);

  return { group, stats };
}
