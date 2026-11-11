"""Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
Renderer-dependent tests dropped; counts updated (construction kept).
"""
"""The OSM ingest: readers, rotation, classification, clipping, trees, report, CLI, and the real renderer.

The fixture is synthetic (see osm_fixture.py). It has the shapes of real OSM data, not real data: the live Overpass service
and openstreetmap.org are not reachable from the build environment."""
import json
import math
import os
import shutil
import time
from collections import Counter
from pathlib import Path

import pytest

import osm_fixture as F
from ingest import __main__ as cli
from ingest import build, classify, geo, query, readers, report

ROOT = Path(__file__).resolve().parents[1]
REL = 99001


@pytest.fixture(scope="module")
def files(tmp_path_factory):
    return F.write_all(tmp_path_factory.mktemp("osm"))


@pytest.fixture(scope="module")
def result(files):
    return build.ingest(files["overpass-json"], boundary_relation=REL)


def _near(a, b, tol=0.15):
    return math.hypot(a[0] - b[0], a[1] - b[1]) <= tol


def _centre(b):
    fp = b["footprint"]
    return (sum(p[0] for p in fp) / len(fp), sum(p[1] for p in fp) / len(fp))


# ---------- readers ----------
@pytest.mark.parametrize("fmt", ["osm-xml", "geojson"])
def test_all_three_formats_give_the_same_scene(files, result, fmt):
    a, ra = result
    b, rb = build.ingest(files[fmt], boundary_relation=REL)
    assert rb["input"]["format"] == fmt and ra["input"]["format"] == "overpass-json"
    assert ra["counts"] == rb["counts"] and abs(a["area"]["rotation_deg"] - b["area"]["rotation_deg"]) < 0.01
    assert Counter(r["class"] for r in a["roads"]) == Counter(r["class"] for r in b["roads"])
    assert Counter(l["kind"] for l in a["landuse"]) == Counter(l["kind"] for l in b["landuse"])
    used = set()
    for x in a["buildings"]:                                   # match each building to its twin by position
        y = next(i for i, c in enumerate(b["buildings"]) if i not in used and _near(_centre(x), _centre(c)))
        used.add(y)
        assert (x["levels"], x["archetype"]) == (b["buildings"][y]["levels"], b["buildings"][y]["archetype"])
    assert len(used) == len(a["buildings"])


def test_overpass_json_without_geometry_resolves_nodes():
    data = {"elements": [{"type": "node", "id": 1, "lat": 50.0, "lon": 4.0}, {"type": "node", "id": 2, "lat": 50.0, "lon": 4.001},
                         {"type": "node", "id": 3, "lat": 50.001, "lon": 4.001}, {"type": "node", "id": 4, "lat": 50.001, "lon": 4.0},
                         {"type": "way", "id": 9, "nodes": [1, 2, 3, 4, 1], "tags": {"building": "yes"}}]}
    feats, notes = readers.read_overpass_json(data)
    assert len(feats) == 1 and feats[0].kind == "polygon" and len(feats[0].coords) == 4 and notes["unresolved_ways"] == 0


def test_ways_with_no_geometry_are_counted_not_crashed():
    feats, notes = readers.read_overpass_json({"elements": [{"type": "way", "id": 1, "nodes": [5, 6], "tags": {"building": "yes"}}]})
    assert feats == [] and notes["unresolved_ways"] == 1


def test_rings_assemble_from_fragments_in_any_order_and_direction():
    ring, left = readers.assemble_rings([[(0, 0), (0, 1)], [(1, 1), (0, 1)], [(1, 1), (1, 0), (0, 0)]])
    assert len(ring) == 1 and left == 0 and len(ring[0]) == 4
    ring, left = readers.assemble_rings([[(0, 0), (0, 1)], [(0, 1), (1, 1)]])
    assert ring == [] and left == 1


