"""The Overpass query must ask for every category the classifier handles.

The 2026-11-09 spec revision added natural/leisure classes; the classify rows
for golf_course, wetland, sand, bare_rock and beach are only reachable if the
query fetches them.
"""
import pytest

from ingest.query import LEISURE, NATURAL, QUERY_VERSION, overpass_query


def test_query_version_is_current():
    assert QUERY_VERSION >= 2


def test_query_fetches_the_spec_natural_and_leisure_categories():
    query = overpass_query(bbox=(50.80, 4.30, 50.92, 4.45))
    for category in ("golf_course", "wetland", "sand", "bare_rock", "beach"):
        assert category in query, category
    # The constants and the emitted query must agree.
    for category in ("golf_course", "wetland", "sand", "bare_rock", "beach"):
        assert category in LEISURE or category in NATURAL


def test_relation_query_carries_the_boundary_and_the_categories():
    query = overpass_query(relation=58258)
    assert "rel(58258)" in query
    assert "map_to_area" in query
    for category in ("golf_course", "wetland", "sand", "bare_rock", "beach"):
        assert category in query


def test_bbox_validation_still_rejects_bad_input():
    with pytest.raises(ValueError):
        overpass_query(bbox=(1, 2, 3))
    with pytest.raises(ValueError):
        overpass_query()
