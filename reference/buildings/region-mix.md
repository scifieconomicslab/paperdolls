# The `real` family — regional archetype mixes and facade grammar (proposals)

Per-palette-family weights that turn `visual_archetype: "auto"` and assumed
storeys into concrete façades. Every number here is a **proposal chosen by eye** to be
checked with local authors; nothing is locally verified. The ingest does not
read this file — it is for the renderer and for the LLM when choosing a look.

These 12 regions are the **`real` world family's palette families**. The
historical, fantasy and science-fiction families define their own structure
grammar and mixes in their family packs (`reference/render/families.md`). The
mix below applies to building footprints; walls, habitats, ruins and
infrastructure need their own grammar.

## Facade grammar and roof mix per region

`mult` multiplies the `BAND` weights (below) for the corresponding archetype.
`roof` is a weight mix. The rest are probabilities; `winK` scales window
width.

| region / palette family | mult (archetype ×) | roof mix | shutters | awning | ac | chimney | balcony | winK |
|---|---|---|---|---|---|---|---|---|
| `nw` | terrace 1.6 · villa 0.6 · shophouse 0.8 | pitch 0.9 · flat 0.1 | 0 | 0.1 | 0 | 0.5 | 0.15 | 1.0 |
| `uk` | terrace 1.8 · villa 1.0 · shophouse 0.7 | pitch 0.95 · flat 0.05 | 0 | 0.1 | 0 | 0.8 | 0.05 | 1.0 |
| `ws` | block 1.3 · shophouse 1.0 · terrace 1.0 | flat 0.35 · pitch 0.55 · hip 0.1 | 0.45 | 0.3 | 0.05 | 0.3 | 0.5 | 1.1 |
| `md` | block 1.4 · shophouse 1.0 · terrace 1.0 · villa 0.8 | flat 0.5 · pitch 0.5 | 0.6 | 0.4 | 0.25 | 0.1 | 0.4 | 0.85 |
| `ce` | block 1.6 · terrace 1.0 · shophouse 0.8 · villa 0.6 | pitch 0.5 · hip 0.2 · flat 0.3 | 0.05 | 0.15 | 0.02 | 0.3 | 0.3 | 1.0 |
| `sa` | shophouse 1.6 · terrace 1.0 · block 1.0 · villa 0.8 | flat 0.7 · pitch 0.3 | 0.05 | 0.5 | 0.3 | 0 | 0.35 | 0.8 |
| `se` | shophouse 2.0 · terrace 1.0 · block 1.0 · villa 0.5 | flat 0.6 · pitch 0.4 | 0.05 | 0.6 | 0.5 | 0 | 0.3 | 0.8 |
| `ea` | block 1.8 · tower 1.5 · shophouse 0.8 · terrace 0.4 · villa 0.3 | flat 0.85 · pitch 0.15 | 0 | 0.15 | 0.5 | 0 | 0.5 | 0.9 |
| `me` | block 1.4 · villa 1.0 · shophouse 0.8 · terrace 0.5 | flat 0.9 · pitch 0.1 | 0.1 | 0.2 | 0.6 | 0 | 0.2 | 0.6 |
| `sb` | shophouse 1.2 · villa 1.2 · terrace 0.6 · block 0.8 · shed 0.8 | pitch 0.6 · flat 0.4 | 0.05 | 0.4 | 0.1 | 0 | 0.15 | 0.75 |
| `la` | block 1.4 · terrace 1.0 · villa 1.0 · shophouse 1.0 | flat 0.6 · pitch 0.4 | 0.1 | 0.3 | 0.2 | 0 | 0.4 | 0.9 |
| `na` | villa 1.8 · terrace 0.5 · block 1.0 · shophouse 0.8 · tower 1.0 · shed 0.8 | pitch 0.6 · hip 0.1 · flat 0.3 | 0.1 | 0.15 | 0.3 | 0.6 | 0.2 | 1.0 |

## Storey bands (`BAND`) and the `auto` pick

For a building with `N` storeys whose visual archetype is `auto`:

```
N ≤ 1 :  [villa 3, shed 1, terrace 2]
N ≤ 3 :  [terrace 4, villa 2, shophouse 3]
N ≤ 6 :  [block 3, shophouse 2, terrace 1]
else  :  [tower 3, block 2]
```

Weights are multiplied by the region's `mult` for the archetype before the
weighted draw. The draw is seeded per building (`variant`), so it is stable
per building id.

## Building height

Storeys are never measured unless OSM carries `height=*` (taken raw if ≤
400 m); otherwise `levels = height / 3.1`, else `LEVELS_BY_TYPE` (a 25-entry
table from `building=*`, e.g. house 2, apartments 4, warehouse 1), else
`GLOBAL_LEVELS = 2`. `levels_source ∈ {tag, height, type-default,
global-default}`. Height is `levels × 3.1 m` (or the height tag). ~99 % of a
real extract carries assumed storeys — the report says so.

## Overlays

A simulation switches discrete overlay geometry independent of colour:
`scaffold`, `solar`, `band`, `marker`, `insulation`, `community`
(co-op colour), `segments`. They are not part of this mix; the model requests
them through the binding. In the treatment vocabulary, these are the `real`
family's preset geometry: `band`, `scaffold`, `wrap`, `panels`, `flag`, `tint`
and `outline` are the presets; `solar`, `marker`, `insulation`, `community`
and `segments` are the Look's additional channels. Other families supply
their own presets under the same generic treatments.

## Sources

`viz/buildinglib.js` @ `f9a1a59` (CC BY 4.0), tables transcribed.
