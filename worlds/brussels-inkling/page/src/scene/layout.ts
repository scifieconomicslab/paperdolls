// Reads scene.json once into the shapes every other module needs, for a curvilinear OSM city:
// roads (as fetched), oriented structure rectangles (minimum-area), facade faces with a road
// distance against every road, landuse and trees. There is no global grid here (Jette radiates
// from the centre); nothing downstream may assume vertical/horizontal roads.
import { hashStr } from './util.ts';

export type V2 = [number, number];
export interface Road { id: string; cls: 'avenue' | 'local' | 'pedestrian' | 'cycle' | 'tramway'; width: number; pts: V2[]; tram: boolean; name: string }
export interface Face { mid: V2; n: V2; u: V2; len: number; street: boolean; party: boolean; roadDist: number; main: boolean }
export interface Struct {
  idx: number; id: string; arch: string; cls: string; levels: number; landmark: boolean;
  c: V2; ax: V2; ay: V2; L: number; W: number; yaw: number; faces: Face[]; seed: number;
  neighbours: number[]; distCentre: number;
}
export interface Layout {
  roads: Road[]; structs: Struct[];
  landuse: { id: string; kind: string; poly: V2[] }[]; trees: [number, number, string, number][];
  bounds: { x0: number; y0: number; x1: number; y1: number }; centre: V2; landmark: number;
  boundary: V2[] | null;
}

export const norm = (v: V2): V2 => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
export function inPoly(p: V2, poly: V2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export const centroid = (poly: V2[]): V2 => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];

/** distance point -> segment */
function segDist(p: V2, a: V2, b: V2): number {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
}
/** distance point -> polyline */
function polyDist(p: V2, pts: V2[]): number {
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) { const d = segDist(p, pts[k], pts[k + 1]); if (d < best) best = d; }
  return best;
}

/** minimum-area bounding rectangle of a polygon: returns centre, axis unit vectors, lengths, yaw */
function minAreaRect(f: V2[]) {
  let bestArea = Infinity, bestU: V2 = [1, 0], bestL = 1, bestW = 1;
  const n = f.length;
  for (let e = 0; e < n; e++) {
    const a = f[e], b = f[(e + 1) % n];
    const u = norm([b[0] - a[0], b[1] - a[1]]);
    const v: V2 = [-u[1], u[0]];
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of f) {
      const pu = p[0] * u[0] + p[1] * u[1], pv = p[0] * v[0] + p[1] * v[1];
      if (pu < minU) minU = pu; if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv; if (pv > maxV) maxV = pv;
    }
    const L = maxU - minU, W = maxV - minV, A = L * W;
    if (A < bestArea) { bestArea = A; bestU = u; bestL = L; bestW = W; }
  }
  // keep the long axis as ax
  if (bestW > bestL) { const t = bestL; bestL = bestW; bestW = t; const u2: V2 = [-bestU[1], bestU[0]]; bestU = u2; }
  // centre: reproject with the final axis
  const v: V2 = [-bestU[1], bestU[0]];
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of f) {
    const pu = p[0] * bestU[0] + p[1] * bestU[1], pv = p[0] * v[0] + p[1] * v[1];
    if (pu < minU) minU = pu; if (pu > maxU) maxU = pu;
    if (pv < minV) minV = pv; if (pv > maxV) maxV = pv;
  }
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  const c: V2 = [bestU[0] * cu + v[0] * cv, bestU[1] * cu + v[1] * cv];
  const ax = bestU;
  return { c, ax, ay: [-ax[1], ax[0]] as V2, L: Math.max(bestL, bestW), W: Math.min(bestL, bestW), yaw: Math.atan2(ax[1], ax[0]) };
}

/** archetype resolution for the ingest's `auto` (auto = the region decides). Documented in the world record. */
const resolveArch = (b: any): string => {
  const a = b.archetype;
  if (a && a !== 'auto') return a;
  const lvl = Math.max(1, b.levels | 0), area = b.area ?? 80;
  if (lvl >= 8) return 'tower';
  if (lvl >= 4 || area >= 350) return 'block';
  if (area < 55) return 'shed';
  return hashStr(String(b.id ?? '')) % 10 < 6 ? 'terrace' : 'villa';
};

