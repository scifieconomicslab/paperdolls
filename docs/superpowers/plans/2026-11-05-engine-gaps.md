# Engine gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let any agent-based model that follows a small declared mapping be replayed through time in the same engine as the place viewer, with honest legends.

**Architecture:** The exporter additionally records declared variables per building per week. A new `viz/replay.js` turns a trajectory and a mapping into building styles and a legend. `paperdolls replay` builds one HTML page: viewer, scene, embedded trajectory, scrubber.

**Tech Stack:** Python 3.10+ (numpy, pyyaml), plain JavaScript on 2D canvas, pytest, node tests.

**Spec:** `docs/superpowers/specs/2026-11-05-engine-gaps-design.md`

## Global Constraints

- Existing behaviour for the vendored Great Retrofit model must not change: its 98 existing Python tests and 50 JS tests keep passing.
- No new runtime dependencies. The built pages open offline by double-click.
- Everything invented is labelled on the picture. No retrofit wording appears on another model's picture.
- Test commands: `python -m pytest tests -q` (venv at `/tmp/pdvenv`), `node viz/test_assets.js`, `node viz/test_replay.js`.

## Review Focus

- A mapping variable the model never sets on some buildings: shown as "no data", not as zero.
- A model with more buildings than the scene has: refuse with a message that says both numbers.
- A sequential value outside its domain: clamped, not crashing.
- A trajectory with one week: the scrubber still works.
- A mapping that names an unknown channel or scale: a readable spec error.

---

### Task 1: Measure and correct the performance claims
**Files:** Modify `README.md`, `viz/README.md`; Create `viz/scale_bench.js`.
**Interfaces:** Produces: `node viz/scale_bench.js` prints settled and pan ms for a synthetic scene of N buildings.
- [ ] Write `scale_bench.js` (generates N-building scene by tiling the placeholder), run it at 12,500; record numbers.
- [ ] Replace the README sentence's numbers with measured ones and the machine/canvas they came from. Run `python -m pytest tests -q`.

### Task 2: Live OpenStreetMap run
**Files:** Modify `docs/known-issues.md`, `skills/paperdolls-visuals/SKILL.md`, `README.md`; Test `tests/test_ingest.py` if a defect is found.
- [ ] Run `paperdolls osm-fetch --bbox <small area> --out extract.json`, then `ingest`, then read the report. Record counts and warnings.
- [ ] For each defect found: write the failing test with the real shape, fix, pass. Update the "not run live" statements to what was observed.

### Task 3: Drop retrofit extras for other models
**Files:** Modify `paperdolls/spec.py`, `paperdolls/render/block.py`, `paperdolls/cli.py`, `paperdolls/render/html.py`; Test `tests/test_cli.py`.
**Interfaces:** Produces: `spec.retrofit_extras(data) -> bool` (True only for the vendored model); `Renderer.frame(..., extras=True)`.
- [ ] Failing test: `retrofit_extras` is False for a spec with `model.path`, and a frame for it calls no `_van`. Run: FAIL.
- [ ] Implement; pass; full suite.

### Task 4: Variable mapping contract
**Files:** Modify `paperdolls/spec.py`, `paperdolls/export.py`; Create `docs/replay-mapping.md`; Test `tests/test_pipeline.py`.
**Interfaces:** Produces: `spec.mapping_for(data) -> list[dict]` (default: the four retrofit states plus investor marker); `export.run_and_export(params, out, model_path, variables=())` stores `var_<name>` float32 arrays with NaN for missing; `export.load(...)["vars"]`.
- [ ] Failing tests: mapping validation errors (unknown channel, unknown scale, missing variable name); a toy model exporting `building.wealth` gives a `vars` entry of the right shape with NaN where unset.
- [ ] Implement; pass; full suite.

### Task 5: JS replay page with time
**Files:** Create `viz/replay.js`, `viz/test_replay.js`, `paperdolls/replay_build.py`; Modify `viz/viewer.html` (replay bar), `paperdolls/viewer_build.py`, `paperdolls/cli.py` (`replay` command), `tests/test_viz_assets.py`.
**Interfaces:** Consumes: Task 4 `vars`, `spec.mapping_for`. Produces: `Replay.create(sim, data)` with `setWeek(t)`, `weeks`, `legend() -> [{label, colour}]`; `paperdolls replay SPEC TRAJECTORY --out replay.html`.
- [ ] Failing node test: categorical and sequential mapping set the expected wall colour at week t; a value outside the domain clamps; NaN gives the neutral colour; legend entries come from the scale.
- [ ] Implement `replay.js`; pass. Failing Python test: the built page contains the trajectory and no retrofit wording for a custom model. Implement builder and CLI; pass.
- [ ] Open the page in the browser pane and screenshot it.

### Task 6: Place model buildings in scenes
**Files:** Modify `viz/replay.js`, `paperdolls/replay_build.py`; Test both.
**Interfaces:** Produces: `Replay.place(scene, nModel) -> {assigned, extra}`; builder error text "model has N buildings, scene has M".
- [ ] Failing tests: fewer scene buildings than model buildings raises with both numbers; extras are neutral; the page says "placement invented".
- [ ] Implement; pass; full suite; rebuild pages.
