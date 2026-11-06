# viz: isometric library: people, vehicles, buildings, trees, themes, scene, replay

Status: people, vehicles, buildings and trees are in the asset system (`assetlib.js`, `buildinglib.js`, `treelib.js`, tested), and colour is one theme system (a region, a look, a register). The scene library (`vizlib.js`: roads, network, renderer) drives the place viewer (`paperdolls viewer`, from an ingested scene) and the replay page (`paperdolls replay`, with `replay.js`); the Python pipeline builds both pages.

## Files

- `assetlib.js`: the engine, plus people and vehicles. Parametric definitions, four-heading builds, SVG and canvas output, regional fleets and outfits, data scales. No dependencies.
- `buildinglib.js`: buildings as assets (archetypes, facade grammar, roofs, overlays, regional grammar, footprint fitting). Load after `assetlib.js`.
- `treelib.js`: trees as assets (nine kinds, regional species mixes, foliage colours from the look). Load after `assetlib.js`.
- `packstore.js`, `packruntime.js`, `packworker.js`, `packhost.js`, `packpick.js`, `packvalidate.js`: model packs (`docs/pack-spec.md`): state store with typed arrays bound to buildings, runtime adapter, the runtime in a Web Worker, the shell, picking and the manifest validator. Tests: `test_pack.js`, `test_pack_live.js`, `test_pack_page.js`.
- `replay.js`: plays an exported trajectory through a scene (placement, mapping, week, legend). Load after `vizlib.js`.
- `refocus.js`: the zoom's finish: draws the sharp frame on a second canvas while the stretched picture stays up, cross-fades when it is whole, with an optional focus reticle and lens blur. No drawing, tested in Node. Used by `viewer.html`.
- `zoomhold.js`: smooth zooming: stretches the drawn canvas with a CSS transform while the scale changes, and says when to draw a real frame. No drawing, tested in Node. Used by `viewer.html`.
- `vizlib.js`: scene schema, road network, ground, agent simulation, renderer. Needs the three libraries above loaded first.
- `library_catalogue.html` and `viewer.html`: templates. `build_pages.py` inlines the libraries and palettes into `library_catalogue_built.html` and `viewer_built.html`, which run offline.
- `test_assets.js`: the test suite (`node viz/test_assets.js`). `tests/test_viz_assets.py` runs it and validates the SVG.

## Region, look and register

Colour is chosen in three steps, and only one of them is a palette.

- **Region** (`REGIONS[id]`): the twelve families. A region fixes everything that is not colour: fleet, climate and outfits, building grammar, species mix, drive side. Choosing a region is the only place a place is chosen; there is no separate palette picker.
- **Look** (`palettes.json`, `families[].looks[]`): a colour scheme within the region, named by materials and light, never by who lives there. Each region has three (36 in all). A look sets four wall colours, two roof colours, three accents (awnings, shutters, vehicles), ground, road, pavement, grass, three foliage colours, an optional bloom colour, water, shadow, and the road surface: `asphalt`, `concrete` joints, `cobble` setts or `earth` tracks.
- **Register**: how a look is drawn. `AssetLib.theme(family, lookId, registerId)` returns the resolved theme (every colour the renderers need) and `VizLib.setTheme(sim, theme)` swaps it on a running sim, redressing agents from their stored seeds so nothing respawns.

```js
const theme = AssetLib.theme(family, 'brick', 'formal');
const sim = VizLib.createSim(scene, { theme, region: family.id });
VizLib.setTheme(sim, AssetLib.theme(family, 'render', 'colorfigures'));
```

**colorfigures**: the region's own colours, warm hand-inked lines (1.1 px), three-tone shading.

**formal**: a technical drawing built on IBM Carbon tokens. Flat fills, 0.75 px hairlines in Gray 90, a Gray 10 background with a Gray 20 ground and a faint ground grid, white pavements. Walls are the look's colours desaturated and snapped (in CIELAB) to Carbon's neutral grays, warm or cool following the region; roofs to dark neutrals; vehicles and people are neutral grays; foliage is muted green built from Carbon Green 60; water from Blue 60; the cycle lanes are Blue 30. Colour is reserved for data: the retrofit states use IBM's data-visualisation colours (cyan 50, yellow 30, teal 50, purple 60) and co-op vans are IBM Blue 60.

Carbon tokens: confirmed against carbondesignsystem.com are white, gray 10, 20, 30, 50, 60, 80, 100, blue 10, 30, 60, 70, 80, purple 40, 60, 70, yellow 30, green 60 and red 60. **Taken from memory of Carbon's palette and still to be checked**: gray 40, 70 and 90, the whole cool-gray and warm-gray scales, blue 20 and 40, cyan 50 and teal 50. The snapped neutrals depend on the cool and warm scales, so check them before the formal register goes into policy material.

## The asset model

Every asset is defined once, in its own frame (metres, x forward, y lateral, z up), as a list of parts. For each of the four axis headings (SE, SW, NW, NE on screen) the library builds only the faces turned toward the camera: **left** (world +y), **right** (world +x) and **top**. The result is a list of polygons in screen metres, each tagged with its face and a role.

- **SVG** (`AssetLib.toSVG`): every polygon carries `data-face`, `data-role` and, on the recolourable surface, `data-surface="1"`.
- **Canvas** (`AssetLib.paint`, or `drawSprite` with a sprite cache): the same polygons painted with the register's three flat tones and ink line.

Headings snap to the nearest of four axes, so a curved road shows as steps. This is a deliberate trade for pre-built, cached assets.

### Part types

