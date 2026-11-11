import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { P, hex, oklch, LCH } from './palette';
import { hash01, mulberry32, minAreaRect, polyArea, pointInPoly, pickW, V2, Rect } from './util';
import type { Pipeline } from './pipeline';
import { lensify, dataMaterial } from './lens';

export interface SceneBuilding {
  id: string; fp: V2[]; lv: number; lva: boolean; area: number; res: string; bound: boolean; osm: string; ec: string; nb: number; landmark?: boolean; name?: string;
}
export interface Bd {
  i: number; id: string; fp: V2[]; lv: number; area: number; bound: boolean; osm: string; landmark: boolean; name?: string;
  rect: Rect; fits: boolean; Hb: number; roof: 'gable' | 'hip' | 'flat' | 'ext' | 'low'; wallI: number; wallCol: THREE.Color; roofCol: THREE.Color; seed: number; cx: number; cy: number;
}

const STOREY = 3.1, GROUND = 3.2, PLINTH_H = 0.8, PITCH = 35, OH = 0.35;
const civicTypes = new Set(['hospital', 'school', 'university', 'college', 'public', 'civic', 'church', 'chapel', 'commercial', 'retail', 'parking', 'industrial', 'warehouse', 'office', 'train_station', 'museum', 'sports_centre']);
const lowTypes = new Set(['garages', 'garage', 'shed', 'greenhouse', 'service', 'hut', 'farm_auxiliary', 'carport']);

function vary([L, C, h]: LCH, r1: number, r2: number, dl = 0.03, dh = 4): THREE.Color {
  return new THREE.Color(oklch(L + (r1 - 0.5) * 2 * dl, C, h + (r2 - 0.5) * 2 * dh));
}

export function prepare(raw: SceneBuilding[]): Bd[] {
  const out: Bd[] = [];
  raw.forEach((b, i) => {
    const fp: V2[] = b.fp.map(([x, y]) => [x, -y] as V2);
    const rect = minAreaRect(fp);
    const fits = rect.fill >= 0.82 && rect.W >= 3;
    const r = hash01('b' + b.id), r2 = hash01('c' + b.id), r3 = hash01('d' + b.id), r4 = hash01('e' + b.id);
    const lowT = lowTypes.has(b.osm) || b.area < 22;
    const church = b.landmark && b.osm === 'church';
    const Hb = church ? 10.5 : lowT ? 2.6 : b.landmark ? GROUND + (b.lv - 1) * STOREY : GROUND + (Math.max(1, b.lv) - 1) * STOREY;
    let roof: Bd['roof'];
    if (!fits) roof = lowT ? 'low' : 'ext';
    else if (lowT) roof = 'low';
    else if (b.area >= 1400 || b.lv >= 5 || civicTypes.has(b.osm)) roof = 'flat';
    else if (b.lv >= 4) roof = r < 0.45 ? 'flat' : 'gable';
    else roof = r < 0.58 ? 'gable' : r < 0.82 ? 'hip' : 'flat';
    const wallE = pickW(P.walls, r2); const wallI = P.walls.indexOf(wallE);
    const wallCol = vary(wallE.c, r3, r4);
    // roofs share colour within a ~35 m cell so terraces read as rows
    const cell = `${Math.floor(rect.cx / 35)}_${Math.floor(rect.cy / 35)}`;
    const roofE = church ? P.roofs[0] : roof === 'flat' || roof === 'ext' || roof === 'low' ? { c: [0.46, 0.012, 250] as LCH } : pickW(P.roofs, hash01('r' + cell));
    const roofCol = vary(roofE.c, hash01('s' + b.id), 0.5, 0.02, 2);
    out.push({ i, id: b.id, fp, lv: church ? 1 : Math.max(1, b.lv), area: b.area, bound: b.bound, osm: b.osm, landmark: !!b.landmark, name: b.name, rect, fits, Hb, roof, wallI, wallCol, roofCol, seed: hash01('z' + b.id), cx: rect.cx, cy: rect.cy });
  });
  return out;
}

