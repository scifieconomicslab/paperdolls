---
name: lab-render-visuals
description: Build a replay render of an agent-based economic simulation (v1: Great Retrofit model) for policy audiences. Use when the user wants to visualise a simulation on a place, choose a palette family or register, or turn a run into an isometric replay page. Covers intake questions, spec (sim.yaml) authoring, export, checks, frames and the replay page. Replay only in v1.
---

# Retrofit simulation visuals (v1, replay only)

This plugin records one run of a model and draws it. It does not run the economics in the browser, and it does not reimplement the model. The Python model is the single source of truth, and the picture is a function of exported state.

## Rules that do not change

1. **The model is the source of truth.** Read states from the export. Never compute economic quantities in the renderer.
2. **Say what is invented.** Layout, people, vehicles and palettes are illustrative until the user replaces them. Every output carries the note.
3. **Appearance encodes only what the model tracks.** Retrofit state, investor ownership and similar model fields may drive appearance. Race, ethnicity, religion or any inferred identity must not.
4. **Confirm before building.** Show a table of decisions and wait for a go-ahead before the full build.
5. **Cite current facts.** Registry shares, low-emission rules and transport facts are looked up for the chosen place and date, with source and date recorded. Do not fill gaps from memory.

## Workflow

### 1. Intake (ask in this order, one question at a time)

- What model is this? Point to the entry-point file and the parameter class. If the model is new, run the inventory first.
- What is the time step, and what should one week mean?
- Which quantities must be visible, and which belong only in a chart?
- Which palette family or families? Offer the twelve families in `assets/palettes.json`, and say they are proposals.
- Which register? Colorfigures for explainers, formal for print and planning documents. Both are the default.
- Which weeks to show as keyframes?
- Is there a real place to match? If so, a map extract is needed. v1 does not place buildings by geography.

Use fixed-choice questions where the answer is a short list. Ask open questions in prose.

### 2. Spec

Write `sim.yaml` (see `assets/demo_render.yaml`). It holds the model parameters, the replay weeks, the palettes and the registers. Validate it:

```
python -m lab_render validate sim.yaml
```

### 3. Export and check

```
python -m lab_render export sim.yaml --out trajectory.npz
python -m lab_render check sim.yaml
```

Read every check line. Stop on any FAIL. WARN lines are reported to the user, not hidden. The known WARN in the Great Retrofit model is that its weekly counts do not always reconcile with the building count. The render uses per-building state, so it is unaffected, but the authors should hear about it.

### 4. Frames and page

```
python -m lab_render frames sim.yaml trajectory.npz --out frames/
python -m lab_render build sim.yaml trajectory.npz --out replay.html
```

### 5. Review

Open a frame, check it against the table of decisions, and ask the user for feedback. Iterate on the spec, not on the renderer, wherever possible. When the user approves, deliver the page.

## A real place (OpenStreetMap)

When the replay should sit on a real place, build the scene with the ingest. It has never run on real data, so say so, and read the report with the user.

1. **The place.** An OSM relation id (Jette is 58258) or a bounding box (south, west, north, east). Ask which. Prefer a boundary relation: it clips cleanly.
2. **The data.** Run `lab-render osm-fetch --relation ID --out extract.json`. If that cannot reach the network (a sandbox usually cannot), run `lab-render osm-query --relation ID --out q.ql` and ask the user to run it at overpass-turbo.eu (Export, raw OSM data, JSON) or with curl, then upload the file. Do not pretend to have fetched data.
3. **Ingest.** `lab-render ingest extract.json --boundary-relation ID --out scene.json`. Read `scene_report.md` aloud in summary: how many buildings were drawn, the frame rotation and the estimated asset share, the storey sources, what was left out, the warnings.
4. **Confirm the assumptions.** Show the assumptions table and wait for a yes: storeys assumed from a building type, archetypes assigned from tags (and the `auto` ones the region will decide), road widths from lane counts, trees scattered into parks. Where most storeys are defaults (low `tag` share), say heights are mostly assumed.
5. **Check the fit.** Load the scene in `viz/viewer_built.html`. If the share of generic extrusions is high (many street grids, curved streets), tell the user plainly; do not hide it.
6. **Not inferred.** Drive side, retrofit states and owners. The model's buildings are not yet connected to the scene's buildings (the spatial layer is still to be built): say so before promising a replay on the map.

Licence: OpenStreetMap data is ODbL. Carry "© OpenStreetMap contributors" with any picture, and check the share-alike terms before publishing a scene file, which is a derived database. This is not legal advice.

## People and vehicles (assets)

The libraries in `viz/` (`assetlib.js`, `buildinglib.js`) draw people as paper dolls, vehicles as parametric solids and buildings from archetypes, all pre-built for four isometric headings, each with a recolourable **data surface** (garment, body or livery, walls). See `viz/README.md`. When a replay uses the scene renderer, also ask:

1. **Region, then look.** Which region fits the place? Offer the twelve, and say they are proposals. The region fixes fleet, climate, building grammar, trees and drive side, so it is the only place choice (there is no separate palette choice). Then offer that region's three looks (named by materials and light) and say they were authored by eye. Use the `fleet-researcher` agent to propose a fleet with sources, and confirm it before editing `AssetLib.REGIONS`.
2. **Drive side.** Which side does traffic drive on? The region default is a guess. It is `ask` for Southeast Asia, East Asia and Sub-Saharan Africa, where countries differ. Never assume.
3. **Data surfaces.** Which model output should colour the data surface of people, of vehicles, and of buildings? Which scale: categorical (states) or sequential (a number)? Show the legend and wait for a yes.
4. **Motion.** Is the motion decorative, or does a class need real motion (buses on a timetable, trams on a schedule, people from model output)? Decorative motion must be labelled as decoration in the output.
5. **Scale.** People and vehicles are drawn at 1.2x life size. Ask before changing it.
6. **Buildings.** Which archetype should each building type map to (the OSM tag mapping is not built, so ask), and what are the storey counts where the data has none? Show the assumed defaults as a table and wait for a yes.
7. **Footprint fit.** Report `sim.stats` (how many buildings use assets, how many fall back to a generic extrusion, and why). On real data the fallback share may be large. Tell the user, and do not hide it.
8. **Register.** colorfigures (the region's own colours) or formal (a Carbon-based technical drawing, colour reserved for data)? Say that formal's cool-gray and warm-gray tokens are still to be checked.
9. **Trees and ground.** Confirm the species mix for the region and the road surface of the look (asphalt, concrete, setts, earth), and say they are proposals.
10. **Retrofit mapping.** The default maps state to wall colour and overlay (queued: band, in retrofit: scaffold, finished: solar, investor-owned: roof marker). Confirm it, or replace it with `sim.buildingStyle`. Say which model field drives each overlay.

Rules: buildings must not be silently approximated: a footprint that does not fit an asset is drawn as a generic extrusion and counted. People are paper dolls with one neutral paper tone and **no skin tones**. Regional variation in clothing follows climate and the local fleet, never identity. Colours come from the family palette. Every regional detail is a proposal until local authors have checked it.

## What v1 does not do

- No live parameter changes. Each run is exported ahead of time.
- The model's buildings are not connected to real footprints yet. The v1 pipeline places them on a generated grid in id order; the OSM ingest builds the real scene, but linking model buildings to it is the spatial layer, still to be built.
- No vehicle or people simulation unless a class is given motion with `setMotion`. By default vehicles and people are placed by rule and are decoration.
- No Pyodide, no worker, no browser-side economics.

## Known issues

See `CHANGELOG.md` and the audit notes in `README.md`.