/** segment a->b vs segment c->d intersection point (or null) */
function segSeg(a: V2, b: V2, c: V2, d: V2): V2 | null {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}
/** split a polyline into the parts inside the polygon (roads clipped at the commune boundary) */
function clipPolyline(pts: V2[], poly: V2[]): V2[][] {
  if (pts.length < 2) return [pts];
  const inside = pts.map((p) => inPoly(p, poly));
  const out: V2[][] = [];
  let cur: V2[] = [];
  const cutPoint = (a: V2, b: V2): V2 | null => {
    let best: V2 | null = null, bestD = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const hit = segSeg(a, b, poly[i], poly[(i + 1) % poly.length]);
      if (hit) { const d = Math.hypot(hit[0] - a[0], hit[1] - a[1]); if (d < bestD) { bestD = d; best = hit; } }
    }
    return best;
  };
  for (let i = 0; i < pts.length; i++) {
    if (inside[i]) {
      if (i > 0 && !inside[i - 1]) { const ix = cutPoint(pts[i - 1], pts[i]); if (ix) cur.push(ix); }
      cur.push(pts[i]);
    } else if (i > 0 && inside[i - 1]) {
      const ix = cutPoint(pts[i - 1], pts[i]); if (ix) cur.push(ix);
      if (cur.length >= 2) out.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

export function buildLayout(scene: any): Layout {
  const boundary: V2[] | null = Array.isArray(scene._boundary) && scene._boundary.length > 8 ? scene._boundary as V2[] : null;
  const roads: Road[] = scene.roads.map((r: any) => {
    const pts = r.pts as V2[];
    const cls = (['avenue', 'local', 'pedestrian', 'cycle', 'tramway'].includes(r.class) ? r.class : r.class === 'tram' ? 'tramway' : 'local') as Road['cls'];
    const width = r.width ?? (cls === 'avenue' ? 9 : cls === 'tramway' ? 3 : cls === 'cycle' ? 2.5 : cls === 'pedestrian' ? 3.5 : 6);
    return { id: r.id, cls, width, pts, tram: !!r.tram, name: r.name ?? '' };
  });

  if (boundary) {
    const clipped: Road[] = [];
    for (const rd of roads) {
      for (const pts of clipPolyline(rd.pts, boundary)) clipped.push({ ...rd, pts });
    }
    roads.length = 0; roads.push(...clipped);
  }

  const landuse = (scene.landuse ?? []).map((l: any) => ({ id: l.id, kind: l.kind, poly: l.footprint as V2[] }));
  const blds: any[] = scene.structures?.length ? scene.structures : scene.buildings;

  // the opening-shot centre: the largest square in the data (Jette's market square), else the extent centre
  const squares = landuse.filter((l: any) => l.kind === 'square');
  const sqArea = (p: V2[]) => Math.abs(p.reduce((s: number, a: V2, j: number) => { const b = p[(j + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
  const squaresByArea = squares.slice().sort((a: any, b: any) => sqArea(b.poly) - sqArea(a.poly));
  const centre: V2 = squaresByArea.length ? centroid(squaresByArea[0].poly) : [0, 0];

  // the landmark: the UZ Brussel university-hospital block (named UZ-* in the data), else the largest footprint
  const idIndex = new Map<string, number>(blds.map((b, i) => [b.id, i]));
  let landmark = blds.findIndex((b) => typeof b?.osm?.name === 'string' && b.osm.name.startsWith('UZ-'));
  if (landmark < 0) { let maxA = 0; landmark = -1; blds.forEach((b, i) => { const a = b.area ?? 0; if (a > maxA) { maxA = a; landmark = i; } }); }

  const structs: Struct[] = blds.map((b, idx) => {
    const f = b.footprint as V2[];
    const rect = minAreaRect(f);
    const c = rect.c;
    return {
      idx, id: b.id, arch: resolveArch(b), cls: b.economic_class, levels: Math.max(1, b.levels | 0), landmark: idx === landmark,
      c, ax: rect.ax, ay: rect.ay, L: rect.L, W: rect.W, yaw: rect.yaw, faces: [], seed: hashStr(b.id),
      neighbours: (b.neighbours ?? []).map((n: string) => idIndex.get(n)).filter((n: number | undefined) => n !== undefined),
      distCentre: Math.hypot(c[0] - centre[0], c[1] - centre[1]),
    };
  });

  // road bounding boxes for a cheap prefilter
  const roadBoxes = roads.map((rd) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of rd.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return { x0: x0 - 12, y0: y0 - 12, x1: x1 + 12, y1: y1 + 12, w: rd.width / 2 };
  });
  // faces: outward normals; party from neighbour rectangles; road distance against every road
  for (const s of structs) {
    const dirs: [V2, number][] = [[s.ay, s.L], [[-s.ay[0], -s.ay[1]], s.L], [s.ax, s.W], [[-s.ax[0], -s.ax[1]], s.W]];
    s.faces = dirs.map(([n, len]) => {
      const off = len === s.L ? s.W / 2 : s.L / 2;
      const mid: V2 = [s.c[0] + n[0] * off, s.c[1] + n[1] * off];
      const u: V2 = [n[1], -n[0]];
      const party = s.neighbours.some((k) => {
        const o = structs[k];
        const dx = o.c[0] - mid[0], dy = o.c[1] - mid[1];
        const along = dx * n[0] + dy * n[1];
        const lat = Math.abs(dx * u[0] + dy * u[1]);
        return along > -1 && along < Math.max(o.L, o.W) / 2 + 1.0 && lat < len / 2 + 0.6;
      });
      let bestRd = Infinity;
      for (let ri = 0; ri < roads.length; ri++) {
        const rb = roadBoxes[ri];
        const dx = Math.max(rb.x0 - mid[0], 0, mid[0] - rb.x1), dy = Math.max(rb.y0 - mid[1], 0, mid[1] - rb.y1);
        const bboxD = Math.hypot(dx, dy) - rb.w;
        if (bboxD >= bestRd) continue;
        const d = polyDist(mid, roads[ri].pts) - roads[ri].width / 2;
        if (d < bestRd) bestRd = d;
      }
      const rd = bestRd;
      return { mid, n, u, len, party, roadDist: rd, street: !party && rd < 9, main: false };
    });
    const streetFaces = s.faces.filter((f) => f.street);
    const best = (streetFaces.length ? streetFaces : s.faces.filter((f) => !f.party)).sort((a, b) => a.roadDist - b.roadDist)[0] ?? s.faces[0];
    best.main = true; best.street = true;
  }

  // bounds from every point in the data, plus a pad for the plinth
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const eat = (p: V2) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const st of blds) for (const p of st.footprint as V2[]) eat(p);
  for (const r of roads) for (const p of r.pts) eat(p);
  for (const l of landuse) for (const p of l.poly) eat(p);
  let bounds: { x0: number; y0: number; x1: number; y1: number };
  if (boundary) {
    const bx = boundary.map((p) => p[0]), by = boundary.map((p) => p[1]);
    bounds = { x0: Math.min(...bx) - 6, y0: Math.min(...by) - 6, x1: Math.max(...bx) + 6, y1: Math.max(...by) + 6 };
  } else {
    const pad = 12;
    bounds = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }
  return { roads, structs, landuse, trees: scene.trees ?? [], bounds, centre, landmark, boundary };
}

/** arclength table for a polyline */
export function arclength(pts: V2[]): number[] {
  const acc = [0];
  for (let k = 1; k < pts.length; k++) acc.push(acc[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return acc;
}
export function pointAtLength(pts: V2[], acc: number[], s: number): { p: V2; n: V2; yaw: number } {
  const total = acc[acc.length - 1];
  s = Math.max(0, Math.min(total - 1e-6, s));
  let k = 1;
  while (k < acc.length - 1 && acc[k] < s) k++;
  const a = pts[k - 1], b = pts[k], seg = acc[k] - acc[k - 1] || 1;
  const t = (s - acc[k - 1]) / seg;
  const d: V2 = [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg];
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], n: [-d[1], d[0]], yaw: Math.atan2(d[1], d[0]) };
}
