// Reads scene.json once into the shapes every other module needs:
// the road grid and its nodes, city blocks (kerb line + plot line), structure rectangles and facade faces.
import { hashStr } from './util.ts';

export type V2 = [number, number];
export interface Road { id: string; cls: 'avenue' | 'local'; width: number; pts: V2[]; vertical: boolean; mean: number; sidewalk: number }
export interface Face { mid: V2; n: V2; u: V2; len: number; street: boolean; party: boolean; roadDist: number; main: boolean }
export interface Struct {
  idx: number; id: string; arch: string; cls: string; levels: number; landmark: boolean;
  c: V2; ax: V2; ay: V2; L: number; W: number; yaw: number; faces: Face[]; seed: number;
  neighbours: number[]; distCentre: number;
}
export interface Block { i: number; j: number; kerb: V2[]; walk: V2[]; plot: V2[]; rect: [number, number, number, number]; structs: number[]; use: string; sw: [number, number, number, number] }
export interface Layout {
  roads: Road[]; vroads: Road[]; hroads: Road[]; nodes: V2[][]; blocks: Block[]; structs: Struct[];
  landuse: { id: string; kind: string; poly: V2[] }[]; trees: [number, number, string, number][];
  bounds: { x0: number; y0: number; x1: number; y1: number }; centre: V2; landmark: number;
}

const SIDEWALK = { avenue: 4.0, local: 2.4 };

function interp(pts: V2[], along: 0 | 1, v: number): number {
  // value of the other coordinate at coordinate `along` == v
  const o = along === 0 ? 1 : 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const lo = Math.min(a[along], b[along]), hi = Math.max(a[along], b[along]);
    if (v >= lo - 1e-6 && v <= hi + 1e-6) {
      const t = (v - a[along]) / ((b[along] - a[along]) || 1);
      return a[o] + (b[o] - a[o]) * t;
    }
  }
  return v < Math.min(pts[0][along], pts[pts.length - 1][along]) === (pts[0][along] < pts[pts.length - 1][along]) ? pts[0][o] : pts[pts.length - 1][o];
}
export const xAt = (r: Road, y: number) => interp(r.pts, 1, y);
export const yAt = (r: Road, x: number) => interp(r.pts, 0, x);

function cross(v: Road, h: Road): V2 {
  let x = v.mean, y = h.mean;
  for (let k = 0; k < 4; k++) { x = xAt(v, y); y = yAt(h, x); }
  return [x, y];
}

/** Polygon between two vertical and two horizontal roads, inset by `inset(road)` from each centreline, rounded corners. */
function blockPoly(vl: Road, vr: Road, hb: Road, ht: Road, inset: (r: Road) => number, radius: number): V2[] {
  const xl = (y: number) => xAt(vl, y) + inset(vl), xr = (y: number) => xAt(vr, y) - inset(vr);
  const yb = (x: number) => yAt(hb, x) + inset(hb), yt = (x: number) => yAt(ht, x) - inset(ht);
  const corner = (fx: (y: number) => number, fy: (x: number) => number): V2 => { let x = fx(0), y = 0; for (let k = 0; k < 5; k++) { y = fy(x); x = fx(y); } return [x, y]; };
  const bl = corner(xl, yb), br = corner(xr, yb), tr = corner(xr, yt), tl = corner(xl, yt);
  const between = (pts: V2[], along: 0 | 1, a: number, b: number, map: (p: V2) => V2) =>
    pts.filter((p) => p[along] > Math.min(a, b) + 1 && p[along] < Math.max(a, b) - 1).sort((p, q) => (a < b ? p[along] - q[along] : q[along] - p[along])).map(map);
  const raw: { p: V2; corner: boolean }[] = [];
  raw.push({ p: bl, corner: true });
  between(hb.pts, 0, bl[0], br[0], (p) => [p[0], yb(p[0])]).forEach((p) => raw.push({ p, corner: false }));
  raw.push({ p: br, corner: true });
  between(vr.pts, 1, br[1], tr[1], (p) => [xr(p[1]), p[1]]).forEach((p) => raw.push({ p, corner: false }));
  raw.push({ p: tr, corner: true });
  between(ht.pts, 0, tr[0], tl[0], (p) => [p[0], yt(p[0])]).forEach((p) => raw.push({ p, corner: false }));
  raw.push({ p: tl, corner: true });
  between(vl.pts, 1, tl[1], bl[1], (p) => [xl(p[1]), p[1]]).forEach((p) => raw.push({ p, corner: false }));
  const out: V2[] = [];
  for (let k = 0; k < raw.length; k++) {
    const { p, corner: c } = raw[k];
    if (!c || radius <= 0) { out.push(p); continue; }
    const prev = raw[(k - 1 + raw.length) % raw.length].p, next = raw[(k + 1) % raw.length].p;
    const dp = norm([prev[0] - p[0], prev[1] - p[1]]), dn = norm([next[0] - p[0], next[1] - p[1]]);
    const a: V2 = [p[0] + dp[0] * radius, p[1] + dp[1] * radius], b: V2 = [p[0] + dn[0] * radius, p[1] + dn[1] * radius];
    for (let s = 0; s <= 5; s++) {
      const t = s / 5, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * p[0] + t * t * b[0], u * u * a[1] + 2 * u * t * p[1] + t * t * b[1]]);
    }
  }
  return out;
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

