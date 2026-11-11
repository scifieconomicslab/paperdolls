"""Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
"""
"""Plain-Python geometry: a local metric frame, polygons, convex hulls, minimum-area rectangles."""
import math

R_EARTH = 6371008.8
DEG = math.pi / 180.0


class LocalFrame:
    """A local tangent plane around (lat0, lon0): x east, y south (screen convention), then rotated by -rot_deg.

    rot_deg is the dominant street direction found in the unrotated frame; rotating by its negative puts that direction on
    the x axis, so most buildings land on the axes the renderer's building assets need.
    """

    def __init__(self, lat0, lon0, rot_deg=0.0):
        self.lat0, self.lon0, self.rot_deg = lat0, lon0, rot_deg
        self.kx = R_EARTH * math.cos(lat0 * DEG) * DEG
        self.ky = R_EARTH * DEG
        a = rot_deg * DEG
        self.c, self.s = math.cos(a), math.sin(a)

    def xy(self, lat, lon):
        x = (lon - self.lon0) * self.kx
        y = -(lat - self.lat0) * self.ky
        return (x * self.c + y * self.s, -x * self.s + y * self.c)

    def latlon(self, xr, yr):
        x = xr * self.c - yr * self.s
        y = xr * self.s + yr * self.c
        return (self.lat0 - y / self.ky, self.lon0 + x / self.kx)


def ring_area(ring):
    s = 0.0
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return abs(s) / 2.0


def ring_centroid(ring):
    """Area-weighted centroid; falls back to the vertex mean for a degenerate ring."""
    a = cx = cy = 0.0
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        w = x0 * y1 - x1 * y0
        a += w
        cx += (x0 + x1) * w
        cy += (y0 + y1) * w
    if abs(a) < 1e-9:
        return (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)
    return (cx / (3 * a), cy / (3 * a))


def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-18) + xi:
            inside = not inside
        j = i
    return inside


def convex_hull(pts):
    p = sorted(set((float(a), float(b)) for a, b in pts))
    if len(p) <= 2:
        return p

    def cr(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo = []
    for q in p:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], q) <= 0:
            lo.pop()
        lo.append(q)
    up = []
    for q in reversed(p):
        while len(up) >= 2 and cr(up[-2], up[-1], q) <= 0:
            up.pop()
        up.append(q)
    return lo[:-1] + up[:-1]


def min_rect(pts):
    """Minimum-area bounding rectangle: (theta radians along its first side, a, b, area), or None if degenerate."""
    hull = convex_hull(pts)
    n = len(hull)
    if n < 3:
        return None
    best = None
    for i in range(n):
        a, b = hull[i], hull[(i + 1) % n]
        th = math.atan2(b[1] - a[1], b[0] - a[0])
        c, s = math.cos(-th), math.sin(-th)
        xs = [p[0] * c - p[1] * s for p in hull]
        ys = [p[0] * s + p[1] * c for p in hull]
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        if best is None or w * h < best[3]:
            best = (th, w, h, w * h)
    return best


def axis_deviation_deg(theta_rad, rot_deg=0.0):
    """How far a direction is from the nearest axis once the frame is rotated by -rot_deg (0 to 45 degrees)."""
    m = (((theta_rad / DEG) - rot_deg) % 90.0 + 90.0) % 90.0
    return min(m, 90.0 - m)


def dominant_angle(segments):
    """Dominant street direction mod 90 degrees, from (x0, y0, x1, y1) segments weighted by length.

    Directions are doubled twice (4 theta) so that a grid and its 90-degree rotation vote together. Returns
    (angle in degrees within (-45, 45], strength in 0..1); strength near 1 means one clean grid.
    """
    sx = sy = tot = 0.0
    for x0, y0, x1, y1 in segments:
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        if L < 1e-6:
            continue
        th = math.atan2(dy, dx)
        sx += L * math.cos(4 * th)
        sy += L * math.sin(4 * th)
        tot += L
    if tot == 0:
        return 0.0, 0.0
    return math.atan2(sy, sx) / 4.0 / DEG, math.hypot(sx, sy) / tot


def simplify_ring(ring, tol=0.05):
    """Drop repeated points and points that lie on the line between their neighbours (within tol metres)."""
    out = []
    for p in ring:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 1e-6:
            out.append(p)
    if len(out) > 1 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < 1e-6:
        out.pop()
    changed = True
    while changed and len(out) > 3:
        changed = False
        for i in range(len(out)):
            a, b, c = out[i - 1], out[i], out[(i + 1) % len(out)]
            L = math.hypot(c[0] - a[0], c[1] - a[1]) or 1e-9
            d = abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / L
            if d < tol:
                out.pop(i)
                changed = True
                break
    return out


def resample_line(pts, spacing):
    """Points along a polyline every `spacing` metres, centred so the ends are not favoured."""
    seg = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:])]
    total = sum(seg)
    if total < 1e-6:
        return [pts[0]]
    n = max(1, int(total // spacing))
    start = (total - (n - 1) * spacing) / 2.0 if n > 1 else total / 2.0
    out, d, i, acc = [], start, 0, 0.0
    while d <= total + 1e-9 and len(out) < n:
        while i < len(seg) - 1 and acc + seg[i] < d:
            acc += seg[i]
            i += 1
        t = (d - acc) / (seg[i] or 1e-9)
        out.append((pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t))
        d += spacing
    return out


def _orient(ax, ay, bx, by, cx, cy):
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def ring_self_crossings(ring):
    """How many pairs of edges of a closed ring cross each other properly (an X, not a shared corner or a touch). 0 for a simple polygon.
    Edges that share a vertex are skipped; collinear overlaps and touches are not counted, so only a clear bowtie or figure of eight is reported."""
    n = len(ring)
    if n < 4:
        return 0
    edges = [(ring[i], ring[(i + 1) % n]) for i in range(n)]
    boxes = [(min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])) for a, b in edges]
    count = 0
    for i in range(n):
        a, b = edges[i]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            bi, bj = boxes[i], boxes[j]
            if bi[2] < bj[0] or bj[2] < bi[0] or bi[3] < bj[1] or bj[3] < bi[1]:
                continue
            c, d = edges[j]
            d1, d2 = _orient(*c, *d, *a), _orient(*c, *d, *b)
            d3, d4 = _orient(*a, *b, *c), _orient(*a, *b, *d)
            if d1 != 0 and d2 != 0 and d3 != 0 and d4 != 0 and (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0):
                count += 1
    return count
