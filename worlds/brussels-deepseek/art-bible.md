# Art bible — Brussels Deepseek (Jette)

status: approved 2026-11-11

## Mood

- three material nouns: red-brown brick, blue-grey slate, cream limestone banding
- moment: 3 pm, late May, clear and dry; the sun is high and warm from the south-west, the sky a clean pale blue
- one-line feeling: "a dense, low Brussels municipality on a bright weekday afternoon, brick and slate with white stone lines running through it"

## Palette (built with scene-craft/recipes/palette-method.md)

Hue hints from `reference/render/palettes.json` → `nw` / `brick` (dark red brick,
slate roofs, grey asphalt). Every value is re-derived in OKLCH; the JSON hex
values were not used directly. Code: `page/src/scene/palette.ts`.

| role | OKLCH | hex | note |
|---|---|---|---|
| ground (plots, pavement) | 0.965 0.012 80 | `#f8f3eb` | lightest band; pale limestone and paving |
| sidewalk | 0.965 0.010 78 | `#f7f3ec` | calibrated bright so the squint keeps a light band; kerb line separates it |
| kerb | 0.96 0.008 82 | `#f4f1ec` | granite kerb line |
| road (dry) | 0.46 0.012 250 | `#53595f` | dry asphalt in sun |
| wall — red brick | 0.57 0.093 38 | `#a6634e` | dominant, Brussels brick |
| wall — brown brick | 0.63 0.072 50 | `#ad7d62` | |
| wall — yellow brick | 0.78 0.060 82 | `#cbb48c` | gault / Flemish yellow |
| wall — white-painted render | 0.90 0.016 90 | `#e2ded2` | civic, some houses and post-war blocks; the light band at the squint |
| roof — slate | 0.34 0.022 255 | `#303943` | dominant; ≥ 0.15 L below the wall mean |
| roof — dark tile | 0.40 0.035 30 | `#59413d` | occasional clay |
| roof — zinc | 0.54 0.012 240 | `#697075` | flat roofs only, still a value step below walls |
| trim / window frame | 0.93 0.012 85 | `#ebe7df` | white-painted frames and limestone |
| glass | 0.50 0.030 240 | `#546673` | toward the sky, darker than every wall |
| vegetation — green | 0.55 0.090 140 | `#547e4b` | late-May fresh leaf |
| vegetation — olive | 0.62 0.085 125 | `#7a8f55` | |
| vegetation — light | 0.68 0.075 95 | `#a79862` | new lime and plane leaves |
| lawn | 0.70 0.070 130 | `#90a879` | |
| water | 0.62 0.060 220 | `#5c8f9f` | ponds and the canal edge |
| accent — teal | 0.58 0.120 190 | `#00908a` | doors, shop fascias, awnings |
| accent — ochre | 0.68 0.120 80 | `#bf8f34` | signage, awnings, the occasional door |
| ink | 0.24 0.020 40 | `#281c18` | dark shade, never #000 |
| sky top / horizon | 0.78 0.060 245 / 0.94 0.022 80 | `#98bcdc` / `#f3eadb` | cool zenith, warm sunny haze |
| data ramp ("plum", sequential) | 0.63 0.035 300 → 0.50 0.065 320 → 0.38 0.100 340 | `#8c859c` → `#74577a` → `#642a53` | reserved; ≥ 30° from both accents; low state muted so ridges stay slate-like |
| from binding — pennant | 0.52 0.110 195 | `#007c7c` | shared-measure mark; 5° from the teal accent, so the accent is used sparingly |
| from binding — cladding | 0.80 0.030 135 | `#b6c2af` | adopted-progress render; low chroma |
| no data | 0.65 0.005 90 | `#908f8c` | neutral, always with a 45° hatch |
| plinth soil / rock | 0.52 0.030 60 / 0.44 0.025 55 | `#766558` / `#5e4f46` | world-edge strata |

The world record's top colour is building retrofit state. It is categorical in
meaning (none / partial / all) but is drawn on a three-step sequential plum ramp
so the roofs keep one hue; rental buildings are "no data" (neutral + hatch), not
the pale end of the ramp.

## Light

- key: azimuth 175° (screen upper-left with the camera at 45°), elevation 42°, 5,000 K (`#ffe0b8`), intensity 2.7; exposure 1.3 (AgX)
- fill (sky): 9,000 K (`#d6e1ff`), hemisphere 1.45; ground bounce = ground × 0.6 (`#938f8a`)
- shadow tint: `#6f7987` (cool), opacity ≈ 0.6 through the fill
- fog / atmosphere: colour = horizon `#f3eadb`; screen-space haze 0.04 street, 0.14 neighbourhood, 0.22 overview; `scene.fog` only for the plinth edge
- dusk behaviour: no day cycle; a fixed moment. About 8 % of windows already lit (warm 2,700 K), lamps off

## Density and skyline

- height gradient: 2–3 storeys across the residential fabric, 4–6 along the avenues and around the town centre, one 13-storey tower at the north-east; the church spire is the only silhouette above that
- landmark: Église Sainte-Madeleine / Sint-Magdalenakerk (`w223403345`), the largest named religious footprint in the relation. A real structure; only its emphasis (a taller slate spire and a spire cap) is a choice, and it is labelled
- street character: 6 m local carriageways with 2–3 m pavements, 9–12 m avenues with lime trees and 4 m pavements, 15 cm granite kerbs; parked cars on locals, no centre markings on locals
- world edge: a plinth 8 m deep cut to the municipality boundary, Brussels sandy soil over pale rock, a cut earth/rock face; the boundary is the edge, unreshaped

## Signature motif

**Speklagen**: cream limestone sill and lintel bands that run continuously
across brick facades at each storey line, with white-painted window frames. On
≥ 1 in 3 brick buildings by seed, dense along the avenue frontages; the church
tower carries the same string-course detail in pale stone. It is the one detail
that makes a brick box read as a Brussels street.

## Life (decorative unless the model tracks it)

- what moves: cars and a few buses, pedestrians on pavements, chimney smoke, a flock of pigeons over the church
- how much: quiet — vehicles per 100 m of road: local 1.0, avenue 2.0; pedestrians per 100 m of pavement 3, ×1.6 on avenues and squares
- model agents that move: none. Households are anchored to their building; the model moves no agent through space

## Data in the world

- beauty-view treatment of the top colour: pitched roofs — slate tint 8 % toward the plum ramp + a full-strength 0.75 m ridge cap; flat roofs — a coping band on the parapet. Ridge/coping only carries the data at full strength; the roof material stays slate
- data-lens look: neutral warm-grey world; whole roof and the upper 30 % of walls in the state colour
- what the user should notice first: which streets have deep-plum ridges (fully retrofitted buildings) and which roofs carry the teal shared-measure pennant; then the pale sage cladding climbing the street facades

## Not this

- not a generic Northern-European suburb of identical red boxes: the map's real footprint grain and the white stone bands must be visible
- not a rainy postcard: no wet roads, no orange dusk, no lit windows everywhere; this is a dry, bright 3 pm
- not a data-painted city: the plum appears on ridge caps and coping, never as whole roofs in the beauty view
