"""Regression tests for the tooling and data-pipeline findings of docs/state-machines/parts/20-tooling-data.md (GitHub issues #8 to #13).

Each test is the port of a repro (T01 to T30) from docs/state-machines/repro/tooling_repro.py: it failed on main (aa2d936) and passes now.
No test reaches a real server: Overpass is a local fake bound to 127.0.0.1 (tests/conftest.py also refuses any other connection).
"""
import contextlib
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]


def way(i, pts, tags):
    return {"type": "way", "id": i, "tags": tags, "geometry": [{"lat": a, "lon": b} for a, b in pts]}


def square(lat, lon, d=0.0002):
    return [(lat, lon), (lat, lon + d), (lat + d, lon + d), (lat + d, lon), (lat, lon)]


def bld(i, pts, **t):
    return way(i, pts, {"building": "yes", **t})


ROAD = way(99, [(50.0, 4.0), (50.001, 4.001)], {"highway": "residential"})


def write_extract(path, elements):
    Path(path).write_text(json.dumps({"elements": elements}), encoding="utf-8")


def cli(*args, cwd=None):
    p = subprocess.run([sys.executable, "-m", "paperdolls", *map(str, args)], capture_output=True, text=True, cwd=cwd or ROOT, timeout=120)
    return p.returncode, p.stdout, p.stderr


# ---------------------------------------------------------------- a local stand-in for Overpass

class _Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        srv = self.server
        srv.queries.append(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode())
        mode = srv.mode
        if mode == "truncated":                           # promise 100000 bytes, send 28, drop the connection
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", "100000"); self.end_headers()
            self.wfile.write(b'{"elements": [{"type": "way"'); self.wfile.flush(); self.close_connection = True
            return
        body = {"list": b"[]", "object-string": b'"hello"'}.get(mode)
        if body is None:
            body = json.dumps({"elements": srv.elements}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)


