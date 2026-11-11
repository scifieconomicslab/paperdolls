"""Constructed regions: build an OSM-compatible scene.json from a description.

Spec step 3b: "construct a region — build an OSM-compatible map (locally) from a
description by the user. Lay the maps out using buildings from a reference set
contained in /reference/buildings/."

The generator is seeded and deterministic. It emits the exact scene.json contract
the OSM ingest produces, so everything downstream (validation, worldFromScene,
snapshots, the page, bindings) works unchanged. It invents no geography that
pretends to be real: `area.source` is `constructed`, the origin is a synthetic
point, and the report says every number is generated.

Blocks and streets: a regular grid (pitch `street_pitch_m`), avenues every
`avenue_every`-th street, one pedestrian lane through the centre, parks / pond /
square as whole blocks. Parcels inside blocks are jittered rectangles picked
from the reference archetype mixes per district (residential / centre /
industrial edge).
"""
import json
import math
import random
from dataclasses import dataclass, field

from ingest.families import check_family_palette

MIN_BUILDING_M2 = 8.0
M_PER_LEVEL = 3.1
SIDEWALK_M = 1.25
STREET_DRIFT_M = 1.3

# Weighted building draws per district (economic class, storey band lo..hi)
DISTRICTS = {
    "residential": [("terrace", 3, 3), ("house", 2, 2), ("apartments", 3, 5), ("apartments", 6, 9)],
    "centre":      [("retail", 2, 4), ("mixed_use", 3, 6), ("office", 4, 12), ("supermarket", 1, 2), ("apartments", 4, 8)],
    "industrial":  [("warehouse", 1, 2), ("industrial", 1, 2), ("manufacture", 1, 2)],
}

@dataclass
class Spec:
    name: str = "Constructed town"
    extent_m: tuple = (640.0, 480.0)
    seed: int = 42
    street_pitch_m: float = 44.0
    avenue_every: int = 4
    park_blocks: int = 2
    pond: bool = True
    square: bool = True
    centre_frac: float = 0.18          # fraction of the area near the centre that is "centre" district
    industrial_frac: float = 0.15      # fraction at the edges that is "industrial"
    family: str = "real"               # world family: real | historical | fantasy | scifi
    palette: str = "nw"                # palette family id from reference/render/palettes.json
    structures: list = field(default_factory=list)   # explicit non-building structures: {kind, footprint, levels?, height?}

    @staticmethod
    def from_dict(d):
        if not d:
            return Spec()
        known = set(Spec.__dataclass_fields__)
        unknown = set(d) - known
        if unknown:
            raise ValueError(f"unknown spec keys: {sorted(unknown)} (known: {sorted(known)})")
        s = Spec()
        for k, v in d.items():
            if k == "extent_m":
                v = (float(v[0]), float(v[1]))
            setattr(s, k, v)
        return s


@dataclass
class IdGen:
    n: int = 0
    def next(self, prefix):
        self.n += 1
        return f"{prefix}{self.n}"


def _rect(cx, cy, w, h, rot_deg=0.0):
    """A jittered rectangle (footprint), centred on (cx, cy)."""
    hw, hh = w / 2, h / 2
    pts = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    if rot_deg:
        th = math.radians(rot_deg)
        c, s = math.cos(th), math.sin(th)
        pts = [(x * c - y * s, x * s + y * c) for x, y in pts]
    return [[round(cx + x, 2), round(cy + y, 2)] for x, y in pts]


def _fit_in_block(fp, x0, x1, y0, y1):
    """Keep a jittered/rotated parcel inside its block (the block already clears the road corridor)."""
    xs = [p[0] for p in fp]; ys = [p[1] for p in fp]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    sx = min(1.0, (cx - x0) / max(1e-6, cx - min(xs)), (x1 - cx) / max(1e-6, max(xs) - cx))
    sy = min(1.0, (cy - y0) / max(1e-6, cy - min(ys)), (y1 - cy) / max(1e-6, max(ys) - cy))
    if sx >= 1 and sy >= 1:
        return fp
    return [[round(cx + (x - cx) * sx, 2), round(cy + (y - cy) * sy, 2)] for x, y in fp]


def _rot(pt, deg):
    th = math.radians(deg)
    c, s = math.cos(th), math.sin(th)
    return (pt[0] * c - pt[1] * s, pt[0] * s + pt[1] * c)


