"""Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
"""
"""A synthetic OSM extract with real structure and awkward details, written in three formats from one model.

Layout (before rotation, metres east u and north v): 3 x 3 blocks of 150 x 110 m between four residential streets each way.
The whole grid is rotated by `angle_deg` and placed at (lat0, lon0), so a naive axis-aligned render would fit almost no building.
It is NOT real data: it exists to test the ingest on the shapes of real data. Real extracts need the user's own Overpass run.
"""
import json
import math
import xml.etree.ElementTree as ET

LAT0, LON0 = 50.8795, 4.3290          # near Jette, Brussels
M_LAT = 111320.0


class Model:
    def __init__(self, angle_deg=37.0):
        self.a = math.radians(angle_deg)
        self.ways, self.nodes, self.rels, self._id = [], [], [], 1000

    def ll(self, u, v):
        e = u * math.cos(self.a) - v * math.sin(self.a)
        n = u * math.sin(self.a) + v * math.cos(self.a)
        lat = LAT0 + n / M_LAT
        return (lat, LON0 + e / (M_LAT * math.cos(math.radians(LAT0))))

    def nid(self):
        self._id += 1
        return self._id

    def way(self, tags, pts, poly=False):
        i = self.nid()
        ll = [self.ll(*p) for p in pts]
        if poly:
            ll = ll + [ll[0]]
        self.ways.append({"id": i, "tags": tags, "pts": ll, "poly": poly})
        return i

    def rect(self, tags, u0, v0, w, h, rot_deg=0.0):
        c, s = math.cos(math.radians(rot_deg)), math.sin(math.radians(rot_deg))
        pts = [(u0 + x * c - y * s, v0 + x * s + y * c) for x, y in ((0, 0), (w, 0), (w, h), (0, h))]
        return self.way(tags, pts, poly=True)

    def node(self, tags, u, v):
        self.nodes.append({"id": self.nid(), "tags": tags, "pt": self.ll(u, v)})

    def multipolygon(self, tags, outer_pts, inner_pts):
        o = self.way({}, outer_pts, poly=True)
        i = self.way({}, inner_pts, poly=True)
        self.rels.append({"id": self.nid(), "tags": dict(tags, type="multipolygon"), "members": [("outer", o), ("inner", i)]})
        for w in self.ways:                      # member ways of a relation carry no tags of their own
            if w["id"] in (o, i):
                w["member_only"] = True


