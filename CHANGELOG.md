# Changelog

## 0.5.1 (rendering cost)

- **Sprites at the exact scale** once the view has held still: a 1:1 blit on whole device pixels, 2 to 3 times faster than the resample the quarter-pixel buckets forced, and sharper (hairlines, window frames). Rebuilds are budgeted at 150 per frame so settling never stalls. Street-zoom frames on the placeholder: 57 ms to 24 ms; at 3.1 px/m: 46 ms to 16 ms.
- **`viz/occlusion_probe.js`**: measures how much of a scene is fully hidden and the best any occlusion culling could save. Measured on the placeholder and a worst case: fully hidden items are 10% (up to 19%), the upper bound on saving is 1 to 10%. Not worth building; the decision rule for revisiting it is in `viz/README.md`.
- Tests: 47 JavaScript checks (3 new: 1:1 blit is pixel-identical to the sprite, settle detection, budgeted sharpening).

## 0.5.0 (OpenStreetMap ingest)

- **`retrofit-sim ingest`**: an OSM extract (Overpass JSON, OSM XML or GeoJSON) becomes a scene file plus a report of every assumption. Reads buildings (storeys from tags, heights or visible type defaults; archetype from tags), roads (class, lanes, width, cycle lanes; tunnels, footways and driveways dropped), tram lines (matched to the road they run along, or kept as a track), landuse, trees (species, tree rows, scattering into parks and woods), multipolygon relations and an administrative boundary to clip to.
- **Frame rotation from evidence**: the dominant street direction is estimated and the frame rotated so most buildings sit on the isometric axes; every candidate and its estimated asset share is reported. On the synthetic extract the share of buildings using assets went from 0% to 97%, confirmed in the real renderer.
- **`retrofit-sim osm-query`** prints the Overpass query for a relation or a box; **`osm-fetch`** runs it. Neither has been run against the live service.
- **Scene schema**: per-road `width`, `pavement`, `cycle`, `tram`; road classes `pedestrian` and `tramway`; tree `[x, y, kind, scale]`; building `osm`; an `area` block with attribution, origin, rotation and north bearing. `VizLib.validateScene`.
- **Viewer**: load a scene file, drag to pan, wheel to zoom, OpenStreetMap attribution, clear errors for bad files.
- **Performance** for real-sized scenes: spatial road index, cached ground and shadow layer, cached far-zoom layer, agent level of detail, sprite colour keys. A 12,500-building scene now renders at about 30 to 40 ms per frame. A profile found the sprite cache thrashing because every building had a unique tone; tones now come in five steps.
- A correct isometric view-fit (the old one used the wrong extent for non-square areas).
- Tests: 48 for the ingest (formats, rotation at four grid angles, every classification rule, clipping, trees, report, CLI, fetch against a stand-in server, the real renderer, a 12,500-building timing), a headless viewer test. 108 in all, with the JavaScript suite run from pytest.

## 0.4.0 (themes, formal register, trees)

- **One theme system.** A region (fleet, trees, building grammar, drive side) owns several **looks** (colour schemes named by materials and light). `AssetLib.theme(family, look, register)` resolves every colour; `VizLib.setTheme` swaps it on a running sim without respawning agents. The separate palette picker is gone.
- **palettes.json v2**: 36 looks (three per region), each with four walls, two roofs, three accents, ground, road, pavement, grass, three foliage colours, optional bloom, water, shadow and a road surface (asphalt, concrete, cobble, earth). The old per-family keys repeat the first look.
- **Formal register redesigned** on IBM Carbon tokens: flat fills, 0.75 px hairlines, Gray 10 background, a faint ground grid, white pavements; walls and roofs snapped in CIELAB to Carbon's neutral grays (warm or cool following the region); vehicles and people neutral; muted greens from Green 60; colour reserved for data (IBM data-visualisation colours for the retrofit states, IBM Blue 60 for co-op vans). Some tokens are from memory and flagged for checking.
- **Trees** (`viz/treelib.js`): nine kinds of low-poly foliage as an asset group with a data surface, regional species mixes, foliage and bloom from the look, flowering trees only when the look has a bloom colour. Street trees, gardens and a square ring in the placeholder scene.
- **Ground**: base plane, gardens, kerbs, and road surfaces from the look (asphalt, concrete joints, setts, earth tracks).
- The scene's duplicate colour registers were removed: everything reads `AssetLib.REG` and the theme.
- Catalogue and Jette mock rebuilt around Region, Look and Register, with scene previews of every look, formal beside colorfigures, and a trees section.
- Python: `palette_schema` now checks every look; six new palette tests. Fixed a regression where an edit dropped `completions_bounded` from `checks.py`.
- Tests: 44 JavaScript checks (13 new) plus SVG validity and 6 palette tests, run from pytest (20 in all).

