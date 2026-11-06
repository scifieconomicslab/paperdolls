"""Pack tooling: the dev server (hot reload), scene embedding and trimming in `pack build`, the runtime checks of `pack check`, and parity with a Python reference."""
import http.client
import json
import shutil
import socket
import threading
import time
from pathlib import Path

import pytest
import yaml

from paperdolls import cli, pack, packcheck, packdev

ROOT = Path(__file__).resolve().parents[1]
TOY = ROOT / "packs" / "toy-epidemic"
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")

# a tiny pack with a Python twin: cell i holds v = (i + 1) * rate * t + seed
MINI_YAML = """
spec: 1
id: mini
title: Mini
runtime: {type: js, entry: runtime.js, seed: 3}
time: {unit: step, steps: 10}
params:
  rate: {type: number, min: 0, max: 2, step: 0.1, default: 0.5}
entities:
  cell:
    count: 4
    fields:
      v: number
      kind: {type: category, values: [low, high]}
mappings:
  - {entity: cell, field: v, channel: wall, scale: {type: sequential, label: Value, domain: [0, 100], colours: ["#ffffff", "#000000"]}}
  - {entity: cell, field: kind, channel: wall, scale: {type: categorical, label: Kind, values: {low: {colour: "#aaaaaa", label: Low}, high: {colour: "#333333", label: High}}}}
series:
  total: {label: Total, y: [sum]}
banner: Test pack.
"""
MINI_JS = """
(function () {
  function frame(h) {
    const v = [], kind = [];
    for (let i = 0; i < h.n; i++) { v.push((i + 1) * h.rate * h.t + h.seed); kind.push(v[i] > 5 ? 1 : 0); }
    return { t: h.t, entities: { cell: { v, kind } }, series: { total: [v.reduce((a, b) => a + b, 0)] } };
  }
  PaperDolls.registerRuntime('mini', {
    init(p, ents, seed) { return { rate: p.rate, n: ents.cell.count, seed, t: 0 }; },
    step(h, k) { const out = []; if (k === 0) return [frame(h)]; for (let s = 0; s < k; s++) { h.t++; out.push(frame(h)); } return out; },
  });
})();
"""
MINI_PY = """
def pack_frames(case):
    p = case["params"]; n = case["entities"]["cell"]["count"]; seed = case.get("seed", 3)
    frames = []
    for t in range(case["steps"] + 1):
        v = [(i + 1) * p["rate"] * t + seed for i in range(n)]
        frames.append({"t": t, "cells": [{"v": x, "kind": "high" if x > 5 else "low"} for x in v], "series": {"total": sum(v)}})
    return frames
"""
CASES = {"cases": [{"name": "slow", "params": {"rate": 0.25}, "seed": 3, "steps": 10, "entities": {"cell": {"count": 4}}},
                   {"name": "fast", "params": {"rate": 1.5}, "seed": 3, "steps": 10, "entities": {"cell": {"count": 6}}}]}


def mini(tmp_path, js=MINI_JS, yaml_text=MINI_YAML):
    (tmp_path / "pack.yaml").write_text(yaml_text, encoding="utf-8")
    (tmp_path / "runtime.js").write_text(js, encoding="utf-8")
    return tmp_path


def copy_toy(tmp_path):
    d = tmp_path / "toy"
    shutil.copytree(TOY, d)
    return d


