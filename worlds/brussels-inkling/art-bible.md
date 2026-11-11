# Art bible — brussels-inkling

status: approved 2026-11-11

## Mood
- three material nouns: red brick, slate, sun-struck limestone
- moment: 3 pm, late May, full sun, sky near-clear with a low warm haze at the horizon (Brussels: high sun, short shadows, everything legible)
- one-line feeling: "a brick suburb at lunchtime — orderly, scrubbed, faintly bureaucratic, waiting for the retrofit vans"

## Palette (built with scene-craft/recipes/palette-method.md)

Hue hints from `reference/render/palettes.json` → `nw` / `brick` (walls
#9c543e family, slate roofs, green accents). Every value below is re-derived
in OKLCH; the JSON hex values were not used directly. Code: `page/src/scene/palette.ts`.

| role | OKLCH | hex | note |
|---|---|---|---|
| ground (plots, pavement) | 0.93 0.012 85 | `#ebe7df` | lightest band; sunlit limestone flags |
| sidewalk | 0.875 0.014 78 | `#dbd5cc` | consistently a step darker than ground |
| kerb | 0.88 0.012 85 | `#dbd7cf` | granite kerb line |
| road | 0.55 0.008 250 | `#6e7276` | dry asphalt in full sun, never glossy |
| wall — red brick | 0.56 0.075 35 | `#9b6456` | dominant |
| wall — brown brick | 0.62 0.062 48 | `#a67b66` | |
| wall — gault / Flemish yellow | 0.74 0.052 80 | `#bca886` | |
| wall — render | 0.84 0.016 88 | `#cfcabf` | civic + some interwar villas |
| roof — slate | 0.40 0.020 255 | `#414853` | hue ~220° from brick walls |
| roof — clay pantile | 0.44 0.065 42 | `#714635` | same hue family as brick, clearly darker |
| roof — dark glazed tile | 0.34 0.028 32 | `#45332f` | |
| trim / window frame | 0.93 0.010 90 | `#eae8e0` | white frames on dark walls |
| glass | 0.52 0.032 238 | `#586c7a` | toward the sky; darker than any wall |
| vegetation — green | 0.56 0.095 140 | `#55824b` | |
| vegetation — olive | 0.62 0.085 118 | `#818d51` | |
| vegetation — fresh late-May | 0.66 0.105 125 | `#839d53` | high sun, fully leafed |
| lawn | 0.68 0.075 128 | `#8ba16f` | |
| water | 0.60 0.055 222 | `#5b8898` | canal basins, ponds |
| accent — bottle green | 0.55 0.105 172 | `#08856a` | doors, shutters, awnings, shopfronts |
| accent — deep teal | 0.50 0.095 205 | `#00727d` | enamel shop signs, some doors |
| ink | 0.22 0.018 45 | `#221814` | hue = shadow hue, never #000 |
| sky top / horizon | 0.78 0.055 245 / 0.93 0.030 90 | `#9bbcd9` / `#f0e7d2` | clear zenith, warm sunlit haze |
| data ramp ("plum", sequential) | 0.93 0.025 318 → 0.64 0.115 340 → 0.35 0.130 352 | `#efe3f3` → `#ba6fa2` → `#680f41` | shares no hue with accent (172–205°) or brick (35–48°) |
| from binding | flag azure 0.62 0.125 245 | `#398ccc` | fixed input; shared-measure pennant; ≥ 40° from accent teal (205), far from ramp (318+) |
| no data | 0.64 0.008 90 | `#8e8c87` | always with a 45° hatch |

## Light
- key: azimuth 220° (south-west), elevation 50°, 4,900 K (`#ffedd6`), intensity 2.7; exposure 1.32 (AgX)
- fill (sky): 8,500 K (`#dfe8ff`), hemisphere 1.6; ground bounce = ground × 0.6 (`#8f8c86`)
- shadow tint: `#5f6a78` (cool), opacity ≈ 0.55 through the fill
- fog / atmosphere: colour = horizon `#f0e7d2`, starts just beyond the view at overview, density low
- dusk behaviour: fixed moment; ~8 % of windows lit warm 2,700 K; lamps off (mid-afternoon)

## Density and skyline
- height gradient: 2 storeys at the edges (villas, sheds) rising to 3–4 around the centre; nothing above 5 assumed storeys anywhere; the UZ Brussel university-hospital block in the north-west (71×57 m footprint, 4 storeys assumed, never measured) anchors the skyline by mass, not height; the Sint-Pieterskerk on the market square is a real 1,277 m² 1-storey civic building (1 level assumed, not measured)
- landmark: the UZ Brussel hospital complex (real, from OSM relation 58258 — the named buildings `UZ-A`/`UZ-F` and the 4-storey slab on Laarbeeklaan, 6,000–7,000 m² footprints); labelled as real-world data, not invented; it is one model "building" cluster like any other as far as the model is concerned
- street character: 6 m asphalt with 2.5 m pavements and a granite kerb; wider avenues carry tram tracks (117 tram-flagged roads in the data) with overhead catenary; plane trees along avenue segments; cycle lanes on cycleways; parked cars on locals
- world edge: diorama plinth, 8 m deep, soil and rock strata, a pale stone lip

## Signature motif
Polychrome brick banding — a yellow-gault or brown brick string course wrapping
the facade at storey lines (interwar Jette brick). On ≥ 1 in 5 pitched-roof
and render facades; always on gable ends of terraces. Implement as a thin
contrasting band at each storey line.

## Life (decorative unless the model tracks it)
- what moves: cars and a few buses, trams on the tram alignments, pedestrians on pavements and around the hospital and Laarbeeklaan cafés, pigeons (not gulls), faint chimney smoke from a few render chimneys
- how much: quiet — vehicles per 100 m of road: local 0.7, avenue 1.5; pedestrians per 100 m of pavement 2.5 (×3 near the hospital); tram every ~6 min equivalent visual density
- model agents that move: none (structures are anchored)

## Data in the world
- beauty-view treatment of the top colour: pitched roofs — roof tint ≤ 8 % toward the ramp + full-strength 0.75 m ridge cap; flat roofs — coping band (hospital/university slabs); roof furniture and banding keep the brick read
- data-lens look: neutral warm-grey world, roofs and upper 30 % of walls in the plum ramp
- what the user should notice first: which roofs carry the deep plum cap (high retrofit share) and which condos carry the azure pennant (a shared-measure vote is pending)

## Not this
- not a beige plane of uniform red boxes
- not a Dutch-postcard pastiche: no windmills, no canal houses in candy colours
- not rainy: this is the sunny exemplar's opposite — no wet asphalt, no grey sky; if it looks like Ashford after rain, the moment was lost
- not Mediterranean: no whitewash, no terracotta hillsides
