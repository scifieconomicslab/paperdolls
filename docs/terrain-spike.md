# Terrain spike (P7): real heights, relief shading, or neither

Jette has relief (the Molenbeek valley and the rise toward the Basilica, roughly 30 to 40 m over 1 to 2 km), and the renderer put everything at `z = 0`. This is the spike the plan asked for before choosing between real vertical offsets and relief shading only. It records what was built, what it cost, what it looks like, and where it breaks.

**Decision: (a), real vertical offset with the depth-sort fix, drawn over a terrain surface with relief shading. Relief shading alone (b) stays available as `relief: 0`; (c) is rejected.** The reasons are in "Decision". The honest summary of the pictures is: at true scale Jette's hills are a gentle tilt, not a spectacle. They read mainly through the roads rising across a long view and the ground shading, and a vertical exaggeration of 2 to 3 makes them legible without visible artefacts. Real slopes in Jette are small enough that nothing looks broken; on slopes three to six times steeper than Jette's, things do.

Everything below was run on **synthetic terrain** (`viz/terrainlib.js`), shaped and sized like Jette's relief but not measured. No elevation data was downloaded and the readers were not tried on a real DTM. Timings are node-canvas (cairo), not a browser.

## What the prototype changed

The cheapest change that gives a correct picture, all in `viz/vizlib.js` (about 150 lines) plus small edits in `camera.js`, `packpick.js`:

- Scene: optional `z` (metres) on a building, per road point, and as a fifth tree element; optional `terrain` grid `{ x0, y0, dx, dy, nx, ny, z }`. An explicit `z` wins over the grid, no `z` means 0. Schema and checks are in `validateScene`; `viz/README.md` documents them.
- `createSim` reads the heights once (scaled by `opts.relief`) into `e.z` / `tree.z`; `proj` already took a `z`, so every draw site passes it: sprite anchors, the extruded fallback (the whole drawing is translated), trees, agents (on a road's own heights, or the grid), the fountain, the building shadows in the cached ground layer, and the occlusion test.
- Paint order: the old key `fit.cx + fit.cy` becomes `cx + cy + z`. Reason: the projection `sy = ... - z·k` makes a point `z` up land where the ground point `(x - z, y - z)` does, so the direction that collapses to one pixel is `(1, 1, 1)` and depth along it is `x + y + z`.
- Ground: the grid is drawn as a surface (cells painted far to near, true heights), roads are drawn as quads whose height runs along the centre line (from the road's own `z`, else the grid), landuse takes the grid height at each vertex. A grey relief image (lighter on slopes facing the sun, where the building shadows say the sun is) is laid over the finished ground with `soft-light`, so roads and parks are shaded too.
- Culling: the cull tests use the lifted screen position, so no bound has to be widened by hand; the cached world layers are anchored in screen space and already contain what is drawn. The camera gets `zmax` (`cam.setRelief`, `LabCamera.create({ zmax })`) so the fit leaves room above the map and `fitAll` aims half the relief up the screen; `VizLib.sceneRelief(scene)` supplies it. `viewer.html` and `packhost.html` pass it (one token each).
- Picking: `Pick` shifts the pixel's ground point by the building's `z` before the footprint-lifted-by-height test and widens the grid cells it indexes by `z`; ties use the renderer's key. `silhouette(i)` also returns `z` (the pack shell's selection outline in `packhost.js` uses it).

## Measurements

12,276 buildings (the placeholder tiled 12 times, `scale_bench.js`'s scene), synthetic terrain with 38 m of relief on a 25 m grid, 1200 by 700 canvas, node-canvas. `node viz/terrain_bench.js` reproduces the table. Modes: **flat** is the scene with no heights; **shade** is the grid with `relief: 0` (shading, nothing lifted); **offset** is `relief: 1`; **x3** is `relief: 3`.

| mode | px/m | ground layer, one whole paint | first frame | settled frame | pan frame | distinct sprites |
|---|---|---|---|---|---|---|
| flat | 0.5 | 66 ms | 3560 ms | 167 ms | 155 ms | 11,873 |
| shade | 0.5 | 342 ms | 3406 ms | 162 ms | 156 ms | 11,873 |
| offset | 0.5 | 255 ms | 2755 ms | 171 ms | 162 ms | 11,897 |
| x3 | 0.5 | 254 ms | 3557 ms | 167 ms | 160 ms | 11,927 |
| flat | 3 | 29 ms | 196 ms | 18.5 ms | 14.0 ms | 434 |
| shade | 3 | 365 ms | 490 ms | 18.1 ms | 13.9 ms | 434 |
| offset | 3 | 472 ms | 495 ms | 16.7 ms | 13.5 ms | 418 |
| x3 | 3 | 481 ms | 493 ms | 17.4 ms | 14.1 ms | 392 |

- **Per-frame cost: none measurable.** Settled and pan frames with terrain are within noise of flat at both zooms. The extra work is a `+ z` in the projections and one extra addition in the sort key.
- **Ground layer: 4 to 17 times dearer to repaint, and that is the real cost.** The first version took 1.3 to 1.9 s because it called the grid sampler eight times per cell, stroked every cell, and cut cells to 12 px. Reusing corner heights between neighbours, overlapping cells by 0.8 px instead of stroking them, and using cells of about 18 px brought it to 0.25 to 0.5 s (about 30 ms of that is the `soft-light` composite on a 1680 by 980 layer). The layer is painted in slices of 6 ms when the zoom settles (the old one stays on screen, scaled), but a pan past the layer's margin paints it at once, so a 0.3 to 0.5 s pause is possible in node-canvas and probably less in a browser. Not measured in a browser. If it matters: draw the grid at a coarser stride at far zoom, or cache the relief image per scale.
- **Sprite cache: unchanged.** The key has no height. The counts differ by under 0.5% at 0.5 px/m (a different set of buildings is on screen after the lift). At 3 px/m the visible set shrinks (434 to 392) because the lift moves part of the scene off screen.
- **Scene size** (Jette, 9,214 buildings, measured with the synthetic terrain): `z` on buildings, road points and trees adds 234 KB to the 4.53 MB scene file (5%; the unrounded JSON is longer than needed), and the 25 m grid over 3.3 by 3.4 km (134 by 142 cells) adds 86 KB.
- The settled frame of 165 ms at 0.5 px/m is the same with and without terrain; it is the existing far-zoom behaviour on 12,000 buildings (known issue 19), not something terrain changed.
- The flat picture is unchanged. The regression test (`viz/test_terrain.js`) compares the placeholder scene at two zooms against a golden made by the renderer from before this change; the two were byte-identical when checked.

## What it looks like

All three images are the real Jette scene (OpenStreetMap, ODbL; the ingest from `docs/jette-commune-ingest.md`) on **synthetic** terrain. Each panel is the same view in a different mode. The close views are centred on a dense, steep part of the scene (a 5.8% slope; the steepest ground in this synthetic terrain is 6.7%, the median 2.0%, so Jette-like).

- `docs/images/terrain-overview.jpg`: the whole commune at 0.19 px/m. Flat, shading only, true heights, heights x3.
- `docs/images/terrain-street.jpg`: a block at 3.2 px/m. Same four modes.
- `docs/images/terrain-steep.jpg`: the same block flat, at true heights, and at six times the heights (slopes of 12% on median and 40% at the steepest, far steeper than this synthetic Jette).

What the pictures show:

1. **At true scale the offset is small.** 38 m is 7 px at the overview scale and 120 px at the street scale; across one block (100 m) the ground rises about 2 m, under one storey. In `terrain-street.jpg` the "true heights" panel differs from "relief shading only" by the roads tilting slightly and the buildings stepping up with them. It is correct and quiet.
2. **Shading carries more of the impression than the lift does,** especially at overview scale, where it is the only thing visible about the ground. It is stylised: the gain is high on purpose (a 4% slope facing the sun lifts the grey by about 85 of 255), because a faithful hillshade of 2 to 4% slopes is invisible. It also makes noise in the synthetic terrain visible as blotches in the overview; a real DTM has its own such texture and the constant (`RELIEF_GAIN`) will need tuning on it.
3. **Heights x3 is where hills read as hills** and the picture is still clean: buildings follow the slope and rows step up the streets. It is a legitimate presentation choice (`sim.opts.relief`), as long as the caption says so.
4. **At x6 the method shows its limits** (`terrain-steep.jpg`). Streets ramp steeply, rows of houses overlap each other more, and each house, being one rigid sprite, can no longer sit on its plot.

## Where it goes wrong

Checked by rendering, by measuring on the 9,214 Jette footprints, and by the tests. None of the first four is visible at true scale; all are visible somewhere above x3.

- **Buildings float or sink on slopes.** A sprite is rigid, anchored at the mean ground height under its footprint. The ground varies across a footprint: on the Jette scene with this terrain the median footprint spans 0.32 m of ground, the 99th percentile 1.7 m, the maximum 6.6 m. The downhill side floats and the uphill side sinks by half that (0.16 m median, 0.85 m at p99), nothing at all visible at 3 px/m. At x6 the median is 1.9 m (so about 1 m of floating or sinking) and the p99 is 10 m: visible gaps. No foundation or plinth is drawn. If steep plots matter, a plinth (the footprint's visible walls extruded from the anchor down to the ground at each corner) is the fix; it would be drawn with the building in paint order, so it belongs in the building draw call, not the ground layer.
- **Road continuity.** A road's height is one number at each point, linear between points, flat across its width. That is continuous along the road. Across a side slope the road is a level ribbon cutting the hill, which is what real roads do. A DTM gives the ground under a bridge or viaduct, not the deck, so a road crossing a valley on a bridge would dip with the valley. Not seen in the synthetic data; to be checked on a real DTM.
- **Shadows.** A building's shadow is drawn flat at the building's height, not draped on the ground. On a slope the shadow's far end is off the ground by slope times shadow length: 0.1 m per 3 m of shadow at 3%. Invisible here.
- **Ground steps.** The grid is continuous, so there are no cliffs. Landuse polygons take the grid height at their vertices and are flat between them (a large park over a hill shows a plane through its corners, drawn on top of the surface). A 200 m park over a 5% slope is about 10 m of plane error at the middle in the worst case; in the images it is not noticeable because the shading lies over it.
- **Paint order** is still by sprite centre (known limit 8, unchanged), now with `z` in the key. A tall building on a steep slope can still mis-order against a neighbour; the height term fixes the hillside case it was introduced for and adds none.
- **Picking** uses the renderer's height, so a gabled sprite's ridge can stand a little above it (an existing limit), now at the building's own `z`. The brute-force and grid versions agree on 1,500 random pixels with relief 2.

## Decision

- **(c) not worth it: rejected.** The renderer's own projection already supported `z` and it was needed nowhere else. The cost of doing the job is small, there is no per-frame penalty, and the plan's goal ("Jette hills visible") cannot be met by a flat map. Without any relief the ground of the map would also be wrong for the people who live on the slopes the model is about.
- **(b) shading only: kept, not chosen alone.** It is a mode (`relief: 0`) and a good one for a caption-free overview. Alone, it gives no road rise, no stepping of building rows, and no correct picking and ordering once a scene has real heights; those are the parts that make a hill feel like one at neighbourhood zoom. The shading had to be built anyway to draw the ground surface at all, so offering it alone costs nothing.
- **(a) real vertical offset with depth-sort fix: chosen.** The per-frame cost is zero, the ground layer cost is paid once per repaint, the sprite cache is untouched, and the failure modes are confined to slopes well beyond Jette's. It is the honest representation of the data, and exaggeration is a parameter, not a different code path.

Recommended defaults for the demo: `relief: 1` for fidelity, with a viewer control for 1, 2 and 3 (the viewer does not have one yet; `sim.opts.relief` is rebuilt with the sim like the other display options). Say so on the page when `relief` is not 1.

## What was not done or checked

- No real elevation file was used. `paperdolls ingest --elevation` is tested on synthetic GeoTIFF, ASCII grid and point files, including the error cases; `paperdolls/ingest/elevation.py` documents the formats. The Brussels sources in `TheGreatRetrofit/docs/calibration/geodata.md` (UrbIS DTM, 2021 LiDAR, CC BY 4.0) were not fetched; their rasters are in Belgian Lambert (EPSG:31370 or 3812), which the reader refuses with the `gdalwarp` command that converts them to lon/lat. Whether a reprojected DTM is easy enough to produce in the project's build step is open.
- Nothing was run in a real browser. `soft-light` is a standard canvas composite operation, but its speed there is unmeasured.
- The viewer has no relief control, and the pack shell has none; both draw terrain automatically if the scene has it.
- Plinths for steep plots, a draped shadow, and a per-scale cache of the relief image were not built (see above).