| type | meaning |
|---|---|
| `prism` | a side profile `[[x,z],…]` extruded across `y:[ya,yb]`. Cars, vans, cabs. `topRole`, `edgeRole`, `capRole` override the role per face type |
| `box` | `b:[x0,y0,z0,x1,y1,z1]` |
| `flat` | a panel on a side plane (`side` 1, -1, `'both'` or 0): windows, door lines, bicycle frames |
| `disc` | a wheel or hub on a side plane |
| `end` | a panel on an end plane `[[y,z],…]` at `x`: windscreens, lights, building side walls. `end:0` picks whichever side faces the camera, which is how paper dolls work |
| `face` | a free polygon in local 3D with an outward normal: hip roofs, awnings, solar panels |

`prism` also takes `axis:'x'` (profile in `(y,z)` extruded along `x`), which is how gable roofs are built. Any part may set `needs:[x,y]`, the outward direction of the wall it stands proud of: it is drawn only when that wall faces the camera, so a balcony on a hidden wall is never painted through the building.

Parts draw in `layer` order, then by depth along the view vector. Prisms are layer 0, panels layer 5; set `layer` to force an order.

### Roles and the data surface

Roles: `data`, `glass`, `wheel`, `hub`, `frame`, `trim`, `light`, `paper`, `roof`, `cab`, `interior`, `bottom`, `accent`, `hat` for people, and `roofflat`, `door`, `shutter`, `awning`, `chimney`, `solar`, `scaffold`, `band`, `marker`, `insul`, `insulroof`, `community`, `segdone`, `segtodo` for buildings. **`data` is the recolourable surface**: the garment on a person, the body or livery on a vehicle (the cargo box on a lorry, the pannier on a bicycle), the walls of a building. A simulation never changes shape, only the colour of `data`.

```js
const legend = VizLib.bindData(sim, 'people', AssetLib.scales.retrofitStates(reg), agent => agent.data.state);
VizLib.bindData(sim, 'vehicles', AssetLib.scales.sequential(['#f4e9c8', '#c8452f'], [0, 1]), agent => agent.data.load);
```

Scales: `categorical(map)`, `sequential(stops, domain, labels)`, `retrofitStates(reg)`. Each returns `colour(value)` and `legend()`.

## People: paper dolls

Flat cut-outs facing the direction of travel, as in the reference illustration: round head, arms out, trouser legs for the man, an A-line dress for the woman. Boy and girl are the same shapes scaled to 0.64 and 0.66 with larger heads. There is no walking animation.

- Kinds: man, woman, boy, girl, couple, parent and child, family of four (hands joined), wheelchair user, rider (on any two-wheeler).
- Head, arms and legs share one neutral paper tone. **There are no skin tones.** The garment is the data surface.
- People are drawn at **1.2x** life size so they read at neighbourhood zoom (`AssetLib.STYLE.person`). Vehicles use the same 1.2x so proportions stay true (`STYLE.vehicle`).

## Vehicles

19 classes: bicycle, cargo bike, moped, motorbike, three-wheeler taxi, three-wheeler utility, city car, hatchback, saloon, SUV, pickup, delivery van, co-op van, small box van, minibus, bus, double-decker, tram, lorry. Each declares the **network** it moves on (`road`, `rail`, `cycle`, `pavement`), which the sim uses to keep it on suitable edges.

## Buildings

Six archetypes: terraced house, shophouse, apartment block, detached house, tower, shed. A building asset is built from `{ kind, W, D, N, variant, fs, ov, seg }`: frontage width and depth in metres (quantised to 1 m and 2 m so assets are shared), storeys, a facade seed, the regional facade style, and the overlays. The front faces local +y, so it faces the camera at two of the four headings (NE and SW on screen) and you see the back at the other two. The left and right walls are the party walls.

- **Facade grammar**: each wall is a grid of modules (window, balcony window, door, shopfront, ribbon glazing, roller door, high window, blank) generated with rules: a house front has exactly one door, a shop front at least one, no run of three blank bays, balconies stack in columns, and a front never has a storey without openings. Same seed, same facade.
- **Roofs**: flat with a parapet and roof plant, gable (ridge along the frontage), hip, low-pitch shed. Chimneys on pitched roofs.
- **Data surface**: the walls (three large faces, so one recolour covers a whole facade). Roof, door, glass and trim keep their own colours.
- **Overlays** (discrete geometry a simulation switches on): `scaffold` (poles, decks, rails on every visible wall), `solar` (panels on both roof slopes or in tilted rows on a flat roof), `band` (a coloured band at the base), `marker` (a roof marker). The Great Retrofit mapping is the default style (`VizLib.retrofitStyle`): queued = band, in retrofit = scaffold, finished = solar, investor-owned = marker, with wall colour from the state. Two more overlays for model packs: `insulation` (a cladding panel on every wall, under the windows and doors, and a slab or an eaves band on the roof, roles `insul` and `insulroof`) and `community` (a roof pavilion with a flag, role `community`). A style may also carry `seg: { n, k, done, todo }`: every wall is divided into `n` sections (at most `AssetLib.SEG_MAX` = 12) and the first `k` are drawn in `done` (roles `segdone` and `segtodo`, under the windows). `n` and `k` are in the asset id, so a sprite is shared by every building with the same shape, `n`, `k` and colours. Zoomed out (below `sim.opts.segMinScale`, default 1.4) and on generic extrusions the wall colour is mixed toward `done` by `k / n` instead (`AssetLib.segmentsFor` maps units to sections). `sim.groundTint = { cells(version), opacity, version() }` tints the ground under the buildings (`VizLib.drawGroundTint`; cells are painted opaque into one view-sized canvas, blitted with the opacity, repainted once per version and view). See `docs/pack-spec.md`, "Visual channels". Replace the default style with `sim.buildingStyle = (entity, reg, pal, wall) => ({ data, overlays })`, or recolour the walls from a model output with `bindData(sim, 'buildings', scale, e => value)`; a binding wins over the style.
- **Regional grammar** (`REGIONS[id].buildings`, proposals): archetype mix, roof mix, shutters, awnings, balconies, air-conditioning units, chimneys and window proportion, driven by climate and local building types.

