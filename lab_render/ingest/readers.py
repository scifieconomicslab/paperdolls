"""Readers for Overpass JSON, OSM XML and GeoJSON, reduced to one model: points, lines and polygons in lat/lon.

Overpass JSON must come from a query ending in `out geom;` (see query.py), or include the member nodes. OSM XML needs its nodes.
GeoJSON can come from `osmium export` or Overpass Turbo. Multipolygon and boundary relations are assembled from their member ways.
"""
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

from .geo import point_in_ring


@dataclass
class Feature:
    id: str
    tags: dict
    kind: str                       # 'point' | 'line' | 'polygon'
    coords: list                    # point: (lat, lon); line: [(lat, lon)]; polygon: outer ring [(lat, lon)]
    holes: list = field(default_factory=list)


def _key(p):
    return (round(p[0], 7), round(p[1], 7))


def assemble_rings(ways):
    """Stitch way fragments (lists of (lat, lon)) into closed rings. Returns (rings, number of fragments left over)."""
    segs = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        grew = True
        while grew and _key(cur[0]) != _key(cur[-1]):
            grew = False
            for i, s in enumerate(segs):
                if _key(s[0]) == _key(cur[-1]):
                    cur += s[1:]
                elif _key(s[-1]) == _key(cur[-1]):
                    cur += list(reversed(s))[1:]
                elif _key(s[-1]) == _key(cur[0]):
                    cur = s[:-1] + cur
                elif _key(s[0]) == _key(cur[0]):
                    cur = list(reversed(s))[:-1] + cur
                else:
                    continue
                segs.pop(i)
                grew = True
                break
        if _key(cur[0]) == _key(cur[-1]) and len(cur) >= 4:
            rings.append(cur[:-1])
        else:
            rings.append(None)       # an open fragment: counted by the caller
    return [r for r in rings if r], sum(1 for r in rings if r is None)


def is_area(tags, closed):
    """Is a closed way an area (a polygon) or a line (a roundabout, a fence)?"""
    if not closed:
        return False
    if tags.get("area") == "yes":
        return True
    if tags.get("area") == "no":
        return False
    if tags.get("highway") or tags.get("railway") or tags.get("barrier"):
        return False
    if tags.get("building") not in (None, "no") or "building:part" in tags:
        return True
    if "landuse" in tags or "leisure" in tags:
        return True
    if tags.get("natural") in ("water", "wood", "scrub", "grassland", "heath", "wetland", "sand", "beach", "bare_rock"):
        return True
    if tags.get("place") == "square" or tags.get("amenity") == "marketplace" or tags.get("waterway") == "riverbank":
        return True
    return False


def _way_feature(wid, tags, coords):
    closed = len(coords) >= 4 and _key(coords[0]) == _key(coords[-1])
    if is_area(tags, closed):
        return Feature(f"w{wid}", tags, "polygon", coords[:-1])
    return Feature(f"w{wid}", tags, "line", coords)


def _relation_features(rid, tags, members):
    """members: [(role, coords)] of way members. Returns polygon features (one per outer ring) and the open-fragment count."""
    outers, _ = assemble_rings([c for r, c in members if r in ("outer", "")])
    inners, _ = assemble_rings([c for r, c in members if r == "inner"])
    leftovers = assemble_rings([c for r, c in members if r in ("outer", "")])[1]
    feats = []
    for i, ring in enumerate(outers):
        holes = [h for h in inners if point_in_ring(h[0], ring)]
        feats.append(Feature(f"r{rid}#{i}", tags, "polygon", ring, holes))
    return feats, leftovers


def read_overpass_json(data):
    els = data.get("elements", [])
    nodes = {e["id"]: (e["lat"], e["lon"]) for e in els if e["type"] == "node" and "lat" in e}
    way_coords, feats, notes = {}, [], {"unresolved_ways": 0, "open_relation_fragments": 0}
    for e in els:
        if e["type"] != "way":
            continue
        if e.get("geometry"):
            coords = [(g["lat"], g["lon"]) for g in e["geometry"] if g]
        else:
            coords = [nodes[n] for n in e.get("nodes", []) if n in nodes]
        if len(coords) < 2:
            notes["unresolved_ways"] += 1
            continue
        way_coords[e["id"]] = coords
        if e.get("tags"):
            feats.append(_way_feature(e["id"], e["tags"], coords))
    for e in els:
        if e["type"] == "node" and e.get("tags"):
            feats.append(Feature(f"n{e['id']}", e["tags"], "point", (e["lat"], e["lon"])))
        elif e["type"] == "relation" and e.get("tags", {}).get("type") in ("multipolygon", "boundary"):
            mem = []
            for m in e.get("members", []):
                if m.get("type") != "way":
                    continue
                if m.get("geometry"):
                    mem.append((m.get("role", ""), [(g["lat"], g["lon"]) for g in m["geometry"] if g]))
                elif m["ref"] in way_coords:
                    mem.append((m.get("role", ""), way_coords[m["ref"]]))
            fs, left = _relation_features(e["id"], e["tags"], mem)
            feats += fs
            notes["open_relation_fragments"] += left
            if left and not fs:
                notes.setdefault("open_relations", []).append(e["id"])
    return feats, notes