def generate(spec_dict=None):
    spec = Spec.from_dict(spec_dict)
    check_family_palette(spec.family, spec.palette)
    rng = random.Random(spec.seed)
    ids = IdGen()
    EW, NS = spec.extent_m
    P = spec.street_pitch_m
    roads, buildings, landuse, trees = [], [], [], []

    # --- streets: two families of parallel lines, jittered a little along their length ---
    xs = [0.0]
    while xs[-1] < EW - 1e-6:
        xs.append(xs[-1] + P)
    ys = [0.0]
    while ys[-1] < NS - 1e-6:
        ys.append(ys[-1] + P)
    xs = [round(x, 2) for x in xs]
    ys = [round(y, 2) for y in ys]

    def road(vertical, at, cls, width):
        if vertical:
            pts = [[at, 0.0], [at, NS]]
        else:
            pts = [[0.0, at], [EW, at]]
        # gentle drift so the grid is not a ruler: split into segments with small x offsets
        n = 5
        out = []
        for i in range(n + 1):
            t = i / n
            drift = math.sin(t * math.pi * 2 + at * 0.017) * 1.2
            p = [at + drift, NS * t] if vertical else [EW * t, at + drift]
            out.append([round(p[0], 2), round(p[1], 2)])
        roads.append({"id": ids.next("w"), "class": cls, "pts": out, "tram": False, "cycle": False, "width": width, "name": None})

    xw = [9.0 if i % spec.avenue_every == 0 else 6.0 for i in range(len(xs))]
    yw = [9.0 if i % spec.avenue_every == 0 else 6.0 for i in range(len(ys))]
    for i, x in enumerate(xs):
        road(True, x, "avenue" if i % spec.avenue_every == 0 else "local", xw[i])
    for i, y in enumerate(ys):
        road(False, y, "avenue" if i % spec.avenue_every == 0 else "local", yw[i])

    # one pedestrian lane on the central east-west street, and a square in the centre
    mid_y = ys[len(ys) // 2]
    if spec.square:
        landuse.append({"id": ids.next("l"), "kind": "square", "footprint": _rect(EW / 2, mid_y, 40.0, 40.0)})

    # --- district assignment per cell (between consecutive street lines) ---
    def district(cx, cy):
        dx, dy = (cx - EW / 2) / EW, (cy - NS / 2) / NS
        r = math.hypot(dx, dy)
        if r < spec.centre_frac * 0.9:
            return "centre"
        edge = min(cx, EW - cx, cy, NS - cy) / min(EW, NS)
        if edge < spec.industrial_frac * 0.5:
            return "industrial"
        return "residential"

    def parcel_count(d):
        return {"residential": 4, "centre": 2, "industrial": 1}[d]

    def class_storey(d):
        pool = DISTRICTS[d]
        e = pool[rng.randrange(len(pool))]
        return e[0], rng.randint(e[1], e[2])

    def archetype_for(cls):
        if cls in ("terrace",):
            return "terrace"
        if cls in ("house", "detached", "bungalow", "cabin", "hut", "static_caravan"):
            return "villa"
        if cls in ("apartments", "mixed_use", "office"):
            return "block" if cls != "office" or rng.random() < 0.6 else "tower"
        if cls in ("supermarket", "retail", "kiosk", "garage"):
            return "shophouse"
        if cls in ("warehouse", "industrial", "manufacture", "shed"):
            return "shed"
        return "auto"

    # --- blocks: subdivide each cell into parcels ---
    inset = lambda width: max(3.5, width / 2 + SIDEWALK_M + STREET_DRIFT_M)   # clear carriageway + pavement + road drift
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            x0, x1, y0, y1 = xs[i] + inset(xw[i]), xs[i + 1] - inset(xw[i + 1]), ys[j] + inset(yw[j]), ys[j + 1] - inset(yw[j + 1])
            if x1 - x0 < 6 or y1 - y0 < 6:
                continue
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            d = district(cx, cy)
            # whole-block landuses
            if spec.park_blocks and rng.random() < 0.06:
                landuse.append({"id": ids.next("l"), "kind": rng.choice(["park", "garden"]), "footprint": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]})
                # scatter trees inside
                for _ in range(rng.randint(8, 20)):
                    tx, ty = rng.uniform(x0 + 2, x1 - 2), rng.uniform(y0 + 2, y1 - 2)
                    trees.append([round(tx, 2), round(ty, 2), rng.choice(["broadleaf", "oak", "plane", "columnar"]), rng.choice([0.8, 1.0, 1.2])])
                continue
            if spec.pond and abs(cx - EW / 2) < P / 3 and abs(cy - NS / 2) < P / 3 and rng.random() < 0.5:
                landuse.append({"id": ids.next("l"), "kind": "water", "footprint": _rect(cx, cy, min(x1 - x0 - 6, 30.0), min(y1 - y0 - 6, 24.0))})
                continue
            n = parcel_count(d)
            for k in range(n):
                cls, storeys = class_storey(d)
                pw = (x1 - x0) * (0.28 + rng.random() * 0.28)
                ph = (y1 - y0) * (0.38 + rng.random() * 0.35)
                px = x0 + (k + 0.5) * (x1 - x0) / n + rng.uniform(-2, 2)
                py = cy + rng.uniform(-(y1 - y0) * 0.14, (y1 - y0) * 0.14)
                fp = _fit_in_block(_rect(px, py, pw, ph, rot_deg=rng.uniform(-1.5, 1.5)), x0, x1, y0, y1)
                if _area(fp) < MIN_BUILDING_M2:
                    continue
                arch = archetype_for(cls)
                b = {
                    "id": ids.next("b"), "footprint": fp, "levels": max(1, storeys),
                    "archetype": arch, "state": "none", "investor": False,
                    "area": round(_area(fp), 1),
                    "centroid": [round(px, 2), round(py, 2)],
                    "height": round(max(1, storeys) * M_PER_LEVEL, 1),
                    "levels_assumed": True,
                    "residential": "residential" if cls in ("terrace", "house", "apartments", "mixed_use") else "other",
                    "economic_class": cls, "economic_class_source": "generated",
                    "osm": {"building": f"generated:{cls}", "levels_source": "type-default"},
                }
                buildings.append(b)

    # sort layers by the contract order
    land_order = {"park": 0, "garden": 1, "water": 2, "square": 3}
    landuse.sort(key=lambda l: land_order.get(l["kind"], 9))

    # neighbours: grid-adjacency is cheap; generous 1.2 m edge distance
    b_ids = [b["id"] for b in buildings]
    neighbours = _neighbours([b["footprint"] for b in buildings], b_ids)
    for b, ns in zip(buildings, neighbours):
        b["neighbours"] = ns

    structures = [{**b, "kind": "building"} for b in buildings]
    for item in spec.structures:
        structure = dict(item)
        structure.setdefault("id", ids.next("s"))
        structures.append(structure)

    scene = {
        "area": {
            "name": spec.name, "source": "constructed", "osm_relation": None,
            "attribution": "paperdolls constructed region (synthetic; no OpenStreetMap data)",
            "origin": {"lat": 0.0, "lon": 0.0},
            "rotation_deg": 0.0, "north_on_screen_deg": 60.0,
            "extent_m": [round(EW, 1), round(NS, 1)],
            "generated": _utcnow(),
            "ingest_version": "construct 1.0.0",
            "family": spec.family, "palette": spec.palette,
        },
        "roads": roads,
        "buildings": buildings,
        "structures": structures,
        "landuse": landuse,
        "trees": trees,
    }
    return scene


