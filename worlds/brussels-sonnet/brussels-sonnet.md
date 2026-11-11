# <World Name> — the world record

<!-- Copy this file to /worlds/<world_name>/<world_name>.md and fill it in.
     Keep the required sections and their order. The description is the user's
     words, verbatim. The decisions log is append-only. Anything the pipeline
     inferred is labelled `assumed`. The world is a project with versioned
     snapshots, not a single mutable folder. -->

## Description

<!-- The user's one paragraph, verbatim. -->

This is a simulation of housing co-ops and retrofitting decisions in Jette, Brussels.

## Step count type

<!-- Set at Gate 5. One of: hours | days | weeks | months | years | tick -->

months

## Agents and structure mapping

<!-- The table's content is structures; buildings are the common kind. -->

| NetLogo breed | Meaning in the model | Rendered as (structure kind / archetype) | Count |
|---|---|---|---|
| households | a household (a dwelling unit); units per building = round(area × storeys × 0.8 / 80 m²) (the model's own placeholder rule, storeys assumed) | residential + probable OSM buildings (433 tagged + 7,672 guessed building=yes ≥ 30 m²), drawn as the real footprints; 1,111 other buildings are unbound scenery; tenure is the model's seeded draw (simulated, not real) | 8,105 buildings; ≈31,284 households (assumed) |

## Interactive parameters

| Parameter | Default | Range | Live (interactive) by default |
|---|---|---|---|
| seed | 0 | 0–999 | yes |
| scene-seed | 0 | 0–999 | yes |
| n-buildings | real residential count after mapping (8,105) | 10–(map count) | yes |
| horizon-months | 360 | 12–360 | yes |
| means-test-max-quintile | 2 | 1–5 | yes |
| deduction-rate | 0.3 | 0–1 | yes |
| rebate-lag-months | 12 | 0–36 | yes |
| loan-rate | 0.04 | 0–0.2 | yes |
| loan-rate-risk-premium | 0.02 | 0–0.1 | yes |
| vendor-margin | 0.15 | 0–1 | yes |
| public-overhead | 0.1 | 0–1 | yes |
| public-capacity | 0.05 | 0–0.2 | yes |
| shared-share | 0.4 | 0–1 | yes |
| vote-threshold | 0.67 | 0–1 | yes |
| consider-prob-base | 0.05 | 0–1 | yes |
| neighbour-boost | 0.3 | 0–1 | yes |
| free-time-spread | 0.3 | 0–1 | yes |
| canvass-target-hours | 2.0 | 0–6 | yes |
| canvass-boost | 0.2 | 0–1 | yes |
| canvass-saturation-hours | 6.0 | 1–12 | yes |
| cost-per-m2 | 300 | 50–1000 | yes |
| saving-per-m2-year | 20 | 1–100 | yes |
| discount-rate | 0.04 | 0–0.2 | yes |
| loan-term-months | 120 | 12–360 | yes |
| credit-income-threshold | 25000 | 0–100000 | yes |
| credit-loan-to-income | 1.0 | 0–3 | yes |
| savings-scale | 1.0 | 0–3 | yes |
| savings-usable-share | 1.0 | 0–1 | yes |
| savings-months-of-income | 3.0 | 0–12 | yes |
| years-in-dwelling-min | 5 | 1–25 | yes |
| years-in-dwelling-max | 25 | 1–40 | yes |
| rental-share-single | 0.1 | 0–1 | yes |
| rental-share-multi | 0.3 | 0–1 | yes |
| refundable? | off | off/on | yes |
| means-test? | off | off/on | yes |
| shared-measure? | on | off/on | yes |
| peer-effect? | on | off/on | yes |
| delivery-mode | rebate_market | rebate_market | passthrough | public_service | yes |
| credit-access | income_tested | income_tested | open | none | yes |
| energy-scenario | rising | flat | rising | shock | yes |

Parameters live in the model's inline `params` block in `sim-code/model.ts`;
the step count type is time and is honoured by the timeline, not by a parameter.

## Dashboard outputs

<!-- What the bottom dashboard shows: the model's declared outputs (plot pens,
     monitors, series) the user picked at Gate 1. Must have at least one row. -->

