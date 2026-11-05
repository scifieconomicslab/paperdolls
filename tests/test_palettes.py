"""palettes.json v2: a region owns several looks, and every colour is valid."""
import json
from pathlib import Path

from paperdolls import checks
from paperdolls.render import palettes

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "assets" / "palettes.json").read_text(encoding="utf-8"))


def test_version_and_shape():
    assert DATA["version"] == 2 and DATA["status"] == "proposed_starting_values"
    assert len(DATA["families"]) == 12


def test_every_region_has_several_distinct_looks():
    seen = set()
    for f in DATA["families"]:
        assert len(f["looks"]) >= 3, f["id"]
        ids = [k["id"] for k in f["looks"]]
        assert len(set(ids)) == len(ids), f"{f['id']} repeats a look id"
        for k in f["looks"]:
            assert k["name"] and k["note"]
            sig = tuple(k["walls"])
            assert sig not in seen, f"{f['id']}/{k['id']} repeats another look's walls"
            seen.add(sig)


def test_schema_check_passes_on_the_shipped_file():
    ok, msg = checks.palette_schema(palettes.load_families())
    assert ok, msg


def test_schema_check_catches_a_bad_look():
    fams = json.loads(json.dumps(palettes.load_families()))
    fams["nw"]["looks"][0]["walls"][0] = "red"
    fams["nw"]["looks"][1]["canopies"] = ["#000000"]
    fams["nw"]["looks"][2]["surface"] = "lava"
    ok, msg = checks.palette_schema(fams)
    assert not ok and "walls[0]" in msg and "canopies" in msg and "surface" in msg


def test_legacy_keys_repeat_the_first_look():
    """Older code (the Python frame renderer) reads wall, wall2, roof, ground, accent, shadow from the family."""
    for f in DATA["families"]:
        k = f["looks"][0]
        assert (f["wall"], f["wall2"], f["roof"], f["ground"], f["accent"], f["shadow"]) == (k["walls"][0], k["walls"][1], k["roofs"][0], k["ground"], k["accents"][0], k["shadow"])


def test_surfaces_and_blooms_are_varied():
    looks = [k for f in DATA["families"] for k in f["looks"]]
    assert {k["surface"] for k in looks} == {"asphalt", "concrete", "cobble", "earth"}
    assert sum(1 for k in looks if k["bloom"]) >= 10