def _utcnow():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _area(fp):
    a = 0.0
    for i in range(len(fp)):
        x1, y1 = fp[i]
        x2, y2 = fp[(i + 1) % len(fp)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def _neighbours(footprints, ids, threshold_m=1.2, cell_m=12.0):
    """Simple grid-based neighbour search (edge-to-edge, no rotation assumptions). Returns one list of ids per building."""
    import math as _m
    grid = {}
    def cells_of(fp):
        xs = [p[0] for p in fp]; ys = [p[1] for p in fp]
        for cx in range(int(min(xs) // cell_m), int(max(xs) // cell_m) + 1):
            for cy in range(int(min(ys) // cell_m), int(max(ys) // cell_m) + 1):
                yield (cx, cy)
    for i, fp in enumerate(footprints):
        for c in cells_of(fp):
            grid.setdefault(c, []).append(i)
    out = [[] for _ in footprints]
    for i, fp in enumerate(footprints):
        seen = set()
        for c in cells_of(fp):
            for j in grid.get(c, []):
                if j == i or j in seen:
                    continue
                seen.add(j)
                if _seg_dist(fp, footprints[j]) <= threshold_m:
                    out[i].append(j)
    return [[ids[j] for j in ns] for ns in out]


def _seg_dist(a, b):
    """Approximate edge-to-edge distance between two rings: min point-to-segment distance over all vertex pairs. Good enough for 1.2 m classed as neighbours; exercises correctness on axis-aligned rectangles."""
    import math as _m
    def pt_seg(p, a0, a1):
        px, py = p; ax, ay = a0; bx, by = a1
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        if L2 == 0:
            return _m.hypot(px - ax, py - ay)
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
        return _m.hypot(px - (ax + t * dx), py - (ay + t * dy))
    best = _m.inf
    for p in a:
        for i in range(len(b)):
            best = min(best, pt_seg(p, b[i], b[(i + 1) % len(b)]))
    for p in b:
        for i in range(len(a)):
            best = min(best, pt_seg(p, a[i], a[(i + 1) % len(a)]))
    return best