def test_a_closed_highway_is_a_line_and_a_closed_building_is_a_polygon():
    sq = [(0, 0), (0, 1), (1, 1), (1, 0), (0, 0)]
    assert readers._way_feature(1, {"highway": "residential"}, sq).kind == "line"
    assert readers._way_feature(2, {"building": "yes"}, sq).kind == "polygon"
    assert readers._way_feature(3, {"highway": "pedestrian", "area": "yes"}, sq).kind == "polygon"


def test_unreadable_input_fails_with_a_clear_message(tmp_path):
    p = tmp_path / "x.json"
    p.write_text('{"hello": 1}')
    with pytest.raises(ValueError, match="not Overpass JSON"):
        build.ingest(p)
    p.write_text(json.dumps({"elements": [{"type": "node", "id": 1, "lat": 1, "lon": 1, "tags": {"shop": "bakery"}}]}))
    with pytest.raises(build.IngestError, match="nothing to draw"):
        build.ingest(p)


# ---------- geometry and the frame ----------
def test_local_frame_round_trips_and_rotates_the_dominant_direction_onto_x():
    f = geo.LocalFrame(50.88, 4.33, 37.0)
    lat, lon = f.latlon(*f.xy(50.8812, 4.3321))
    assert abs(lat - 50.8812) < 1e-9 and abs(lon - 4.3321) < 1e-9
    x0, y0 = f.xy(50.88, 4.33)
    assert abs(x0) < 1e-6 and abs(y0) < 1e-6
    # a segment running 37 degrees north of east lies at -37 degrees in the (east, south) frame; rotating by -37 puts it on the x axis
    a = math.radians(37.0)
    rot = geo.LocalFrame(50.88, 4.33, -37.0)
    p = rot.xy(50.88, 4.33)
    q = rot.xy(50.88 + 0.0005 * math.sin(a), 4.33 + 0.0005 * math.cos(a) / math.cos(math.radians(50.88)))
    dx, dy = q[0] - p[0], q[1] - p[1]
    assert dx > 40 and abs(dy) < 1e-3 * dx
    flat = geo.LocalFrame(50.88, 4.33, 0.0)
    p0, q0 = flat.xy(50.88, 4.33), flat.xy(50.88 + 0.0005 * math.sin(a), 4.33 + 0.0005 * math.cos(a) / math.cos(math.radians(50.88)))
    assert abs(geo.axis_deviation_deg(math.atan2(q0[1] - p0[1], q0[0] - p0[0])) - 37.0) < 1.0, "unrotated, the same segment is 37 degrees off the axes"


def test_min_rect_and_axis_deviation():
    th, a, b, area = geo.min_rect([(0, 0), (10, 0), (10, 4), (0, 4), (5, 2)])
    assert abs(a * b - 40) < 1e-6 and geo.axis_deviation_deg(th) < 1e-6
    c, s = math.cos(math.radians(20)), math.sin(math.radians(20))
    th2, *_ = geo.min_rect([(x * c - y * s, x * s + y * c) for x, y in [(0, 0), (10, 0), (10, 4), (0, 4)]])
    assert abs(geo.axis_deviation_deg(th2) - 20) < 1e-6 and abs(geo.axis_deviation_deg(th2, 20.0)) < 1e-6


def test_simplify_and_resample():
    assert geo.simplify_ring([(0, 0), (5, 0.001), (10, 0), (10, 10), (0, 10)]) == [(0, 0), (10, 0), (10, 10), (0, 10)]
    pts = geo.resample_line([(0, 0), (100, 0)], 10)
    assert len(pts) == 10 and abs(pts[1][0] - pts[0][0] - 10) < 1e-6


@pytest.mark.parametrize("angle", [0.0, 17.0, 37.0, 74.0])
def test_rotation_is_recovered_from_the_data_at_any_grid_angle(tmp_path, angle):
    p = F.write_all(tmp_path, angle)["overpass-json"]
    scene, rep = build.ingest(p, boundary_relation=REL)
    expect = -angle                                            # y points south in the frame, so a counter-clockwise grid reads as negative
    err = abs(((scene["area"]["rotation_deg"] - expect + 45) % 90) - 45)
    assert err < 1.5, f"asked for {expect}, got {scene['area']['rotation_deg']}"
    assert rep["estimated_asset_share"]["rotated"] >= 0.95
    if angle > 14:
        assert rep["estimated_asset_share"]["unrotated"] < 0.1, "an unrotated frame should fit almost nothing"


