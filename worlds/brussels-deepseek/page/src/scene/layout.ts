// Reads scene.composed.json once into the shapes the scene modules need:
// oriented masses on real footprints, road polylines with their widths, land use, trees,
// and the two camera subjects (the densest residential cell and a nearby avenue).
import { hashStr } from './util.ts';

export type V2 = [number, number];
export interface Road {
  id: string; cls: string; width: number; sidewalk: number; pts: V2[]; tram: boolean; cycle: boolean; name: string | null;
}
export interface Face { mid: V2; n: V2; u: V2; len: number; street: boolean; main: boolean; roadDist: number }
export interface Struct {
  idx: number; id: string; cls: string; arch: string; levels: number; height: number; landmark: boolean;
  c: V2; ax: V2; ay: V2; L: number; W: number; yaw: number; footprint: V2[]; faces: Face[]; seed: number;
  addr: string | null; residential: string; rectangularity: number;
}
export interface Layout {
  roads: Road[]; structs: Struct[]; landuse: { id: string; kind: string; poly: V2[] }[]; trees: [number, number, string, number][];
  bounds: { x0: number; y0: number; x1: number; y1: number }; centre: V2; landmark: number;
  focus: V2; streetTarget: V2; streetYaw: number; roadGrid: Map<string, number[]>;
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

export const SIDEWALK: Record<string, number> = { avenue: 4.2, local: 2.8, pedestrian: 0, cycle: 0, tramway: 0 };
const ROAD_WIDTH: Record<string, number> = { avenue: 10, local: 6, pedestrian: 4, cycle: 3, tramway: 2.6 };

function hull(points: V2[]): V2[] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: V2[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper: V2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function polyArea(poly: V2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

/** Minimum-area rectangle of a footprint (rotating calipers over the convex hull). */
export function minAreaRect(poly: V2[]) {
  const h = hull(poly);
  if (h.length < 3) {
    const c = centroid(poly); return { c, ax: [1, 0] as V2, ay: [0, 1] as V2, L: 1, W: 1 };
  }
  let best = { area: Infinity, c: centroid(poly), ax: [1, 0] as V2, ay: [0, 1] as V2, L: 1, W: 1 };
  for (let i = 0; i < h.length; i++) {
    const p0 = h[i], p1 = h[(i + 1) % h.length];
    const e = norm([p1[0] - p0[0], p1[1] - p0[1]]);
    const n: V2 = [-e[1], e[0]];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of h) {
      const u = p[0] * e[0] + p[1] * e[1], v = p[0] * n[0] + p[1] * n[1];
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      const c: V2 = [uc * e[0] + vc * n[0], uc * e[1] + vc * n[1]];
      best = { area, c, ax: e, ay: n, L: u1 - u0, W: v1 - v0 };
    }
  }
  return best;
}

export function buildLayout(scene: any): Layout {
  const boundary: V2[] | null = Array.isArray(scene.area?.boundary) && scene.area.boundary.length > 3 ? scene.area.boundary : null;
  const inside = (p: V2) => !boundary || inPoly(p, boundary);
  const clipRuns = (pts: V2[]): V2[][] => {
    const runs: V2[][] = [];
    let run: V2[] = [];
    for (const p of pts) {
      if (inside(p)) run.push(p);
      else { if (run.length >= 2) runs.push(run); run = []; }
    }
    if (run.length >= 2) runs.push(run);
    return runs;
  };
  const rawRoads: any[] = [];
  for (const r of scene.roads ?? []) {
    for (const run of clipRuns((r.pts as V2[]).map((p) => [p[0], p[1]] as V2))) rawRoads.push({ ...r, pts: run });
  }
  const roads: Road[] = rawRoads.map((r: any) => {
    const cls = String(r.class ?? 'local');
    return {
      id: r.id, cls, width: r.width ?? ROAD_WIDTH[cls] ?? 6, sidewalk: SIDEWALK[cls] ?? 2.2,
      pts: (r.pts as V2[]).map((p) => [p[0], p[1]] as V2), tram: !!r.tram, cycle: cls === 'cycle' || !!r.cycle, name: r.name ?? null,
    };
  });

  // spatial grid of road segments for face classification (50 m cells)
  const CELL = 50;
  const roadGrid = new Map<string, number[]>();
  const segKey = (i: number, j: number) => i + ':' + j;
  const segs: { a: V2; b: V2; w: number }[] = [];
  for (const rd of roads) for (let k = 0; k < rd.pts.length - 1; k++) {
    const a = rd.pts[k], b = rd.pts[k + 1];
    const si = segs.length; segs.push({ a, b, w: rd.width });
    const minx = Math.min(a[0], b[0]) - 20, maxx = Math.max(a[0], b[0]) + 20;
    const miny = Math.min(a[1], b[1]) - 20, maxy = Math.max(a[1], b[1]) + 20;
    for (let i = Math.floor(minx / CELL); i <= Math.floor(maxx / CELL); i++)
      for (let j = Math.floor(miny / CELL); j <= Math.floor(maxy / CELL); j++) {
        const key = segKey(i, j); const list = roadGrid.get(key); if (list) list.push(si); else roadGrid.set(key, [si]);
      }
  }
  const distToRoad = (p: V2): number => {
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
    let best = Infinity;
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
      for (const si of roadGrid.get(segKey(i, j)) ?? []) {
        const { a, b, w } = segs[si];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
        const d = Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)) - w / 2;
        if (d < best) best = d;
      }
    }
    return best;
  };

  const blds: any[] = scene.structures?.length ? scene.structures : scene.buildings;
  const structs: Struct[] = blds.map((b: any, idx: number) => {
    const footprint = (b.footprint as V2[]).map((p) => [p[0], p[1]] as V2);
    const rect = minAreaRect(footprint);
    const ax = rect.L >= rect.W ? rect.ax : rect.ay;
    const ay: V2 = [-ax[1], ax[0]];
    const L = Math.max(rect.L, rect.W), W = Math.min(rect.L, rect.W);
    const yaw = Math.atan2(ax[1], ax[0]);
    const levels = Math.max(1, Math.round(Number(b.levels) || (Number(b.height) ? Number(b.height) / 3.1 : 2)));
    const height = Number(b.height) || levels * 3.1;
    const rectArea = rect.L * rect.W;
    const rectangularity = rectArea > 0 ? polyArea(footprint) / rectArea : 1;
    return {
      idx, id: String(b.id), cls: String(b.economic_class ?? 'other'),
      arch: String(b.archetype && b.archetype !== 'auto' ? b.archetype : inferArch(b)),
      levels, height, landmark: !!b.landmark, c: rect.c, ax, ay, L, W, yaw, footprint,
      faces: [], seed: hashStr(String(b.id)), addr: b.osm?.name ?? null,
      residential: String(b.residential ?? 'other'), rectangularity,
    };
  });

  // faces: four sides of the oriented rectangle, with outward normals; street = close to a road
  for (const s of structs) {
    const dirs: [V2, number][] = [[s.ay, s.L], [[-s.ay[0], -s.ay[1]], s.L], [s.ax, s.W], [[-s.ax[0], -s.ax[1]], s.W]];
    s.faces = dirs.map(([n, len]) => {
      const off = len === s.L ? s.W / 2 : s.L / 2;
      const mid: V2 = [s.c[0] + n[0] * off, s.c[1] + n[1] * off];
      const u: V2 = [n[1], -n[0]];
      const rd = distToRoad(mid);
      return { mid, n, u, len, roadDist: rd, street: rd < 11, main: false };
    });
    const street = s.faces.filter((f) => f.street).sort((a, b) => a.roadDist - b.roadDist);
    const best = street[0] ?? s.faces.slice().sort((a, b) => a.roadDist - b.roadDist)[0];
    best.main = true; best.street = true;
  }

  const landuse = (scene.landuse ?? []).map((l: any) => ({ id: l.id, kind: String(l.kind), poly: l.footprint as V2[] }));
  const trees = (scene.trees ?? []).filter((t: any) => inside([t[0], t[1]])).map((t: any) => [t[0], t[1], t[2] ?? null, t[3] ?? 1] as [number, number, string, number]);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const outline: V2[] | null = boundary;
  const framePts: V2[] = outline ?? structs.flatMap((s) => s.footprint);
  for (const p of framePts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const pad = 14;
  const bounds = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  const centre: V2 = [(bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2];

  // the densest 200 m cell of dwelling buildings is the opening subject
  const cells = new Map<string, { n: number; x: number; y: number }>();
  for (const s of structs) {
    if (!(s.residential === 'residential' || s.residential === 'probable')) continue;
    const key = Math.floor(s.c[0] / 200) + ':' + Math.floor(s.c[1] / 200);
    const e = cells.get(key) ?? { n: 0, x: 0, y: 0 };
    e.n++; e.x += s.c[0]; e.y += s.c[1]; cells.set(key, e);
  }
  let focus: V2 = centre;
  const best = [...cells.values()].sort((a, b) => b.n - a.n)[0];
  if (best) focus = [best.x / best.n, best.y / best.n];

  // the street frame: an avenue segment near the focus with buildings on BOTH sides,
  // so the shot is a street inside the fabric, never the municipal edge
  let streetTarget: V2 = focus, streetYaw = 0, bestScore = -Infinity;
  for (const rd of roads) {
    if (rd.cls !== 'avenue') continue;
    for (let k = 0; k < rd.pts.length - 1; k++) {
      const a = rd.pts[k], b = rd.pts[k + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 8) continue;
      const m: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const dFocus = Math.hypot(m[0] - focus[0], m[1] - focus[1]);
      if (dFocus > 600) continue;
      const nx = -dy / len, ny = dx / len;
      let left = 0, right = 0, total = 0;
      for (const s of structs) {
        const ddx = s.c[0] - m[0], ddy = s.c[1] - m[1];
        if (ddx * ddx + ddy * ddy > 55 * 55) continue;
        total++;
        const side = ddx * nx + ddy * ny;
        if (side > 3) left++; else if (side < -3) right++;
      }
      const score = Math.min(left, right) * 3 + total - dFocus * 0.01;
      if (score > bestScore) { bestScore = score; streetTarget = m; streetYaw = Math.atan2(dy, dx); }
    }
  }
  const landmark = structs.findIndex((s) => s.landmark);
  return { roads, structs, landuse, trees, bounds, centre, landmark, focus, streetTarget, streetYaw, roadGrid };
}

function inferArch(b: any): string {
  const cls = String(b.economic_class ?? '');
  const levels = Number(b.levels) || 2;
  if (cls === 'house' || cls === 'detached' || cls === 'terrace' || cls === 'bungalow') return 'villa';
  if (cls === 'apartments' || cls === 'residential') return levels >= 5 ? 'block' : 'terrace';
  if (cls === 'retail' || cls === 'mixed_use' || cls === 'supermarket') return 'shophouse';
  if (cls === 'office' || cls === 'government' || cls === 'civic' || cls === 'hospital' || cls === 'school' || cls === 'university') return 'block';
  if (cls === 'outbuilding' || cls === 'garage' || cls === 'shed' || cls === 'warehouse' || cls === 'industrial') return 'shed';
  return levels >= 7 ? 'tower' : levels >= 4 ? 'block' : 'terrace';
}
