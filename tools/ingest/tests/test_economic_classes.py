"""The economic-class cascade: reference/building-archetypes.md §1/§3.

Step order: tag -> use-tag -> building:use -> landuse -> seeded fallback.
building=yes (the ~79%) must land in the fallback, flagged. construction is
a kept, first-class class. lifecycle keys fold to ruins.
"""
import collections
import random

import pytest

import osm_fixture as F
from ingest import build, classify, report

REL = 99001


@pytest.fixture(scope="module")
def files(tmp_path_factory):
    return F.write_all(tmp_path_factory.mktemp("osm"))


@pytest.fixture(scope="module")
def result(files):
    return build.ingest(files["overpass-json"], boundary_relation=REL)

# ---- samples that must resolve at each cascade step ----
BY_TAG = {
    "apartments": "apartments", "house": "house", "detached": "detached", "terrace": "terrace",
    "hut": "hut", "static_caravan": "static_caravan", "cabin": "cabin", "allotment_house": "allotment_house",
    "industrial": "industrial", "manufacture": "manufacture", "factory": "factory", "farm": "farm",
    "farm_auxiliary": "farm_auxiliary", "barn": "barn", "greenhouse": "greenhouse", "silo": "silo",
    "stable": "stable", "cowshed": "cowshed",
    "retail": "retail", "warehouse": "warehouse", "kiosk": "kiosk", "supermarket": "supermarket",
    "office": "office", "garage": "garage", "commercial;residential": "mixed_use",
    "school": "school", "kindergarten": "kindergarten", "university": "university",
    "hospital": "hospital", "clinic": "clinic", "government": "government",
    "fire_station": "fire_station", "civic": "civic",
    "storage_tank": "storage_tank", "digester": "digester", "transformer_tower": "transformer_tower", "service": "service",
    "construction": "construction", "ruins": "ruins", "abandoned": "ruins", "collapsed": "ruins", "damaged": "ruins",
}
BY_USE = [
    ("supermarket", "supermarket", "shop"), ("bakery", "retail", "shop"), ("yes", "retail", "shop"), ("kiosk", "kiosk", "shop"),
    ("restaurant", "retail", "amenity"), ("school", "school", "amenity"), ("hospital", "hospital", "amenity"),
    ("doctors", "clinic", "amenity"), ("fire_station", "fire_station", "amenity"), ("townhall", "government", "amenity"),
    ("place_of_worship", "civic", "amenity"),
    ("substation", "transformer_tower", "power"), ("generator", "service", "power"),
    ("healthcare-hospital", "hospital", "healthcare"), ("silo", "silo", "man_made"),
]


@pytest.mark.parametrize("tag, cls", sorted(BY_TAG.items()))
def test_step1_building_tag(tag, cls):
    assert classify.economic_class({"building": tag}) == (cls, "tag")


@pytest.mark.parametrize("value, cls, key", BY_USE)
def test_step2_use_tag(value, cls, key):
    tags = {"building": "yes", key: ("hospital" if value == "healthcare-hospital" else value)}
    got, src = classify.economic_class(tags)
    assert got == cls, (value, key, got)
    assert src == "use-tag"


def test_step3_building_use():
    assert classify.economic_class({"building": "yes", "building:use": "apartments"}) == ("apartments", "building:use")
    assert classify.economic_class({"building": "yes", "building:use": "yes"}) == ("residential", "building:use")
    assert classify.economic_class({"building": "yes", "building:use": "office"}) == ("office", "building:use")


def test_step4_landuse():
    assert classify.economic_class({"building": "yes", "landuse": "farmyard"}) == ("farm", "landuse")
    assert classify.economic_class({"building": "yes", "landuse": "industrial"}) == ("industrial", "landuse")
    assert classify.economic_class({"building": "yes", "landuse": "commercial"}) == ("retail", "landuse")
    assert classify.economic_class({"building": "yes", "landuse": "residential"}) == ("residential", "landuse")


def test_seed_fallback_is_seeded():
    mix = classify.resolve_fallback_mix(collections.Counter({"apartments": 6, "retail": 3, "house": 1}))
    (classes, _weights) = mix
    assert set(classes) == {"apartments", "retail", "house"}
    draws = [classify.fallback_class(random.Random("seed:" + fid), mix) for fid in ("w1", "w2", "w3", "w4")]
    assert draws == [classify.fallback_class(random.Random("seed:" + fid), mix) for fid in ("w1", "w2", "w3", "w4")]


def test_every_building_gets_a_class(result):
    scene, rep = result
    classes = rep["economic_classes"]
    assert sum(classes.values()) == rep["counts"]["buildings"]
    assert set(classes) <= set(classify.ECONOMIC_CLASSES)
    sources = rep["economic_class_sources"]
    assert set(sources) <= set(classify.ECONOMIC_CLASS_SOURCES)
    assert 0 <= rep["economic_class_fallback_share"] <= 1


def test_fallback_share_is_reported_for_building_yes(result):
    scene, rep = result
    yes_yes = [b for b in scene["buildings"] if b["osm"]["building"] == "yes"]
    if yes_yes:  # the fixture has bare building=yes buildings
        assert all(b["economic_class_source"] == "fallback" or b["economic_class"] != "other" for b in yes_yes)
        assert rep["economic_class_fallback_share"] > 0
        assert "fallback" in " ".join(c + ":" + r for c, r, n in rep["assumptions"] if c == "economic class")


def test_report_has_economic_class_table(result):
    scene, rep = result
    md = report.report_markdown(scene, rep)
    assert "### Economic classes" in md and "How each class was reached" in md


def test_fallback_mix_respects_weights():
    mix = classify.resolve_fallback_mix(collections.Counter({"apartments": 1}))
    assert mix == (["apartments"], [1.0])
    assert classify.fallback_class(random.Random("x"), mix) == "apartments"


def test_empty_mix():
    assert classify.resolve_fallback_mix(collections.Counter()) is None