| Output | Source (plot pen / monitor) | Shown |
|---|---|---|
| Adoption by quintile Q1–Q5 | plot "Adoption by quintile" (5 pens) | yes |
| State spend (cumulative) | plot "State spend (cumulative)" (pen public cost) | yes |
| Bills saved (cumulative) | plot "Bills saved (cumulative)" (pen bills saved) | yes |
| Cost per retrofit | plot "Cost per retrofit" (pen price) | yes |
| Month | monitor month | yes |
| Adopted units | monitor adopted units | yes |
| Public cost | monitor public cost | yes |
| Bills saved | monitor bills saved | yes |
| Cost per retrofit (current) | monitor cost per retrofit | yes |
| Cost parts (base + markup) | monitor cost parts | yes |
| Tenures | monitor tenures | yes |
| Building states | monitor building states | yes |
| Adoption by quintile (now) | monitor adoption by quintile | yes |
| Can front cost by quintile | monitor can front cost by quintile | yes |
| Rebate per euro by quintile | monitor rebate per euro by quintile | yes |
| Net cash by quintile | monitor net cash by quintile | yes |

## Top colour

<!-- Gate 5. The one declared output variable the roofs/tops represent. -->

- variable: building retrofit state (categorical: none / partial / done; rentals = not modelled → no data)
- range: 3 states (0 none, 1 partial, 2 done)
- direction: pale → deep plum (heather ramp; red↔green banned)
- means: share of a building's units retrofitted: none, some, all; rental buildings are not modelled by the source (grey + hatch)

## Structural modifications

<!-- Gate 5. Each accepted reading: a declared variable drawn in the world's
     fabric. The generic treatments are mark, overlay, replacement, growth,
     state, extent; the real family's presets are band, scaffold, wrap,
     panels, flag, tint and outline. -->

| Variable | Treatment | Preset | Scale | Label |
|---|---|---|---|---|
| shared-measure status (b-needs-shared, b-approved) | mark | flag | categorical (pending / approved) | Shared measure: pending / approved |
| adoption progress (b-adopted / b-nuits) | extent | segments | sequential (0–1) | Units retrofitted (storeys clad from the bottom) |

## Causal graph

<!-- Gate 5. Confirmed by the user. If none is confirmed, say so and omit the
     impact view. -->

- confirmed: yes
- source: llm-proposed (read from model code) + user-confirmed 2026-11-11
- nodes: energy-scenario, cost-per-m2, delivery-mode, deduction-rate, rebate-lag-months, loan-rate, credit-access, income, savings, npv, can-finance, consider-prob, neighbour-adoption, canvassing, shared-support, shared-approved, adoption, public-cost, bills-saved
- edges: energy-scenario→npv, cost-per-m2→npv, cost-per-m2→can-finance, delivery-mode→npv, delivery-mode→can-finance, deduction-rate→can-finance, rebate-lag-months→can-finance, loan-rate→can-finance, credit-access→can-finance, income→can-finance, savings→can-finance, npv→adoption, can-finance→adoption, neighbour-adoption→consider-prob, canvassing→consider-prob, consider-prob→adoption, consider-prob→shared-support, shared-support→shared-approved, shared-approved→adoption, adoption→public-cost, adoption→bills-saved

## Scenarios and interventions

<!-- Gate 5. Model-declared interventions the user wants as toggles or named
     scenarios. Two-run comparison only; full scenario matrices are out of
     scope for this version. -->

| Scenario | Interventions | Compared |
|---|---|---|
| Baseline | model defaults (rebate_market, income_tested credit, rising energy, no means test) | yes |
| Public service | delivery-mode = public_service | yes |
| Means-tested refundable rebate | means-test? = on, refundable? = on, means-test-max-quintile = 2 | yes |
| Energy price shock | energy-scenario = shock | yes |
| No credit | credit-access = none | yes |

## Map

- source: osm-overpass relation 58258 (Jette), fetched 2026-11-11
- family: real
- palette: nw (brick look)
- stored: `map-data/extract.json` (sha256: 019bb1426696f13e33c56cd24d9863e4ba26fa6de84590bc8ff430f4fa1653ef)
- frame rotation: 0.0° (chosen from: none, highest estimated asset share); structures fitting an asset: 29% (estimated)
- archetype cascade: ingest (reference/building-archetypes.md); fallback share: 93% (seeded)
- storeys assumed: 99% (9103 of 9216)
- report: `map-data/scene_report.md` (counts, assumptions, warnings)

## Decisions log

<!-- Append one line per gate decision, dated. Never rewrite earlier entries. -->

