#!/usr/bin/env python3
"""Create an append-only, versioned snapshot of a world.

    .venv/bin/python tools/snapshot-world.py worlds/<world> --version v1

The snapshot copies the scene, the map input, the model, the binding and the
world record into worlds/<world>/snapshots/<version>/ and writes a manifest
with sha256 for every file. Snapshots are never overwritten: choose a new
version id. The append-only LOG.md records the snapshot date and manifest hash.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("world", help="world directory, e.g. worlds/family-smoke")
    parser.add_argument("--version", required=True, help="version id, e.g. v1 or 2026-11-10")
    parser.add_argument("--date", default=date.today().isoformat(), help="snapshot date (default today)")
    args = parser.parse_args(argv)

    world_dir = Path(args.world)
    if not world_dir.is_absolute():
        world_dir = (Path.cwd() / world_dir).resolve()
    if not (world_dir / f"{world_dir.name}.md").exists():
        print(f"not a world directory (no {world_dir.name}.md): {world_dir}")
        return 1
    snapshot_dir = world_dir / "snapshots" / args.version
    if snapshot_dir.exists():
        print(f"snapshot already exists (snapshots are append-only): {snapshot_dir}")
        return 1

    candidates = [
        world_dir / "map-data" / "scene.json",
        world_dir / "map-data" / "scene.composed.json",     # what the page reads when a world composes its scene
        world_dir / "map-data" / "spec.json",
        world_dir / "map-data" / "extract.json",
        world_dir / "sim-code" / "model.ts",
        world_dir / "sim-code" / "model-binding.json",
        world_dir / f"{world_dir.name}.md",
        world_dir / "art-bible.md",
        world_dir / "page" / "src" / "stage" / "STAGE.json",
    ]
    files = [path for path in candidates if path.exists()]
    if not files:
        print("nothing to snapshot")
        return 1

    snapshot_dir.mkdir(parents=True)
    entries = []
    for path in files:
        target = snapshot_dir / path.name
        shutil.copy2(path, target)
        entries.append({"file": target.name, "source": str(path.relative_to(world_dir)), "sha256": sha256(target), "bytes": target.stat().st_size})

    scene = json.loads((world_dir / "map-data" / "scene.json").read_text(encoding="utf-8"))
    area = scene.get("area", {})
    manifest = {
        "world": world_dir.name,
        "version": args.version,
        "date": args.date,
        "family": area.get("family"),
        "palette": area.get("palette"),
        "source": area.get("source"),
        "files": entries,
    }
    manifest_path = snapshot_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    manifest_hash = sha256(manifest_path)

    log = world_dir / "snapshots" / "LOG.md"
    if not log.exists():
        log.write_text("# Snapshot log\n\nAppend-only; one line per snapshot.\n\n", encoding="utf-8")
    with log.open("a", encoding="utf-8") as handle:
        handle.write(f"- {args.date} — {args.version} — {area.get('family')}/{area.get('palette')} — manifest sha256 {manifest_hash}\n")

    print(f"wrote {snapshot_dir} ({len(entries)} files); manifest {manifest_hash[:12]}…")
    return 0


if __name__ == "__main__":
    sys.exit(main())
