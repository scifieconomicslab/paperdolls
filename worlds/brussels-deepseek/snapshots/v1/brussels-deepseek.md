# Brussels Deepseek — the world record

## Description

A housing-retrofit model set in Jette, Brussels: owner-occupied houses, condos with shared-parts votes and a rental stub decide month by month whether to retrofit for energy savings, given their income, savings, credit access and the delivery mode the state chooses. The world is the municipality's real residential fabric from OpenStreetMap; every home sits on its mapped building, and where the map gives no storeys or homes the model guesses them.

## Step count type

months

## Agents and structure mapping

| NetLogo breed | Meaning in the model | Rendered as (structure kind / archetype) | Count |
|---|---|---|---|
| households | one household per dwelling unit, anchored to its building | unplaced at street level; shown only through its building's state and share | 16,140 (assumed unit split) |
| buildings | one anchored agent per modelled dwelling building (added for the world binding) | building / oriented mass on the mapped footprint | 5,403 |

The model's own NetLogo file has one breed (`households`) and a parallel building
table. For the world binding the buildings are promoted to an anchored breed so
that roof state, the approved pennant and the adoption cladding can read declared
fields. 5,403 dwelling buildings are selected from the 9,216 mapped structures by
`residential in (residential, probable)` and a dwelling-class whitelist; the other
3,813 structures are mapped context, not model agents. The building's `anchor` is
its index in `map-data/scene.json`.

## Interactive parameters

| Parameter | Default | Range | Live (interactive) by default |
|---|---|---|---|
| seed | 0 | 0–999 | yes |
| scene-seed | 0 | 0–999 | yes |
| n-buildings | 200 | 10–9216 | no (structural; inert when the OSM world supplies the fabric) |
| horizon-months | 360 | 12–360 | no (structural; timeline length) |
| delivery-mode | rebate_market | rebate_market / passthrough / public_service | yes |
| credit-access | income_tested | income_tested / open / none | yes |
| energy-scenario | rising | flat / rising / shock | yes |
| refundable? | false | true–false | yes |
| means-test? | false | true–false | yes |
| means-test-max-quintile | 2 | 1–5 | yes |
| deduction-rate | 0.30 | 0–1 | yes |
| rebate-lag-months | 12 | 0–36 | yes |
| loan-rate | 0.04 | 0–0.20 | yes |
| loan-rate-risk-premium | 0.02 | 0–0.10 | yes |
| vendor-margin | 0.15 | 0–1 | yes |
| public-overhead | 0.10 | 0–1 | yes |
| public-capacity | 0.05 | 0–0.20 | yes |
| shared-measure? | true | true–false | yes |
| shared-share | 0.40 | 0–1 | yes |
| vote-threshold | 0.67 | 0–1 | yes |
| consider-prob-base | 0.05 | 0–1 | yes |
| neighbour-boost | 0.30 | 0–1 | yes |
| peer-effect? | true | true–false | yes |
| free-time-spread | 0.30 | 0–1 | yes |
| canvass-target-hours | 2.0 | 0–6 | yes |
| canvass-boost | 0.20 | 0–1 | yes |
| canvass-saturation-hours | 6.0 | 1–12 | yes |
| cost-per-m2 | 300 | 50–1000 | yes |
| saving-per-m2-year | 20 | 1–100 | yes |
| discount-rate | 0.04 | 0–0.20 | yes |
| loan-term-months | 120 | 12–360 | yes |
| credit-income-threshold | 25000 | 0–100000 | yes |
| credit-loan-to-income | 1.0 | 0–3 | yes |
| savings-scale | 1.0 | 0–3 | yes |
| savings-usable-share | 1.0 | 0–1 | yes |
| savings-months-of-income | 3.0 | 0–12 | yes |
| years-in-dwelling-min | 5 | 1–25 | yes |
| years-in-dwelling-max | 25 | 1–40 | yes |
| rental-share-single | 0.10 | 0–1 | yes |
| rental-share-multi | 0.30 | 0–1 | yes |

Parameters live in the model's inline `params` block in `sim-code/model.ts`; the
step count type is time and is honoured by the timeline, not by a parameter.
`n-buildings` and `horizon-months` are `structural` and frozen in the page: the
world's building count comes from the map, and the brief fixes the horizon at
360 months.

## Dashboard outputs

| Output | Source (plot pen / monitor) | Shown |
|---|---|---|
| Adoption by income quintile | plot `adoption` Q1–Q5 | yes |
| State spend, cumulative | plot `state_spend` / public cost | yes |
| Bills saved, cumulative | plot `bills_saved` / bills saved | yes |
| Cost per retrofit | plot `cost_per_retrofit` / price | yes |
| Adopted units | monitor `adopted_units` | yes |
| Can finance remaining cost | monitor `can_front_share` | yes |
| Shared measures passed | monitor `shared_approved` | yes |
| Votes passed | monitor `votes_passed` | yes |

## Top colour

- variable: retrofit_state
- range: 0–2 (not retrofitted / partial / fully retrofitted); NaN, drawn as "no data", for rental buildings the model does not model
- direction: sequential, pale plum → deep plum (not a red↔green spectrum; G3)
- means: how far the building's homes have got through the retrofit: no unit done, some units done, all units done

## Structural modifications

| Variable | Treatment | Preset | Scale | Label |
|---|---|---|---|---|
| approved | mark | flag | categorical (true/false) | Shared measure passed |
| adoption | extent | segments | sequential 0–1 | Adoption progress — share of homes done |

