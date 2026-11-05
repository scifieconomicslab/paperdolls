"""The built viewer page, driven headlessly. Needs node plus the npm packages jsdom and canvas; skipped otherwise."""
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

import osm_fixture as F
from conftest import node_env
from lab_render.ingest import build

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


def _has(mod):
    return NODE and subprocess.run([NODE, "-e", f"require('{mod}')"], capture_output=True, env=node_env()).returncode == 0


@pytest.mark.skipif(not _has("jsdom"), reason="node and jsdom are needed (npm install jsdom canvas)")
def test_viewer_loads_an_ingested_scene_and_survives_bad_input(tmp_path):
    subprocess.run(["python3", str(ROOT / "viz" / "build_pages.py")], check=True, capture_output=True)
    scene, _ = build.ingest(F.write_all(tmp_path)["overpass-json"], boundary_relation=99001)
    p = tmp_path / "scene.json"
    p.write_text(json.dumps(scene))
    r = subprocess.run([NODE, str(ROOT / "viz" / "test_viewer.js"), str(p)], capture_output=True, text=True, env=node_env(), timeout=240)
    assert r.returncode == 0 and "PASS viewer" in r.stdout, r.stdout + r.stderr
