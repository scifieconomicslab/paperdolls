"""The pack runtime layer (store, worker client, run controller, play clock, A/B compare, inspector): the regression tests of the state-machine analysis
(docs/state-machines/parts/10-pack-runtime.md), a node suite with a pytest wrapper in the style of tests/test_pack_dashboard.py. Skipped when node is not installed."""
import shutil
import subprocess
from pathlib import Path

import pytest
from conftest import node_env

ROOT = Path(__file__).resolve().parents[1]
node = shutil.which("node")
needs_node = pytest.mark.skipif(node is None, reason="node is not installed")


@needs_node
def test_pack_runtime_regressions_pass():
    r = subprocess.run([node, str(ROOT / "viz" / "test_pack_runtime.js")], capture_output=True, text=True, env=node_env(), timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout and "all passed" in r.stdout, r.stdout
    assert "SKIP" not in r.stdout, "jsdom is needed for the inspector, readout and tooltip cases: " + r.stdout
