# Model packs

A **model pack** is a folder with a manifest (`pack.yaml`) and a runtime. The paperdolls shell reads the manifest, draws the controls and the legend,
runs the runtime when a parameter moves, and colours the buildings of the existing renderer from the runtime's frames. A manifest-only change is enough to
add a slider, a preset or a colouring.

This is the interactive-model work, phases P1 (the shell), P2 (live rendering) and P4 (interaction). What works today, and what does not yet:

| Works (P1) | Planned |
|---|---|
| `js` runtimes, run in a Web Worker (with a same-thread fallback); patch frames; manifest, schema and validators; store with typed arrays bound to scene buildings; shell with parameter groups, presets, play/pause/speed/timeline, legend, display switches; `wall` and `overlay` channels; hover, click selection, tooltip, inspector, Esc and arrow keys; `paperdolls pack check` and `pack build` | binding to real scene buildings (P3, **done**: see [Binding to the scene](#binding-to-the-scene-bindscene)), charts, KPIs, A/B (P5), new channels (P6), terrain (P7), `pyodide` and `remote` runtimes (P9), custom components (P10) |

A pack whose runtime has **no** `bindScene` has its entities drawn on scene buildings in a **fixed, invented order** (the same rule as `paperdolls replay`, `Replay.place`): where an entity stands carries no meaning, and
the page says so. A pack with `bindScene` makes its entities from the real scene and each stands on the building it came from (below). See [`pack-architecture-findings.md`](pack-architecture-findings.md) for how this fits the renderer.

```
packs/toy-epidemic/
  pack.yaml     the manifest (this document)
  runtime.js    registers the runtime: PaperDolls.registerRuntime('toy-epidemic', { init, step, ... })
```

```bash
paperdolls pack check packs/toy-epidemic                 # validate; exit 1 on errors
paperdolls pack build packs/toy-epidemic --out toy.html  # one self-contained page; add --scene scene.json for a real place
```

The built page is a single offline HTML file: no network, no framework, every script inlined (the same property as `viewer_built.html`).

---

## Manifest reference

The structure is in [`schemas/pack.schema.json`](../schemas/pack.schema.json) (JSON Schema, 2020-12). Rules that need two parts of the file at once are enforced by the
validators, which are the reference: [`paperdolls/pack.py`](../paperdolls/pack.py) and [`viz/packvalidate.js`](../viz/packvalidate.js). They give the same messages for the same
manifest (`tests/test_pack.py` checks 58 cases on both). Every message says where: `params.beta.default: 2 is above max 1`. Unknown keys are errors, so a typo does not pass silently.

### Top level

| Key | | |
|---|---|---|
| `spec` | optional | `1`. |
| `id` | required | Lower-case letters, digits, hyphens. The runtime registers itself under this id. |
| `title` | required | Page title. |
| `description` | optional | One paragraph for people reading the folder. |
| `runtime`, `time`, `params` | required | Below. `params` may be `{}`. |
| `presets`, `entities`, `mappings`, `series`, `layout`, `banner` | optional | Below. |

### `runtime`

```yaml
runtime: {type: js, entry: runtime.js, seed: 7, on_params: rerun}
```

| Key | |
|---|---|
| `type` | `js` runs today. `pyodide` and `remote` validate (with a warning) so a pack can be written for them, but nothing runs them yet. |
| `entry` | The file that registers the runtime. Required for `js`. It is inlined into the built page, so it must not contain `</script>`. |
| `seed` | Whole number handed to `init`. Default 1. |
| `on_params` | What a parameter change means. `rerun` (default): start again from time 0 with the new values and fill the whole timeline, so the timeline can be scrubbed. `continue`: keep the state and call `setParams`; frames are made only as the clock reaches them. |
| `options` | Free mapping for the runtime's own use (not yet passed on). |

### `time`

```yaml
time: {unit: day, steps: 160, speeds: [5, 20, 60], speed: 20}
```

`unit` names one step (the timeline reads "Day 12 of 160"). `steps` is the length of the horizon. `speeds` are the playback choices in steps per second, `speed` the one to start on.
Time 0 is the state before the first step, so a run has `steps + 1` frames.

### `params`

Each parameter becomes one control, grouped by `group` (group order is the order of first appearance).

```yaml
params:
  beta:      {type: number,  min: 0, max: 1, step: 0.01, default: 0.08, unit: share, label: Transmission per contact, group: Disease, help: "Chance that one contact passes it on."}
  contacts:  {type: integer, min: 1, max: 12, default: 5, group: Population}
  masks:     {type: boolean, default: false, group: Policy}
  lockdown:  {type: enum, values: [none, {value: partial, label: Partial}], default: none, group: Policy}
```

| `type` | Control | Needs | Values |
|---|---|---|---|
| `number` | slider with value readout | `min`, `max`, `default`; optional `step` | a number in range; snapped to `step` |
| `integer` | slider | as number | a whole number in range |
| `boolean` | checkbox | `default` | `true` / `false` |
| `enum` | select | `values` (strings, or `{value, label}`), `default` | one of the values |

Optional on all: `label` (default: the name), `unit` (shown after the label), `group` (default "General"), `help` (shown under the control and as a tooltip).
The store clamps numbers, rounds integers and refuses anything else that is illegal, changing nothing (all or nothing, so a bad preset never half-applies).

### `presets`

```yaml
presets:
  - {id: baseline, label: Baseline, params: {}}
  - {id: lockdown, label: Full lockdown, params: {lockdown: full}}
```

A preset is **complete**: parameters it does not name return to their defaults, so `params: {}` is "the defaults". Values are checked against the parameter's type and range.
A preset button shows as pressed while the parameters equal it.

### `entities`

What the model emits per frame, by entity name.

```yaml
entities:
  building:
    count: 600
    fields:
      state:    {type: category, values: [S, E, I, R]}
      exposure: number
```

`count` is how many the model makes. `from: scene` says the count comes from the runtime's `bindScene`; `count` is then only the fallback for a runtime or page without one. A field is a type name or `{type, ...}`:
`category` (needs `values`; the runtime sends the **index** into that list, -1 for no data), `number` (NaN for no data), `int`, `boolean`.

### `mappings`

How fields reach the map. The same shapes as `replay.mapping`, but categories are keyed by the **value name**, not a code.

```yaml
mappings:
  - entity: building
    field: state
    channel: wall
    scale: {type: categorical, label: Infection state, values: {S: {colour: "#a9c5a0", label: Susceptible}, I: {colour: "#c8452f", label: Infectious}}}
  - entity: building
    field: exposure
    channel: wall
    scale: {type: sequential, label: Exposure today, domain: [0, 1], colours: ["#f4e9c8", "#c8452f"]}
  - entity: building
    field: state
    channel: overlay
    scale: {type: categorical, values: {S: {overlay: null, label: Susceptible}, I: {overlay: marker, label: Infectious}}}
```

- `channel: wall` colours the building's data surface. Categorical entries need `label` and `colour` (`#rrggbb`); sequential needs `domain` `[low, high]` and at least two `colours`. Several wall mappings give a "Colour walls by" chooser.
- `channel: overlay` marks the building: `overlay` is `null` or one of `scaffold`, `solar`, `band`, `marker`, `insulation`, `community`. A sequential scale cannot be an overlay.
- A value with no entry is drawn as "no data" (walls) or unmarked (overlays), and the validator warns. A missing value (NaN, -1) is drawn as "no data", never as zero.
- `channel: overlay` also takes `insulation` and `community` (see [Visual channels](#visual-channels-p6)).
- `segments` is described under [Visual channels](#visual-channels-p6). `outline` and `halo` likewise. `height` and `ground` are reserved (P6): they validate with a warning and are ignored until their section lands.
- The legend is made from these mappings, so it can describe only what is drawn. Every entry needs a label.

Only the first entity that has a wall, overlay or segments mapping is drawn.

### Visual channels (P6)

Mappings beyond `wall` and `overlay`. All of them are drawn from the typed arrays of the frame on screen, none of them allocates per draw, and the legend lists each one from its scale.

#### `segments`: k of n units

A building's walls are divided into `n` sections and the first `k` are drawn in a second colour: "2 of 6 units retrofitted" in a block.

```yaml
entities: {building: {fields: {units: int, units_done: int}}}
mappings:
  - entity: building
    field: units_done            # k: a number or int field
    channel: segments
    total: units                 # n: the field that holds the number of units
    max: 8                       # optional, 2 to 12 (default 12): the most sections drawn
    scale: {type: segments, label: Units retrofitted, colour: "#2e9d6a", todo: "#e6e0d0"}   # todo is optional: default is a tint of the wall
```

- `n` below 2 (a single dwelling), or a missing value (NaN), draws nothing extra. More than `max` units are drawn as `max` sections with `k` scaled to match (`AssetLib.segmentsFor`); a partial block never rounds to empty or complete.
- Near (`view.scale` at least 1.4, `sim.opts.segMinScale`) the walls carry the sections: a coloured panel on every wall, under the windows and doors, so the facade stays readable and the colour of the wall that carries the wall mapping still frames it. Far, there is nothing to divide, so the wall colour is mixed toward `colour` by `0.85 * k / n`. A building drawn as a generic extrusion (a footprint that does not fit an asset) always gets the mixed colour.
- Cache: `n` and `k` are part of the asset id and `colour` and `todo` of the colour set, so a sprite is shared by every building with the same shape, `n`, `k` and colours: at most 78 sections-states per shape and heading (n = 2..12, k = 0..n), not one per building. It works with patch frames: a patch that changes `units_done` moves the version, and only the buildings whose pair changed fetch a different sprite.
- Only the first `segments` mapping of the drawn entity is used. It combines with `wall`, `overlay`, and the insulation overlay (the sections are drawn over the cladding).

#### `outline` and `halo`: highlighting a building

```yaml
mappings:
  - entity: building
    field: cannot_retrofit       # a boolean, or a category
    channel: outline             # or halo
    scale:
      type: categorical
      label: Cannot retrofit
      values:
        true:  {colour: "#c0392b", label: "Cannot: no credit access"}
        false: {colour: null,      label: Can}
```

- `outline` strokes the building's footprint, and (zoomed in) its top and edges, in the colour of its value. `halo` strokes a soft ring a little outside the footprint (two translucent strokes). A value whose `colour` is `null` (or has no entry) is not highlighted. A boolean field uses the keys `true` and `false` (or `1` and `0`); a category uses its value names. A sequential scale is an error.
- **No sprite is built or changed.** Both are drawn on the canvas above the map (the one the selection uses), so a highlight cannot multiply the sprite cache, and the far-zoom layer is not repainted for it. Per frame version the shell gathers the buildings to highlight, grouped by colour (`binding.highlights()`); a draw strokes one path per colour and kind and skips buildings off screen.
- **Selection is the same layer.** `store.selection()` is drawn as a halo and a solid outline in blue (`#1d4ed8`) under the hover outline, after the pack's own highlights, so a selected building that also "cannot retrofit" shows both.
- The legend lists each highlighted value with a bordered (outline) or glowing (halo) swatch; plain values are not listed. Several outline mappings may be given: for a building the first that has a colour wins.
- Drawn by `PackHost.bindInteraction(...).drawHighlight`, which the page already calls every frame; a page that does not create the interaction layer shows no highlights.

### `series`

```yaml
series:
  counts: {label: Buildings by state, unit: buildings, y: [S, E, I, R]}
```

A named time series: each frame carries one point per series, an array with one number per name in `y`. The store keeps the whole series; the timeline bar shows the latest point
("Buildings by state: S 539 · E 0 · I 0 · R 61"). Charts are P5.

### `layout`

```yaml
layout:
  left:   [{control: params, groups: [Disease, Population, Policy]}, {control: presets}]
  right:  [{control: legend}, {control: display}]
  bottom: [{control: timeline}]
```

Regions `left`, `right`, `bottom`; controls `params` (optionally only some `groups`), `presets`, `timeline`, `legend`, `display` (the viewer's own switches: people, vehicles, ink, pixel, fog).
Without a layout these are the defaults. `chart`, `kpis`, `table` and `inspector` are reserved (P4, P5): they validate with a warning and are not drawn. A group not listed in `params.groups` is hidden (the validator checks the names exist).

### `banner`

A sentence shown under the title: where the geometry and the data come from. The shell appends "Placement invented ..." when it draws entities on scene buildings. The validator warns when there is no banner.

---

## Runtime interface (`js`)

A runtime registers an object. `PackRuntime.create(manifest, impl)` wraps it, checks every frame against the manifest, and applies `on_params`.

```js
PaperDolls.registerRuntime('toy-epidemic', {
  init(params, entities, seed)  { /* -> handle */ },
  step(handle, n)               { /* -> frames[]  (n = 0: [the current frame], without advancing) */ },
  run(handle, toT)              { /* optional -> frames[] up to time toT */ },
  setParams(handle, params)     { /* required only for on_params: continue -> handle */ },
  snapshot(handle)              { /* optional -> plain state */ },
  restore(handle, state)        { /* optional -> handle */ },   // snapshot and restore go together
  inspect(handle, id, t)        { /* optional -> detail */ },   // what the inspector shows for one entity, asked for on demand
});
```

- `entities` is `{ building: { count: 600, fields: ['state', 'exposure'] } }`; with `bindScene`, `count` is the bound count and `attrs` is whatever `bindScene` returned for that entity (plain arrays, one value per entity).
- A **frame** is `{ t, entities: { building: { state: Int8Array(600), exposure: Float32Array(600) } }, series: { counts: [s, e, i, r] } }`. `t` is consecutive from 0. Arrays may be plain arrays or typed arrays and must have the entity's count. A one-value series may be a bare number. Frames must not be reused or mutated afterwards.
- **Determinism**: the same `(params, seed)` always gives the same frames, and the runtime never uses `Math.random`. Drawing never draws from the model's random generator. `PackRuntime.checkRuntime(manifest, impl)` tests this, and that a restored snapshot carries on exactly as the original did.
- Errors thrown by the runtime, or a frame that does not match the manifest, are shown in the page header and do not stop the viewer.
- **Patch frames.** After time 0 a frame may be a patch instead of the whole state: `{ t, patch: { building: { state: { idx: Int32Array, val: Int8Array }, exposure: { idx, val } } }, series }`, the entities that differ from the frame before it and their new values. A field with no change is left out. The adapter checks `idx` (whole numbers below the count) and `val` (legal for the field) and says where a patch is wrong; frame 0 must be whole. A patch costs what changed: the toy sends a few dozen entries a day, a model of 12,000 buildings that changes thousands sends thousands, and the store applies them without going over the rest (see Store). A runtime may send whole frames at any time.
- **`inspect(handle, id, t)`** answers the inspector. `id` is `{ entity, id }` (the shape of `store.selection()`; `id` is the entity's number in the model), `t` the time on screen. Return `{ title?, fields: [{ label, value, unit? }], note? }`, or `null`. It is asked on demand, once per selection and again when the time moves, never sent with a frame, and it may read anything the runtime remembers; the toy keeps the day each building changed state, so it is right at any day of the run. It runs where the runtime runs, so it needs no copy of the model on the page.
- **Where it runs.** The page runs the runtime in a **Web Worker** made from a Blob of text: the page keeps `packruntime.js`, `packworker.js` and the pack's runtime file as text and builds the worker from them, so the build stays one offline file. `PackWorker.create(manifest, { sources, mode })` returns the same adapter made asynchronous (`start`, `setParams`, `run(toT, onFrames)`, `step`, `inspect`, `snapshot`, `restore`, `cancel`, each a promise). `run` streams its frames in chunks of 16, so the timeline fills as the model runs and a moved slider is never waiting behind a long run; a new `start`/`setParams` cancels the run in progress and its late chunks are dropped. Frames are structured-cloned, not transferred, so a runtime that still holds an array it returned cannot lose it. When there is no `Worker` (Node, jsdom), a Blob URL is blocked, or the worker fails before it answers, the same server runs on the main thread (`mode: 'inline'`, `rt.fellBack` says why) and the requests already sent are repeated. `#worker=0` in the page's address forces the main thread. A runtime that throws, or sends a frame that does not match the manifest, reaches the page as a rejected promise and is shown in the header.

The planned `pyodide` and `remote` runtimes will implement the same six methods.

## Binding to the scene (`bindScene`)

The model's buildings and units are generated **from** the real scene, not placed on it. `bindScene(scene)` is an optional hook of the runtime; the page calls it once, with the scene object it is about to draw, before it creates the runtime.

```js
bindScene(scene) -> {
  entities:   { building: { count: 812, attrs: { area: [...], levels: [...], neighbours: [[3, 9], ...] } } },
  sceneIndex: { building: ['w1018', 'w1019', null, ...] },      // length === count
}
```

- `entities.<name>.count` replaces the manifest's `count` (set `from: scene` in the manifest). `attrs` is optional: plain arrays with one value per entity (typed arrays are not cloned into the model), handed to `init` as `entities.<name>.attrs`. Use them for what the model needs from the geometry: area, storeys, whether the storeys were assumed, neighbours as **entity** indices.
- `sceneIndex.<name>[k]` is the **id** of the scene building that entity *k* stands on, or `null` if it stands on none (a model-only entity: it runs, it is not drawn). A scene building that has no `id` (ids are optional in a scene) is addressed as `"#<index>"`; use `PackRuntime.sceneKey(building, index)` to build the key.
- Only the entity that has a `wall` or `overlay` mapping is drawn, and a scene building shows one entity of it. Everything below is a **warning**, shown in the page banner, not an error: the model runs and those entities are not drawn.
  an id the scene does not have (a stale pack against another scene); a second entity naming a building an earlier one already holds (the first wins).
- A malformed result (not an object, an entity not in the manifest, `sceneIndex` length not equal to `count`, an id that is neither a string, a number nor `null`) is an **error**, shown as "This pack could not bind to the scene: ...", and nothing is drawn. An exception thrown by `bindScene` is the same.
- It must be deterministic: the same scene gives the same result. It sees the scene only, never the model's parameters, so moving a slider never re-binds.
- `PackRuntime.bindScene(manifest, impl, scene)` is the adapter call: it validates the result and returns `{ ok, bound, error?, warnings, counts, attrs, pos }`, where `pos.<name>` is an `Int32Array` holding each entity's index in `scene.buildings` (-1 for none). A runtime without the hook gives `{ ok: true, bound: false }` and the page falls back to the invented order. `PackHost.bindRenderer({ ..., bound })` takes that result.

The reference implementation is in `packs/toy-epidemic/runtime.js`: one entity per residential building (`residential` is `residential` or `probable`; a scene without the class counts every non-shed building).

### What the scene carries per building

`paperdolls ingest` (version 0.2.0 and later) writes these optional fields on every building. Old scenes without them still validate and draw; `validateScene` checks them only when present, and a `neighbours` id that names no building is a warning.

| Field | |
|---|---|
| `area` | Footprint area, m² (outer ring; courtyards are not subtracted). |
| `centroid` | `[x, y]`, area-weighted, in the scene frame. |
| `height` | Metres: the OSM `height` tag when there is one, else `levels` × 3.1 m. |
| `levels_assumed` | `true` when the storey count was **not** read from the data: `osm.levels_source` is `type-default` or `global-default`. `tag` and `height` are `false`. |
| `residential` | `residential`, `probable` or `other`. The rule is below. |
| `neighbours` | Ids of buildings whose footprints touch, overlap or come within **1.0 m** edge to edge (`ingest/adjacency.py`, `NEIGHBOUR_M`). Symmetric, never the building itself. Terraced houses in OSM touch or sit 0.1 to 0.5 m apart, which is what the threshold is for; a street (about 5 m or more) is never crossed. Found with a 12 m spatial grid, so the cost is near-linear in the number of buildings. |

**Residential rule** (`classify.residential_class`; first match wins; the ingest report counts each outcome as an assumption and prints the shares):

1. `building` is a dwelling type (house, detached, semidetached_house, terrace, row_house, residential, apartments, bungalow, villa, cabin, dormitory, duplex, flats, townhouse, ...): `residential`.
2. `building` is a non-dwelling type (commercial, retail, office, industrial, warehouse, garage(s), school, hospital, church and other religious, hotel, parking, ...): `other`.
3. The feature carries a use tag (`shop`, `amenity`, `office`, `craft`, `industrial`, `tourism`, `healthcare`, `leisure`, `man_made`, `public_transport`, `railway`, `power`): `other`.
4. Any other named type (clubhouse, museum, brewery, ...), which is not a dwelling: `other`.
5. The archetype is `shed`, or the footprint is under 30 m²: `other` (outbuildings).
6. What is left is a generic `building=yes` (or no value) with no use tag: `probable`. **This is a guess.** In Brussels most dwellings are mapped as `building=yes`, so `probable` is the largest class; the pack decides whether to include it.

## Store

`PackStore.create(manifest)` (viz/packstore.js) holds everything the page knows; controls write it, the runtime writes frames, the renderer and readouts read it. No component calls another.

```js
store.params() / param(name) / setParam(name, v) / setParams(obj) / resetParams() / applyPreset(id) / isPreset(id)
store.time() / setTime(t) / setPlaying(on) / setSpeed(s)          // { t, horizon, playing, speed, unit }
store.selection() / select({ entity, id } | null)                  // what the inspector shows; a click on the map writes it
store.bindScene(entity, { count, index }) / bound(entity)          // typed arrays of the frame shown, indexed by scene building (below)
store.shownVersion() / invalidate()                                // a number that moves whenever the map may look different
store.frames() / frame() / frameAt(t) / length() / pushFrames(frames, { replace })
store.series(name?) / latest(name)                                 // latest: the point at the current time
store.subscribe(topic, fn) -> unsubscribe                          // topics: params, time, selection, frames, series, view, '*'
```

Subscribers are called synchronously, in subscription order, after the state changed; one that throws does not stop the others. Setting a value that is already held is not an event.

**Patches and the bound view (P2).** `pushFrames` applies a patch frame to the frame before it, so `frame()` and `frameAt(t)` always return whole frames (a field the patch did not touch is shared with the previous frame, not copied). The frame keeps its `patch`. For the renderer, `bindScene('building', { count: sceneBuildings, index })` (`index[k]` is the scene building that draws entity k) makes `bound('building')` return `{ version, fields, stats }`, where `fields.state` and `fields.exposure` are typed arrays of length `count` holding the frame on screen, `-1` / `NaN` where nothing is bound. They are updated in place, once per change, when asked: by the patch alone when time has moved one step onto a patch frame (`stats.patch`), by a gather over the bound entities otherwise (`stats.full`, e.g. a scrub or a new run). `shownVersion()` is a counter that moves when the frame on screen may differ (time moved, a run replaced the frames, or `invalidate()` after a change of colouring such as the wall chooser); frames added beyond the time shown do not move it. The shell copies it to `sim.frameVersion`.

## Shell

`viz/packhost.js` plus `viz/packhost.html` (the page template). `createController` owns the runtime: a changed parameter marks the model stale and the re-run happens once at the next flush,
however many slider events came before it; the time is kept (clamped to the new run). `mountUI` draws the manifest's layout. `bindRenderer` sets `sim.buildingStyle`, the renderer's existing extension
point, to read the store's bound arrays, and `sim.frameVersion` to follow the store. `window.labPack` exposes `{manifest, store, controller, runtime, sim, binding}` for tests and the browser console.

## Writing a pack

1. Copy `packs/toy-epidemic/`. Change `id` in `pack.yaml` and in `registerRuntime`.
2. Declare your parameters, entities (with their fields), mappings and series; `paperdolls pack check packs/yours` tells you what is missing.
3. Make `init` and `step` return frames in the shape above. Run `PackRuntime.checkRuntime` on it (see `viz/test_pack.js`).
4. `paperdolls pack build packs/yours --out yours.html` and open the file.

## Not covered by `pack check` yet

It validates the manifest and that the runtime file exists. It does not run the runtime (determinism, frame shape, JS-versus-Python parity); the pieces exist
(`PackRuntime.checkRuntime`) and are exercised by the toy pack's tests, but need a JS engine, so the command stays a manifest check until the `pyodide`/`remote` work (P9).

## Rendering a live model (P2)

- **Frame version.** A custom `sim.buildingStyle` used to switch the far-zoom layer off, because a style can change colours at any moment (`vizlib.js`). A style may now publish `sim.frameVersion`, a number it bumps whenever any building's style may have changed, and promise to return the same style for a building until it moves. The renderer then (1) keeps the far-zoom layer, keyed on the number, so it is repainted once per change and not per frame, and (2) asks a building for its style only when the number has moved, skipping the style call and the cache key string. `bindRenderer` does this; a style without `frameVersion` behaves as before. `sim.bindings` (data bindings) still switch the far layer off.
- **No allocation per draw.** `bindRenderer` reads the bound arrays, turns each value into a code (a sequential scale is read in 128 steps, so a colour is a table lookup, not a string per building) and returns one of a small table of shared `{ data, overlays }` objects. A million style reads leave no measurable garbage (tested).
- **Repaint in slices.** The far layer is repainted in slices of about 6 ms a frame while the old one stays on screen (`vizlib.js`, `LAYER_MS`), so no frame is long, but a change is on screen only when the whole layer is done. A newer patch restarts the repaint. See `viz/README.md` for the measured time and what limits it.

## Interaction (P4)

- **Picking** (`viz/packpick.js`, `Pick.create(sim)`, tested in Node): the screen point is inverted to a ground point; a building is hit when the segment from that point to that point plus `(h, h)` touches its footprint (the footprint lifted by its height: a point at height z lands where the ground point `(x - z, y - z)` does). Of several hits the one drawn last wins (greatest `fit.cx + fit.cy`, then the later in the list), which is what the painter's order shows on top; trees and people do not block a pick. A 25 m grid keeps a query to a few buildings (about 1.5 µs on 12,000). The height is the renderer's (`VizLib.entityHeight`); the ridge of a gabled sprite can rise a little above it.
- **Hover and click** (`PackHost.bindInteraction`): moving over a building shows a tooltip ("Building 12: state Infectious"); a click that is not a drag selects it (`store.select({ entity, id })`); a click on nothing clears. Only buildings that carry a model entity can be selected; the rest of the scene is picture. The selected building is outlined on a canvas above the map, the hovered one dashed.
- **Inspector**: appears in the right-hand region when something is selected. It shows the entity's fields in the frame on screen at once, then asks the runtime (`inspect`) and adds the answer (`title`, `fields`, `note`) when it comes; it asks again when the time moves. Not configurable from the manifest yet (`layout.inspector` stays reserved for the content layout).
- **Keys**: Esc clears the selection; the left and right arrows step the time back and forward one step and pause. Neither acts while a form control has the focus, so a focused slider keeps its own arrows. A and D pan and W and S zoom, as before.
