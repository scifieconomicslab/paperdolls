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


# ================================================================ #9 exceptions that escaped the CLI: T07, T08, T19, T27, T28 (T01-T03 above)

@pytest.mark.parametrize("place, word", [({"kind": "osm_relation"}, "place.relation"), ({"kind": "bbox", "bbox": [50, 4, 50.1]}, "place.bbox"),
                                         ({"kind": "bbox", "bbox": [50, 4, 49, 5]}, "south below north"), ({"kind": "bbox", "bbox": [50, 4, float("nan"), 5]}, "place.bbox"),
                                         ({"kind": "extract_file"}, "place.extract_path"), ({"kind": "scene_file"}, "place.scene_path"),
                                         ({"kind": "bbox", "bbox": [50, 4, 50.1, 4.1], "max_buildings": -3}, "max_buildings")])
def test_t07_a_hand_written_place_block_is_a_message_not_a_traceback(tmp_path, place, word):          # T07
    (tmp_path / "render.yaml").write_text(yaml.safe_dump({"goal": "place_scene", "name": "t", "place": place, "look": {"region": "ce"}}), encoding="utf-8")
    rc, out, err = cli("place", tmp_path / "render.yaml")
    assert rc == 1 and "Traceback" not in err and err.startswith("cannot continue:") and word in err


def test_t07_place_run_itself_names_a_block_that_validation_let_through(tmp_path):                  # T07, second line of defence
    from paperdolls import place
    spec = tmp_path / "render.yaml"
    spec.write_text(yaml.safe_dump({"goal": "place_scene", "name": "t", "place": {"kind": "bbox"}, "look": {"region": "ce"}}), encoding="utf-8")
    with pytest.raises(place.PlaceError, match="not usable"):
        place.run(spec)


@pytest.mark.parametrize("els, word", [([{"id": 1}], "type"), ([{"type": "node", "id": 5, "tags": {"natural": "tree"}}], "lat")])
def test_t08_a_malformed_element_is_an_ingest_error(tmp_path, els, word):                          # T08
    write_extract(tmp_path / "e.json", els)
    rc, out, err = cli("ingest", tmp_path / "e.json", "--out", tmp_path / "scene.json")
    assert rc == 1 and "Traceback" not in err and err.startswith("ingest failed:") and word in err and not (tmp_path / "scene.json").exists()


def test_t08_json_that_is_not_an_object_is_an_ingest_error(tmp_path):                              # T08
    (tmp_path / "e.json").write_text("[1, 2]", encoding="utf-8")
    rc, out, err = cli("ingest", tmp_path / "e.json", "--out", tmp_path / "scene.json")
    assert rc == 1 and "Traceback" not in err and "expected a JSON object" in err


