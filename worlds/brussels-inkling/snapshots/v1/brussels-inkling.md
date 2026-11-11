# Brussels — The Great Retrofit v3 (Jette) — the world record

## Description

Jette, a Brussels commune wedged against the city's north-western edge, drawn
from OpenStreetMap (relation 58258): 9,216 mapped buildings, of which 8,105
are dwellings (433 tagged residential, 7,672 generic `building=yes` at 30 m²
or more, guessed to be homes), run against THE GREAT RETROFIT v3 — monthly
household retrofit decisions by NPV and ability to finance, with owner-occupied,
condo (shared-parts vote) and rental tenures, and three delivery modes
(rebate market, passthrough, public service). Every number in the model is a
placeholder; nothing computed here is a finding. The model's name is the
world's name: the order of the day is brick, rain gauges and who can actually
pay for a roof.

## Step count type

months

## Agents and structure mapping

| NetLogo breed | Meaning in the model | Rendered as (structure kind / archetype) | Count |
|---|---|---|---|
| households | one agent per dwelling unit: NPV + financing decision each month; rental units never adopt; condo units also vote on shared measures | building (anchored; layer `buildings`; one anchor per unit, many units per structure) | 22,993 units in 8,105 dwellings |

## Interactive parameters

| Parameter | Default | Range | Live (interactive) by default |
|---|---|---|---|
| horizon-months | 360 | 12–360 (monthly steps) | yes |
| seed | 0 | 0–999 (integer) | yes |
| scene-seed | 0 | 0–999 (integer) | yes |
| n-buildings | 8105 | 1–10000 (integer) | no — structural, fixed to the real Jette dwellings (see Decisions) |
| delivery-mode | rebate_market | rebate_market / passthrough / public_service | yes |
| credit-access | income_tested | income_tested / open / none | yes |
| energy-scenario | rising | flat / rising / shock | yes |
| refundable? | false | switch | yes |
| means-test? | false | switch | yes |
| means-test-max-quintile | 2 | 1–5 (integer) | yes |
| shared-measure? | true | switch | yes |
| peer-effect? | true | switch | yes |
| deduction-rate | 0.30 | 0–1 | yes |
| rebate-lag-months | 12 | 0–36 (integer) | yes |
| loan-rate | 0.04 | 0–0.2 | yes |
| loan-rate-risk-premium | 0.02 | 0–0.1 | yes |
| vendor-margin | 0.15 | 0–1 | yes |
| public-overhead | 0.10 | 0–1 | yes |
| public-capacity | 0.05 | 0–0.2 | yes |
| shared-share | 0.40 | 0–1 | yes |
| vote-threshold | 0.67 | 0–1 | yes |
| consider-prob-base | 0.05 | 0–1 | yes |
| neighbour-boost | 0.30 | 0–1 | yes |
| free-time-spread | 0.30 | 0–1 | yes |
| canvass-target-hours | 2.0 | 0–6 | yes |
| canvass-boost | 0.20 | 0–1 | yes |
| canvass-saturation-hours | 6.0 | 1–12 | yes |
| cost-per-m2 | 300 | 50–1000 | yes |
| saving-per-m2-year | 20 | 1–100 | yes |
| discount-rate | 0.04 | 0–0.2 | yes |
| loan-term-months | 120 | 12–360 (integer, step 12) | yes |
| credit-income-threshold | 25000 | 0–100000 | yes |
| credit-loan-to-income | 1.0 | 0–3 | yes |
| savings-scale | 1.0 | 0–3 | yes |
| savings-usable-share | 1.0 | 0–1 | yes |
| savings-months-of-income | 3.0 | 0–12 | yes |
| years-in-dwelling-min | 5 | 1–25 (integer) | yes |
| years-in-dwelling-max | 25 | 1–40 (integer) | yes |
| rental-share-single | 0.10 | 0–1 | yes |
| rental-share-multi | 0.30 | 0–1 | yes |

