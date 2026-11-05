# Changelog

## Unreleased

- **A smooth README video, drawn instead of screen-recorded.** The old screencast was choppy because a live browser drops frames while it builds sprites. `node viz/record_tour.js outdir` now renders a scripted 28-second camera tour (whole city, boulevard, close streets, plaza, and back) one frame at a time in node-canvas with every build budget off and each view drawn settled, so every frame is sharp and the rate is a steady 30 fps; ffmpeg encodes the PNGs. South Asian tropical region, Whitewash and clay tile look, detail and fog on, 1280 by 720, 9.5 MB. README shows `docs/images/tour.webp` (1024 px wide, 27 MB; GitHub does not play repo-relative `<video>` tags) and links the full-size mp4; the 4 MB `detail-demo.webp` is removed. Rendering takes about 6.5 minutes.

- **CI on Node 24, and tests that do not depend on the clock.** The workflow now uses `actions/checkout`, `setup-python` and `setup-node` v7 (all on the Node 24 runtime, which removes GitHub's Node 20 warning) and tests on Node 24. The viewer and replay-page tests waited fixed times (500 ms to load, 3 s per scene file, 400 ms key holds, 1.5 s of play), which fail on a slow runner: they now wait for the condition (the page answered, the view moved far enough, the week advanced, N frames drawn), with a 15 s ceiling. The asset tests no longer depend on wall-clock budgets either (`sim.opts.layerMs` and `prewarmMs` can be set, and the test helpers set them to unlimited). Checked by pinning the tests to one busy core: the old viewer tests failed ("playing moves the week: 3") and the new ones pass at the same load.

- **People no longer walk through or along buildings.** A person was drawn at a fixed offset from the road's centre line, whatever stood there: buildings that sit on the pavement (all of the placeholder's tram boulevard, and encroaching footprints in real scenes) had people walking through the walls. `createSim` now checks every pavement edge against the building footprints, per side and at three offsets, and people take the clearer side and offset, avoid an edge blocked on both sides while another way exists, and start only on walkable edges. Over 400 steps the share of positions inside a footprint fell from 2.8 to 0.2 percent on the placeholder and from 2.3 to 0.1 percent on the real Jette scene (the boulevard: 62 percent to none). `createSim` takes about 130 ms longer on 12,000 buildings. Four new asset tests (61 pass).

- **Zoom fixes from real use (blinking, judder, a stuck view).** The easing tail kept the viewer in "zoom" for about 0.8 s after each gesture (so people and vehicles stayed frozen and then jumped, and gestures less than 0.8 s apart never drew a real frame): a zoom is now a scale change of more than 0.15 percent a frame (`ZoomHold` `creep`) and the controls apply the last 0.3 percent at once. A pan during the refinement now moves the stretched picture (`ZoomHold.place`); the swap waits 40 ms for the CSS fade to finish; a frame that throws is skipped, reported once and the loop carries on; layer canvases are reused (a spare is kept) instead of allocated per repaint. Traced in Chrome with a stress script; a hard freeze was not reproduced. Tests added for each: 8 zoom-hold, 12 refocus, 28 camera, 57 asset tests, and the viewer test now throws inside a frame on purpose.

- **Zooms finish in focus.** New `viz/refocus.js`: while the zoom is stretching the drawn canvas, the sharp frame is drawn out of sight on a second canvas, and when it is whole (nothing left to build) or after 500 ms it fades in over 160 ms and the canvases swap, so the pop and the progressive sharpening are not seen. Optional dressing: a focus reticle (corner brackets that seek at the cursor and lock green on arrival) and a lens blur on the stretched picture (off by default). `LabControls` gains `smoothZoom` (a wheel zoom eases in over about 200 ms; notches add up; the cursor point stays fixed) and `setOption`; `ZoomHold` gains `ratio()`, `active()` and `rebind()`. The viewer has four switches: eased zoom, crossfade, focus reticle, focus blur; `prefers-reduced-motion` turns off the easing and the blur and makes the swap instant. In Chrome, 12 notches (a zoom to 14 times): slowest frame 33 ms, none over 34 ms. `window.labViewer.refocus` exposes the state machine. The jsdom viewer test now waits for the eased wheel zoom. 27 camera tests, 11 refocus tests, 8 zoom-hold tests.

