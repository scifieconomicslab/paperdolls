# Pack architecture: what the source says

Read before building the model-pack system (task P1 of the Great Retrofit interactive plan, section 5). Every answer is marked
**confirmed** (read in the code, with `file:line`), **inferred** (follows from code but not run), or **unknown**.
Paths are relative to the repo root; line numbers are for the commit this branch started from (`e7d2218`).

## Summary: where the plan holds and where it does not

| Plan assumption | Verdict |
|---|---|
| "Recolour via the existing sprite cache keyed by (archetype, heading, colour state)" | **Holds.** The key is asset id, heading, register, pixel scale and the *colour set* (`assetlib.js:337-343`). A state change costs one sprite build per distinct colour set, not per building. |
| "Frame-patch API without rebuilding the scene" | **Mostly already possible.** A building is a live entity whose `state`/`investor` are getters onto the scene record (`vizlib.js:414`), and `sim.buildingStyle` is called per building per draw (`vizlib.js:948`). What is missing is a *bulk, cheap* path: today any custom style disables the far-zoom cache (`vizlib.js:834`) and recomputes a string key per building per frame (`vizlib.js:951`). That is the P2 work. |
| "Check `vizlib.js` for any vertical offset support" | **Partly.** `proj()` takes a `z` (`vizlib.js:30`), but every building call passes `0` and the sprite is blitted at a 2D anchor (`vizlib.js:962`). There is no per-building elevation anywhere. |
| "Picking: hit-test on cached sprite bounds + footprint polygon" | **No picking exists** (no hit-test code in `vizlib.js`, `controls.js`, `viewer.html`). The data needed does exist: each building has `footprint`, `fit.cx/cy`, a known height, and a projection function. A footprint-polygon test against an inverse projection of the click is straightforward. Sprite bounds are not stored per building. |
| "Export a clean scene entity table (id, centroid, footprint, area, storeys with assumed flag, height, type, adjacency, street, elevation)" | **Mostly absent.** Scene buildings carry only `id, footprint, levels, archetype, state, investor, osm{building, levels_source}`. Centroid/area/height are computed at runtime, not exported. No adjacency, no street, no elevation. |
| "`proj` maps model coordinates to screen; model building k goes on k-th building" | **Holds as described**, and it is the thing `bindScene` replaces (`replay.js:27-37`). |
| "Replay controls hard-coded" | **Confirmed**, and they are tangled with rendering switches in one `.controls` bar (`viewer.html:36-65`). |
| "Rendering never draws from the model's random generator" | **Holds**: sim RNG is seeded from `opts.seed` (`vizlib.js:380`), the model never sees it. |
| Plan §5.5 "frame = {t, entities patch, series point}" | Fine for the adapter. One consequence for the viewer: model state must be pushed into `e.src.*` or read by a style callback; there is no other entry point (see (a)). |

Deviations adopted for P1 (all small): the store does not touch `sim` internals. The shell sets `sim.buildingStyle` (the documented extension point, `vizlib.js:443-444`) and reads frames from the store. Frame patching proper stays in P2.

---

## (a) How per-building state and colour reach the renderer, and what the sprite cache is keyed on

**Scene record to entity.** `createSim` maps each scene building to an entity
`{ src: b, id, group: 'buildings', kind, seed, fit, params, get state(){ return b.state }, get investor(){ return b.investor }, get levels(){ return b.levels } }`
(`vizlib.js:410-415`). `state` and `investor` are *live getters* onto the scene record, so writing `scene.buildings[i].state = 'finished'` changes what the next draw sees. `kind` (archetype) and `params` (bays, storeys, fit) are fixed at creation from the building's footprint, the region and a seed derived from the building id (`vizlib.js:411-413`). **Confirmed.**

**Three ways colour is decided, in priority order** (`drawBuildingEntity`, `vizlib.js:940-960`):
1. `sim.bindings` (from `bindData`, `vizlib.js:474-481`): a matching binding's `scale.colour(value(e))` becomes the wall's *data surface* colour and wins over everything (`vizlib.js:950`).
2. `sim.buildingStyle(e, reg, pal, wall)` returning `{ data: '#rrggbb' | null, overlays: ['scaffold'|'solar'|'band'|'marker'] }` (`vizlib.js:948`). If unset, the built-in `retrofitStyle` maps `e.state`/`e.investor` to the Great Retrofit's colours (`vizlib.js:445-452`).
3. Otherwise the register/look wall colour `A.wallFor(pal, e.seed)`.

