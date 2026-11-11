// Step 5: trees (data trees first, then decorative street, park and garden trees), hedges, and the pond.
// recipes: nature-and-water.md
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, hex } from './palette.ts';
import { Parts, houseMat, mat, rng, valueNoise, U, NO_INK, unitBox, col } from './util.ts';
import { inPoly, type Layout, type V2 } from './layout.ts';

export interface NatureOut { group: THREE.Group; water: THREE.Mesh | null; stats: Record<string, number> }

/** Round deciduous canopy: 3 jittered icosahedra, vertex-coloured darker underneath (nature-and-water §1). */
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

export function buildNature(lay: Layout, streetTrees: V2[], pond: V2[] | null, seed: number): NatureOut {
  const r = rng(seed);
  const group = new THREE.Group(); group.name = 'nature';
  const kinds = { round: new Parts('tree-round'), columnar: new Parts('tree-columnar'), conifer: new Parts('tree-conifer') };
  const trunks = new Parts('trunk');
  const hedges = new Parts('hedge');
  const placed: V2[] = [];
  const stats: Record<string, number> = { dataTrees: 0, streetTrees: 0, parkTrees: 0, gardenTrees: 0, hedges: 0 };
  const veg = P.veg;
  const blockOf = (p: V2) => lay.blocks.find((b) => inPoly(p, b.kerb));
  const onBuilding = (p: V2, pad: number) => lay.structs.some((s) => {
    const dx = p[0] - s.c[0], dy = p[1] - s.c[1];
    return Math.abs(dx * s.ax[0] + dy * s.ax[1]) < s.L / 2 + pad && Math.abs(dx * s.ay[0] + dy * s.ay[1]) < s.W / 2 + pad;
  });
  const free = (p: V2, d: number) => placed.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= d);
  const inPond = (p: V2) => !!pond && inPoly(p, pond.map(([x, y]) => [x, y]) as V2[]);

  function tree(p: V2, kind: 'round' | 'columnar' | 'conifer', h: number, tone: number) {
    const z = 0.15;
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
    const k = kind === 'columnar' ? 'columnar' : 'round';
    tree([x, y], k, 7.5 * (sc || 1), k === 'columnar' ? 0 : Math.floor(r() * 3));
    stats.dataTrees++;
  }
  // 2. street trees on avenue pavements: one kind per street (lime, round), every 10 m
  for (const p of streetTrees) {
    if (!free(p, 6) || onBuilding(p, 0.8)) continue;
    tree(p, 'round', 8 + r() * 1.5, r() < 0.3 ? 2 : 1);
    stats.streetTrees++;
  }
  // 3. parks: Poisson-ish sampling with a noise mask, clusters + clearings, 2-3 kinds
  const n = valueNoise(seed + 9);
  for (const b of lay.blocks.filter((bb) => bb.use === 'park' || bb.use === 'garden')) {
    const [x0, y0, x1, y1] = b.rect;
    for (let k = 0; k < 120; k++) {
      const p: V2 = [x0 + 3 + r() * (x1 - x0 - 6), y0 + 3 + r() * (y1 - y0 - 6)];
      if (!inPoly(p, b.plot) || n(p[0] / 18, p[1] / 18) < 0.42 || !free(p, 5)) continue;
      const u = r();
      tree(p, u < 0.6 ? 'round' : u < 0.8 ? 'conifer' : 'columnar', 7 + r() * 5, Math.floor(r() * 3));
      stats.parkTrees++;
    }
  }
  // 4. gardens: behind houses and terraces, 0-3 trees per plot, plus hedges along street-facing plot edges
  for (const b of lay.blocks.filter((bb) => bb.use === 'villa' || bb.use === 'terrace')) {
    const [x0, y0, x1, y1] = b.rect;
    const want = b.structs.length * (b.use === 'villa' ? 1.6 : 0.8);
    for (let k = 0, got = 0; k < 60 && got < want; k++) {
      const p: V2 = [x0 + 4 + r() * (x1 - x0 - 8), y0 + 4 + r() * (y1 - y0 - 8)];
      if (!inPoly(p, b.plot) || onBuilding(p, 2.0) || !free(p, 4.5)) continue;
      tree(p, r() < 0.8 ? 'round' : 'conifer', 5 + r() * 3.5, Math.floor(r() * 3));
      stats.gardenTrees++; got++;
    }
    if (b.use === 'villa') {
      // hedges along the plot edge, broken where buildings meet the pavement
      const poly = b.plot;
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], c = poly[(k + 1) % poly.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 4) continue;
        const steps = Math.floor(len / 2.2);
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) / steps;
          const p: V2 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
          if (onBuilding(p, 1.2) || r() < 0.08) continue;
          const yaw = Math.atan2(c[1] - a[1], c[0] - a[0]);
          hedges.add(mat(p[0], p[1], 0.15, yaw, len / steps + 0.25, 0.8, 1.0 + r() * 0.35), new THREE.Color(hex([veg[0][0] - 0.06 + r() * 0.03, veg[0][1], veg[0][2]])));
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

  // pond: depth gradient + ripple streaks, frozen in snapshots (nature-and-water §3)
  let water: THREE.Mesh | null = null;
  if (pond) {
    const xs = pond.map((p) => p[0]), ys = pond.map((p) => p[1]);
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0, 1, 1);
    const wm = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uLens: U.uLens, uDeep: { value: new THREE.Color(hex(P.water)) }, uShallow: { value: new THREE.Color(hex([P.water[0] + 0.08, P.water[1] - 0.02, P.water[2]])) },
        uFoam: { value: new THREE.Color(hex([P.water[0] + 0.2, P.water[1] * 0.5, P.water[2]])) }, uSky: { value: new THREE.Color(hex(P.skyTop)) }, uSize: { value: new THREE.Vector2(x1 - x0, y1 - y0) } },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTime; uniform float uLens; uniform vec3 uDeep, uShallow, uFoam, uSky; uniform vec2 uSize; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 d2 = min(vUv, 1.0 - vUv) * uSize;            // metres to the nearest shore
          float d = min(d2.x, d2.y);
          vec3 c = mix(uShallow, uDeep, smoothstep(0.5, 7.0, d));
          c = mix(c, uFoam, 1.0 - smoothstep(0.0, 1.2, d));
          float rip = vn(vW.xy * vec2(0.35, 1.6) + vec2(uTime * 0.25, 0.0)) * vn(vW.xy * vec2(0.9, 0.3) - vec2(0.0, uTime * 0.18));
          c += smoothstep(0.55, 0.75, rip) * 0.10;
          c = mix(c, uSky, 0.12 * (1.0 - vUv.y));
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(c, mix(vec3(lum), c, 0.4), uLens);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    water = new THREE.Mesh(geo, wm);
    water.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.3);
    water.layers.set(NO_INK);
    group.add(water);
    // moored rowing boat (decorative)
    const boat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 0.5), houseMat({ color: hex([0.55, 0.09, 195]) }));
    boat.position.set(x0 + 4, y0 + 2.2, -0.2); boat.rotation.z = 0.15; boat.castShadow = true;
    group.add(boat);
  }
  return { group, water, stats };
}