- **The last zoom hitches.** The ground layer and the far-zoom layer are now painted a slice per frame (6 ms, `opts.layerMs`) into a second canvas while the old layer, scaled, stands in (within 0.15 to 8 times), then swapped in; a far layer that does not exist yet is painted that way while the buildings are drawn directly. Before, the end of a zoom repainted the ground in one go (35 to 50 ms in Chrome) and the far layer in one go (275 ms for 1,000 buildings) and then a second time when sprites went exact; the exact flag is no longer in the far layer's key. The stretch limit of `zoomhold.js` is 0.3 to 8 times (was 4). In Chrome, 12 wheel notches in: slowest frame 100 to 50 ms and slowest `renderFrame` call 95 to 28 ms; 6 notches out: 283 to 50 ms and 275 to 55 ms. A 12-notch zoom out (a flick past the 0.3 times the held picture may shrink) is not improved: 118 to 119 ms. `sim.opts.sliceLayers = false` paints in one go as before. A pan past the layer margin still paints in one go. Two asset tests added (56 pass).

- **Zooming is smooth in a real browser.** A zoom used to stall for 150 to 500 ms each time the sprite scale crossed a quarter-pixel bucket. A first fix (hold a copy of the last sharp frame and redraw it scaled) looked good in node-canvas and was worse in a real browser, where a wheel sends events a few frames apart: every gap re-rendered and every event copied the whole canvas again (median frame 50 ms, one 233 ms frame). It was removed. Now `zoomhold.js` stretches the already drawn canvas with a CSS transform while the scale is changing, which the compositor applies at no cost, and draws one real frame when the scale has been still for 120 ms (or the stretch passes 4 times). Real frames build sprites under an 8 ms-a-frame time budget (a build is 0.8 ms in Chrome, 0.35 in node), scale a held sprite when over budget, use whole-octave sprite sizes while moving, and a still view pre-renders the neighbouring zoom levels; cache eviction drops far scales instead of clearing. In Chrome, 6 wheel notches: median 17 ms, 1 to 7 frames over 34 ms, slowest 50 to 83 ms (was a 233 ms frame). A real frame at the end of the zoom is still the slowest (see viz/README.md). `viz/viewer.html` now wraps the canvas in `#stagebox`; `window.labViewer.sim` exposes the sim. New: `viz/zoomhold.js`, `viz/test_zoomhold.js`, `viz/zoom_bench.js`, and three asset tests (54 pass).
- **Replay through time, in the one engine.** `paperdolls replay` writes the viewer with a week scrubber, play button and speed control, playing an exported trajectory through a scene (`--scene`, or the placeholder). What is drawn is declared in `replay.mapping`: a model variable (`building.x`, or `owner.x` through the owning household) to a wall colour (sequential or categorical scale) or an overlay. The exporter records the variables (NaN where unset, drawn as "no data", never as zero) and the legend is generated from the scales, so it cannot describe a model that is not the one drawn. Model buildings are placed on the scene buildings nearest its centre, in a fixed order; the page says placement is invented, and a scene with fewer buildings than the model is refused with both numbers. `build` and `frames` (the older keyframe renderer) are unchanged. Co-op vans are drawn only for the vendored Great Retrofit model. The README's performance figures were re-measured (`node viz/scale_bench.js`): settled frames 4.6 to 17.5 ms on 12,276 buildings, and a 4.9 s first frame when opened fully zoomed out. The first live OpenStreetMap run (a bounding box in Jette, Brussels) worked: 2,162 buildings, 28% fit an asset. 116 Python tests, 50 asset tests and 11 replay tests pass.

- **Cheap defects from the audit.** `paperdolls doctor` no longer crashes with a traceback when numpy, pillow or pyyaml is missing; it prints the install command, as intended (the command-line module now imports the packages only when a command needs them). Replay frames no longer carry the retrofit legend for other models: the vendored model keeps its labels, any other model file gets "State 1" to "State 4", and `replay.legend` in `render.yaml` names the states. A GitHub Actions workflow runs the Python and JavaScript tests on Python 3.10 and 3.12 and fails if the built viewer pages are out of date. Three tests added (98 pass).

- **Ink hierarchy, pixel snap, palette and fog (all opt-in, colorfigures only).** `sim.opts.ink = true` draws the heavy outline only around each building or tree silhouette and hairlines inside, baked into the sprite. `sim.opts.pixel = 1.5` (any size above 1) renders at 1/1.5 resolution and upscales with nearest-neighbour, so each pixel is 1 or 2 screen pixels wide and the ink is one logical pixel wide; `sim.opts.pixelSmooth = true` smooths the upscale instead; detail drops its grain in this mode. `sim.opts.posterize = 12` rounds each colour channel to a multiple of 12, once per sprite and per cached layer, never per frame. `sim.opts.fog = true` blits a cached haze and vignette. The viewer has checkboxes for ink, pixel (which also sets posterize) and fog; they switch on a running sim. `node viz/detail_bench.js` times every variant. Settled and pan frames stay at 3 ms in node-canvas with all of them on; the first frame is slower (865 ms against 214 ms) because posterize reads each new sprite back once.