def test_rotation_can_be_switched_off_or_set(files):
    off, r0 = build.ingest(files["overpass-json"], rotation="none", boundary_relation=REL)
    assert off["area"]["rotation_deg"] == 0 and r0["estimated_asset_share"]["rotated"] < 0.1
    man, r1 = build.ingest(files["overpass-json"], rotation="-30", boundary_relation=REL)
    assert man["area"]["rotation_deg"] == -30 and "set by the user" in r1["frame"]["how"]


def test_the_report_lists_every_candidate_rotation_with_its_share(result):
    rows = result[1]["frame"]["candidates"]
    assert {r["source"] for r in rows} >= {"none", "building edges", "road segments"}
    best = max(r["asset_share"] for r in rows)
    assert result[1]["estimated_asset_share"]["rotated"] >= best - 0.03 and rows[0]["asset_share"] == 0


def test_north_direction_is_reported_and_matches_the_geometry(files):
    # unrotated, north is the scene's -y: up and to the right on an isometric screen, 60 degrees clockwise from the top
    none, _ = build.ingest(files["overpass-json"], rotation="none", boundary_relation=REL)
    assert abs(none["area"]["north_on_screen_deg"] - 60.0) < 0.1
    # rotated by -30: north = (0.5, -0.866) in the scene, which projects to atan2(1.183, 0.183) = 81.2 degrees
    r30, _ = build.ingest(files["overpass-json"], rotation="-30", boundary_relation=REL)
    assert abs(r30["area"]["north_on_screen_deg"] - 81.2) < 0.2


# ---------- classification ----------
def test_storeys_come_from_tags_then_heights_then_visible_defaults(result):
    scene, rep = result
    assert rep["levels_sources"] == {"tag": 69, "type-default": 56, "height": 9, "global-default": 1}
    by_name = {b["osm"].get("name"): b for b in scene["buildings"] if b["osm"].get("name")}
    assert by_name["Eglise"]["levels"] == 1 and by_name["Residence 00"]["levels"] == 4
    assert any(b["levels"] == 8 and b["osm"]["levels_source"] == "height" for b in scene["buildings"])        # 24 m at 3.1 m per storey
    rules = [r for c, r, n in rep["assumptions"] if c == "storeys"]
    assert any("building=house with no levels" in r for r in rules) and any("height tag" in r for r in rules)


def test_archetypes_follow_tags_and_storeys(result):
    c = Counter(b["archetype"] for b in result[0]["buildings"])
    assert c == {"terrace": 54, "villa": 49, "block": 10, "auto": 11, "shophouse": 9, "shed": 1, "tower": 1}
    a = classify.Assumptions()
    assert classify.building_archetype({"building": "yes"}, 12, a) == "tower"
    assert classify.building_archetype({"building": "warehouse"}, 12, a) == "shed"
    assert classify.building_archetype({"building": "yes", "shop": "x"}, 2, a) == "shophouse"
    assert classify.building_archetype({"building": "residential"}, 5, a) == "block" and classify.building_archetype({"building": "residential"}, 2, a) == "auto"


def test_things_that_are_not_buildings_are_left_out_and_counted(result):
    sk = result[1]["skipped"]
    for k in ("building=roof", "buildings outside the clip", "building smaller than 8 m2", "landuse smaller than 20 m2",
              "highway=footway (not drivable)", "service road: driveway, parking aisle or private", "road in a tunnel or below ground"):
        assert sk.get(k) == 1, (k, sk)
    ids = {b["id"] for b in result[0]["buildings"]}
    assert len(ids) == len(result[0]["buildings"]) == 135
    assert any(b["economic_class"] == "construction" and b["economic_class_source"] == "tag" for b in result[0]["buildings"])