def synthetic_scene(n=9500):
    """A scene the size of the Jette commune: n buildings with the ingest's fields, plus roads, landuse and trees."""
    b = []
    for i in range(n):
        x, y = (i % 100) * 21.37, (i // 100) * 17.91
        b.append({"id": f"w{1000 + i}", "footprint": [[x, y], [x + 9.13, y + 0.31], [x + 8.77, y + 10.52], [x - 0.41, y + 9.98]], "levels": 2, "archetype": "auto", "state": "none", "investor": False,
                  "area": 91.2, "centroid": [x + 4.4, y + 5.1], "height": 6.2, "levels_assumed": True, "residential": "probable",
                  "osm": {"building": "yes", "levels_source": "global-default"}, "neighbours": [f"w{1000 + (i + 1) % n}", f"w{1000 + (i - 1) % n}"]})
    return {"area": {"name": "Synthetic"}, "buildings": b, "roads": [{"id": f"r{i}", "class": "local", "pts": [[i * 1.234, 0.5678], [i * 1.234 + 40.11, 30.22]], "width": 6.2} for i in range(1300)],
            "landuse": [], "trees": [[i * 1.113, i * 0.777] for i in range(8700)]}


# ---- pack build ----

def test_scene_is_embedded_compactly_and_the_page_stays_small():
    scene = synthetic_scene()
    html, info = pack.build(TOY, scene)
    assert info["buildings"] == 9500 and info["trimmed"] == []
    assert info["bytes"] < 16 * 1024 * 1024 and info["bytes"] == len(html.encode())
    assert info["scene_bytes"] < 0.5 * info["bytes"] or info["scene_bytes"] < 8 * 1024 * 1024
    assert ", " not in html[html.index("const EMBEDDED_SCENE"):][:200], "the scene is written without padding"


def test_scene_is_trimmed_only_when_the_page_is_over_budget_and_says_what_was_lost():
    scene = synthetic_scene(2000)
    _, whole = pack.build(TOY, scene)
    _, tight = pack.build(TOY, scene, max_bytes=whole["bytes"] - 40000)
    assert tight["bytes"] <= whole["bytes"] - 40000 and tight["trimmed"] and tight["trimmed"][0]["stage"] == "precision"
    assert all("lost" in t for t in tight["trimmed"])
    html, forced = pack.build(TOY, scene, trim=["neighbours"])
    assert [t["stage"] for t in forced["trimmed"]] == ["neighbours"] and "neighbours" not in html[html.index("EMBEDDED_SCENE"):][:1000]
    with pytest.raises(pack.PackError, match="over the"):
        pack.build(TOY, scene, max_bytes=100000)
    with pytest.raises(pack.PackError, match="unknown trim stage"):
        pack.build(TOY, scene, trim=["nope"])


def test_trimming_keeps_what_the_renderer_and_bind_rules_need():
    t = scene = synthetic_scene(5)
    for stage in pack.TRIM_NAMES:
        t = pack.trim_scene(t, stage)
    b = t["buildings"][0]
    for k in ("id", "footprint", "levels", "archetype", "state", "investor", "area", "residential", "levels_assumed"):
        assert k in b
    assert all(k not in b for k in ("centroid", "osm", "height", "neighbours"))
    assert scene["buildings"][0]["centroid"], "the input is not modified"


def test_build_command_reports_size_and_trim(tmp_path, capsys):
    scene = tmp_path / "scene.json"
    scene.write_text(json.dumps(synthetic_scene(300)), encoding="utf-8")
    out = tmp_path / "p.html"
    cli.main(["pack", "build", str(TOY), "--scene", str(scene), "--out", str(out), "--trim", "centroid"])
    text = capsys.readouterr().out
    assert "MB" in text and "300 buildings" in text and "trimmed (centroid)" in text and out.exists()


def test_build_rejects_a_file_that_is_not_a_scene(tmp_path):
    f = tmp_path / "s.json"
    f.write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(pack.PackError, match="not a scene"):
        pack.load_scene(f)


def test_bind_js_beside_the_entry_is_loaded_after_it(tmp_path):
    d = mini(tmp_path)
    (d / "bind.js").write_text("/* the bind file */", encoding="utf-8")
    (d / "prng.js").write_text("/* shared prng */", encoding="utf-8")
    html = pack.build_page(d, include=[d / "prng.js"])
    assert html.index("shared prng") < html.index("registerRuntime('mini'") < html.index("the bind file")
    assert [f.name for f in pack.runtime_files(d)] == ["runtime.js", "bind.js"]


# ---- the dev server ----

def get(srv, path="/", host=None):
    c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=10)
    c.request("GET", path, headers={"Host": host} if host else {})
    r = c.getresponse()
    return r.status, r.read().decode("utf-8")


