"""The constructed-region generator: determinism, the scene contract, neighbors, reshape."""
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))        # tools/
from construct import generate                                  # noqa: E402
from ingest.validate import validate_scene                      # noqa: E402


def test_default_spec_generates_a_valid_scene():
    scene = generate.generate(None)
    errors, warnings = validate_scene(scene)
    assert errors == [], errors
    assert scene["area"]["source"] == "constructed"
    assert scene["area"]["family"] == "real" and scene["area"]["palette"] == "nw"
    assert scene["buildings"], "expected buildings"
    assert len(scene["structures"]) == len(scene["buildings"])
    assert {s["kind"] for s in scene["structures"]} == {"building"}
    assert scene["roads"] and scene["landuse"] and scene["trees"]


def test_family_pack_and_non_building_structures():
    scene = generate.generate({
        "name": "High Pastoral Test", "extent_m": [220, 160], "seed": 11,
        "family": "fantasy", "palette": "high-pastoral",
        "structures": [
            {"kind": "wall", "footprint": [[20, 20], [80, 20], [80, 24], [20, 24]], "height": 4.0},
            {"kind": "ruin", "footprint": [[90, 90], [110, 90], [110, 110], [90, 110]], "height": 3.0},
            {"kind": "habitat", "footprint": [[130, 30], [160, 30], [160, 60], [130, 60]], "height": 6.0},
        ],
    })
    errors, warnings = validate_scene(scene)
    assert errors == [], errors
    assert scene["area"]["family"] == "fantasy"
    assert scene["area"]["palette"] == "high-pastoral"
    kinds = {s["kind"] for s in scene["structures"]}
    assert {"building", "wall", "ruin", "habitat"} <= kinds
    assert len(scene["structures"]) == len(scene["buildings"]) + 3


def test_blocks_clear_the_road_corridor_and_pavement():
    scene = generate.generate({"seed": 13, "extent_m": [320, 240]})
    roads = scene["roads"]
    for building in scene["buildings"]:
        for point in building["footprint"]:
            nearest = min(
                (_segment_distance(point, road["pts"][i - 1], road["pts"][i]), road["width"])
                for road in roads for i in range(1, len(road["pts"]))
            )
            distance, width = nearest
            assert distance >= width / 2 + generate.SIDEWALK_M - 0.05, (building["id"], point, nearest)


def _segment_distance(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    den = dx * dx + dy * dy
    t = 0 if den == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den))
    return math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t))


def test_family_and_palette_must_match():
    with pytest.raises(ValueError, match="belongs to the 'real' world family"):
        generate.generate({"family": "fantasy", "palette": "nw"})
    with pytest.raises(ValueError, match="unknown palette family"):
        generate.generate({"family": "fantasy", "palette": "not-authored"})


def test_determinism_identical_across_runs():
    a = generate.generate({"seed": 7, "extent_m": [220, 160]})
    b = generate.generate({"seed": 7, "extent_m": [220, 160]})
    assert a == b


def test_different_seeds_differ():
    a = generate.generate({"seed": 1, "extent_m": [220, 160]})
    b = generate.generate({"seed": 2, "extent_m": [220, 160]})
    assert [x["footprint"] for x in a["buildings"]] != [x["footprint"] for x in b["buildings"]]


def test_footprints_are_simple_enough_and_far_from_degenerate():
    scene = generate.generate({"seed": 3, "extent_m": [300, 240]})
    for b in scene["buildings"]:
        xs = [p[0] for p in b["footprint"]]
        ys = [p[1] for p in b["footprint"]]
        assert max(xs) - min(xs) >= 2 and max(ys) - min(ys) >= 2
        assert b["area"] >= 8.0 and b["levels"] >= 1 and b["height"] > 0


def test_neighbours_resolve():
    scene = generate.generate({"seed": 5, "extent_m": [260, 200]})
    ids = {b["id"] for b in scene["buildings"]}
    for b in scene["buildings"]:
        for n in b["neighbours"]:
            assert n in ids
    assert any(b["neighbours"] for b in scene["buildings"])


def test_economic_classes_are_documented():
    scene = generate.generate({"seed": 42, "extent_m": [640, 480]})
    from ingest.classify import ECONOMIC_CLASSES
    pool = {c for entries in generate.DISTRICTS.values() for c, _lo, _hi in entries}
    for entries in generate.DISTRICTS.values():
        for c, _lo, _hi in entries:
            assert c in ECONOMIC_CLASSES, c
    for b in scene["buildings"]:
        assert b["economic_class"] in ECONOMIC_CLASSES
        assert b["economic_class_source"] == "generated"
    assert pool


def test_spec_round_trip():
    d = {"name": "Test", "extent_m": [100, 80], "seed": 9, "pond": False, "square": False, "park_blocks": 0}
    scene = generate.generate(d)
    assert scene["area"]["name"] == "Test"
    assert not any(l["kind"] == "water" for l in scene["landuse"])
    assert scene["area"]["extent_m"] == [100.0, 80.0]
