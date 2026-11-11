# Final report — brussels-inkling

World: `worlds/brussels-inkling/` — Jette (Brussels), OSM relation 58258, run against THE GREAT RETROFIT v3 (NetLogo port). 2026-11-11.

## Gates

| Gate | Status | Evidence |
|---|---|---|
| Preflight | PASS (with 4 FAIL lines recorded) | `skill-gaps.md` — 4 missing checkout files; NetLogo 7.0.4 present; page scaffolded from `worlds/conformance/page` per the brief |
| Gate 1 — model brief | PASS | `brussels-inkling.md` §Agents, §Interactive parameters, §Dashboard outputs |
| Gate 2 — world record | PASS | §Description, §Step count type = months (horizon doubled to 360 per the brief) |
| Gate 2b — art bible | PASS | `art-bible.md` (brief answers: real / north-west Europe / brick, 3 pm late May sunny, plum ramp, polychrome brick + crow-stepped gables, UZ Brussel landmark) |
| Gate 3 — map source | PASS | OSM relation 58258 ingested; 9,216 structures / 8,105 dwellings; rotation 0.0°; 93% seeded-fallback economic classes (recorded — not data); 99% storeys assumed (recorded) |
| Gate 4 — map + style frame | PASS | `map-data/verify/*.png`; round-1 beauty subset average 4.0 |
| Gate 5 — binding | PASS | `sim-code/model-binding.json` validated against `schemas/model-binding.json` (PASS, re-checked 2026-11-11) |
| Gate 6 — parity + determinism | PASS | `sim-code/parity.md`, `sim-code/results/compare.md` — 200-run ensemble, max abs z = 0.00, KS p = 1.000 on all eight pens; seed-0 vs NetLogo bitwise to ~1 ulp; determinism byte-identical both sides |
| Gate 7 — sign-off | PASS (per brief sign-offs) | this report; `visual/review/review.md`; FPS below |

World record: `tools/check-world.py` → **OK**.
Binding: `schemas/model-binding.json` → **PASS**.
Single-file check: `tools/bench/check-single-file.mjs visual/index.html` → **PASS** (no external references of any kind).

## The page

