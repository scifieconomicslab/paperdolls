// Step 3: roads, raised pavements with kerbs, markings, tram rails, land use, plots and street furniture.
// Jette has a real, irregular street network: every road is drawn as its own ribbon, with
// per-road pavements; no block slab is assumed. recipes: streets-and-ground.md
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, hex } from './palette.ts';
import { Parts, houseMat, mat, rng, unitBox, canvasTex, valueNoise, col } from './util.ts';
import { inPoly, type Layout, type V2 } from './layout.ts';

export interface StreetsOut {
  group: THREE.Group;
  lod: { near: THREE.Object3D[]; mid: THREE.Object3D[] };
  parking: { x: number; y: number; yaw: number }[];
  streetTrees: V2[];
  water: THREE.Mesh | null;
  waterPolys: V2[][];
  stats: Record<string, number>;
}

const KERB_H = 0.15;

function signedArea(poly: V2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
const orient = (poly: V2[], ccw: boolean) => (ccw ? signedArea(poly) < 0 : signedArea(poly) > 0) ? poly.slice().reverse() : poly;
function shapeOf(poly: V2[], holes: V2[][] = []) {
  const sh = new THREE.Shape(orient(poly, true).map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) sh.holes.push(new THREE.Path(orient(h, false).map(([x, y]) => new THREE.Vector2(x, y))));
  return sh;
}
function flat(poly: V2[], z: number, holes: V2[][] = [], uvScale = 1 / 40) {
  const g = new THREE.ShapeGeometry(shapeOf(poly, holes));
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) { uv.setXY(i, pos.getX(i) * uvScale, pos.getY(i) * uvScale); pos.setZ(i, z); }
  g.computeVertexNormals();
  return g;
}
function noiseTex(seed: number, draw: (g: CanvasRenderingContext2D, n: (x: number, y: number) => number) => void, size = 256) {
  const n = valueNoise(seed);
  return canvasTex(size, size, (g) => draw(g, n), true);
}

