"""Runs the JavaScript asset-library tests and validates the SVG the library emits.
Skipped when node is not installed. The render test inside the JS suite also needs the node 'canvas' package and skips itself without it."""
import os
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
from conftest import node_env

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "viz" / "test_assets.js"
node = shutil.which("node")
pytestmark = pytest.mark.skipif(node is None, reason="node is not installed")


def run_js(extra_env=None):
    env = node_env()
    env.update(extra_env or {})
    return subprocess.run([node, str(JS)], capture_output=True, text=True, env=env, timeout=300)


def test_js_asset_suite_passes():
    r = run_js()
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout


def test_emitted_svg_is_valid_xml(tmp_path):
    r = run_js({"SVG_OUT": str(tmp_path)})
    assert r.returncode == 0, r.stdout + r.stderr
    files = sorted(tmp_path.glob("*.svg"))
    assert len(files) >= 4 * (19 + 9 + 6), "expected an SVG per vehicle, person and building archetype, per heading"
    for f in files:
        root = ET.parse(f).getroot()
        assert root.tag.endswith("svg")
        polys = [e for e in root if e.tag.endswith("polygon")]
        assert polys, f.name
        assert any(p.get("data-surface") == "1" for p in polys), f"{f.name} has no data surface"
        assert all(p.get("data-face") in ("left", "right", "top") for p in polys), f.name


def test_camera_and_controls_suite_passes():
    r = subprocess.run([node, str(ROOT / "viz" / "test_camera.js")], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0 and "FAIL" not in r.stdout, r.stdout + r.stderr
