# viz: isometric library: people, vehicles, buildings, trees, themes, scene, replay

Status: people, vehicles, buildings and trees are in the asset system (`assetlib.js`, `buildinglib.js`, `treelib.js`, tested), and colour is one theme system (a region, a look, a register). The scene library (`vizlib.js`: roads, network, renderer) drives the place viewer (`paperdolls viewer`, from an ingested scene) and the replay page (`paperdolls replay`, with `replay.js`); the Python pipeline builds both pages.

## Files

- `assetlib.js`: the engine, plus people and vehicles. Parametric definitions, four-heading builds, SVG and canvas output, regional fleets and outfits, data scales. No dependencies.
- `buildinglib.js`: buildings as assets (archetypes, facade grammar, roofs, overlays, regional grammar, footprint fitting). Load after `assetlib.js`.
- `treelib.js`: trees as assets (nine kinds, regional species mixes, foliage colours from the look). Load after `assetlib.js`.
- `replay.js`: plays an exported trajectory through a scene (placement, mapping, week, legend). Load after `vizlib.js`.
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

Roles: `data`, `glass`, `wheel`, `hub`, `frame`, `trim`, `light`, `paper`, `roof`, `cab`, `interior`, `bottom`, `accent`, `hat` for people, and `roofflat`, `door`, `shutter`, `awning`, `chimney`, `solar`, `scaffold`, `band`, `marker` for buildings. **`data` is the recolourable surface**: the garment on a person, the body or livery on a vehicle (the cargo box on a lorry, the pannier on a bicycle), the walls of a building. A simulation never changes shape, only the colour of `data`.

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

Six archetypes: terraced house, shophouse, apartment block, detached house, tower, shed. A building asset is built from `{ kind, W, D, N, variant, fs, ov }`: frontage width and depth in metres (quantised to 1 m and 2 m so assets are shared), storeys, a facade seed, the regional facade style, and the overlays. The front faces local +y, so it faces the camera at two of the four headings (NE and SW on screen) and you see the back at the other two. The left and right walls are the party walls.

- **Facade grammar**: each wall is a grid of modules (window, balcony window, door, shopfront, ribbon glazing, roller door, high window, blank) generated with rules: a house front has exactly one door, a shop front at least one, no run of three blank bays, balconies stack in columns, and a front never has a storey without openings. Same seed, same facade.
- **Roofs**: flat with a parapet and roof plant, gable (ridge along the frontage), hip, low-pitch shed. Chimneys on pitched roofs.
- **Data surface**: the walls (three large faces, so one recolour covers a whole facade). Roof, door, glass and trim keep their own colours.
- **Overlays** (discrete geometry a simulation switches on): `scaffold` (poles, decks, rails on every visible wall), `solar` (panels on both roof slopes or in tilted rows on a flat roof), `band` (a coloured band at the base), `marker` (a roof marker). The Great Retrofit mapping is the default style (`VizLib.retrofitStyle`): queued = band, in retrofit = scaffold, finished = solar, investor-owned = marker, with wall colour from the state. Replace it with `sim.buildingStyle = (entity, reg, pal, wall) => ({ data, overlays })`, or recolour the walls from a model output with `bindData(sim, 'buildings', scale, e => value)`; a binding wins over the style.
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

Motion is decorative by default: a random walk on the road network. A class can be given real motion:

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

All are set on `sim.opts`, read by `VizLib.renderFrame`, and baked into sprites or cached layers, so they cost build time and not per-frame time. `node viz/detail_bench.js [outdir]` writes a picture of each variant and times them.

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
