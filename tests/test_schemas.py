"""The scene and binding schemas must accept the tool's own output and reject
the obvious wrong shapes. These tests are the enforcement the pipeline was
missing: the schemas existed but nothing loaded them.
"""
import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

ROOT = Path(__file__).resolve().parents[1]
SCENE = json.loads((ROOT / "schemas" / "scene.json").read_text())
BINDING = json.loads((ROOT / "schemas" / "model-binding.json").read_text())


def valid(schema, document):
    return not list(Draft7Validator(schema).iter_errors(document))


def errors(schema, document):
    return [e.message for e in Draft7Validator(schema).iter_errors(document)]


def test_both_schemas_are_valid_draft7():
    Draft7Validator.check_schema(SCENE)
    Draft7Validator.check_schema(BINDING)


def all_worlds():
    worlds = ROOT / "worlds"
    return sorted(p for p in worlds.iterdir() if p.is_dir())


@pytest.mark.parametrize("world", all_worlds(), ids=lambda p: p.name)
def test_shipped_scenes_validate(world):
    scene = world / "map-data" / "scene.json"
    if not scene.exists():
        pytest.skip("no scene")
    assert valid(SCENE, json.loads(scene.read_text()))


@pytest.mark.parametrize("world", all_worlds(), ids=lambda p: p.name)
def test_shipped_bindings_validate(world):
    binding = world / "sim-code" / "model-binding.json"
    if not binding.exists():
        pytest.skip("no binding")
    assert valid(BINDING, json.loads(binding.read_text()))


def minimal_scene(**overrides):
    scene = {
        "area": {
            "name": "test", "source": "constructed", "osm_relation": None,
            "attribution": None, "origin": None, "rotation_deg": 0,
            "north_on_screen_deg": 0, "extent_m": [10, 10],
            "generated": "2026-11-10", "ingest_version": "test",
            "family": "fantasy", "palette": "high-pastoral",
        },
        "roads": [], "landuse": [], "trees": [],
    }
    scene.update(overrides)
    return scene


def test_scene_requires_a_structure_or_building_array():
    assert not valid(SCENE, minimal_scene())
    assert valid(SCENE, minimal_scene(structures=[]))
    assert valid(SCENE, minimal_scene(buildings=[]))


def test_non_building_structures_need_only_kind_and_footprint():
    scene = minimal_scene(structures=[
        {"id": "wall-1", "kind": "wall", "footprint": [[0, 0], [2, 0], [2, 1], [0, 1]]},
        {"id": "ruin-1", "kind": "ruin", "footprint": [[3, 3], [4, 3], [4, 4]]},
    ])
    assert valid(SCENE, scene)


def test_building_structures_accept_but_do_not_require_extra_fields():
    base = {"id": "b1", "kind": "building", "footprint": [[0, 0], [2, 0], [2, 2], [0, 2]]}
    assert valid(SCENE, minimal_scene(structures=[base]))
    assert valid(SCENE, minimal_scene(structures=[{
        **base, "levels": 3, "archetype": "block",
        "economic_class": "apartments", "economic_class_source": "tag",
    }]))
    # the vocabulary is open: an unknown kind and a roles map are valid
    assert valid(SCENE, minimal_scene(structures=[{
        "id": "x1", "kind": "arcology",
        "footprint": [[0, 0], [3, 0], [3, 3], [0, 3]],
        "roles": {"wall": "stone", "roof": "solar"},
    }]))


def test_landuse_raster_source_is_accepted():
    scene = minimal_scene(buildings=[{
        "id": "b1", "footprint": [[0, 0], [2, 0], [2, 2], [0, 2]],
        "levels": 2, "archetype": "block", "economic_class": "apartments",
        "economic_class_source": "landuse-raster",
    }])
    assert valid(SCENE, scene)


def test_tree_tuple_kinds_and_limits():
    assert valid(SCENE, minimal_scene(structures=[], trees=[[1, 2]]))
    assert valid(SCENE, minimal_scene(structures=[], trees=[[1, 2, "palm", 1.2]]))
    assert valid(SCENE, minimal_scene(structures=[], trees=[[1, 2, None, None, 4.0]]))
    # the vocabulary is open: an unknown kind is accepted and reported by the renderer
    assert valid(SCENE, minimal_scene(structures=[], trees=[[1, 2, "not-a-kind", 1.0]]))
    # the tuple length is still capped at five
    assert not valid(SCENE, minimal_scene(structures=[], trees=[[1, 2, "palm", 1.0, 4.0, "extra"]]))


def minimal_binding(**overrides):
    binding = {
        "family": "real", "region": "nw", "look": "colorfigures",
        "dashboard": {"outputs": ["mean"]},
        "bindings": [{
            "entity": "building", "layer": "buildings",
            "match": {"anchor_index_lt": 30},
            "top_color": {"field": "score", "domain": [0, 100],
                          "reverse": False, "label": "Score", "unit": "points"},
        }],
    }
    binding.update(overrides)
    return binding


def test_binding_requires_the_gate5_fields_and_rejects_empty():
    assert not valid(BINDING, {})
    assert valid(BINDING, minimal_binding())


def test_only_the_three_looks_are_accepted():
    assert not valid(BINDING, minimal_binding(look="pixel"))
    assert not valid(BINDING, minimal_binding(look="brick"))
    for look in ("colorfigures", "formal", "voxel"):
        assert valid(BINDING, minimal_binding(look=look))


def test_generic_treatment_and_preset_are_accepted():
    assert valid(BINDING, minimal_binding(architecture=[{
        "entity": "structure", "field": "approved", "treatment": "mark",
        "preset": "band", "scale": {"type": "categorical"},
        "label": "Approved",
    }]))


def test_causal_graph_and_scenarios_are_declared():
    graph = {"confirmed": True, "source": "llm+user",
             "nodes": ["a", "b"], "edges": [["a", "b"]]}
    scenarios = [{"id": "base", "label": "Base", "interventions": []}]
    assert valid(BINDING, minimal_binding(causal_graph=graph, scenarios=scenarios))
    assert not valid(BINDING, minimal_binding(causal_graph={"confirmed": True}))


def test_unknown_binding_keys_are_allowed():
    # the vocabulary is open: a world may carry extra decisions
    assert valid(BINDING, minimal_binding(unknown=True))