def test_roads_classes_widths_cycle_lanes_and_trams(result):
    roads = {r["id"]: r for r in result[0]["roads"]}
    names = {r.get("name"): r for r in roads.values() if r.get("name")}
    tram = names["Rue du Tram"]
    assert tram["class"] == "avenue" and tram["tram"] is True and tram["cycle"] is True and tram["width"] >= 8       # lanes=2, cycleway:right=lane
    big = names["Avenue large"]
    assert big["class"] == "avenue" and big["width"] == 11 and big["cycle"] is False and big["tram"] is False
    assert names["Piste"]["class"] == "cycle" and names["Rue pietonne"]["class"] == "pedestrian"
    cls = Counter(r["class"] for r in roads.values())
    assert cls == {"local": 6, "avenue": 2, "cycle": 1, "pedestrian": 1, "tramway": 1}, cls
    standalone = [r for r in roads.values() if r["class"] == "tramway"]
    assert len(standalone) == 1 and standalone[0]["tram"] is True, "two directions of one tram line merge into one track"
    assert all(len(r["pts"]) >= 2 for r in roads.values())


def test_tram_lines_are_matched_to_the_road_they_run_along_by_position_and_direction():
    road = [(0, 0), (100, 0)]
    idx = build.SegIndex()
    idx.add(0, 3, 100, 3)
    assert idx.near(50, 0, 9.0, 0.0) and not idx.near(50, 0, 9.0, math.radians(60)) and not idx.near(50, 20, 9.0, 0.0)


def test_landuse_kinds_and_draw_order(result):
    lu = result[0]["landuse"]
    assert Counter(l["kind"] for l in lu) == {"park": 3, "garden": 1, "rail": 1, "water": 1, "square": 1}
    order = [l["kind"] for l in lu]
    assert order == sorted(order, key=lambda k: build.LAND_ORDER[k]), "squares are drawn last, over parks"


def test_trees_species_scale_rows_and_scatter(result):
    scene, rep = result
    mapped = [t for t in scene["trees"][:8]]
    kinds = [t[2] if len(t) > 2 else None for t in mapped]
    assert kinds[:5] == ["plane", "palm", "umbrella", "oak", "conifer"] and kinds[5:] == [None, None, None]
    assert mapped[3][3] == 1.2 and mapped[0][3] == 1.0                            # a 14 m oak is drawn at the large size
    row = scene["trees"][8:8 + rep["counts"]["trees_in_rows"]]
    assert 9 <= len(row) <= 10
    gaps = [math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(row, row[1:])]
    assert all(9.0 < g < 11.0 for g in gaps), gaps
    assert rep["counts"]["trees_scattered"] > 20
    assert any(c == "tree kind" for c, r, n in rep["assumptions"])


def test_scatter_is_deterministic_seeded_capped_and_can_be_switched_off(files):
    a, _ = build.ingest(files["overpass-json"], boundary_relation=REL, seed=7)
    b, _ = build.ingest(files["overpass-json"], boundary_relation=REL, seed=7)
    c, _ = build.ingest(files["overpass-json"], boundary_relation=REL, seed=8)
    off, r = build.ingest(files["overpass-json"], boundary_relation=REL, scatter=False)
    assert a["trees"] == b["trees"] and a["trees"] != c["trees"]
    assert r["counts"]["trees_scattered"] == 0 and len(off["trees"]) == 17
    assert len(a["trees"]) - 17 <= build.SCATTER_CAP_TOTAL


def test_a_park_that_already_has_mapped_trees_is_not_scattered_into(result):
    rules = [r for c, r, n in result[1]["assumptions"] if c == "scatter"]
    assert any("already has mapped trees" in r for r in rules)
    park = next(l for l in result[0]["landuse"] if l["kind"] == "park" and len(l["footprint"]) == 4 and geo.ring_area(l["footprint"]) > 8000)
    inside = [t for t in result[0]["trees"][17:] if geo.point_in_ring((t[0], t[1]), park["footprint"])]
    assert inside == []


def test_courtyards_are_noted_and_the_outer_ring_is_kept(result):
    assert any(c == "courtyards" for c, r, n in result[1]["assumptions"])
    mp = [b for b in result[0]["buildings"] if abs(geo.ring_area(b["footprint"]) - 900) < 40]
    assert len(mp) == 1                                                            # the 30 x 30 outer ring, hole ignored


