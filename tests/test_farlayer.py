"""Runs the JavaScript far-layer suite (viz/test_farlayer.js): the rough first picture, the exact painting behind it, and the incremental patch, each checked pixel for pixel against a layer painted from scratch."""
import shutil
import subprocess
from pathlib import Path

import pytest

from conftest import node_env

ROOT = Path(__file__).resolve().parents[1]
node = shutil.which("node")
pytestmark = pytest.mark.skipif(node is None, reason="node is not installed")


def test_js_far_layer_suite_passes():
    r = subprocess.run([node, str(ROOT / "viz" / "test_farlayer.js")], capture_output=True, text=True, env=node_env(), timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout and "all passed" in r.stdout