**What is cached.** Per entity: `e._ck` (a string of family/look/register + wall + data colour + overlay list, `vizlib.js:951-952`); when it changes, the entity rebuilds `e._cols` (`A.buildingColours`) and fetches `e._asset` (`A.getAsset('buildings', kind, heading, A.buildingExtra(params, overlays))`, `vizlib.js:953-957`). **Confirmed.** A fast path skips even that when no style/binding is set and `(theme, state, investor)` are unchanged (`vizlib.js:945-946`).

**Sprite cache** (`AssetLib.sprites`, `assetlib.js:316`): a `Map` of painted offscreen canvases, `limit: 20000` entries and `maxPixels: 90e6`, evicted by scale distance (`assetlib.js:330-349`). **Key** (`keysFor`, `assetlib.js:337-343`):

```
asset.id | asset.heading | register.id | sb (px per metre bucket) | colourSetKey [| detail] [| ink] [| posterize]
```

`asset.id` encodes archetype, bays and overlay flags; `colourSetKey` is the sorted concatenation of every colour in the set. So the key is **(archetype/size/overlays, heading, register, scale bucket, colours)**, which matches the plan's "(archetype, heading, colour state)". A recolour is therefore one sprite build per distinct `(shape, heading, colour set)`, and 2,000 buildings of the same shape in the same state share a sprite. **Confirmed.** Sprites are built under a per-frame budget (count and milliseconds, `assetlib.js:322-324`, `vizlib.js:716-717`), so a patch that introduces many new colour sets sharpens over several frames rather than stalling one.