- Path: `worlds/brussels-inkling/visual/index.html`
- Size: **9.69 MB**, one self-contained file; no network at view time (G10 PASS)
- Opens offline at Sint-Pietersplein (the commune's place=square); 22,993 model units anchored to the 8,105 real dwellings; the rest render but carry no households
- Build: `PAPERDOLLS_WORLD=/data/ScifiEconomicsLab/paperdolls-minimal/worlds/brussels-inkling npm run build`

## FPS

`node tools/bench/fps.mjs worlds/brussels-inkling/visual/index.html --dpr 1 2` (182-frame sample per run):

| dpr | p50 | p95 | max | frames | errors | verdict |
|---|---|---|---|---|---|---|
| 1 | 16.7 ms | 16.7 ms | 16.8 ms | 182 | 0 | PASS |
| 2 | 16.7 ms | 16.7 ms | 16.8 ms | 182 | 0 | PASS |

Caveats: the tool samples 182 frames, not a long session; the model steps on the **main thread** at up to ~4 months per second of play (up to ~4 ticks per frame), and each tick costs ~20 ms (node) to ~30–40 ms (browser) at 22,993 units. No worker is wired, so a long fast-forward can outrun the frame budget; the page remains correct but not guaranteed 60 fps during multi-tick frames. This is recorded, not hidden.

## ui-rules (paperdolls-gates)

G1 PASS — appearance changes only via the binding (roof plum tint ≤ 8% + ridge cap/coping band = `retrofit_share`; azure #398ccc pennant = `shared_pending`; zinc storey segments bottom-up = `retrofit_share` extent); missing data → grey + 45° hatch.
G2 PASS — paper-doll people, one neutral tone; no hair/skin/ethnicity signals anywhere (legend included).
G3 PASS — no red↔green spectrum anywhere (plum sequential ramp; azure flag; zinc cladding; semantic single colours only).
G4 PASS — the renderer computes no economic quantity; values verbatim from runtime frames; derived labels marked.
G5 PASS — "No data" state on every declared variable and in the lens; spot-checked with an empty quintile.
G6 PASS — inventions labelled in the About drawer (stalls, traffic, trams, cars, pedestrians, smoke, pigeons, hedges, gault courses, palette/archetype grammars, seeded auto-archetype rule).
G7 PASS — © OpenStreetMap contributors (ODbL) in About + footer; paperdolls CC BY 4.0; Colorfigures (April Zhu, MIT); model CC BY 4.0 with the placeholder disclaimer.
G8 PASS — same params + seed → byte-identical frame stream; 10-pass byte-identical reruns on both sides; parameters change = new run from t=0; re-seed only user-requested.
G9 PASS — visible `:focus-visible` ring; keyboard pan/zoom/fit/play/lens (A/D, W/S, F, Space, L); `prefers-reduced-motion` honoured; text contrast ≥ 4.5:1.
G10 PASS — single-file check PASS; no fetches, fonts, CDN, telemetry.

Process checks: two-layer UI (policy sidebar / About analyst layer, raw-series export + parity summary); units and labels on every displayed quantity; scenarios = Baseline + four **parameter presets** (the model declares no interventions — each restarts from t=0 with the same runtime seed; no invented scenarios); impact view draws only the binding's confirmed causal graph; no recorded trajectory shipped.

## Beauty review

Bar: `reference/exemplars/real-nw-ashford` — average 3.8; criteria 1 (value structure) and 9 (edge and framing) = 3; the rest 4.

| criterion | exemplar | round 1 (Gate-4 subset) | round 2 (full rubric) |
|---|---|---|---|
| 1 value structure | 3 | 4 | 4 |
| 2 palette harmony | 4 | 4 | 4 |
| 3 data restraint | 4 | — | 4 |
| 4 silhouette and skyline | 4 | — | 4 |
| 5 facade detail | 4 | 4 | 4 |
| 6 street and ground | 4 | 4 | 4 |
| 7 life | 4 | — | 4 |
| 8 light and depth | 4 | 4 | 4 |
| 9 edge and framing | 3 | — | 4 |
| 10 bible fidelity | 4 | 4 | 4 |
| average | 3.8 | 4.0 | **4.0** |

Rounds: **2** (round 1 = Gate-4 subset, round 2 = full rubric). Squint (round 1): light 4% (≥ 2%), mean 122 (within 100–130), stddev 26 (≥ exemplar 24); bands separate in both rounds. Every criterion ≥ the exemplar's; average 4.0 ≥ 3.8 → PASS. Captures: `visual/review/round-1/`, `visual/review/round-2/` (neighbourhood, overview, street ×2 angles, lens, 6 time-clips, squint).

Known residual gaps vs the exemplar (recorded, accepted): shopfront/awning density (593 vs its constant commercial frontage), grime/dirt variation (our sunny 3 pm brief argues against it), and facade richness on party walls. We win on edge-and-framing (commune-silhouette plinth), tree density (8,449 data trees) and the market square as a focal point.

## Parity

- Ensemble (the gate that ran): 200 runs × 360 ticks, n-buildings=200, horizon-months=360, seeds 0–199, scene-seed=0, both sides; ticks 100/250/360; Bonferroni. **All eight pens PASS — max abs z = 0.00, KS p = 1.000** (`sim-code/results/compare.md`).
- Smoke test: seed 0, n-buildings 200, horizon 180 — public-cost 976173.9863815566 both sides; bills-saved t=180 3680776.0074643 both sides; votes-passed 7 both sides.
- Determinism: byte-identical CSVs, seeds 1–10 × 200 ticks, both sides (`det-*.csv`).
- NetLogo 7.0.4 @ `tools/NetLogo`. PRNG rewritten to native 32-bit ops (profiling: `nlBitAnd` loop was 68.7% of conversion time); outputs byte-identical after the rewrite (full 200-run re-run + compare PASS).
- **Recorded limitation:** parity was run on the synthetic scene, not on the real-Jette layer. The agent logic is the same code path; footprint/storeys come from the map instead of the lognormal draw. Procedure-level fixtures were not built — the ensemble is weaker evidence per-procedure but discriminates the conversion.

## Snapshots

- `snapshots/v1` — 2026-11-11 — **manifest sha256 41ad8461cd2bb1ffddc399c4db23521a7aa783a19676c5ac3a57d3ef156a672b** (files: scene.json, extract.json, model.ts, model-binding.json, brussels-inkling.md; append-only; see `snapshots/LOG.md`).

## Numbers that are guessed (all labelled in the page and the record)

- **93%** of 9,216 structures classed by a seeded fallback (8,545) — economic classes are not data; residential binding 8,105 (433 tagged + 7,672 probable `building=yes` ≥ 30 m² guessed to be homes).
- **99%** of storeys assumed from type/global defaults — never measured.
- Height gradient, archetype mix, tree placement, gault banding, crow-steps: grammar proposals, not observations.
- Decorative and invented: traffic, trams, parked cars, pedestrians, chimney smoke, pigeons, hedges, market stalls, street layout of plantings.
- R0 motorway ring and untagged open grounds absent from the ingest; renders as muted grass (not invented roads/hedges).

## Scenarios

The NetLogo source declares **no interventions**. The five named scenarios (Baseline; Generous rebate; Public service; Means-tested, refundable; Passthrough) are bundles of declared parameters; each restarts from t=0 with the same runtime seed. They are comparisons, not actions.

## The one thing I am least sure about

**The scenarios-as-parameter-presets reading of the brief's "scenarios = baseline plus four."** The model declares no interventions, so I could not wire scenario buttons to scripted events; instead each preset is a fresh run from t=0 with the same seed — which is the only honest reading, but it means the page cannot *nudge the world mid-run*, only restart it, and two runs of the same preset are pixel-identical (by design, G8). If the brief intended live, in-run interventions applied to a running world, the page does not do that and the binding would need `intervention` entries the model does not declare. Given "Never invent," I chose the parameter-preset reading and said so everywhere it matters. Runner-up concern: the main-thread sim at 22,993 units (~20–40 ms per tick, up to 4 ticks per frame) — measurable, recorded, and acceptable to the FPS tool's short 182-frame sample, but it is a real cost and the single-threaded page is the weakest engineering link in the delivery.

## What is not done

- No worker for the model loop (above).
- Parity on the real-Jette layer (recorded limitation; agent logic identical).
- Procedure-level fixtures (`tools/agents/test/procedures.test.ts` style) not built.
- Gate-3 unit count corrected (22,986 → 22,993) in the mapping table only; the Gate 3 log line stands as written (append-only), correction noted in Gate 7.
- Nothing committed to git (per the brief); no changes outside `worlds/brussels-inkling/`.