`horizon-months` bounds both the simulation length and the consideration rule.
The world doubles the model's 180-month default to **360 months** (recorded at
Gate 2/Gate 5). `n-buildings` is structural: the scene provides exactly the
8,105 real dwellings, so the slider is not live.

## Dashboard outputs

| Output | Source (plot pen / monitor) | Shown |
|---|---|---|
| Adoption by quintile (Q1–Q5) | plot `Adoption by quintile`, pens Q1–Q5 | yes |
| State spend (cumulative) | plot `State spend (cumulative)`, pen `public cost` | yes |
| Bills saved (cumulative) | plot `Bills saved (cumulative)`, pen `bills saved` | yes |
| Cost per retrofit | plot `Cost per retrofit`, pen `price` | yes |
| month | monitor `month` | yes |
| adopted units | monitor `adopted units` | yes |
| public cost | monitor `public cost` | yes |
| bills saved | monitor `bills saved` | yes |
| cost per retrofit | monitor `cost per retrofit` | yes |
| cost parts | monitor `cost parts` | yes |
| tenures | monitor `tenures` | yes |
| building states | monitor `building states` | yes |
| adoption by quintile | monitor `adoption by quintile` | yes |
| can front cost by quintile | monitor `can front cost by quintile` | yes |
| rebate per euro by quintile | monitor `rebate per euro by quintile` | yes |
| net cash by quintile | monitor `net cash by quintile` | yes |

Not shown: canvass hours and leisure hours — the model computes them, but no
plot or monitor widget declares them (assumed; logged).

## Top colour

- variable: retrofit_share
- range: 0–1
- direction: low → high (sequential "plum" ramp; pale → deep plum)
- means: share of the building's units that have completed their retrofit —
  the building's retrofit state, shown on roofs as a coping band (flat) /
  ridge cap (pitched), plus the data lens on demand

## Structural modifications

| Variable | Treatment | Preset | Scale | Label |
|---|---|---|---|---|
| shared_pending | mark | flag | categorical (per building) | Shared-measure vote pending |
| retrofit_share | extent | segments | sequential (per storey, bottom-up) | Retrofit progress (storeys clad) |

## Causal graph

- confirmed: yes
- source: llm-proposed + user-confirmed (brief: "accept the one you derive")
- nodes: delivery-mode, deduction-rate, credit-access, shared-measure?, n-complete, public-cost, bills-saved
- edges: delivery-mode → n-complete; deduction-rate → n-complete; credit-access → n-complete; shared-measure? → n-complete; n-complete → public-cost; n-complete → bills-saved

## Scenarios and interventions

The NetLogo source declares **no interventions**. The five named scenarios are
bundles of declared policy parameters; each starts a fresh run from t=0 with the
same seed (a parameter change is a new run, per the runtime contract). Not a
command script — the model has no scripted events.

| Scenario | Interventions | Compared |
|---|---|---|
| Baseline | none — model defaults (rebate_market, deduction-rate 0.30, rising energy, no means test) | yes |
| Generous rebate | preset: deduction-rate 0.60, rebate-lag-months 6 | yes |
| Public service | preset: delivery-mode public_service, public-capacity 0.10 | yes |
| Means-tested, refundable | preset: means-test? on (max quintile 2), refundable? on | yes |
| Passthrough | preset: delivery-mode passthrough | yes |

## Map

