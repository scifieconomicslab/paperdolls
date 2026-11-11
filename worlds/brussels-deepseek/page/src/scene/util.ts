// Shared helpers: seeded randomness, noise, unit geometries, the instanced-part collector,
// and the house material (MeshToonMaterial + lens / data / lit / sway shader hooks).
import * as THREE from 'three';
import { hex, P, LIGHT, type LCH } from './palette.ts';

// ---------- randomness ----------
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length) % xs.length];

/** Seeded 2D value noise, smooth, in [0,1]. */
export function valueNoise(seed: number) {
  const perm = new Uint8Array(512); const r = rng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = Float32Array.from({ length: 256 }, () => r());
  const v = (x: number, y: number) => vals[perm[(perm[x & 255] + y) & 255]];
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    const u = s(xf), w = s(yf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}

/** Colour from an OKLCH triple with seeded per-structure variation (palette-method §5). */
export function varied(base: LCH, r: () => number, dL = 0.03, dh = 4): THREE.Color {
  return new THREE.Color(hex([base[0] + (r() * 2 - 1) * dL, base[1], base[2] + (r() * 2 - 1) * dh]));
}
export const col = (c: LCH) => new THREE.Color(hex(c));
export const shade = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k);

// ---------- unit geometries (z-up; x, y in [-0.5, 0.5]; z in [0, 1]) ----------
export function unitBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0, 0.5);
  return g;
}
function fromTris(v: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  // planar uv from x/y so textures can be used
  const pos = g.getAttribute('position'); const uv: number[] = [];
  for (let i = 0; i < pos.count; i++) uv.push(pos.getX(i) + 0.5, pos.getY(i) + pos.getZ(i));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
/** buildings.md §2: gable along +x. */
export function unitGable() {
  return fromTris([
    -.5, -.5, 0, .5, -.5, 0, .5, 0, 1, -.5, -.5, 0, .5, 0, 1, -.5, 0, 1,
    .5, .5, 0, -.5, .5, 0, -.5, 0, 1, .5, .5, 0, -.5, 0, 1, .5, 0, 1,
    -.5, .5, 0, -.5, -.5, 0, -.5, 0, 1,
    .5, -.5, 0, .5, .5, 0, .5, 0, 1,
  ]);
}
/** Hip roof with ridge length = r (fraction of x length). */
export function unitHip(r: number) {
  const h = r / 2;
  return fromTris([
    -.5, -.5, 0, .5, -.5, 0, h, 0, 1, -.5, -.5, 0, h, 0, 1, -h, 0, 1,
    .5, .5, 0, -.5, .5, 0, -h, 0, 1, .5, .5, 0, -h, 0, 1, h, 0, 1,
    .5, -.5, 0, .5, .5, 0, h, 0, 1,
    -.5, .5, 0, -.5, -.5, 0, -h, 0, 1,
  ]);
}
/** Mono-pitch wedge: z=0 at y=-0.5 rising to z=1 at y=+0.5. Also used for awnings (rotated). */
export function unitWedge() {
  return fromTris([
    -.5, -.5, 0, .5, -.5, 0, .5, .5, 1, -.5, -.5, 0, .5, .5, 1, -.5, .5, 1,   // slope
    .5, .5, 0, -.5, .5, 0, -.5, .5, 1, .5, .5, 0, -.5, .5, 1, .5, .5, 1,       // high wall
    -.5, .5, 0, -.5, -.5, 0, -.5, .5, 1,                                       // side
    .5, -.5, 0, .5, .5, 0, .5, .5, 1,
  ]);
}

// ---------- matrices ----------
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
export function mat(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, m = new THREE.Matrix4()) {
  _q.setFromAxisAngle(_z, yaw);
  return m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}
export const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------- instanced part collector ----------
export interface DataSlots { struct: Int32Array; data: THREE.InstancedBufferAttribute; info: THREE.InstancedBufferAttribute }
export class Parts {
  mats: number[] = []; cols: number[] = []; struct: number[] = []; info: number[] = []; lit: number[] = [];
  constructor(public name: string) {}
  get count() { return this.mats.length / 16; }
  add(m: THREE.Matrix4, c?: THREE.Color, s = -1, topZ = 0, beautyMix = 0, lit = 0) {
    for (let i = 0; i < 16; i++) this.mats.push(m.elements[i]);
    const cc = c ?? WHITE; this.cols.push(cc.r, cc.g, cc.b);
    this.struct.push(s); this.info.push(s >= 0 ? 0 : -1, topZ, beautyMix);
    this.lit.push(lit);
    return this.count - 1;
  }
  build(geo: THREE.BufferGeometry, mat: THREE.Material, o: { cast?: boolean; receive?: boolean; data?: boolean; lit?: boolean } = {}) {
    const n = Math.max(1, this.count);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.name = this.name;
    mesh.instanceMatrix.array.set(this.count ? this.mats : ZERO.elements);
    mesh.count = this.count;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    if (this.count) (mesh.instanceColor.array as Float32Array).set(this.cols);
    mesh.castShadow = !!o.cast; mesh.receiveShadow = o.receive ?? true;
    if (o.data) {
      const data = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      const info = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      if (this.count) info.array.set(this.info);
      geo.setAttribute('aData', data); geo.setAttribute('aInfo', info);
      mesh.userData.slots = { struct: Int32Array.from(this.struct), data, info } as DataSlots;
    }
    if (o.lit) geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(Float32Array.from(this.count ? this.lit : [0]), 1));
    mesh.userData.struct = Int32Array.from(this.struct);
    mesh.computeBoundingSphere();
    mesh.frustumCulled = this.count > 0;
    return mesh;
  }
}
const WHITE = new THREE.Color(1, 1, 1);