### From footprint to asset

`AssetLib.fitFootprint(footprint, roads)` finds the minimum-area rectangle and returns `{ ok, reason, cx, cy, W, D, heading, dev, rectangularity }`. A footprint takes an asset only if it is at least 82% of its bounding rectangle, at least 3 m on each side, and within 12 degrees of an axis. The front faces the nearest road (not a cycle track). Everything else is drawn as a generic extrusion, and the scene reports it: `sim.stats = { buildings, assets, extruded, reasons }`. Nothing is silently approximated. A footprint that is accepted is drawn at its quantised size, up to 0.5 m wider and 1 m deeper than the footprint.

## Trees

Nine kinds: broadleaf, oak, plane, columnar (poplar, cypress), conifer, umbrella (acacia, pine), palm, blossom, shrub. Foliage is low-poly: faceted ellipsoids, cones and palm fronds built from free faces, so it takes the register's three flat tones. A tree is built from `{ s: scale (0.8, 1, 1.2), v: variant }` and drawn from one of four headings, so no two neighbours look alike. Colours come from the look: foliage from its three canopy colours, `bloom` for flowering trees, and the trunk. The main foliage is the data surface (role `data`), so canopy can be recoloured, for example by condition. A flowering tree only appears if the look has a bloom colour (cherry blossom, jacaranda, flame tree, bougainvillea); without one it becomes a plain broadleaf.

Each region has a species mix (`REGIONS[id].trees`, proposals): plane trees dominate Paris and Vienna, palms and umbrella trees in the tropics, cypress and stone pine around the Mediterranean, oaks and conifers in the north and in North America. In a scene, a tree is `[x, y]` or `[x, y, kind, scale]`; with no kind the region's mix decides (`pickTree`). Street trees, gardens and a ring around the square are placed in the placeholder scene; OpenStreetMap `natural=tree` would feed the same list.

## Roads and ground

The ground is a base plane (plots and gardens), landuse (park, garden, square, water), then roads. The look's `surface` decides the road texture, drawn only when zoomed in enough to see it: `asphalt` (plain, with a dashed centre line), `concrete` (slab joints every 8 m), `cobble` (rows of setts), `earth` (tyre tracks, no markings). Pavements have a kerb line, boulevards a median, trams rails, avenues cycle lanes.

## Regions (proposals, to be checked with local authors)

`AssetLib.REGIONS[familyId]` holds, per palette family:

- **fleet**: weighted vehicle classes (tuk-tuks and motorbikes in South and Southeast Asia, cargo bikes in the north, double-deckers in the UK, minibuses and pickups elsewhere)
- **climate** `{cold, sun, rain}`: drives coats and scarves, sun hats and caps, umbrellas on people
- **drive**: `'right'`, `'left'` or `'ask'`. `'ask'` marks regions that differ by country (Southeast Asia, East Asia, Sub-Saharan Africa): ask the user at intake. Override per run with `createSim(..., { drive })`

People and vehicles take their colours from the family palette (`makeOutfit`, `vehicleTint`). Regional variation follows climate and fleet, never identity.

## Motion

Motion is decorative by default: a random walk on the road network. **People keep off the buildings.** A person is drawn on the pavement at an offset from the road's centre line, and nothing guarantees the pavement is free: in a dense scene buildings stand on it (and in the placeholder, on the tram boulevard, they covered the whole 3.5 m strip), and people were drawn walking through and along the walls (2.8 percent of positions inside a footprint on the placeholder and 2.3 percent on a real Brussels extract, 62 percent on the boulevard). `createSim` now checks each pavement edge against the building footprints, on both sides and at three offsets across the pavement, keeping people 0.4 m from a wall: a person walks on the clearer side and at the clearest offset (the middle of a clear pavement, as before), an edge with less than 70 percent of its length clear on either side is not walked while there is another way (people turn round at its end instead of stepping onto it), and people start only on walkable edges. Measured over 400 steps: inside a footprint 2.8 to 0.2 percent on the placeholder and 2.3 to 0.1 percent on Jette, within half a metre of a wall 2.9 to 0.3 percent on Jette. What is left is a person crossing the blocked stretch (up to 30 percent) of an edge that is mostly clear. Building the walk data adds about 130 ms to `createSim` on a scene of 12,000 buildings. A class can be given real motion:

```js
VizLib.setMotion(sim, 'tram', { mode: 'path', loop: true, path: [[t, x, y], …] });          // timetable
VizLib.setMotion(sim, 'bus',  { mode: 'driven', update(agent, t, dt, sim) { return { x, y, heading } /* or { edge, s, dir } */; } });
VizLib.setMotion(sim, 'people', { mode: 'static' });
VizLib.setMotion(sim, 'bus', null);                                                          // back to decorative
```

The selector is a class (`'bus'`), a group (`'people'`, `'vehicles'`) or a function of the agent.

## Scene schema (input)

Coordinates are metres in a local frame.

