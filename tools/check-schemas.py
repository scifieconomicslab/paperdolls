#!/usr/bin/env python3
"""Validate a world's JSON files against the schemas in schemas/.

    .venv/bin/python tools/check-schemas.py worlds/<name>

Checks sim-code/model-binding.json against schemas/model-binding.json, and
map-data/scene.json (plus scene.composed.json when present) against
schemas/scene.json. Prints PASS/FAIL per file; exits 1 on any failure or a
missing required file.
"""
import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator, validators
except ImportError:
    sys.exit("jsonschema is missing: .venv/bin/pip install -r requirements.txt")

ROOT = Path(__file__).resolve().parent.parent
CHECKS = [
    ("sim-code/model-binding.json", "model-binding.json", True),
    ("map-data/scene.json", "scene.json", True),
    ("map-data/scene.composed.json", "scene.json", False),
]


def validate(doc_path: Path, schema_path: Path) -> list[str]:
    schema = json.loads(schema_path.read_text())
    cls = validators.validator_for(schema, default=Draft202012Validator)
    errors = sorted(cls(schema).iter_errors(json.loads(doc_path.read_text())), key=lambda e: list(e.path))
    return [f"{'/'.join(map(str, e.path)) or '(root)'}: {e.message[:200]}" for e in errors]


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    world = Path(sys.argv[1]).resolve()
    failed = False
    for rel, schema, required in CHECKS:
        doc = world / rel
        if not doc.exists():
            if required:
                print(f"FAIL - {rel}: missing")
                failed = True
            continue
        errs = validate(doc, ROOT / "schemas" / schema)
        if errs:
            failed = True
            print(f"FAIL - {rel} against schemas/{schema} ({len(errs)} error(s))")
            for e in errs[:10]:
                print(f"     {e}")
        else:
            print(f"PASS - {rel} against schemas/{schema}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