// ---------- shared uniforms ----------
export const U = {
  uLens: { value: 0 },
  uTime: { value: 0 },
  uLensTint: { value: new THREE.Color(hex([0.80, 0.012, 75])) },
  uNoData: { value: new THREE.Color(hex(P.noData)) },
  uLamp: { value: new THREE.Color(LIGHT.lamp) },
  uSway: { value: 1 },
};

let gradientMap: THREE.DataTexture | null = null;
export function toonRamp() {
  if (gradientMap) return gradientMap;
  // 3-step: shadow / mid / lit (render-pipeline house style)
  const d = new Uint8Array([150, 150, 150, 255, 210, 210, 210, 255, 255, 255, 255, 255]);
  gradientMap = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

export interface HouseMatOpts {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  lensK?: number;                       // how far the data lens neutralises this surface (0..1)
  data?: 'none' | 'roof' | 'wall' | 'cap';
  lit?: boolean;                        // instanced aLit -> warm emissive
  sway?: boolean;                       // canopy wind sway
  lambert?: boolean;
  vertexColors?: boolean;
  side?: THREE.Side;
}

/** The house material. One function so lens, data, hatch and sway behave the same everywhere. */
export function houseMat(o: HouseMatOpts = {}): THREE.Material {
  const base = { color: o.color ?? 0xffffff, map: o.map ?? null, vertexColors: !!o.vertexColors, side: o.side ?? THREE.FrontSide };
  const m = o.lambert ? new THREE.MeshLambertMaterial(base) : new THREE.MeshToonMaterial({ ...base, gradientMap: toonRamp() });
  const data = o.data ?? 'none', lensK = o.lensK ?? 0.85;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        ${data !== 'none' ? 'attribute vec3 aData; attribute vec3 aInfo; varying vec3 vData; varying vec3 vInfo;' : ''}
        ${o.lit ? 'attribute float aLit; varying float vLit;' : ''}
        ${o.sway ? 'uniform float uTime; uniform float uSway;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${o.sway ? `
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].y * 0.21;
          float hk = clamp(position.z / 8.0, 0.0, 1.0);
          transformed.x += sin(uTime * 0.8 + ph) * 0.06 * hk * uSway * 4.0;
          transformed.y += cos(uTime * 0.6 + ph) * 0.04 * hk * uSway * 4.0;
        #endif` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 pdW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          pdW = instanceMatrix * pdW;
        #endif
        vWPos = (modelMatrix * pdW).xyz;
        ${data !== 'none' ? 'vData = aData; vInfo = aInfo;' : ''}
        ${o.lit ? 'vLit = aLit;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uLens; uniform vec3 uLensTint; uniform vec3 uNoData; uniform vec3 uLamp;
        varying vec3 vWPos;
        ${data !== 'none' ? 'varying vec3 vData; varying vec3 vInfo;' : ''}
        ${o.lit ? 'varying float vLit;' : ''}
        float pdHatch() { return step(0.5, fract((vWPos.x + vWPos.y + vWPos.z) / 0.6)); }
        ${data !== 'none' ? 'vec3 pdDataCol(float has) { return has > 0.5 ? vData : mix(uNoData, uNoData * 0.62, pdHatch()); }' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 neutral = uLensTint * (lum / max(0.001, dot(uLensTint, vec3(0.2126, 0.7152, 0.0722))));
          float lensMix = uLens * ${lensK.toFixed(3)};
          ${data === 'none' ? 'diffuseColor.rgb = mix(diffuseColor.rgb, neutral, lensMix);' : ''}
          ${data === 'roof' ? `
          if (vInfo.x < -0.5) { diffuseColor.rgb = mix(diffuseColor.rgb, neutral, lensMix); }
          else {
            vec3 dc = pdDataCol(vInfo.x);
            vec3 beauty = mix(diffuseColor.rgb, dc, vInfo.z * (vInfo.x > 0.5 ? 1.0 : 0.6));
            diffuseColor.rgb = mix(beauty, dc, uLens);
          }` : ''}
          ${data === 'cap' ? `
          if (vInfo.x < -0.5) { diffuseColor.rgb = mix(diffuseColor.rgb, neutral, lensMix); }
          else { diffuseColor.rgb = pdDataCol(vInfo.x); }` : ''}
          ${data === 'wall' ? `
          vec3 n2 = mix(diffuseColor.rgb, neutral, lensMix);
          if (vInfo.x > -0.5 && vWPos.z > 0.7 * vInfo.y) n2 = mix(n2, pdDataCol(vInfo.x), uLens);
          diffuseColor.rgb = n2;` : ''}
        }`);
    if (o.lit) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uLamp * vLit * 1.25;`);
    }
  };
  m.customProgramCacheKey = () => `house-${o.lambert ? 'l' : 't'}-${data}-${lensK}-${!!o.lit}-${!!o.sway}-${!!o.map}-${!!o.vertexColors}`;
  return m;
}

/** A canvas texture helper (sRGB). */
export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

/** Shared layer for things the ink pass must not outline (render-pipeline §3). */
export const NO_INK = 2;