export function buildLayout(scene: any): Layout {
  const roads: Road[] = scene.roads.map((r: any) => {
    const pts = r.pts as V2[];
    const dx = Math.abs(pts[pts.length - 1][0] - pts[0][0]), dy = Math.abs(pts[pts.length - 1][1] - pts[0][1]);
    const vertical = dy > dx;
    const mean = pts.reduce((s, p) => s + p[vertical ? 0 : 1], 0) / pts.length;
    const cls = r.class === 'avenue' ? 'avenue' : 'local';
    return { id: r.id, cls, width: r.width ?? (cls === 'avenue' ? 9 : 6), pts, vertical, mean, sidewalk: SIDEWALK[cls as 'avenue' | 'local'] };
  });
  const vroads = roads.filter((r) => r.vertical).sort((a, b) => a.mean - b.mean);
  const hroads = roads.filter((r) => !r.vertical).sort((a, b) => a.mean - b.mean);
  const nodes = vroads.map((v) => hroads.map((h) => cross(v, h)));
  // extend road ends to the outermost crossing roads (the constructor leaves 5 m gaps at the far edges)
  for (const v of vroads) { v.pts = v.pts.map((p) => [p[0], p[1]] as V2); v.pts[0] = [xAt(v, hroads[0].mean), hroads[0].mean]; v.pts[v.pts.length - 1] = [xAt(v, hroads[hroads.length - 1].mean), hroads[hroads.length - 1].mean]; }
  for (const h of hroads) { h.pts = h.pts.map((p) => [p[0], p[1]] as V2); h.pts[0] = [vroads[0].mean, yAt(h, vroads[0].mean)]; h.pts[h.pts.length - 1] = [vroads[vroads.length - 1].mean, yAt(h, vroads[vroads.length - 1].mean)]; }

  const landuse = (scene.landuse ?? []).map((l: any) => ({ id: l.id, kind: l.kind, poly: l.footprint as V2[] }));
  const blds: any[] = scene.structures?.length ? scene.structures : scene.buildings;

  // structures: oriented rectangles
  const sq = landuse.find((l: any) => l.kind === 'square');
  const centre: V2 = sq ? [sq.poly.reduce((s: number, p: V2) => s + p[0], 0) / sq.poly.length, sq.poly.reduce((s: number, p: V2) => s + p[1], 0) / sq.poly.length] : [scene.area.extent_m[0] / 2, scene.area.extent_m[1] / 2];
  const idIndex = new Map<string, number>(blds.map((b, i) => [b.id, i]));
  const structs: Struct[] = blds.map((b, idx) => {
    const f = b.footprint as V2[];
    const c: V2 = [f.reduce((s, p) => s + p[0], 0) / f.length, f.reduce((s, p) => s + p[1], 0) / f.length];
    const e0: V2 = [f[1][0] - f[0][0], f[1][1] - f[0][1]], e1: V2 = [f[2][0] - f[1][0], f[2][1] - f[1][1]];
    const l0 = Math.hypot(...e0), l1 = Math.hypot(...e1);
    const [L, W, ax] = l0 >= l1 ? [l0, l1, norm(e0)] : [l1, l0, norm(e1)];
    const ay: V2 = [-ax[1], ax[0]];
    const yaw = Math.atan2(ax[1], ax[0]);
    return {
      idx, id: b.id, arch: b.archetype, cls: b.economic_class, levels: Math.max(1, b.levels | 0), landmark: !!b.landmark,
      c, ax, ay, L, W, yaw, faces: [], seed: hashStr(b.id), neighbours: (b.neighbours ?? []).map((n: string) => idIndex.get(n)).filter((n: number | undefined) => n !== undefined),
      distCentre: Math.hypot(c[0] - centre[0], c[1] - centre[1]),
    };
  });

  // faces: outward normals, street / party classification
  const roadDist = (m: V2, n: V2) => {
    // distance from m to the edge of the nearest road on the side n points to
    let best = Infinity;
    if (Math.abs(n[0]) > Math.abs(n[1])) {
      for (const v of vroads) { const d = (xAt(v, m[1]) - m[0]) * Math.sign(n[0]); if (d > -1) best = Math.min(best, d - v.width / 2); }
    } else {
      for (const h of hroads) { const d = (yAt(h, m[0]) - m[1]) * Math.sign(n[1]); if (d > -1) best = Math.min(best, d - h.width / 2); }
    }
    return best;
  };
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
        return along > -1 && along < Math.max(o.L, o.W) / 2 + 2.5 && lat < len / 2 + 1;
      });
      const rd = roadDist(mid, n);
      return { mid, n, u, len, party, roadDist: rd, street: !party && rd < 9, main: false };
    });
    const streetFaces = s.faces.filter((f) => f.street);
    const best = (streetFaces.length ? streetFaces : s.faces.filter((f) => !f.party)).sort((a, b) => a.roadDist - b.roadDist)[0] ?? s.faces[0];
    best.main = true; best.street = true;
  }

  // blocks
  const blocks: Block[] = [];
  for (let i = 0; i < vroads.length - 1; i++) for (let j = 0; j < hroads.length - 1; j++) {
    const vl = vroads[i], vr = vroads[i + 1], hb = hroads[j], ht = hroads[j + 1];
    const kerb = blockPoly(vl, vr, hb, ht, (r) => r.width / 2, 4);
    const walk = blockPoly(vl, vr, hb, ht, (r) => r.width / 2 + 0.25, 3.75);
    const plot = blockPoly(vl, vr, hb, ht, (r) => r.width / 2 + r.sidewalk, 1.5);
    const xs = kerb.map((p) => p[0]), ys = kerb.map((p) => p[1]);
    const rect: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const ins = structs.filter((s) => inPoly(s.c, kerb)).map((s) => s.idx);
    const lu = landuse.find((l: any) => l.kind !== 'water' && inPoly(centroid(l.poly), kerb));
    let use = lu ? lu.kind : 'mixed';
    if (!lu && ins.length) {
      const counts: Record<string, number> = {};
      for (const k of ins) counts[structs[k].arch] = (counts[structs[k].arch] ?? 0) + 1;
      use = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
    blocks.push({ i, j, kerb, walk, plot, rect, structs: ins, use, sw: [vl.sidewalk, vr.sidewalk, hb.sidewalk, ht.sidewalk] });
  }

  const pad = 12;
  const bounds = { x0: vroads[0].mean - pad, y0: hroads[0].mean - pad, x1: vroads[vroads.length - 1].mean + pad, y1: hroads[hroads.length - 1].mean + pad };
  const landmark = structs.findIndex((s) => s.landmark);
  return { roads, vroads, hroads, nodes, blocks, structs, landuse, trees: scene.trees ?? [], bounds, centre, landmark };
}
export const centroid = (poly: V2[]): V2 => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
