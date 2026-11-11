# Conformance retrofit ledger — the world record

## Description

A synthetic town of 473 structures used to prove the paperdolls pipeline end to
end. A toy retrofit model tracks a depth of retrofit and an approved flag per
structure. Nothing here describes a real place or a real policy.

## Step count type

weeks

## Agents and structure mapping

| NetLogo breed | Meaning in the model | Rendered as (structure kind / archetype) | Count |
|---|---|---|---|
| structures | one anchored agent per structure; depth and approved | building / generated district archetype | 473 |

## Interactive parameters

| Parameter | Default | Range | Live (interactive) by default |
|---|---|---|---|
| subsidy | 0.35 | 0–1 | yes |
| adoption | 0.15 | 0–1 | yes |
| weather | 0.4 | 0–1 | yes |

## Dashboard outputs

| Output | Source (plot pen / monitor) | Shown |
|---|---|---|
| mean depth | plot pen `retrofit / mean depth` | yes |
| approved share | plot pen `retrofit / approved share` | yes |

## Top colour

- variable: depth
- range: 0–1
- direction: red→green
- means: depth of retrofit in the structure fabric

## Structural modifications

| Variable | Treatment | Preset | Scale | Label |
|---|---|---|---|---|
| approved | mark | flag | categorical | Approved — queued |

## Causal graph

- confirmed: yes
- source: llm-proposed + user-confirmed
- nodes: subsidy, depth, approved_share
- edges: subsidy → depth; depth → approved_share

## Scenarios and interventions

| Scenario | Interventions | Compared |
|---|---|---|
| Baseline | none | yes |
| Subsidy | grant-round (boost 0.2) | yes |

## Map

- source: constructed
- family: real
- palette: nw
- stored: `map-data/spec.json` (sha256: b1b7e6f386dfeea627f96d51925ddadf52f911c77dbad89dc4131a47a57e33c6)
- frame rotation: 0 (generated grid); structures fitting an asset: 100%
- archetype cascade: n/a (constructed); fallback share: 0% (every class is `generated`)
- storeys assumed: 0% from tags (all generated from district bands)
- report: `map-data/scene_report.md`

## Decisions log

- 2026-11-11 — Gate 1 (agents + interactive parameters + dashboard outputs): structures anchored; subsidy, adoption, weather live; two plot pens on the dashboard
- 2026-11-11 — Gate 2 (world name + description): conformance; synthetic retrofit ledger
- 2026-11-11 — Gate 2b (look + family/palette + palette variant): colorfigures, real/nw
- 2026-11-11 — Gate 3 (map source): constructed, seed 42, 640 × 480 m
- 2026-11-11 — Gate 4 (map verified): 473 structures, report read, snapshots generated
- 2026-11-11 — Gate 5 (binding + step count + top colour + structural modifications + causal graph + scenarios): depth tops; approved flag; confirmed graph; two scenarios
- 2026-11-11 — Gate 6 (parity + determinism): fixture: procedure gates n/a; TS determinism only for this toy
- 2026-11-11 — Gate 7 (visualization + checks + user sign-off): three looks built; ui-rules G1–G10 PASS; craft pass applied; single-file PASS ×3; GPU FPS 16.7 ms p50 / 16.8 ms p95 on all three; camera controls verified (wheel/drag/W/S/A/D/F); zero console errors; adaptivity (new `granary` kind + `tint` reading) rendered without any engine change

## Snapshot

- version: v1
- date: 2026-11-11
- changed: initial conformance world

## Attribution

- paperdolls: CC BY 4.0, Sci-Fi Economics Lab
- Colour-figure concept after Colorfigures, April Zhu (MIT)
- conformance model: CC BY 4.0, Sci-Fi Economics Lab (synthetic fixture)
