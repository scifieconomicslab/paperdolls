// Step 5: trees (data trees first, then decorative street and park trees), hedges, and water.
// recipes: nature-and-water.md
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, hex } from './palette.ts';
import { Parts, houseMat, mat, rng, valueNoise, U, NO_INK, unitBox, col } from './util.ts';
import { inPoly, type Layout, type V2 } from './layout.ts';

export interface NatureOut { group: THREE.Group; water: THREE.Mesh[]; stats: Record<string, number> }

/** Round deciduous canopy: jittered icosahedra, vertex-coloured darker underneath (nature-and-water §1). */
function canopyGeo(seed: number, kind: 'round' | 'columnar' | 'conifer') {
  const r = rng(seed), n = valueNoise(seed + 5);
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'round') {
    for (const [rad, ox, oy, oz] of [[1.45, 0, 0, 0], [1.1, 0.6, 0.35, -0.35], [0.95, -0.55, -0.4, -0.2], [0.9, 0.1, -0.5, 0.55]] as const) {
      const g = new THREE.IcosahedronGeometry(rad, 1); g.translate(ox, oy, oz); parts.push(g);
    }
  } else if (kind === 'columnar') {
    const g = new THREE.IcosahedronGeometry(1, 1); g.scale(0.85, 0.85, 2.4); parts.push(g);
  } else {
    for (let k = 0; k < 3; k++) { const g = new THREE.ConeGeometry(1.5 - k * 0.4, 1.8, 7); g.rotateX(Math.PI / 2); g.translate(0, 0, k * 1.1 - 1.2); parts.push(g); }
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed().deleteAttribute('uv') as unknown as THREE.BufferGeometry).map((p) => { p.deleteAttribute('uv'); return p; }));
  const pos = g.getAttribute('position');
  const colors: number[] = [];
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < pos.count; i++) { zmin = Math.min(zmin, pos.getZ(i)); zmax = Math.max(zmax, pos.getZ(i)); }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const j = 1 + (n(x * 1.7 + 3, y * 1.7 + z) - 0.5) * 0.18;  // ±8 % jitter
    pos.setXYZ(i, x * j, y * j, z * (1 + (j - 1) * 0.6));
    const t = (z - zmin) / (zmax - zmin || 1);
    const v = 0.80 + 0.28 * t;                                   // lower half darker (self-shadow)
    colors.push(v, v, v);
  }
  void r;
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