class _Server(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        pass


@contextlib.contextmanager
def fake_overpass(mode="ok", elements=None):
    srv = _Server(("127.0.0.1", 0), _Fake)
    srv.mode, srv.queries, srv.elements = mode, [], elements if elements is not None else [bld(1, square(50.0, 4.0)), ROAD]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        srv.url = f"http://127.0.0.1:{srv.server_address[1]}/api/interpreter"
        yield srv
    finally:
        srv.shutdown(); srv.server_close()


def place_spec(d, bbox=None, **place):
    spec = {"goal": "place_scene", "name": "t", "place": place or {"kind": "bbox", "bbox": bbox}, "look": {"region": "ce"}, "output": {"dir": "out"}}
    (d / "render.yaml").write_text(yaml.safe_dump(spec), encoding="utf-8")
    return d / "render.yaml"


# ================================================================ #8 and the fetch half of #9: T01-T03, T05, T06, T29

def test_t01_a_connection_dropped_mid_body_is_a_fetch_error_and_saves_nothing(tmp_path):      # T01
    from paperdolls.ingest.fetch import FetchError, fetch_overpass
    with fake_overpass("truncated") as srv:
        with pytest.raises(FetchError, match="cut off"):
            fetch_overpass("q", tmp_path / "e.json", endpoint=srv.url, timeout=5)
    assert not (tmp_path / "e.json").exists() and not list(tmp_path.glob(".*.tmp"))


def test_t02_osm_fetch_reports_a_dropped_connection_in_one_line(tmp_path):                      # T02
    with fake_overpass("truncated") as srv:
        rc, out, err = cli("osm-fetch", "--bbox", "50,4,50.1,4.1", "--out", tmp_path / "e.json", "--endpoint", srv.url)
    assert rc == 1 and "Traceback" not in err and err.startswith("fetch failed:") and "cut off" in err and len(err.strip().splitlines()) == 1


@pytest.mark.parametrize("mode", ["list", "object-string"])
def test_t03_valid_json_that_is_not_an_extract_is_a_fetch_error(tmp_path, mode):                # T03
    from paperdolls.ingest.fetch import FetchError, fetch_overpass
    with fake_overpass(mode) as srv:
        with pytest.raises(FetchError, match="not an Overpass result"):
            fetch_overpass("q", tmp_path / "e.json", endpoint=srv.url, timeout=5)


def test_t05_a_changed_bbox_refetches_instead_of_reusing_the_old_extract(tmp_path):             # T05
    from paperdolls import place
    spec = place_spec(tmp_path, [50.00, 4.00, 50.01, 4.01])
    with fake_overpass(elements=[bld(1, square(50.001, 4.001)), bld(2, square(50.002, 4.002)), ROAD]) as srv:
        assert place.run(spec, endpoint=srv.url)["buildings"] == 2
        assert place.run(spec, endpoint=srv.url)["buildings"] == 2 and len(srv.queries) == 1, "the same area is served from the cache"
        srv.elements = [bld(i, square(50.0 + i * 0.01, 4.0)) for i in range(1, 6)] + [ROAD]
        spec = place_spec(tmp_path, [49.90, 3.90, 50.10, 4.10])
        r = place.run(spec, endpoint=srv.url)
    assert len(srv.queries) == 2 and "49.900000" in srv.queries[1]
    assert r["buildings"] == 5 and any("not for bbox" in w for w in r["warnings"])


def test_t05_a_changed_relation_or_query_version_refetches(tmp_path, monkeypatch):               # T05
    from paperdolls import place
    from paperdolls.ingest import query
    spec = place_spec(tmp_path, [50.00, 4.00, 50.01, 4.01])
    with fake_overpass() as srv:
        place.run(spec, endpoint=srv.url)
        monkeypatch.setattr(place, "QUERY_VERSION", query.QUERY_VERSION + 1)
        place.run(spec, endpoint=srv.url)
        assert len(srv.queries) == 2, "a new query version invalidates the extract"


def test_t05_a_hand_exported_extract_beside_its_query_is_adopted(tmp_path):                      # the route the error message tells the user to take
    from paperdolls import place
    spec = place_spec(tmp_path, [50.00, 4.00, 50.01, 4.01])
    with pytest.raises(place.PlaceError, match="query is saved"):
        place.run(spec, fetch=False)
    write_extract(tmp_path / "out" / "extract.json", [bld(1, square(50.001, 4.001)), ROAD])        # saved by hand from overpass-turbo
    assert place.run(spec, fetch=False)["buildings"] == 1


def test_t05_an_extract_with_no_record_of_its_area_is_refused_under_no_fetch(tmp_path):         # T05
    from paperdolls import place
    spec = place_spec(tmp_path, [50.00, 4.00, 50.01, 4.01])
    (tmp_path / "out").mkdir()
    write_extract(tmp_path / "out" / "extract.json", [bld(1, square(50.001, 4.001)), ROAD])
    with pytest.raises(place.PlaceError, match="no record of the area"):
        place.run(spec, fetch=False)


def test_t06_a_truncated_extract_is_refetched_and_without_network_the_error_names_refetch(tmp_path):   # T06
    from paperdolls import place
    spec = place_spec(tmp_path, [50.0, 4.0, 50.01, 4.01])
    out = tmp_path / "out"; out.mkdir()
    (out / "extract.json").write_text('{"elements": [{"type": "way", "id": 1, "geometry": [{"lat": 50.0', encoding="utf-8")
    with pytest.raises(place.PlaceError, match="--refetch"):
        place.run(spec, fetch=False)
    with fake_overpass() as srv:
        assert place.run(spec, endpoint=srv.url)["buildings"] == 1 and len(srv.queries) == 1


def test_t06_an_ingest_failure_on_a_cached_extract_names_refetch(tmp_path):                      # T06
    from paperdolls import place
    spec = place_spec(tmp_path, [50.0, 4.0, 50.01, 4.01])
    with fake_overpass(elements=[ROAD.copy() | {"id": 5, "tags": {"foo": "bar"}}]) as srv:        # valid JSON, nothing to draw
        with pytest.raises(place.PlaceError, match="--refetch"):
            place.run(spec, endpoint=srv.url)


def test_t29_a_query_with_a_relation_and_a_bbox_uses_both():                                      # T29
    from paperdolls.ingest.query import overpass_query
    q = overpass_query(relation=58258, bbox=(50.87, 4.3, 50.89, 4.35))
    assert '(area.a)(50.870000,4.300000,50.890000,4.350000)' in q
    assert overpass_query(relation=58258).count("(area.a)") == overpass_query(relation=58258, bbox=(1, 2, 3, 4)).count("(area.a)")


def test_the_relation_only_and_bbox_only_queries_are_unchanged():                                # the Jette query must not drift
    from paperdolls.ingest.query import overpass_query
    assert '  way["building"](area.a);' in overpass_query(relation=58258) and "rel(58258);\nmap_to_area->.a;" in overpass_query(relation=58258)
    assert '  way["building"](50.000000,4.000000,50.010000,4.010000);' in overpass_query(bbox=(50, 4, 50.01, 4.01))