- source: osm-overpass relation 58258
- family: real
- palette: nw
- stored: `map-data/extract.json` (sha256: a16db8de706cee21525da6cd6f3a681f719ad161ed479d003317c4943c02ea14)
- frame rotation: 0 degrees (chosen by the ingest's rotation table — 26% asset fit unrotated vs 24% for −5 to −7° candidates; buildings and roads disagree); north now points 60 degrees clockwise from the top of the screen; structures fitting an asset: ~29% (estimate)
- archetype cascade: ingest 1.0.0; fallback share: 93% of 9,216 buildings classed by the seeded fallback (8,545 buildings) — seeded; seed 7 (default); residential share: 8,105 dwellings (433 residential + 7,672 probable) of 9,216 structures
- storeys assumed: 99% (9,103 of 9,216 buildings; 8,555 global-default at 2, 548 type-default) — heights are mostly assumed, not measured (admission recorded at Gate 3)
- report: `map-data/scene_report.md`

## Decisions log

- 2026-11-11 — Gate 1 (agents + interactive parameters + dashboard outputs): households anchored to buildings (one anchor per unit); all sliders/switches/choosers live by default (horizon-months default doubled to 360 and kept live); n-buildings made structural, fixed to 8,105 real Jette dwellings (splitting the world from the NetLogo synthetic scene requires a fixed set); all declared plot pens and monitors shown; canvass/leisure hours omitted (no declaring widget); model declares no interventions — scenarios handled as parameter presets at Gate 5
- 2026-11-11 — Gate 2 (world name + description): `brussels-inkling`; description authored by the assistant (no user present — recorded as assumed); the world doubles the model's 180-month horizon to 360 months (brief answer)
- 2026-11-11 — Gate 2b (art bible): approved via brief answers — real / north-west Europe / brick, 3 pm late May, sunny; moment "high even sun"; motif "polychrome brick banding"; palette authored from nw/brick hue hints in OKLCH; look: house recorded
- 2026-11-11 — Gate 3 (map source): OpenStreetMap relation 58258 (Jette); fetched and ingested 2026-11-11; 9,216 buildings, 1,320 roads, 1,091 landuse, 8,705 trees; rotation 0.0° by the ingest's table; 93% fallback economic class (seeded guesses — not data; recorded); 99% storeys assumed (recorded — most storeys assumed, not measured); residential binding set = 8,105 (433 residential + 7,672 probable) for n-buildings; 22,986 units total; non-dwelling 1,111 structures render but carry no households
- 2026-11-11 — Gate 4 (map verified + style frame): map verified — 9,216 structures, 1,320 roads (clipped to the commune boundary polygon fetched from OSM relation 58258, assembled from its 10 outer ways), 1,091 landuse, 8,705 trees (8,499 placed, 206 unknown-kind dropped to a default conifer), rotation 0.0°, plinth follows the commune silhouette; report read aloud (93% fallback classes — seeded guesses, recorded; 99% storeys assumed, recorded); snapshots `map-data/verify/top-down.png`, `iso-0.png`, `iso-90.png`; style frame approved via round-1/round-2 beauty captures — Gate-4 subset PASS (see `visual/review/review.md`)
- 2026-11-11 — Gate 5 (binding + step count + top colour + structural modifications + causal graph + scenarios): step count type `months`; agents → structures `households` → `buildings` layer via `anchor` (one anchor per unit, many units per structure); displayed fields: bidx, b_tenure, quintile, area, income, savings, horizon, saving_frac, complete, unit_done, shared_paid, supporter, paid_any, cash_net, paid_price, retrofit_share, shared_pending; top colour `retrofit_share` (domain 0–1, sequential "plum" ramp, roof tint ≤ 8% + ridge/coping band); structural readings accepted: `shared_pending` → mark/flag, azure #398ccc, categorical, "Shared-measure vote pending"; `retrofit_share` → extent/segments, sequential, "Retrofit progress (storeys clad)" bottom-up zinc bands; causal graph accepted as proposed (delivery-mode, deduction-rate, credit-access, shared-measure? → n-complete → public-cost, bills-saved); scenarios = Baseline plus four parameter presets (Generous rebate; Public service; Means-tested, refundable; Passthrough) — the NetLogo source declares no interventions, so scenarios restart a fresh run from t=0 with the same runtime seed (never passed to the engine as interventions); binding validated against schemas/model-binding.json (PASS); check-world PASS except the pending Gate 4/6/7 log lines at the time of writing
- 2026-11-11 — Gate 6 (parity + determinism): NetLogo 7.0.4 present; 200-run ensemble (n-buildings=200, horizon-months=360, seeds 0–199, scene-seed=0, both sides) PASS on all eight pens (max |z| = 0.00, KS p = 1.000); seed-0 smoke-test matches NetLogo bitwise to ~1 ulp; determinism PASS both sides (byte-identical CSVs, seeds 1–10 × 200 ticks); `sim-code/parity.md` written; procedure-level fixtures not built (ensemble is the gate that ran); parity was run on the synthetic scene, not the real-Jette layer (recorded limitation); pointer: `sim-code/parity.md`, `sim-code/results/compare.md`
- 2026-11-11 — Gate 7 (sign-off): page built and self-contained (`visual/index.html`, 9.69 MB, opens offline, opening frame = Sint-Pietersplein, 22,993 model units anchored to the 8,105 real dwellings, frame check clean — `?dev=1` logs 26 series / 40 params, checkFrame throw-on-error always on); ui-rules G1–G10 PASS — G1 data-only appearance via the binding layer (top colour `retrofit_share`, plum sequential ramp, roof tint ≤ 8% + ridge cap/coping band; `shared_pending` → azure #398ccc pennant (mark/flag); `retrofit_share` → zinc storey segments bottom-up (extent/segments); missing data → grey + 45° hatch); G2 paper-doll people, one neutral tone; G3 no red↔green spectrum anywhere (plum sequential ramp, azure flag, zinc cladding); G4 renderer computes no economic quantity — values verbatim from runtime frames, derived labels marked; G5 missing ≠ zero ("No data" + hatch on all declared variables and in the lens); G6 inventions labelled in the About drawer (stalls, traffic, trams, parked cars, pedestrians, smoke, pigeons, hedges, gault string courses, palette/archetype grammars, seeded auto-archetype rule); G7 attribution in page + About (© OpenStreetMap contributors (ODbL), paperdolls CC BY 4.0, Colorfigures, model CC BY 4.0 — all numbers placeholders); G8 determinism — 10-pass byte-identical both sides; G9 keyboard focus ring, A/D pan, W/S zoom, F fit, Space play/pause, L lens, prefers-reduced-motion honoured, contrast ≥ 4.5:1; G10 `tools/bench/check-single-file.mjs` PASS — no network at view time. Process checks: two-layer UI (policy sidebar / About analyst layer with provenance + raw-series export), units and labels on every displayed quantity, scenarios = Baseline + four parameter presets (model declares no interventions; each restarts from t=0 with the same runtime seed — no invented scenarios), impact view draws only the confirmed binding graph. FPS (182-frame sample both runs): dpr 1 → p50 16.7 ms, p95 16.7, max 16.8; dpr 2 → identical — PASS (tool samples 182 frames only; the main-thread sim costs ~20–40 ms per tick at 22,993 units; recorded). Beauty review against `real-nw-ashford`: round 1 (Gate-4 subset) average 4.0 — PASS; round 2 (full rubric) average 4.0 — PASS, all ten criteria ≥ the exemplar's per-criterion scores (1 and 9 at 4 vs 3); squint light 4% ≥ 2%, mean 122 within 100–130, stddev 26 ≥ 24. Wally check: unit count in the mapping table corrected to 22,993 (Gate 3's 22,986 was a rounding slip — the model's `round` is half-away-from-zero; verified against scene.json and the page frame check; the Gate 3 log line is left untouched per append-only). NetLogo PRNG rewritten to native 32-bit ops (Math.imul) after profiling showed the arithmetic `nlBitAnd` loop at 68.7% of conversion time — outputs byte-identical (seeds 0–1 vs saved CSV; full 200-run re-run + compare PASS). Sign-off approved via the brief (all gates pre-approved; no live user present). Snapshot v1 taken. pointer: `visual/review/review.md`, `visual/index.html`

## Snapshot

- version: v1
- date: 2026-11-11
- changed: initial world

## Attribution

- OpenStreetMap: © OpenStreetMap contributors (ODbL)
- paperdolls: CC BY 4.0, Sci-Fi Economics Lab
- Colour-figure concept after Colorfigures, April Zhu (MIT)
- The Great Retrofit v3 (NetLogo port): CC BY 4.0, Sci-Fi Economics Lab (all numbers are placeholders; the model says so itself)
