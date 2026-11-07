# paperdolls rework: an engine for many agent-based economic models

Status: design proposal, 2026-11-07. Nothing here is built. It is based on an audit of `paperdolls` at `4f7ff26` (main) and of `TheGreatRetrofit` at `5dc9849` (v3 model and `packs/great-retrofit`). It absorbs the open issues paperdolls#1 (PixiJS v8 and bitECS), paperdolls#2 (Surfaces pane) and paperdolls#16 (phone layout); where each landed is listed in section 12.

The spec it answers: the engine should (a) swap between agent-based economic models as they are developed; (b) expose a full Control UI that can set every parameter of a model, and let people choose what the main window shows and what they can interact with; (c) handle up to 10,000 agents and render them and their changes cleanly in an isometric, SimCity-style view; (d) handle very different kinds of models, from a real-world housing model on OpenStreetMap (the Great Retrofit v3) to a medieval kingdom or science-fiction economies, through clean code surfaces and an ingestion pipeline that asks the questions needed to get a new model running.

## 0. The short version

paperdolls already has the most important part of an engine: a **model contract**. That covers the manifest (`pack.yaml`), the runtime interface (`init/step/run/inspect/snapshot/restore`), a worker that streams patch frames, a store and a dashboard, plus validators that agree between Python and JS. Keep all of it and version it. The part that does not scale to the spec is the **world renderer**. It is a hand-tuned Canvas 2D engine where the only model entity is a building and people are decoration. Its assets are hand-built 2D isometric polygon lists for four fixed headings, and much of its code exists to work around the cost of 2D sprite caching (far layer, sliced repaints, sprite budgets).

Recommendations:

1. **Replace the world renderer with a WebGL renderer behind a `WorldRenderer` interface, and choose between PixiJS v8 and three.js with a two-week bake-off on Jette.** The default leaning is **PixiJS v8** (paperdolls#1). The asset library already paints every (asset, heading, colour set) to a canvas, so those canvases can become atlas textures and the current look carries over. three.js is the alternative if free rotation, footprints at any angle, or the frame-rate targets need it. Keep the current Canvas 2D engine as the legacy renderer until the new one reaches parity on Jette.
2. **Version the contract as Model Protocol v2.** It adds entity *kinds* (anchored, mobile, aggregate), binary struct-of-arrays frames, interventions, a full parameter schema, and a `describe()` call so the UI can be generated from the model.
3. **Python stays the economists' language.** Runtimes come in three tiers: a local CPython server (no port needed, for development), a parity-checked JS port (for fast, offline, shipped pages), and Pyodide (small models only).
4. **Ingestion becomes `paperdolls adopt`.** It reads a model's code, drafts the manifest and adapter, asks the economist only what code cannot answer, records the answers, and gates on the same contract checks that `pack check` runs today.
5. **Worlds become providers plus asset kits**: OSM (today's ingest), procedural (fantasy and sci-fi maps), grid or tile, and abstract graphs (trade networks with no geography). A kit maps archetypes to part lists, which are baked to sprite atlases (Pixi) or built as meshes (three.js), so a medieval kingdom is a new kit, not a new renderer.
6. **A Surfaces pane** (paperdolls#2) lets the economists decide what the main UI exposes. It saves `surfaces.json` and checks that each choice is safe to expose before saving.

Difficulty in one line: making either WebGL renderer *fast* is easy. Keeping the colorfigures look is easy-to-moderate with Pixi and serious with three.js. Making arbitrary economist code adoptable with an LLM in the loop is the hardest problem in this document, and it is a process problem as much as a code problem.

---

## 1. Audit: what exists

### 1.1 paperdolls today

| Area | What it is | Verdict for v2 |
|---|---|---|
| Model contract | `pack.yaml` (JSON Schema plus hand-written validators in `paperdolls/pack.py` and `viz/packvalidate.js`, 58 shared cases), `PackRuntime.create`, `checkRuntime` (determinism, frames against the manifest, snapshot/restore), patch frames, `bindScene` | **Keep, extend.** This is the engine's real asset. |
| Runtime host | `viz/packworker.js`: a Web Worker made from Blob text, frames streamed in chunks of 16, cancellation, a main-thread fallback. Frames are structured-cloned, not transferred. | Keep. Add transferables and a WebSocket transport. |
| Store | `viz/packstore.js`: params, time, selection, frames, series, pub/sub, typed arrays bound to scene buildings | Keep the API. Change frame storage (keyframes plus patches) so long or large runs fit in memory. |
| Dashboard | `packdash.js` / `packcharts.js`: SVG line, area and bar charts, KPI tiles, A/B compare with a second worker | Keep. It is independent of the renderer. |
| Shell UI | `packhost.js` (720 lines, hand DOM): param groups, presets, legend, display switches, inspector | Rewrite as components. The manifest-driven idea stays. |
| World renderer | `vizlib.js` (1,600 lines), `assetlib.js`, `buildinglib.js`, `treelib.js`, `terrainlib.js`, `camera.js`, `zoomhold.js`, `refocus.js`, `packpick.js`: Canvas 2D, painter's order, sprite cache, world-anchored layer caches, far layer, sliced repaint, terrain | **Replace.** Port the asset *definitions* and keep the look. |
| Scene ingest | `paperdolls/ingest/`: OSM to scene (buildings, roads, trams, landuse, trees), classification, adjacency, elevation, a report of every assumption | Keep as the OSM world provider. Drop the frame rotation step, which 3D does not need (see 1.3). |
| Intake | `paperdolls/intake.py` plus `assets/intake_questions.yaml`: a fixed interview for the old `render.yaml` replay | Replace with `adopt` (section 6). Reuse the YAML-question mechanism and the locked read-modify-write. |
| Tooling | `pack check/build/dev`, single-file offline HTML, jsdom and Playwright verification scripts | Keep. `build` moves onto a bundler. |

**Measured performance (from the repos):** on Jette (9,214 scene buildings), far zoom on a GPU canvas runs at 52 to 61 fps idle and about 45 fps playing (`docs/verification/gpu-after-fixes.md`). A patch of 4,000 buildings has a worst frame of 35 ms in node-canvas (`viz/README.md`). These numbers took many rounds of work: the far layer, slicing, sprite budgets, incremental patches, memory-backed canvases (paperdolls#3, #17 to #22).

### 1.2 What the engine cannot do, against the spec

| Spec item | Gap today |
|---|---|
| **(a) Swap models** | Each pack builds to its own HTML page. There is no catalogue, no runtime switching, and no way to load a pack into a running page. |
| **(b) Every parameter, plus selection** | The manifest can express only `number/integer/boolean/enum`. v3 has **45 model parameters, and the pack exposes 17.** The 28 it hides include all the behaviour (`consider_prob_base`, `neighbour_boost`, `discount_rate`), the population (`income_log_*`, `savings_*`, `tax_*`), time-use (`work_hours_by_quintile`, a 5-tuple the schema cannot express) and the scene rules (`usable_fraction`, `avg_unit_area`, ...). `rental_share_*` is `Optional[float]`, and nullables are not expressible either. Mappings are fixed in the manifest: "Only the first entity that has a wall, overlay or segments mapping is drawn". Selection can inspect but cannot *act*: there is no intervention API. |
| **(c) 10,000 agents** | The only model entity is the building. People and vehicles are decorative (capped at 4,000 and 1,500 in `createSim`), spawned on the road network from the render seed, and no channel reaches them. There is no mobile entity, no position in a frame, and no interpolation. 10k *buildings* already works. |
| **(d) Wildly different models** | Assets are real-world, region-themed (12 regions × 3 looks), and each new archetype is hand-coded 2D isometric geometry. The world is a scene of buildings, roads, landuse and trees. There is no tile or hex world, no abstract graph, no procedural map. The runtime is JS only: `pyodide` and `remote` validate with a warning and do not run. |

### 1.3 Facts that drive the decisions

- **Python is 16× slower than the JS port on the real scene.** v3 on Jette has 8,105 model buildings and 22,986 households. 180 months take **28.6 s** in CPython 3 (`.venv`) and **1.77 s** in the JS runtime (node). Both were measured on this machine for this doc. A slider that reruns the model cannot wait 28 s, so an in-browser Pyodide runtime is not viable for v3 at this scale (Pyodide is usually slower than CPython; not measured here).
- **The JS port is the largest recurring cost in the current workflow.** `runtime.js` (763 lines) mirrors `retrofit_v3` (≈1,100 lines). Parity is held by golden trajectories, fuzzing and shared PRNG vectors. That work is good, but it is repeated for every model change.
- **Only 28 to 29% of Jette's buildings fit an asset.** The rest are plain extrusions, because assets need walls on the isometric axes and the ingest rotates the whole frame to the street grid that suits the most buildings (`known-issues.md` #11). In 3D, a footprint at any angle extrudes with a facade and roof, so this constraint goes away.
- **Asset geometry is already 3D.** `assetlib.js` and `buildinglib.js` define parts as `box` and `prism` primitives in local metres (x forward, y lateral, z up) with a *role* (`data`, `roof`, `glass`, `trim`, ...), and project them per heading. They can be baked to atlas frames as they are (Pixi) or ported mechanically to mesh generators (three.js); either way the `data` role maps directly to a per-instance colour.

---

## 2. Decisions

### D0. Non-goals

- **Phones.** The engine targets desktop and laptop browsers, with tablets at most. No phone layout, touch-first controls or phone verification (paperdolls#16 is closed for this reason). `scripts/verify_jette_phone.mjs` is not carried into the new gates.

### D1. World renderer: a WebGL renderer behind an interface, picked by a bake-off

The renderer sits behind one interface, so the choice stays reversible and the rest of the engine never imports Pixi or three.js:

```ts
interface WorldRenderer {
  setWorld(world: World, kit: Kit): void
  bindChannels(layer: string, arrays: ChannelArrays, version: number): void   // the store's typed arrays, per entity kind
  setView(view: View): void;  pick(x: number, y: number): EntityRef | null
  render(dt: number): void;   snapshot(): Promise<ImageBitmap>                 // headless output and tests
}
```

**Option A: PixiJS v8 (default leaning, paperdolls#1).**

- **Art pipeline reused.** `AssetLib` already projects each part list for a heading and paints it to a canvas, keyed by (asset, heading, register, scale bucket, colour set). In Pixi, those canvases are packed into **texture atlases** (built at load, or baked at build time with free-tex-packer for kits), so a whole entity layer draws in one or two batches. As #1 says, atlas batching matters more than any other optimisation. The colorfigures and formal looks carry over unchanged at the atlas scale.
- **10,000 agents** in a `ParticleContainer` (position, frame, tint only). Ordinary `Sprite`s in a `Container` are used only for the few entities that need filters, masks or children (the selected building, a building with an event marker).
- **Data colour.** Pixi's tint multiplies the whole sprite, so a building's data colour cannot be a plain tint. Two ways: (1) split each asset into a base sprite and a *data-role* sprite (painted white, tinted per instance), which needs two particles per building and gives exact colours; or (2) keep today's approach of one atlas frame per (shape, heading, colour set), which works because states are few. Start with (2), since it is the current cache key, and measure (1) in the bake-off.
- **Depth sorting** by `x + y + z` with a bucketed (radix) sort, re-sorting only entities that moved (#1). Static buildings are sorted once per world.
- **Zoom.** Atlases at two or three scale buckets with mipmaps instead of today's per-scale sprite rebuilds. Far zoom uses LOD sprites (simplified massing) or density-tinted tiles for crowds (#1).
- **Terrain** with `@pixi/tilemap`, or terrain chunks baked into render textures. Elevation is a screen-y offset, as `proj` does today.
- **Culling** with Pixi's `Culler` for zoomed-in views of a large map.
- **Footprints at arbitrary angles** (the 28% fit problem) do not go away by themselves. They are *probably* solvable without 3D: the asset system already projects 3D parts, and tone set from the face normal (instead of the axis-aligned right/left/top classification) would let an extruded footprint at any angle carry a facade and roof in the same look. This is unproven and is one of the bake-off's questions.

**Option B: three.js (WebGL2).**

- **Orthographic camera** at the isometric angle (the current `proj` is 2:1 dimetric: 30° elevation, 45° azimuth). Four snapped headings by default and free rotation as an option. Zoom is the orthographic frustum size, so there is no sprite rebuild per zoom level.
- **Instanced meshes per (archetype, variant).** 10k buildings plus 10k agents is roughly 50 to 200 draw calls. Model channels are **per-instance attributes** (`aColour`, `aOverlayMask`, `aSegments`, `aHighlight`) in `InstancedBufferAttribute`s, written straight from the store's typed arrays. A frame change is a buffer upload. That makes the far layer, the sliced repaint and the sprite budget unnecessary.
- **Depth buffer** instead of painter's order, so terrain and elevation are no longer special cases.
- **Picking** with a GPU id pass (render instance ids to a 1×1 target under the cursor) or a BVH raycast (`three-mesh-bvh`). This replaces `packpick.js`'s lifted-footprint test.
- **Look**: a flat-band shader that sets tone from the face normal (light, mid, dark, as colorfigures does today) plus an ink-outline post-pass on depth and normal edges, and later the finishing options (grain, fog, posterize, pixel) as post-passes. `formal` is the same shader with a different palette and no ink.
**Either way:**

- **Headless output** (keyframe PNGs, tests, the tour video) moves from node-canvas to headless Chromium, which the repos already drive (`scripts/*.mjs`, Playwright).
- **Cheap finishing** (#1): a soft contact shadow under every entity, as one batch of blurred ellipses (or baked into the atlas); 4 or 8 facings for agent sprite sheets with a random animation phase per agent, so crowds do not move in lockstep; one full-screen post-process (colour grading, vignette, slight bloom, fog) on the whole stage, never per sprite.

**How the bake-off decides** (Phase 0, section 10): build the same Jette page in both, on the same store and protocol, and compare:

| Criterion | Weight |
|---|---|
| Look next to the current renderer at fit, mid and street zoom (an art-direction call by the lab) | highest |
| Frame time: 9,214 buildings + 10,000 moving agents, idle and playing, on the RTX machine and an integrated-GPU laptop | high |
| Share of Jette buildings with a facade and roof (today 28%) | medium |
| Effort to add one new kit archetype (a medieval manor) | medium |
| Bundle size inside a single offline HTML file | low |

| | PixiJS v8 | three.js |
|---|---|---|
| Keeps the current look | Yes, at atlas scales | Must be rebuilt in shaders (serious) |
| 10k agents | `ParticleContainer`, 1 to 2 batches | Instancing |
| Data colour per building | Atlas frame per colour set, or a tinted data-role sprite | Per-instance attribute |
| Depth | Radix sort by `x + y + z` | Depth buffer |
| Footprints at any angle | Unproven (normal-based tones) | Yes |
| Rotation | 4 headings (8 with sheets) | Free |
| New-world kits | Part lists baked to atlases, or hand-drawn sheets | Meshes, procedural or glTF |

**Rejected:**
- *Phaser 3.* An all-in-one choice, but slower than Pixi at this entity count, and a whole other architecture to learn (#1).
- *Raw WebGL2 or WebGPU instancing.* The most headroom (100k+ entities, GPU-driven animation), and a lot of work. At that point three.js does it with less code (#1).
- *deck.gl.* Excellent for 10k+ geospatial points, but not a SimCity picture.
- *Babylon.js.* Comparable to three.js, with a heavier runtime. If the bake-off goes 3D, three.js has the larger ecosystem, and LLMs know it best, which matters for LLM-written kits.
- *Keep Canvas 2D and add mobile agents.* Possible for Jette, but each new world type would need more of the cache engineering that took paperdolls#3 to #22.

### D2. Keep the pack contract, version it as Model Protocol v2

The manifest, store, worker and `checkRuntime` stay. v2 is **additive**: a `spec: 1` pack keeps working through an adapter. Section 3 has the details.

### D3. Python is the source of truth. Runtimes come in tiers

| Runtime | Use | Cost |
|---|---|---|
| `python` (local CPython over WebSocket, `paperdolls serve`) | **Development and research.** The economist's code runs unmodified behind a generated adapter, and frames stream as they come, so the timeline fills while the model runs. | Not offline, and as slow as the model (28.6 s for v3 on Jette; with streaming, the first months show in under a second). |
| `js` (port) | **Shipped and policy pages**: offline, single-file, slider reruns in about 2 s. | A port, parity-checked against the Python reference (as now), with the LLM producing the port and the harness gating it. |
| `pyodide` | Small models (≈1k agents or vectorised numpy) that should ship offline without a port. | Load time (≈10 MB) and speed. |

All three speak the same protocol (section 3.1), so the page does not know which one it is talking to. That is the same property `PackWorker` has today across worker and inline modes.

### D4. Worlds are providers. Looks are kits

A **world** is terrain + features + networks + regions, the generalisation of today's scene JSON. A **kit** maps archetype names to part-list generators, materials and palettes; the renderer turns part lists into atlas frames (Pixi) or meshes (three.js). Today's 12 regions × 3 looks become the `earth` kit. Medieval and sci-fi are new kits written against the same primitive library (`box`, `prism`, `lathe`, `extrudeFootprint`, `roof(type)`, `facade(grammar)`). Section 5.

### D5. TypeScript, Vite, and a small component framework for the shell

The contracts are the product, and generated packs are written by LLMs, so typed interfaces (`ModelProtocol`, `Frame`, `Manifest`) catch whole classes of error at build time. Vite with `vite-plugin-singlefile` keeps the single offline HTML that `pack build` produces now. For the shell, use **Preact with signals** (about 4 KB, easy to inline). The store's pub/sub maps onto signals directly. Keep the Python CLI. It shells out to the JS build.

**State on the page: bitECS** (#1). Host-side entity state (bound channel arrays, positions, interpolation targets, selection and highlight flags) lives in bitECS components, which are struct-of-arrays typed arrays. That is the same layout as protocol v2 frames (section 3.3), so a frame is applied by copying or swapping arrays, and the renderer reads components directly. The model's own state stays in the model runtime, in whatever language the model is written in. bitECS is for the page, not a requirement on models.

**Threads.** The model already runs in a Web Worker (`PackWorker`), so the main thread only renders. Frames cross as **transferred** typed arrays, which costs no copy and needs no special headers. `SharedArrayBuffer` (the worker writing positions that the renderer reads in place) needs cross-origin isolation (COOP/COEP headers). GitHub Pages cannot set those, and a single offline HTML file opened from disk is not isolated, so SAB is an optional fast path for pages served from Cloudflare Pages, Netlify or `paperdolls serve`, never a requirement (#1). Expensive per-agent work that the *page* does (decorative traffic paths) is staggered across frames.

### D6. Ingestion is a pipeline with gates, not an interview

`paperdolls adopt <model>` runs static extraction, then drafts files, then asks only what code cannot answer, then generates code, then runs gates. Every answer goes into a ledger (`adopt.yaml`) that a person can review. An LLM drives the drafting and porting. The gates (schema, determinism, parity, render smoke test) decide what passes. Section 6.

---

## 3. Model Protocol v2

### 3.1 Calls

One interface, served in-process, by a worker, or over WebSocket:

```ts
interface ModelRuntime {
  describe(): ModelDescription                   // params schema, entity kinds and fields, series, events, time; may be generated from code
  bindWorld?(world: World): Binding              // today's bindScene, generalised: entities made FROM the world, deterministic, no params
  init(params, binding, seed): Handle
  step(h, n): Frame[]                            // n = 0: current frame
  run?(h, toT, onChunk): void                    // streamed
  setParams?(h, params): Handle                  // on_params: continue
  apply?(h, intervention): Handle                // NEW: a user action at time t (see 3.4)
  inspect?(h, ref, t): Detail
  snapshot?(h): State;  restore?(h, s): Handle
}
```

`describe()` is new and optional. When it exists (or `adopt` generates it), the manifest needs to hold only presentation (groups, presets, mappings, layout). Every parameter appears in the UI without anyone writing YAML for it.

### 3.2 Entity kinds

| Kind | Has | Examples |
|---|---|---|
| `anchored` | an index into a world feature layer (`buildings`, `parcels`, `tiles`, `nodes`) | v3 buildings, farms, castles, planets |
| `mobile` | `x, y[, z]` (or `edge, s` on a network) and an optional `heading` per frame; may be `inside` an anchored entity | households moving, caravans, armies, freighters |
| `aggregate` | a world region id (district, province, star system) | district-level tax take, a kingdom's treasury |
| `link` | `from, to` entity refs with flows | trade routes, credit links, condo vote edges |
| `unplaced` | nothing to draw. It runs, it is inspectable, it feeds series and aggregates | v3 households (block-level only, by design) |

A pack may draw **every** kind at once, which lifts the "first entity only" rule. v3 households stay `unplaced`: the frame schema rule "block-level only, never household detail" is a privacy rule, and the engine must be able to honour it. The manifest can mark an entity `privacy: aggregate_only`, and the inspector then refuses per-row detail.

### 3.3 Frames

A frame is struct-of-arrays, keyed by entity then field: `Int8/Int16/Int32/Float32` (positions are `Float32Array(2n)`). Arrays are **transferred**, not cloned, from worker or socket. Over WebSocket the frame is a small binary format (a header plus typed-array blobs). Arrow IPC is the off-the-shelf alternative if models are expected to come from R or Julia later. Patch frames stay as they are (`idx`/`val`). New pieces:

- `events`: sparse, typed (`{type: 'vote_passed', entity: ['building', 812], t}`), drawn as transient markers and listed in a log. They replace the need to diff states to show *that something happened*.
- `spawn` / `despawn` for mobile entities (`count` may change by step). The store keeps a stable id → slot map.
- Mobile positions are interpolated between steps in the renderer (linear, or along the network edge), so 10k agents move smoothly at 60 fps while the model steps at 6 to 72 steps a second.

### 3.4 Interventions (selecting *and* acting)

A click can do more than inspect: "make this building a public-service pilot", "raise taxes in this province", "blockade this route". To keep determinism and A/B compare, an intervention is **data**, not a side effect: `{t, target, action, args}`. Interventions are appended to a `scenario` list that is part of the parameters. `rerun` mode replays them; `continue` mode calls `apply`. Undo, presets, share links and A/B all keep working, because the scenario is in the params. The manifest declares the actions (`interventions: {pilot: {entity: building, args: {...}, label}}`) and the inspector shows them as buttons.

### 3.5 Manifest v2 additions (all optional)

- `params`: types `array` (fixed-length, item schema: `work_hours_by_quintile`), `nullable`, `object` (nested: `scene_rules`), `distribution` (`lognormal{mu, sd}` drawn as one control with a preview curve), `seed`. Each param gets a `tier`: `lever` (front panel), `assumption` (the Model tab), `structural` (advanced tab, requires a rerun of `bindWorld`). Placeholder flags (`placeholder: true, source: ...`) are shown on the control. v3 marks every value a placeholder, and the UI should say so next to each control.
- `entities.<name>.kind`, `.privacy`, `.layer`.
- `mappings`: the same channels as today, plus agent channels (`colour`, `size`, `shape/archetype`, `trail`, `label`) and link channels (`width`, `flow`). Mappings become **switchable at runtime** from the layer panel, and the manifest supplies the defaults.
- `world`: `{provider: osm|procedural|grid|graph|file, kit, options}`.
- `interventions` and `events`.

### 3.6 Surfaces pane (paperdolls#2)

The model author and the economists (Joffa and Alberto for the Great Retrofit) need to decide **which parameters, mappings, charts and interventions the main UI exposes**, without editing YAML. The Surfaces pane is a UI builder inside the host app:

- It lists everything `describe()` and the manifest offer (every parameter, mapping, series, intervention, display switch) and shows what the main UI looks like as items are switched on, grouped, reordered, relabelled, given a narrower range, or pinned to a fixed value.
- It saves a **`surfaces.json`** per pack, and optionally one per audience (`surfaces.policy.json`, `surfaces.research.json`). The main UI is drawn from the surfaces file; the manifest's `layout` becomes the default surfaces file.
- **It checks validity before it saves**, and `pack check` runs the same checks so a hand-edited file cannot pass either. "Safe to expose" means:
  - *Exists and types match*: every item names something in `describe()`, and a narrowed range lies inside the model's valid range.
  - *Author locks*: the model can mark a parameter `exposable: false` with a reason (a calibrated value, a structural constant, private data), and the pane refuses to expose it.
  - *Dependencies*: a parameter that only means something when another one is set (`means_test_max_quintile` needs `means_test`) declares `active_when`. Exposing it without its controller is a warning, and the UI greys it out when inactive.
  - *Structural parameters* (`scene_rules`, anything that rebinds the world) can be exposed only with a "rebuilds the map" note, because moving them re-runs `bindWorld`.
  - *Hidden values stay visible*: a parameter pinned to a non-default value but hidden from the main UI is listed in the banner and the share link, so a hidden change can never look like the default.
  - *Presets*: every preset must still be reachable. A preset that sets a hidden parameter is allowed, and is flagged.
  - *Cost*: exposing a parameter whose rerun takes longer than a budget (measured by `pack check` on the pack's runtime) warns, so a slider is not attached to a 30-second rerun without anyone noticing.
  - *Privacy*: mappings or inspector fields on `privacy: aggregate_only` entities cannot be exposed per entity.
- The parameter `tier` from 3.5 sets the default surfaces file; the pane is where people change it.

---

## 4. Architecture

```
┌──────────────────────────── Host app (Preact, TS) ─────────────────────────────┐
│ Model catalogue ── loads pack ──► Manifest + describe() ──► generated Control UI │
│        │                                 │                   (levers / model /    │
│        │                                 ▼                   advanced / layers),  │
│        │                                                     Surfaces pane        │
│        │                         ┌──────────────┐  signals  ┌────────────────────┐ │
│        │                         │    Store     │◄────────►│ Dashboard (SVG)    │ │
│        │                         │ params, time,│          │ charts, KPIs, A/B  │ │
│        │                         │ scenario,    │          └────────────────────┘ │
│        │                         │ frames(kf+Δ),│  typed   ┌────────────────────┐ │
│        │                         │ selection    │─arrays──►│ World renderer     │ │
│        │                         └──────┬───────┘          │ Pixi | three.js    │ │
│        │                                │ protocol v2       │ kit art, picking   │ │
│        ▼                                ▼                   └─────────▲──────────┘ │
│  World provider ─── world.json ──► RuntimeHost ── worker | inline | WebSocket     │
│ (osm/proc/grid/graph)                   │                              │          │
└─────────────────────────────────────────┼──────────────────────────────┼──────────┘
                                          ▼                              │ world + kit
                         js runtime │ pyodide │ paperdolls serve (CPython model)
```

Nothing in the renderer knows about a model. Nothing in a model knows about the renderer. The store and the protocol sit between them, as they do today.

---

## 5. Worlds and kits

| Provider | Produces | Status |
|---|---|---|
| `osm` | Today's scene: buildings (footprint, levels, class, adjacency, z), roads, landuse, trees, terrain grid | Exists. Remove the frame rotation step. Keep the assumption report. |
| `file` | A world JSON written by hand or by another tool | Trivial once the schema is generalised. |
| `grid` / `hex` | Tiles with terrain type, height, and features on tiles | New. Easy. |
| `procedural` | Heightmap, coast, rivers, settlements and roads from a seed and a few knobs (for fantasy kingdoms and alien worlds) | New. Medium to serious, depending on ambition. |
| `graph` | Nodes and edges with positions only for layout (star systems, trade hubs, firms in a supply chain) | New. Medium. The renderer draws nodes as kit objects on a stylised ground. |

A **kit** is a module that exports `archetypes: {name → (params, rng) → PartList}`, materials (role → palette slot), palettes per look, and agent models. The part primitives are today's (`box`, `prism`), plus `lathe`, `extrudeFootprint` and `roof` (gable, hip, flat, mansard, dome), with a facade grammar. Kits are plain code against a small typed API, which is the form an LLM writes well, and `kit check` renders a contact sheet (the existing `library_catalogue.html`, generalised) for a person to approve.

---

**Movement and spatial queries** (#1). A world ships two helpers that models (JS ports directly, Python through a twin module with shared test vectors) and the page's decorative traffic can use:

- a **uniform spatial hash grid** for neighbour queries (who is within r of this agent). It is simpler and faster than a quadtree at these counts, and today's 25 m `buildingIndex` grid is the same idea;
- **flow fields** (one per destination class: market, port, castle), or hierarchical A* on the world network, for group movement, instead of per-agent A*. 10,000 agents heading to a few destinations read one field each.

Both are deterministic and seeded, so they stay inside the model's determinism contract when a model uses them.

## 6. Ingestion: `paperdolls adopt`

The aim: an economist hands over a model folder, and a reviewable pack comes out. The economist answers questions about meaning, never about plumbing.

### Stages

1. **Extract (static, no LLM needed for the common case).** Parse Python with `ast`: a `Params` dataclass gives names, types, defaults and the comment after each field (v3's `# PLACEHOLDER ...` comments become `help` and `placeholder: true`). Tuples become `array`, `Optional` becomes `nullable`, nested dataclasses become `object`. Also find the step function, the frame or output shape (TypedDicts like `frames.py`), the RNG use (flag `random.`/`numpy.random` without a seed), and the entities (dataclasses with per-agent state). Write a draft `describe()` and an `adopt.yaml` ledger. An LLM fills the gaps when the code is less tidy than v3.
2. **Question (the intake, generalised).** Only what code cannot tell. Each question has a reason, a proposed answer from the extraction, and a "where this goes" field:
   - *Time:* "One step is a month? The horizon is 180?"
   - *Ranges:* "`discount_rate` defaults to 0.04. What range is plausible? (Proposed 0 to 0.15.)" A range is never guessed silently.
   - *Tiers:* "Which of these 45 are policy levers for the front panel?"
   - *Entities:* "`_Unit` has 25 fields per household. Is this an agent to draw, or private (aggregate only)?" "Where does a building come from: the map, or generated?"
   - *Place:* "Is this a real place (OSM), a generated world, a grid, or a network?" "Which kit?"
   - *Meaning:* "`state` has 4 values. What should 'partial' look like?" (Proposes a categorical colour plus an overlay from the kit's vocabulary.)
   - *Claims:* "Are any values data rather than placeholders?" The answer sets the banner.
3. **Generate.** The adapter (for the `python` runtime: a thin wrapper that turns the model's frames into protocol frames, like `toPackFrame`), the manifest, `bindWorld` (like `bind.js`), and on request the **JS port** with a parity harness: shared PRNG vectors, golden trajectories, fuzz. This is the GR pack's harness turned into a template.
4. **Gate.** `pack check` as today (schema, determinism, frames against the manifest, snapshot/restore, extremes), plus parity (Python vs JS on N seeds × M presets, a tolerance per field), a render smoke test (headless Chromium: every mapping draws, no NaN shown as zero), and a perf budget (frames per second at the target agent count). Nothing ships on a red gate.
5. **Re-adopt.** When the model changes, `adopt` diffs the extraction against the ledger. It asks only about new or changed parameters and fields, and regenerates the port for the changed functions, with the gates re-run.

The economist's preconditions (published as `docs/model-author-guide.md`): seeded randomness only, through a supplied RNG; a step function; parameters in one dataclass or dict; per-agent state readable by index. v3 already meets all four, and that is why it ported cleanly.

---

## 7. How the Great Retrofit lands on it

| Today | v2 |
|---|---|
| 17 parameters in `pack.yaml` | 45 from `describe()`. 17 marked `lever`, the rest `assumption`/`structural`. `work_hours_by_quintile` as a 5-slider array, `scene_rules` as an object that rebinds the world, every control badged *placeholder*. |
| `bind.js` + `hook.js` wrapping `registerRuntime` | `bindWorld` declared directly. The hook disappears. |
| Buildings only; households invisible | Buildings `anchored`; households `unplaced, privacy: aggregate_only` (as the frame schema already requires); vote edges optionally as `link`s inside a selected condo |
| Selection inspects | Selection inspects, and offers interventions: "pilot public service here", "force the vote" (as scenario entries, so A/B shows the effect) |
| JS port maintained by hand with parity tests | The same port, regenerated by `adopt` from Python changes, gated by the same tests. `paperdolls serve` for working sessions with the economists, with no port needed |
| 28% of buildings fit an asset | three.js: ≈100% get a facade and roof from their real footprint. Pixi: depends on normal-based tones working (a bake-off question) |
| Exposed parameters chosen in YAML | Chosen in the Surfaces pane by the economists, saved as `surfaces.json`, checked by `pack check` |

Nothing in `v3/src` has to change.

## 8. Stress tests of the abstractions

- **Medieval kingdom** (peasant households, manors, markets, a tax-farming lord): world `procedural` (or `hex`), kit `medieval`. Manors and fields are `anchored`; 5k peasants and 300 carts are `mobile` on the road network, carrying goods (colour by cargo, size by load); provinces are `aggregate` (tax tint on the ground); market prices are `series`. Interventions: "raise tithe in this province".
- **Sci-fi trade network** (planets, freighters, a central bank): world `graph`, kit `scifi`. Planets are `anchored` on graph nodes; 10k freighters are `mobile` on edges; routes are `link`s with flow width; system-level inflation is an `aggregate` tint. Nothing like a building exists here, and the design does not need one.
- **Historical famine model** with a real map: world `osm` or a historical GeoJSON through `file`, kit `earth` with a period look.

If one of these needs something the protocol lacks, extend the protocol, not the renderer.

---

## 9. What's easy, what's difficult, what's serious

Estimates are for one experienced developer with LLM help, working against the tests. They are guesses, given to rank the work, not to schedule it.

### Easy (days each)

| Item | Why it's easy |
|---|---|
| 10k buildings + 10k moving agents at 60 fps | Standard in either library: `ParticleContainer` and atlases in Pixi, per-instance attributes in three.js. |
| Current asset art into Pixi atlases | `AssetLib` already paints each sprite to a canvas; pack those canvases into atlases. |
| (three.js only) footprints at any angle, terrain mesh from the existing grid | The data exists; three.js has extrude and plane geometry. |
| Exposing every v3 parameter | AST extraction of one dataclass, plus four new param types in the schema, validators (both languages) and the store. |
| Model catalogue and switcher | List packs, dispose the runtime, store and renderer layers, load the next. The protocol already isolates them. |
| Transferable frames | A change in `packworker.js`. |
| TypeScript types for the existing contract | It is documented precisely in `pack-spec.md`. |

### Difficult (1 to 3 weeks each)

| Item | Why |
|---|---|
| `paperdolls serve` (CPython over WebSocket, streaming, cancellation) | Process lifecycle, backpressure, a binary frame format, and the same cancellation semantics `PackWorker` has (paperdolls repros r01 to r13 show how subtle those are). |
| Mobile entities end to end | Spawn and despawn, stable slots, interpolation along networks, picking moving things, and painter-order issues (gone with a depth buffer, but agents inside buildings need a rule). |
| Frame storage for long or large runs | 10k agents × 20 fields × 4 B × 1,000 steps ≈ 800 MB if stored whole. It needs keyframes every K steps plus patches, re-simulation from a snapshot on scrub, and a memory cap. |
| Interventions as scenario data | Simple to state. Getting undo, presets, A/B and `continue` mode to agree takes care. |
| Generated Control UI with tiers, arrays, distributions, a layer panel and runtime-switchable mappings | A lot of UI states, each needing a test. |
| Surfaces pane with its validity checks | The UI builder is ordinary work. The checks (dependencies, author locks, hidden-value disclosure, rerun cost) need new schema fields (`exposable`, `active_when`) and must be identical in the pane and in `pack check`. |
| Pixi: depth sorting, data-colour split, atlas scale buckets and LOD at far zoom | Each is known (#1), but together they rebuild some of what the Canvas 2D caches do today, more cheaply. |
| Picking and parity with today's hover, tooltip and inspector behaviour | `packpick.js`'s footprint test carries over to Pixi; three.js needs an id pass. Many edge cases either way (DPR, resize, selection that survives reruns). |
| Spatial hash and flow-field helpers in JS and Python with shared vectors | Small algorithms; the work is keeping the two languages identical, as with the PRNG. |
| (three.js only) porting the asset library (`box`/`prism` part lists) to mesh generators with role materials | Mechanical, but there are many archetypes, and the facade grammar has to produce geometry or textures instead of 2D polygons. |
| Moving the build to Vite while keeping single-file offline output and the Python CLI | Tooling churn. Every existing test path has to keep working. |

### Serious (1 to 3 months each, with real risk)

| Item | Why |
|---|---|
| **Matching the colorfigures and formal looks in WebGL** (serious with three.js; with Pixi it drops to difficult, because the atlases are today's sprites, and the open part is footprints at any angle) | The current look is the result of months of tuning (banded tones, ink silhouettes, grain, bevels, fog, posterize). In 3D it means a custom flat-band shader, an outline post-pass that does not shimmer while zooming, and facade detail that stays legible at 0.12 px/m and at 6 px/m. This is the most likely place for v2 to look *worse* than v1 for a long time. Budget for an art-direction loop with screenshots against the current renderer. |
| **LLM-driven adoption of arbitrary economist code** | v3 is a best case: stdlib-only, a dataclass of params, seeded hash RNG, TypedDict frames, already designed for a port. Notebooks with globals, numpy RNG, Mesa models and R models will not extract cleanly. JS ports of numerical code drift in floating point (summation order, `round` semantics: v3 needed `pyRound` and `pySum`). The pipeline is only as trustworthy as its gates, so the parity and fuzz harness must be generic and strict. Expect each new model to surface a new class of problem for the first several models. |
| **The Python speed gap** | 16× on v3 means the shipped, slider-driven experience needs a port, or a vectorised model, or a server. There is no free option. Choose per model, and say in the UI when a rerun will take 30 s. |
| **Kits for non-earth worlds, and the procedural world provider** | Each kit is a small art project (archetypes, palettes, agent models) and needs a person's taste to sign off. Procedural maps that look intentional (rivers that flow downhill, settlements on sensible sites) are a known-hard generative problem. |
| **Parity between the old and new renderer on Jette before switching** | The current renderer is verified (screenshots, GPU frame rates, desktop and tablet widths). The new one has to meet the same checks before the old one can go. |

---

## 10. Phases

Each phase ends with a demo and its gate.

| Phase | Scope | Exit criterion |
|---|---|---|
| **0. Bake-off (2 weeks)** | The `WorldRenderer` interface, then two Jette pages on the same store and v3 JS runtime: **Pixi v8** (current `AssetLib` sprites in atlases, `ParticleContainer` agents, radix depth sort, one trial of normal-based tones on an off-axis footprint) and **three.js** (extruded footprints, per-instance colour, flat-band shader with outlines). Both get 10k synthetic mobile agents | 60 fps at fit and street zoom on the RTX machine and on an integrated-GPU laptop; both pages scored on the D1 criteria, with screenshots next to the current renderer, and one library chosen |
| **1. Protocol v2 + params** | TS types; `describe()`; new param types and tiers; v1 pack adapter; transferables; bitECS page state; generated Control UI; Surfaces pane and `surfaces.json` checks | The GR pack shows all 45 params; the toy pack is unchanged; validator parity across both languages |
| **2. Renderer v2 core** | Kit API, `earth` kit port, picking, inspector, legend from mappings, layer panel, terrain | Jette pack at parity with the current verification suite (screenshots, interaction, desktop and tablet widths, GPU frame rates) |
| **3. Runtimes** | `paperdolls serve`; keyframe storage; Pyodide for small models | v3 runs from unmodified Python in the page; streaming starts in under 1 s; scrubbing a 1,000-step run stays under a memory cap |
| **4. Agents + interventions** | `mobile`, `link`, `events`, the scenario list | A 10k-agent toy market (shoppers and shops on Jette roads) at 60 fps with smooth interpolation; GR "pilot here" intervention in A/B |
| **5. adopt** | Extraction, question bank, ledger, port generation, gates | Re-adopt v3 from scratch and reproduce today's pack, then adopt one model the pipeline has not seen (an economist's notebook) |
| **6. Worlds + kits** | `grid`/`hex`, `graph`, `procedural`; `medieval` and `scifi` kits | The medieval and sci-fi stress tests (section 8) run as packs |
| **7. Retire v1 renderer** | Remove `vizlib`'s draw path, layer caches and far layer (with Pixi, `AssetLib`'s part lists and sprite painting stay as the atlas source); keep the Python ingest | All packs and verification scripts on v2 |

Phase 0 is the decision point. Pixi is the default if it meets the look and frame-time criteria; three.js wins only if footprints at any angle or free rotation turn out to matter more than keeping today's art. The protocol, UI, runtime and adoption work (phases 1, 3, 4 and 5) do not depend on the renderer and can go ahead either way.

## 11. Open questions for you

1. **How important are free rotation and footprints at any angle, against keeping the current hand-inked look?** This is the main weight in the bake-off.
2. **Offline single-file pages: required for every model, or only for shipped policy pages?** That decides how hard to push on JS ports and Pyodide versus `paperdolls serve`.
3. **Who signs off a port?** Gates catch drift; someone still has to accept a tolerance. The economist, or the lab?
4. **Are R, Julia or NetLogo models in scope?** If so, the protocol should use Arrow IPC from the start, and `serve` becomes language-neutral.
5. **Is the paperdolls Claude plugin (skills, commands) still the main way in?** If yes, `adopt` should be a skill plus CLI, with the question bank in YAML as now.

## 12. Where the open issues went

| Issue | Where it landed |
|---|---|
| paperdolls#1: PixiJS v8 for rendering, with bitECS for the simulation state | D1 (Pixi v8 as the default leaning, settled by the Phase 0 bake-off: `ParticleContainer`, atlases, radix depth sort, `Culler`, tilemap terrain, LOD, cheap finishing; Phaser 3 and raw WebGL rejected for the reasons given there), D5 (bitECS for page state; threads, transferables, and why `SharedArrayBuffer` is optional, given COOP/COEP and offline pages), section 5 (spatial hash and flow fields) |
| paperdolls#2: Surfaces pane | Section 3.6, with the validity checks spelled out; Phase 1 |
| paperdolls#16: phone layout | Not carried over. Phones are a non-goal (D0) |