def build(angle_deg=37.0):
    m = Model(angle_deg)
    # ---- streets ----
    for k, v in enumerate((0, 110, 220, 330)):
        if k == 1:
            m.way({"highway": "secondary", "name": "Rue du Tram", "lanes": "2", "cycleway:right": "lane"}, [(0, v), (450, v)])
            m.way({"railway": "tram"}, [(0, v - 1.7), (450, v - 1.7)])
            m.way({"railway": "tram"}, [(0, v + 1.7), (450, v + 1.7)])
        else:
            m.way({"highway": "residential", "name": f"Rue {k}"}, [(0, v), (225, v), (450, v)])
    for k, u in enumerate((0, 150, 300, 450)):
        if k == 2:
            m.way({"highway": "tertiary", "name": "Avenue large", "width": "11"}, [(u, 0), (u, 330)])
            m.way({"highway": "cycleway", "name": "Piste"}, [(u + 12, 0), (u + 12, 330)])
        else:
            m.way({"highway": "residential"}, [(u, 0), (u, 165), (u, 330)])
    m.way({"highway": "footway"}, [(10, 10), (60, 60)])                                         # skipped
    m.way({"highway": "service", "service": "driveway"}, [(20, 20), (20, 40)])                  # skipped
    m.way({"highway": "residential", "tunnel": "yes"}, [(500, 0), (500, 100)])                  # skipped
    m.way({"highway": "pedestrian", "name": "Rue pietonne"}, [(75, 112), (75, 218)])
    m.way({"railway": "tram"}, [(-60, 0), (-60, 330)])                                          # a tram track with no road
    m.way({"railway": "tram"}, [(-56.6, 0), (-56.6, 330)])                                      # the other direction
    # ---- buildings, block by block ----
    n = 0
    for bi in range(3):
        for bj in range(3):
            u0, v0 = bi * 150 + 12, bj * 110 + 12
            for t in range(6):                                                                  # a terrace along the bottom
                m.rect({"building": "terrace", "building:levels": "3"}, u0 + t * 8.2, v0, 8, 14)
            for t in range(5):                                                                  # houses along the top, no levels
                m.rect({"building": "house"}, u0 + t * 10, v0 + 80, 9, 11)
            m.rect({"building": "apartments", "building:levels": str(4 + (bi + bj) % 3), "name": f"Residence {bi}{bj}"}, u0, v0 + 22, 14, 20)
            m.rect({"building": "retail", "shop": "bakery"}, u0 + 100, v0 + 20, 12, 10)
            m.rect({"building": "yes", "height": "24 m"}, u0 + 100, v0 + 40, 14, 14)
            n += 1
    m.rect({"building": "warehouse"}, 30, 50, 30, 18)
    m.rect({"building": "yes", "building:levels": "14"}, 330, 130, 20, 20)                       # a tower
    m.rect({"building": "church", "name": "Eglise"}, 190, 140, 16, 30)
    m.rect({"building": "yes"}, 400, 250, 2, 2)                                                 # too small: skipped
    m.rect({"building": "roof"}, 20, 270, 10, 6)                                                # skipped
    m.rect({"building": "construction"}, 40, 270, 10, 6)                                        # skipped
    for k in range(4):                                                                          # buildings that do not follow the grid
        m.rect({"building": "house", "building:levels": "2"}, 100 + k * 14, 280, 9, 11, rot_deg=33)
    m.multipolygon({"building": "apartments", "building:levels": "5"}, [(220, 20), (250, 20), (250, 50), (220, 50)], [(230, 30), (240, 30), (240, 40), (230, 40)])
    m.rect({"building": "yes"}, 2000, 2000, 10, 10)                                             # far outside the boundary
    # ---- green and water ----
    m.rect({"leisure": "park", "name": "Parc"}, 160, 120, 130, 90)
    m.rect({"natural": "water"}, 340, 20, 40, 30)
    m.rect({"place": "square", "name": "Place"}, 20, 230, 30, 30)
    m.rect({"natural": "wood"}, 380, 240, 50, 50)
    m.rect({"leisure": "garden"}, 60, 180, 20, 20)
    m.rect({"landuse": "grass"}, 10, 100, 4, 4)                                                 # too small: skipped
    m.rect({"natural": "wood", "name": "Edge wood"}, 500, 300, 100, 60)                        # crosses the boundary at u=550: cut, not dropped
    m.rect({"landuse": "railway"}, -150, 395, 760, 20)                                          # railway land along the north edge
    m.way({"railway": "rail"}, [(-200, 405), (700, 405)])                                       # a main line crossing the whole town
    m.way({"railway": "rail", "tunnel": "yes"}, [(0, 300), (100, 300)])                         # underground: skipped
    # ---- trees ----
    for k, tags in enumerate([{"species": "Platanus x hispanica"}, {"genus": "Phoenix"}, {"species": "Pinus pinea"}, {"species": "Quercus robur", "height": "14"},
                              {"leaf_type": "needleleaved"}, {}, {}, {}]):
        m.node(dict(tags, natural="tree"), 170 + k * 12, 125)
    m.way({"natural": "tree_row", "spacing": "10"}, [(10, 108), (110, 108)])
    # ---- boundary ----
    south = m.way({}, [(-100, -100), (550, -100), (550, 430)])
    north = m.way({}, [(550, 430), (-100, 430), (-100, -100)])
    m.rels.append({"id": 99001, "tags": {"type": "boundary", "boundary": "administrative", "admin_level": "8", "name": "Fixtureville"}, "members": [("outer", south), ("outer", north)]})
    for w in m.ways:
        if w["id"] in (south, north):
            w["member_only"] = True
    return m


def _members(m, rel):
    return {w["id"]: w for w in m.ways}


def to_overpass_json(m):
    byid = {w["id"]: w for w in m.ways}
    els = []
    for w in m.ways:
        e = {"type": "way", "id": w["id"], "geometry": [{"lat": a, "lon": b} for a, b in w["pts"]]}
        if not w.get("member_only"):
            e["tags"] = w["tags"]
        els.append(e)
    for nd in m.nodes:
        els.append({"type": "node", "id": nd["id"], "lat": nd["pt"][0], "lon": nd["pt"][1], "tags": nd["tags"]})
    for r in m.rels:
        els.append({"type": "relation", "id": r["id"], "tags": r["tags"],
                    "members": [{"type": "way", "ref": ref, "role": role, "geometry": [{"lat": a, "lon": b} for a, b in byid[ref]["pts"]]} for role, ref in r["members"]]})
    return {"version": 0.6, "elements": els}