# ---------- clipping ----------
def test_boundary_clip_and_its_absence(files):
    scene, rep = build.ingest(files["overpass-json"], boundary_relation=REL)
    assert scene["area"]["name"] == "Fixtureville" and scene["area"]["osm_relation"] == REL and rep["clip"]["boundary_name"] == "Fixtureville"
    free, rf = build.ingest(files["overpass-json"])
    assert rf["counts"]["buildings"] == 136 and any("administrative boundary" in w for w in rf["warnings"])
    with pytest.raises(build.IngestError, match="boundary relation 1234 is not in the file"):
        build.ingest(files["overpass-json"], boundary_relation=1234)


def test_bbox_clip_and_max_buildings(files):
    full, _ = build.ingest(files["overpass-json"], boundary_relation=REL)
    o = full["area"]["origin"]
    small, r = build.ingest(files["overpass-json"], boundary_relation=REL, bbox=(o["lat"] - 0.0003, o["lon"] - 0.0004, o["lat"] + 0.0003, o["lon"] + 0.0004))
    assert 0 < len(small["buildings"]) < len(full["buildings"])
    few, rf = build.ingest(files["overpass-json"], boundary_relation=REL, max_buildings=40)
    assert len(few["buildings"]) == 40 and any("--max-buildings" in k for k in rf["skipped"])


# ---------- the scene, the report and the query ----------
def test_scene_shape_and_attribution(result):
    scene = result[0]
    assert set(scene) == {"area", "roads", "buildings", "structures", "landuse", "trees", "rails"}
    a = scene["area"]
    assert a["source"] == "osm" and "OpenStreetMap contributors" in a["attribution"] and a["extent_m"][0] > 300
    b = scene["buildings"][0]
    assert b["state"] == "none" and b["investor"] is False and len(b["footprint"]) >= 3
    json.dumps(scene)


def test_report_lists_assumptions_and_what_to_ask(result):
    md = report.report_markdown(*result)
    for s in ("## Assumptions to confirm", "## The frame", "## Left out", "### Storeys", "OpenStreetMap contributors", "Not inferred, ask the user",
              "Drive side", "rotated by **", "Estimated share of buildings that will use an asset"):
        assert s.lower() in md.lower(), s
    assert "building=house with no levels or height: assumed 2" in md and "highway=residential -> local" in md


def test_overpass_query_for_a_relation_and_a_box():
    q = query.overpass_query(relation=58258)
    assert q.startswith("[out:json]") and "rel(58258);\nmap_to_area->.a;" in q and q.strip().endswith("out geom;")
    assert q.count("(") == q.count(")") and q.count("{") == q.count("}") and '["railway"="tram"](area.a)' in q and 'node["natural"="tree"](area.a)' in q
    assert q.count("(area.a)") >= 12
    b = query.overpass_query(bbox=(50.87, 4.31, 50.90, 4.36))
    assert "(50.870000,4.310000,50.900000,4.360000)" in b and "map_to_area" not in b and "area.a" not in b
    both = query.overpass_query(relation=58258, bbox=(1, 2, 3, 4))
    assert "map_to_area" in both
    with pytest.raises(ValueError):
        query.overpass_query()


# ---------- the command line ----------
def test_cli_ingest_writes_scene_and_reports(files, tmp_path, capsys):
    out = tmp_path / "scene.json"
    cli.main(["ingest", str(files["overpass-json"]), "--out", str(out), "--boundary-relation", str(REL)])
    text = capsys.readouterr().out
    assert "135 buildings" in text and "estimated asset share 97%" in text and "unrotated 0%" in text
    assert out.exists() and (tmp_path / "scene_report.md").exists() and json.loads((tmp_path / "scene_report.json").read_text())["counts"]["buildings"] == 135
    assert json.loads(out.read_text())["area"]["source"] == "osm"


