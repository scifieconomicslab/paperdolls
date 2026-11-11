# <World Name> — the world record

<!-- Copy this file to /worlds/<world_name>/<world_name>.md and fill it in.
     Keep the required sections and their order. The description is the user's
     words, verbatim. The decisions log is append-only. Anything the pipeline
     inferred is labelled `assumed`. The world is a project with versioned
     snapshots, not a single mutable folder. -->

## Description

<!-- The user's one paragraph, verbatim. What is this place? Why does it exist?
     Who is the model for? -->

## Step count type

<!-- Set at Gate 5. One of: hours | days | weeks | months | years | tick -->

## Agents and structure mapping

<!-- The table's content is structures; buildings are the common kind. -->

| NetLogo breed | Meaning in the model | Rendered as (structure kind / archetype) | Count |
|---|---|---|---|
| <breed> | <what it represents> | <block / apartments / …> | <n> |

## Interactive parameters

| Parameter | Default | Range | Live (interactive) by default |
|---|---|---|---|
| <name> | <value> | <min>–<max> | yes / no |

Parameters live in the model's inline `params` block in `sim-code/model.ts`;
the step count type is time and is honoured by the timeline, not by a parameter.

## Dashboard outputs

<!-- What the bottom dashboard shows: the model's declared outputs (plot pens,
     monitors, series) the user picked at Gate 1. Must have at least one row. -->

| Output | Source (plot pen / monitor) | Shown |
|---|---|---|
| <name> | <pen or monitor name> | yes |

## Top colour

<!-- Gate 5. The one declared output variable the roofs/tops represent. -->

- variable: <field>
- kind: <continuous | categorical>
- range: <min>–<max> (or the states, in order)
- ramp: <the data ramp named in art-bible.md, e.g. heather>; pale = <low / first state>, deep = <high / last state>
- means: <what the ramp means, optional>

## Structural modifications

<!-- Gate 5. Each accepted reading: a declared variable drawn in the world's
     fabric. The generic treatments are mark, overlay, replacement, growth,
     state, extent; the real family's presets are band, scaffold, wrap,
     panels, flag, tint and outline. -->

| Variable | Treatment | Preset | Scale | Label |
|---|---|---|---|---|
| <field> | <generic> | <preset> | <categorical / sequential / threshold> | <legend label> |

## Causal graph

<!-- Gate 5. Confirmed by the user. If none is confirmed, say so and omit the
     impact view. -->

- confirmed: yes / no
- source: <llm-proposed + user-confirmed | user-authored>
- nodes: <variable, …>
- edges: <from → to, …>

## Scenarios and interventions

<!-- Gate 5. Model-declared interventions the user wants as toggles or named
     scenarios. Two-run comparison only; full scenario matrices are out of
     scope for this version. -->

| Scenario | Interventions | Compared |
|---|---|---|
| <label> | <intervention, value> | yes / no |

## Map

- source: <osm-overpass <relation id|bbox> | constructed>
- family: <real|historical|fantasy|scifi>
- palette: <palette family id from reference/render/palettes.json>
- look: house
- stored: `map-data/extract.json` (sha256: <hash>) or `map-data/spec.json`
- frame rotation: <deg, chosen by <method>>; structures fitting an asset: <%>
- archetype cascade: <version>; fallback share: <%> (seeded; seed <n>)
- storeys assumed: <%>
- report: `map-data/scene_report.md` (counts, assumptions, warnings)

## Decisions log

<!-- Append one line per gate decision, dated. Never rewrite earlier entries. -->

- YYYY-MM-DD — Gate 1 (agents + interactive parameters + dashboard outputs): <decision>
- YYYY-MM-DD — Gate 2 (world name + description): <decision>
- YYYY-MM-DD — Gate 2b (art bible + family/palette): <decision>
- YYYY-MM-DD — Gate 3 (map source): <decision>
- YYYY-MM-DD — Gate 4 (map verified + style frame): <decision>
- YYYY-MM-DD — Gate 5 (binding + step count + top colour + structural modifications + causal graph + scenarios): <decision>
- YYYY-MM-DD — Gate 6 (parity + determinism): <decision + pointer to sim-code/parity.md>
- YYYY-MM-DD — Gate 7 (visualization + checks + user sign-off): <decision>

## Snapshot

- version: <id>
- date: <YYYY-MM-DD>
- changed: <what changed since the previous snapshot>

## Attribution

<!-- If the scene derives from OpenStreetMap: "- OpenStreetMap: © OpenStreetMap contributors (ODbL)" -->
- paperdolls: CC BY 4.0, Sci-Fi Economics Lab
- Colour-figure concept after Colorfigures, April Zhu (MIT)
- <model licence, e.g. the NetLogo model's licence as converted>
