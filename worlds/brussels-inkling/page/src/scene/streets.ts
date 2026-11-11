// Step 3: roads (curvilinear ribbons), pavements, land use (parks, gardens, squares), markings,
// tram rails, lamps, parking, street-tree slots. recipes: streets-and-ground.md
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, hex } from './palette.ts';
import { Parts, houseMat, mat, rng, unitBox, unitWedge, canvasTex, valueNoise, col, NO_INK } from './util.ts';
import { arclength, pointAtLength, inPoly, type Layout, type V2 } from './layout.ts';

export interface StreetsOut {
  group: THREE.Group;
  lod: { near: THREE.Object3D[]; mid: THREE.Object3D[] };
  parking: { x: number; y: number; yaw: number }[];
  streetTrees: V2[];
  squares: V2[][];
  stats: Record<string, number>;
}

function shapeOf(poly: V2[], holes: V2[][] = []) {
  // OSM winding order varies (y is south here); normalise to CCW so faces point up
  const area = (p: V2[]) => p.reduce((s, a, j) => { const b = p[(j + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
  const norm = (p: V2[]) => (area(p) < 0 ? p.slice().reverse() : p);
  const sh = new THREE.Shape(norm(poly).map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) sh.holes.push(new THREE.Path(norm(h).map(([x, y]) => new THREE.Vector2(x, y))));
  return sh;
}
function flat(poly: V2[], z: number, holes: V2[][] = [], uvScale = 1 / 40) {
  const g = new THREE.ShapeGeometry(shapeOf(poly, holes));
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) { uv.setXY(i, pos.getX(i) * uvScale, pos.getY(i) * uvScale); pos.setZ(i, z); }
  g.computeVertexNormals();
  return g;
}
function noiseTex(seed: number, draw: (g: CanvasRenderingContext2D, n: (x: number, y: number) => number) => void, size = 512) {
  const n = valueNoise(seed);
  return canvasTex(size, size, (g) => draw(g, n), true);
}
/** flat ribbon (triangle strip) along a polyline at height z */
function ribbon(pts: V2[], halfWidth: number, z: number) {
  const pos: number[] = [], uv: number[] = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]) || 1;
    const nx = (-d[1] / l) * halfWidth, ny = (d[0] / l) * halfWidth;
    const ext = (k === 0 || k === pts.length - 1) ? halfWidth : 0;
    const ux = (d[0] / l) * ext, uy = (d[1] / l) * ext;
    pos.push(pts[k][0] + ux + nx, pts[k][1] + uy + ny, z, pts[k][0] + ux - nx, pts[k][1] + uy - ny, z);
    uv.push((pts[k][0] + nx) / 60, (pts[k][1] + ny) / 60, (pts[k][0] - nx) / 60, (pts[k][1] - ny) / 60);
  }
  const idx: number[] = [];
  for (let k = 0; k < pts.length - 1; k++) { const i = k * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.getAttribute('normal').getZ(0) < 0) { g.scale(1, 1, 1); g.computeVertexNormals(); }
  return g;
}