## 0.3.0 (buildings in the asset system)

- New `viz/buildinglib.js`: six building archetypes (terraced house, shophouse, block, detached house, tower, shed), pre-built for four headings with only the camera-facing faces, walls as the data surface.
- Rule-based facade grammar (one door per house, a door per shop, no run of three blank bays, stacked balconies, ribbon glazing on towers), flat, gable, hip and low-pitch roofs, chimneys.
- Overlays as geometry: scaffold, solar, band, marker. `VizLib.retrofitStyle` is the default Great Retrofit mapping; override with `sim.buildingStyle` or `bindData(sim, 'buildings', ...)`.
- Regional building grammar for each of the twelve families (proposals): archetype mix, roofs, shutters, awnings, balconies, air conditioning, window proportion.
- `AssetLib.fitFootprint`: near-rectangular footprints within 12 degrees of an axis take an asset, facing the nearest road; the rest fall back to a generic extrusion and are counted (`sim.stats`).
- Core engine: prisms extruded along x (gable roofs), free faces, a `needs` rule so balconies, awnings and scaffold on a hidden wall are not painted through the building, a generic asset-group registry, a pixel-budgeted sprite cache, adaptive ink width when zoomed out.
- Catalogue: buildings at every heading, overlays and data surface, regional grammar, footprint-fitting diagram. Jette mock: buildings from assets, towers, sheds and rotated buildings that show the fallback, a stats line.
- Tests: 31 JavaScript checks (13 new for buildings) plus SVG validity, run from pytest.

## 0.2.0 (people and vehicles library)

- New `viz/assetlib.js`: 19 vehicle classes and 9 paper-doll kinds, each pre-built for four isometric headings with only the camera-facing faces (left, right, top). Output as SVG (with `data-face`, `data-role`, `data-surface`) or cached canvas sprites.
- Paper dolls replace the walking figures: flat cut-outs, no walking animation, one neutral paper tone, no skin tones, drawn at 1.2x. Vehicles also 1.2x to keep proportions.
- A recolourable **data surface** on every asset, with `scales` (categorical, sequential, retrofit states) and `VizLib.bindData`.
- **Regions**: fleet, climate and drive side for each of the twelve palette families (proposals). Outfits follow climate, not identity.
- **Motion classes**: every class declares its network, and `VizLib.setMotion` assigns static, path or driven motion to a class. Default motion stays decorative.
- Left- and right-hand traffic.
- Sprite cache, viewport culling: a neighbourhood frame drops from about 100 ms to about 50 ms in node-canvas.
- `viz/library_catalogue_built.html`: every asset at every heading, regional fleets, data-surface demo. `viz/mock_jette_built.html` now uses the library.
- Tests: 18 JavaScript checks plus an SVG validity test, run from pytest.

## 0.1.0 (v1, replay only)

- Vendored Great Retrofit v2 model with a read-only `on_week` hook. Results are unchanged when the hook is unused, and a check confirms this.
- Exporter stores per-building retrofit state and a separate investor-ownership flag, each week.
- Rule-based facade textures (offline), tram, square, boulevard, vehicles and paper figures.
- Replay pages: keyframes for chosen weeks, palettes and registers, embedded in one offline HTML file.
- Checks: determinism, hook invariance, one state per building, model-aggregate reconciliation (WARN), completions bound, palette schema.
- Tests: 12 passing.

Known limits are listed in README.md under "Audit".
