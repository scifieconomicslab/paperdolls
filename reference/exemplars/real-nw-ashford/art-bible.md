# Art bible — conformance (Ashford, constructed)

status: exemplar — accepted by the user as the paperdolls quality bar on 2026-11-11 (built from the skills alone; beauty review 3.8/5, round 4)

## Mood
- three material nouns: wet red brick, blue-grey slate, white-painted window frames
- moment: about 4 pm, late October, the rain has just stopped; low sun breaking through from the south-west
- one-line feeling: "a tidy, rain-washed brick town where the lamps are about to come on"

## Palette (built with scene-craft/recipes/palette-method.md)

Hue hints from `reference/render/palettes.json` → `nw` / `brick` (dark red brick,
slate roofs, wet grey asphalt). Every value below is re-derived in OKLCH; the
JSON hex values were not used directly. Code: `page/src/scene/palette.ts`.

| role | OKLCH | hex | note |
|---|---|---|---|
| ground (plots, pavement) | 0.94 0.010 80 | (round 4; was 0.89) | lightest band; pale limestone flags |
| sidewalk | 0.89 0.010 75 | (round 4; was 0.84) | consistently a step darker than ground |
| kerb | 0.90 0.010 80 | `#e1ddd7` | granite kerb line |
| road (wet) | 0.42 0.012 250 | `#484e54` | after-rain value band (0.35–0.45) |
| wall — red brick | 0.58 0.075 35 | `#a26a5c` | dominant |
| wall — brown brick | 0.65 0.060 48 | `#ae856f` | |
| wall — yellow brick | 0.76 0.050 78 | `#c3ae8e` | gault / Flemish yellow |
| wall — render | 0.82 0.018 88 | `#c9c4b7` | civic + some villas |
| roof — slate | 0.40 0.022 255 | (round 4; was 0.44) | hue 220° from brick walls |
| roof — clay pantile | 0.43 0.065 42 | (round 4; was 0.47) | same hue family as brick, 0.11–0.29 L darker |
| roof — dark glazed tile | 0.35 0.028 30 | (round 4; was 0.38) | |
| trim / window frame | 0.93 0.012 90 | `#ebe8df` | white frames on dark walls |
| glass | 0.50 0.030 240 | `#546673` | toward the sky; darker than any wall |
| vegetation — green | 0.56 0.090 138 | `#5a814c` | |
| vegetation — olive | 0.62 0.085 118 | `#818d51` | |
| vegetation — autumn | 0.68 0.100 85 | `#b5934a` | late-October turning canopies |
| lawn | 0.70 0.070 130 | `#90a879` | wet grass |
| water | 0.62 0.060 222 | `#5c8fa0` | |
| accent — teal | 0.58 0.085 195 | `#2d8a8a` | doors, shutters, shop fascias, awnings |
| accent — harbour blue | 0.55 0.110 232 | `#0a7ca6` | buses, some doors |
| ink | 0.24 0.020 40 | `#281c18` | |
| sky top / horizon | 0.83 0.050 245 / 0.93 0.025 75 | `#adcbe6` / `#f2e6d6` | cool zenith, warm sunlit haze |
| data ramp ("heather", sequential) | 0.93 0.03 285 → 0.66 0.10 307 → 0.38 0.12 330 | `#e5e6fc` → `#a282c2` → `#642560` | shares no hue with accent (195–232°) or brick (35–48°) |
| no data | 0.65 0.005 90 | `#908f8c` | always with a 45° hatch |
| plinth soil / rock | 0.55 0.03 60 / 0.45 0.025 55 | `#7f6e60` / `#615248` | world-edge strata |

The world record's declared top-colour direction is `red→green`. That ramp is
banned (G3, palette-method §3) and is replaced by "heather"; low depth is pale,
high depth is deep plum.

## Light
- key: azimuth 175° (screen upper-left with the camera at 45°), elevation 28°, 4,000 K (`#ffd2a2`), intensity 2.6; exposure 1.3 (AgX)
- fill (sky): 9,000 K (`#d6e1ff`), hemisphere 1.7; ground bounce = ground × 0.6 (`#868279`)
- shadow tint: `#6e7886` (cool), opacity ≈ 0.6 through the fill
- fog / atmosphere: colour = horizon `#f2e6d6`, starts just beyond the view at overview, density low
- dusk behaviour: no day cycle; a fixed moment. ~12 % of windows already lit (warm 2,700 K), lamps off

## Density and skyline
- height gradient: 2 storeys at the town edge (villas, sheds) rising to 5–6 storeys around the market square; nothing above 6 except the landmark
- landmark: a brick hall-church with a tall slate spire on the block west of the market square. Invented for this constructed world, labelled as invented; it is one model structure like any other, with a larger merged footprint
- street character: 6 m wet asphalt lanes with 2.5 m stone pavements and a 15 cm granite kerb; 9 m avenues with lime trees every 10 m and 4 m pavements; parked cars on locals, no markings on locals except crossings
- world edge: diorama plinth, 8 m deep, soil and rock strata, a pale stone lip

## Signature motif
Crow-stepped brick gables (trapgevels) on gable ends: the end walls rise above
the roof slope in 5 steps. On ≥ 1 in 4 pitched-roof buildings, always on the
landmark's west front and on terrace end units.

## Life (decorative unless the model tracks it)
- what moves: cars and a few buses, pedestrians on pavements and the square, chimney smoke, a flock of gulls
- how much: quiet — vehicles per 100 m of road: local 1.0, avenue 2.0 (raised from 0.5/1.5 in round 4: at 0.5 no moving car entered the street frame); pedestrians per 100 m of pavement 3, ×3 on the square
- model agents that move: none (structures are anchored)

## Data in the world
- beauty-view treatment of the top colour: pitched roofs — roof tint 8 % toward the ramp + full-strength 0.75 m ridge cap; flat roofs — coping band (recipe default is 45 % tint; at 45 % data covered ~40 % of building pixels and lifted roofs above the walls in value)
- data-lens look: neutral warm-grey world, roofs and upper 30 % of walls in the ramp
- what the user should notice first: which parts of town have deep retrofits (plum ridges) and which roofs carry the "approved" pennant

## Not this
- not a beige plane of uniform red boxes (the old conformance look)
- not a Dutch-postcard pastiche: no windmills, tulips or canal houses in candy colours
- not sunny-Mediterranean: no bright whitewash, no saturated terracotta, no hard blue sky
