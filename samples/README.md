# Samples

- `demo_replay.html`: a replay page from the v1 pipeline (Python frame renderer).
- `live_replay_demo.html`: the live replay page (`paperdolls replay`) playing a toy epidemic (`tests/toy_model.py`, not an economic model) through the placeholder area. Press Play or drag the week slider; "Colour walls by" switches between the state and a wealth ramp. Placement is invented, and people and vehicles are decoration. Rebuild it with a `render.yaml` that has `model.path` pointing at the toy model and a `replay.mapping` (see `docs/replay-mapping.md`).
- `osm_fixture_extract.json`, `osm_fixture_scene.json`, `osm_fixture_scene_report.md`: the OpenStreetMap ingest on a **synthetic**
  extract. The extract is made-up data with the shapes of real OSM data (a street grid rotated 37 degrees, relations with
  courtyards, trams alongside and apart from roads, junk to filter, a building outside the boundary). It is not a real place.

Try it: open `viz/viewer_built.html` and choose `samples/osm_fixture_scene.json` with the Scene control. Or rebuild it:

```
paperdolls ingest samples/osm_fixture_extract.json --out samples/osm_fixture_scene.json --boundary-relation 99001
```

The attribution shown with a real extract is "© OpenStreetMap contributors (ODbL)". The synthetic one carries the same line so the
viewer behaves identically; it contains no OpenStreetMap data.
