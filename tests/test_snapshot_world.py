"""The versioned snapshot tool copies the world contract, hashes it, and never overwrites."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "snapshot-world.py"


def make_world(tmp_path):
    world = tmp_path / "test-world"
    (world / "map-data").mkdir(parents=True)
    (world / "sim-code").mkdir()
    (world / "test-world.md").write_text("# Test world\n\n## Snapshot\n\n- version: v1\n- date: 2026-11-10\n")
    (world / "map-data" / "scene.json").write_text(json.dumps({"area": {"family": "real", "palette": "nw", "source": "constructed"}}))
    (world / "map-data" / "spec.json").write_text('{"seed": 1}\n')
    (world / "sim-code" / "model.ts").write_text("export default {};\n")
    (world / "sim-code" / "model-binding.json").write_text("{}\n")
    return world


def run(world):
    return subprocess.run([sys.executable, str(SCRIPT), str(world), "--version", "v1", "--date", "2026-11-10"], capture_output=True, text=True)


def test_snapshot_writes_manifest_and_log(tmp_path):
    world = make_world(tmp_path)
    result = run(world)
    assert result.returncode == 0, result.stdout + result.stderr
    snapshot = world / "snapshots" / "v1"
    manifest = json.loads((snapshot / "manifest.json").read_text())
    assert manifest["version"] == "v1"
    assert manifest["family"] == "real" and manifest["palette"] == "nw"
    assert {entry["file"] for entry in manifest["files"]} == {"scene.json", "spec.json", "model.ts", "model-binding.json", "test-world.md"}
    assert "v1" in (world / "snapshots" / "LOG.md").read_text()


def test_snapshot_is_append_only(tmp_path):
    world = make_world(tmp_path)
    assert run(world).returncode == 0
    second = run(world)
    assert second.returncode == 1
    assert "append-only" in second.stdout