def test_cli_errors_are_clean(files, tmp_path):
    with pytest.raises(SystemExit, match="boundary relation 5 is not in the file"):
        cli.main(["ingest", str(files["overpass-json"]), "--out", str(tmp_path / "s.json"), "--boundary-relation", "5"])
    with pytest.raises(SystemExit, match="--bbox needs south,west,north,east"):
        cli.main(["ingest", str(files["overpass-json"]), "--out", str(tmp_path / "s.json"), "--bbox", "1,2,3"])


def test_cli_osm_query(tmp_path, capsys):
    cli.main(["osm-query", "--relation", "58258"])
    assert "map_to_area" in capsys.readouterr().out
    out = tmp_path / "q.ql"
    cli.main(["osm-query", "--relation", "58258", "--out", str(out)])
    assert out.read_text().startswith("[out:json]") and "overpass-turbo.eu" in capsys.readouterr().out


# ---------- fetching (against a local stand-in for Overpass; the live service is not reachable from the build sandbox) ----------
import http.server
import threading
import urllib.parse

from ingest import fetch


class _FakeOverpass(http.server.BaseHTTPRequestHandler):
    mode, payload, seen = "ok", b"{}", {}

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"])).decode()
        type(self).seen = {"ua": self.headers.get("User-Agent"), "ct": self.headers.get("Content-Type"), "data": urllib.parse.parse_qs(body).get("data", [""])[0]}
        m = type(self).mode
        if m in ("429", "504", "400"):
            self.send_response(int(m)); self.end_headers(); return
        out = {"html": b"<html><body>The server is too busy</body></html>", "ok": type(self).payload,
               "remark": json.dumps({"elements": [{"type": "node", "id": 1, "lat": 1, "lon": 1}], "remark": "runtime error: Query run out of memory"}).encode(),
               "empty": json.dumps({"elements": []}).encode()}[m]
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(out)


@pytest.fixture
def overpass(files):
    srv = http.server.HTTPServer(("127.0.0.1", 0), _FakeOverpass)
    _FakeOverpass.payload = Path(files["overpass-json"]).read_bytes()
    _FakeOverpass.mode = "ok"
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}/api/interpreter"
    srv.shutdown()


def test_fetch_sends_the_query_as_a_form_post_with_a_user_agent_and_saves_the_answer(overpass, tmp_path):
    q = query.overpass_query(relation=REL)
    n = fetch.fetch_overpass(q, tmp_path / "e.json", endpoint=overpass)
    assert n > 100 and _FakeOverpass.seen["data"] == q
    assert "application/x-www-form-urlencoded" in _FakeOverpass.seen["ct"] and "paperdolls-minimal" in _FakeOverpass.seen["ua"]
    scene, _ = build.ingest(tmp_path / "e.json", boundary_relation=REL)
    assert len(scene["buildings"]) == 135, "what was fetched can be ingested"


@pytest.mark.parametrize("mode,words", [("429", "rate limiting"), ("504", "timed out"), ("400", "rejected the query"), ("html", "not JSON"),
                                        ("remark", "runtime error"), ("empty", "no elements")])
def test_fetch_failures_say_what_to_do(overpass, tmp_path, mode, words):
    _FakeOverpass.mode = mode
    with pytest.raises(fetch.FetchError, match=words):
        fetch.fetch_overpass("x", tmp_path / "e.json", endpoint=overpass)
    assert not (tmp_path / "e.json").exists(), "a failed fetch leaves no half-written extract"
    if mode == "html":
        assert (tmp_path / "e.json.raw").exists(), "the raw answer is kept so the failure can be read"


def test_fetch_when_the_server_cannot_be_reached(tmp_path):
    with pytest.raises(fetch.FetchError, match="could not reach.*overpass-turbo.eu"):
        fetch.fetch_overpass("x", tmp_path / "e.json", endpoint="http://127.0.0.1:1/api/interpreter", timeout=3)


