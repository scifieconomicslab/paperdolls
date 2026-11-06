# Model packs

A **model pack** is a folder with a manifest (`pack.yaml`) and a runtime. The paperdolls shell reads the manifest, draws the controls and the legend,
runs the runtime when a parameter moves, and colours the buildings of the existing renderer from the runtime's frames. A manifest-only change is enough to
add a slider, a preset or a colouring.

This is the first phase (P1) of the interactive-model work. What works today, and what does not yet:

| Works (P1) | Planned |
|---|---|
| `js` runtimes; manifest, schema and validators; store; shell with parameter groups, presets, play/pause/speed/timeline, legend, display switches; `wall` and `overlay` channels; `paperdolls pack check` and `pack build` | frame patching and a worker (P2), binding to real scene buildings (P3), picking and inspector (P4), charts, KPIs, A/B (P5), new channels (P6), terrain (P7), `pyodide` and `remote` runtimes (P9), custom components (P10) |

Entities are drawn on scene buildings in a **fixed, invented order** (the same rule as `paperdolls replay`, `Replay.place`): where an entity stands carries no meaning, and
the page says so. See [`pack-architecture-findings.md`](pack-architecture-findings.md) for how this fits the renderer.

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

`count` is how many the model makes (`from: scene` is reserved for binding to scene buildings, P3; it validates with a warning). A field is a type name or `{type, ...}`:
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
- `channel: overlay` marks the building: `overlay` is `null` or one of `scaffold`, `solar`, `band`, `marker`. A sequential scale cannot be an overlay.
- A value with no entry is drawn as "no data" (walls) or unmarked (overlays), and the validator warns. A missing value (NaN, -1) is drawn as "no data", never as zero.
- `segments`, `height`, `outline`, `halo`, `insulation` and `ground` are reserved (P6): they validate with a warning and are ignored.
- The legend is made from these mappings, so it can describe only what is drawn. Every entry needs a label.

Only the first entity that has a wall or overlay mapping is drawn.

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
});
```

- `entities` is `{ building: { count: 600, fields: ['state', 'exposure'] } }`.
- A **frame** is `{ t, entities: { building: { state: Int8Array(600), exposure: Float32Array(600) } }, series: { counts: [s, e, i, r] } }`. `t` is consecutive from 0. Arrays may be plain arrays or typed arrays and must have the entity's count. A one-value series may be a bare number. Frames must not be reused or mutated afterwards.
- **Determinism**: the same `(params, seed)` always gives the same frames, and the runtime never uses `Math.random`. Drawing never draws from the model's random generator. `PackRuntime.checkRuntime(manifest, impl)` tests this, and that a restored snapshot carries on exactly as the original did.
- Errors thrown by the runtime, or a frame that does not match the manifest, are shown in the page header and do not stop the viewer.
- The runtime runs on the main thread today (the toy re-runs 160 steps of 600 entities in about 30 ms). A worker is P2.

The planned `pyodide` and `remote` runtimes will implement the same six methods.

## Store

`PackStore.create(manifest)` (viz/packstore.js) holds everything the page knows; controls write it, the runtime writes frames, the renderer and readouts read it. No component calls another.

```js
store.params() / param(name) / setParam(name, v) / setParams(obj) / resetParams() / applyPreset(id) / isPreset(id)
store.time() / setTime(t) / setPlaying(on) / setSpeed(s)          // { t, horizon, playing, speed, unit }
store.selection() / select({ entity, id } | null)                  // for the inspector (P4)
store.frames() / frame() / frameAt(t) / length() / pushFrames(frames, { replace })
store.series(name?) / latest(name)                                 // latest: the point at the current time
store.subscribe(topic, fn) -> unsubscribe                          // topics: params, time, selection, frames, series, '*'
```

Subscribers are called synchronously, in subscription order, after the state changed; one that throws does not stop the others. Setting a value that is already held is not an event.

## Shell

`viz/packhost.js` plus `viz/packhost.html` (the page template). `createController` owns the runtime: a changed parameter marks the model stale and the re-run happens once at the next flush,
however many slider events came before it; the time is kept (clamped to the new run). `mountUI` draws the manifest's layout. `bindRenderer` sets `sim.buildingStyle`, the renderer's existing extension
point, to read the store's current frame. `window.labPack` exposes `{manifest, store, controller, runtime, sim, binding}` for tests and the browser console.

## Writing a pack

1. Copy `packs/toy-epidemic/`. Change `id` in `pack.yaml` and in `registerRuntime`.
2. Declare your parameters, entities (with their fields), mappings and series; `paperdolls pack check packs/yours` tells you what is missing.
3. Make `init` and `step` return frames in the shape above. Run `PackRuntime.checkRuntime` on it (see `viz/test_pack.js`).
4. `paperdolls pack build packs/yours --out yours.html` and open the file.

## Not covered by `pack check` yet

It validates the manifest and that the runtime file exists. It does not run the runtime (determinism, frame shape, JS-versus-Python parity); the pieces exist
(`PackRuntime.checkRuntime`) and are exercised by the toy pack's tests, but need a JS engine, so the command stays a manifest check until the `pyodide`/`remote` work (P9).
