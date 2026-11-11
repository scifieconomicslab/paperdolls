#!/usr/bin/env python3
"""Jette composition pass — framing only, no reshaping.

OSM worlds may be framed, never reshaped (scene-craft/recipes/composition.md §1).
This pass:
  1. marks the largest religious footprint as the landmark (else the largest civic,
     else the tallest structure), and records the rule;
  2. measures how many footprints read as a single oriented rectangle, which is
     the renderer's mass rule, and writes the count into the report;
  3. records the dwelling subset the model binds to (residential, dwelling class).
It writes map-data/scene.composed.json and appends a section to map-data/scene_report.md.
Run from anywhere: python3 map-data/compose.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

R_EARTH = 6371008.8
DEG = math.pi / 180.0

HERE = Path(__file__).resolve().parent
SCENE = HERE / "scene.json"
OUT = HERE / "scene.composed.json"
REPORT = HERE / "scene_report.md"

DWELLING_CLASSES = {
    "apartments", "house", "residential", "detached", "terrace",
    "semidetached_house", "bungalow", "mixed_use", "hut",
}


def convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def area(poly: list[tuple[float, float]]) -> float:
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def min_area_rect(poly: list[tuple[float, float]]) -> tuple[float, float]:
    """(area, short side) of the minimum-area rectangle of a convex polygon."""
    hull = convex_hull(poly)
    if len(hull) < 3:
        return 0.0, 0.0
    best = (math.inf, 0.0)
    for i in range(len(hull)):
        x1, y1 = hull[i]
        x2, y2 = hull[(i + 1) % len(hull)]
        dx, dy = x2 - x1, y2 - y1
        length = math.hypot(dx, dy)
        if length < 1e-9:
            continue
        ux, uy = dx / length, dy / length
        us = [p[0] * ux + p[1] * uy for p in hull]
        vs = [-p[0] * uy + p[1] * ux for p in hull]
        w, h = max(us) - min(us), max(vs) - min(vs)
        a = w * h
        if a < best[0]:
            best = (a, min(w, h))
    return best


def boundary_ring(extract: dict, origin: dict) -> list[tuple[float, float]] | None:
    """Assemble relation 58258's outer members into one metric ring in the scene frame.
    OSM world framing may crop along the boundary, never invent it."""
    rel = next((e for e in extract.get("elements", []) if e.get("type") == "relation" and e.get("id") == 58258), None)
    if not rel:
        return None
    kx = R_EARTH * math.cos(origin["lat"] * DEG) * DEG
    ky = R_EARTH * DEG
    segs: list[list[tuple[float, float]]] = []
    for m in rel.get("members", []):
        if m.get("role") != "outer" or not m.get("geometry"):
            continue
        seg = [((p["lon"] - origin["lon"]) * kx, -(p["lat"] - origin["lat"]) * ky) for p in m["geometry"]]
        if len(seg) >= 2:
            segs.append(seg)
    if not segs:
        return None
    ring = segs.pop(0)
    while segs:
        end = ring[-1]
        hit = None
        for i, seg in enumerate(segs):
            if math.hypot(seg[0][0] - end[0], seg[0][1] - end[1]) < 0.5:
                hit = (i, seg, False); break
            if math.hypot(seg[-1][0] - end[0], seg[-1][1] - end[1]) < 0.5:
                hit = (i, seg, True); break
        if hit is None:
            break
        i, seg, rev = hit
        ring.extend((seg[-1::-1] if rev else seg)[1:])
        segs.pop(i)
    if len(ring) > 2 and math.hypot(ring[0][0] - ring[-1][0], ring[0][1] - ring[-1][1]) < 0.5:
        ring.pop()
    return [(round(x, 2), round(y, 2)) for x, y in ring]


def main() -> None:
    scene = json.loads(SCENE.read_text())
    structures = scene["structures"]
    by_id = {s["id"]: s for s in structures}

    def pick(pred):
        candidates = [s for s in structures if pred(s)]
        return max(candidates, key=lambda s: (s.get("area") or 0.0)) if candidates else None

    named_church = pick(lambda s: (s.get("osm") or {}).get("building") == "church" and (s.get("osm") or {}).get("name"))
    landmark = named_church or pick(lambda s: (s.get("osm") or {}).get("building") == "church")
    rule = "largest named religious footprint (building=church with a name), else largest religious, else largest civic, else tallest"
    if landmark is None:
        landmark = pick(lambda s: s.get("economic_class") in ("civic", "government", "museum"))
    if landmark is None:
        landmark = max(structures, key=lambda s: (s.get("height") or 0.0))

    for s in structures:
        s.pop("landmark", None)
    landmark["landmark"] = True

    box, irregular = 0, 0
    for s in structures:
        rect_area, short = min_area_rect([tuple(p) for p in s["footprint"]])
        poly_area = area([tuple(p) for p in s["footprint"]])
        rectangularity = poly_area / rect_area if rect_area > 0 else 0.0
        s["rectangularity"] = round(rectangularity, 3)
        if rectangularity >= 0.82 and short >= 3.0:
            box += 1
        else:
            irregular += 1

    dwellings = [
        s for s in structures
        if s.get("kind") == "building"
        and s.get("residential") in ("residential", "probable")
        and s.get("economic_class") in DWELLING_CLASSES
    ]
    assumed_dwellings = sum(1 for s in dwellings if s.get("levels_assumed"))

    boundary = boundary_ring(json.loads((HERE / "extract.json").read_text()), scene["area"]["origin"])
    if boundary:
        scene["area"]["boundary"] = boundary
        scene["area"]["boundary_area_m2"] = round(area(boundary))

    scene["area"]["composition"] = {
        "pass": "jette-framing-v1",
        "reshaped": False,
        "landmark": landmark["id"],
        "landmark_name": (landmark.get("osm") or {}).get("name"),
        "landmark_rule": rule,
        "oriented_box": box,
        "irregular_footprint": irregular,
        "dwellings": len(dwellings),
        "dwellings_levels_assumed": assumed_dwellings,
    }
    OUT.write_text(json.dumps(scene, separators=(",", ":")))

    osbm = (landmark.get("osm") or {}).get("name") or landmark.get("economic_class")
    addendum = f"""