- `approved` is a declared building field: true once the condo's floor-area vote has passed and every owner has paid. A teal pennant on a 2 m pole at the roof corner.
- `adoption` is the declared share of the building's units that are complete. Completed storeys (bottom-up) take a pale sage "new render" cladding panel, count = round(adoption × levels). It is geometry plus a neutral material colour; it never repaints the building.

## Causal graph

- confirmed: yes
- source: llm-proposed + user-confirmed
- nodes: delivery-mode, credit-access, means-test, deduction-rate, rebate-lag-months, energy-scenario, household-upfront-cost, financing-capacity, rebate-pv, savings-pv, npv, adoption, bills-saved, public-cost, canvass-hours, shared-approval
- edges: delivery-mode → household-upfront-cost; delivery-mode → public-cost; credit-access → financing-capacity; means-test → financing-capacity; deduction-rate → rebate-pv; rebate-lag-months → rebate-pv; energy-scenario → savings-pv; household-upfront-cost → npv; financing-capacity → npv; rebate-pv → npv; savings-pv → npv; npv → adoption; canvass-hours → shared-approval; shared-approval → adoption; adoption → bills-saved; adoption → public-cost

## Scenarios and interventions

| Scenario | Interventions | Compared |
|---|---|---|
| Baseline | none (model defaults) | yes |
| Public service | delivery-mode = public_service | yes |
| Pass-through | delivery-mode = passthrough | yes |
| Open credit | credit-access = open; refundable? = true | yes |
| Energy shock | energy-scenario = shock | yes |

A scenario is a parameter set: starting it is a new run from month 0 with the same
seed (technology skill §3). The model declares no in-run intervention, so no
intervention is invented; the four named scenarios are combinations of the
model's own chooser and switch parameters. Baseline is the default run.

## Map

- source: osm-overpass 58258
- family: real
- palette: nw
- stored: `map-data/extract.json` (sha256: def859dd90a7a4f23bf3c49f8aa53fceba7221cf9fd368da93718cf476a39d40)
- frame rotation: 0.0 deg (chosen by the ingest's asset-fit rule; north 60 deg clockwise from screen top); 29% fitting an asset (the ingest's legacy axis-aligned estimate; this world draws oriented boxes from each footprint's minimum-area rectangle, so every structure gets an oriented mass — 79% of footprints are one oriented box, 21% are simplified, counted in the report addendum)
- boundary: relation 58258 assembled into a 284-point ring (5.17 km²); it is the ground and the plinth edge, so no land outside Jette is drawn
- archetype cascade: ingest 1.0.0; fallback share: 93% (seeded; seed 7)
- landmark: `w223403345` Église Sainte-Madeleine — largest named religious footprint; real structure, raised spire is a choice
- storeys assumed: 98% overall (9,103 of 9,216); among the 5,394 modelled dwellings 5,399 of 5,494 candidate rows carry an assumed level count. Heights are mostly assumed, not measured.
- report: `map-data/scene_report.md` (counts, assumptions, warnings, addendum)

## Decisions log

- 2026-11-11 — Gate 1 (agents + interactive parameters + dashboard outputs): households anchored to their dwelling buildings; buildings promoted to a second anchored breed for the world binding; every slider/switch/chooser live except n-buildings and horizon-months (structural); all four plot groups and four key monitors on the dashboard
- 2026-11-11 — Gate 2 (world name + description): brussels-deepseek; Jette housing-retrofit world, description kept verbatim from the brief
- 2026-11-11 — Gate 2b (art bible + family/palette): real / nw / brick; 3 pm in late May, sunny; signature motif "speklagen" cream limestone bands; palette proposed in OKLCH
- 2026-11-11 — Gate 3 (map source): OSM relation 58258 (Jette); extract stored with sha256; 9,216 structures, 5,394 dwellings; overpass-api.de answered after two mirrors failed; 93% economic-class fallback and 98% assumed storeys accepted and recorded
- 2026-11-11 — Gate 4 (map verified + style frame): accepted after four capture rounds; 9,216 mapped structures / 5,403 dwellings / 16,140 households; 93% fallback classes, 98% assumed dwelling storeys, 21% footprints simplified to their oriented rectangle; boundary ring is the world edge; style frame is the avenue at the dense core; beauty Gate 4 subset PASS
- 2026-11-11 — Gate 5 (binding + step count + top colour + structural modifications + causal graph + scenarios): months; buildings anchored to scene structures; top colour `retrofit_state` on the muted plum ramp (rental = no data); readings `approved` (flag) and `adoption` (segments); causal graph confirmed from the procedures; baseline + four parameter-set scenarios; validator PASS; binding schema PASS
- 2026-11-11 — Gate 6 (parity + determinism): procedure gates 8/8 PASS (world-local, exact values); seed-0 360-month trace exact on adopted/public cost/bills/votes; 200-run ensemble PASS on 8 pens (z = 0, KS p = 1.000); TS ten passes identical; NetLogo ten runs twice identical (sha256 99735c4d…); world branch is OSM-only and not comparable; see `sim-code/parity.md`
- 2026-11-11 — Gate 7 (visualization + checks + user sign-off): built the single file (9.9 MB, zero network), ui-rules G1–G10 PASS, craft pass applied, beauty review 4.0 at round 4 (PASS), FPS and frame check recorded in `final-report.md`; approved and continued per the brief

## Snapshot

- version: v1
- date: 2026-11-11
- changed: initial world

## Attribution

- OpenStreetMap: © OpenStreetMap contributors (ODbL)
- paperdolls: CC BY 4.0, Sci-Fi Economics Lab
- Colour-figure concept after Colorfigures, April Zhu (MIT)
- Model: The Great Retrofit v3 — NetLogo port, CC BY 4.0, Sci-Fi Economics Lab (every number in the model is a placeholder; no output is a finding)