export function buildStreets(lay: Layout, seed: number): StreetsOut {
  const r = rng(seed);
  const group = new THREE.Group(); group.name = 'streets';
  const stats: Record<string, number> = {};
  const squares = lay.landuse.filter((l) => l.kind === 'square').map((l) => l.poly);
  const waterHoles = lay.landuse.filter((l) => l.kind === 'water').map((l) => l.poly);

  // ---------- pavement underlay (2.4 m local / 4 m avenue) ----------
  const kerbGeos = lay.roads.filter((rd) => rd.cls !== 'tramway').map((rd) => ribbon(rd.pts, rd.width / 2 + (rd.cls === 'avenue' ? 4.0 : 2.4), 0.008));
  const kerb = new THREE.Mesh(mergeGeometries(kerbGeos), houseMat({ color: hex(P.sidewalk), lambert: true, lensK: 0.7 }));
  kerb.receiveShadow = true; group.add(kerb);
  stats.pavements = kerbGeos.length;

  // ---------- road ribbons, world-anchored dry-asphalt texture ----------
  const roadTex = noiseTex(11, (g, n) => {
    const im = g.createImageData(512, 512);
    const base = new THREE.Color(hex(P.road)), patch = new THREE.Color(hex([0.47, 0.007, 250]));
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const v2 = n(x / 9 + 50, y / 9 + 50), v3 = n(x / 70 + 20, y / 70 + 9);
      const c = base.clone();
      c.multiplyScalar(0.96 + (v2 - 0.5) * 0.08);
      if (v3 > 0.70) c.lerp(patch, 0.5);                     // repaired asphalt
      const i = (y * 512 + x) * 4;
      im.data[i] = c.r * 255; im.data[i + 1] = c.g * 255; im.data[i + 2] = c.b * 255; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
  roadTex.colorSpace = THREE.SRGBColorSpace;
  const roadGeos = lay.roads.map((rd) => ribbon(rd.pts, rd.width / 2 + 0.3, 0.02));
  const roads = new THREE.Mesh(mergeGeometries(roadGeos), houseMat({ map: roadTex, lambert: true, lensK: 0.6 }));
  roads.receiveShadow = true; roads.name = 'roads';
  group.add(roads);
  stats.roads = lay.roads.length;

  // pedestrianized streets: paving ribbon instead of asphalt
  const pedGeos = lay.roads.filter((rd) => rd.cls === 'pedestrian').map((rd) => ribbon(rd.pts, rd.width / 2, 0.025));
  if (pedGeos.length) {
    const pav = new THREE.Mesh(mergeGeometries(pedGeos), houseMat({ color: hex(P.paving), map: canvasTex(64, 64, (g) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 0, 2, 64); }, true), lambert: true }));
    pav.receiveShadow = true; group.add(pav);
  }
  // cycle lanes: muted red
  const cycGeos = lay.roads.filter((rd) => rd.cls === 'cycle').map((rd) => ribbon(rd.pts, Math.max(1.25, rd.width / 2), 0.025));
  if (cycGeos.length) {
    const cyc = new THREE.Mesh(mergeGeometries(cycGeos), houseMat({ color: hex([0.52, 0.055, 25]), lambert: true, lensK: 0.6 }));
    cyc.receiveShadow = true; group.add(cyc);
  }
  // tramway (standalone tracks): ballast + twin rails; on tram-flagged roads: one pair of rails at the centre
  const railGeos: THREE.BufferGeometry[] = [];
  for (const rd of lay.roads) {
    const pairs: number[] = rd.cls === 'tramway' ? [0] : rd.tram ? (rd.width >= 7 ? [-1.8, 1.8] : [0]) : [];
    for (const off of pairs) {
      for (const side of [-0.72, 0.72]) {
        const pts = rd.pts.map(([x, y]) => {
          // offset the polyline by (off + side) along its normal — approximate per-point
          return [x, y] as V2;
        });
        void pts;
        railGeos.push(ribbon(offsetPts(rd.pts, off + side), 0.075, 0.032));
      }
    }
  }
  if (railGeos.length) {
    const rails = new THREE.Mesh(mergeGeometries(railGeos), houseMat({ color: hex([0.72, 0.004, 250]), lensK: 0.4 }));
    rails.receiveShadow = true; group.add(rails);
    stats.rails = railGeos.length;
  }
  const tramBallast = lay.roads.filter((rd) => rd.cls === 'tramway').map((rd) => ribbon(rd.pts, 1.5, 0.028));
  if (tramBallast.length) {
    const tb = new THREE.Mesh(mergeGeometries(tramBallast), houseMat({ color: hex(P.tramBallast), lambert: true, lensK: 0.6 }));
    tb.receiveShadow = true; group.add(tb);
  }

  // ---------- land use: parks, gardens, squares (world-anchored textures) ----------
  const grassTex = noiseTex(23, (g, n) => {
    const im = g.createImageData(512, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const v = 236 + (n(x / 30, y / 30) - 0.5) * 34 + (n(x / 5, y / 5) - 0.5) * 18;
      const i = (y * 512 + x) * 4; im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v * 0.97; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
  const gardenTex = noiseTex(29, (g, n) => {
    const im = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const v = 216 + (n(x / 22, y / 22) - 0.5) * 44;
      const i = (y * 256 + x) * 4; im.data[i] = v; im.data[i + 1] = v * 1.02; im.data[i + 2] = v * 0.9; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
  const stallStripeTex = canvasTex(64, 64, (g) => {
    g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = hex(P.accent[0]); for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 8, 64);
  }, true);
  const squareTex = canvasTex(256, 256, (g) => {
    g.fillStyle = hex([0.83, 0.017, 68]); g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(96,88,78,0.16)'; g.fillRect(0, 0, 256, 3); g.fillRect(0, 0, 3, 256);
    g.fillStyle = 'rgba(0,0,0,0.035)'; for (let i = 0; i < 256; i += 32) { g.fillRect(0, i, 256, 1); g.fillRect(i, 0, 1, 256); }
  }, true);
  const plots: Record<string, { geos: THREE.BufferGeometry[]; mat: THREE.Material }> = {
    park: { geos: [], mat: houseMat({ color: hex(P.lawn), map: grassTex, lambert: true, lensK: 0.6, side: THREE.DoubleSide }) },
    garden: { geos: [], mat: houseMat({ color: hex([P.lawn[0] + 0.03, P.lawn[1] * 0.85, P.lawn[2]]), map: gardenTex, lambert: true, lensK: 0.6, side: THREE.DoubleSide }) },
    square: { geos: [], mat: houseMat({ map: squareTex, lambert: true, side: THREE.DoubleSide }) },
  };
  for (const l of lay.landuse) {
    const holes = waterHoles.filter((w) => polyContains(l.poly, w));
    if (plots[l.kind]) plots[l.kind].geos.push(flat(l.poly, 0.014, holes, l.kind === 'square' ? 1 / 8 : 1 / 40));
  }
  for (const [k, { geos, mat }] of Object.entries(plots)) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.receiveShadow = true; mesh.name = 'plot-' + k;
    group.add(mesh);
    stats['plots_' + k] = geos.length;
  }

  // ---------- avenue centre dashes (no junction data in the ingest; unmarked gaps omitted) ----------
  const furniture = { metal: new Parts('lamp-pole'), head: new Parts('lamp-head'), bench: new Parts('bench'), bollard: new Parts('bollard'), mark: new Parts('markings'), stallCounter: new Parts('stall-counter'), stallAwning: new Parts('stall-awning'), stallPole: new Parts('stall-pole') };
  const markC = new THREE.Color(hex([0.92, 0.01, 85])).lerp(new THREE.Color(hex(P.road)), 0.15);
  for (const rd of lay.roads.filter((x) => x.cls === 'avenue')) {
    const acc = arclength(rd.pts); const total = acc[acc.length - 1];
    for (let s = 4; s < total - 4; s += 9) {
      const { p, yaw } = pointAtLength(rd.pts, acc, s);
      furniture.mark.add(mat(p[0], p[1], 0.028, yaw, 3, 0.14, 0.01), markC);
    }
  }
  stats.avenueDashes = furniture.mark.count;

  // ---------- lamps, parking bays, street-tree slots along roads ----------
  const parking: StreetsOut['parking'] = [];
  const streetTrees: V2[] = [];
  for (const rd of lay.roads) {
    if (rd.cls === 'cycle' || rd.cls === 'tramway' || rd.cls === 'pedestrian') continue;
    const acc = arclength(rd.pts); const total = acc[acc.length - 1];
    const step = rd.cls === 'avenue' ? 26 : 30;
    let k = 0;
    for (let s = 13; s < total; s += step, k++) {
      const { p, n } = pointAtLength(rd.pts, acc, s);
      if (rd.cls === 'avenue') {
        const side = k % 2 ? 1 : -1;
        const x = p[0] + n[0] * side * (rd.width / 2 + 0.9), y = p[1] + n[1] * side * (rd.width / 2 + 0.9);
        furniture.metal.add(mat(x, y, 0.008, 0, 0.14, 0.14, 6.2), col([0.30, 0.01, 250]));
        furniture.metal.add(mat(x - n[0] * side * 0.6, y - n[1] * side * 0.6, 5.9, Math.atan2(n[1], n[0]), 1.3, 0.08, 0.08), col([0.30, 0.01, 250]));
        furniture.head.add(mat(x - n[0] * side * 1.15, y - n[1] * side * 1.15, 5.65, Math.atan2(n[1], n[0]), 0.55, 0.3, 0.28), col([0.86, 0.03, 85]));
      } else {
        const side = 1;
        const x = p[0] + n[0] * side * (rd.width / 2 + 0.9), y = p[1] + n[1] * side * (rd.width / 2 + 0.9);
        furniture.metal.add(mat(x, y, 0.008, 0, 0.14, 0.14, 5.0), col([0.30, 0.01, 250]));
        furniture.head.add(mat(x, y, 4.8, 0, 0.45, 0.28, 0.24), col([0.86, 0.03, 85]));
      }
    }
    if (rd.cls === 'local') {
      for (let s = 6; s < total - 6; s += 7.5) {
        if (r() < 0.55) continue;
        const { p, n, yaw } = pointAtLength(rd.pts, acc, s);
        const side = r() < 0.5 ? 1 : -1;
        parking.push({ x: p[0] + n[0] * side * (rd.width / 2 - 1.15), y: p[1] + n[1] * side * (rd.width / 2 - 1.15), yaw });
      }
    } else if (rd.cls === 'avenue' && rd.width >= 9) {
      for (let s = 5; s < total - 5; s += 10) {
        for (const side of [-1, 1]) {
          const { p, n } = pointAtLength(rd.pts, acc, s);
          streetTrees.push([p[0] + n[0] * side * (rd.width / 2 + 1.3), p[1] + n[1] * side * (rd.width / 2 + 1.3)]);
        }
      }
    }
  }
  if (streetTrees.length > 900) streetTrees.splice(900);
  stats.lamps = furniture.head.count; stats.parkingSlots = parking.length; stats.streetTreeSlots = streetTrees.length;

  // the market square (largest place=square; Jette's Sint-Pietersplein): benches, bollards,
  // and a row of market stalls (decorative, labelled in the About panel)
  const sq = lay.landuse.filter((l) => l.kind === 'square').map((l) => l.poly).sort((a, b) => Math.abs(polyAreaSigned(b)) - Math.abs(polyAreaSigned(a)))[0];
  if (sq) {
    const xs = sq.map((p) => p[0]), ys = sq.map((p) => p[1]);
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    for (let x = x0 + 8; x < x1 - 6; x += 18) {
      furniture.bench.add(mat(x, (y0 + y1) / 2, 0.35, 0, 1.8, 0.5, 0.08), col([0.55, 0.05, 60]));
      furniture.bench.add(mat(x, (y0 + y1) / 2 + 0.22, 0.5, 0, 1.8, 0.06, 0.42), col([0.55, 0.05, 60]));
    }
    for (let x = x0 + 6; x < x1 - 5; x += 2.5) { furniture.bollard.add(mat(x, y0 + 2.2, 0.008, 0, 0.22, 0.22, 0.9), col([0.32, 0.01, 250])); furniture.bollard.add(mat(x, y1 - 2.2, 0.008, 0, 0.22, 0.22, 0.9), col([0.32, 0.01, 250])); }
    // market stalls: a loose double row on the east side, aligned to the square axis
    const inSq = (x: number, y: number) => inPoly([x, y], sq);
    const segD = (a: V2, b: V2, p: V2) => {
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const l2 = abx * abx + aby * aby;
      if (l2 < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
      let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
    };
    const distToRoad = (p: V2) => {
      let best = Infinity;
      for (const rd of lay.roads) {
        const pts = rd.pts;
        for (let k = 0; k < pts.length - 1; k++) { const d = segD(pts[k], pts[k + 1], p) - rd.width / 2; if (d < best) best = d; }
      }
      return best;
    };
    let stalls = 0;
    // candidates on a ring grid from the plaza's centre outward; keep the ones with clear space
    const rowY = (y0 + y1) / 2, rowX = (x0 + x1) / 2;
    const candidates: V2[] = [];
    for (let gy = y0 + 6; gy < y1 - 6; gy += 7) {
      for (let gx = x0 + 6; gx < x1 - 6; gx += 7) {
        if (inSq(gx, gy) && distToRoad([gx, gy]) >= 6.5) candidates.push([gx, gy]);
      }
    }
    // keep a loose cluster away from the central road junction: prefer the north/south arms
    candidates.sort((a, b) => (Math.abs(b[1] - rowY) - Math.abs(a[1] - rowY)) || (Math.abs(a[0] - rowX) - Math.abs(b[0] - rowX)));
    const placed: V2[] = [];
    for (const [x, y] of candidates) {
      if (stalls >= 8) break;
      if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 6)) continue;
      furniture.stallCounter.add(mat(x, y, 0.008, 0, 4.2, 2.4, 0.95), col(P.wood));
      furniture.stallCounter.add(mat(x, y, 0.95, 0, 4.2, 2.4, 0.06), col(P.paper));
      // striped awning: a shallow wedge, accent stripes
      furniture.stallAwning.add(mat(x, y, 2.6, Math.PI, 4.6, 3.0, 0.9), new THREE.Color(1, 1, 1));
      furniture.stallPole.add(mat(x - 2.0, y - 1.1, 0.008, 0, 0.12, 0.12, 2.5), col(P.dark));
      furniture.stallPole.add(mat(x + 2.0, y - 1.1, 0.008, 0, 0.12, 0.12, 2.5), col(P.dark));
      furniture.stallPole.add(mat(x - 2.0, y + 1.1, 0.008, 0, 0.12, 0.12, 2.5), col(P.dark));
      furniture.stallPole.add(mat(x + 2.0, y + 1.1, 0.008, 0, 0.12, 0.12, 2.5), col(P.dark));
      placed.push([x, y]);
      stalls++;
    }
    stats.stalls = stalls;
  }

  const box = unitBox();
  const plain = houseMat({});
  const markMesh = furniture.mark.build(box, houseMat({ lensK: 0.5 }), { receive: true });
  markMesh.renderOrder = 1;
  group.add(markMesh);
  const poles = furniture.metal.build(box, plain, { cast: true }); group.add(poles);
  const heads = furniture.head.build(box, plain, {}); group.add(heads);
  const bench = furniture.bench.build(box, plain, {}); group.add(bench);
  const boll = furniture.bollard.build(box, plain, {}); group.add(boll);
  const stallCounter = furniture.stallCounter.build(box, houseMat({}), { cast: true }); group.add(stallCounter);
  const stallAwn = furniture.stallAwning.build(unitWedge(), houseMat({ map: stallStripeTex, side: THREE.DoubleSide }), { cast: true }); group.add(stallAwn);
  const stallPole = furniture.stallPole.build(box, plain, {}); group.add(stallPole);
  void NO_INK;
  return { group, lod: { near: [bench, boll], mid: [poles, heads] }, parking, streetTrees, squares, stats };
}

function offsetPts(pts: V2[], off: number): V2[] {
  return pts.map((p, k) => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]) || 1;
    return [p[0] + (-d[1] / l) * off, p[1] + (d[0] / l) * off];
  });
}
function polyAreaSigned(p: V2[]) { return p.reduce((s, a, j) => { const b = p[(j + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2; }
function polyContains(outer: V2[], inner: V2[]) { return inPoly(centroidOf(inner), outer); }
function centroidOf(p: V2[]): V2 { return [p.reduce((s, x) => s + x[0], 0) / p.length, p.reduce((s, x) => s + x[1], 0) / p.length]; }
