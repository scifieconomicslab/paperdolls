"""The palette proposals: 12 real families plus three authored proposals, three looks each, well-formed colours."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PALETTES = ROOT / "reference" / "render" / "palettes.json"
HEX = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")

def walk_colours(o, path="$"):
    for k, v in o.items() if isinstance(o, dict) else enumerate(o):
        p = f"{path}.{k}" if isinstance(o, dict) else f"{path}[{k}]"
        if isinstance(v, dict):
            yield from walk_colours(v, p)
        elif isinstance(v, list):
            for i, item in enumerate(v):
                yield from walk_colours({str(i): item}, p)
        elif isinstance(v, str) and (path.endswith(("walls", "roofs", "accents", "canopies")) or k in ("ground", "road", "pave", "grass", "bloom", "water", "shadow", "wall", "wall2", "roof", "accent")):
            yield p, v

def test_real_and_proposal_families_have_three_looks_each():
    d = json.loads(PALETTES.read_text())
    fams = d["families"]
    real = [f for f in fams if f.get("world_family", "real") == "real"]
    assert len(real) == 12
    assert [f["id"] for f in real] == ["nw", "uk", "ws", "md", "ce", "sa", "se", "ea", "me", "sb", "la", "na"]
    proposals = [f for f in fams if f.get("world_family", "real") != "real"]
    assert [f["id"] for f in proposals] == ["roman", "high-pastoral", "cyberpunk"]
    for f in fams:
        assert len(f["looks"]) == 3, f["id"]

def test_status_and_note_are_declared():
    d = json.loads(PALETTES.read_text())
    assert d.get("status") == "proposed_starting_values"
    assert d.get("note")

def test_every_colour_is_a_hex_string():
    d = json.loads(PALETTES.read_text())
    bad = [(p, v) for p, v in walk_colours(d) if not HEX.match(v)]
    assert not bad, bad

def test_looks_have_the_required_roles():
    d = json.loads(PALETTES.read_text())
    for f in d["families"]:
        for look in f["looks"]:
            assert len(look["walls"]) == 4 and len(look["roofs"]) == 2 and len(look["accents"]) == 3
            assert len(look["canopies"]) == 3
            for key in ("ground", "road", "pave", "grass", "water", "shadow", "surface", "note"):
                assert look.get(key) not in (None, ""), (f["id"], look.get("id"), key)
            assert look["surface"] in ("asphalt", "cobble", "concrete", "earth", "stone", "grass")

def test_bloom_is_a_colour_or_null():
    d = json.loads(PALETTES.read_text())
    for f in d["families"]:
        for look in f["looks"]:
            assert look["bloom"] is None or HEX.match(look["bloom"])
