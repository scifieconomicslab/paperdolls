---
description: Build the scene for a place from OpenStreetMap and read the report with the user.
---

Use the "Place scene" section of the lab-render-visuals skill. The project must be a place scene with a confirmed `render.yaml`.

1. Run `lab-render place render.yaml`.
2. If it stops because the network is blocked, tell the user what to run by hand, then run it again once the extract is in the output folder. Never invent data.
3. Summarise `scene_report.md`: counts, frame rotation, estimated asset share, storey sources, what was left out, warnings.
4. Show the assumptions and wait for a yes. Say that the ingest has not been run on real data, and that the model's buildings are not linked to the scene.
5. After the yes, run `lab-render viewer render.yaml` and point the user to the HTML file it writes.
