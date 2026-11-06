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