export function buildNature(lay: Layout, streetTrees: V2[], seed: number): NatureOut {
  const r = rng(seed);
  const group = new THREE.Group(); group.name = 'nature';
  const kinds = { round: new Parts('tree-round'), columnar: new Parts('tree-columnar'), conifer: new Parts('tree-conifer') };
  const trunks = new Parts('trunk');
  const hedges = new Parts('hedge');
  const placed: V2[] = [];
  const stats: Record<string, number> = { dataTrees: 0, streetTrees: 0, parkTrees: 0, gardenTrees: 0, hedges: 0, waterBodies: 0 };
  const veg = P.veg;
  const onBuilding = (p: V2, pad: number) => lay.structs.some((s) => {
    const dx = p[0] - s.c[0], dy = p[1] - s.c[1];
    return Math.abs(dx * s.ax[0] + dy * s.ax[1]) < s.L / 2 + pad && Math.abs(dx * s.ay[0] + dy * s.ay[1]) < s.W / 2 + pad;
  });
  const free = (p: V2, d: number) => placed.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= d);
  const waters = lay.landuse.filter((l) => l.kind === 'water').map((l) => l.poly);
  const inPond = (p: V2) => waters.some((w) => inPoly(p, w));

  function tree(p: V2, kind: 'round' | 'columnar' | 'conifer', h: number, tone: number) {
    const z = 0.02;
    const yaw = r() * Math.PI * 2;
    const s = h / 8;
    const c = new THREE.Color(hex([veg[tone][0] + (r() - 0.5) * 0.04, veg[tone][1], veg[tone][2] + (r() - 0.5) * 6]));
    const crownZ = kind === 'columnar' ? h * 0.55 : kind === 'conifer' ? h * 0.5 : h * 0.62;
    const cs = kind === 'round' ? s * 1.75 : kind === 'columnar' ? s * 1.6 : s * 1.9;
    kinds[kind].add(mat(p[0], p[1], z + crownZ, yaw, cs, cs, cs), c);
    trunks.add(mat(p[0], p[1], z, 0, 0.36 * s + 0.1, 0.36 * s + 0.1, crownZ), col([0.38, 0.03, 55]));
    placed.push(p);
  }

  // 1. trees from scene.json (data; placed first)
  for (const [x, y, kind, sc] of lay.trees) {
    if (onBuilding([x, y], 0.5) || inPond([x, y])) continue;
    const k = kind === 'columnar' ? 'columnar' : kind === 'conifer' ? 'conifer' : kind === 'blossom' || kind === 'plane' || kind === 'oak' ? 'round' : 'round';
    tree([x, y], k, 7.5 * (sc || 1), Math.floor(r() * 3));
    stats.dataTrees++;
  }
  // 2. street trees (decorative, labelled): lime rows on avenues
  for (const p of streetTrees) {
    if (!free(p, 6) || onBuilding(p, 0.8)) continue;
    tree(p, 'round', 8 + r() * 1.5, r() < 0.3 ? 2 : 1);
    stats.streetTrees++;
  }
  // 3. parks and gardens: sample inside the landuse polygons with a noise mask
  const n = valueNoise(seed + 9);
  const parkPolys = lay.landuse.filter((l) => l.kind === 'park' || l.kind === 'garden').map((l) => l.poly);
  for (const poly of parkPolys) {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const area = Math.abs(poly.reduce((s, a, j) => { const b = poly[(j + 1) % poly.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
    const want = Math.min(Math.floor(area / 300), 60);
    for (let got = 0, k = 0; got < want && k < 120; k++) {
      const p: V2 = [x0 + 3 + r() * (x1 - x0 - 6), y0 + 3 + r() * (y1 - y0 - 6)];
      if (!inPoly(p, poly) || onBuilding(p, 1.5) || inPond(p) || n(p[0] / 18, p[1] / 18) < 0.42 || !free(p, 5)) continue;
      const u = r();
      tree(p, u < 0.6 ? 'round' : u < 0.8 ? 'conifer' : 'columnar', 7 + r() * 5, Math.floor(r() * 3));
      got++; stats.parkTrees++;
    }
    // hedges along garden-polygon edges
    const polyLen = poly.reduce((s, a, j) => s + Math.hypot(a[0] - poly[(j + 1) % poly.length][0], a[1] - poly[(j + 1) % poly.length][1]), 0);
    if (polyLen > 20 && r() < 0.6) {
      for (let j = 0; j < poly.length; j++) {
        const a = poly[j], c = poly[(j + 1) % poly.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const steps = Math.floor(len / 2.4);
        for (let s = 0; s < steps; s++) {
          if (r() < 0.35) continue;
          const t = (s + 0.5) / steps;
          const p: V2 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
          const yaw = Math.atan2(c[1] - a[1], c[0] - a[0]);
          hedges.add(mat(p[0], p[1], 0.02, yaw, len / steps + 0.25, 0.8, 0.9 + r() * 0.3), new THREE.Color(hex([veg[0][0] - 0.06 + r() * 0.03, veg[0][1], veg[0][2]])));
          stats.hedges++;
        }
      }
    }
  }

  const leafMat = houseMat({ vertexColors: true, sway: true, lensK: 0.6 });
  const mk = (p: Parts, g: THREE.BufferGeometry, m: THREE.Material, cast: boolean) => { const mesh = p.build(g, m, { cast, receive: true }); group.add(mesh); return mesh; };
  mk(kinds.round, canopyGeo(seed + 1, 'round'), leafMat, true);
  mk(kinds.columnar, canopyGeo(seed + 2, 'columnar'), leafMat, true);
  mk(kinds.conifer, canopyGeo(seed + 3, 'conifer'), leafMat, true);
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.6, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  mk(trunks, trunkGeo, houseMat({}), true);
  const hedgeGeo = unitBox();
  {
    const hp = hedgeGeo.getAttribute('position'); const nn = valueNoise(seed + 13);
    for (let i = 0; i < hp.count; i++) if (hp.getZ(i) > 0.9) hp.setZ(i, hp.getZ(i) - nn(hp.getX(i) * 4 + 7, hp.getY(i) * 4) * 0.15);
    hedgeGeo.computeVertexNormals();
  }
  mk(hedges, hedgeGeo, houseMat({ lensK: 0.6 }), true);

  // water: one plane per water body, ripple shader
  const water: THREE.Mesh[] = [];
  for (const poly of waters) {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const wa = poly.reduce((s, a, j) => { const b = poly[(j + 1) % poly.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);
    const wpoly = wa < 0 ? poly.slice().reverse() : poly;
    const geo = new THREE.ShapeGeometry(new THREE.Shape(wpoly.map(([x, y]) => new THREE.Vector2(x, y))));
    const wm = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uLens: U.uLens, uDeep: { value: new THREE.Color(hex(P.water)) }, uShallow: { value: new THREE.Color(hex([P.water[0] + 0.08, P.water[1] - 0.02, P.water[2]])) },
        uFoam: { value: new THREE.Color(hex([P.water[0] + 0.2, P.water[1] * 0.5, P.water[2]])) }, uSky: { value: new THREE.Color(hex(P.skyTop)) }, uSize: { value: new THREE.Vector2(x1 - x0, y1 - y0) } },
      side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime; uniform float uLens; uniform vec3 uDeep, uShallow, uFoam, uSky; uniform vec2 uSize; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec3 c = mix(uShallow, uDeep, 0.65);
          float rip = vn(vW.xy * vec2(0.35, 1.6) + vec2(uTime * 0.25, 0.0)) * vn(vW.xy * vec2(0.9, 0.3) - vec2(0.0, uTime * 0.18));
          c += smoothstep(0.55, 0.75, rip) * 0.10;
          c = mix(c, uSky, 0.08);
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(c, mix(vec3(lum), c, 0.4), uLens);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(geo, wm);
    m.position.set(0, 0, -0.3);
    m.layers.set(NO_INK);
    group.add(m);
    water.push(m);
    stats.waterBodies++;
  }
  return { group, water, stats };
}