- **Opt-in detail pass, `sim.opts.detail = true`.** Aims at a richer, more hand-finished look without per-frame cost. Everything is baked when a sprite or cached layer is built, so settled and pan frames are blits as before. Buildings get a fine grain and a light bevel on roof edges, and a soft ambient-occlusion band along the foot of each wall (sprites, only from 2.5 px per metre up). Flat roofs get air-conditioning units, vents and a tank, and about a quarter of windows are darker glass. The cached ground gets a longer, fainter cast shadow and three stepped contact rings round each footprint. It is colorfigures only; the formal register is unchanged. `node viz/detail_bench.js` writes a picture of each and times them. On the placeholder scene in node-canvas the first frame went from 288 to 336 ms, and settled (3.9 ms) and pan (5.2 to 5.1 ms) frames did not change. Off by default, since it changes the look.

## 0.7.0 (renamed to paperdolls)

- **The project and the plugin are now called paperdolls.** It was lab-render. The command is `paperdolls`, the Python package is `paperdolls`, the commands are `/paperdolls:start`, `place`, `preview`, `build` and `doctor`, the skill is `paperdolls-visuals`, the default output folder is `paperdolls-out`, and the test environment variable is `PAPERDOLLS_NODE_MODULES`. The repository is `scifieconomicslab/paperdolls`.
- To update an install: `/plugin marketplace add scifieconomicslab/paperdolls`, then `/plugin install paperdolls@scifi-economics-lab`. Scripts that call `lab-render`, import `lab_render` or read `lab-render-out` need the new names.
- Entries below this one use the old names.

## 0.6.2 (panning and zooming)

- **World-anchored layer caches.** Profiling showed that still frames cost 10 to 13 ms while panning or zooming cost 46 to 157 ms, because the ground and far-zoom layers were keyed on the view offset and repainted every frame. They are now cached at 1.8 times the view and anchored to the world: a pan frame is one blit, a zoom draws the old layer scaled and repaints once when it stops, and a fractional pan is repainted exactly once it stops. On the 12,500-building scene (node-canvas) pan frames went from 46 to 157 ms down to 5 to 14 ms, and zoom frames from 55 ms down to 6 to 19 ms.
- Far zoom no longer collects every building each frame while its layer is valid, so a still frame at 0.7 px/m went from 11.6 to 4.9 ms.
- Tests: 50 JavaScript checks (two new: pan and zoom match a fresh render and settle exactly).

## 0.6.1 (occlusion culling)

- **Occlusion culling**, opt-in with `sim.opts.occlusion = true`. A front-to-back pass with a coverage grid skips items that nearer buildings fully cover. It draws the same picture pixel for pixel (tested on a 4 to 8 storey scene at two zooms). It is off by default: on the placeholder, a tall variant and a 12,500-building scene it added 13 to 34% to the frame time, because the test costs more than the blits it saves.
- `AssetLib.spritePlacement` returns where a cached sprite lands and a mask of what it covers.
- `viz/occlusion_bench.js` checks equality and times the culled and unculled renderer. `viz/occlusion_probe.js` still measures how much a scene hides.
- Tests: 48 JavaScript checks (one new).

## 0.6.0 (packaged as a plugin)

- **Licence**: the plugin is CC BY 4.0. The vendored Great Retrofit model is MIT and carries its own `LICENSE`.
- **Commands**: `/lab-render:start`, `place`, `preview`, `build` and `doctor`. They replace `new-place` and `ingest`, which referred to the old `sim.yaml` flow.
- **Skills**: `lab-render-visuals` rewritten around the intake, which writes `render.yaml`, and the two project kinds (model replay and place scene). It was `retrofit-sim-visuals`, and still described the commands the intake replaced. `palettes` updated.
- **Docs**: `docs/intake-questions.md` (generated from the question bank), `docs/model-interface.md` and `docs/known-issues.md`. The README is shorter and links to them.
- **Tests**: `tests/test_cli.py` runs the launcher end to end (doctor, looks, intake, place, viewer). `tests/test_plugin.py` checks the manifest, marketplace file, skills, commands and agents. 
- **Marketplace**: `.claude-plugin/marketplace.json` and `assets/icon.svg`.
- The `bin/lab-render` launcher is executable.
- Earlier entries below use the old names `retrofit-sim` for the command line and `retrofit-sim-visuals` for the skill.

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
