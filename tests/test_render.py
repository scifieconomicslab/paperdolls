"""Runs the JavaScript regression suite for the rendering-engine fixes of part 30 (viz/test_render.js): GPU canvas backing, ground marks, ground height,
the sprite budget and eviction, device pixel ratio and the far layer's exact flag. Needs node-canvas (PAPERDOLLS_NODE_MODULES)."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from conftest import node_env

ROOT = Path(__file__).resolve().parents[1]
node = shutil.which("node")
pytestmark = pytest.mark.skipif(node is None, reason="node is not installed")


def test_js_render_fix_suite_passes():
    r = subprocess.run([node, str(ROOT / "viz" / "test_render.js")], capture_output=True, text=True, env=node_env(), timeout=600)
    assert r.returncode == 0, r.stdout + r.stderr
    if r.stdout.startswith("SKIP") and not os.environ.get("CI"):
        pytest.skip(r.stdout.strip())  # node-canvas missing on a developer machine; on CI (CI is set) this must fail loudly, not skip
    assert "FAIL" not in r.stdout and "all passed" in r.stdout, r.stdout