def to_osm_xml(m):
    root = ET.Element("osm", version="0.6")
    ids, order = {}, []
    for w in m.ways:
        for p in w["pts"]:
            ids.setdefault((round(p[0], 8), round(p[1], 8)), len(ids) + 1)
    for (la, lo), i in ids.items():
        ET.SubElement(root, "node", id=str(i), lat=repr(la), lon=repr(lo))
    for nd in m.nodes:
        e = ET.SubElement(root, "node", id=str(nd["id"]), lat=repr(nd["pt"][0]), lon=repr(nd["pt"][1]))
        for k, v in nd["tags"].items():
            ET.SubElement(e, "tag", k=k, v=v)
    for w in m.ways:
        e = ET.SubElement(root, "way", id=str(w["id"]))
        for p in w["pts"]:
            ET.SubElement(e, "nd", ref=str(ids[(round(p[0], 8), round(p[1], 8))]))
        if not w.get("member_only"):
            for k, v in w["tags"].items():
                ET.SubElement(e, "tag", k=k, v=v)
    for r in m.rels:
        e = ET.SubElement(root, "relation", id=str(r["id"]))
        for role, ref in r["members"]:
            ET.SubElement(e, "member", type="way", ref=str(ref), role=role)
        for k, v in r["tags"].items():
            ET.SubElement(e, "tag", k=k, v=v)
    return ET.tostring(root, encoding="unicode")


def to_geojson(m):
    byid = {w["id"]: w for w in m.ways}
    lonlat = lambda pts: [[b, a] for a, b in pts]
    feats = []
    for w in m.ways:
        if w.get("member_only"):
            continue
        g = {"type": "Polygon", "coordinates": [lonlat(w["pts"])]} if w["poly"] else {"type": "LineString", "coordinates": lonlat(w["pts"])}
        feats.append({"type": "Feature", "id": f"w{w['id']}", "properties": w["tags"], "geometry": g})
    for nd in m.nodes:
        feats.append({"type": "Feature", "id": f"n{nd['id']}", "properties": nd["tags"], "geometry": {"type": "Point", "coordinates": [nd["pt"][1], nd["pt"][0]]}})
    for r in m.rels:
        if r["tags"].get("type") == "multipolygon":
            outer = [lonlat(byid[ref]["pts"]) for role, ref in r["members"] if role == "outer"]
            inner = [lonlat(byid[ref]["pts"]) for role, ref in r["members"] if role == "inner"]
            feats.append({"type": "Feature", "id": f"r{r['id']}", "properties": r["tags"], "geometry": {"type": "Polygon", "coordinates": outer + inner}})
        else:                                                   # a boundary: assembled from its outer ways, as osmium would
            ring = []
            for role, ref in r["members"]:
                ring += byid[ref]["pts"] if not ring else byid[ref]["pts"][1:]
            feats.append({"type": "Feature", "id": f"r{r['id']}", "properties": r["tags"], "geometry": {"type": "Polygon", "coordinates": [lonlat(ring)]}})
    return {"type": "FeatureCollection", "features": feats}


def write_all(dirpath, angle_deg=37.0):
    from pathlib import Path
    d = Path(dirpath)
    m = build(angle_deg)
    paths = {"overpass-json": d / "fixture.json", "osm-xml": d / "fixture.osm", "geojson": d / "fixture.geojson"}
    paths["overpass-json"].write_text(json.dumps(to_overpass_json(m)))
    paths["osm-xml"].write_text(to_osm_xml(m))
    paths["geojson"].write_text(json.dumps(to_geojson(m)))
    return paths


def big_overpass(n_blocks=40, angle_deg=21.0):
    """A large synthetic extract for timing: n_blocks x n_blocks blocks of terraces and houses on a rotated grid."""
    m = Model(angle_deg)
    for i in range(n_blocks + 1):
        m.way({"highway": "residential"}, [(0, i * 100), (n_blocks * 140, i * 100)])
        m.way({"highway": "residential"}, [(i * 140, 0), (i * 140, n_blocks * 100)])
    for bi in range(n_blocks):
        for bj in range(n_blocks):
            u0, v0 = bi * 140 + 10, bj * 100 + 10
            for t in range(10):
                m.rect({"building": "terrace", "building:levels": "3"}, u0 + t * 8.4, v0, 8, 14)
                m.rect({"building": "house"}, u0 + t * 8.4, v0 + 70, 8, 12)
    return to_overpass_json(m)