class Events:
    """Reads the server-sent events of a running dev server."""

    def __init__(self, srv):
        self.versions, self.cond = [], threading.Condition()
        self.conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=30)
        self.conn.request("GET", "/__events")
        self.resp = self.conn.getresponse()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            while True:
                line = self.resp.fp.readline()
                if not line:
                    return
                if line.startswith(b"data:"):
                    with self.cond:
                        self.versions.append(json.loads(line[5:])["version"])
                        self.cond.notify_all()
        except Exception:
            pass

    def wait_for(self, n, timeout=10):
        with self.cond:
            self.cond.wait_for(lambda: len(self.versions) >= n, timeout)
        return list(self.versions)


@pytest.fixture
def dev(tmp_path, monkeypatch):
    monkeypatch.setattr(packdev, "POLL_S", 0.05)
    d = copy_toy(tmp_path)
    srv = packdev.DevServer(packdev.DevState(d), port=0).start()
    yield srv, d
    srv.stop()


def touch_later(f, text):
    old = f.stat().st_mtime_ns
    f.write_text(text, encoding="utf-8")
    import os
    os.utime(f, ns=(old + 5_000_000, old + 5_000_000))      # a filesystem with coarse timestamps must still see the change


def test_dev_server_listens_on_loopback_only_and_serves_the_page(dev):
    srv, _ = dev
    assert srv.server_address[0] == "127.0.0.1"
    code, html = get(srv)
    assert code == 200 and "<title>Toy epidemic</title>" in html and "EventSource('/__events')" in html and "registerRuntime('toy-epidemic'" in html
    assert get(srv, "/nothing")[0] == 404
    assert get(srv, "/", host="evil.example.com")[0] == 403, "a page requested under another name is refused"
    st = json.loads(get(srv, "/__status")[1])
    assert st["ok"] and st["errors"] == [] and st["bytes"] > 100000


def test_dev_server_hot_reloads_on_runtime_manifest_and_bind_changes(dev):
    srv, d = dev
    ev = Events(srv)
    assert len(ev.wait_for(1)) == 1
    v0 = json.loads(get(srv, "/__status")[1])["version"]
    # runtime.js
    touch_later(d / "runtime.js", (d / "runtime.js").read_text(encoding="utf-8") + "\n/* edited runtime */\n")
    assert len(ev.wait_for(2)) == 2
    assert "edited runtime" in get(srv)[1]
    # pack.yaml
    touch_later(d / "pack.yaml", (d / "pack.yaml").read_text(encoding="utf-8").replace("title: Toy epidemic", "title: Renamed epidemic"))
    assert len(ev.wait_for(3)) == 3
    assert "<title>Renamed epidemic</title>" in get(srv)[1]
    # bind.js appears
    (d / "bind.js").write_text("/* new bind file */", encoding="utf-8")
    assert len(ev.wait_for(4)) == 4
    assert "new bind file" in get(srv)[1]
    assert json.loads(get(srv, "/__status")[1])["version"] > v0


def test_dev_server_shows_validation_errors_in_the_page_and_recovers(dev):
    srv, d = dev
    good = (d / "pack.yaml").read_text(encoding="utf-8")
    ev = Events(srv)
    ev.wait_for(1)
    touch_later(d / "pack.yaml", good.replace("default: 0.08", "default: 5"))
    assert len(ev.wait_for(2)) == 2
    code, html = get(srv)
    assert code == 200 and "cannot be shown yet" in html and "params.beta.default" in html and "EventSource" in html
    assert json.loads(get(srv, "/__status")[1])["ok"] is False
    touch_later(d / "pack.yaml", "id: [unclosed\n")
    assert len(ev.wait_for(3)) == 3 and "not valid YAML" in get(srv)[1]
    touch_later(d / "pack.yaml", good)
    assert len(ev.wait_for(4)) == 4
    assert "registerRuntime('toy-epidemic'" in get(srv)[1]


def test_dev_server_survives_a_deleted_runtime_file_and_a_scene_change(tmp_path, monkeypatch):
    monkeypatch.setattr(packdev, "POLL_S", 0.05)
    d = copy_toy(tmp_path)
    scene = tmp_path / "scene.json"
    scene.write_text(json.dumps(synthetic_scene(50)), encoding="utf-8")
    srv = packdev.DevServer(packdev.DevState(d, scene_path=scene), port=0).start()
    try:
        assert "w1049" in get(srv)[1]
        scene.write_text(json.dumps(synthetic_scene(60)), encoding="utf-8")
        deadline = time.time() + 5
        while time.time() < deadline and "w1059" not in get(srv)[1]:
            time.sleep(0.05)
        assert "w1059" in get(srv)[1]
        (d / "runtime.js").unlink()
        deadline = time.time() + 5
        while time.time() < deadline and "cannot be shown yet" not in get(srv)[1]:
            time.sleep(0.05)
        assert "does not exist" in get(srv)[1]
    finally:
        srv.stop()