/** A flat ribbon along a polyline, from `inner` to `outer` metres from the centreline. */
function ribbon(pts: V2[], inner: number, outer: number, z: number, uvScale = 1 / 30): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
    const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]) || 1;
    const nx = -d[1] / l, ny = d[0] / l;
    const p = pts[k];
    pos.push(p[0] + nx * inner, p[1] + ny * inner, z, p[0] + nx * outer, p[1] + ny * outer, z);
    uv.push((p[0] + nx * inner) * uvScale, (p[1] + ny * inner) * uvScale, (p[0] + nx * outer) * uvScale, (p[1] + ny * outer) * uvScale);
  }
  for (let k = 0; k < pts.length - 1; k++) { const i = k * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (g.getAttribute('normal').getZ(0) < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

export function buildStreets(lay: Layout, seed: number): StreetsOut {
  const r = rng(seed);
  const group = new THREE.Group(); group.name = 'streets';
  const stats: Record<string, number> = {};
  const parking: StreetsOut['parking'] = [];
  const streetTrees: V2[] = [];

  // ---------- roads: merged ribbons, per class ----------
  const roadGeos: THREE.BufferGeometry[] = [];
  const tramGeos: THREE.BufferGeometry[] = [];
  for (const rd of lay.roads) {
    if (rd.pts.length < 2) continue;
    roadGeos.push(ribbon(rd.pts, -rd.width / 2, rd.width / 2, 0.05, 1 / 35));
    if (rd.tram) {
      for (const off of [-0.72, 0.72]) tramGeos.push(ribbon(rd.pts, off - 0.05, off + 0.05, 0.065, 1));
    }
  }
  const roadTex = noiseTex(11, (g, n) => {
    const im = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const v = 236 + (n(x / 18, y / 18) - 0.5) * 26 + (n(x / 5 + 7, y / 5) - 0.5) * 10;
      const i = (y * 256 + x) * 4; im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v * 1.01; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
  if (roadGeos.length) {
    const roads = new THREE.Mesh(mergeGeometries(roadGeos), houseMat({ color: hex(P.road), map: roadTex, lambert: true, lensK: 0.6 }));
    roads.receiveShadow = true; roads.name = 'roads';
    group.add(roads);
  }
  if (tramGeos.length) {
    const rails = new THREE.Mesh(mergeGeometries(tramGeos), houseMat({ color: hex([0.62, 0.008, 250]), lambert: true }));
    rails.receiveShadow = true; group.add(rails);
  }
  stats.roads = lay.roads.length;

  // ---------- pavements: a raised slab on each side, with a kerb line ----------
  const walkParts = new Parts('pavement');
  const kerbParts = new Parts('kerb');
  for (const rd of lay.roads) {
    if (rd.sidewalk <= 0) continue;
    for (let k = 0; k < rd.pts.length - 1; k++) {
      const a = rd.pts[k], b = rd.pts[k + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 0.3) continue;
      const nx = -dy / len, ny = dx / len;
      const yaw = Math.atan2(dy, dx);
      for (const side of [-1, 1]) {
        const off = side * (rd.width / 2 + rd.sidewalk / 2);
        const cx = (a[0] + b[0]) / 2 + nx * off, cy = (a[1] + b[1]) / 2 + ny * off;
        walkParts.add(mat(cx, cy, 0, yaw, len + 0.25, rd.sidewalk, KERB_H), col(P.sidewalk));
        const kx = (a[0] + b[0]) / 2 + nx * side * (rd.width / 2 + 0.11), ky = (a[1] + b[1]) / 2 + ny * side * (rd.width / 2 + 0.11);
        kerbParts.add(mat(kx, ky, 0, yaw, len + 0.25, 0.22, KERB_H + 0.02), col(P.kerb));
      }
    }
  }
  const walk = walkParts.build(unitBox(), houseMat({ lambert: true }).clone(), { receive: true });
  // pavement paving texture at street zoom: a 1 m grid of hairlines
  const paveTex = canvasTex(32, 32, (g) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, 32, 32); g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 0, 32, 1); g.fillRect(0, 0, 1, 32); }, true);
  (walk.material as THREE.Material).dispose();
  walk.material = houseMat({ color: hex(P.sidewalk), map: paveTex, lambert: true });
  group.add(walk);
  const kerb = kerbParts.build(unitBox(), houseMat({}), { receive: true });
  group.add(kerb);
  stats.pavements = walkParts.count;

  // ---------- markings: avenue centre dashes ----------
  const mark = new Parts('markings');
  const markC = new THREE.Color(hex([0.92, 0.01, 85])).lerp(new THREE.Color(hex(P.road)), 0.2);
  for (const rd of lay.roads) {
    if (rd.cls !== 'avenue') continue;
    let acc = 4;
    for (let k = 0; k < rd.pts.length - 1; k++) {
      const a = rd.pts[k], b = rd.pts[k + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 0.1) continue;
      const ux = dx / len, uy = dy / len;
      const yaw = Math.atan2(dy, dx);
      while (acc < len) {
        const x = a[0] + ux * acc, y = a[1] + uy * acc;
        mark.add(mat(x, y, 0.07, yaw, 3.0, 0.13, 0.012), markC);
        acc += 9;
      }
      acc -= len;
    }
  }
  // zebra crossings at junctions of >= 3 roads (capped; the real network has many)
  const nodes = new Map<string, { x: number; y: number; roads: number[] }>();
  lay.roads.forEach((rd, i) => {
    for (const p of [rd.pts[0], rd.pts[rd.pts.length - 1]]) {
      const key = Math.round(p[0]) + ':' + Math.round(p[1]);
      const e = nodes.get(key) ?? { x: p[0], y: p[1], roads: [] }; e.roads.push(i); nodes.set(key, e);
    }
  });
  let zebras = 0;
  for (const e of nodes.values()) {
    if (e.roads.length < 3 || zebras > 320) continue;
    const ave = e.roads.find((i) => lay.roads[i].cls === 'avenue');
    if (ave === undefined) continue;
    const rd = lay.roads[ave];
    const yaw = Math.atan2(rd.pts[rd.pts.length - 1][1] - rd.pts[0][1], rd.pts[rd.pts.length - 1][0] - rd.pts[0][0]);
    for (let s = -rd.width / 2 + 0.7; s < rd.width / 2 - 0.3; s += 1.0) {
      const nx = -Math.sin(yaw), ny = Math.cos(yaw);
      mark.add(mat(e.x + nx * s, e.y + ny * s, 0.075, yaw, 3.0, 0.5, 0.012), markC);
    }
    zebras++;
  }
  const marks = mark.build(unitBox(), houseMat({ lensK: 0.5 }), { receive: true });
  marks.renderOrder = 1; group.add(marks);
  stats.zebras = zebras;

  // ---------- parking bays and street trees along the roads ----------
  for (const rd of lay.roads) {
    if (rd.pts.length < 2) continue;
    for (let k = 0; k < rd.pts.length - 1; k++) {
      const a = rd.pts[k], b = rd.pts[k + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const nx = -dy / len, ny = dx / len, yaw = Math.atan2(dy, dx);
      const step = rd.cls === 'local' ? 6.0 : 18.0;
      for (let d = 5; d < len - 5; d += step) {
        const x = a[0] + (dx / len) * d, y = a[1] + (dy / len) * d;
        if (rd.cls === 'local') {
          for (const side of [-1, 1]) {
            if (r() < 0.5) continue;
            parking.push({ x: x + nx * side * (rd.width / 2 - 1.05), y: y + ny * side * (rd.width / 2 - 1.05), yaw });
          }
        } else if (rd.cls === 'avenue' && rd.sidewalk > 0) {
          for (const side of [-1, 1]) {
            const px = x + nx * side * (rd.width / 2 + rd.sidewalk + 1.0), py = y + ny * side * (rd.width / 2 + rd.sidewalk + 1.0);
            if (!lay.structs.some((s) => Math.hypot(s.c[0] - px, s.c[1] - py) < Math.max(s.L, s.W) / 2 + 1.5)) streetTrees.push([px, py]);
          }
        }
      }
    }
  }
  stats.parkingSlots = parking.length;

  // ---------- street lamps along avenues ----------
  const lamps = new Parts('lamp-pole'), heads = new Parts('lamp-head');
  for (const rd of lay.roads) {
    if (rd.cls !== 'avenue') continue;
    let acc = 14;
    for (let k = 0; k < rd.pts.length - 1; k++) {
      const a = rd.pts[k], b = rd.pts[k + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 0.1) continue;
      const nx = -dy / len, ny = dx / len;
      while (acc < len) {
        const x = a[0] + (dx / len) * acc + nx * (rd.width / 2 + rd.sidewalk - 0.4);
        const y = a[1] + (dy / len) * acc + ny * (rd.width / 2 + rd.sidewalk - 0.4);
        lamps.add(mat(x, y, KERB_H, 0, 0.13, 0.13, 6.0), col([0.30, 0.01, 250]));
        heads.add(mat(x - nx * 0.7, y - ny * 0.7, KERB_H + 5.8, 0, 0.55, 0.3, 0.26), col([0.86, 0.03, 85]));
        acc += 28;
      }
      acc -= len;
    }
  }
  group.add(lamps.build(unitBox(), houseMat({}), { cast: true }));
  group.add(heads.build(unitBox(), houseMat({}), {}));
  stats.lamps = heads.count;

  // ---------- land use fills and plots ----------
  const lawnTex = noiseTex(23, (g, n) => {
    const im = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const v = 238 + (n(x / 26, y / 26) - 0.5) * 30 + (n(x / 5, y / 5) - 0.5) * 12;
      const i = (y * 256 + x) * 4; im.data[i] = v * 0.97; im.data[i + 1] = v; im.data[i + 2] = v * 0.93; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
  const parkGeos: THREE.BufferGeometry[] = [], gardenGeos: THREE.BufferGeometry[] = [];
  const waterPolys: V2[][] = [];
  for (const lu of lay.landuse) {
    if (lu.poly.length < 3) continue;
    if (lu.kind === 'park') parkGeos.push(flat(lu.poly, 0.03, [], 1 / 26));
    else if (lu.kind === 'garden') gardenGeos.push(flat(lu.poly, 0.032, [], 1 / 26));
    else if (lu.kind === 'water') waterPolys.push(lu.poly);
  }
  if (parkGeos.length) {
    const park = new THREE.Mesh(mergeGeometries(parkGeos), houseMat({ color: hex(P.lawn), map: lawnTex, lambert: true, lensK: 0.6 }));
    park.receiveShadow = true; group.add(park);
    stats.parkTris = park.geometry.getAttribute('position').count / 3;
  }
  if (gardenGeos.length) {
    const garden = new THREE.Mesh(mergeGeometries(gardenGeos), houseMat({ color: hex([P.lawn[0] + 0.02, P.lawn[1] * 0.85, P.lawn[2]]), map: lawnTex, lambert: true, lensK: 0.6 }));
    garden.receiveShadow = true; group.add(garden);
  }
  stats.parkPolys = parkGeos.length; stats.gardenPolys = gardenGeos.length; stats.waterPolys = waterPolys.length;

  // water: one flat surface per polygon, depth cannot be computed without a raster; a ripple shader
  let water: THREE.Mesh | null = null;
  if (waterPolys.length) {
    const waterMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDeep: { value: new THREE.Color(hex(P.water)) }, uShallow: { value: new THREE.Color(hex([P.water[0] + 0.08, P.water[1] - 0.02, P.water[2]])) } },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime; uniform vec3 uDeep, uShallow; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          float rip = vn(vW.xy * vec2(0.35, 1.6) + vec2(uTime * 0.22, 0.0)) * vn(vW.xy * vec2(0.9, 0.3) - vec2(0.0, uTime * 0.16));
          vec3 c = mix(uDeep, uShallow, 0.35 + 0.25 * vn(vW.xy * 0.05));
          c += smoothstep(0.55, 0.75, rip) * 0.08;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    // one merged geometry; a single mesh keeps the draw count down
    const geos = waterPolys.map((p) => flat(p, -0.22, [], 1));
    water = new THREE.Mesh(mergeGeometries(geos), waterMat);
    water.name = 'water'; water.receiveShadow = false;
    group.add(water);
    stats.waterTris = water.geometry.getAttribute('position').count / 3;
  }

  // plot surfaces under the buildings: lawn for houses, paving for flats/commerce, concrete for sheds
  const plotParts: Record<string, Parts> = { lawn: new Parts('plot-lawn'), paving: new Parts('plot-paving'), concrete: new Parts('plot-concrete') };
  for (const s of lay.structs) {
    const kind = ['house', 'detached', 'terrace', 'villa', 'bungalow'].includes(s.cls) ? 'lawn'
      : ['outbuilding', 'garage', 'shed', 'warehouse', 'industrial', 'manufacture'].includes(s.cls) ? 'concrete' : 'paving';
    plotParts[kind].add(mat(s.c[0], s.c[1], 0.04, s.yaw, s.L + 2.4, s.W + 2.4, 0.01), new THREE.Color(1, 1, 1));
  }
  const plotMats: Record<string, THREE.Material> = {
    lawn: houseMat({ color: hex([P.lawn[0] + 0.02, P.lawn[1] * 0.75, P.lawn[2]]), map: lawnTex, lambert: true }),
    paving: houseMat({ color: hex(P.paving), lambert: true }),
    concrete: houseMat({ color: hex(P.concrete), lambert: true }),
  };
  for (const [k, p] of Object.entries(plotParts)) {
    if (!p.count) continue;
    const mesh = p.build(unitBox(), plotMats[k], { receive: true });
    stats['plotTris_' + k] = (mesh.geometry.getAttribute('position').count / 3) * p.count;
    group.add(mesh);
  }

  return {
    group,
    lod: { near: [kerb, marks], mid: [] },
    parking, streetTrees, water, waterPolys, stats,
  };
}