```
{ area:      { name, source, attribution?, origin?, rotation_deg?, north_on_screen_deg?, extent_m?, osm_relation? },
  roads:     [{ id, class, pts, width?, pavement?, cycle?, tram?, name? }],     class: local | avenue | boulevard | cycle | pedestrian | tramway
  buildings: [{ id, footprint, levels, archetype, state, investor, osm? }],     archetype: any of the six, or 'auto' (the region decides)
  landuse:   [{ id, kind: 'park' | 'garden' | 'square' | 'water', footprint }],
  trees:     [[x, y] or [x, y, kind | null, scale], …] }
```

A road's `width`, `pavement`, `cycle` and `tram` override its class. `pedestrian` carries people only; `tramway` is a tram track with no road alongside. `VizLib.validateScene(scene)` checks a scene and returns `{ ok, errors, warnings }`; `createSim` refuses an invalid scene with the first reasons.

`makePlaceholderScene(seed)` is a synthetic stand-in. `paperdolls ingest` builds the same shape from an OpenStreetMap extract (see the plugin README): it rotates the frame so the dominant street direction lies on an axis, maps OSM tags to classes, archetypes, storeys and tree kinds, and writes a report listing every assumption. The viewer (`viewer_built.html`) loads a scene file with its Scene control, pans by dragging, zooms with the wheel, and shows the OpenStreetMap attribution.

### Rendering cost

Measured with node-canvas (a software canvas, so a browser will differ). On the 1,023-building placeholder a street-zoom frame costs about 22 ms (1,048 items in view), about 11 ms at 3 px/m, about 5 ms at 5 px/m and about 4 ms at 8 px/m. A synthetic scene of 12,276 buildings and 4,093 agents (the placeholder tiled twelve times; `node viz/scale_bench.js` reproduces it) takes 4.6 ms settled and 4.8 ms panning at 0.7 px/m, 17.5 and 19.2 ms at 1.7 px/m, and 10.9 and 11.2 ms at 4 px/m. Its first frame takes 4.9 s fully zoomed out, 0.37 s at 1.7 px/m and 0.09 s at 4 px/m, because the far layer and the sprites are built then.

What made this fast, in order of effect:

1. **Sprites at the exact scale.** A sprite is cached at a scale bucket, and a bucket is almost never the view's exact scale, so every blit was resampled. That cost about 2.4 times the frame time (3.0 px/m: 19 ms; 3.1 px/m: 46 ms) and softened the hairlines. Once the zoom has held still for two frames, sprites are built at exactly the view's scale and blitted 1:1 on whole device pixels. While the zoom is changing the old quarter-pixel buckets are used so a zoom does not rebuild every sprite each frame, and at most 150 sprites are rebuilt per frame, so a settled view sharpens over a few frames and never stalls. `AssetLib.sprites.exact` is the switch; `VizLib.renderFrame` sets it.
2. **Unique tone per building defeated the cache.** Tones now come in five steps (this one cost 6 s per frame on 12,500 buildings).
3. **World-anchored layers.** The ground (roads, landuse, building shadows) and, below 1 px per metre, the buildings and trees are drawn into cached canvases 1.8 times the view in each direction, anchored to the world rather than the screen (`worldLayer` in `vizlib.js`). Panning blits a window of the layer, so a pan frame costs one `drawImage` until the view moves more than 40% of its size, when the layer is repainted once. While the zoom is changing the old layer is drawn scaled, a little soft, and repainted exactly once the zoom stops. After a pan ends with a fractional shift the layer is repainted once, so a still picture is exact. Below 1 px per metre people are skipped and vehicles are dots. A road spatial index keeps footprint fitting fast.

#### Zooming: let the compositor do it, build sprites under a time budget, pre-render the neighbours

A zoom used to stall: while the scale changed, sprites were cached in quarter-pixel buckets, and every new bucket rebuilt every visible sprite in one frame (150 to 500 ms in node-canvas). Measuring it in a real browser (Chrome, dpr 2, a 1,023-building scene, a canvas of 1,300 to 2,800 device pixels wide, wheel notches dispatched to the page, frame times from `requestAnimationFrame`) showed what a benchmark in node-canvas hid, and changed the design.

What did not work. The first fix copied the last sharp frame off the canvas and redrew that copy scaled while the zoom ran. In node-canvas it looked good (slowest frame 464 to 61 ms). In the browser it was worse than doing nothing: a real wheel sends an event every few frames, so a frame with no event counted as "not zooming", drew a full real frame, threw the copy away, and the next event copied the whole canvas again (about 20 ms of GPU copy every other frame). Median frame 50 ms, and a 233 ms frame at the end, against 17 ms and 2 slow frames with it switched off. It was removed.

What is there now:

1. **`zoomhold.js`: a CSS transform.** While the scale keeps changing, nothing is redrawn. The canvas that is already drawn is moved and scaled with `transform: translate() scale()`, which the compositor applies with no JavaScript and no raster work, whatever the scene size (a transform change measured at the display's 17 ms, flat). The zoom counts as ongoing until the scale has been still for 120 ms, so the gaps between wheel events do not end it. Then one real frame is drawn and the transform is cleared. A zoom that stretches the drawn picture beyond 0.3 to 8 times draws a real frame and takes it as the new base. The canvas sits inside `#stagebox`, which clips it and takes the pointer events, because a transformed element reports a transformed bounding box. People and vehicles hold still for the length of a zoom.
2. **Sprites under a time budget.** When a frame is drawn for real, a frame may spend 8 ms building sprites (`opts.buildMs`; at least one is always built), and at most 60 while sharpening or 16 while zooming. A build costs about 0.35 ms in node and about 0.8 ms in Chrome, so a count alone is the wrong unit. A sprite that is missing is drawn scaled from the nearest one held (within about 10 times in either direction); a person or vehicle with nothing held is left out for a few frames. While moving, sprites come in whole octaves (1, 2, 4, 8 px/m), so a zoom crosses one bucket per doubling.
3. **Pre-render and hold.** While the view is still and sharp, up to 12 sprites a frame, within 4 ms, are built for the zoom levels either side of the current one, for the sprites the frame drew, so a zoom finds them ready. `sim.opts.prewarm = false` turns it off.
4. **Eviction, not clearing.** Over the sprite memory cap, only sprites more than 2.7 times away in scale are dropped; the whole cache was cleared before.

Measured in the browser, wheel notches from the fit view (frames over 34 ms, slowest `requestAnimationFrame` interval): before the first fix, a 6-notch zoom had 31 of 60 frames over 40 ms and a 233 ms frame; with the CSS transform, a 6-notch zoom had 1 to 7 frames over 34 ms and a slowest frame of 50 to 83 ms, and a 12-notch (6.8 times) zoom had 2 to 4 over 34 ms and a slowest of 83 to 183 ms, depending on the canvas size the pane gave (the window width changed between runs, so the runs are not exactly comparable). The median frame was 17 ms throughout.

5. **Layers painted in slices.** The end-of-zoom frame used to repaint the ground layer in one go (about 35 to 50 ms in Chrome, 33 ms of it the ground itself) and, below 1 px/m, the far-zoom layer of every building and tree (about 275 ms for 1,000 buildings, and again a second time when the sprites went exact, because the exact flag was part of its key). Both are generators now (`drawGroundSteps`, `drawStaticSteps`, and the far layer's own steps yield every few items) and `worldLayer` paints a new layer a slice per frame (6 ms, `opts.layerMs`) into a second canvas, with the old one scaled to stand in (within 0.15 to 8 times) until it is whole, then swaps. A far layer that does not exist yet is painted the same way while the buildings are drawn directly for those frames. `sim.opts.sliceLayers = false` paints in one go as before. A pan past the layer's margin is still painted in one go.

Measured in the browser, wheel notches (frames over 50 ms, slowest `requestAnimationFrame` interval, slowest `renderFrame` call), same pane, scene of 1,023 buildings:

| zoom | before slicing | with it |
|---|---|---|
| 12 notches in (6.8 times) | 83 to 100 ms, 95 to 102 ms in `renderFrame` | 50 ms, 28 to 30 ms in `renderFrame` |
| 6 notches in (2.6 times) | 50 to 83 ms, 54 ms | 50 to 67 ms, 35 to 40 ms |
| 6 notches out (to 0.38 times, into the far layer) | 283 ms, 275 ms | 50 ms, 55 ms |
| 12 notches out (to 0.15 times) | 117 ms, 118 ms | 117 ms, 119 ms: not improved |

One in four of the 12-notch-in runs showed a 106 ms frame; the rest were 28 to 30 ms, and it did not reproduce. The 12-notch zoom-out is a flick of 6.8 times, past the 0.3 times that the held picture may shrink, so a real frame is drawn mid-gesture at the far scale, where the far layer is still being painted and the buildings are drawn directly.

What is left: a flick that shrinks the picture past 0.3 times still costs one frame of about 120 ms (a bigger shrink limit would avoid it, at the price of a smaller island of picture until the sharp frame arrives); the first frame after a long zoom still builds sprites (8 ms a frame, so a few frames of progressive sharpening); a pan past the layer margin repaints in one go; and a 12,000-building scene was not measured in a browser. Building sprites and layers in a worker with `OffscreenCanvas` would take the rest off the main thread; it is not built. `node viz/zoom_bench.js` times the sprite path in node-canvas, which is not what a browser does.

#### Zoom effects: finishing in focus

The stretched picture (above) and the sharp frame that replaces it are two different pictures, and the swap used to be visible: a pop, and then sprites sharpening over several frames. `refocus.js` hides that, with four switches in the viewer (all on a running viewer; reduced-motion users get no easing, no fade time and no blur):

- **Eased zoom** (`LabControls` `smoothZoom`): a wheel notch no longer jumps; the scale eases toward its target (about 200 ms to 95%), notches add up, the point under the cursor stays under it. The stretch is continuous and the sharp frame arrives as the motion ends.
- **Crossfade**: when the zoom stops, the real frame is drawn on a second canvas stacked above, invisible, while the stretched picture stays up; each frame it checks whether nothing is left to build (no sprites built, no layer pending) or 500 ms have passed, then fades the new canvas in over 160 ms and swaps the two. You never see a half-drawn frame. Zooming again at any point returns to stretching the picture that was drawn, and hides the second canvas.
- **Focus reticle**: four corner brackets at the cursor that pulse while the picture is out of focus, then contract and flash green when the sharp frame arrives and fade out. A CSS overlay driven by the same events.
- **Focus blur** (off by default): the stretched picture is blurred in proportion to the stretch, up to 6 px, like a lens that has lost focus; it is sharp again after the swap. It costs GPU time on a large canvas.

Measured in Chrome (canvas 2770 by 1296, 1,023 buildings, 12 wheel notches, which the easing turns into a zoom to 14 times): the viewer went live, zoom for 65 frames, refine for 29 frames (the sharp frame being built out of sight), fade for 8 frames, live; no page errors; median frame 17 ms and slowest 33 ms, with none over 34 ms. The old build's slowest frames in a similar test were 50 to 120 ms. The second canvas doubles the canvas memory. A screenshot mid-zoom with blur and the reticle on showed the blurred, stretched city with the brackets over the cursor. The lock flash and the cross-fade itself were not caught in a screenshot.

**Fixes after use (blinking, judder, a stuck view).** Reported from real use, traced in Chrome with a stress script (14 gestures of 6 notches in and out with pauses of 30 to 500 ms; an 8 ms wheel storm; pans, switch toggles and W/S keys mid-zoom):

- *The easing tail kept the viewer in "zoom" for about 0.8 s after every gesture.* The exponential tail needs 0.66 s to fall under 0.01 percent, and `zoomhold.js` read each tiny scale change as a zoom, so the sharp frame was late, people and vehicles stayed frozen and then jumped (the blinking), and gestures less than 0.8 s apart never rendered a real frame at all (the stuck feeling). Now a zoom is a scale that moves more than 0.15 percent a frame (`creep`), and the controls apply the last 0.3 percent at once instead of tailing off. After a pause of 500 ms the viewer is refining or fading (it was still in "zoom" with a 0.0038 tail); after about 0.45 s it has settled.
- *A pan while the sharp frame was being made was ignored*, so the old picture sat still and then jumped, and the cross-fade blended two misaligned pictures. `ZoomHold.place(view)` now moves the stretched picture with the pan during the refinement and the fade.
- *The swap could come a few percent early*: the CSS fade runs on the compositor's clock, so at the frame it was due the new picture could be about 90 percent opaque and the old one vanished. The swap now waits 40 ms more.
- *One failing frame stopped the viewer for good* (the loop only scheduled the next frame after a successful one). `frame()` now catches, shows "A frame failed and was skipped" once, resets the zoom state and always schedules the next frame; `window.labViewer.frames()` counts frames.
- *Layer canvases were allocated anew for every repaint* (40 to 50 MB each on a large screen, slow to be garbage collected, a risk of running out of canvas memory after many zooms). The canvas of the layer just replaced is kept as a spare and reused.

Not reproduced: a hard freeze. None of the stress runs left the viewer stuck or raised an error; if it happens again, `window.labViewer.refocus.state()`, `window.labViewer.controls.pendingZoom()` and `window.labViewer.frames()` in the console say whether the loop is alive, which state it is in, and whether a zoom is still being chased.

#### Pan and zoom frames

Profiling the 12,500-building scene found that still frames were cheap (10 to 13 ms) but frames while panning or zooming cost 46 to 157 ms, because the ground layer and the far layer were keyed on the pan offset and the scale and were repainted at every step. Median frame time, node-canvas, 1200 by 700:

| view | before | after |
|---|---|---|
| pan at 0.7 px/m | 157 ms | 4.7 ms |
| pan at 1.7 px/m | 55 ms | 13.6 ms |
| pan at 3 px/m | 46 ms | 10.2 ms |
| zoom at 0.7 px/m | about 85 ms | 6.4 ms |
| zoom at 1.7 px/m | 55 ms | 15 ms |
| zoom at 3 px/m | about 59 ms | 19 ms |
| still at 0.7 px/m | 11.6 ms | 4.9 ms |

The "before" zoom numbers at 0.7 and 3 px/m are from an intermediate version of this change that repainted an oversized layer at every step, so they are higher than the original code's. The original zoom cost at 1.7 px/m was 55 ms.

`viz/test_assets.js` checks that pan frames are identical pixel for pixel to a fresh render (at 0.7 and 1.7 px/m; at 3 px/m a pan differs from a fresh render in a handful of anti-aliasing bytes), that a pan inside the margin repaints nothing, and that a view that has stopped after a fractional pan or a zoom is exact. Not yet measured: a real browser with a GPU canvas. The remaining pan cost at 1.7 px/m is the per-frame collection and drawing of the visible buildings; a spatial grid and a persistent depth order would reduce it.

### Finishing options (opt-in, colorfigures only)

All are set on `sim.opts`, read by `VizLib.renderFrame`, and baked into sprites or cached layers, so they cost build time and not per-frame time. `node viz/detail_bench.js [outdir]` writes a picture of each variant and times them. `node viz/record_tour.js outdir [fps] [seconds] [width] [height]` renders a scripted zoom tour to PNG frames (every view drawn settled, no budgets) for encoding into a video with ffmpeg; the `SHOTS` environment variable (JSON list of `[seconds, x, y, pixels per metre]`) changes the route.

| option | what it does |
|---|---|
| `detail: true` | Buildings only, from 2.5 px per metre: a faint grain, a light bevel on roof edges and a soft shading band along the foot of each wall, baked into the sprite; flat roofs get air-conditioning units, vents and a tank, and about a quarter of windows use darker glass; the cached ground gets a longer, fainter cast shadow and three stepped contact rings. Needs the scene built with the option (`createSim`), because the roof props are part of the asset. |
| `ink: true` | Buildings and trees: hairlines inside, and the heavy outline only around the silhouette. |
| `pixel: n` | n above 1 (1.5 is a good size): the scene is drawn at 1/n resolution and upscaled with nearest-neighbour, so ink is one logical pixel wide. Grain is skipped in this mode. `pixelSmooth: true` smooths the upscale. |
| `posterize: step` | With `pixel`: each colour channel is rounded to a multiple of step (12 works), once per sprite and per cached layer. |
| `fog: true` | A cool haze toward the top of the view and darker edges, painted once and blitted. |

On the placeholder scene in node-canvas, with every option on, settled frames stayed at about 3 ms and panning at about 3 ms; the first frame is slower (about 1.4 s against 0.2 s at 1.5 pixels) because posterize reads each new sprite back once. The formal register ignores all of these.

### Replay (`replay.js`)

`Replay.create(sim, data)` plays a model's trajectory through a scene. `data` holds `weeks` (per week, arrays indexed by model building: `codes`, `investor`, and `vars` keyed by variable name, with `null` or NaN for missing), `mapping` (the declared mapping, see [docs/replay-mapping.md](../docs/replay-mapping.md)), `states` (legend labels for the four state codes) and `n`. The returned object has `setWeek(t)`, `advance(dt)` (at `speed` weeks per second while `playing`), `setWall(i)`, `legend()`, `entityOf(k)` and `error`.

- **Placement.** `Replay.place(scene, n)` orders the scene's buildings by distance from its centre; model building k takes the k-th, and the rest are extras with no data. A scene with fewer buildings than the model gives `{ ok: false, error }` and `create` draws nothing from the model.
- **Missing data** is `Replay.NO_DATA`, never the low end of a scale. A sequential scale clamps outside its domain.
- **Legend.** Built from the scales (`ramp` or `swatches`), so it can describe only what is drawn. With no mapping, the four states use the labels the page was given.
- With a mapping, `sim.buildingStyle` is replaced; without one, the state codes are written onto the scene's buildings and the default Great Retrofit style draws them.

Tests: `node viz/test_replay.js` (the library) and `viz/test_replay_page.js` (a built page in jsdom, run by `tests/test_replay_page.py`).

### Live model frames (model packs)

A pack's runtime sends frames, most of them patches; the page applies each to the store, the store updates typed arrays bound to the scene's buildings, and `sim.frameVersion` tells the renderer that the picture may differ (`docs/pack-spec.md`, "Rendering a live model"). `node viz/scale_bench.js` measures it on the 12,276-building scene: a patch of 4,000 buildings (a third of the scene, each moved one state on) is applied, and the next frame and the frames after it are timed until the picture is whole again. `P1` is the path before this work (a style that looks the frame up by a Map and allocates, no version, so the far layer is off and every building is styled in every frame); `P2` is the store's bound arrays and the frame version. Median of 8 patches, node-canvas (software canvas, 1200 by 700), this machine:

| px/m | path | steady | store apply | frame after patch | worst frame | frames to settle |
|---|---|---|---|---|---|---|
| 0.7 (far) | P1 | 127.3 ms | 0.02 ms | 448.3 ms | 448.3 ms | 3 |
| 0.7 (far) | **P2** | 4.0 ms | 0.34 ms | **16.2 ms** | 18.6 ms | 173 |
| 1.7 (mid) | P1 | 22.6 ms | 0.01 ms | 81.0 ms | 81.0 ms | 160 |
| 1.7 (mid) | **P2** | 26.5 ms | 0.32 ms | **35.4 ms** | 35.4 ms | 3 |
| 4 (near) | P1 | 14.4 ms | 0.01 ms | 14.4 ms | 15.9 ms | 19 |
| 4 (near) | **P2** | 13.3 ms | 0.28 ms | **11.8 ms** | 11.8 ms | 3 |

With a patch of 12,000 (every building changes; 4 patches): far 3.8 ms steady, 23.3 ms after the patch, 26.4 ms worst, 343 frames to settle (P1: 1,100 ms); mid 21.2 ms steady, 30.9 ms after the patch and worst, 85 frames to settle (P1: 233 ms, and still settling at the 400-frame cap). `PATCH=12000 node viz/scale_bench.js` reproduces it.

**Target: under about 50 ms per patch frame. Met at every zoom** (worst frame 35 ms with a patch of 4,000, 31 ms with 12,000), and applying the patch to the store costs under 1 ms. **What is not instant is the far zoom.** At 0.7 px/m the far layer holds 12,276 buildings and 5,088 trees and is repainted in slices of `LAYER_MS` (6 ms a frame; the pack page uses 12 ms, which `LAYERMS=16` shows takes a patch from 173 frames to 54 with a 20.7 ms frame after the patch and 23.3 ms worst). A patch is on screen only when that repaint ends, about 1 s of painting here, 170 frames at 6 ms (about 3 s at 60 fps), while the old layer stays up; and a newer patch restarts the repaint. So a model that sends a patch every 50 ms and is watched from far out shows the picture a few seconds late, and at 20 steps a second it never completes: the far layer is the limit, not the patch. What would lift it: drawing the far layer as flat polygons rather than sprites (they are a few pixels wide), or repainting only the dirty rectangles of a compact patch (a scattered patch, as here, dirties nearly everything). Neither is built. A browser's GPU canvas paints faster than node-canvas (the far layer took 275 ms in one go in a browser, known-issues #19, against about 1 s here), so expect the lag to be a few times shorter there; it has not been measured in a browser.

The mid and near rows show the other half: the P1 path styled every visible building in every frame (an allocation and a key string each) and took 160 frames to settle at mid zoom; with a version a building is asked once per change. The steady frame at mid zoom reads 26.5 ms against 22.6 ms for P1, which is noise between runs (the work per steady frame is less, not more); the first table above reads about twice the numbers in "Rendering cost" on this machine and is identical on the commit before this work.

### Occlusion culling: built, correct, and not faster (opt-in)

Most of a building is hidden behind another, so skip what the viewer cannot see. `sim.opts.occlusion = true` turns this on. It is off by default, because on every scene measured it costs more time than it saves.

How it works. Items are already sorted back to front. The culling pass walks that list front to back with a coverage grid (one byte per 4 by 4 block of device pixels). An item is skipped when every pixel its sprite and its ground shadow can touch lies in blocks already covered by fully opaque pixels of nearer buildings. A surviving building then records a few opaque rectangles taken from its cached sprite (`AssetLib.spritePlacement` gives the mask and where the blit lands). The test only trusts alpha 255, widens the touched area by a pixel, and rounds covered blocks inward, so a skipped item could not have changed a pixel.

Where it does nothing. It needs sprites cached at the view's exact scale (the same condition as `AssetLib.sprites.exact`), so it is off while the view moves. It skips any item whose sprite or colours may be stale this frame (a state change, a data binding, a custom building style), people below 1.6 px per metre, vehicles below 0.9, and riders. It runs only with at least 300 items in view (`sim.opts.occlusionMin`).

`viz/test_assets.js` checks that the frame is identical pixel for pixel with and without it, on a scene made of 4 to 8 storey buildings, at two zooms, and that hidden items are skipped.

`node viz/occlusion_bench.js [scene.json]` times it (median of 21 identical frames, the variants interleaved, 1200 by 700 canvas, node-canvas):

| scene | px/m | items in view | skipped | occlusion off | occlusion on |
|---|---|---|---|---|---|
| placeholder, 1,023 buildings | 1.2 | 1,723 | 16 | 13.7 ms | 16.0 ms |
| | 1.7 | 1,217 | 55 | 10.3 ms | 12.5 ms |
| | 3 | 515 | 72 | 5.1 ms | 6.7 ms |
| placeholder, every building 4 to 8 storeys | 1.2 | 1,723 | 16 | 16.8 ms | 19.1 ms |
| | 1.7 | 1,228 | 57 | 12.3 ms | 14.6 ms |
| | 3 | 524 | 71 | 5.4 ms | 7.2 ms |
| synthetic, 12,500 buildings | 1.2 | 1,470 | 63 | 13.0 ms | 15.0 ms |
| | 1.7 | 772 | 62 | 12.3 ms | 13.9 ms |

At 5 px per metre and closer, fewer than 300 items are in view and it does not run.

Why it does not pay. A cached sprite is one `drawImage`, about 10 microseconds. Skipping 60 items saves well under a millisecond, and the coverage test and bookkeeping cost more than that. The earlier measurement (`viz/occlusion_probe.js`) predicted this: the camera is at about 40 degrees, so a building hides only a strip behind it, and the items that are fully hidden are mostly trees and people. A first version that recorded every opaque run per row, not rectangles, was 70 to 235% slower; the coarse grid brought that down to 13 to 34%, and the remaining cost is the test itself plus looking up each item's sprite.

Where it could pay: a scene where drawing an item is much more expensive than a blit (large vector extrusions that are not sprites, or a software canvas that is slow at blits), or where most of the screen is covered by tall buildings. Run `node viz/occlusion_bench.js scene.json` on the real scene before turning it on.

### Large scenes

Ingest of 12,500 buildings takes about 1.1 s and the scene file is about 3 MB. Building the sim takes about 0.6 s. Panning at far zoom still redraws the cached layers each frame.

## Known limits

1. **Four headings.** Curved roads show as steps; diagonal views are not built.
2. **Footprints.** Only near-rectangular footprints within 12 degrees of an axis use building assets. Real OSM data has rotated, L-shaped and curved buildings, which fall back to a generic extrusion that does not share the facade grammar. The ingest rotates the frame to the dominant street direction (one rotation per scene), which raised the share on synthetic data from 0% to 97%; on a city with several street grids it will be lower, and `sim.stats` and the ingest report give the numbers. Handling arbitrary rotation is the next structural question.
3. **One box per building.** No setbacks, courtyards or different heights within a footprint. Drawn size is quantised (1 m wide, 2 m deep).
4. **Looks are proposals, not measurements.** The 36 looks were authored by eye from general knowledge of materials and light, not sampled from photographs of real places. Each needs checking with local authors, ideally by replacing the colours with ones sampled from photographs of the actual place.
5. **The formal register's Carbon tokens are partly unverified** (see above), and it is a Carbon-based drawing style, not an IBM-endorsed one.
6. **Trees** are generic species shapes, not botanical. Foliage is faceted at one resolution. A flowering tree is patched with bloom on about half its faces. Tree placement in a real area depends on OSM tagging, which is patchy.
7. **Cold start.** Assets are built when first needed. The first frame of a whole-area view of about 1,000 buildings and 400 trees takes about 1.8 s in node-canvas; later frames take 20 to 100 ms. There is no pre-warming.
8. **Depth sorting** is by centre, so wide, tall or long things (towers, trams, buses, large tree crowns) can mis-order against a neighbour at a junction.
9. **Wheelchair user** is the weakest figure; moped and motorbike detail is small at neighbourhood zoom. People walk a random path with no collision or queueing, and there is no level-of-detail at far zoom.
10. **Regional tables are proposals**: fleets, climate numbers, drive sides, building grammar and species mixes need local review before policy use.
11. **The Python frame renderer is the older one.** `paperdolls/render` (used by `paperdolls frames` and `build`) does not use looks, trees or the formal theme. The JavaScript scene library does. The pipeline should move to it.
12. **The OpenStreetMap ingest is not built**, including the mapping from OSM tags to archetypes and tree kinds, and the list of assumed defaults for the user to confirm.
13. **Not run in a real browser.** The pages were exercised headlessly (jsdom with node canvas): no runtime errors, controls rebuild correctly. The look was checked in rendered frames, and the SVG was checked against the painter (they differ only by antialiasing).