def read_osm_xml(root):
    nodes, ways, feats, notes = {}, {}, [], {"unresolved_ways": 0, "open_relation_fragments": 0}
    for n in root.findall("node"):
        nodes[n.get("id")] = (float(n.get("lat")), float(n.get("lon")))
    for w in root.findall("way"):
        coords = [nodes[nd.get("ref")] for nd in w.findall("nd") if nd.get("ref") in nodes]
        if len(coords) < 2:
            notes["unresolved_ways"] += 1
            continue
        ways[w.get("id")] = coords
        tags = {t.get("k"): t.get("v") for t in w.findall("tag")}
        if tags:
            feats.append(_way_feature(w.get("id"), tags, coords))
    for n in root.findall("node"):
        tags = {t.get("k"): t.get("v") for t in n.findall("tag")}
        if tags:
            feats.append(Feature(f"n{n.get('id')}", tags, "point", (float(n.get("lat")), float(n.get("lon")))))
    for r in root.findall("relation"):
        tags = {t.get("k"): t.get("v") for t in r.findall("tag")}
        if tags.get("type") not in ("multipolygon", "boundary"):
            continue
        mem = [(m.get("role", ""), ways[m.get("ref")]) for m in r.findall("member") if m.get("type") == "way" and m.get("ref") in ways]
        fs, left = _relation_features(r.get("id"), tags, mem)
        feats += fs
        notes["open_relation_fragments"] += left
        if left and not fs:
            notes.setdefault("open_relations", []).append(int(r.get("id")))
    return feats, notes


def _norm_id(raw, fallback):
    s = str(raw if raw is not None else fallback)
    m = re.match(r"^(node|way|relation)/(\d+)$", s)
    return {"node": "n", "way": "w", "relation": "r"}[m.group(1)] + m.group(2) if m else s


def read_geojson(data):
    feats, notes = [], {"unresolved_ways": 0, "open_relation_fragments": 0, "skipped_geometries": 0}
    for i, f in enumerate(data.get("features", [])):
        g = f.get("geometry") or {}
        props = f.get("properties") or {}
        tags = props.get("tags") if isinstance(props.get("tags"), dict) else {k: v for k, v in props.items() if not k.startswith("@")}
        fid = _norm_id(f.get("id", props.get("@id")), f"g{i}")
        ll = lambda c: (c[1], c[0])
        t, c = g.get("type"), g.get("coordinates")
        if t == "Point":
            feats.append(Feature(fid, tags, "point", ll(c)))
        elif t == "LineString":
            feats.append(Feature(fid, tags, "line", [ll(p) for p in c]))
        elif t in ("Polygon", "MultiPolygon"):
            polys = [c] if t == "Polygon" else c
            for k, poly in enumerate(polys):
                ring = [ll(p) for p in poly[0]]
                if ring and _key(ring[0]) == _key(ring[-1]):
                    ring = ring[:-1]
                holes = [[ll(p) for p in h[:-1]] for h in poly[1:]]
                feats.append(Feature(fid if len(polys) == 1 else f"{fid}#{k}", tags, "polygon", ring, holes))
        else:
            notes["skipped_geometries"] += 1
    return feats, notes


def read_file(path):
    """Detect the format and return (features, notes, format name)."""
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    head = text.lstrip()[:1]
    if head == "<":
        return (*read_osm_xml(ET.fromstring(text)), "osm-xml")
    data = json.loads(text)
    if "elements" in data:
        return (*read_overpass_json(data), "overpass-json")
    if "features" in data:
        return (*read_geojson(data), "geojson")
    raise ValueError(f"{p.name}: not Overpass JSON (elements), OSM XML, or GeoJSON (features)")
