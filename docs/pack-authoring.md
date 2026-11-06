# Writing a model pack

This is the working guide for people who write or change a pack: an economist with a model, or a developer porting one. [`pack-spec.md`](pack-spec.md) is the reference for every key and
method; this page is the loop you use while you work, with a first pack built from the toy epidemic (`packs/toy-epidemic/`).

A pack is a folder:

```
packs/mine/
  pack.yaml     what the model takes (parameters), emits (entities, series) and how that is drawn (mappings, layout)
  runtime.js    the model: registers itself under the pack's id
  bind.js       optional: bindScene, kept in its own file (loaded after runtime.js when it is there)
```

Four commands, all in `paperdolls pack ...`:

| Command | What it does |
|---|---|
| `dev PACK --scene SCENE.json [--port N]` | Serves the page on `127.0.0.1` and reloads it when you save `pack.yaml`, `runtime.js`, `bind.js` (or the scene). Validation errors appear in the page. |
| `check PACK [--scene SCENE.json]` | The manifest, then the runtime actually run: determinism, frames against the manifest. Exit code 0 or 1. |
| `check PACK --runtime-parity ref.py` | Also compares the runtime with a Python reference, case by case. |
| `build PACK --scene SCENE.json --out page.html` | One offline HTML file, no network, to send to someone. |

Run them as `paperdolls ...`, or `python3 -m paperdolls ...` from a checkout. The runtime checks need `node` (any version with the `vm` module, which is all of them since 14).

## 1. Make the folder

Copy the toy pack and start the dev loop at once, so that every later change is seen as you make it:

```bash
cp -r packs/toy-epidemic packs/mine
paperdolls pack dev packs/mine --scene path/to/scene.json
```

Open the address it prints (`http://127.0.0.1:8765/`). With no `--scene` the page draws on a synthetic placeholder town. Leave the server running in its own terminal.

In `pack.yaml` change `id: toy-epidemic` to `id: mine`, and in `runtime.js` change `PaperDolls.registerRuntime('toy-epidemic', ...)` to `'mine'`. The page now says
"The pack's runtime did not register itself as ..." until both match: that is the dev server doing its job.

## 2. The manifest: what the model takes and gives

Open `pack.yaml`. Read it top to bottom; each block is one thing the page needs to know.

**Parameters** become sliders, checkboxes and selects. Give each a `label`, a `unit`, a `group` and a `help` sentence: the page shows them, so they are the documentation your users see.

```yaml
params:
  beta: {type: number, min: 0, max: 1, step: 0.01, default: 0.08, label: Transmission per contact, group: Disease, help: "Chance that one contact passes it on."}
```

Add one, save, and the control appears. Set a `default` outside `min`/`max` and the page shows the error instead (`params.beta.default: 5 is above max 1`) and comes back when you fix it.

**Time** says what a step is (`unit: day`, `steps: 160`). A run has `steps + 1` frames: time 0 is the state before the first step.

**Entities** say what the model emits for each thing it models, per frame. For a building model:

```yaml
entities:
  building:
    from: scene       # the model makes one entity per real building; see bindScene below
    count: 600        # only the fallback when there is no scene
    fields:
      state:    {type: category, values: [S, E, I, R]}   # the runtime sends the index into this list, -1 for no data
      exposure: number                                    # NaN for no data
```

**Mappings** say how a field reaches the map: a colour for each category (`channel: wall`), or a mark on the building (`channel: overlay`). The legend is built from them, so every
value needs a `label`: `pack check` fails on a missing one and warns about a legend heading you left out. **Series** are the numbers the page shows over time (`series.counts` is
`[S, E, I, R]`, one number per name in `y`).

`paperdolls pack check packs/mine --manifest-only` is the quick manifest check. Everything it can say is worded with where it is: `mappings[2].field: entity building has no field ghost`.

## 3. The runtime: the model

`runtime.js` registers an object with `init` and `step` (more in the spec). The smallest useful shape, from the toy:

```js
PaperDolls.registerRuntime('mine', {
  init(params, entities, seed) {           // build the model's state: return a handle (any object)
    const n = entities.building.count;     // how many buildings the page (or bindScene) says there are
    return { p: params, n, t: 0, seed, state: new Int8Array(n) /* ... */ };
  },
  step(h, k) {                             // advance k steps and return the k new frames; k = 0 returns the current frame without advancing
    if (k === 0) return [frameOf(h)];
    const out = [];
    for (let i = 0; i < k; i++) { advance(h); out.push(frameOf(h)); }
    return out;
  },
});
// a frame:
// { t: 3, entities: { building: { state: Int8Array(n), exposure: Float32Array(n) } }, series: { counts: [539, 0, 0, 61] } }
```

