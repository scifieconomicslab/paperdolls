"""Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0). Adds economic_class checks.
"""
"""Check a scene before it is written: the rules of validateScene (viz/vizlib.js) for what the ingest produces, plus finite numbers everywhere.

The ingest is meant to produce only valid scenes; this is the guard that says so when a bug or an odd input breaks that. Returns (errors, warnings)."""
import math

from .classify import ECONOMIC_CLASSES, ECONOMIC_CLASS_SOURCES

STRUCTURE_KINDS = ("building", "wall", "habitat", "ruin", "infrastructure", "other")


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


def _check_structure(b, i, label, ids, bad, require_kind):
    fp = b.get("footprint")
    if not (isinstance(fp, list) and len(fp) >= 3 and all(_pt(p) for p in fp)):
        bad(f"{label} {i} ({b.get('id')}): needs a footprint of at least three [x, y] points")
        return
    kind = b.get("kind")
    if require_kind and kind not in STRUCTURE_KINDS:
        bad(f"{label} {i} ({b.get('id')}): kind must be one of {', '.join(STRUCTURE_KINDS)}")
    if kind == "building" or (not require_kind and "levels" in b):
        if not (_num(b.get("levels")) and b["levels"] >= 1):
            bad(f"{label} {i} ({b.get('id')}): levels must be a number of at least 1")
    if require_kind and kind == "building":
        for key in ("archetype", "economic_class", "economic_class_source"):
            if key not in b:
                bad(f"{label} {i} ({b.get('id')}): a building structure needs {key}")
        if b.get("economic_class") not in ECONOMIC_CLASSES:
            bad(f"{label} {i} ({b.get('id')}): economic_class {b.get('economic_class')!r} is not a known class")
        if b.get("economic_class_source") not in ECONOMIC_CLASS_SOURCES:
            bad(f"{label} {i} ({b.get('id')}): economic_class_source {b.get('economic_class_source')!r} is not tag | use-tag | building:use | landuse | landuse-raster | fallback | generated")
    if "id" in b:
        if b["id"] in ids:
            bad(f"{label} id {b['id']} appears twice")
        ids.add(b["id"])
    if "area" in b and not (_num(b["area"]) and b["area"] >= 0):
        bad(f"{label} {i} ({b.get('id')}): area must be a number of at least 0")
    if "height" in b and not (_num(b["height"]) and b["height"] > 0):
        bad(f"{label} {i} ({b.get('id')}): height must be a number above 0")
    if "centroid" in b and not _pt(b["centroid"]):
        bad(f"{label} {i} ({b.get('id')}): centroid must be [x, y]")
    if "economic_class" in b and b["economic_class"] not in ECONOMIC_CLASSES:
        bad(f"{label} {i} ({b.get('id')}): economic_class {b['economic_class']!r} is not a known class")
    if "economic_class_source" in b and b["economic_class_source"] not in ECONOMIC_CLASS_SOURCES:
        bad(f"{label} {i} ({b.get('id')}): economic_class_source {b['economic_class_source']!r} is not tag | use-tag | building:use | landuse | landuse-raster | fallback | generated")


def validate_scene(scene):
    errors, warnings = [], []
    bad = lambda m: errors.append(m) if len(errors) < 40 else None
    _all_finite(scene, "scene", errors)
    shape = [f"{k} must be a list" for k in ("roads", "buildings", "structures", "landuse", "trees") if k in scene and not isinstance(scene.get(k), list)]
    if shape:
        return errors + shape, warnings
    buildings = scene.get("buildings") or []
    structures = scene.get("structures") or []
    for i, r in enumerate(scene.get("roads") or []):
        if not (isinstance(r.get("pts"), list) and len(r["pts"]) >= 2 and all(_pt(p) for p in r["pts"])):
            bad(f"road {i} ({r.get('id')}): needs at least two [x, y] points")
    building_ids = set()
    for i, b in enumerate(buildings):
        _check_structure(b, i, "building", building_ids, bad, require_kind=False)
    structure_ids = set()
    for i, b in enumerate(structures):
        _check_structure(b, i, "structure", structure_ids, bad, require_kind=True)
    dangling = sum(1 for b in buildings for n in (b.get("neighbours") or []) if n not in building_ids)
    if dangling:
        bad(f"{dangling} neighbour id(s) name no building in the scene")
    for i, l in enumerate(scene.get("landuse") or []):
        fp = l.get("footprint")
        if not (isinstance(fp, list) and len(fp) >= 3 and all(_pt(p) for p in fp)):
            bad(f"landuse {i}: needs a footprint")
    for i, t in enumerate(scene.get("trees") or []):
        if not _pt(t):
            bad(f"tree {i}: needs [x, y]")
    if not buildings and not structures:
        warnings.append("no buildings or structures")
    return errors, warnings
