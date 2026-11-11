# UI rules pass — Brussels Deepseek

Run at Gate 7 on the built page `visual/index.html` (9.91 MB, single file) in Chromium at 1440 × 900. Blocking gates first, then the craft pass, then the paperdolls-specific list.

## Direction (five lines)

- **Product.** A month-by-month housing-retrofit model of Jette, Brussels, for policy analysts and residents; a model exploration, not a forecast.
- **Character.** Brick, slate, bright.
- **World.** Jette's real rooflines: red-brown brick, white limestone bands, slate roofs, a green park belt; 3 pm, late May, dry.
- **Moments.** The street and its roofs, the retrofit-state ridge caps, the teal pennants, the adoption chart, the shared-measure fate.
- **Signature.** The plum ridge cap against the white speklagen band; the step unit as a quiet caption under the timeline ("4 months a second").

## Blocking gates (G1–G10)

| gate | result | evidence |
|---|---|---|
| G1 appearance encodes only model state | PASS | `page/src/scene/data.ts` writes structure colour only from `frame.entities.buildings` fields; `page/src/scene/buildings.ts` gives only the `aData`/`aInfo` meshes a data path. Decorative materials are fixed palette colours. |
| G2 people are paper dolls | PASS | `life.ts` uses one paper tone `#f2ede3` for heads; garments come from a fixed low-chroma set plus 15 % accent; no skin, hair, face or identity signal. |
| G3 no red↔green spectrum | PASS | top ramp "plum" h 300→340 (`palette.ts`); adoption chart h 255→185; status colours are teal/ochre individually, never a spectrum. |
| G4 model is the source of truth | PASS | the chart plots `frame.series` verbatim; the hover tag reads `retrofit_state`, `adoption`, `approved`; no economic value is computed in the renderer. The cladding maps a declared 0–1 adoption to completed storeys, a visual count, not a new number. |
| G5 missing data ≠ zero | PASS | NaN/undefined → "no data"; the top-colour layer draws neutral + 45° hatch (1,236 rental buildings at the default run); `fmt()` prints "no data", never 0. |
| G6 inventions are labelled | PASS | sidebar note and About drawer list traffic, people, smoke, birds, most trees, the raised spire, guessed storeys/units and the palette proposal; the world record and report repeat it. |
| G7 attribution present | PASS | page: "© OpenStreetMap contributors (ODbL)", "paperdolls · CC BY 4.0, Sci-Fi Economics Lab", "Colour-figure concept after Colorfigures, April Zhu (MIT)", model licence "CC BY 4.0 … every number is a placeholder". |
| G8 determinism posture | PASS | seed visible (household and scene); a parameter change is a new `start()` from month 0 with the same seed; ten-pass determinism PASS in `sim-code/parity.md`. |
| G9 accessibility floor | PASS | visible `:focus-visible` ring; canvas focusable; drag + A/D pan, wheel + W/S zoom, F fit, R/E rotate, L lens, Space play; `prefers-reduced-motion` stops decorative life and easing; text tokens are ≥ 4.5:1 on the surfaces. |
| G10 no network at view time | PASS | `tools/bench/check-single-file.mjs`: "one self-contained file, 9.91 MB"; screenshots show zero page errors. |

## Gate 7 process checks

- **Two-layer UI.** PASS. Policy view is the default; the analyst drawer carries description, look/family/palette, model version, seeds, tick, controls, assumptions/provenance, parity pointer, art-bible status, raw-series export and the `?dev=1` note.
- **Units.** PASS. Every KPI carries its unit (units, €, share, buildings, households, measures); the chart is "share of units" with % ticks; the timeline is months; the hover tag shows % and state.
- **Scenarios.** PASS. Five named scenarios, each a parameter set of the model's own choosers/switches (no invented in-run intervention); starting one is a new run from month 0; "Reset run" reapplies it. The brief asked for baseline + four; delivered.
- **Impact view.** PASS. The confirmed 16-edge graph from `model-binding.json`, collapsed under "Impact (confirmed graph, 16 edges)"; no edge outside the binding.
- **Recorded trajectory.** Not present; not claimed.
- **Dev frame check.** PASS. `?dev=1` shows calls/triangles/build time/data counts; the model's `checkFrame` runs every tick and no error surfaced during a play run or after F/keyboard input.

## Craft pass

| pattern | what changed |
|---|---|
| spacing | main dock padding 16/20, gaps 20, 4 px scale; sidebar 16; cards 8/12; the dock is four columns so the canvas keeps ~620 px at 1440 × 900 |
| type | one system family plus `ui-monospace` for figures; group heads are sentence case (uppercase tracking removed); tabular figures in cards |
| copy | specific: "Adoption by income quintile", "Can finance", "Shared measures", "Buildings done"; no greetings or hype |
| icons | one Tabler line set, size 14/17, stroke 1.6; no emoji |
| layout | 280 px sidebar; full-width dock (timeline · chart · outputs · legend); no overlay on the canvas; scenario is one `Select`, choices are selects |
| charts | one main chart (five lines, zero baseline, % ticks, month ticks, current-month rule), ARIA title/description, expandable data table; sparklines are secondary |
| details | nested radii (card 10, chips 999, panel 14); quiet hairlines; focus rings; the step-unit caption is the signature detail |
| motion | only the model play, the lens tween (300 ms), camera easing (250–400 ms) and decorative life; reduced motion stops all of them |

## Paperdolls-specific list

- **Top ramp.** One declared field (`retrofit_state`) drives the ridge cap/coping; the legend swatches are sampled from the same `plum()` function; "no data" is a distinct hatched swatch; no red↔green.
- **Structural readings.** `approved` → teal pennant (mark/flag); `adoption` → completed-storey cladding (extent/segments); both fields are declared and in the binding.
- **Impact.** Confirmed graph only; 16 edges match the binding.
- **Scenarios.** Five parameter-set scenarios; no invented interventions.
- **Units.** Present on every displayed quantity.
- **Policy/analyst split.** Present and explicit.
- **Recorded trajectory.** Not present; not claimed.
- **Offline.** Single-file PASS; no fonts, CDNs or telemetry.
- **Accessibility.** Keyboard camera, focus ring, reduced motion, contrast; `aria-label`s on every ActionIcon and both charts.

## Remaining

- The renderer reports 199 draw calls at the opening neighbourhood zoom (budget ≤ 250, PASS) and about 11.6 M triangles summed across the normal, shadow and colour passes (the recipe's 1.5 M triangle budget is a per-pass target; the FPS gate passes at p50 16.7 ms / p95 16.8 ms). The available trim is an intermediate LOD that hides window surrounds and sills above 150 m of view width; it was not needed for the frame-rate gate and is recorded rather than applied silently.
- The model runs on the main thread (~6 ms a month; 16,140 households). A worker was not wired; the About panel and final report say so.
- Scenario comparison is one run at a time; a side-by-side two-run comparison is not built (the brief did not ask for it).