- 2026-11-11 — Gate 1 (agents + interactive parameters + dashboard outputs): model netlogomodels/great-retrofit-v3.nlogox; breed households (anchored to buildings); all 44 widgets live; all declared plots/monitors on dashboard. User changes: default horizon-months doubled 180→360; n-buildings = number of residential/household buildings found in Jette after mapping (not the model's 200 synthetic ones; beyond the model's slider max of 400).
- 2026-11-11 — Gate 2 (world name + description): name brussels-sonnet; description recorded verbatim (housing co-ops and retrofitting decisions in Jette, Brussels).
- 2026-11-11 — Gate 2b (art bible): approved; moment "3 pm, late May, clear and sunny"; motif "white-stone banding + first-floor bay windows"; palette proposed; family real, palette nw/brick; look: house
- 2026-11-11 — Gate 3 (map source): OSM import, whole commune of Jette (relation 58258, confirmed by user before fetch); 9216 buildings, 1320 roads, 1091 land-use polygons, 8705 trees; 93% economic-class fallback, 99% storeys assumed, 29% asset fit (all disclosed to user)
- YYYY-MM-DD — Gate 4 (map verified + style frame): <decision>
- 2026-11-11 — Gate 5.4 (top colour): building retrofit state (none/partial/done), plum heather ramp, rentals = no-data grey + hatch; red→green banned (G3)
- 2026-11-11 — Gate 5.5 (structural readings): two accepted — shared-measure status as roof flag (mark/flag), adoption progress as segments (extent/segments)
- 2026-11-11 — Gate 5.6 (causal graph): LLM-proposed from the model code, user confirmed as shown (19 nodes, 21 edges)
- 2026-11-11 — Gate 5.7 (scenarios): Baseline + Public service, Means-tested refundable rebate, Energy price shock, No credit; two-run comparison against baseline
- 2026-11-11 — Gate 5 (binding + step count + top colour + structural modifications + causal graph + scenarios): all seven questions answered by the user; sim-code/model-binding.json written
- 2026-11-11 — Gate 6 (parity + determinism): user CLOSED the gate. NetLogo 7.0.4 downloaded with user consent; exact parity (25 procedure gates, 13-config matrix, 200-run ensemble PASS, 10-pass determinism both sides); map mode has no NetLogo twin; see sim-code/parity.md
- 2026-11-11 — Gate 7 (visualization + checks + user sign-off): user SIGNED OFF, accepting the beauty-review FAIL (round 6, avg 3.7). Page visual/index.html (4.04 MB, one file; sim in a worker). single-file PASS; FPS 60 on RTX 4080 SUPER at 3 zooms idle/playing (budgets for draw calls and triangles exceeded, see report); ui-rules gates G1–G10 PASS; beauty review round 6 FAIL (avg 3.7; criteria 4 and 6 at 3), see visual/review/review.md; parity see sim-code/parity.md

## Snapshot

- version: v2
- date: 2026-11-11
- changed: v2 records the user sign-off of Gate 7 (v1 was the hand-over snapshot)

## Attribution

<!-- If the scene derives from OpenStreetMap: "- OpenStreetMap: © OpenStreetMap contributors (ODbL)" -->
- paperdolls: CC BY 4.0, Sci-Fi Economics Lab
- Colour-figure concept after Colorfigures, April Zhu (MIT)
- NetLogo model (great-retrofit-v3.nlogox): licence not stated in the file; to be confirmed by the model's owner
- 2026-11-11 — Gate 3 (residential rule): user chose residential + probable (8,105 buildings: 433 tagged + 7,672 guessed building=yes >=30 m2) as the model's buildings; remaining 1,111 are unbound scenery
- 2026-11-11 — Gate 4 (map verified + style frame): user ACCEPTED the frame as shown, knowing the beauty-review Gate-4 subset FAILED (criterion 6 = 3, avg 3.67, 3 rounds). Captures in visual/review/round-3 and map-data/verify. Beauty review Gate-4 subset FAILED honestly (criterion 6 = 3, average 3.67); see visual/review/review.md. Disclosed: storeys re-assumed by rule (compose.py), landmark = Sainte-Madeleine church (named religious rule), decorative lamps/parked cars/trees.
- 2026-11-11 — Gate 5.1 (agents → structures): households bound to the 8,105 residential+probable buildings (433 tagged + 7,672 guessed), units per building by the model's rule round(area×storeys×0.8/80) (~31,284 households, storeys assumed); tenure simulated by the model's seeded draw; 1,111 other buildings unbound scenery
- 2026-11-11 — Gate 5.2 (displayed fields): all declared — building: tenure, units, adopted units, shared-measure status; household: quintile, area, income, savings, horizon, retrofit state
- 2026-11-11 — Gate 5.3 (step unit): months (1 tick = 1 month; horizon default 360)
