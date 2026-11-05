---
description: Build a scene from OpenStreetMap data for a place: fetch or take an extract, ingest it, read the report with the user.
---

Use the "A real place (OpenStreetMap)" steps in the lab-render-visuals skill.

1. Ask for the place: an OSM relation id or a bounding box.
2. Try `lab-render osm-fetch`. If it cannot reach the network, print the query with `lab-render osm-query` and ask the user to run it and upload the file. Never invent data.
3. Run `lab-render ingest` with `--boundary-relation` when there is one.
4. Summarise `scene_report.md`: counts, frame rotation, estimated asset share, storey sources, what was left out, warnings.
5. Show the assumptions table and wait for confirmation. Say that the ingest has never run on real data, and that the model's buildings are not yet linked to the scene.
