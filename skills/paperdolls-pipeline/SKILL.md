---
name: paperdolls-pipeline
description: Orchestrates a paperdolls run end to end — the eight gates, the one-question-at-a-time interview, the world record, the Gate 5 binding, the decisions log and the final report. Load first; it names which other skill to load at each step.
---

# paperdolls pipeline

You run the pipeline. This skill owns the order, the questions and the record;
the other skills own the how. Never do another skill's work here — load it.

## Preflight

Run and show the result:

```bash
python3 -m venv .venv            # first time only
.venv/bin/pip install -r requirements.txt
.venv/bin/python tools/check-env.py
```

Every line must `PASS`. A missing NetLogo blocks Gate 6, not the build; say so.
If `worlds/<name>` exists, ask: new **version** or new **world**. Never
overwrite; the decisions log is append-only.

## The gates

### Gate 1 — model brief → `paperdolls-netlogo-to-ts`
Ask for the model (path or paste). Read it fully. Propose, in one message:
which breeds to show; which sliders/switches/choosers become live controls
(default: all); which declared outputs go on the bottom dashboard (default:
all). If the model declares no outputs, ask which quantities to track. Do not
ask the step unit here.

If the user wants a value outside a slider's declared range (a longer horizon,
more buildings than its max), widen that range in the port's `describe()` only,
log it as a change to the model ("Gate 1: horizon max 360 → 720 at the
user's request"), and keep parity at values NetLogo can run.

### Gate 2 — world record
Create the tree and record:

```bash
mkdir -p worlds/<name>/{map-data,sim-code,visual}
cp reference/templates/world.md worlds/<name>/<name>.md
```

Ask for the name (lowercase, hyphens) and one paragraph describing the place
and the model, kept verbatim. Fill `Description` and `Dashboard outputs` from
Gate 1. Leave `Step count type` for Gate 5. Do not run the validator yet.

### Gate 2b — art bible → `paperdolls-art-direction`
Ask the world **family** and palette/genre, then write
`worlds/<name>/art-bible.md` (moment, palette, light, density and skyline,
signature motif, life, data treatment, "not this") and get it approved.
Record `look: house` in the world record; it lands in `model-binding.json` at
Gate 5. No map is fetched before this gate.

### Gate 3 — map source → `paperdolls-map-world`
Ask, in one message, two options: (a) import from OpenStreetMap — relation,
bounding box or extract file; (b) construct from a description. Neither is
privileged. Produce `map-data/scene.json` and `map-data/scene_report.md`, and
read the report aloud: counts, rotation, asset fit, assumed storeys, fallback
share, warnings.

### Gate 4 — map verification + style frame → `paperdolls-map-world` §Verify, `paperdolls-scene-craft`, `paperdolls-beauty-review`
Start the page with `node tools/stage/vendor.mjs worlds/<name>` (page project
from the template, plus the stage; never copy another world's page), then
`npm install` in `page/`.
Apply `scene-craft/recipes/composition.md` if needed, then build scene-craft
steps 1–4 (pipeline, light, masses and roofs, streets, facades). Render
the map sheet (`map-world` §6) and one beauty round; pass the beauty review's
Gate 4 subset. Show the map sheet with the report's structure count, asset
fit and fallback share, and the round's `board.png` as the **style frame**. Ask: *is this the place you meant, and does it look the
way the art bible says?* Fix and re-snapshot until yes.

### Gate 5 — binding
Ask one at a time. The user may answer "none" where meaningful.

1. **Agents → structures.** For each breed: which structure kinds/classes does
   it stand on? "Not structures" is valid (wolf-sheep).
2. **Displayed fields.** For each anchored breed, which declared fields appear.
3. **Step unit.** `tick` for abstract models; hours/days/weeks/months/years for
   calendar models. It labels the timeline and lives in `describe().time.unit`.
4. **Top colour.** Which output variable the roofs/tops represent, whether it
   is continuous or categorical (a state such as none/partial/done), and the
   meaningful range. Its colours are the data ramp the art bible already
   named; low and high mean pale and deep, never a hue pair. One top-colour
   variable per page. The legend is generated, never hand-written.
5. **Structural readings.** Re-read `describe()`. Propose at most three readings
   of declared fields in the world's fabric, strongest first, using the generic
   treatments (`mark`, `overlay`, `replacement`, `growth`, `state`, `extent`)
   and the family's presets. The user decides; declining is valid. Record each
   as an `architecture` entry (entity, field, treatment, preset, scale, label).
6. **Causal graph.** The LLM proposes from the model; the user confirms or
   edits. If unconfirmed, omit the impact view; never invent causality.
7. **Scenarios.** Which declared interventions become toggles or named
   scenarios; whether to compare two runs. **If the model declares no
   interventions**, scenarios are named **parameter presets**: each restarts
   from t = 0 with the same seed, and the page labels them as comparisons, not
   actions. Never fake a mid-run intervention the model does not declare. A
   two-run comparison draws the second run's series as a dashed line on the
   same charts; the world shows one run at a time.

Write `sim-code/model-binding.json` (shape in `schemas/model-binding.json`),
then validate:

```bash
.venv/bin/python tools/check-world.py worlds/<name>/<name>.md
```

### Gate 6 — parity → `paperdolls-netlogo-to-ts`
Convert procedure by procedure, test against fixtures, run the 200-run
ensemble, run the ten-pass determinism check on both sides. Write `parity.md`.
Show it before the gate closes.

### Gate 7 — sign-off → `paperdolls-interface-ui` + `paperdolls-technology`
Finish scene-craft steps 5–9, build the page, run the ui-rules gates, then
`paperdolls-beauty-review` (blocking), then the ui-rules craft pass, measure
FPS, run `?dev=1` frame checks and the ten-pass determinism check, and
confirm the stage copy is unedited (`node tools/stage/vendor.mjs worlds/<name> --check`). Hand the user
`visual/index.html`; fix what they report; re-run affected checks.

## Decisions log

After every gate, append one line, dated, to the world record. Never rewrite:

```text
- YYYY-MM-DD — Gate N (what): <decision>
```

## Final report

Before sign-off, state: world-record validator PASS; binding schema PASS
(`.venv/bin/python tools/check-schemas.py worlds/<name>`);
single-file check PASS; FPS numbers (or "not verifiable: <reason>"); ui-rules
result; beauty-review scores and round count; parity log and determinism results; page path and size; snapshot id and
manifest; and the one thing you are least sure about.

```bash
.venv/bin/python tools/snapshot-world.py worlds/<name> --version <id>
```

## Failure playbook

- **Overpass unreachable** — save `query.ql`; give the overpass-turbo path; stop
  without data.
- **>50% fallback classes** — say the number; offer confirm, another region, or
  accept as-is; record the answer.
- **Most storeys assumed** — say so; offer nothing to fix; record the admission.
- **Blank or wrong map** — re-check the rotation table; do not rotate by hand.
- **Parity keeps failing** — fix the conversion you can see; after two
  iterations suspect the model; ask whether to fix both with consent or label
  the defect.
- **FPS fails** — report exact numbers; offer trimming or explicit acceptance.
- **User dislikes the look** — return to the art bible: change the moment or
  the palette first, then re-run the beauty review. The change is a new
  decision in the log, never a silent drift.
- **Beauty review fails after three rounds** — show the scores and `board.png`,
  name the remaining gaps and the recipes that would fix them; the user
  decides whether to continue or accept.
- **A class the reference lacks** — do not invent one; report the gap, map it to
  `other` with `inferred:"fallback"`, note it.
- **Non-NetLogo model, or nothing to anchor** — stop and explain the scope
  only when no breed and no table of places can stand on a structure. A table
  of places counts (netlogo-to-ts §1).
- **No outputs** — ask which quantities to track; never ship an empty dashboard.
- **Unconfirmed causal graph** — omit the impact view.
- **Model cannot be converted** — stop; show the construct; ask to hand-hold,
  simplify or drop the breed.
