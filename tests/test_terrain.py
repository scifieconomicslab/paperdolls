"""Runs the JavaScript terrain suite (viz/test_terrain.js): schema, lift, ground, shadows, depth, picking, camera, and the unchanged flat picture."""
import shutil
import subprocess
from pathlib import Path

import pytest

from conftest import node_env

ROOT = Path(__file__).resolve().parents[1]
node = shutil.which("node")
pytestmark = pytest.mark.skipif(node is None, reason="node is not installed")


def test_js_terrain_suite_passes():
    r = subprocess.run([node, str(ROOT / "viz" / "test_terrain.js")], capture_output=True, text=True, env=node_env(), timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout and "all passed" in r.stdout