def test_cli_osm_fetch(overpass, tmp_path, capsys):
    out = tmp_path / "x.json"
    cli.main(["osm-fetch", "--relation", str(REL), "--out", str(out), "--endpoint", overpass])
    assert out.exists() and f"--boundary-relation {REL}" in capsys.readouterr().out and _FakeOverpass.seen["data"].count("map_to_area") == 1
    _FakeOverpass.mode = "429"
    with pytest.raises(SystemExit, match="fetch failed.*rate limiting"):
        cli.main(["osm-fetch", "--relation", str(REL), "--out", str(tmp_path / "y.json"), "--endpoint", overpass])


def test_a_boundary_that_does_not_close_gets_its_own_error(files, tmp_path):
    data = json.loads(Path(files["overpass-json"]).read_text())
    rel = next(e for e in data["elements"] if e["type"] == "relation" and e["id"] == REL)
    rel["members"] = rel["members"][:1]                       # one of the two outer ways is missing
    p = tmp_path / "cut.json"
    p.write_text(json.dumps(data))
    with pytest.raises(build.IngestError, match="do not close into a ring"):
        build.ingest(p, boundary_relation=REL)
    with pytest.raises(SystemExit, match="do not close into a ring"):
        cli.main(["ingest", str(p), "--out", str(tmp_path / "s.json"), "--boundary-relation", str(REL)])
    scene, rep = build.ingest(p)                               # without the clip it still works, and says why
    assert rep["counts"]["buildings"] == 136 and any("did not close" in w for w in rep["warnings"])


# ---------- the scene entity table: area, centroid, height, levels_assumed, residential, neighbours ----------
def test_buildings_carry_the_entity_table(result):
    scene, rep = result
    for b in scene["buildings"]:
        assert b["area"] == pytest.approx(geo.ring_area(b["footprint"]), rel=0.01, abs=0.2)
        assert _near(b["centroid"], geo.ring_centroid(b["footprint"]), 0.05)
        assert b["height"] > 0 and isinstance(b["levels_assumed"], bool)
        assert b["levels_assumed"] == (b["osm"]["levels_source"] in ("type-default", "global-default"))
        assert b["residential"] in classify.RESIDENTIAL_CLASSES
    assert rep["levels_assumed"] == sum(b["levels_assumed"] for b in scene["buildings"])
    assert sum(rep["residential"].values()) == len(scene["buildings"])


def test_height_comes_from_the_tag_else_the_storeys(result):
    scene, _ = result
    tagged = [b for b in scene["buildings"] if b["osm"]["levels_source"] == "height"]
    assert tagged and all(b["height"] == 24.0 for b in tagged)
    lv = [b for b in scene["buildings"] if b["osm"]["levels_source"] == "tag"]
    assert lv and all(b["height"] == pytest.approx(b["levels"] * classify.M_PER_LEVEL, abs=0.06) for b in lv)


@pytest.mark.parametrize("tags,arch,area,want", [
    ({"building": "house"}, "villa", 90, "residential"), ({"building": "apartments"}, "block", 300, "residential"),
    ({"building": "terrace"}, "terrace", 112, "residential"), ({"building": "church"}, "auto", 400, "other"),
    ({"building": "yes", "shop": "bakery"}, "auto", 120, "other"), ({"building": "yes"}, "shed", 200, "other"),
    ({"building": "yes"}, "auto", 12, "other"), ({"building": "clubhouse"}, "auto", 300, "other"), ({"building": "yes"}, "auto", 150, "probable"), ({}, "auto", 150, "probable"),
])
def test_residential_rule(tags, arch, area, want):
    a = classify.Assumptions()
    assert classify.residential_class(tags, arch, area, a) == want
    assert any(c == "residential" for c, _, _ in a.table())


def test_residential_classes_on_the_fixture(result):
    scene, rep = result
    by = {}
    for b in scene["buildings"]:
        by.setdefault(b["osm"]["building"], set()).add(b["residential"])
    assert by["terrace"] == {"residential"} and by["house"] == {"residential"} and by["apartments"] == {"residential"}
    assert by["retail"] == {"other"} and by["warehouse"] == {"other"} and by["church"] == {"other"} and by["yes"] <= {"probable", "other"}
    assert any(c == "residential" for c, _, _ in rep["assumptions"])


