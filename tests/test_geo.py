"""Runs the JavaScript geometry suite (viz/test_geo.js): scene validation caps, small engine items, smooth terrain shading (issues #15, #20, #21)."""
import shutil
import subprocess
from pathlib import Path

import pytest

from conftest import node_env

ROOT = Path(__file__).resolve().parents[1]
node = shutil.which("node")
pytestmark = pytest.mark.skipif(node is None, reason="node is not installed")


def test_js_geo_suite_passes():
    r = subprocess.run([node, str(ROOT / "viz" / "test_geo.js")], capture_output=True, text=True, env=node_env(), timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout and "passed" in r.stdout
