# paperdolls rework: an engine for many agent-based economic models

Status: design proposal, 2026-11-07, tracked in paperdolls#23. Nothing here is built. It rests on an audit of `paperdolls` at `4f7ff26` and `TheGreatRetrofit` at `5dc9849`, and it replaces the earlier drafts of this file. The companion document [asset-pipeline.md](2026-11-07-asset-pipeline.md) is the process for making art.

## 0. What this is

**The spec.** paperdolls should:
- (a) swap between agent-based economic models as they are developed;
- (b) give a full Control UI that can set every parameter of a model, and let people choose what the main window shows and what can be clicked and acted on;
- (c) draw up to 10,000 agents and their changes cleanly in an isometric, SimCity-style view;
- (d) carry very different models (a real-world housing model on OpenStreetMap, a medieval kingdom, a science-fiction economy) through a few clear code surfaces and an ingestion pipeline that asks only what it must.

**The people.** The economists are not expert programmers. They build models in **NetLogo** and do data work in **Python notebooks**. They will be told the conventions in section 4.4.

**The plan in one paragraph.** Economists build each model in desktop NetLogo. `paperdolls convert` turns it into a TypeScript model on `@paperdolls/agents`, a library shaped like NetLogo, and checks the conversion against desktop NetLogo. The engine runs that TypeScript model in a Web Worker and keeps the run in a **Session**. It draws the run with a **PixiJS v8** renderer, using art from a per-model **asset pack** made by a gated image-model process in the style of Pixel Singapore. A **pack** is one folder: the converted model, one `pack.yaml` for presentation, a world, data files and an asset pack reference. Notebooks feed the model data files and read its runs back. One `paperdolls check` command runs every gate.

**Design rule: deep modules, small interfaces.** There are nine modules. Each hides a lot behind a few calls, and none of them knows how another works inside. A model author sees two functions. The renderer sees one call per frame. The CLI has seven verbs.

---

## 1. Where paperdolls is today (the audit, condensed)

| Area | Today | What happens to it |
|---|---|---|
| Model contract | `pack.yaml` + JSON Schema, Python and JS validators that agree (58 cases), `PackRuntime` with `init/step/run/setParams/snapshot/restore/inspect/bindScene`, patch frames, `checkRuntime` | **Simplified.** The model interface shrinks to `describe` and `start` (section 3.1); patches, binding, inspection and snapshots move into the Session. |
| Worker, store, dashboard | `packworker.js` (streamed chunks, cancellation, an inline fallback), `packstore.js` (pub/sub, typed arrays bound to buildings), SVG charts, KPI tiles, A/B compare | **Kept, absorbed** into the Session and Shell modules. |
| Renderer | Canvas 2D, 1,600-line `vizlib.js` and asset, building, tree and terrain libraries; sprite cache, far layer, sliced repaints. Only buildings carry model data; people and vehicles are decoration (capped at 4,000 and 1,500). Assets are hand-built polygon lists for four headings; **28 to 29% of Jette's buildings fit one**, the rest are plain extrusions. | **Replaced** by the Pixi renderer. The part lists in `assetlib.js` and `buildinglib.js` (`box`, `prism`, with roles) are kept as the source for art control renders. |
| OSM ingest | Buildings, roads, trams, landuse, trees, classification, adjacency, elevation, and a report of every assumption | **Kept** as the `osm` world builder. |
| Intake | A fixed interview for the old replay format | **Replaced** by `convert`'s question ledger. |
| Shell | `packhost.js`, 720 lines of hand-written DOM | **Rewritten** as components generated from the model's description and `pack.yaml`. |

**Measured, and still driving decisions:**
- **Most of v3 can't be controlled.** It has 45 model parameters, and the pack exposes 17. Arrays (`work_hours_by_quintile`) and optional values can't be expressed in the schema.
- **Python is too slow for live sliders.** On Jette (8,105 model buildings, 22,986 households, 180 months), v3 takes **28.6 s** in CPython and **1.77 s** as the JS port. TypeScript in the browser is the only option that keeps reruns interactive and pages offline.
- **Today's renderer is fast on a GPU.** At far zoom on the RTX machine it runs at 52 to 61 fps idle and about 45 fps playing (`docs/verification/gpu-after-fixes.md` in TheGreatRetrofit).
- **The JS port is the biggest recurring cost.** v3 exists twice (≈1,100 lines of Python, 763 of JS), held together by parity tests.

---

## 2. Decisions