def test_dev_command_reports_a_busy_port(tmp_path):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen()
    try:
        with pytest.raises(SystemExit, match="cannot start the server"):
            cli.main(["pack", "dev", str(TOY), "--port", str(s.getsockname()[1])])
    finally:
        s.close()


# ---- pack check ----

def test_check_command_runs_the_runtime_on_the_toy_pack(capsys):
    pytest.importorskip("yaml")
    if shutil.which("node") is None:
        pytest.skip("node")
    with pytest.raises(SystemExit) as e:
        cli.main(["pack", "check", str(TOY), "--steps", "12"])
    out = capsys.readouterr().out
    assert e.value.code == 0 and "PASS  run with the default parameters" in out and "run with preset lockdown" in out and ": ok: 0 error(s)" in out


@needs_node
def test_check_binds_the_runtime_to_a_scene(tmp_path):
    scene = tmp_path / "s.json"
    scene.write_text(json.dumps(synthetic_scene(400)), encoding="utf-8")
    res = packcheck.run(TOY, scene_path=scene, steps=6)
    assert res.ok() and any(i["name"] == "bindScene on the scene" and "400 of 400" in i["info"] for i in res.items)


@needs_node
def test_check_catches_nondeterminism_math_random_and_frame_mismatches(tmp_path):
    leaky = MINI_JS.replace("init(p, ents, seed) {", "init(p, ents, seed) { globalThis.__n = (globalThis.__n || 0) + 1; seed += globalThis.__n;")
    r = packcheck.run(mini(tmp_path / "a", leaky) if (tmp_path / "a").mkdir() is None else None, steps=5)
    assert not r.ok() and any("not deterministic" in e for e in r.errors)
    (tmp_path / "b").mkdir()
    r = packcheck.run(mini(tmp_path / "b", MINI_JS.replace("seed, t: 0 }", "seed: seed + Math.random(), t: 0 }")), steps=5)
    assert not r.ok() and any("Math.random" in e for e in r.errors)
    (tmp_path / "c").mkdir()
    r = packcheck.run(mini(tmp_path / "c", MINI_JS.replace("series: { total: [v.reduce((a, b) => a + b, 0)] }", "series: {}")), steps=5)
    assert not r.ok() and any("series.total is declared" in e for e in r.errors)
    (tmp_path / "d").mkdir()
    r = packcheck.run(mini(tmp_path / "d", MINI_JS.replace("kind.push(v[i] > 5 ? 1 : 0)", "kind.push(7)")), steps=5)
    assert not r.ok() and any("not an index" in e for e in r.errors)
    (tmp_path / "e").mkdir()
    r = packcheck.run(mini(tmp_path / "e", MINI_JS.replace("PaperDolls.registerRuntime('mini'", "PaperDolls.registerRuntime('other'")), steps=5)
    assert not r.ok() and any("did not register itself as mini" in e for e in r.errors)
    (tmp_path / "f").mkdir()
    r = packcheck.run(mini(tmp_path / "f", MINI_JS.replace("h.t++;", "h.t++; if (h.t === 3) throw new Error('boom');")), steps=5)
    assert not r.ok() and any("boom" in e for e in r.errors)


