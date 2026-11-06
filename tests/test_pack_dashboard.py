"""The dashboard layer of model packs (P5): the SVG chart module, the layout engine, A/B compare, and the toy pack's dashboard on the built page.
Node suites with pytest wrappers, in the style of tests/test_pack.py. Skipped when node is not installed (the jsdom ones also when jsdom is not)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from conftest import node_env

from paperdolls import pack

ROOT = Path(__file__).resolve().parents[1]
TOY = ROOT / "packs" / "toy-epidemic"
node = shutil.which("node")
needs_node = pytest.mark.skipif(node is None, reason="node is not installed")


def run_node(*args, timeout=300):
    return subprocess.run([node, *map(str, args)], capture_output=True, text=True, env=node_env(), timeout=timeout)


@needs_node
def test_js_chart_suite_passes():
    r = run_node(ROOT / "viz" / "test_pack_charts.js")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout and ("all passed" in r.stdout or "SKIP" in r.stdout), r.stdout


def _variant():
    """The toy pack with its layout changed: a stacked area chart at the bottom, no compare panel, no Display group."""
    m = pack.load(TOY)
    m["layout"] = {"left": [{"control": "params"}, {"control": "presets"}], "right": [{"control": "legend"}, {"chart": "line", "series": "counts"}],
                   "bottom": [{"control": "timeline"}, {"chart": "area", "series": "counts", "title": "Stacked"}]}
    return m


@needs_node
def test_dashboard_page_runs_in_jsdom(tmp_path):
    """Charts, KPI tiles, the compare panel, the reduced Display group, hover and the map flip, on the built toy page (and a variant page)."""
    import yaml
    page = tmp_path / "toy.html"
    page.write_text(pack.build_page(TOY), encoding="utf-8")
    var = tmp_path / "variant"
    var.mkdir()
    (var / "pack.yaml").write_text(yaml.safe_dump(_variant(), sort_keys=False), encoding="utf-8")
    (var / "runtime.js").write_text((TOY / "runtime.js").read_text(encoding="utf-8"), encoding="utf-8")
    assert pack.check(var)[0] == []
    vpage = tmp_path / "variant.html"
    vpage.write_text(pack.build_page(var), encoding="utf-8")
    r = run_node(ROOT / "viz" / "test_pack_dash.js", page, vpage)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout and "all passed" in r.stdout and "SKIP" not in r.stdout, r.stdout


def test_toy_pack_declares_a_dashboard():
    m = pack.load(TOY)
    kinds = {k for region in m["layout"].values() for it in region for k in it if k in ("chart", "kpis", "control")}
    assert {"chart", "kpis", "control"} <= kinds
    assert any(it.get("control") == "compare" for it in m["layout"]["left"])
    assert any(it.get("control") == "display" and it.get("items") for it in m["layout"]["right"])
    assert {it["chart"] for region in m["layout"].values() for it in region if "chart" in it} >= {"line", "bar"}


def test_built_page_has_the_dashboard_code_and_stays_offline():
    html = pack.build_page(TOY)
    assert "PackCharts" in html and "PackDash" in html and "createCompare" in html
    assert "<script src" not in html and "<link " not in html
    assert "PackCharts" not in __import__("paperdolls.viewer_build", fromlist=["build_viewer"]).build_viewer(), "the plain viewer is unchanged"