def test_t19_pack_dev_starts_on_an_unparseable_manifest_and_serves_the_error_page(tmp_path):       # T19
    import shutil
    import urllib.request
    d = tmp_path / "toy"
    shutil.copytree(ROOT / "packs" / "toy-epidemic", d)
    (d / "pack.yaml").write_text("id: [unclosed\n  title: : :", encoding="utf-8")
    p = subprocess.Popen([sys.executable, "-u", "-m", "paperdolls", "pack", "dev", str(d), "--port", "0"], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        lines = []
        for _ in range(6):                                                                         # the banner: "open http://127.0.0.1:PORT/" is its second line
            lines.append(p.stdout.readline())
            if "open http" in lines[-1]:
                break
        assert p.poll() is None, f"the server stopped: {p.stderr.read()}"
        url = next(l.split("open ", 1)[1].strip() for l in lines if "open http" in l)
        page = urllib.request.urlopen(url, timeout=5).read().decode()
        assert "not valid YAML" in page
    finally:
        p.kill(); p.communicate()


@pytest.mark.parametrize("n", ["abc", None, [1], True])
def test_t27_a_non_numeric_n_is_a_spec_error(tmp_path, n):                                          # T27
    (tmp_path / "render.yaml").write_text(yaml.safe_dump({"name": "t", "model": {"params": {"n": n, "run_time": 6}}, "replay": {"weeks": [0], "palettes": ["ce"]}}), encoding="utf-8")
    rc, out, err = cli("validate", tmp_path / "render.yaml")
    assert rc == 1 and "Traceback" not in err and "model.params.n must be a whole number" in err


def _base_manifest():
    return json.loads((ROOT / "tests" / "pack_cases.json").read_text(encoding="utf-8"))["base"]


def test_t28_validate_reports_where_it_used_to_raise_a_type_error():                                 # T28
    import copy
    from paperdolls import pack
    a = copy.deepcopy(_base_manifest())
    a["entities"]["thing"]["fields"]["kind"]["values"] = ["a", 1.5]
    a["mappings"][0]["scale"]["values"]["zzz"] = {"label": "Z", "colour": "#aa0000"}
    errors, _ = pack.validate(a)
    assert any("not a value of thing.kind" in e for e in errors) and any("each value is a string" in e or "a category needs" in e for e in errors)
    b = copy.deepcopy(_base_manifest())
    b["params"]["rate"]["group"] = 5
    b["layout"]["left"][0]["groups"] = ["A", "nope"]
    errors, _ = pack.validate(b)
    assert any("rate.group" in e for e in errors) and any("no parameter is in group nope" in e for e in errors)


def test_t28_pack_check_on_such_a_manifest_exits_one_with_messages(tmp_path):                       # T28
    import shutil
    d = tmp_path / "toy"
    shutil.copytree(ROOT / "packs" / "toy-epidemic", d)
    m = yaml.safe_load((d / "pack.yaml").read_text())
    m["entities"]["building"]["fields"]["state"]["values"].append(1.5)
    m["mappings"][0]["scale"]["values"]["zzz"] = {"label": "Z", "colour": "#aa0000"}
    (d / "pack.yaml").write_text(yaml.safe_dump(m, sort_keys=False))
    rc, out, err = cli("pack", "check", d, "--manifest-only")
    assert rc == 1 and "Traceback" not in err and "not a value of building.state" in out


def test_the_three_validators_agree_on_mutated_manifests():                                          # T28: the differential fuzz, bounded
    """pack.py, viz/packvalidate.js and schemas/pack.schema.json on random mutations of the base manifest (docs/state-machines/repro/validator_diff.py has the full run).
    No crash, the same verdict, the same places flagged, and nothing the schema rejects that both validators accept."""
    import importlib.util
    import shutil
    pytest.importorskip("jsonschema")
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    spec = importlib.util.spec_from_file_location("validator_diff", ROOT / "docs" / "state-machines" / "repro" / "validator_diff.py")
    vd = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(vd)
    for seed in (1, 2):
        stat, first = vd.compare(600, seed)
        assert stat["disagreements"] == 0, (seed, stat, {k: v[2] for k, v in first.items() if k in ("py_crash", "js_crash", "verdict_differs", "locations_differ", "schema_rejects_but_both_accept")})
        assert stat["total"] == 600


def test_each_validator_rule_added_for_agreement_is_enforced():                                      # unknown keys and types the schema already rejected
    import copy
    from paperdolls import pack
    cases = [("mappings.0.scale.values.b.extra", 1, "unknown key"), ("mappings.0.scale.label", 5, "must be a string"), ("mappings.3.scale.label", False, "must be a string"),
             ("params.mode.values.1.extra", 1, "unknown key"), ("mappings.6.channel", "wall", "only the groundtint channel has a group")]
    for path, value, word in cases:
        m = copy.deepcopy(_base_manifest())
        cur = m
        parts = path.split(".")
        for p in parts[:-1]:
            cur = cur[int(p)] if isinstance(cur, list) else cur[p]
        cur[parts[-1]] = value
        errors, _ = pack.validate(m)
        assert any(word in e for e in errors), (path, errors)


# ================================================================ #10 atomic writes: T14, T18, T22, T24

def test_write_atomic_never_shows_a_reader_a_prefix(tmp_path):                                       # T18
    from paperdolls.fsutil import write_atomic
    big, out, sizes, stop = "x" * (12 * 1024 * 1024), tmp_path / "pack.html", set(), threading.Event()
    write_atomic(out, "old")

    def reader():
        while not stop.is_set():
            with contextlib.suppress(OSError):
                sizes.add(out.stat().st_size)
    t = threading.Thread(target=reader); t.start()
    write_atomic(out, big)
    stop.set(); t.join()
    assert sizes <= {3, len(big)} and out.read_text() == big
    assert [p.name for p in tmp_path.iterdir()] == ["pack.html"], "no temp file is left behind"


def test_a_failed_write_leaves_the_old_file_and_no_temp_file(tmp_path, monkeypatch):                # T18: a kill or a full disk during the write
    import os
    from paperdolls import fsutil
    out = tmp_path / "pack.html"
    out.write_text("old")

    def boom(fd):
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(os, "fsync", boom)
    with pytest.raises(OSError):
        fsutil.write_atomic(out, "new content")
    assert out.read_text() == "old" and [p.name for p in tmp_path.iterdir()] == ["pack.html"]


def test_pack_build_writes_its_output_atomically(tmp_path, monkeypatch):                            # T18
    from paperdolls import cli
    seen = []
    real = cli.write_atomic
    monkeypatch.setattr(cli, "write_atomic", lambda p, d, *a, **k: seen.append(Path(p).name) or real(p, d, *a, **k))
    cli.main(["pack", "build", str(ROOT / "packs" / "toy-epidemic"), "--out", str(tmp_path / "pack.html")])
    assert seen == ["pack.html"] and (tmp_path / "pack.html").stat().st_size > 1000


def test_t14_a_failure_on_one_ingest_output_replaces_none_of_them(tmp_path):                         # T14
    f = tmp_path / "e.json"
    write_extract(f, [bld(1, square(50.0, 4.0)), ROAD])
    assert cli("ingest", f, "--out", tmp_path / "scene.json")[0] == 0
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    write_extract(f, [bld(1, square(50.0, 4.0)), bld(2, square(50.01, 4.0)), ROAD])
    (tmp_path / "scene_report.json").unlink()
    (tmp_path / "scene_report.json").mkdir()                                                          # any reason the third write fails
    rc, out, err = cli("ingest", f, "--out", tmp_path / "scene.json")
    assert rc == 1 and "Traceback" not in err and "scene_report.json" in err
    assert (tmp_path / "scene.json").read_bytes() == before["scene.json"] and (tmp_path / "scene_report.md").read_bytes() == before["scene_report.md"]
    assert not list(tmp_path.glob(".*.tmp"))


def test_t14_place_writes_the_scene_after_its_reports(tmp_path, monkeypatch):                        # T14: the order a reader relies on
    from paperdolls import place
    order = []
    real = place.write_atomic_group
    monkeypatch.setattr(place, "write_atomic_group", lambda items, *a, **k: order.append([Path(p).name for p, _ in items]) or real(items, *a, **k))
    spec = place_spec(tmp_path, [50.0, 4.0, 50.01, 4.01])
    with fake_overpass() as srv:
        place.run(spec, endpoint=srv.url)
    assert order == [["scene_report.md", "scene_report.json", "scene.json"]]


def test_t22_export_out_without_a_suffix_prints_the_file_it_wrote(tmp_path):                         # T22
    spec = tmp_path / "render.yaml"
    spec.write_text(yaml.safe_dump({"name": "t", "model": {"path": str(ROOT / "tests" / "toy_model.py"), "params": {"n": 12, "run_time": 6}},
                                    "replay": {"weeks": [0, 5], "palettes": ["ce"], "registers": ["formal"]}}), encoding="utf-8")
    rc, out, err = cli("export", spec, "--out", tmp_path / "traj")
    assert rc == 0, err
    written = Path(out.strip().split("wrote ", 1)[1])
    assert written.name == "traj.npz" and written.exists() and not (tmp_path / "traj").exists()
    rc, out, err = cli("frames", spec, written, "--out", tmp_path / "f")
    assert rc == 0 and list((tmp_path / "f").glob("*.png"))
    assert cli("frames", spec, tmp_path / "traj", "--out", tmp_path / "g")[0] == 0, "the name given without the suffix still finds the file"


def test_t22_a_truncated_trajectory_is_a_message(tmp_path):                                           # T22: a kill during the old non-atomic save
    from paperdolls import cli as climod
    bad = tmp_path / "t.npz"
    bad.write_bytes(b"PK\x03\x04 truncated")
    with pytest.raises(SystemExit) as e:
        climod.main(["frames", str(ROOT / "assets" / "demo_render.yaml"), str(bad), "--out", str(tmp_path / "f")])
    assert "not a complete trajectory" in str(e.value) or "cannot continue" in str(e.value)


def _intake_file(tmp_path):
    from paperdolls.intake import Intake
    p = tmp_path / "render.yaml"
    Intake.init(p)
    for q, v in (("goal", "model_replay"), ("name", "alpha")):
        Intake(p).answer(q, v)
    return p


def test_t24_a_half_written_render_yaml_is_an_error_that_names_the_file(tmp_path):                  # T24 (a)
    p = _intake_file(tmp_path)
    p.write_text(p.read_text() + "replay: {weeks: [0, 26,")
    damaged = p.read_text()
    for cmd in (("next", p), ("status", p), ("show", p), ("answer", p, "name", "beta")):
        rc, out, err = cli("intake", *cmd)
        assert rc == 3 and "Traceback" not in err and str(p) in err and "not valid YAML" in err, (cmd, err)
    assert p.read_text() == damaged, "a damaged file is never overwritten"


def test_t24_a_file_cut_to_zero_bytes_is_not_a_new_interview(tmp_path):                              # T24 (b)
    p = _intake_file(tmp_path)
    p.write_text("")
    rc, out, err = cli("intake", "next", p, "--json")
    assert rc == 3 and "is empty" in err and str(p) in err and out.strip() == ""
    assert p.read_text() == ""
    rc, out, err = cli("intake", "init", p)
    assert rc == 3 and "already exists" in err, "init does not silently replace it either"


def test_t24_a_yaml_list_is_an_error_too(tmp_path):                                                    # T24 (SUSPECTED in the part file; now covered)
    p = _intake_file(tmp_path)
    p.write_text("- a\n- b\n")
    rc, out, err = cli("intake", "next", p)
    assert rc == 3 and "must hold a mapping" in err


def test_t24_the_confirmation_gate_names_a_damaged_file_as_well(tmp_path):                            # T24: require_confirmed reads the file itself
    from paperdolls import spec
    p = tmp_path / "render.yaml"
    p.write_text("name: [unclosed")
    with pytest.raises(spec.SpecError, match="not valid YAML"):
        spec.require_confirmed(p)
    rc, out, err = cli("place", p)
    assert rc == 1 and "Traceback" not in err and "not valid YAML" in err