// ---------- instancing helper ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _zz = new THREE.Vector3(0, 0, 1);
let curOwner = -1;
class Inst {
  mats: number[] = []; cols: number[] = []; owner: number[] = [];
  n = 0;
  addRot(x: number, y: number, z: number, ang: number, sx: number, sy: number, sz: number, c: THREE.Color) {
    _q.setFromAxisAngle(_zz, ang); _p.set(x, y, z); _s.set(sx, sy, sz); _m.compose(_p, _q, _s); this.push(c);
  }
  addBasis(p: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3, sx: number, sy: number, sz: number, c: THREE.Color) {
    _m.makeBasis(u.clone().multiplyScalar(sx), n.clone().multiplyScalar(sy), _zz.clone().multiplyScalar(sz)); _m.setPosition(p); this.push(c);
  }
  private push(c: THREE.Color) { for (let i = 0; i < 16; i++) this.mats.push(_m.elements[i]); this.cols.push(c.r, c.g, c.b); this.owner.push(curOwner); this.n++; }
  build(geom: THREE.BufferGeometry, mat: THREE.Material, cast: boolean, recv: boolean, name: string): THREE.InstancedMesh | null {
    if (!this.n) return null;
    const mesh = new THREE.InstancedMesh(geom, mat, this.n);
    (mesh.instanceMatrix.array as Float32Array).set(this.mats);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cols), 3);
    mesh.castShadow = cast; mesh.receiveShadow = recv; mesh.name = name; mesh.userData.owner = Int32Array.from(this.owner); mesh.userData.base = Float32Array.from(this.cols); mesh.computeBoundingSphere(); mesh.frustumCulled = true; return mesh;
  }
}

// ---------- unit geometries ----------
const boxZ = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);                 // z 0..1, centred in xy
const boxY = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0.5);               // y 0..1 outward, x centred, z 0..1
const boxYc = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);                // y 0..1, z centred (sill, bands use z from 0)
function unitGable(): THREE.BufferGeometry {
  const v = [-.5,-.5,0, .5,-.5,0, .5,0,1,  -.5,-.5,0, .5,0,1, -.5,0,1,   .5,.5,0, -.5,.5,0, -.5,0,1,  .5,.5,0, -.5,0,1, .5,0,1,   -.5,.5,0, -.5,-.5,0, -.5,0,1,   .5,-.5,0, .5,.5,0, .5,0,1];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g;
}
function unitHip(ridge = 0.4): THREE.BufferGeometry {
  const r = ridge / 2;
  const v = [-.5,-.5,0, .5,-.5,0, r,0,1,  -.5,-.5,0, r,0,1, -r,0,1,   .5,.5,0, -.5,.5,0, -r,0,1,  .5,.5,0, -r,0,1, r,0,1,   -.5,.5,0, -.5,-.5,0, -r,0,1,   .5,-.5,0, .5,.5,0, r,0,1];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g;
}

