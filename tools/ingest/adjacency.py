"""Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
"""
"""Which buildings touch or nearly touch. Footprints in metres; a spatial grid keeps it near-linear in the number of buildings."""
import math

NEIGHBOUR_M = 1.0       # edge-to-edge distance at or under which two buildings are neighbours. Terraced houses in OSM touch, or sit 0.1 to 0.5 m apart.
CELL_M = 12.0


def _seg_dist2(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    qx, qy = ax + dx * t, ay + dy * t
    return (px - qx) ** 2 + (py - qy) ** 2


def _cross(ax, ay, bx, by, cx, cy):
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def _segs_cross(a, b, c, d):
    d1, d2 = _cross(*c, *d, *a), _cross(*c, *d, *b)
    d3, d4 = _cross(*a, *b, *c), _cross(*a, *b, *d)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)) and d1 != 0 and d2 != 0 and d3 != 0 and d4 != 0


def _inside(pt, ring):
    x, y, ins = pt[0], pt[1], False
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            ins = not ins
    return ins


def within(ra, rb, r):
    """True when the two rings overlap or come within r metres of each other."""
    r2 = r * r
    na, nb = len(ra), len(rb)
    for i in range(na):
        ax, ay = ra[i]
        a2 = ra[(i + 1) % na]
        for j in range(nb):
            bx, by = rb[j]
            b2 = rb[(j + 1) % nb]
            if _seg_dist2(ax, ay, bx, by, *b2) <= r2 or _seg_dist2(bx, by, ax, ay, *a2) <= r2 or _segs_cross((ax, ay), a2, (bx, by), b2):
                return True
    return _inside(ra[0], rb) or _inside(rb[0], ra)         # one inside the other


def neighbours(rings, r=NEIGHBOUR_M, cell=CELL_M):
    """rings: list of [(x, y), ...]. Returns a list of sorted index lists, symmetric: j in out[i] iff i in out[j]."""
    grid, boxes = {}, []
    for i, ring in enumerate(rings):
        xs, ys = [p[0] for p in ring], [p[1] for p in ring]
        bx = (min(xs) - r, min(ys) - r, max(xs) + r, max(ys) + r)
        boxes.append(bx)
        for gx in range(int(math.floor(bx[0] / cell)), int(math.floor(bx[2] / cell)) + 1):
            for gy in range(int(math.floor(bx[1] / cell)), int(math.floor(bx[3] / cell)) + 1):
                grid.setdefault((gx, gy), []).append(i)
    out = [set() for _ in rings]
    seen = set()
    for members in grid.values():
        for a in range(len(members)):
            i = members[a]
            for b in range(a + 1, len(members)):
                j = members[b]
                if (i, j) in seen:
                    continue
                seen.add((i, j))
                bi, bj = boxes[i], boxes[j]
                if bi[2] < bj[0] or bj[2] < bi[0] or bi[3] < bj[1] or bj[3] < bi[1]:
                    continue
                if within(rings[i], rings[j], r):
                    out[i].add(j)
                    out[j].add(i)
    return [sorted(s) for s in out]
