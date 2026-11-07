"""Visual channels of model packs (P6): the node suite for segments, outline and halo, the insulation and community overlays, and ground tint.
The manifest validator cases for them live in pack_cases.json and run in test_pack.py. Skipped when node is not installed."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from conftest import node_env

from paperdolls import pack

ROOT = Path(__file__).resolve().parents[1]
node = shutil.which("node")
pytestmark = pytest.mark.skipif(node is None, reason="node is not installed")


def test_js_channel_suite_passes():
    toy = pack.load(ROOT / "packs" / "toy-epidemic")
    r = subprocess.run([node, str(ROOT / "viz" / "test_channels.js"), "--manifest-json", json.dumps(toy)], capture_output=True, text=True, env=node_env(), timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout, r.stdout


def test_js_declutter_suite_passes():
    r = subprocess.run([node, str(ROOT / "viz" / "test_declutter.js")], capture_output=True, text=True, env=node_env(), timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout, r.stdout
