"""The world-family / palette-family contract shared by ingest and construct.

A scene names one world family (`real`, `historical`, `fantasy`, `scifi`) and
one palette family from `reference/render/palettes.json`. The palette family
declares which world family it belongs to; a mismatch is an error, never a
silent fallback to `nw`.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PALETTES = ROOT / "reference" / "render" / "palettes.json"
WORLD_FAMILIES = ("real", "historical", "fantasy", "scifi")


def _palettes() -> list[dict]:
    return json.loads(PALETTES.read_text(encoding="utf-8"))["families"]


def palette_family(palette: str) -> dict:
    for family in _palettes():
        if family.get("id") == palette:
            return family
    known = ", ".join(family.get("id", "?") for family in _palettes())
    raise ValueError(f"unknown palette family {palette!r}; choose one of {known}")


def check_family_palette(family: str, palette: str) -> dict:
    if family not in WORLD_FAMILIES:
        raise ValueError(f"unknown world family {family!r}; choose one of {', '.join(WORLD_FAMILIES)}")
    entry = palette_family(palette)
    declared = entry.get("world_family", "real")
    if declared != family:
        raise ValueError(
            f"palette family {palette!r} belongs to the {declared!r} world family, not {family!r}; "
            "choose a palette family from the same family"
        )
    return entry
