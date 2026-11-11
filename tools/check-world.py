#!/usr/bin/env python3
"""Validate a world record: the sections the pipeline relies on must exist,
in order, with content. Catches silent omissions at gate time.

    .venv/bin/python tools/check-world.py /worlds/<world_name>/<world_name>.md

Exit 0 = OK, 1 = missing or malformed sections (each reported).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    (r"^# .+", "title"),
    (r"^## Description\s*$", "## Description"),
    (r"^## Step count type\s*$", "## Step count type"),
    (r"^## Agents and structure mapping\s*$", "## Agents and structure mapping"),
    (r"^## Interactive parameters\s*$", "## Interactive parameters"),
    (r"^## Dashboard outputs\s*$", "## Dashboard outputs"),
    (r"^## Top colour\s*$", "## Top colour"),
    (r"^## Structural modifications\s*$", "## Structural modifications"),
    (r"^## Causal graph\s*$", "## Causal graph"),
    (r"^## Scenarios and interventions\s*$", "## Scenarios and interventions"),
    (r"^## Map\s*$", "## Map"),
    (r"^## Decisions log\s*$", "## Decisions log"),
    (r"^## Snapshot\s*$", "## Snapshot"),
    (r"^## Attribution\s*$", "## Attribution"),
]
STEP_TYPES = {"hours", "days", "weeks", "months", "years", "tick"}
FAMILIES = {"real", "historical", "fantasy", "scifi"}
GATES = ["Gate 1", "Gate 2", "Gate 2b", "Gate 3", "Gate 4", "Gate 5", "Gate 6", "Gate 7"]


def section(text: str, heading: str) -> str:
    match = re.search(rf"^{re.escape(heading)}\s*\n([\s\S]*?)(?=^## |\Z)", text, re.MULTILINE)
    return match.group(1) if match else ""


def cross_check(path: Path, text: str) -> list[str]:
    """Check the record against the sibling model-binding.json, when present."""
    binding_path = path.parent / "sim-code" / "model-binding.json"
    if not binding_path.exists():
        return []
    try:
        binding = json.loads(binding_path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001 - a bad binding is a record problem
        return [f"binding: cannot read {binding_path.name}: {error}"]

    fails: list[str] = []
    family_line = re.search(r"^- family:\s*(\w+)", section(text, "## Map"), re.MULTILINE)
    family_value = family_line.group(1) if family_line else ""
    if binding.get("family") and binding["family"] != family_value:
        fails.append(f"binding: family {binding['family']} does not match Map family {family_value!r}")
    palette_line = re.search(r"^- palette:\s*(\S+)", section(text, "## Map"), re.MULTILINE)
    palette_value = palette_line.group(1) if palette_line else ""
    if binding.get("region") and binding["region"] != palette_value:
        fails.append(f"binding: region {binding['region']} does not match Map palette {palette_value!r}")

    top = section(text, "## Top colour")
    for entry in binding.get("bindings", []):
        field = (entry.get("top_color") or {}).get("field")
        if field and field not in top:
            fails.append(f"binding: top-colour field {field!r} is not recorded under Top colour")

    structural = section(text, "## Structural modifications")
    for entry in binding.get("architecture", []):
        field = entry.get("field")
        if field and field not in structural:
            fails.append(f"binding: structural field {field!r} is not recorded under Structural modifications")

    graph = binding.get("causal_graph")
    if graph and graph.get("confirmed") and graph.get("nodes"):
        causal = section(text, "## Causal graph")
        if not any(str(node) in causal for node in graph["nodes"]):
            fails.append("binding: confirmed causal graph is not recorded under Causal graph")

    scenarios = binding.get("scenarios") or []
    scenario_text = section(text, "## Scenarios and interventions")
    for scenario in scenarios:
        label = scenario.get("label") or scenario.get("id")
        if label and label not in scenario_text:
            fails.append(f"binding: scenario {label!r} is not recorded under Scenarios and interventions")

    return fails


def validate(text: str, path: Path | None = None) -> list[str]:
    fails: list[str] = []

    # Sections exist and appear in the README order.
    positions: list[int] = []
    for pattern, name in REQUIRED:
        match = re.search(pattern, text, re.MULTILINE)
        if not match:
            fails.append(f"missing section: {name}")
        else:
            positions.append(match.start())
    if len(positions) == len(REQUIRED) and positions != sorted(positions):
        fails.append("sections are out of order")

    # Step count type must be one of the six, on the line after its heading.
    match = re.search(r"^## Step count type\s*\n+\s*(?:<!--.*?-->\s*\n)?\s*(\w+)", text, re.MULTILINE | re.DOTALL)
    if not match or match.group(1).lower() not in STEP_TYPES:
        fails.append("step count type: not one of hours|days|weeks|months|years|tick")

    # Description non-empty and not the template placeholder.
    description = section(text, "## Description").strip()
    if len(description) < 40:
        fails.append("Description: missing or too short (< 40 chars)")

    # Dashboard outputs: at least one table row.
    dashboard = section(text, "## Dashboard outputs")
    if not re.search(r"^\|.+\|$", dashboard, re.MULTILINE):
        fails.append("Dashboard outputs: missing or has no table row")

    # Gate 5 sections must exist with content (they may say "none").
    for heading in ("## Top colour", "## Structural modifications", "## Causal graph", "## Scenarios and interventions"):
        if not section(text, heading).strip():
            fails.append(f"{heading}: empty")

    # Map contract.
    map_text = section(text, "## Map")
    source = re.search(r"^- source:\s*(.+)$", map_text, re.MULTILINE)
    if not source:
        fails.append("Map: missing `- source:`")
    elif not source.group(1).strip().startswith(("osm-overpass", "constructed")):
        fails.append("Map: source must start with osm-overpass or constructed")
    family = re.search(r"^- family:\s*(\w+)", map_text, re.MULTILINE)
    if not family:
        fails.append("Map: missing `- family:`")
    elif family.group(1) not in FAMILIES:
        fails.append("Map: family must be one of real|historical|fantasy|scifi")
    palette = re.search(r"^- palette:\s*(\S+)", map_text, re.MULTILINE)
    if not palette:
        fails.append("Map: missing `- palette:`")
    elif family and family.group(1) in FAMILIES:
        palettes = json.loads((ROOT / "reference" / "render" / "palettes.json").read_text(encoding="utf-8"))
        entry = next((item for item in palettes["families"] if item.get("id") == palette.group(1)), None)
        if entry is None:
            fails.append(f"Map: unknown palette family {palette.group(1)!r}")
        elif (entry.get("world_family") or "real") != family.group(1):
            fails.append(f"Map: palette {palette.group(1)!r} belongs to {entry.get('world_family', 'real')!r}, not {family.group(1)!r}")
    if not re.search(r"^- stored:", map_text, re.MULTILINE):
        fails.append("Map: missing `- stored:`")
    if "sha256:" not in map_text:
        fails.append("Map: missing a sha256 for the stored input")
    if not re.search(r"asset[^\n]*\d+(\.\d+)?\s*%|\d+(\.\d+)?\s*%[^\n]*asset", map_text, re.IGNORECASE):
        fails.append("Map: missing the asset-fit share (a line naming the asset fit and its %)")
    if not re.search(r"^- report:", map_text, re.MULTILINE):
        fails.append("Map: missing `- report:`")

    # Decisions log: dated entries, and the Gate 1-7 sequence is recorded.
    log = section(text, "## Decisions log")
    if not re.search(r"20\d\d-\d\d-\d\d", log):
        fails.append("Decisions log: no dated entries")
    for gate in GATES:
        if not re.search(rf"^- 20\d\d-\d\d-\d\d\b[^\n]*\b{re.escape(gate)}\b(?!b)", log, re.MULTILINE):
            fails.append(f"Decisions log: missing a dated {gate} line")
    if re.search(r"YYYY-MM-DD|<decision", log):
        fails.append("Decisions log: the template's placeholder lines are still there; delete them")

    # Snapshot: a version and a date.
    snapshot = section(text, "## Snapshot").strip()
    if not snapshot:
        fails.append("Snapshot: empty")
    if not re.search(r"20\d\d-\d\d-\d\d", snapshot):
        fails.append("Snapshot: missing a date")
    if not re.search(r"^- version:\s*\S+", snapshot, re.MULTILINE):
        fails.append("Snapshot: missing a version id")

    # Attribution: ODbL required only when the scene derives from OpenStreetMap.
    osm_derived = bool(source and source.group(1).strip().startswith("osm-overpass"))
    attribution = section(text, "## Attribution")
    if not attribution:
        fails.append("Attribution: section missing")
    else:
        if "CC BY 4.0" not in attribution:
            fails.append("Attribution: must name CC BY 4.0")
        if osm_derived and "ODbL" not in attribution:
            fails.append("Attribution: OSM-derived world must name the ODbL attribution")

    if path is not None:
        fails.extend(cross_check(path, text))
    return fails


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="the world record to check")
    args = parser.parse_args(argv)
    path = Path(args.path)
    if not path.exists():
        print(f"FAIL - {path} does not exist")
        return 1
    fails = validate(path.read_text(encoding="utf-8"), path)
    if fails:
        print(f"{path.name}: {len(fails)} problem(s)")
        for problem in fails:
            print("FAIL -", problem)
        return 1
    print(f"{path.name}: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