## Addendum — Jette framing pass ({scene["area"]["generated"][:10]})

This pass only frames; it reshapes nothing. `scene.composed.json` is the scene the renderer reads.

| item | value |
|---|---|
| landmark | `{landmark["id"]}` — {osbm} |
| boundary ring | {len(boundary) if boundary else 0} points, {round(area(boundary) / 1e6, 2) if boundary else 0} km² (relation 58258) |
| rule | {rule} |
| footprint drawn as one oriented box | {box} of {len(structures)} ({box / len(structures):.0%}); rectangularity ≥ 0.82 and short side ≥ 3 m |
| footprint simplified to its oriented rectangle | {irregular} ({irregular / len(structures):.0%}) — counted, not hidden |
| dwelling buildings the model binds to | {len(dwellings)} (residential, dwelling-class whitelist) |
| dwellings with assumed storeys | {assumed_dwellings} of {len(dwellings)} ({assumed_dwellings / max(1, len(dwellings)):.0%}) — guessed, not measured |

The ingest's "29 % fitting an asset" estimate applies to the legacy axis-aligned
asset grammar. This world draws an oriented box from each footprint's own
minimum-area rectangle, so every structure gets an oriented mass; the table above
states how many footprints that box simplifies.
"""
    with REPORT.open("a") as fh:
        fh.write(addendum)
    print(f"wrote {OUT}")
    print(f"landmark {landmark['id']} ({osbm}); boxes {box}/{len(structures)}; dwellings {len(dwellings)}; assumed {assumed_dwellings}")


if __name__ == "__main__":
    main()