export function glassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 32; c.height = 64; const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, '#aeb9c4'); g.addColorStop(0.28, '#d9dee3'); g.addColorStop(0.3, '#ffffff'); g.addColorStop(1, '#f4f6f8');
  x.fillStyle = g; x.fillRect(0, 0, 32, 64);
  x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.moveTo(0, 64); x.lineTo(14, 0); x.lineTo(22, 0); x.lineTo(8, 64); x.fill();
  x.fillStyle = '#7b848c'; x.fillRect(15, 0, 2, 64); x.fillRect(0, 20, 32, 2); x.fillRect(0, 0, 32, 1); x.fillRect(0, 63, 32, 1); x.fillRect(0, 0, 1, 64); x.fillRect(31, 0, 1, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export interface Part { mesh: THREE.InstancedMesh; i: number; kind: 'cap' | 'roof' | 'body' }
export interface BuildingsHandle {
  partsOf(bi: number): Part[]; extTop(bi: number): number[] | null; extMesh(): THREE.Mesh | null; pickables(): THREE.Object3D[]; ownerOf(o: THREE.Intersection): number;
  group: THREE.Group; facades: THREE.Group; bds: Bd[]; setView(target: THREE.Vector3, viewW: number): void; roadDist(x: number, y: number): number;
  stats(): { rect: number; ext: number; gable: number; hip: number; flat: number; low: number; tiles: number; windows: number };
}

export function buildBuildings(pipe: Pipeline, raw: SceneBuilding[], roadLines: V2[][]): BuildingsHandle {
  const bds = prepare(raw);
  const group = new THREE.Group(); group.name = 'buildings';
  const toon = (vc = false) => new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: pipe.toon, vertexColors: vc });
  const matInst = lensify(toon()); const matData = dataMaterial(toon());
  const trim = new THREE.Color(hex(P.trim)); const coping = new THREE.Color(hex([0.86, 0.012, 85]));
  const dark = (c: THREE.Color, d = 0.08) => { const o = { h: 0, s: 0, l: 0 }; c.getHSL(o); return new THREE.Color().setHSL(o.h, o.s, Math.max(0, o.l - d * 0.9)); };

  const body = new Inst(), plinth = new Inst(), gable = new Inst(), infill = new Inst(), hip = new Inst(), ridge = new Inst(), chim = new Inst();
  const spire = new Inst(), corn = new Inst(), slab = new Inst(), parap = new Inst(), furn = new Inst(), low = new Inst();
  const extGeoms: THREE.BufferGeometry[] = []; const extStart: number[] = [], extOwner: number[] = []; let extVerts = 0; const extcap = new Inst();
  const st = { rect: 0, ext: 0, gable: 0, hip: 0, flat: 0, low: 0, tiles: 0, windows: 0 };
  const furnCol = new THREE.Color(hex([0.72, 0.01, 250])), furnCol2 = new THREE.Color(hex([0.62, 0.015, 80]));

  for (const b of bds) {
    curOwner = b.i; const { rect: R, Hb } = b; const r = mulberry32(Math.floor(b.seed * 4e9));
    const wallDk = dark(b.wallCol, 0.1);
    if (b.roof === 'ext') {
      st.ext++;
      const sh = new THREE.Shape(b.fp.map((p) => new THREE.Vector2(p[0], p[1])));
      let g: THREE.BufferGeometry = new THREE.ExtrudeGeometry(sh, { depth: Hb, bevelEnabled: false }); 
      const pos = g.getAttribute('position'), nor = g.getAttribute('normal'); const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { const top = nor.getZ(i) > 0.9; const c = top ? b.roofCol : b.wallCol; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); extGeoms.push(g); extStart.push(extVerts); extOwner.push(b.i); extVerts += pos.count;
      for (let e = 0; e < b.fp.length; e++) { const a = b.fp[e], c2 = b.fp[(e + 1) % b.fp.length]; const len = Math.hypot(c2[0] - a[0], c2[1] - a[1]); if (len < 0.8) continue; extcap.addRot((a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2, Hb - 0.02, Math.atan2(c2[1] - a[1], c2[0] - a[0]), len + 0.3, 0.5, 0.32, coping); }
      if (b.landmark && b.osm === 'church') {
        // tower + spire at the end of the footprint along its long axis (decorative emphasis, labelled)
        const ca = Math.cos(R.ang), sa = Math.sin(R.ang); const end = b.fp.filter((p) => (p[0] - R.cx) * ca + (p[1] - R.cy) * sa > R.L * 0.3);
        const tx = end.reduce((a, p) => a + p[0], 0) / Math.max(1, end.length), ty = end.reduce((a, p) => a + p[1], 0) / Math.max(1, end.length);
        const tw = Math.max(6, R.W * 0.4);
        body.addRot(tx, ty, 0, R.ang, tw, tw, Hb + 9, b.wallCol);
        corn.addRot(tx, ty, Hb + 8.6, R.ang, tw + 0.6, tw + 0.6, 0.4, coping);
        spire.addRot(tx, ty, Hb + 9, R.ang, tw * 0.8, tw * 0.8, 24, b.roofCol);
      }
      continue;
    }
    st.rect++;
    if (b.roof === 'low') { st.low++; low.addRot(R.cx, R.cy, 0, R.ang, R.L, R.W, Hb, b.wallCol); slab.addRot(R.cx, R.cy, Hb, R.ang, R.L + 0.3, R.W + 0.3, 0.14, b.roofCol); continue; }
    if (R.L > 15 && R.W < 17) {
      const n = Math.max(2, Math.round(R.L / 6.5)), sl = R.L / n; const ca0 = Math.cos(R.ang), sa0 = Math.sin(R.ang); let prev = -1;
      for (let k = 0; k < n; k++) {
        const off = -R.L / 2 + (k + 0.5) * sl; let wi = Math.floor(hash01(b.id + 'w' + k) * 4); if (wi === prev) wi = (wi + 1) % 4; prev = wi;
        const base = k === 0 || hash01(b.id + 'x' + k) < 0.45 ? b.wallCol : vary(P.walls[Math.min(3, (b.wallI + wi) % 4)].c, hash01(b.id + 'p' + k), hash01(b.id + 'q' + k));
        const h2 = Hb;
        body.addRot(R.cx + ca0 * off, R.cy + sa0 * off, 0, R.ang, sl + 0.02, R.W, h2, base);
        plinth.addRot(R.cx + ca0 * off, R.cy + sa0 * off, 0, R.ang, sl + 0.04, R.W + 0.3, PLINTH_H, dark(base, 0.1));
        if (b.roof !== 'flat' && hash01(b.id + 'c' + k) < 0.55) chim.addRot(R.cx + ca0 * (off + (hash01(b.id + 'f' + k) - 0.5) * sl * 0.5), R.cy + sa0 * (off + 0), Hb + 1.6, R.ang, 0.7, 0.7, 2.2, dark(base, 0.1));
      }
    } else {
      body.addRot(R.cx, R.cy, 0, R.ang, R.L, R.W, Hb, b.wallCol);
      plinth.addRot(R.cx, R.cy, 0, R.ang, R.L + 0.3, R.W + 0.3, PLINTH_H, wallDk);
    }
    const tanP = Math.tan((PITCH * Math.PI) / 180);
    if (b.roof === 'gable' || b.roof === 'hip') {
      const rh = Math.min(4.5, (R.W / 2) * tanP); const rz = rh + OH * tanP;
      (b.roof === 'gable' ? gable : hip).addRot(R.cx, R.cy, Hb - 0.05, R.ang, R.L + 2 * OH, R.W + 2 * OH, rz, b.roofCol);
      if (b.roof === 'gable') { st.gable++; infill.addRot(R.cx, R.cy, Hb - 0.05, R.ang, R.L, R.W, rh - 0.05, b.wallCol); } else st.hip++;
      ridge.addRot(R.cx, R.cy, Hb - 0.05 + rz - 0.15, R.ang, (b.roof === 'gable' ? R.L + 2 * OH : (R.L + 2 * OH) * 0.4 + 0.5), 0.65, 0.3, trim);
      if (b.landmark && b.osm === 'church') {
        const ca = Math.cos(R.ang), sa = Math.sin(R.ang), tw = Math.max(6, R.W * 0.42), tc = R.L / 2 - tw / 2;
        body.addRot(R.cx + ca * tc, R.cy + sa * tc, 0, R.ang, tw, tw, Hb + 9, b.wallCol);
        corn.addRot(R.cx + ca * tc, R.cy + sa * tc, Hb + 8.6, R.ang, tw + 0.6, tw + 0.6, 0.4, trim);
        spire.addRot(R.cx + ca * tc, R.cy + sa * tc, Hb + 9, R.ang, tw + 0.5, tw + 0.5, 17, b.roofCol);
      }
      if (r() < 0.65 && R.L > 5 && !b.landmark) {
        const f = (r() - 0.5) * 0.6; const ca = Math.cos(R.ang), sa = Math.sin(R.ang);
        chim.addRot(R.cx + ca * R.L * f, R.cy + sa * R.L * f + 0, Hb + rh * 0.55, R.ang, 0.7, 0.7, 2.0, wallDk);
      }
    } else {
      st.flat++;
      corn.addRot(R.cx, R.cy, Hb - 0.35, R.ang, R.L + 0.36, R.W + 0.36, 0.35, coping);
      slab.addRot(R.cx, R.cy, Hb, R.ang, R.L, R.W, 0.12, b.roofCol);
      const ca = Math.cos(R.ang), sa = Math.sin(R.ang);
      const bars: [number, number, number, number][] = [[0, R.W / 2 - 0.1, R.L + 0.3, 0.2], [0, -R.W / 2 + 0.1, R.L + 0.3, 0.2], [R.L / 2 - 0.1, 0, 0.2, R.W], [-R.L / 2 + 0.1, 0, 0.2, R.W]];
      for (const [ox, oy, sx, sy] of bars) parap.addRot(R.cx + ox * ca - oy * sa, R.cy + ox * sa + oy * ca, Hb, R.ang, sx, sy, 0.55, coping);
      const nf = R.L * R.W > 250 ? 1 + Math.floor(r() * 3) : r() < 0.5 ? 1 : 0;
      for (let k = 0; k < nf; k++) {
        const ox = (r() - 0.5) * (R.L - 3), oy = (r() - 0.5) * (R.W - 3); const big = r() < 0.25;
        furn.addRot(R.cx + ox * ca - oy * sa, R.cy + ox * sa + oy * ca, Hb + 0.12, R.ang + r() * 0.3, big ? 2.5 : 1.0, big ? 3 : 0.8, big ? 2.6 : 0.8, big ? furnCol2 : furnCol);
      }
    }
  }
  let extMesh: THREE.Mesh | null = null;
  const DATA_PARTS = new Set(['roof-gable', 'roof-hip', 'roof-slab', 'ridge-cap', 'cornice', 'parapet', 'extcap']);
  const meshes: THREE.InstancedMesh[] = [];
  const add = (i: Inst, g: THREE.BufferGeometry, name: string, cast = true, recv = true) => {
    const isData = DATA_PARTS.has(name); const m = i.build(g, isData ? matData : matInst, cast, recv, name);
    if (m) { if (isData) g.setAttribute('aHatch', new THREE.InstancedBufferAttribute(new Float32Array(m.count), 1)); group.add(m); meshes.push(m); }
  };
  add(body, boxZ(), 'body'); add(plinth, boxZ(), 'plinth', false); add(gable, unitGable(), 'roof-gable'); add(infill, unitGable(), 'gable-infill', false);
  add(hip, unitHip(), 'roof-hip'); add(ridge, boxZ(), 'ridge-cap', false); add(chim, boxZ(), 'chimney'); add(corn, boxZ(), 'cornice', false);
  add(slab, boxZ(), 'roof-slab', false); add(parap, boxZ(), 'parapet', false); add(furn, boxZ(), 'roof-furniture'); add(low, boxZ(), 'low'); add(spire, unitHip(0.001), 'spire'); add(extcap, boxZ(), 'extcap', false);
  if (extGeoms.length) { const g = mergeGeometries(extGeoms)!; const m = new THREE.Mesh(g, lensify(toon(true))); m.castShadow = true; m.receiveShadow = true; m.name = 'extruded'; m.userData.extStart = extStart; m.userData.extOwner = extOwner; group.add(m); extMesh = m; }

  // ---------- facades, built per 128 m tile on demand ----------
  const facades = new THREE.Group(); facades.name = 'facades';
  const TILE = 128; const tileKey = (x: number, y: number) => `${Math.floor(x / TILE)},${Math.floor(y / TILE)}`;
  const tiles = new Map<string, number[]>(); bds.forEach((b) => { const k = tileKey(b.cx, b.cy); (tiles.get(k) ?? tiles.set(k, []).get(k)!).push(b.i); });
  // spatial hash of building rects for party-wall tests
  const CS = 30; const grid = new Map<string, number[]>();
  bds.forEach((b) => { const xs = b.fp.map((p) => p[0]), ys = b.fp.map((p) => p[1]); for (let gx = Math.floor((Math.min(...xs) - 1) / CS); gx <= Math.floor((Math.max(...xs) + 1) / CS); gx++) for (let gy = Math.floor((Math.min(...ys) - 1) / CS); gy <= Math.floor((Math.max(...ys) + 1) / CS); gy++) { const k = gx + ',' + gy; (grid.get(k) ?? grid.set(k, []).get(k)!).push(b.i); } });
  const insideOther = (x: number, y: number, self: number) => { for (const j of grid.get(Math.floor(x / CS) + ',' + Math.floor(y / CS)) ?? []) if (j !== self && pointInPoly(x, y, bds[j].fp)) return true; return false; };
  // road segments grid
  const rg = new Map<string, number[][]>(); const RC = 40;
  roadLines.forEach((ln) => { for (let i = 0; i + 1 < ln.length; i++) { const a = ln[i], b2 = ln[i + 1]; const seg = [a[0], -a[1], b2[0], -b2[1]]; const x0 = Math.floor(Math.min(seg[0], seg[2]) / RC), x1 = Math.floor(Math.max(seg[0], seg[2]) / RC), y0 = Math.floor(Math.min(seg[1], seg[3]) / RC), y1 = Math.floor(Math.max(seg[1], seg[3]) / RC); for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const k = gx + ',' + gy; (rg.get(k) ?? rg.set(k, []).get(k)!).push(seg); } } });
  const roadDist = (x: number, y: number) => {
    let best = 1e9; const cx = Math.floor(x / RC), cy = Math.floor(y / RC);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) for (const s of rg.get(gx + ',' + gy) ?? []) {
      const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy || 1; let t = ((x - s[0]) * dx + (y - s[1]) * dy) / l2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (s[0] + dx * t), y - (s[1] + dy * t)); if (d < best) best = d;
    }
    return best;
  };

  const glassTex = glassTexture();
  const glassMat = lensify(new THREE.MeshToonMaterial({ color: 0xffffff, map: glassTex, gradientMap: pipe.toon }));
  const unitY = boxY();
  const accents = [new THREE.Color(hex(P.accent[0])), new THREE.Color(hex(P.accent[1])), new THREE.Color(hex([0.40, 0.05, 150]))];
  const glassCol = new THREE.Color(hex(P.glass));
  const tileGroups = new Map<string, THREE.Group>(); const detail: { g: THREE.Group; fine: THREE.Object3D[] }[] = [];

  function faceList(b: Bd) {
    const out: { c: THREE.Vector3; n: THREE.Vector3; u: THREE.Vector3; len: number }[] = [];
    if (b.fits && b.roof !== 'ext') {
      const R = b.rect; const u0 = new THREE.Vector3(Math.cos(R.ang), Math.sin(R.ang), 0), v0 = new THREE.Vector3(-Math.sin(R.ang), Math.cos(R.ang), 0);
      const C = new THREE.Vector3(R.cx, R.cy, 0);
      const defs: [THREE.Vector3, number, number][] = [[v0, R.L, R.W / 2], [v0.clone().negate(), R.L, R.W / 2], [u0, R.W, R.L / 2], [u0.clone().negate(), R.W, R.L / 2]];
      for (const [n, len, off] of defs) out.push({ c: C.clone().addScaledVector(n, off), n, u: new THREE.Vector3(n.y, -n.x, 0), len });
    } else {
      const ccw = polyArea(b.fp) > 0; const n = b.fp.length;
      // merge consecutive near-collinear edges into runs (OSM walls are chopped into buttress-sized pieces)
      const dirs = b.fp.map((a, i) => { const c = b.fp[(i + 1) % n]; return Math.atan2(c[1] - a[1], c[0] - a[0]); });
      const dd = (x: number, y: number) => { let d = Math.abs(x - y) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
      let start = 0; for (let i = 0; i < n; i++) if (dd(dirs[i], dirs[(i + n - 1) % n]) > 0.3) { start = i; break; }
      let i = 0;
      while (i < n) {
        let j = i; let lenAcc = 0; const i0 = (start + i) % n; let ex = b.fp[i0][0], ey = b.fp[i0][1];
        const first = b.fp[i0];
        let last = first;
        while (j < n) { const k = (start + j) % n; if (j > i && dd(dirs[k], dirs[i0]) > 0.3) break; const nx = b.fp[(k + 1) % n]; lenAcc += Math.hypot(nx[0] - b.fp[k][0], nx[1] - b.fp[k][1]); last = nx; j++; }
        void ex; void ey;
        const dx = last[0] - first[0], dy = last[1] - first[1], len = Math.hypot(dx, dy);
        if (len >= 3 && lenAcc < len * 1.4) {
          const nv = ccw ? new THREE.Vector3(dy / len, -dx / len, 0) : new THREE.Vector3(-dy / len, dx / len, 0);
          out.push({ c: new THREE.Vector3((first[0] + last[0]) / 2, (first[1] + last[1]) / 2, 0), n: nv, u: new THREE.Vector3(nv.y, -nv.x, 0), len });
        }
        i = Math.max(j, i + 1);
      }
    }
    return out;
  }

  function buildTile(key: string): THREE.Group {
    const g = new THREE.Group(); g.name = 'facade-tile-' + key;
    const shut = new Inst(), glass = new Inst(), sur = new Inst(), sill = new Inst(), lint = new Inst(), door = new Inst(), step = new Inst(), band = new Inst(), bay = new Inst(), doorSur = new Inst();
    for (const bi of tiles.get(key) ?? []) {
      const b = bds[bi]; curOwner = b.i; if (b.roof === 'low') continue; const r = mulberry32(Math.floor(b.seed * 4e9) ^ 0x9e3779b9);
      const faces = faceList(b).map((f) => ({ ...f, party: !b.landmark && insideOther(f.c.x + f.n.x * 0.7, f.c.y + f.n.y * 0.7, b.i), rd: roadDist(f.c.x, f.c.y) }));
      const openF = faces.filter((f) => !f.party && f.len >= 2.8);
      if (!openF.length) continue;
      const streetFace = openF.reduce((a, c) => (c.rd < a.rd ? c : a));
      const bayW = b.landmark ? 5.5 : 3.0 + r() * 0.8, winK = 0.9 + r() * 0.25; const brick = b.wallI <= 1 && b.roof !== 'flat' || b.wallI <= 1;
      const accent = accents[Math.floor(r() * 3)]; const bayDone = { v: false }; const hasShutters = hash01('sh' + b.id) < 0.28;
      const bayWanted = brick && b.lv >= 2 && b.area < 300 && r() < 0.3 && b.roof !== 'ext';
      const wallDk = dark(b.wallCol, 0.1);
      for (const f of openF) {
        const bays = Math.max(1, Math.round(f.len / bayW)); const bw = f.len / bays; const isStreet = f === streetFace;
        const rowFace = isStreet && f.len > 13; const doorBay = isStreet ? Math.floor(r() * bays) : -1;
        const bayBay = isStreet && bayWanted && b.lv >= 2 && bays >= 2 ? (doorBay === 0 ? 1 : 0) : -1;
        const p0 = f.c.clone().addScaledVector(f.u, -f.len / 2);
        // stone banding at plinth top and each floor line (motif)
        if (brick && f.len > 4) {
          for (let s = 0; s <= b.lv - 1; s++) { const z = s === 0 ? PLINTH_H : GROUND + (s - 1) * STOREY + (s > 0 ? STOREY : 0) - (s > 0 ? 0 : 0); void z; }
          band.addBasis(f.c.clone().setZ(PLINTH_H - 0.08), f.u, f.n, f.len, 0.08, 0.2, trim);
          for (let s = 1; s < b.lv; s++) band.addBasis(f.c.clone().setZ(GROUND + (s - 1) * STOREY - 0.12), f.u, f.n, f.len, 0.08, 0.24, trim);
        }
        if (f.len > 3 && b.roof !== 'ext') band.addBasis(f.c.clone().setZ(b.Hb - 0.28), f.u, f.n, f.len + 0.3, 0.32, 0.3, trim);
        for (let s = 0; s < b.lv; s++) {
          const z0 = s === 0 ? PLINTH_H : GROUND + (s - 1) * STOREY; const fh = s === 0 ? GROUND - PLINTH_H : STOREY;
          for (let k = 0; k < bays; k++) {
            const cc = p0.clone().addScaledVector(f.u, (k + 0.5) * bw);
            let ww = Math.min(bw - 0.8, bw * 0.52 * winK + (s === 0 ? -0.1 : 0)); let wh = (s === 0 ? 0.55 : 0.66) * (s === 0 ? fh + 0.4 : fh); let sillZ = z0 + (s === 0 ? 0.35 : 0.8);
            if (b.landmark) { ww = 1.5; wh = 5.6; sillZ = 2.4; }
            const isDoor = s === 0 && !b.landmark && (k === doorBay || (rowFace && k % 2 === 1));
            const isBay = s === 1 && k === bayBay;
            if (isDoor) {
              const dw = 1.05, dh = 2.2;
              doorSur.addBasis(cc.clone().setZ(PLINTH_H), f.u, f.n, dw + 0.4, 0.07, dh + 0.3, trim);
              door.addBasis(cc.clone().addScaledVector(f.n, 0.04).setZ(PLINTH_H), f.u, f.n, dw, 0.08, dh, accent);
              step.addBasis(cc.clone().addScaledVector(f.n, 0.05).setZ(0), f.u, f.n, dw + 0.7, 0.55, PLINTH_H * 0.5, trim);
              step.addBasis(cc.clone().addScaledVector(f.n, 0.05).setZ(PLINTH_H * 0.5), f.u, f.n, dw + 0.5, 0.3, PLINTH_H * 0.5, trim);
              continue;
            }
            if (isBay && !bayDone.v) {
              bayDone.v = true; const bwid = Math.min(2.6, bw - 0.5);
              bay.addBasis(cc.clone().setZ(z0), f.u, f.n, bwid, 0.8, STOREY - 0.2, b.wallCol);
              bay.addBasis(cc.clone().setZ(z0 + STOREY - 0.2), f.u, f.n, bwid + 0.3, 0.95, 0.18, trim);
              glass.addBasis(cc.clone().addScaledVector(f.n, 0.81).setZ(z0 + 0.5), f.u, f.n, bwid - 0.5, 0.06, STOREY - 1.2, glassCol);
              continue;
            }
            glass.addBasis(cc.clone().addScaledVector(f.n, 0.03).setZ(sillZ), f.u, f.n, ww, 0.05, wh, glassCol);
            sur.addBasis(cc.clone().setZ(sillZ - 0.12), f.u, f.n, ww + 0.24, 0.035, wh + 0.24, trim);
            sill.addBasis(cc.clone().setZ(sillZ - 0.2), f.u, f.n, ww + 0.34, 0.16, 0.09, trim);
            if (s === 0 || r() < 0.4) lint.addBasis(cc.clone().setZ(sillZ + wh + 0.1), f.u, f.n, ww + 0.34, 0.12, 0.12, wallDk);
            if (hasShutters && !b.landmark) { for (const sd of [-1, 1]) shut.addBasis(cc.clone().addScaledVector(f.u, sd * (ww / 2 + 0.28)).setZ(sillZ), f.u, f.n, 0.5, 0.06, wh, accent); }
            st.windows++;
          }
        }
      }
    }
    const trimMat = lensify(toon()); const doorMat = lensify(toon());
    const parts: [Inst, THREE.BufferGeometry, THREE.Material, string, boolean][] = [
      [glass, unitY, glassMat, 'glass', false], [sur, unitY, trimMat, 'surround', false], [sill, unitY, trimMat, 'sill', false], [lint, unitY, trimMat, 'lintel', false],
      [door, unitY, doorMat, 'door', false], [doorSur, unitY, trimMat, 'door-surround', false], [step, unitY, trimMat, 'step', false], [band, unitY, trimMat, 'stone-band', false], [shut, unitY, doorMat, 'shutters', false], [bay, unitY, trimMat, 'bay', true],
    ];
    for (const [inst, geo, mat, name, cast] of parts) { const m = inst.build(geo, mat, cast, false, name); if (m) { (m.userData.fine = name !== 'glass' && name !== 'door'); g.add(m); } }
    st.tiles++;
    return g;
  }

  function setView(target: THREE.Vector3, viewW: number) {
    const show = viewW < 600; facades.visible = show;
    if (!show) return;
    const R = viewW * 0.8 + 60;
    for (const [key] of tiles) {
      const [tx, ty] = key.split(',').map(Number); const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
      const near = Math.abs(cx - target.x) < R + TILE && Math.abs(cy - target.y) < R + TILE;
      let t = tileGroups.get(key);
      if (near && !t) { t = buildTile(key); tileGroups.set(key, t); facades.add(t); }
      if (t) {
        t.visible = near;
        for (const m of t.children) m.visible = !(m.userData.fine) || viewW < 260;
      }
    }
  }
  group.add(facades);
  void detail; void tileGroups;
  // registry: which instances belong to which building (data colours, lens, picking)
  const parts: Part[][] = bds.map(() => []);
  const KIND = (n: string): Part['kind'] => (n === 'ridge-cap' || n === 'cornice' || n === 'parapet' || n === 'extcap' ? 'cap' : n.startsWith('roof') ? 'roof' : 'body');
  for (const mesh of meshes) { const ow = mesh.userData.owner as Int32Array; const k = KIND(mesh.name); for (let i = 0; i < ow.length; i++) parts[ow[i]].push({ mesh, i, kind: k }); }
  const extTopCache = new Map<number, number[]>();
  const extTop = (bi: number) => {
    if (!extMesh) return null; const o = extMesh.userData.extOwner as number[]; const st = extMesh.userData.extStart as number[]; const j = o.indexOf(bi); if (j < 0) return null;
    if (extTopCache.has(bi)) return extTopCache.get(bi)!; const nor = extMesh.geometry.getAttribute('normal'); const end = j + 1 < st.length ? st[j + 1] : nor.count; const out: number[] = [];
    for (let v = st[j]; v < end; v++) if (nor.getZ(v) > 0.9) out.push(v); extTopCache.set(bi, out); return out;
  };
  const pickMeshes = () => [...meshes.filter((m) => ['body', 'low', 'roof-gable', 'roof-hip', 'roof-slab'].includes(m.name)), ...(extMesh ? [extMesh] : [])];
  const ownerOf = (hit: THREE.Intersection): number => {
    if (hit.object === extMesh) { const st = extMesh!.userData.extStart as number[]; const o = extMesh!.userData.extOwner as number[]; const v = hit.face!.a; let lo = 0, hi = st.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st[mid] <= v) lo = mid; else hi = mid - 1; } return o[lo]; }
    const ow = hit.object.userData.owner as Int32Array | undefined; return ow && hit.instanceId !== undefined ? ow[hit.instanceId] : -1;
  };
  return { group, facades, bds, setView, roadDist, stats: () => st, partsOf: (bi) => parts[bi], extTop, extMesh: () => extMesh, pickables: pickMeshes, ownerOf };
}
