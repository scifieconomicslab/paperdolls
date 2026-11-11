---
name: paperdolls-gates
description: Blocking design and correctness gates for a generated paperdolls page. Run before anything else, including the design-pattern pass. A fail stops the line.
---

# paperdolls gates — blocking checks, run first

These are the hard rules for any page the pipeline emits. Each is
pass/fail. A fail here is not a style nit: **stop, fix, restart.** A page
that passes here can still be ugly — that is what the design-pattern pass
is for. A page
that fails here is wrong, regardless of how good it looks.

Check them in order; report each as `PASS`/`FAIL — <what you saw>`.

## G1 — Appearance encodes only model-tracked state

Structure tops / walls / overlays change only with declared variables or
declared overlays from `model-binding.json` / `describe().variables`.
Nothing else changes colour, ever. Track down any non-declared recolouring
in the built page (grep the inlined bundle for colour writes outside the
channels module).

## G2 — People are paper dolls

One neutral paper tone for all people. No skin tones. No hair-colour or
face variation by "type". No ethnicity, religion, nationality or class
signals anywhere in the page (legend, labels, alt text included).

## G3 — No red↔green spectrum anywhere

No ramp, data channel or element uses a red↔green spectrum, including the
declared data variable (it fails colour-blind readers). Data ramps are built
per `skills/paperdolls-scene-craft/recipes/palette-method.md` §3. Status dots,
semantic colours and the accent may use green or red individually, never as
a spectrum. Structural treatments use their own declared scale colours.

## G4 — The model is the source of truth

No economic quantity is computed in the renderer or in UI code. Values
shown are verbatim from a model run. If a number is derived on screen
(e.g. "% finished"), it must come from a declared variable or be labelled
as derived.

## G5 — Missing data ≠ zero

Every declared variable and every legend carries a "no data" state,
distinct from any numeric value. Spot-check by rendering with a run that
has missing values.

## G6 — Inventions are labelled

Placement of model entities on footprints (fixed-order nearest-centre),
people, vehicles, trees, palettes, family mixes and structure grammars are
proposals. The page or its About panel says so, the world record says so, and
the report does too. No silent "this is how it is".

## G7 — Attribution present

OSM ODbL line when (and only when) the scene derives from OSM; the
paperdolls credit; the Colorfigures credit; family/palette credits when the
world uses a family pack. `CREDITS.md` in the project matches what the page
shows.

## G8 — Determinism posture

A run with params + seed re-run twice produces a byte-identical frame
stream (in dev mode with `checkFrame` on). Parameters change = new run
from t=0 with the same seed. A re-seed is only ever user-requested.

## G9 — Accessibility floor

Visible keyboard focus ring; the page is operable without a mouse; the camera
is operable by mouse and keyboard (drag or A/D to pan, wheel or W/S to zoom,
F to fit); `prefers-reduced-motion` respected (no entrance stagger, no easing);
contrast ≥ 4.5:1 for text (per the design-pattern rules).

## G10 — No network at view time

The built `visual/index.html` performs no fetches, loads no fonts, no
CDN, no telemetry. `tools/bench/check-single-file.mjs` passes.

## Gate 7 process checks (not numbered gates)

Run these alongside the gates at Gate 7. They are pass/fail for the page, but
they are process checks, not design gates; they do not renumber G1–G10.

- **Two-layer UI.** The policy view is the default; the analyst layer exposes
  parity, provenance, assumptions, model version, raw series, export and
  `?dev=1`.
- **Units.** Every displayed quantity has a unit, range and label.
- **Scenarios.** A two-run comparison matches the declared interventions and
  labels; no invented scenarios.
- **Impact view.** Draw only the user-confirmed causal graph; edges match the
  binding; omit it if no graph was confirmed.
- **Recorded trajectory.** If present, label it as a recording, not the live
  product.
