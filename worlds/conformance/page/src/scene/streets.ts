// Step 3: roads, raised pavements with kerbs, plots and land use, the market square with its pond quay,
// markings, crossings and street furniture. recipes: streets-and-ground.md
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, hex } from './palette.ts';
import { Parts, houseMat, mat, rng, unitBox, canvasTex, valueNoise, col, NO_INK } from './util.ts';
import { xAt, yAt, inPoly, type Layout, type V2 } from './layout.ts';

export interface StreetsOut {
  group: THREE.Group;
  lod: { near: THREE.Object3D[]; mid: THREE.Object3D[] };
  parking: { x: number; y: number; yaw: number }[];
  streetTrees: V2[];
  benches: V2[];
  pond: V2[] | null;
  stats: Record<string, number>;
}

const KERB_H = 0.15;

function shapeOf(poly: V2[], holes: V2[][] = []) {
  const sh = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
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
  const t = canvasTex(size, size, (g) => draw(g, n), true);
  return t;
}

export function buildStreets(lay: Layout, seed: number): StreetsOut {
  const r = rng(seed);
  const group = new THREE.Group(); group.name = 'streets';
  const stats: Record<string, number> = {};
  const pondLu = lay.landuse.find((l) => l.kind === 'water');
  const pond = pondLu ? pondLu.poly : null;

  // ---------- roads: one merged ribbon geometry, world-anchored asphalt texture (wet) ----------
  const roadGeos: THREE.BufferGeometry[] = [];
  for (const rd of lay.roads) {
    const pts = rd.pts, hw = rd.width / 2 + 0.3;
    const pos: number[] = [], uv: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
      const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]) || 1;
      const nx = -d[1] / l, ny = d[0] / l;
      const ext = k === 0 ? -hw : k === pts.length - 1 ? hw : 0;
      const px = pts[k][0] + (d[0] / l) * ext, py = pts[k][1] + (d[1] / l) * ext;
      pos.push(px + nx * hw, py + ny * hw, 0.02, px - nx * hw, py - ny * hw, 0.02);
      uv.push((px + nx * hw) / 60, (py + ny * hw) / 60, (px - nx * hw) / 60, (py - ny * hw) / 60);
    }
    const idx: number[] = [];
    for (let k = 0; k < pts.length - 1; k++) { const i = k * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    // make winding face +z
    g.computeVertexNormals();
    if (g.getAttribute('normal').getZ(0) < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
    roadGeos.push(g);
  }
  const roadTex = noiseTex(11, (g, n) => {
    const im = g.createImageData(512, 512);
    const srgb = { r: 0, g: 0, b: 0 };
    const base = new THREE.Color(hex(P.road)), sky = new THREE.Color(hex([0.74, 0.04, 240])), patch = new THREE.Color(hex([0.37, 0.01, 250]));
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const v = n(x / 40, y / 40), v2 = n(x / 9 + 50, y / 9 + 50), v3 = n(x / 70 + 20, y / 70 + 9);
      const c = base.clone();
      c.multiplyScalar(0.97 + (v2 - 0.5) * 0.06);
      if (v > 0.74) c.lerp(patch, 0.7);                     // repaired asphalt
      if (v3 > 0.62) c.lerp(sky, Math.min(1, (v3 - 0.62) * 6) * 0.8);  // puddles holding the sky (after rain)
      const i = (y * 512 + x) * 4;
      c.getRGB(srgb, THREE.SRGBColorSpace);
      im.data[i] = srgb.r * 255; im.data[i + 1] = srgb.g * 255; im.data[i + 2] = srgb.b * 255; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
  roadTex.colorSpace = THREE.SRGBColorSpace;
  const roads = new THREE.Mesh(mergeGeometries(roadGeos), houseMat({ map: roadTex, lambert: true, lensK: 0.6 }));
  roads.receiveShadow = true; roads.name = 'roads';
  group.add(roads);
  stats.roads = lay.roads.length;

  // ---------- blocks: raised kerb slab, pavement, plot ----------
  const slabGeos: THREE.BufferGeometry[] = [], walkGeos: THREE.BufferGeometry[] = [];
  const plotGeos: Record<string, THREE.BufferGeometry[]> = { paving: [], lawn: [], concrete: [], park: [], square: [] };
  for (const b of lay.blocks) {
    const holes = pond && b.use === 'square' ? [pond] : [];
    const slab = new THREE.ExtrudeGeometry(shapeOf(b.kerb, holes), { depth: KERB_H, bevelEnabled: false, steps: 1 });
    slabGeos.push(slab.toNonIndexed());
    walkGeos.push(flat(b.walk, KERB_H + 0.003, holes, 1));
    const kind = b.use === 'villa' || b.use === 'terrace' ? 'lawn' : b.use === 'shed' ? 'concrete' : b.use === 'park' || b.use === 'garden' ? 'park' : b.use === 'square' ? 'square' : 'paving';
    plotGeos[kind].push(flat(b.plot, KERB_H + 0.006, holes, kind === 'square' ? 1 / 6 : 1 / 40));
  }
  const kerbMat = houseMat({ color: hex(P.kerb) });
  const slabs = new THREE.Mesh(mergeGeometries(slabGeos.map((g) => { g.deleteAttribute('uv'); return g; })), kerbMat);
  slabs.receiveShadow = true; slabs.castShadow = false;
  group.add(slabs);
  const pavingTex = canvasTex(64, 64, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 0, 2, 64);
  }, true);
  const walk = new THREE.Mesh(mergeGeometries(walkGeos), houseMat({ color: hex(P.sidewalk), map: pavingTex, lambert: true }));
  walk.receiveShadow = true; group.add(walk);
  const grassTex = noiseTex(23, (g, n) => {
    const im = g.createImageData(512, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const v = 236 + (n(x / 30, y / 30) - 0.5) * 34 + (n(x / 5, y / 5) - 0.5) * 18;
      const i = (y * 512 + x) * 4; im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v * 0.98; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
  const stoneTex = noiseTex(31, (g, n) => {
    const im = g.createImageData(512, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const v = 244 + (n(x / 50, y / 50) - 0.5) * 18;
      const i = (y * 512 + x) * 4; im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
  const squareTex = canvasTex(128, 128, (g) => {
    g.fillStyle = hex([0.87, 0.016, 70]); g.fillRect(0, 0, 128, 128);
    g.fillStyle = hex([0.80, 0.02, 60]); g.fillRect(0, 0, 128, 6); g.fillRect(0, 0, 6, 128);    // granite bands every 6 m
    g.fillStyle = 'rgba(0,0,0,0.05)'; for (let i = 0; i < 128; i += 16) { g.fillRect(0, i, 128, 1); g.fillRect(i, 0, 1, 128); }
  }, true);
  const plotMats: Record<string, THREE.Material> = {
    paving: houseMat({ color: hex(P.ground), map: stoneTex, lambert: true }),
    lawn: houseMat({ color: hex([P.lawn[0] + 0.02, P.lawn[1] * 0.8, P.lawn[2]]), map: grassTex, lambert: true, lensK: 0.6 }),
    concrete: houseMat({ color: hex(P.concrete), map: stoneTex, lambert: true }),
    park: houseMat({ color: hex(P.lawn), map: grassTex, lambert: true, lensK: 0.6 }),
    square: houseMat({ map: squareTex, lambert: true }),
  };
  for (const [k, gs] of Object.entries(plotGeos)) {
    if (!gs.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(gs), plotMats[k]);
    mesh.receiveShadow = true; mesh.name = 'plot-' + k;
    group.add(mesh);
    stats['plots_' + k] = gs.length;
  }

  // ---------- park paths: a curved 2.5 m path through each park ----------
  const pathGeos: THREE.BufferGeometry[] = [];
  for (const b of lay.blocks.filter((bb) => bb.use === 'park' || bb.use === 'garden')) {
    const [x0, y0, x1, y1] = b.rect;
    const pts: V2[] = [];
    for (let k = 0; k <= 16; k++) { const t = k / 16; pts.push([x0 + 4 + (x1 - x0 - 8) * t, (y0 + y1) / 2 + Math.sin(t * Math.PI * 1.5 + b.i) * (y1 - y0) * 0.22]); }
    const pos: number[] = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], c = pts[k + 1]; const d = [c[0] - a[0], c[1] - a[1]]; const l = Math.hypot(d[0], d[1]); const nx = -d[1] / l * 1.25, ny = d[0] / l * 1.25;
      const z = KERB_H + 0.012;
      pos.push(a[0] + nx, a[1] + ny, z, a[0] - nx, a[1] - ny, z, c[0] + nx, c[1] + ny, z, a[0] - nx, a[1] - ny, z, c[0] - nx, c[1] - ny, z, c[0] + nx, c[1] + ny, z);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    if (g.getAttribute('normal').getZ(0) < 0) { g.scale(1, 1, 1); }
    pathGeos.push(g);
  }
  if (pathGeos.length) {
    const pm = new THREE.Mesh(mergeGeometries(pathGeos), houseMat({ color: hex([0.80, 0.03, 70]), lambert: true, side: THREE.DoubleSide }));
    pm.receiveShadow = true; group.add(pm);
  }

  // ---------- the pond quay (nature-and-water §3: urban bank) ----------
  const furniture = { metal: new Parts('lamp-pole'), head: new Parts('lamp-head'), bench: new Parts('bench'), bollard: new Parts('bollard'), mark: new Parts('markings'), stone: new Parts('stone') };
  if (pond) {
    const xs = pond.map((p) => p[0]), ys = pond.map((p) => p[1]);
    const [px0, py0, px1, py1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const stoneC = col([0.80, 0.015, 75]);
    const t = 0.6, z0 = -0.9, hh = KERB_H + 0.25 - z0;
    furniture.stone.add(mat((px0 + px1) / 2, py0 - t / 2, z0, 0, px1 - px0 + 2 * t, t, hh), stoneC);
    furniture.stone.add(mat((px0 + px1) / 2, py1 + t / 2, z0, 0, px1 - px0 + 2 * t, t, hh), stoneC);
    furniture.stone.add(mat(px0 - t / 2, (py0 + py1) / 2, z0, 0, t, py1 - py0, hh), stoneC);
    furniture.stone.add(mat(px1 + t / 2, (py0 + py1) / 2, z0, 0, t, py1 - py0, hh), stoneC);
  }

  // ---------- markings (avenue centre dashes, zebra crossings at avenue junctions, stop lines) ----------
  const markC = new THREE.Color(hex([0.92, 0.01, 85])).lerp(new THREE.Color(hex(P.road)), 0.15);
  const isAve = (i: number, j: number) => lay.vroads[i].cls === 'avenue' && lay.hroads[j].cls === 'avenue';
  for (const rd of lay.roads.filter((x) => x.cls === 'avenue')) {
    const len = rd.vertical ? rd.pts[rd.pts.length - 1][1] - rd.pts[0][1] : rd.pts[rd.pts.length - 1][0] - rd.pts[0][0];
    for (let s = 0; s < len; s += 9) {
      const v = (rd.vertical ? rd.pts[0][1] : rd.pts[0][0]) + s + 2;
      // skip dashes inside junctions
      const cross = rd.vertical ? lay.hroads.some((h) => Math.abs(h.mean - v) < h.width / 2 + 5) : lay.vroads.some((vv) => Math.abs(vv.mean - v) < vv.width / 2 + 5);
      if (cross) continue;
      const x = rd.vertical ? xAt(rd, v) : v, y = rd.vertical ? v : yAt(rd, v);
      furniture.mark.add(mat(x, y, 0.025, rd.vertical ? Math.PI / 2 : 0, 3, 0.14, 0.01), markC);
    }
  }
  let zebras = 0;
  lay.nodes.forEach((col_, i) => col_.forEach(([nx, ny], j) => {
    const v = lay.vroads[i], h = lay.hroads[j];
    if (isAve(i, j)) {
      // four arms
      for (const [dx, dy, wRoad, wCross] of [[1, 0, h.width, v.width], [-1, 0, h.width, v.width], [0, 1, v.width, h.width], [0, -1, v.width, h.width]] as const) {
        const off = wCross / 2 + 3.2;
        const cx = nx + dx * off, cy = ny + dy * off;
        const along = dx !== 0 ? [0, 1] : [1, 0];
        for (let s = -wRoad / 2 + 0.6; s < wRoad / 2 - 0.3; s += 1.0) {
          furniture.mark.add(mat(cx + along[0] * s, cy + along[1] * s, 0.025, dx !== 0 ? 0 : Math.PI / 2, 3.2, 0.5, 0.01), markC);
        }
        zebras++;
      }
    } else if (v.cls !== h.cls) {
      // stop line on the local arms
      const loc = v.cls === 'local' ? v : h;
      const ave = loc === v ? h : v;
      for (const sgn of [-1, 1]) {
        const off = ave.width / 2 + 0.6;
        const cx = loc === v ? nx : nx + sgn * off, cy = loc === v ? ny + sgn * off : ny;
        const sideOff = loc.width / 4;
        const ox = loc === v ? (sgn > 0 ? -sideOff : sideOff) : 0, oy = loc === v ? 0 : (sgn > 0 ? sideOff : -sideOff);
        furniture.mark.add(mat(cx + ox, cy + oy, 0.025, loc === v ? 0 : Math.PI / 2, loc.width / 2 - 0.3, 0.3, 0.01), markC);
      }
    }
  }));
  stats.zebraArms = zebras;

  // ---------- lamps, parking bays, street-tree slots ----------
  const parking: StreetsOut['parking'] = [];
  const streetTrees: V2[] = [];
  const nearJunction = (rd: (typeof lay.roads)[number], v: number, gap: number) =>
    rd.vertical ? lay.hroads.some((h) => Math.abs(h.mean - v) < h.width / 2 + gap) : lay.vroads.some((vv) => Math.abs(vv.mean - v) < vv.width / 2 + gap);
  for (const rd of lay.roads) {
    const start = rd.vertical ? rd.pts[0][1] : rd.pts[0][0], end = rd.vertical ? rd.pts[rd.pts.length - 1][1] : rd.pts[rd.pts.length - 1][0];
    const at = (v: number, side: number, off: number): V2 => rd.vertical ? [xAt(rd, v) + side * off, v] : [v, yAt(rd, v) + side * off];
    // lamps every 28 m, alternating sides on avenues, one side on locals
    let k = 0;
    for (let v = start + 14; v < end; v += 28, k++) {
      if (nearJunction(rd, v, 4)) continue;
      const side = rd.cls === 'avenue' ? (k % 2 ? 1 : -1) : 1;
      const [x, y] = at(v, side, rd.width / 2 + 0.6);
      if (lay.blocks.every((b) => !inPoly([x, y], b.kerb))) continue;
      furniture.metal.add(mat(x, y, KERB_H, 0, 0.14, 0.14, 6.2), col([0.30, 0.01, 250]));
      const ax = rd.vertical ? -side : 0, ay = rd.vertical ? 0 : -side;
      furniture.metal.add(mat(x + ax * 0.6, y + ay * 0.6, KERB_H + 6.1, rd.vertical ? 0 : Math.PI / 2, 1.3, 0.08, 0.08), col([0.30, 0.01, 250]));
      furniture.head.add(mat(x + ax * 1.15, y + ay * 1.15, KERB_H + 5.85, rd.vertical ? 0 : Math.PI / 2, 0.55, 0.3, 0.28), col([0.86, 0.03, 85]));
    }
    // parking bays along locals, kerbside (right-hand traffic: both sides, 5.5 m bays)
    if (rd.cls === 'local') {
      for (let v = start + 8; v < end - 8; v += 5.6) {
        if (nearJunction(rd, v, 9)) continue;
        for (const side of [-1, 1]) {
          if (r() < 0.45) continue;
          const [x, y] = at(v, side, rd.width / 2 - 1.05);
          parking.push({ x, y, yaw: rd.vertical ? Math.PI / 2 : 0 });
        }
      }
    } else {
      for (let v = start + 6; v < end - 6; v += 10) {
        if (nearJunction(rd, v, 7)) continue;
        for (const side of [-1, 1]) {
          const p = at(v, side, rd.width / 2 + 1.1);
          if (lay.blocks.some((b) => inPoly(p, b.kerb) && b.use !== 'park')) streetTrees.push(p);
        }
      }
    }
  }
  // benches + bollards on the square, benches in parks
  const benches: V2[] = [];
  const sq = lay.blocks.find((b) => b.use === 'square');
  if (sq && pond) {
    const xs = pond.map((p) => p[0]), ys = pond.map((p) => p[1]);
    const [px0, py0, px1, py1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    for (let x = px0 + 3; x < px1 - 2; x += 6) { benches.push([x, py0 - 2.2], [x, py1 + 2.2]); }
    const [x0, y0, x1, y1] = sq.rect;
    for (let x = x0 + 6; x < x1 - 5; x += 2.5) { furniture.bollard.add(mat(x, y0 + 2.9, KERB_H, 0, 0.22, 0.22, 0.9), col([0.32, 0.01, 250])); furniture.bollard.add(mat(x, y1 - 2.9, KERB_H, 0, 0.22, 0.22, 0.9), col([0.32, 0.01, 250])); }
  }
  for (const b of lay.blocks.filter((bb) => bb.use === 'park')) {
    const [x0, y0, x1, y1] = b.rect;
    benches.push([(x0 + x1) / 2 - 6, (y0 + y1) / 2 + 3], [(x0 + x1) / 2 + 6, (y0 + y1) / 2 - 3]);
  }
  for (const [x, y] of benches) {
    furniture.bench.add(mat(x, y, KERB_H + 0.42, 0, 1.8, 0.5, 0.08), col([0.55, 0.05, 60]));
    furniture.bench.add(mat(x, y + 0.22, KERB_H + 0.5, 0, 1.8, 0.06, 0.42), col([0.55, 0.05, 60]));
    furniture.bench.add(mat(x - 0.75, y, KERB_H, 0, 0.08, 0.45, 0.42), col([0.30, 0.01, 250]));
    furniture.bench.add(mat(x + 0.75, y, KERB_H, 0, 0.08, 0.45, 0.42), col([0.30, 0.01, 250]));
  }

  const box = unitBox();
  const plain = houseMat({});
  const markMesh = furniture.mark.build(box, houseMat({ lensK: 0.5 }), { receive: true });
  markMesh.renderOrder = 1;
  group.add(markMesh);
  const stone = furniture.stone.build(box, plain, { cast: true }); group.add(stone);
  const poles = furniture.metal.build(box, plain, { cast: true }); group.add(poles);
  const heads = furniture.head.build(box, plain, {}); group.add(heads);
  const bench = furniture.bench.build(box, plain, {}); group.add(bench);
  const boll = furniture.bollard.build(box, plain, {}); group.add(boll);
  stats.lamps = furniture.head.count; stats.parkingSlots = parking.length; stats.streetTreeSlots = streetTrees.length; stats.benches = benches.length;
  void NO_INK;
  return { group, lod: { near: [bench, boll], mid: [poles, heads] }, parking, streetTrees, benches, pond, stats };
}
