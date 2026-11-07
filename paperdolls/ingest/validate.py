"""Check a scene before it is written: the rules of validateScene (viz/vizlib.js) for what the ingest produces, plus finite numbers everywhere.

The ingest is meant to produce only valid scenes; this is the guard that says so when a bug or an odd input breaks that. Returns (errors, warnings)."""
import math


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _pt(p):
    return isinstance(p, (list, tuple)) and len(p) >= 2 and _num(p[0]) and _num(p[1])


def _all_finite(o, path, bad):
    """Every number anywhere in the scene is finite (NaN and Infinity are not JSON)."""
    stack = [(o, path)]
    while stack and len(bad) < 10:
        v, at = stack.pop()
        if isinstance(v, float) and not math.isfinite(v):
            bad.append(f"{at}: {v} is not a finite number")
        elif isinstance(v, dict):
            stack.extend((x, f"{at}.{k}") for k, x in v.items())
        elif isinstance(v, (list, tuple)):
            stack.extend((x, f"{at}[{i}]") for i, x in enumerate(v))


def validate_scene(scene):
    errors, warnings = [], []
    bad = lambda m: errors.append(m) if len(errors) < 40 else None
    _all_finite(scene, "scene", errors)
    shape = [f"{k} must be a list" for k in ("roads", "buildings", "landuse", "trees") if not isinstance(scene.get(k), list)]
    if shape:
        return errors + shape, warnings
    for i, r in enumerate(scene["roads"]):
        if not (isinstance(r.get("pts"), list) and len(r["pts"]) >= 2 and all(_pt(p) for p in r["pts"])):
            bad(f"road {i} ({r.get('id')}): needs at least two [x, y] points")
    ids = set()
    for i, b in enumerate(scene["buildings"]):
        fp = b.get("footprint")
        if not (isinstance(fp, list) and len(fp) >= 3 and all(_pt(p) for p in fp)):
            bad(f"building {i} ({b.get('id')}): needs a footprint of at least three [x, y] points")
            continue
        if not (_num(b.get("levels")) and b["levels"] >= 1):
            bad(f"building {i} ({b.get('id')}): levels must be a number of at least 1")
        if "id" in b:
            if b["id"] in ids:
                bad(f"building id {b['id']} appears twice")
            ids.add(b["id"])
        if "area" in b and not (_num(b["area"]) and b["area"] >= 0):
            bad(f"building {i} ({b.get('id')}): area must be a number of at least 0")
        if "height" in b and not (_num(b["height"]) and b["height"] > 0):
            bad(f"building {i} ({b.get('id')}): height must be a number above 0")
        if "centroid" in b and not _pt(b["centroid"]):
            bad(f"building {i} ({b.get('id')}): centroid must be [x, y]")
    dangling = sum(1 for b in scene["buildings"] for n in (b.get("neighbours") or []) if n not in ids)
    if dangling:
        bad(f"{dangling} neighbour id(s) name no building in the scene")
    for i, l in enumerate(scene["landuse"]):
        fp = l.get("footprint")
        if not (isinstance(fp, list) and len(fp) >= 3 and all(_pt(p) for p in fp)):
            bad(f"landuse {i}: needs a footprint")
    for i, t in enumerate(scene["trees"]):
        if not _pt(t):
            bad(f"tree {i}: needs [x, y]")
    if not scene["buildings"]:
        warnings.append("no buildings")
    return errors, warnings