Rules the page and `pack check` hold you to:

- **Deterministic**: the same parameters and seed give the same frames. Never `Math.random` (`check` replaces it with something that throws); draw from your own seeded generator and keep its state in the handle, as the toy's `draw(h)` does.
- **All state in the handle.** Module-level counters or caches make two runs differ.
- **Frames match the manifest**: every declared field and series in every frame, category values inside the declared list, arrays the length of the entity count.
- After time 0 a frame may be a **patch** (only what changed) instead of the whole state. The toy does this; use it when thousands of buildings stay the same each step. See the spec.
- `snapshot`/`restore` together (optional) and `inspect(handle, selection, t)` (optional, what the inspector shows for a clicked building).

If the runtime needs another file (a shared random-number generator, say), the page inlines only the entry and `bind.js`. Either keep the pieces in `runtime.js`, or name the extra files with
`--include path/to/prng.js` on `dev`, `check` and `build` (repeatable; they load before the entry).

Save, and the page reloads with your slider settings and time kept.

## 4. bindScene: make the model from the real buildings

Without it the page draws your entities on scene buildings in a fixed, invented order, and says so. With it the model is generated from the scene, and each entity stands on the building it came from.

```js
bindScene(scene) {          // the scene the page is about to draw; runs once, before init; must be deterministic
  const ids = [], area = [];
  scene.buildings.forEach((b, i) => {
    if (b.residential === 'other') return;           // not a dwelling: not modelled
    ids.push(PackRuntime.sceneKey(b, i)); area.push(b.area);
  });
  return { entities: { building: { count: ids.length, attrs: { area } } },   // attrs reach init() as entities.building.attrs
           sceneIndex: { building: ids } };                                    // entity k stands on scene building ids[k] (null: not drawn)
},
```

Put it in `runtime.js` or in `bind.js` next to it. A scene building carries `area`, `centroid`, `height`, `levels`, `levels_assumed`, `residential` (`residential`/`probable`/`other`) and `neighbours`; the list and the residential rule are in the spec. Run `paperdolls pack check packs/mine --scene jette.json`: it binds the scene, says how many entities landed on a building, and runs the model on that count.

## 5. Check

```bash
paperdolls pack check packs/mine --scene jette.json
```

```
PASS  manifest
PASS  runtime loads and registers
PASS  interface
PASS  bindScene on the scene (building: 8105 of 8105 on a scene building)
PASS  run with the default parameters (49 frames (patches after frame 0))
PASS  run with preset lockdown (49 frames (patches after frame 0))
PASS  parameter extremes stay inside the manifest
packs/mine: ok: 0 error(s), 0 warning(s)
```

It checks, in order:

1. the manifest (the same rules as the page), plus: every mapping and layout reference names a declared entity, field or series (planned channels too); legend headings; fields nothing shows;
2. the runtime loads, registers under the pack's id, and has the right methods;
3. with `--scene`, `bindScene` returns a well-formed result and the same one twice;
4. a run of the first `--steps` steps (default 48) with the defaults and with each preset, **twice**: frames must be identical, every frame must match the declared entities and series, a restored snapshot must continue as the original did;
5. each numeric parameter at its minimum and maximum, each enum value and the flipped boolean, for a few steps: ranges the model cannot take show up here.

Exit codes: `0` no errors, `1` errors (or, with `--strict`, any warning), `2` the check could not run as asked (a bad scene file, a missing reference module). Without node the manifest checks run and one warning says the runtime was not. `--json` prints the same as a document for scripts.

## 6. Parity with a Python reference

