"""Regression tests for the tooling and data-pipeline findings of docs/state-machines.md (Part 20) (GitHub issues #8 to #13).

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


# ================================================================ #11 intake: overlapping answers and stale bookkeeping: T23, T25

def _fresh_intake(tmp_path):
    from paperdolls.intake import Intake
    p = tmp_path / "render.yaml"
    Intake.init(p)
    return p


def test_t23_two_instances_that_loaded_before_either_saved_keep_both_answers(tmp_path):              # T23, the repro's interleaving
    from paperdolls.intake import Intake
    p = _fresh_intake(tmp_path)
    a, b = Intake(p), Intake(p)
    a.answer("goal", "model_replay")
    b.answer("name", "my project")                                                                      # b loaded before a saved
    final = Intake(p)
    assert final.value("goal") == "model_replay" and final.value("name") == "my project"


def test_t23_twenty_overlapping_answer_commands_keep_every_answer(tmp_path):                         # T23 stress: separate processes
    p = _fresh_intake(tmp_path)
    assert cli("intake", "answer", p, "goal", "place_scene")[0] == 0
    fixed = {"audience": "researchers", "place.kind": "placeholder", "look.region": "ce", "look.register": "colorfigures"}
    jobs = list(fixed.items()) + [("name", f"name-{i}") for i in range(8)] + [("output.dir", f"out-{i}") for i in range(8)]
    assert len(jobs) == 20
    procs = [subprocess.Popen([sys.executable, "-m", "paperdolls", "intake", "answer", str(p), q, v], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for q, v in jobs]
    results = [(q, pr.communicate(), pr.returncode) for (q, _), pr in zip(jobs, procs)]
    assert all(rc == 0 for _, _, rc in results), [(q, err) for q, (out, err), rc in results if rc]
    data = yaml.safe_load(p.read_text())
    assert data["goal"] == "place_scene" and data["audience"] == "researchers" and data["place"]["kind"] == "placeholder"
    assert data["look"]["region"] == "ce" and data["look"]["register"] == "colorfigures"
    assert data["name"] in {f"name-{i}" for i in range(8)} and data["output"]["dir"] in {f"out-{i}" for i in range(8)}
    assert "intake" in data and not list(tmp_path.glob(".*.tmp"))


def test_t23_the_lock_is_held_for_the_whole_read_modify_write(tmp_path, monkeypatch):                 # T23: a second writer waits, it does not interleave
    from paperdolls import intake as intakemod
    p = _fresh_intake(tmp_path)
    inside, order = threading.Event(), []
    real_read = intakemod.Intake._read

    def slow_read(self):
        data = real_read(self)
        if threading.current_thread().name == "first":
            inside.set(); order.append("first read"); threading.Event().wait(0.3)
        else:
            order.append("second read")
        return data
    monkeypatch.setattr(intakemod.Intake, "_read", slow_read)
    t1 = threading.Thread(name="first", target=lambda: intakemod.Intake(p).answer("goal", "model_replay"))
    t1.start(); inside.wait(5)
    intakemod.Intake(p).answer("name", "second")
    t1.join()
    assert order.index("first read") < order.index("second read") and yaml.safe_load(p.read_text())["goal"] == "model_replay"


def test_t25_a_goal_change_resets_the_bookkeeping_of_the_branch_it_removes(tmp_path):                  # T25
    from paperdolls.intake import Intake
    p = _fresh_intake(tmp_path)
    Intake(p).answer("goal", "model_replay"); Intake(p).answer("name", "xyz")
    Intake(p).answer("model.source", "vendored")
    Intake(p).answer("model.params.overrides", "none")
    assert Intake(p).meta.get("overrides_answered") is True
    Intake(p).answer("goal", "place_scene")
    meta = Intake(p).meta
    assert "overrides_answered" not in meta and "override_keys" not in meta and not [d for d in meta.get("defaults", []) if d.startswith(("model", "replay"))]
    Intake(p).answer("goal", "model_replay")
    it = Intake(p); it.answer("model.source", "vendored")
    status = {r["id"]: r["state"] for r in Intake(p).status()}
    assert status["model.params.overrides"] == "missing", "the overrides question is asked again"
    assert "model.params.overrides" not in it.meta.get("defaults", []) and Intake(p).value("model.params")


def test_t25_the_decision_table_does_not_claim_you_said_for_reset_values(tmp_path):                    # T25
    from paperdolls.intake import Intake
    p = _fresh_intake(tmp_path)
    Intake(p).answer("goal", "model_replay"); Intake(p).answer("model.source", "vendored")
    Intake(p).answer("model.params.overrides", "beta=0.5") if "beta" in (Intake(p).model_fields() or {}) else Intake(p).answer("model.params.overrides", "none")
    Intake(p).answer("goal", "place_scene"); Intake(p).answer("goal", "model_replay"); Intake(p).answer("model.source", "vendored")
    it = Intake(p)
    kv = next(r for r in it.status() if r["id"] == "model.params.overrides")
    assert kv["state"] == "missing"


def test_t25_the_same_goal_again_changes_nothing(tmp_path):                                              # a re-answer must not wipe the branch it keeps
    from paperdolls.intake import Intake
    p = _fresh_intake(tmp_path)
    Intake(p).answer("goal", "model_replay"); Intake(p).answer("model.source", "vendored"); Intake(p).answer("model.params.overrides", "none")
    before = yaml.safe_load(p.read_text())
    Intake(p).answer("goal", "model_replay")
    after = yaml.safe_load(p.read_text())
    assert after["model"] == before["model"] and after["intake"]["overrides_answered"] is True


# ================================================================ #12 ingest output is validated: T09-T13, T29

def ingest_elements(tmp_path, elements, **kw):
    from paperdolls.ingest import build
    f = tmp_path / "e.json"
    write_extract(f, elements)
    return build.ingest(f, **kw)


def test_t09_a_scene_with_no_buildings_says_so_with_counts(tmp_path):                                # T09
    bowtie = bld(2, [(50.0, 4.0), (50.0002, 4.0002), (50.0, 4.0002), (50.0002, 4.0), (50.0, 4.0)])
    scene, rep = ingest_elements(tmp_path, [bowtie, ROAD])
    assert scene["buildings"] == []
    assert any("NO buildings" in w and "building smaller than 8 m2: 1" in w for w in rep["warnings"]), rep["warnings"]


def test_t09_an_extract_with_roads_only_gets_the_same_warning(tmp_path):                             # T09: legal, but not silent
    scene, rep = ingest_elements(tmp_path, [ROAD])
    assert scene["buildings"] == [] and any("NO buildings" in w and "no building features" in w for w in rep["warnings"])


def test_t10_an_infinite_coordinate_drops_that_feature_and_the_scene_stays_valid_json(tmp_path):      # T10
    f = tmp_path / "e.json"
    f.write_text(json.dumps({"elements": [bld(1, square(50.0, 4.0)), bld(2, [(50, 4), (50, float("inf")), (50.1, 4.1), (50, 4)]), ROAD]}), encoding="utf-8")
    rc, out, err = cli("ingest", f, "--out", tmp_path / "scene.json")
    assert rc == 0, err
    text = (tmp_path / "scene.json").read_text()
    assert "Infinity" not in text and "NaN" not in text
    scene = json.loads(text, parse_constant=lambda c: pytest.fail(f"{c} in the scene"))
    assert [b["id"] for b in scene["buildings"]] == ["w1"] and scene["area"]["origin"]["lon"] == pytest.approx(4.0001, abs=1e-3)
    assert "not a finite latitude/longitude" in out and "non-finite or out-of-range coordinate" in (tmp_path / "scene_report.md").read_text()


def test_t10_nan_and_out_of_range_coordinates_are_left_out_too(tmp_path):                            # T10
    nan = bld(2, [(50, 4), (float("nan"), 4.1), (50.1, 4.1), (50, 4)])
    far = bld(3, [(50, 4), (95, 4.1), (50.1, 4.1), (50, 4)])
    scene, rep = ingest_elements(tmp_path, [bld(1, square(50.0, 4.0)), nan, far, ROAD])
    assert [b["id"] for b in scene["buildings"]] == ["w1"] and rep["skipped"]["features with a non-finite or out-of-range coordinate"] == 2


def test_validate_scene_rejects_what_the_viewer_would_reject():                                       # the guard behind T10
    from paperdolls.ingest.validate import validate_scene
    good = {"roads": [], "buildings": [{"id": "w1", "footprint": [[0, 0], [5, 0], [5, 5]], "levels": 2, "neighbours": []}], "landuse": [], "trees": []}
    assert validate_scene(good)[0] == []
    bad = json.loads(json.dumps(good))
    bad["buildings"] += [{"id": "w1", "footprint": [[0, 0], [5, 0], [5, 5]], "levels": 0, "neighbours": ["ghost"]},
                         {"id": "w3", "footprint": [[0, 0], [float("inf"), 0], [5, 5]], "levels": 2}]
    errors, _ = validate_scene(bad)
    text = " | ".join(errors)
    assert "not a finite number" in text and "appears twice" in text and "levels must be" in text and "neighbour id(s) name no building" in text


def test_t11_duplicate_building_ids_keep_the_first_and_are_reported(tmp_path):                         # T11
    scene, rep = ingest_elements(tmp_path, [bld(1, square(50.0, 4.0)), bld(1, square(50.001, 4.001)), ROAD])
    ids = [b["id"] for b in scene["buildings"]]
    assert ids == ["w1"] and rep["skipped"]["building with an id already used (kept the first)"] == 1
    assert any("1 building(s) left out" in w for w in rep["warnings"])


def test_t12_max_buildings_must_be_at_least_one(tmp_path):                                              # T12
    from paperdolls.ingest.build import IngestError
    els = [bld(i, square(50.0 + i * 0.001, 4.0)) for i in range(1, 4)] + [ROAD]
    for bad in (-1, 0):
        with pytest.raises(IngestError, match="at least 1"):
            ingest_elements(tmp_path, els, max_buildings=bad)
        rc, out, err = cli("ingest", tmp_path / "e.json", "--out", tmp_path / "s.json", "--max-buildings", bad)
        assert rc == 1 and "at least 1" in err and "Traceback" not in err
    scene, rep = ingest_elements(tmp_path, els, max_buildings=2)
    assert len(scene["buildings"]) == 2 and list(v for k, v in rep["skipped"].items() if "max-buildings" in k) == [1]
    assert len(ingest_elements(tmp_path, els, max_buildings=3)[0]["buildings"]) == 3, "exactly the count: nothing skipped"


def test_t13_a_self_crossing_footprint_is_left_out_and_counted(tmp_path):                               # T13
    figure8 = bld(1, [(50.0, 4.0), (50.0004, 4.0006), (50.0, 4.0006), (50.0002, 4.0), (50.0, 4.0)])
    scene, rep = ingest_elements(tmp_path, [figure8, bld(2, square(50.01, 4.0)), ROAD])
    assert [b["id"] for b in scene["buildings"]] == ["w2"] and rep["skipped"]["building footprint crosses itself"] == 1
    assert any("crosses itself" in w for w in rep["warnings"])


def test_ring_self_crossings_counts_crosses_not_touches():                                             # the rule behind T13
    from paperdolls.ingest.geo import ring_self_crossings
    assert ring_self_crossings([(0, 0), (4, 0), (4, 4), (0, 4)]) == 0
    assert ring_self_crossings([(0, 0), (4, 4), (4, 0), (0, 4)]) == 1
    assert ring_self_crossings([(0, 0), (4, 0), (4, 4), (2, 0), (0, 4)]) == 0, "a vertex touching an edge is not a crossing"
    L = [(0, 0), (6, 0), (6, 2), (2, 2), (2, 6), (0, 6)]
    assert ring_self_crossings(L) == 0, "a concave L is simple"


@pytest.mark.parametrize("bbox", ["50,4,49,5", "50,4,51", "a,b,c,d", "50,4,nan,5", "50,4,95,5"])
def test_a_bad_ingest_bbox_is_a_message(tmp_path, bbox):                                                   # T29 / argument combinations
    write_extract(tmp_path / "e.json", [bld(1, square(50.0, 4.0)), ROAD])
    rc, out, err = cli("ingest", tmp_path / "e.json", "--out", tmp_path / "s.json", "--bbox", bbox)
    assert rc == 1 and "--bbox" in err and "Traceback" not in err


def test_a_relation_with_a_bbox_clips_to_both_in_ingest_and_in_the_query(tmp_path):                       # T29
    from paperdolls.ingest.query import overpass_query
    assert overpass_query(relation=5, bbox=(50.0, 4.0, 50.1, 4.1)).count("(area.a)(50.000000,4.000000,50.100000,4.100000)") >= 10
    with pytest.raises(ValueError):
        overpass_query(relation=5, bbox=(50.1, 4.0, 50.0, 4.1))
    ring = [(49.99, 3.99), (49.99, 4.2), (50.2, 4.2), (50.2, 3.99), (49.99, 3.99)]
    rel = {"type": "relation", "id": 5, "tags": {"type": "boundary", "boundary": "administrative", "name": "R"}, "members": [{"type": "way", "ref": 700, "role": "outer", "geometry": [{"lat": a, "lon": b} for a, b in ring]}]}
    els = [rel, bld(1, square(50.0, 4.0)), bld(2, square(50.15, 4.15))]                                    # w2 is inside the relation but outside the bbox
    scene, _ = ingest_elements(tmp_path, els, boundary_relation=5, bbox=(49.99, 3.99, 50.05, 4.05))
    assert [b["id"] for b in scene["buildings"]] == ["w1"]


def test_the_jette_style_ingest_output_is_unchanged_for_valid_data():                                     # keep real ingest output as it was
    """samples/osm_fixture_* are the committed output of the ingest on a fixture; ingesting the fixture again must give the same scene (the clock aside)."""
    from paperdolls.ingest import build
    sample = ROOT / "samples" / "osm_fixture_extract.json"
    old = json.loads((ROOT / "samples" / "osm_fixture_scene.json").read_text())
    new, _ = build.ingest(sample, boundary_relation=old["area"].get("osm_relation"), name=old["area"]["name"])
    for sc in (old, new):
        sc["area"].pop("generated", None)
    assert new == old


# ================================================================ #13 pack build: T15, T16, T17, T30

def toy_copy(tmp_path):
    import shutil
    d = tmp_path / "toy"
    shutil.copytree(ROOT / "packs" / "toy-epidemic", d)
    return d


SCENE = {"buildings": [{"id": "w1", "footprint": [[0, 0], [5, 0], [5, 5]], "levels": 2, "archetype": "villa", "state": "none", "investor": False, "area": 12.5, "residential": "residential"}],
         "roads": [], "landuse": [], "trees": []}


def manifest_literal(html):
    line = next(l for l in html.splitlines() if l.strip().startswith("const MANIFEST ="))
    return json.loads(line.split("=", 1)[1].strip().rstrip(";"))


def test_t15_a_placeholder_inside_the_manifest_is_data_not_a_marker(tmp_path):                          # T15
    from paperdolls import pack
    d = toy_copy(tmp_path)
    m = yaml.safe_load((d / "pack.yaml").read_text())
    m["banner"] = "Data: see /*__SCENE__*/ and /*__PACK__*/ and /*__VIZLIB__*/ in the report"
    m["title"] = "Toy /*__SCENE__*/"
    (d / "pack.yaml").write_text(yaml.safe_dump(m, sort_keys=False))
    html, _ = pack.build(d, SCENE)
    assert manifest_literal(html)["banner"] == m["banner"], "the MANIFEST literal parses and holds the banner as written"
    assert html.count('"id":"w1"') == 1, "the scene appears once, in the SCENE literal"
    assert "<title>Toy /*__SCENE__*/</title>" in html


def test_t15_a_placeholder_in_a_runtime_source_stays_text(tmp_path):                                    # T15
    from paperdolls import pack
    d = toy_copy(tmp_path)
    (d / "runtime.js").write_text((d / "runtime.js").read_text() + "\n// build notes: /*__VIZLIB__*/ /*__PALETTES__*/ /*__SCENE__*/ /*__PACKRUNTIMESRC__*/\n")
    plain, _ = pack.build(ROOT / "packs" / "toy-epidemic", SCENE)
    html, _ = pack.build(d, SCENE)
    assert html.count("// build notes: /*__VIZLIB__*/ /*__PALETTES__*/ /*__SCENE__*/ /*__PACKRUNTIMESRC__*/") == 2, "once per place the runtime source is put"
    assert len(html) - len(plain) < 400, "no library or scene was pasted in"


def test_t15_fill_substitutes_in_one_pass():                                                           # T15
    from paperdolls.viewer_build import _fill
    out = _fill("a /*__X__*/ b /*__Y__*/ c /*__UNKNOWN__*/", X="/*__Y__*/", Y="y")
    assert out == "a /*__Y__*/ b y c /*__UNKNOWN__*/"


def test_viewer_pages_are_unchanged_by_the_one_pass_fill():                                             # the viewer and catalogue still build, with the libraries in
    from paperdolls.viewer_build import build_catalogue, build_viewer
    page = build_viewer(SCENE, {"region": "ce"}, "T & <t>")
    assert "/*__" not in page and "T &amp; &lt;t&gt;" in page and "VizLib" in page
    assert "/*__" not in build_catalogue()


def test_t16_build_reads_the_manifest_once_and_builds_what_it_validated(tmp_path):                       # T16
    from paperdolls import pack
    d = toy_copy(tmp_path)
    real, reads = pack.load, []

    def load_then_edit(path):
        m = real(path)
        reads.append(path)
        if len(reads) == 1:                                                                             # an editor saves right after the validated read
            bad = yaml.safe_load((d / "pack.yaml").read_text())
            bad["id"] = "BAD ID"
            (d / "pack.yaml").write_text(yaml.safe_dump(bad, sort_keys=False))
        return m
    pack.load = load_then_edit
    try:
        html, info = pack.build(d)
    finally:
        pack.load = real
    assert len(reads) == 1 and manifest_literal(html)["id"] == "toy-epidemic"


def test_t16_build_inlines_the_runtime_bytes_it_checked(tmp_path, monkeypatch):                          # T16, the runtime files
    from paperdolls import pack
    d = toy_copy(tmp_path)
    original = (d / "runtime.js").read_text()
    real_text = pack._Sources.text
    state = {"n": 0}

    def text_then_edit(self, f):
        t = real_text(self, f)
        state["n"] += 1
        if state["n"] == 1:
            Path(f).write_text(t + "\nwindow.EDITED_AFTER_THE_CHECK = 1;\n")
        return t
    monkeypatch.setattr(pack._Sources, "text", text_then_edit)
    html, _ = pack.build(d)
    assert "EDITED_AFTER_THE_CHECK" not in html and original.strip().splitlines()[0] in html


def test_t17_a_runtime_entry_outside_the_pack_is_refused(tmp_path):                                      # T17
    from paperdolls import pack
    d = toy_copy(tmp_path)
    outside = tmp_path / "outside.js"
    outside.write_text("window.OUTSIDE = 1;")
    for entry in (str(outside), "../outside.js", "sub/../../outside.js", "C:/x.js", "a\\b.js"):
        m = yaml.safe_load((d / "pack.yaml").read_text())
        m["runtime"] = {"type": "js", "entry": entry, "seed": 7, "on_params": "rerun"}
        (d / "pack.yaml").write_text(yaml.safe_dump(m, sort_keys=False))
        errors, _ = pack.check(d)
        assert any("runtime.entry: must be a relative path inside the pack folder" in e for e in errors), (entry, errors)
        with pytest.raises(pack.PackError, match="inside the pack folder"):
            pack.build(d)
        assert pack.runtime_files(d) == [], "nothing outside the pack is ever a file to inline"


def test_t17_a_symbolic_link_out_of_the_pack_is_refused(tmp_path):                                       # T17
    from paperdolls import pack
    d = toy_copy(tmp_path)
    outside = tmp_path / "outside.js"
    outside.write_text("window.OUTSIDE = 1;")
    (d / "linked.js").symlink_to(outside)
    m = yaml.safe_load((d / "pack.yaml").read_text())
    m["runtime"]["entry"] = "linked.js"
    m["runtime"].pop("files", None)
    (d / "pack.yaml").write_text(yaml.safe_dump(m, sort_keys=False))
    errors, _ = pack.check(d)
    assert any("resolves outside the pack folder" in e for e in errors)
    with pytest.raises(pack.PackError):
        pack.build(d)


def test_the_js_validator_refuses_such_an_entry_too():                                                    # T17: the two validators agree
    import shutil
    if not shutil.which("node"):
        pytest.skip("node is not installed")
    from paperdolls import pack
    m = _base_manifest()
    m["runtime"]["entry"] = "../x.js"
    py_errors, _ = pack.validate(m)
    out = subprocess.run(["node", "-e", "const V=require(process.argv[1]); const r=V.validate(JSON.parse(process.argv[2])); console.log(JSON.stringify(r.errors))", str(ROOT / "viz" / "packvalidate.js"), json.dumps(m)],
                         capture_output=True, text=True, timeout=30)
    assert "runtime.entry: must be a relative path" in " ".join(py_errors) and "runtime.entry: must be a relative path" in out.stdout


def _pack_with_included_helper(tmp_path):
    d = toy_copy(tmp_path)
    m = yaml.safe_load((d / "pack.yaml").read_text())
    m["runtime"].pop("files", None)
    (d / "pack.yaml").write_text(yaml.safe_dump(m, sort_keys=False))
    (d / "prng.js").write_text("window.PRNG_LOADED = 1;")
    (d / "runtime.js").write_text((d / "runtime.js").read_text() + "\nif (typeof require === 'function') require('./prng.js');\n")
    return d


def test_t30_include_reaches_check_and_build(tmp_path):                                                    # T30
    from paperdolls import pack
    d = _pack_with_included_helper(tmp_path)
    inc = [d / "prng.js"]
    assert any("not inlined into the page" in e for e in pack.check(d)[0]), "without --include the require is refused"
    assert pack.check(d, inc)[0] == []
    html, info = pack.build(d, None, inc)
    assert "PRNG_LOADED" in html and html.index("PRNG_LOADED") < html.index("require('./prng.js')") and str(d / "prng.js") in info["sources"]


def test_t30_include_through_the_commands(tmp_path):                                                       # T30: build, check (manifest and runtime) and dev
    import shutil
    d = _pack_with_included_helper(tmp_path)
    inc = ["--include", str(d / "prng.js")]
    rc, out, err = cli("pack", "build", d, "--out", tmp_path / "p.html", *inc)
    assert rc == 0, err
    assert "PRNG_LOADED" in (tmp_path / "p.html").read_text()
    assert cli("pack", "build", d, "--out", tmp_path / "q.html")[0] == 1, "without it the build is refused, as documented"
    rc, out, err = cli("pack", "check", d, "--manifest-only", *inc)
    assert rc == 0 and "not inlined" not in out, out
    assert cli("pack", "check", d, "--manifest-only")[0] == 1
    if shutil.which("node"):
        rc, out, err = cli("pack", "check", d, *inc)
        assert rc in (0, 1) and "not inlined" not in out, out
    from paperdolls import packdev
    assert packdev.DevState(d, None, include=[d / "prng.js"]).ok
    assert not packdev.DevState(d).ok