| # | Decision | Instead of |
|---|---|---|
| D1 | **NetLogo is where models are built; TypeScript is what runs.** Every model is converted to TypeScript on `@paperdolls/agents`. | Running NetLogo Web (Tortoise) in the page; Python rewrites; a CPython server; Pyodide. |
| D2 | **No new language.** The conversion target is a TypeScript *library* shaped like NetLogo, which economists never edit and LLM agents already know how to write. | A custom engine scripting language, which would have no training data, no editor support and no users. |
| D3 | **Notebooks do data and analysis, never the model.** They write data files the model reads (section 4.5), and read runs back from `paperdolls run`. | Converting notebooks. Notebook models have no fixed shape (no declared parameters, state, step or outputs) and use numpy and pandas, so each conversion would be a rewrite. A template for Python models exists as a second-class path (section 4.6). |
| D4 | **One runtime: the converted model in a Web Worker.** Desktop NetLogo is used only as the reference that conversions are checked against. | Five runtime tiers. |
| D5 | **The renderer is PixiJS v8** behind a small interface (section 3.6), with bitECS-style typed arrays on the page (paperdolls#1). | A bake-off with three.js. The art direction (image-model pixel art, painted sprites in atlases, palette-swap recolouring) is a 2D sprite pipeline, and three.js would lose most of its benefit. three.js stays only *offline*, inside the art tool, for control renders. |
| D6 | **Art comes from per-model asset packs**, made by the gated image-model process in [asset-pipeline.md](2026-11-07-asset-pipeline.md). **Real places** use a painted base map (product B). **Invented worlds** use sprite kits (product A). | Hand-built geometry per region. The 28% fit problem disappears, because a painted base map follows real footprints at any angle, and invented worlds are laid out on the kit's axes. |
| D7 | **A pack is one folder with one presentation file** (`pack.yaml`). The Surfaces pane (paperdolls#2) writes its `surfaces` section. | A separate `surfaces.json`, and a manifest that repeats what the model already declares. |
| D8 | **Desktop and laptop browsers only.** No phone layout or phone checks (paperdolls#16). | |
| D9 | **Determinism belongs to the converted model, not to NetLogo's random stream.** The same TypeScript model with the same seed always gives the same run. Conversions are checked to be *the same model* (procedure tests and ensembles), not to reproduce desktop runs seed for seed. | Copying how NetLogo's Java code draws random numbers inside each primitive. That behaviour is undocumented, can change between versions, and lives in GPL source. |

---

## 3. The modules

```
 desktop NetLogo ──► [4 convert] ──► model.ts on [1 agents] ─┐
 notebooks ───────────────► data/*.csv ──────────────────────┤
 OSM, generators ──► [2 world] ──► world.json ───────────────┤   one folder = a pack
 image API ──► [3 art] ──► asset pack ───────────────────────┤   pack.yaml (look, surfaces, presets)
                                                             ▼
                 ┌──────────────────────── page ───────────────────────────┐
                 │ [5 session] runs model.ts in a worker, holds the run    │
                 │      │ frame views                     ▲ actions        │
                 │      ▼                                 │                │
                 │ [6 renderer] Pixi  ◄─ look ─  [7 shell] controls, legend,│
                 │                                charts, inspector,       │
                 │                                Surfaces pane            │
                 └─────────────────────────────────────────────────────────┘
 [8 check] runs every gate on a pack           [9 cli] world · convert · art · dev · check · build · run
```

For each module: what it **hides**, and its whole **interface**.

### 3.1 `agents`: the model library (`@paperdolls/agents`)

**Hides:** typed struct-of-arrays storage for every breed and variable, slot reuse after `die`, the seeded random generator, shuffled `ask` order, the spatial index behind `inRadius` and `neighbors`, world wrapping, plots and monitors, scenario interventions applied at their tick, reading world features and data tables, and frame emission (frames are views of the typed arrays, so 10,000 agents cost a copy).

**Interface.** A converted model is a single `defineModel` call:

```ts
export default defineModel({
  params:   { rebate_rate: slider(0, 1, 0.05, 0.3), refundable: toggle(false), mode: choice(['rebate', 'direct', 'public'], 'rebate') },
  breeds:   { households: { income: 'f64', retrofitted: 'bool' }, buildings: { state: cat('none', 'partial', 'done') } },
  world:    ['buildings'],                 // world layers the model reads (section 3.2)
  data:     ['incomes'],                   // data tables it reads (section 4.5)
  setup(m)  { /* converted NetLogo setup */ },
  go(m)     { /* converted NetLogo go: one tick */ },
  plots:    { adoption: { pens: { q1: m => ..., q5: m => ... } } },
  monitors: { public_cost: m => m.globals.public_cost },
  interventions: { pilot: (m, building: number) => { /* converted pd-intervene-pilot */ } },
  stop:     m => m.ticks >= 180,
})
```

Inside `setup` and `go`, `m` gives the NetLogo vocabulary: `m.households.with(h => !h.retrofitted).ask(h => …)`, `oneOf`, `nOf`, `count`, `maxOneOf`, `here`, `inRadius`, `neighbors`, `fd`, `rt`, `setxy`, `create`, `die`, `hatch`, `sprout`, links, patches, `m.random.float()`, `normal()`, `poisson()`, `m.ticks`, `m.data('incomes')`, `m.world.buildings`. The first version has `nw` and `table` as extensions, and others only as models need them.

What it gives the engine, with no extra code from the author:

```ts
interface Model {
  describe(): Description          // params, entity kinds and fields, series, KPIs, interventions, time unit, horizon
  start(input: RunInput): Run      // RunInput = { params, scenario, world, data, seed }
}
interface Run {
  readonly frame: Frame            // the current tick; tick 0 right after start
  step(): Frame                    // advance one tick
}
```

That is the whole model contract, two functions and a run object. A **frame** is `{ t, entities: { [kind]: { [field]: TypedArray } }, series: { [name]: number[] }, events?: Event[] }`. Every entity has a stable `id`. An entity drawn on a world feature has an `anchor` field (the feature's index), a moving entity has `x` and `y`, and an entity with neither is `unplaced` (it runs, feeds series and is never drawn on its own). An entity may be marked `privacy: aggregate`: the Session then refuses per-entity inspection and per-entity mappings. v3's households need this.

Legacy packs (the toy epidemic, the Great Retrofit's hand port) run through a small adapter that wraps their `init/step` as a `Model`, until the Great Retrofit is rebuilt in NetLogo or converted.

### 3.2 `world`: one world format, several builders

**Hides:** the OSM ingest (fetch, classify, adjacency, elevation, the assumption report), grid and hex layout, graph layout, procedural maps, and export to NetLogo.

**Interface:** a `World` data type and two commands.

```ts
interface World {
  frame: { units: 'm'; extent: [number, number, number, number]; north_deg: number }
  layers: { [name: string]: Feature[] }      // buildings, parcels, roads, rivers, tiles, nodes ...
  networks: { [name: string]: Network }      // roads, rails, hyperlanes: what agents move along
  terrain?: HeightGrid
  regions?: { [name: string]: Region[] }     // districts, provinces, star systems: for aggregates and ground tint
}
interface Feature { id: string; geom: Polygon | Point | Line; attrs: Record<string, number | string | boolean> }
```

```
paperdolls world build osm --area "Jette" --elevation dtm.tif --out worlds/jette.json
paperdolls world build grid|hex|graph|procedural --spec world.yaml --out worlds/x.json
paperdolls world export --netlogo worlds/jette.json --data data/ --out paperdolls-world.nls
```

`export --netlogo` writes the include file that brings the same world and data into desktop NetLogo (section 4.3). A world also ships two helpers for models and decorative traffic: a **uniform spatial hash** for neighbour queries, and **flow fields** (or hierarchical A*) on its networks for group movement (paperdolls#1).

| Builder | Produces | Status |
|---|---|---|
| `osm` | Buildings (footprint, levels and whether assumed, class, adjacency, z), roads, landuse, trees, terrain | Exists. Output reshaped to `World`; the frame rotation step is dropped (painted maps do not need it). |
| `file` | A `World` written by hand or by another tool, or GeoJSON | Easy. |
| `grid`, `hex` | Tiles with terrain type and height | Easy. |
| `graph` | Nodes and edges, positioned only for layout | Medium. |
| `procedural` | Heightmap, coast, rivers, settlements and roads from a seed | Medium to serious, depending on ambition. |

### 3.3 `art`: asset packs

**Hides:** the whole image-model process in [asset-pipeline.md](2026-11-07-asset-pipeline.md): the API capability probe, the art bible, control renders (three.js, headless, offline), generation, post-processing, nine automatic gates, contact sheets, atlas packing and provenance.

**Interface:** `paperdolls art <step>` for the process, and one artefact, the **asset pack**: atlases plus `assets.yaml`. The renderer uses the pack's archetypes and frames, its data ramps (the palette ranges that state colours replace), its overlay sprites with attach points, its agent sheets, and for real places its painted base tiles with their id and height passes. **The `assets.yaml` format is fixed after Phase 0**, from what the renderer spike needs. A pack names its asset pack in `pack.yaml`, and the renderer loads only that one. A model with no art yet runs on the built-in **plain** pack (flat polygons and dots), so the economics can be checked before any art exists.

### 3.4 `convert`: NetLogo to a TypeScript model

**Hides:** reading the `.nlogox` file, generating declarations, translating procedures with an LLM agent, the question ledger, re-converting only what changed, and the conversion gates (which `check` runs).

**Interface:** `paperdolls convert model.nlogox --pack packs/x`. It writes `model.ts`, a draft or updated `pack.yaml`, and `convert-ledger.md`: decisions, questions for the economist, and suspected bugs. Section 4 describes how it works.

### 3.5 `session`: one run, or two

**Hides:** the Web Worker (made from inlined text, so pages stay single-file), streaming ticks in chunks, cancellation and the inline fallback (as `PackWorker` does today), turning whole frames into patches by diffing typed arrays, frame storage (keyframes every K ticks plus patches, under a memory cap), reruns when a parameter moves (debounced, one at a time), the scenario list and undo, the second run for A/B compare, binding anchors to world features, and inspection (from frame fields and world attributes).

**Interface:**

```ts
const s = await openSession(pack)            // loads model.ts, world, data; starts run A
s.params        s.set(name, value)    s.preset(id)
s.time          s.play()  s.pause()   s.seek(t)
s.select(ref)   s.selection           s.inspect(ref)          // fields at the current tick + world attrs
s.intervene({ t, name, args })        s.undo()
s.compare(paramsOrPresetOrNull)       s.shown('A' | 'B')
s.view(): FrameView                   // what the renderer and charts read: typed arrays of the tick on screen, a version number
s.on('params' | 'time' | 'frames' | 'selection' | 'error', fn)
```

Changing a parameter or an intervention **always reruns from tick 0**, so the timeline can always be scrubbed and A/B always compares two complete runs. There is no `continue` mode. Interventions are data in the scenario list, so presets, share links, undo and compare all keep working.

### 3.6 `renderer`: PixiJS v8

**Hides:** atlases and batching, `ParticleContainer` for up to 10,000 agents, radix depth sort by `x + y + z` (re-sorting only what moved), the palette-swap shader that recolours data ramps, id-masked tints over a painted base map, overlays, outline, halo and segment channels, ground tint and aggregate hatching, interpolating agents along networks between ticks, contact shadows, one full-screen post-process (grading, vignette, fog), level of detail at far zoom (simplified frames, density tiles for crowds), culling, picking, and headless snapshots for tests.

**Interface:**

```ts
const r = createRenderer(canvas, { world, assets })
r.show(view: FrameView, look: Look)     // call when the view's version changes; cheap when nothing changed
r.camera                                // pan, zoom, rotate by 90°, fit
r.pick(x, y): EntityRef | null
r.snapshot(): Promise<ImageBitmap>
```

A **Look** is the `look` section of `pack.yaml`: a list of `{ entity, field, channel, scale }`. The channels are:

| Channel | For | Effect |
|---|---|---|
| `colour` | any entity | data-ramp colour |
| `overlay` | anchored | a pack overlay sprite |
| `segments` | anchored | k of n parts |
| `outline`, `halo` | any entity | a highlight, with `lod` |
| `size`, `trail` | mobile | scale, or a fading trail |
| `width`, `flow` | link | line width, or a moving dash |
| `tint` | region aggregate or grid | ground tint |

The categorical and sequential scales are as today. The renderer never sees a model.

### 3.7 `shell`: the page

**Hides:** the generated controls for every parameter type (sliders, toggles, choices, arrays, tables, distributions), parameter tiers, presets, the timeline, the legend generated from the Look, charts and KPI tiles (today's SVG modules), the inspector with intervention buttons, the layer panel (switching mappings at runtime), the model catalogue (switching packs), and the **Surfaces pane**.

**Interface:** none for authors. The shell is drawn from `describe()` plus `pack.yaml`. The Surfaces pane is the only part that writes, and it writes only `pack.yaml`'s `surfaces` section.

**The Surfaces pane** (paperdolls#2) lets the economists choose what the main UI exposes, per audience (`surfaces.default`, `surfaces.policy`, ...): which parameters, mappings, charts, KPIs and interventions appear, in what order and groups, with what labels, narrower ranges or pinned values. Before saving, it checks that each choice is safe to expose, and `check` runs the same rules:

1. Every item exists in `describe()`, and a narrowed range lies inside the model's range.
2. A parameter the model marks `exposable: false` (a calibrated value, a structural constant) cannot be exposed.
3. A parameter with `active_when` (for example `means_test_max_quintile` needs `means_test`) is exposed only with its controller, or with a warning.
4. A parameter that changes which world features the model uses is exposed with a "rebuilds the map" note.
5. A hidden parameter pinned to a non-default value is listed in the banner and the share link.
6. Every preset still applies.
7. A parameter whose rerun takes longer than the budget (measured by `check`) gets a warning.
8. Nothing per-entity is exposed for a `privacy: aggregate` entity.

### 3.8 `check`: every gate, one command

**Hides:**
- the model contract (determinism, frames match `describe()`);
- conversion gates (section 4.2);
- `pack.yaml` validity (Look against fields, the Surfaces rules, presets);
- asset-pack gates (the pipeline's G0 to G9, atlases, ramps);
- a render smoke test in headless Chromium (every mapping draws, no missing value drawn as zero);
- a performance budget (step time at the model's agent count, frame time at 10,000 agents).

**Interface:** `paperdolls check packs/x`, which exits non-zero on any failure and writes `check-report.md` into the pack.

### 3.9 `cli`: seven verbs

```
paperdolls world    build | export          (3.2)
paperdolls convert  model.nlogox             (3.4)
paperdolls art      probe | bible | control | generate | post | qa | sheet | pack   (3.3)
paperdolls dev      packs/x                  live page, reloads on any change in the pack
paperdolls check    packs/x                  (3.8)
paperdolls build    packs/x --out x.html     one offline HTML file, with the plain or real asset pack inlined or beside it
paperdolls run      packs/x --preset p --seeds 50 [--sweep name=lo:hi:step] --out runs.csv   headless runs for notebooks
```

The Claude plugin (skills, commands) wraps these verbs. Nothing needs Claude to run.

### 3.10 A pack

```
packs/great-retrofit/
  pack.yaml            id, title, banner; model, world, data, assets; look; surfaces; presets
  model.ts             generated by convert (never edited by hand)
  model.nlogox         the economists' source
  convert-ledger.md    decisions, questions, suspected bugs
  data/incomes.csv     from a notebook
  check-report.md      written by check
```

```yaml
id: great-retrofit
title: The Great Retrofit
banner: "Building geometry is real (OpenStreetMap). Households and incomes are synthetic. All values are placeholders."
model: model.ts
world: ../../worlds/jette.json
assets: {pack: brussels-painted, version: 1}
data: {incomes: data/incomes.csv}
look:
  - {entity: buildings, field: state, channel: colour, scale: {type: categorical, values: {none: {colour: "#c9b8a4", label: Not retrofitted}, done: {colour: "#5f9f7a", label: Retrofitted}}}}
  - {entity: buildings, field: units_done, channel: segments, total: units}
surfaces:
  default: {params: [{group: Fiscal, items: [rebate_rate, refundable]}, {group: Delivery, items: [mode]}], charts: [adoption], kpis: [public_cost]}
presets:
  - {id: public, label: Public retrofit service, params: {mode: public}}
```

---

## 4. From NetLogo to the engine

### 4.1 `convert`, step by step

1. **Extract (a parser, no LLM).** NetLogo 7 `.nlogox` files are XML.

   | In the file | Becomes |
   |---|---|
   | Slider, switch, chooser, input box | A parameter with its type, range, step and default. A slider whose bounds are reporters is flagged for step 2. |
   | `globals`, `breed`, `turtles-own`, `<breed>-own`, `patches-own`, `links-own` | Breeds and typed variables. Types are inferred from use and confirmed in the ledger. |
   | `setup`, `go` | `setup` and `go`. A forever button's stop condition becomes `stop`. |
   | Plots and pens, with their update code | `plots`. Pen code is translated like a reporter. |
   | Monitors | `monitors`. |
   | `to pd-intervene-<name> [...]` | `interventions`. |
   | `__includes ["paperdolls-world.nls"]` | `world` and `data` declarations. The include is not translated; the library provides the same names. |
   | Info tab | The pack's description. |
   | Other procedures | One stub each, with the NetLogo source as a comment. |

2. **Translate (an LLM agent, one procedure at a time).** The agent fills each stub on `@paperdolls/agents`, following `docs/convert-guide.md`. The guide maps every supported primitive, gives the idioms, and lists what is refused. The agent may not change the model's logic, merge procedures, or fix what looks like a bug: a suspected bug goes in the ledger for the economist. A primitive the library lacks stops that procedure and is reported, never improvised.
3. **Ask (the ledger).** Only questions about meaning: which breeds to draw and as which kit archetype, how each variable looks, which parameters are policy levers (the first `surfaces.default`), which world, which asset pack, and which values are data rather than placeholders. Answers go into `pack.yaml` and the ledger.
4. **Re-convert on change.** `convert` diffs procedures, widgets and declarations against the ledger's last version, re-translates only what changed, and leaves the rest untouched.

### 4.2 Conversion gates (run by `check`, against desktop NetLogo headless)

| Gate | Test |
|---|---|
| Static | `model.ts` compiles under `strict`; every procedure, widget, plot and monitor has its counterpart; `paperdolls lint` passed on the `.nlogox`. |
| Procedures, exact | Each reporter, and each command procedure that uses no randomness, is called on the same small states in both, from `setup` at fixed seeds. Results and changed variables must match to a floating-point tolerance. |
| Procedures, random | Procedures that use randomness run with recorded draws on the TypeScript side and are checked for invariants (counts, ranges, conservation) against NetLogo. |
| Ensemble | Both run on 50 seeds *(initial)* per preset. For every plot pen at every tick, the mean and the 5th to 95th percentile band of the TypeScript runs must overlap NetLogo's within tolerance, and a two-sample test at the start, middle and end must not reject. A failure names the pen and the first diverging tick. |
| Library | `@paperdolls/agents` has its own black-box tests per primitive against desktop NetLogo, so a primitive is known-good before any model uses it. |

Desktop NetLogo runs headless through its controlling API (BehaviorSpace, or `pynetlogo`). The NetLogo version is pinned per pack, because NetLogo says scheduling and random details can change between versions.

### 4.3 The include file: same world and data in desktop NetLogo

`paperdolls world export --netlogo` writes `paperdolls-world.nls`:
- breeds for world features (`pd-buildings`, `pd-roads`, ...), with `-own` variables for what the world knows (feature id, area, storeys and whether they were assumed, class, height, and neighbours as links);
- a `pd-patch-m` constant;
- `pd-setup-world`, which sizes the world and creates the features;
- `pd-data "incomes"`, which reports a data table as a list of rows.

The economist adds the include and calls `pd-setup-world` in `setup`. They then develop on the real Jette buildings in desktop NetLogo, and the converted model stands on the same buildings in the page.

### 4.4 What the economists are told

1. Build models in NetLogo 7 (the version is pinned per project).
2. Every lever is an Interface widget. Every output you care about is a plot or a monitor.
3. Put `__includes ["paperdolls-world.nls"]` at the top and call `pd-setup-world` in `setup`. Read input data with `pd-data`, never with file primitives.
4. `setup` builds the start state, and `go` runs one tick.
5. Use NetLogo's own randomness, and never call `random-seed`.
6. Don't use `user-*` dialogs, `wait`, `display`-dependent logic, `run`/`runresult` on built strings, file I/O, or primitives and extensions outside the supported list. `paperdolls lint` names any.
7. An action a viewer can take on the map is a procedure named `pd-intervene-<name>`.
8. Do data preparation, calibration and analysis in notebooks (4.5), not in the model.

### 4.5 Notebooks

- **In:** a notebook writes CSV tables into the pack's `data/` folder (one header row, typed columns). The model reads them with `pd-data` in NetLogo and `m.data()` once converted. `check` validates them against the column types the model uses.
- **Out:** `paperdolls run` runs the converted model headless in Node for presets, seeds and sweeps, and writes one tidy CSV (`run, seed, params..., t, series, value`) for pandas.

### 4.6 Python models (second-class path)

An economist who must write the model in Python uses a template:
- one `Params` dataclass;
- `setup(params, world, data, rng)` and `step(state, rng)`;
- agents as dataclass lists;
- a seeded `rng` passed in, and no globals;
- outputs returned as a dict per tick.

`paperdolls lint model.py` enforces it, and `convert model.py` follows the same steps, with the Python reference in place of desktop NetLogo for the gates. Notebooks that do not follow the template are not converted.

---

## 5. Art

The full process is [asset-pipeline.md](2026-11-07-asset-pipeline.md). What it means for the engine:

- **Real places (product B, painted base map).** The art tool renders the world's real geometry offline (three.js, headless) as colour, height and per-feature id passes, and the image model paints it tile by tile in the style of Pixel Singapore. The renderer shows the painted tiles. It recolours each building through its id mask (a state tint at the bible's strength), puts overlay sprites on roof anchors, and hides agents behind buildings with the height pass. Footprints at any angle are no longer a problem.
- **Invented worlds (product A, sprite kits).** Archetypes are part lists. Each (archetype, variant, heading) is painted once from its control render, and states come from **palette-swapping its data ramps**, never from regenerating. Grid, hex, graph and procedural worlds place features on the kit's axes.
- **Agents.** Agents are always rendered by the engine from part lists into 8-heading sheets with a random animation phase per agent, optionally palette-matched to one approved painted reference. 10,000 agents stay consistent across headings and frames.
- **Every pack is per model** and passes `check` (G0 to G9, plus the pack gates) before use. Its output licence is checked by a person before anything is public.

---

## 6. Stress tests

- **The Great Retrofit on Jette:**
  - world `osm`, asset pack `brussels-painted` (product B);
  - buildings `anchored`, households `unplaced` with `privacy: aggregate`;
  - every parameter in `describe()`, with the front panel set in the Surfaces pane;
  - interventions such as `pd-intervene-pilot`.
- **A medieval kingdom:**
  - world `procedural` or `hex`, asset pack `medieval` (product A);
  - manors and fields `anchored`;
  - 5,000 peasants and 300 carts `mobile` on the road network, coloured by cargo and sized by load;
  - provinces as regions with a tax tint, prices as series, an intervention to raise the tithe here.
- **A science-fiction trade network:**
  - world `graph`, asset pack `scifi`;
  - planets `anchored` on nodes, 10,000 freighters `mobile` on edges;
  - routes as `link`s with flow width, system inflation as a tint.

If one of these needs something the interfaces lack, extend a module's insides first and its interface last.

---

## 7. Difficulty

These estimates are for one experienced developer with LLM help, working against the tests. They are guesses, given to rank the work.

### Easy (days each)

| Item | Why |
|---|---|
| `.nlogox` extraction (convert step 1) | It's XML, and the declared parts map one to one. |
| The model contract and the legacy adapter | Two functions and a run object. |
| Pixi basics: atlases, `ParticleContainer`, 10k sprites, culling, the camera | Standard Pixi v8. |
| Palette-swap shader for data ramps | A small fragment shader. |
| The `World` format, and `grid`/`hex`/`file` builders | Data plumbing. The OSM ingest already exists. |
| The model catalogue, `paperdolls run` and its CSV | The Session and the headless model already do the work. |

### Difficult (1 to 3 weeks each)

| Item | Why |
|---|---|
| `@paperdolls/agents` v1 | Many small primitives, each needing black-box tests against desktop NetLogo. |
| Conversion gates | Driving headless NetLogo, and making ensemble tests strict enough to catch drift without failing on noise. |
| The Session | Worker lifecycle, cancellation (today's repros r01 to r13 show how subtle it is), keyframe storage under a memory cap, A/B, the scenario list and undo. |
| The renderer's channels | Depth sort, id-masked tints, overlays, outlines and halos with `lod`, ground tint, agent interpolation along networks, picking. |
| The Shell and the Surfaces pane | Many UI states. Validity rules shared exactly with `check`. |
| The include file and the `osm` world reshape | Large generated NetLogo source (9,000 buildings), and keeping desktop and page on the same world. |
| The `graph` world builder | Layout and drawing for worlds with no geography. |

### Serious (1 to 3 months each, with real risk)

| Item | Why |
|---|---|
| **Conversion fidelity** | NetLogo's semantics are subtle: agentset order, agents created during `ask`, `of` on mixed agentsets, list copying, integer and float behaviour, wrapping. The library must match its behaviour without copying its source. Ensembles catch model-level drift only within their statistical power, so a small bias in a rare event can pass. Expect each of the first several models to find a primitive the library got slightly wrong. |
| **The image-model art pipeline** | It's new: thresholds are guesses until Phase 0, the model may drift between headings or invent detail (Pixel Singapore's painted tree crowns over clear streets), and product B needs masked inpainting from the API. Consistency across a pack and the output licence are real risks. |
| **The procedural world builder** | Maps that look intentional (rivers that run downhill, settlements on sensible sites) are a known hard generative problem. |
| **Parity before switching renderers** | Today's renderer is verified (screenshots, GPU frame rates, interaction). The Pixi renderer must meet the same checks before the Canvas 2D code goes. |
| **Economists' habits** | The conventions in 4.4 are simple, but they are a change. Lint helps; the first models will need hand-holding. |

---

## 8. Phases

| Phase | Scope | Exit criterion |
|---|---|---|
| **0. Spikes (2 weeks, in parallel)** | **(a) Renderer:** Pixi page on Jette with flat extrusions, 10,000 synthetic mobile agents, the palette-swap shader, picking. **(b) Conversion:** a minimal `@paperdolls/agents` (breeds, `ask`/`with`, patches, ticks, random), and one of the economists' NetLogo models (or a library model scaled to 10,000 turtles) converted by hand, with the ensemble gate. **(c) Art:** the API probe, one archetype through asset-pipeline steps 1 to 6, and one Jette tile of product B. | (a) 60 fps idle and 45 playing at fit and street zoom, on the RTX machine and an integrated-GPU laptop. (b) The ensemble gate passes on 50 seeds, and step time at 10,000 turtles is recorded. (c) `capabilities.yaml` is written, gates G0 to G8 pass, and a person approves the look. **Then fix the `assets.yaml` format.** |
| **1. Core** | `@paperdolls/agents` v1, the model contract, the Session, the legacy adapter, the `World` format and the `osm` reshape | The toy and Great Retrofit packs run in a Session, with frames, A/B and the scenario list, under tests |
| **2. Page** | The Pixi renderer with every channel, the Shell, the Surfaces pane, `dev` and `build` | The Great Retrofit pack on Jette, with the plain asset pack, matches the current verification suite (screenshots, interaction, desktop and tablet widths, GPU frame rates). All 45 v3 parameters are reachable, and the Surfaces pane writes a valid `surfaces.default`. |
| **3. Convert and check** | `convert` steps 1 to 4, `lint`, the include file, every gate in `check`, `run` | One of the economists' NetLogo models, unchanged except for the include line, is converted, passes `check`, and runs offline in the page on Jette. A one-procedure change re-converts only that procedure. |
| **4. Art** | The `art` tool and the first real asset pack (`brussels-painted`, product B) | The pack is made by an agent following asset-pipeline.md, with only the HUMAN steps done by people. It passes `check`, and the Great Retrofit shows on it. |
| **5. More worlds** | `grid`, `hex`, `graph` and `procedural` builders; `medieval` and `scifi` packs (product A) | The two stress tests in section 6 run as packs, each with its own asset pack. |
| **6. Retire** | Remove the Canvas 2D draw path, layer caches and far layer; keep the part lists and the OSM ingest | All packs and verification scripts run on the new modules. |

Phases 1 and 3 do not depend on the renderer and can start while spike (a) runs.

---

## 9. Open questions

1. **What NetLogo do the economists write?** Which NetLogo version, primitives and extensions do their current models use? That list sets `@paperdolls/agents`' first scope.
2. **Who accepts a conversion?** The gates report, but someone accepts tolerances and ledger questions. The economist who wrote the model, or the lab?
3. **Which image model and API?** And are its output terms acceptable for public release? The probe decides what is possible: product B needs masked inpainting.
4. **The Great Retrofit's path.** Rebuild it in NetLogo (the economists' own tool, through the normal path), or keep v3 on the legacy adapter until it is retired?

---

## 10. Where earlier input went

| Source | Where it is now |
|---|---|
| paperdolls#1: PixiJS v8 and bitECS | D5 and the renderer (3.6): atlases, `ParticleContainer`, radix depth sort, culling, LOD, cheap finishing. bitECS-style typed arrays are the `agents` storage and the Session's frame views. `SharedArrayBuffer` is not needed: frames are transferred from the worker, so there is no COOP/COEP requirement and pages work offline. Spatial hash and flow fields are in `world` (3.2). Phaser 3 and raw WebGL are rejected, as #1 argued. |
| paperdolls#2: Surfaces pane | The Shell (3.7): writes `pack.yaml`'s `surfaces`, with eight validity rules shared with `check` |
| paperdolls#16: phone layout | Not carried over (D8) |
| Asset packs per model, with a standard workflow | D6, `art` (3.3), section 5, [asset-pipeline.md](2026-11-07-asset-pipeline.md) |
| The economists use NetLogo and notebooks, and are not expert programmers | D1 to D4, section 4 |
| Pixel Singapore-style art | D6, section 5, asset-pipeline.md |
| No NetLogo Web dependency; convert to TypeScript | D1, D4, D9, 3.1, 3.4, section 4 |

Dropped from earlier drafts, for simplicity:
- Five runtime tiers, `paperdolls serve`, Pyodide, a binary WebSocket protocol, and the `netlogo-desktop` live preview. Desktop NetLogo is the economists' own preview.
- `continue` mode, `setParams`, `snapshot`/`restore`, `inspect` and `bindScene` in the model interface, and patch frames written by models.
- The three.js bake-off, and a separate `surfaces.json`.
