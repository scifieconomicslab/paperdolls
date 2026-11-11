import * as THREE from 'three';

export function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash32(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export const hash01 = (s: string) => hash32(s) / 4294967296;

export type V2 = [number, number];
export interface Rect { cx: number; cy: number; ang: number; L: number; W: number; fill: number }

function hull(pts: V2[]): V2[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [], up: V2[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
export function polyArea(r: V2[]): number { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }

/** minimum-area oriented rectangle of the convex hull; L >= W, ang along L */
export function minAreaRect(fp: V2[]): Rect {
  const h = hull(fp);
  let best: Rect | null = null; let bestA = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const c = Math.cos(ang), s = Math.sin(ang);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of h) { const x = p[0] * c + p[1] * s, y = -p[0] * s + p[1] * c; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const A = (x1 - x0) * (y1 - y0);
    if (A < bestA) {
      bestA = A; const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      let L = x1 - x0, W = y1 - y0, an = ang;
      if (W > L) { [L, W] = [W, L]; an += Math.PI / 2; }
      best = { cx: mx * c - my * s, cy: mx * s + my * c, ang: an, L, W, fill: 0 };
    }
  }
  best = best ?? { cx: fp[0][0], cy: fp[0][1], ang: 0, L: 1, W: 1, fill: 0 };
  best.fill = Math.abs(polyArea(fp)) / (best.L * best.W);
  return best;
}

export function pointInPoly(x: number, y: number, r: V2[]): boolean {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins;
  }
  return ins;
}

/** seeded value noise on a canvas, returns a tileable texture; amp = lightness modulation */
export function noiseTexture(seed: number, size = 512, amp = 0.06, cells = 24, base = 0.5): THREE.CanvasTexture {
  const rnd = mulberry32(seed);
  const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rnd();
  const g2 = new Float32Array(6 * 6); for (let i = 0; i < g2.length; i++) g2[i] = rnd();
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const samp = (arr: Float32Array, n: number, x: number, y: number) => {
    const fx = x * n, fy = y * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = smooth(fx - ix), ty = smooth(fy - iy);
    const a = arr[(iy % n) * n + (ix % n)], b = arr[(iy % n) * n + ((ix + 1) % n)], c = arr[((iy + 1) % n) * n + (ix % n)], d = arr[((iy + 1) % n) * n + ((ix + 1) % n)];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = (samp(g, cells, x / size, y / size) - 0.5) * 2 * 0.7 + (samp(g2, 6, x / size, y / size) - 0.5) * 2 * 0.3 + (rnd() - 0.5) * 0.25;
    const v = Math.max(0, Math.min(255, Math.round(255 * (base + n * amp))));
    const k = (y * size + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t;
}

/** set uv = world xy / scale so a world-anchored noise texture tiles every `scale` metres */
export function worldUV(g: THREE.BufferGeometry, scale: number) {
  const p = g.getAttribute('position'); const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / scale; uv[i * 2 + 1] = p.getY(i) / scale; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export function pickW<T extends { w: number }>(arr: T[], r: number): T { let t = 0; for (const a of arr) t += a.w; let x = r * t; for (const a of arr) { x -= a.w; if (x <= 0) return a; } return arr[arr.length - 1]; }
