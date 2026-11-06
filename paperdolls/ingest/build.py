"""From features to a scene: clip, choose the frame rotation, project, classify, place trees, and report."""
import datetime
import math
import random
from collections import Counter

from . import __version__, adjacency, classify, elevation, readers
from .geo import (DEG, LocalFrame, axis_deviation_deg, dominant_angle, min_rect, point_in_ring, resample_line, ring_area,
                  ring_centroid, simplify_ring)

ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
FIT = {"max_dev_deg": 12.0, "min_rectangularity": 0.82, "min_side": 3.0}      # mirrors AssetLib.FIT in buildinglib.js
MIN_BUILDING_M2, MIN_LANDUSE_M2 = 8.0, 20.0
SCATTER_CAP_POLYGON, SCATTER_CAP_TOTAL = 300, 4000
ASSUMED_SOURCES = ("type-default", "global-default")           # osm.levels_source values that mean the storey count was not read from the data
LAND_ORDER = {"park": 0, "garden": 1, "water": 2, "square": 3}


class IngestError(ValueError):
    pass


def _segments(ring, closed=True):
    n = len(ring)
    return [(ring[i][0], ring[i][1], ring[(i + 1) % n][0], ring[(i + 1) % n][1]) for i in range(n if closed else n - 1)]


class SegIndex:
    """A grid of line segments, for 'is there a road within r metres, running the same way'."""

    def __init__(self, cell=20.0):
        self.cell, self.g = cell, {}

    def add(self, x0, y0, x1, y1):
        c = self.cell
        for i in range(int(min(x0, x1) // c), int(max(x0, x1) // c) + 1):
            for j in range(int(min(y0, y1) // c), int(max(y0, y1) // c) + 1):
                self.g.setdefault((i, j), []).append((x0, y0, x1, y1))

    def near(self, x, y, r, theta=None, tol_deg=25.0):
        c, hit = self.cell, False
        for i in range(int((x - r) // c), int((x + r) // c) + 1):
            for j in range(int((y - r) // c), int((y + r) // c) + 1):
                for x0, y0, x1, y1 in self.g.get((i, j), ()):
                    dx, dy = x1 - x0, y1 - y0
                    L2 = dx * dx + dy * dy or 1e-9
                    t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / L2))
                    if math.hypot(x - (x0 + dx * t), y - (y0 + dy * t)) > r:
                        continue
                    if theta is not None:
                        d = abs(((math.atan2(dy, dx) - theta) / DEG + 90.0) % 180.0 - 90.0)
                        if d > tol_deg:
                            continue
                    return True
        return False


def _samples(pts, step=8.0):
    out = []
    for a, b in zip(pts, pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(L // step))
        th = math.atan2(b[1] - a[1], b[0] - a[0])
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, th) for k in range(n)]
    return out


def _rect_info(ring_xy):
    r = min_rect(ring_xy)
    if r is None:
        return None
    th, a, b, area = r
    return {"theta": th, "a": a, "b": b, "rect": ring_area(ring_xy) / (a * b) if a * b > 0 else 0.0}


def _fits(info, rot_deg):
    return bool(info and min(info["a"], info["b"]) >= FIT["min_side"] and info["rect"] >= FIT["min_rectangularity"] and axis_deviation_deg(info["theta"], rot_deg) <= FIT["max_dev_deg"])


def ingest(path, rotation="auto", bbox=None, boundary_relation=None, name=None, max_buildings=None, scatter=True, seed=7, elevation_file=None, terrain_cell=25.0):
    """Read an OSM extract and return (scene dict, report dict). Raises IngestError for input that cannot become a scene.

    elevation_file: a local GeoTIFF, Esri ASCII grid or XYZ/CSV file (see ingest/elevation.py). The scene then gets a terrain grid (terrain_cell metres) and z on
    buildings, road points and trees. Without it nothing changes."""
    feats, notes, fmt = readers.read_file(path)
    assume, skipped, warnings = classify.Assumptions(), Counter(), []

    # ---- clip polygon: a boundary relation, a bounding box, or both ----
    clip_ring, clip_name = None, None
    admin = [f for f in feats if f.kind == "polygon" and f.tags.get("boundary") == "administrative"]
    if boundary_relation is not None:
        cands = [f for f in feats if f.kind == "polygon" and (f.id == f"r{boundary_relation}" or f.id.startswith(f"r{boundary_relation}#"))]
        if not cands and boundary_relation in notes.get("open_relations", []):
            raise IngestError(f"boundary relation {boundary_relation} is in the file but its ways do not close into a ring (the extract may be cut off or missing members). Fetch it again with 'out geom;', or clip with --bbox instead.")
        if not cands:
            raise IngestError(f"boundary relation {boundary_relation} is not in the file. The extract must include rel({boundary_relation}); see 'paperdolls osm-query'.")
        best = max(cands, key=lambda f: ring_area(f.coords))
        clip_ring, clip_name = best.coords, best.tags.get("name")
    elif admin:
        warnings.append(f"The file contains {len(admin)} administrative boundary polygon(s) but no boundary relation was named, so nothing was clipped. Use --boundary-relation to clip.")

    def inside(lat, lon):
        if bbox and not (bbox[0] <= lat <= bbox[2] and bbox[1] <= lon <= bbox[3]):
            return False
        return clip_ring is None or point_in_ring((lat, lon), clip_ring)

    # ---- sort features into what the scene has ----
    bld, roads, trams, lands, tpts, trows = [], [], [], [], [], []
    for f in feats:
        t = f.tags
        if f.kind == "polygon":
            if "boundary" in t and "building" not in t:
                continue
            if "building" in t:
                if t["building"] in classify.BUILDING_SKIP:
                    skipped[f"building={t['building']}"] += 1
                else:
                    bld.append(f)
            elif classify.landuse_kind(t):
                lands.append(f)
        elif f.kind == "line":
            if t.get("railway") == "tram":
                if t.get("tunnel") in ("yes",) or (classify.parse_num(t.get("layer")) or 0) < 0:
                    skipped["tram in a tunnel"] += 1
                else:
                    trams.append(f)
            elif "highway" in t:
                roads.append(f)
            elif t.get("natural") == "tree_row":
                trows.append(f)
        elif f.kind == "point" and t.get("natural") == "tree":
            tpts.append(f)

    def centre_ll(ring):
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))

    n_before = len(bld)
    bld = [f for f in bld if inside(*centre_ll(f.coords))]
    skipped["buildings outside the clip"] += n_before - len(bld)
    roads = [f for f in roads if any(inside(*p) for p in f.coords)]
    trams = [f for f in trams if any(inside(*p) for p in f.coords)]
    lands = [f for f in lands if inside(*centre_ll(f.coords))]
    tpts = [f for f in tpts if inside(*f.coords)]
    trows = [f for f in trows if any(inside(*p) for p in f.coords)]
    if not bld and not roads:
        raise IngestError("nothing to draw: no buildings or roads in the extract (after clipping). Check the query and the clip.")

    # ---- origin, then the frame rotation chosen from evidence ----
    base = (clip_ring or [p for f in (bld + roads) for p in f.coords])
    lat0 = (min(p[0] for p in base) + max(p[0] for p in base)) / 2
    lon0 = (min(p[1] for p in base) + max(p[1] for p in base)) / 2
    f0 = LocalFrame(lat0, lon0, 0.0)
    if max_buildings and len(bld) > max_buildings:
        bld.sort(key=lambda f: math.hypot(*f0.xy(*centre_ll(f.coords))))
        skipped[f"buildings beyond --max-buildings {max_buildings} (kept the nearest to the centre)"] += len(bld) - max_buildings
        bld = bld[:max_buildings]

    info = {f.id: _rect_info([f0.xy(*p) for p in f.coords]) for f in bld}
    seg_b = [s for f in bld for s in _segments([f0.xy(*p) for p in f.coords])]
    seg_r = [s for f in roads for s in _segments([f0.xy(*p) for p in f.coords], closed=False)]
    cands = {"none": (0.0, 0.0)}
    if seg_b:
        cands["building edges"] = dominant_angle(seg_b)
    if seg_r:
        cands["road segments"] = dominant_angle(seg_r)
    if seg_b and seg_r:
        cands["buildings and roads"] = dominant_angle(seg_b + seg_r)

    def share(rot):
        return sum(_fits(info[f.id], rot) for f in bld) / max(1, len(bld))

    cand_rows = [{"source": k, "rotation_deg": round(v[0], 2), "strength": round(v[1], 3), "asset_share": round(share(v[0]), 3)} for k, v in cands.items()]
    if rotation == "auto":
        best = max(cand_rows, key=lambda r: (r["asset_share"], r["source"] == "building edges"))
        rot = best["rotation_deg"]
        why = f"chosen from {best['source']} (highest estimated asset share)"
    elif rotation == "none":
        rot, why = 0.0, "rotation switched off"
    else:
        rot, why = float(rotation), "set by the user"
    frame = LocalFrame(lat0, lon0, rot)
    xy = frame.xy

    # ---- roads (and trams) ----
    road_out, tram_idx = [], SegIndex()
    tram_lines = []
    for f in trams:
        pts = simplify_ring([xy(*p) for p in f.coords], 0.05) if len(f.coords) > 2 else [xy(*p) for p in f.coords]
        if len(pts) >= 2:
            tram_lines.append((f, pts))
            for s in _segments(pts, closed=False):
                tram_idx.add(*s)
    road_pts = []
    for f in roads:
        spec, why_skip = classify.classify_road(f.tags, assume)
        if spec is None:
            skipped[why_skip] += 1
            continue
        pts = [xy(*p) for p in f.coords]
        out_pts, last = [], None
        for p in pts:
            if last is None or math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05:
                out_pts.append(p)
                last = p
        if len(out_pts) < 2 or sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(out_pts, out_pts[1:])) < 1.0:
            skipped["road shorter than 1 m"] += 1
            continue
        road_pts.append((f, spec, out_pts))
    road_idx = SegIndex()
    for f, spec, pts in road_pts:
        if spec["class"] in ("avenue", "local"):
            for s in _segments(pts, closed=False):
                road_idx.add(*s)
    tram_roads = 0
    for f, spec, pts in road_pts:
        on_tram = False
        if tram_lines and spec["class"] in ("avenue", "local"):
            sm = _samples(pts)
            on_tram = bool(sm) and sum(tram_idx.near(x, y, 9.0, th) for x, y, th in sm) / len(sm) >= 0.5
        r = {"id": f.id, "class": spec["class"], "pts": [[round(x, 2), round(y, 2)] for x, y in pts], "tram": on_tram, "cycle": spec["cycle"]}
        w = spec["width"]
        if on_tram:
            w = max(w or (10.0 if spec["class"] == "avenue" else 6.0), 8.0)
            tram_roads += 1
        if w:
            r["width"] = round(w, 1)
        if f.tags.get("name"):
            r["name"] = f.tags["name"]
        road_out.append(r)
    # tram lines no road runs along become their own track; the two directions of one line are merged
    emitted, standalone = SegIndex(), 0
    for f, pts in tram_lines:
        sm = _samples(pts)
        if not sm or sum(road_idx.near(x, y, 9.0, th) for x, y, th in sm) / len(sm) >= 0.4:
            continue
        if sum(emitted.near(x, y, 4.0, th) for x, y, th in sm) / len(sm) >= 0.6:
            continue
        for s in _segments(pts, closed=False):
            emitted.add(*s)
        road_out.append({"id": f.id, "class": "tramway", "pts": [[round(x, 2), round(y, 2)] for x, y in pts], "tram": True, "cycle": False})
        standalone += 1
    assume.add("tram", f"{tram_roads} road(s) run along a tram line: street-running tram flagged", tram_roads) if tram_roads else None
    assume.add("tram", f"{standalone} tram line(s) with no road alongside: drawn as their own track", standalone) if standalone else None

    # ---- buildings ----
    bld_out, holes_ignored, rotated_info = [], 0, {}
    for f in bld:
        ring = simplify_ring([xy(*p) for p in f.coords], 0.05)
        if len(ring) < 3 or ring_area(ring) < MIN_BUILDING_M2:
            skipped[f"building smaller than {MIN_BUILDING_M2:.0f} m2"] += 1
            continue
        if f.holes:
            holes_ignored += 1
        levels, src = classify.building_levels(f.tags, assume)
        arch = classify.building_archetype(f.tags, levels, assume)
        if arch == "shed":
            levels = 1
        area = ring_area(ring)
        cx, cy = ring_centroid(ring)
        h_tag = classify.parse_num(f.tags.get("height"))
        height = h_tag if (h_tag is not None and 0 < h_tag <= 400) else levels * classify.M_PER_LEVEL
        b = {"id": f.id, "footprint": [[round(x, 2), round(y, 2)] for x, y in ring], "levels": levels, "archetype": arch, "state": "none", "investor": False,
             "area": round(area, 1), "centroid": [round(cx, 2), round(cy, 2)], "height": round(height, 1), "levels_assumed": src in ASSUMED_SOURCES,
             "residential": classify.residential_class(f.tags, arch, area, assume),
             "osm": {"building": f.tags.get("building"), "levels_source": src}}
        if f.tags.get("name"):
            b["osm"]["name"] = f.tags["name"]
        bld_out.append(b)
        rotated_info[f.id] = _rect_info(ring)
    if holes_ignored:
        assume.add("courtyards", "buildings with inner rings (courtyards): drawn as solid footprints", holes_ignored)
    nb_lists = adjacency.neighbours([[tuple(p) for p in b["footprint"]] for b in bld_out])
    for b, nl in zip(bld_out, nb_lists):
        b["neighbours"] = [bld_out[j]["id"] for j in nl]
    n_with_nb = sum(1 for b in bld_out if b["neighbours"])
    assume.add("neighbours", f"buildings within {adjacency.NEIGHBOUR_M:g} m of each other (edge to edge) are neighbours: {n_with_nb} buildings have at least one", n_with_nb) if n_with_nb else None

    # ---- landuse ----
    land_out, scatter_src = [], []
    for f in lands:
        kind = classify.landuse_kind(f.tags)
        ring = simplify_ring([xy(*p) for p in f.coords], 0.2)
        if len(ring) < 3 or ring_area(ring) < MIN_LANDUSE_M2:
            skipped["landuse smaller than 20 m2"] += 1
            continue
        if f.holes:
            assume.add("courtyards", "landuse polygons with inner rings: holes ignored", 1)
        land_out.append({"id": f.id, "kind": kind, "footprint": [[round(x, 2), round(y, 2)] for x, y in ring]})
        assume.add("landuse", f"{kind} from {', '.join(f'{k}={v}' for k, v in f.tags.items() if k in ('leisure', 'landuse', 'natural', 'place', 'amenity', 'waterway'))}")
        if scatter and kind == "park":
            per = classify.scatter_area_per_tree(f.tags)
            if per:
                scatter_src.append((f, ring, per))
    land_out.sort(key=lambda l: LAND_ORDER[l["kind"]])

    # ---- trees: mapped trees, tree rows, then scatter into parks and woods ----
    trees = []
    for f in tpts:
        kind, s = classify.tree_kind(f.tags, assume)
        x, y = xy(*f.coords)
        trees.append([round(x, 2), round(y, 2)] if (kind is None and s == 1.0) else [round(x, 2), round(y, 2), kind, s])
    n_mapped = len(trees)
    row_trees = 0
    for f in trows:
        kind, s = classify.tree_kind(f.tags, assume)
        sp = classify.parse_num(f.tags.get("spacing")) or 9.0
        if not f.tags.get("spacing"):
            assume.add("tree rows", "natural=tree_row with no spacing tag: a tree every 9 m")
        for x, y in resample_line([xy(*p) for p in f.coords], max(3.0, sp)):
            trees.append([round(x, 2), round(y, 2)] if (kind is None and s == 1.0) else [round(x, 2), round(y, 2), kind, s])
            row_trees += 1
    mapped_xy = [(t[0], t[1]) for t in trees]
    n_scatter = 0
    if scatter:
        for f, ring, per in scatter_src:
            if n_scatter >= SCATTER_CAP_TOTAL:
                break
            area = ring_area(ring)
            inside_mapped = sum(point_in_ring(p, ring) for p in mapped_xy[:n_mapped + row_trees])
            if inside_mapped * 2000.0 >= area:
                assume.add("scatter", "park or wood already has mapped trees: nothing scattered")
                continue
            rng = random.Random(f"{seed}:{f.id}")
            sp = math.sqrt(per)
            xs, ys = [p[0] for p in ring], [p[1] for p in ring]
            kind, s = classify.tree_kind(f.tags)
            added = 0
            gx = min(xs)
            while gx < max(xs) and added < SCATTER_CAP_POLYGON:
                gy = min(ys)
                while gy < max(ys) and added < SCATTER_CAP_POLYGON:
                    p = (gx + rng.uniform(-0.35, 0.35) * sp, gy + rng.uniform(-0.35, 0.35) * sp)
                    if point_in_ring(p, ring):
                        trees.append([round(p[0], 2), round(p[1], 2)] if kind is None else [round(p[0], 2), round(p[1], 2), kind, 1.0])
                        added += 1
                        n_scatter += 1
                    gy += sp
                gx += sp
        if n_scatter:
            assume.add("scatter", f"trees scattered into parks and woods (one per 70 to 400 m2 by type, at most {SCATTER_CAP_POLYGON} per area, {SCATTER_CAP_TOTAL} in all): {n_scatter} trees", n_scatter)

    # ---- the scene ----
    allp = [p for r in road_out for p in r["pts"]] + [p for b in bld_out for p in b["footprint"]]
    ext = [round(max(p[0] for p in allp) - min(p[0] for p in allp)), round(max(p[1] for p in allp) - min(p[1] for p in allp))] if allp else [0, 0]
    nx, ny = -math.sin(rot * DEG), -math.cos(rot * DEG)       # north in the scene frame
    north_deg = round(math.degrees(math.atan2((nx - ny) * 0.8660254, -((nx + ny) * 0.5))) % 360, 1)
    scene = {
        "area": {"name": name or clip_name or "OpenStreetMap extract", "source": "osm", "osm_relation": boundary_relation, "attribution": ATTRIBUTION,
                 "origin": {"lat": round(lat0, 6), "lon": round(lon0, 6)}, "rotation_deg": round(rot, 3), "north_on_screen_deg": north_deg, "extent_m": ext,
                 "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "ingest_version": __version__},
        "roads": road_out, "buildings": bld_out, "landuse": land_out, "trees": trees,
    }
    elev_rep = None
    if elevation_file:
        try:
            src = elevation.read_elevation(elevation_file)
            elev_rep = elevation.attach(scene, frame, src, terrain_cell)
        except elevation.ElevationError as e:
            raise IngestError(f"elevation: {e}")
        elev_rep["file"] = str(elevation_file)
        assume.add("elevation", f"heights from {elev_rep['source']} ({elevation_file}): a {elev_rep['cell_m']:g} m ground grid; each building takes the mean over its footprint corners and centroid", elev_rep["buildings_with_z"])
        if elev_rep["buildings_without_z"]:
            warnings.append(f"{elev_rep['buildings_without_z']} building(s) lie outside the elevation file and take the ground grid's height instead.")
        if elev_rep["grid_covered_share"] < 0.98:
            warnings.append(f"The elevation file covers {round(elev_rep['grid_covered_share'] * 100)}% of the scene; the rest of the ground takes the nearest height.")
    if ext[0] > 15000 or ext[1] > 15000:
        warnings.append(f"The extent is {ext[0]} x {ext[1]} m: very large for one scene. Consider --bbox or a smaller boundary.")
    if len(bld_out) > 25000:
        warnings.append(f"{len(bld_out)} buildings: the viewer will be slow. Consider --max-buildings.")
    if notes.get("open_relation_fragments"):
        warnings.append(f"{notes['open_relation_fragments']} relation fragment(s) did not close into rings and were dropped (the extract may be clipped through them).")
    if notes.get("unresolved_ways"):
        warnings.append(f"{notes['unresolved_ways']} way(s) had no geometry and were dropped (Overpass JSON needs 'out geom;').")
    if not road_out:
        warnings.append("No roads in the extract: nothing for vehicles and people to move on.")
    report = {
        "input": {"file": str(path), "format": fmt, "features": dict(Counter(f.kind for f in feats))},
        "clip": {"boundary_relation": boundary_relation, "boundary_name": clip_name, "bbox": list(bbox) if bbox else None},
        "frame": {"origin": {"lat": round(lat0, 6), "lon": round(lon0, 6)}, "rotation_deg": round(rot, 3), "how": why, "candidates": cand_rows,
                  "north_on_screen_deg": north_deg},
        "counts": {"buildings": len(bld_out), "roads": len(road_out), "landuse": len(land_out), "trees": len(trees), "trees_mapped": n_mapped,
                   "trees_in_rows": row_trees, "trees_scattered": n_scatter, "tram_roads": tram_roads, "tram_tracks": standalone},
        "estimated_asset_share": {"rotated": round(sum(_fits(rotated_info[b["id"]], 0.0) for b in bld_out) / max(1, len(bld_out)), 3),
                                  "unrotated": round(share(0.0), 3)},
        "extent_m": ext, "skipped": {k: v for k, v in skipped.items() if v}, "assumptions": assume.table(), "warnings": warnings,
        "levels_sources": dict(Counter(b["osm"]["levels_source"] for b in bld_out)),
        "levels_assumed": sum(1 for b in bld_out if b["levels_assumed"]),
        "residential": dict(Counter(b["residential"] for b in bld_out)),
        "elevation": elev_rep,
        "neighbours": {"threshold_m": adjacency.NEIGHBOUR_M, "buildings_with_neighbours": n_with_nb, "links": sum(len(b["neighbours"]) for b in bld_out) // 2,
                       "max_per_building": max((len(b["neighbours"]) for b in bld_out), default=0)},
    }
    return scene, report