def test_neighbours_are_symmetric_and_the_fixture_terraces_touch_or_nearly(result):
    scene, rep = result
    byid = {b["id"]: b for b in scene["buildings"]}
    for b in scene["buildings"]:
        assert b["id"] not in b["neighbours"]
        for n in b["neighbours"]:
            assert b["id"] in byid[n]["neighbours"]
    terraces = [b for b in scene["buildings"] if b["osm"]["building"] == "terrace"]
    assert sum(1 for b in terraces if b["neighbours"]) > len(terraces) * 0.6              # 8 m wide units on an 8.2 m pitch: 0.2 m gaps
    assert rep["neighbours"]["threshold_m"] == 1.0 and rep["neighbours"]["links"] == sum(len(b["neighbours"]) for b in scene["buildings"]) // 2


def test_neighbour_geometry():
    from ingest import adjacency as adj
    sq = lambda x, y, s=10: [(x, y), (x + s, y), (x + s, y + s), (x, y + s)]
    rings = [sq(0, 0), sq(10.4, 0), sq(12, 0), sq(5, 5, 2), sq(30, 30), sq(8, 8, 10)]     # 1: 0.4 m gap from 0; 3: inside 0; 5: overlaps 0; 2: 2 m gap
    nb = adj.neighbours(rings)
    assert 1 in nb[0] and 0 in nb[1]                       # across a 0.4 m gap
    assert 3 in nb[0] and 0 in nb[3]                       # one inside the other
    assert 5 in nb[0]                                      # overlapping
    assert nb[4] == []                                     # far away
    assert 2 not in nb[0]                                  # 2 m gap, over the threshold
    assert adj.neighbours([sq(0, 0), sq(10, 10)]) == [[1], [0]]       # corner touch


def test_the_report_describes_the_entity_table(result):
    scene, rep = result
    md = report.report_markdown(scene, rep)
    assert "Fields for the model binding" in md and "probable" in md and "neighbours" in md


def test_the_jette_extract_if_it_is_there():
    ex = ROOT / "cache" / "jette-bbox-extract.json"
    if not ex.exists():
        pytest.skip("cache/jette-bbox-extract.json is not in this checkout")
    scene, rep = build.ingest(ex, bbox=(50.874, 4.325, 50.88, 4.338))
    assert len(scene["buildings"]) == 2162
    assert rep["neighbours"]["buildings_with_neighbours"] > 1500 and rep["levels_assumed"] > 1500
    assert set(b["residential"] for b in scene["buildings"]) == {"residential", "probable", "other"}


def test_land_use_crossing_the_boundary_is_cut_not_dropped(result):
    scene, rep = result
    woods = [l for l in scene["landuse"] if l.get("cover") == "wood"]
    assert len(woods) == 2                                       # the inside wood, and the inside part of the edge wood
    edge = max(woods, key=lambda l: max(p[0] for p in l["footprint"]) - min(p[0] for p in l["footprint"]))
    assert all(l["kind"] == "park" for l in woods)
    assert any("cut to it" in a for a in str(rep).split("'")), "the cut is recorded as an assumption"


def test_railway_land_and_lines_are_emitted_and_clipped(result):
    scene, rep = result
    assert any(l["kind"] == "rail" for l in scene["landuse"])
    rails = scene["rails"]
    assert len(rails) == 1 and rails[0]["kind"] == "rail"       # the tunnel is skipped
    xs = [p[0] for p in rails[0]["pts"]]
    span = max(xs) - min(xs)
    assert 500 < span < 760                                       # cut to the 650 m wide boundary, not the 900 m line
    assert rep["counts"]["rails"] == 1


def test_the_boundary_ring_is_in_the_scene(result, files):
    scene, _ = result
    ring = scene["area"]["boundary"]
    assert len(ring) >= 4
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    assert 600 < max(xs) - min(xs) < 700 or 600 < max(ys) - min(ys) < 700
    unclipped, _ = build.ingest(files["overpass-json"])
    assert "boundary" not in unclipped["area"] and "rails" in unclipped