def test_check_static_rules_and_exit_codes(tmp_path, capsys):
    y = yaml.safe_load(MINI_YAML)
    y["entities"]["cell"]["fields"]["unused"] = "number"
    del y["mappings"][1]["scale"]["label"]
    y["mappings"].append({"entity": "cell", "field": "ghost", "channel": "segments", "scale": {"type": "categorical", "values": {}}})
    d = tmp_path
    (d / "pack.yaml").write_text(yaml.safe_dump(y, sort_keys=False), encoding="utf-8")
    (d / "runtime.js").write_text(MINI_JS, encoding="utf-8")
    res = packcheck.run(d, skip_runtime=True)
    assert any("mappings[2].field: entity cell has no field ghost" in e for e in res.errors), res.errors
    del y["mappings"][2]
    (d / "pack.yaml").write_text(yaml.safe_dump(y, sort_keys=False), encoding="utf-8")
    res = packcheck.run(d, skip_runtime=True)
    assert res.ok() and any("legend heading" in w for w in res.warnings) and any("unused" in w and "no mapping" in w for w in res.warnings)
    assert not packcheck.run(d, skip_runtime=True, strict=True).ok()
    with pytest.raises(SystemExit) as e:
        cli.main(["pack", "check", str(d), "--manifest-only", "--strict"])
    assert e.value.code == 1 and "FAILED" in capsys.readouterr().out
    with pytest.raises(SystemExit) as e:
        cli.main(["pack", "check", str(d), "--manifest-only", "--json"])
    j = json.loads(capsys.readouterr().out)
    assert e.value.code == 0 and j["ok"] and j["checks"][0]["name"] == "manifest"


# ---- runtime parity ----

@needs_node
def test_runtime_parity_passes_and_writes_then_compares_golden(tmp_path):
    d = mini(tmp_path / "pack") if (tmp_path / "pack").mkdir() is None else None
    (d / "tests").mkdir()
    (d / "tests" / "parity_cases.json").write_text(json.dumps(CASES), encoding="utf-8")
    ref = tmp_path / "ref.py"
    ref.write_text(MINI_PY, encoding="utf-8")
    res = packcheck.run(d, parity=str(ref), steps=5)
    assert res.ok(), res.errors
    assert [i["name"] for i in res.items if i["name"].startswith("parity")] == ["parity slow", "parity fast"]
    g = tmp_path / "golden"
    res = packcheck.run(d, parity=str(ref), golden=str(g))
    assert res.ok() and (g / "slow.json").exists() and any("wrote golden" in w for w in res.warnings)
    assert packcheck.run(d, parity=str(ref), golden=str(g)).ok()
    # the reference changes: the runtime still matches the committed golden, but the reference no longer reproduces it
    ref.write_text(MINI_PY.replace("+ seed", "+ seed + 1"), encoding="utf-8")
    res = packcheck.run(d, parity=str(ref), golden=str(g))
    assert any("no longer reproduces golden slow.json" in e for e in res.errors)
    assert packcheck.run(d, parity=str(ref), golden=str(g), update_golden=True).items  # regenerates
    # and a runtime that drifted from the reference is reported with where
    ref.write_text(MINI_PY, encoding="utf-8")
    (d / "runtime.js").write_text(MINI_JS.replace("h.rate * h.t", "h.rate * h.t * 1.001"), encoding="utf-8")
    res = packcheck.run(d, parity=str(ref))
    assert not res.ok() and any("differs from the reference: frame 1 entities.cell.v[0]" in e for e in res.errors), res.errors


@needs_node
def test_runtime_parity_names_a_missing_reference_or_cases_file(tmp_path):
    d = mini(tmp_path)
    res = packcheck.run(d, parity="no_such_module_xyz")
    assert res.exit_code() == 2 and "cannot import" in res.errors[0]
    ref = tmp_path / "r.py"
    ref.write_text(MINI_PY, encoding="utf-8")
    res = packcheck.run(d, parity=str(ref))
    assert res.exit_code() == 2 and "no parity cases" in res.errors[0]


def test_frame_normalisation_accepts_rows_and_names():
    m = yaml.safe_load(MINI_YAML)
    f = packcheck.normalise_frames(m, [{"t": 0, "cells": [{"v": None, "kind": "high"}, {"v": 2, "kind": None}], "series": {"total": 2}}])[0]
    assert f["entities"]["cell"]["kind"] == [1, -1] and f["series"]["total"] == [2]
    assert packcheck.diff(f["entities"]["cell"]["v"], [float("nan"), 2]) is None
    assert packcheck.diff([1.0], [1.0 + 1e-6]) and packcheck.diff([1.0], [1.0 + 1e-12]) is None and packcheck.diff([1], [2])