**Two caches that a state change must not break** (relevant to P2):
- The *ground and shadow layer* (`_ground`, `vizlib.js:770-790`) is keyed on size/theme/layers only; it does not depend on building state. Recolouring never repaints it. **Confirmed.**
- The *far layer* (`_far`, buildings and trees pre-composited when `view.scale < 1.0`) is keyed on a hash of `e.state` first characters and `e.investor` (`vizlib.js:836`). It is **switched off whenever `sim.bindings` is non-empty or `sim.buildingStyle` is set** (`vizlib.js:834`), because a style "can change colours at any moment". So the existing replay path (which sets `buildingStyle`, `replay.js:88`) draws every building individually at every zoom. For a 12k-building scene that is the cost P2 must remove: key the far layer on a *frame version counter* the store bumps, instead of disabling it. **Confirmed from code; the cost on 12k buildings is unmeasured here** (known-issues #19 gives 4.9 s for a first far frame).

**How replay feeds colour today** (`replay.js`): with a `mapping`, `Replay.create` installs `sim.buildingStyle = style` (`replay.js:88`), which looks up `weeks[r.week].vars[variable][k]` and returns `{data, overlays}` per building per draw (`replay.js:47-59`). With no mapping it writes four state codes into `e.src.state`/`e.src.investor` (`replay.js:60-67`). Only two channels exist: `wall` and `overlay` (`replay.js:44`, `spec.py:106`).

**Implication for the frame-patch API.** The minimal P2 design: the store holds `frame.entities` as typed arrays indexed by bound scene index; one `sim.buildingStyle` reads them (no allocation), and a `sim.frameVersion` counter participates in the far-layer key. P1 uses the same extension point but does not optimise it.

## (b) Is there any vertical/elevation offset in the renderer?

- `proj(view, x, y, z)` computes `sy = oy + (x + y) * k * 0.5 - z * k` (`vizlib.js:28-33`): a world height `z` in metres lifts a point on screen. **Confirmed.**
- It is used with real `z` for geometry drawn *on* a building or fountain (the window band on extruded buildings at `vizlib.js:129-131`, the fountain ring at `vizlib.js:1018`), but **buildings, trees, roads and agents are all projected with `z = 0`**: ground (`drawGroundSteps`), shadows (`vizlib.js:776-785`), building anchor (`drawBuildingSprite`, `vizlib.js:962`: `proj(view, e.fit.cx, e.fit.cy, 0)`), tree anchor (`vizlib.js:795-800`). **Confirmed.**
- Consequences: terrain would need a per-building (and per-road-vertex) `z` passed to those `proj` calls, a `z` field in the scene (absent today), and the culling bounds (`vizlib.js:776`, `798-801`) widened by the max elevation. Depth sorting uses `d = fit.cx + fit.cy` only (`vizlib.js:803`), so large elevation differences would need the sort key to account for height. Sprites are cached by shape/colour, not position, so an elevation lift does not multiply the cache. **Inferred** (no terrain code exists to test).

## (c) How could hit-testing work (screen point to building)?

- **Nothing exists today**: no pointer-to-entity code in `vizlib.js`, `controls.js` (it handles drag/wheel/keys only, `controls.js:42-130`) or `viewer.html`. `viewer.html:16` sets `pointer-events:none` on the canvases and the stage box takes input. **Confirmed (absence).**
- **Inverse projection exists in spirit**: `proj` is a linear map (`vizlib.js:30-33`) and `LabCamera` holds `{scale, ox, oy}` (`camera.js`, `cam.view()` at `viewer.html:271`), so screen -> ground (x, y at z = 0) is a closed-form 2x2 solve. **Confirmed (formula), inferred (no existing helper).**
- **Candidate algorithm** for P4 (not built in P1): (1) inverse-project the point to ground (x, y); (2) buildings are tall, so also test the point against each candidate's *projected silhouette*, not just its ground footprint: footprint polygon lifted by `heightOfEntity(e)` (`vizlib.js:767`) joined with the base polygon; (3) among hits take the one drawn last, i.e. the greatest `d = fit.cx + fit.cy` (`vizlib.js:803`), which is what the painter's order shows on top; (4) use the existing 25 m spatial grid idea (`buildingIndex`, `vizlib.js:314-330`) for speed. Sprite bounds are available via `asset` dimensions but are not stored per entity; the polygon approach avoids needing them. Pixel-accurate picking against sprite alpha is possible but unnecessary.
- **Unknown**: hit accuracy on non-asset (extruded) buildings is the same polygon approach but the extruded height path (`drawBuilding`, `vizlib.js:75-131`) was not read line by line.

## (d) What in `viewer.html` is hard-coded UI that a manifest would replace?

**Hard-coded and replaceable by a manifest/shell** (`viewer.html`):
- The replay bar: play button, week slider (`min=0 max=0`, set from data), week label "Week N of M", speed select (1/4/12 weeks per second), wall-variable select (`viewer.html:66-72`), wired at `250-253`. "Week" and the speeds are Great Retrofit wording; a manifest needs `time.unit`, `time.steps`, speeds.
- The legend renderer `drawLegend` (`viewer.html:220-231`) is already generic over `replay.legend()` sections (`ramp` / `swatches`), so it is reusable almost as is; it needs the shell's store as input rather than `replay`.
- The page note "Overlays follow the Great Retrofit mapping on invented states" appended to every scene's stats (`viewer.html:185`) and the Great Retrofit-specific "Colour data surface by: retrofit state" and "Buildings show: retrofit state" selects (`viewer.html:45-46`) with fake state generators (`applyHooks`, `viewer.html:190-212`).
- The header note (`viewer.html:34`) and the library "cards" (`79-87`) are viewer documentation, not model UI. A pack's `banner` replaces the note in pack mode.
- `retrofitStyle` itself (`vizlib.js:445`) and `spec.legend_for` / `RETROFIT_LEGEND` (`spec.py:80-87`) hard-code the four retrofit states and labels; `replay_build._state_codes` / `export.CODE` bake in `to_do/queued/in_progress/finished` (`replay_build.py:14-25`, `export.py:12`). The plan's "remove hard-coded retrofit legend" item lives here.

**Not model UI, stays in the shell as a "Display" group**: scene file/placeholder, region/look/register, drive side, traffic/people sliders, layer toggles, detail/ink/pixel/fog, zoom controls and the four zoom-effect switches (`viewer.html:37-62`). These are viewer settings, and a pack should only be able to *reorder or hide* them.

**Coupling that matters.** The page is one IIFE (`viewer.html:117-298`) with `rebuild()` (`176-188`) recreating the entire sim on most control changes (traffic, people, detail, region, drive, reseed). For packs that is acceptable for the display group but the model params must never trigger `rebuild()`; they only touch the store.

**Test hooks.** The page exposes `window.labViewer` and `window.labReplay` (`viewer.html:155`, `254`) for jsdom tests (`viz/test_replay_page.js`). The pack page follows the same pattern with `window.labPack`.

## (e) What does the scene JSON contain per building?

From `paperdolls/ingest/build.py:254-255` and the placeholder at `vizlib.js:159-203` (both pass `validateScene`, `vizlib.js:258`):

| Field | Present | Notes |
|---|---|---|
| `id` | yes | OSM feature id for ingest, `b<n>`/`c<n>` for the placeholder. Unique, enforced (`vizlib.js:272`). |
| `footprint` | yes | `[[x, y], ...]` metres, rotated local frame, rounded to 2 dp; at least 3 points; **outer ring only** (courtyards are dropped, `build.py:261`). |
| `levels` | yes | integer storeys, >= 1 (`vizlib.js:270`, capped 60 in `classify.py:47-51`). |
| `archetype` | yes | `auto` or one of the asset archetypes. |
| `state`, `investor` | yes | initial `"none"`/false; these are what replay writes into (`replay.js:62-67`). |
| `osm.building`, `osm.levels_source`, `osm.name?` | ingest only | `levels_source` in `tag`/`height`/`type-default`/`global-default` (`classify.py:43-57`). |
| **assumed flag** | **derived, not a field** | Storeys are assumed when `levels_source` is `type-default` or `global-default`; `height` is derived at M_PER_LEVEL (`classify.py:50`). The ingest report counts them (`build.py:358`), the scene has no boolean. |
| centroid | **no** (computed) | `fit.cx/fit.cy` at runtime from the convex hull (`buildinglib.js:318+`, `vizlib.js:411`). |
| area | **no** | not exported. |
| height (m) | **no** (computed) | `heightOfEntity` (`vizlib.js:767`). |
| adjacency / shared walls | **no** | none anywhere in the ingest. |
| street / address | **no** | none. |
| elevation | **no** | none (see (b)). |
| residential vs not | **partial** | only through `osm.building` and the archetype; no explicit class. |

Other scene keys: `area{name, source, osm_relation, attribution, origin{lat,lon}, rotation_deg, north_on_screen_deg, extent_m, generated, ingest_version}`, `roads[{id,class,tram,cycle,width?,pts}]`, `landuse[{id,kind,footprint}]`, `trees[[x,y,kind?,scale?]]` (`build.py:333-337`). The placeholder's `area` is just `{name, source:'synthetic', osm_relation:58258}` (`vizlib.js:252`).

**Placeholder building ids are deterministic** (seeded by `makePlaceholderScene(7)`, `viewer.html:138`), so a pack can bind to them in tests. The scene validator requires unique ids when present (`vizlib.js:272`) but ids are optional, so `bindScene` in P3 must handle missing ids.

---

## Other things found along the way

1. **Both build paths are string templating.** `build_viewer` replaces `/*__NAME__*/` markers in `viz/viewer.html` with the library sources (`viewer_build.py:11-22,37-43`). The pack page follows the same mechanism with a new `viz/packhost.html` template and extra markers (`PACKHOST`, `PACKSTORE`, `PACKDATA`), and the new `LIBS` entries are appended without disturbing `viewer.html`. **Confirmed.**
2. **`spec.py` and `render.yaml` are the Great Retrofit-era contract** (`goal: model_replay`, four state codes). Packs are a parallel path with their own `pack.yaml`; they do not touch `spec.validate`. No change to `replay` or `viewer` commands is needed. **Confirmed.**
3. **Python deps**: the repo depends only on numpy, pillow and pyyaml (`requirements.txt`). `jsonschema` is not a dependency, so the Python validator is hand-written (and checked against the same JSON Schema in tests when `jsonschema` happens to be installed).
4. **Test conventions**: JS tests are standalone node scripts that print `PASS ... / FAIL ...` and exit non-zero on failure, with pytest wrappers in `tests/test_viz_assets.py` that skip without node (`tests/test_viz_assets.py:1-60`); page tests use jsdom against a built HTML file (`viz/test_replay_page.js`). `package.json`'s `test` script lists the suites by hand. New tests follow this.
5. **Env note for whoever runs the tests**: `node_modules` lives only in the main checkout (`../../../node_modules` from this worktree). `tests/conftest.py:14-19` honours `PAPERDOLLS_NODE_MODULES`; set it (and `NODE_PATH`) in a worktree.
6. **Baseline**: 118 tests passed before any change (3 min wall).

---

## Update after P2 and P4

- **The far-layer rule changed** (`vizlib.js`, was ~line 834): a custom `sim.buildingStyle` no longer switches the far-zoom layer off if it also publishes `sim.frameVersion` (a number). The layer is then keyed on that number, and a building's style is asked for again only when the number moves (`drawBuildingEntity`, `e._fv`). A style without a version, and `sim.bindings`, behave as before. `VizLib.entityHeight(e)` is now exported (the height the renderer draws).
- **Picking now exists** (`viz/packpick.js`), built the way (c) above proposed: inverse projection, footprint lifted by height, painter's order, 25 m grid. It does not touch `vizlib.js` beyond `entityHeight`, and works on the sim's scene, so it also works for any other page that has a sim. The silhouette uses the renderer's height; a gabled sprite's ridge can stand a little above it, so a click just above a ridge can miss.
- **What the benchmark found** (`viz/README.md`, "Live model frames"): the per-frame cost of a patch is no longer the limit. At far zoom the limit is the far layer itself: it is painted in slices of `LAYER_MS` and a patch is fully on screen only when the repaint ends (the old layer stays up meanwhile, a newer patch restarts the repaint).
- **Still true**: no elevation, no per-building z; sprite cache keyed as in (a); placement of entities on scene buildings is invented until P3.