When the model exists first in Python (the Great Retrofit's `v3`), the JavaScript is a port and `pack check` can prove it agrees:

```bash
paperdolls pack check packs/great-retrofit --runtime-parity packs/great-retrofit/tools/parity_ref.py --golden packs/great-retrofit/tests/golden_pack
```

(`parity_ref.py` is the thirty-line converter the Great Retrofit repo would add around `run_simulation`; it does not exist yet. Its existing `tests/golden/` files are in v3's own frame shape, which is why the check takes its own `--golden` folder.)

Three things make that work.

**Cases**, in `tests/parity_cases.json` of the pack (or `--cases FILE`): the parameter sets to compare, in the *pack's* terms.

```json
{"cases": [
  {"name": "rebate_default_s1", "params": {"deduction_rate": 0.3}, "seed": 1, "steps": 84, "entities": {"building": {"count": 24}}},
  {"name": "passthrough_s5",    "params": {"delivery_mode": "passthrough"}, "seed": 5, "steps": 84, "entities": {"building": {"count": 24}}}
]}
```

`params` are overrides of the manifest defaults, `seed` goes to `init`, `steps` is how far to run, `entities.<name>.count` is how many entities (a case never uses a scene, so it is the same on every machine). Extra keys are passed to the reference untouched: put Python-only settings there.

**The reference module** (`--runtime-parity ref.py` or a dotted module name) defines either

- `pack_frames(case) -> frames`, or
- `run_simulation(case)` and `to_pack_frames(result)` (the first is your model's own entry point, the second a small converter).

The frames are the runtime's frame shape: `{t, entities: {building: {state: [...], ...}}, series: {...}}`. To make a converter easy, two looser forms are accepted: rows, as the v3 frames
have them (`{"t": 3, "buildings": [{"id": "b0", "state": "retrofitted", ...}], "series": {...}}`, columns are taken from the manifest's field names), and category values as **names** (turned into the index into the
field's `values`). `None` in a number field means NaN. A series point may be one bare number. Series the manifest does not declare are ignored.

**Golden trajectories** (`--golden DIR`), optional: one `NAME.json` per case holding `{"frames": [...]}` as the reference produced it. When the file is missing it is written (with a warning); when it
exists, the reference must still reproduce it ("regenerate with `--update-golden` if the model changed on purpose") and the JS runtime is compared with the *committed* file. That is the Great Retrofit's workflow:
Python writes the goldens, both languages must match them, and a change to the model forces a reviewed regeneration. Without `--golden` the reference is run live for each case.

Comparison: integers, strings, booleans and category indices must be equal; floats agree within `1e-9` relative to `max(1, |x|)` (the tolerance the Great Retrofit's `golden_lib.py` uses; engines differ in the last digit of `pow`, `log`, `exp`); NaN equals NaN. The first difference is reported with its place:
`the JS runtime differs from the reference: frame 12 entities.building.state[3]: 1 != 2`.

## 7. Build and send

```bash
paperdolls pack build packs/mine --scene jette.json --out mine.html
# wrote mine.html (4.68 MB; scene 9214 buildings, 4.32 MB)
```

The page is one file: the viewer, your manifest, your runtime and the scene, with nothing fetched from anywhere. Open it by double-click.

**Size.** The scene is embedded with no padding; coordinates are already at 1 cm. The whole commune of Jette (9,214 buildings, 1,320 roads, 8,705 trees) makes a 4.7 MB page, 4.3 MB of it the scene; a synthetic scene of 9,500 buildings is in the same range. The limit is `--max-mb` (default 16). Only when a page would exceed it is the scene trimmed, one stage at a time until it fits, and each stage is printed:

| Stage | What is lost |
|---|---|
| `precision` | coordinates rounded to 0.1 m (from 0.01 m) |
| `centroid` | `building.centroid` (recomputable from the footprint) |
| `osm` | `building.osm` tags (building type, levels source) |
| `height` | `building.height` |
| `neighbours` | `building.neighbours` |

Never trimmed: `id`, `footprint`, `levels`, `archetype`, `state`, `investor` (what the renderer draws) and `area`, `residential`, `levels_assumed` (what binding rules use). If a pack reads a field in the table, name its stage out of the budget's way by using a smaller scene (`paperdolls ingest --bbox ...`); `--trim centroid,osm` applies stages regardless of size. A page that is still too big after every stage is refused with the numbers.

## Not built yet

`runtime.type: pyodide` (the Python model run in the browser) and `remote` (a model behind an HTTP endpoint) validate, with a warning, so a pack can be written for them: both are designed for in the runtime adapter, which is the same six methods (`init`, `step`, `run`, `setParams`, `snapshot`/`restore`, `inspect`) returning the same frames.
Nothing runs them yet; the manifest check shows the warning and `pack check` says the runtime was not run. Until then a Python model reaches the browser as a JavaScript port checked with `--runtime-parity`.
