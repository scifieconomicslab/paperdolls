# Art bible — brussels-sonnet (Jette, Brussels · real / nw / brick)

status: approved 2026-11-11

## Mood
- three material nouns: red-and-orange brick, white stone banding, slate
- moment: about 3 pm, late May, clear sunny sky, dry streets; sun high in the south-west (the user asked for "a nice, sunny day")
- one-line feeling: "a leafy brick-terrace commune on the first warm afternoon of the year"

## Palette (built with scene-craft/recipes/palette-method.md)

Hue hints: `palettes.json` → `nw` / `brick` (dark red brick, slate roofs). Every value below is re-derived in OKLCH; the JSON hex values are not used. This palette is a **proposal chosen by eye** (the page's About panel says so).

| role | OKLCH | hex | note |
|---|---|---|---|
| ground (plots, pavement) | 0.95 0.010 85 | `#f1eee7` | lightest band; pale limestone flags |
| sidewalk | 0.88 0.012 80 | `#dcd7cf` | consistently a step darker than ground |
| kerb | 0.91 0.010 80 | `#e5e1da` | bluestone kerb line |
| road (dry asphalt) | 0.50 0.010 255 | `#5f6469` | dry-day band 0.42–0.58 |
| setts (cobbled strips) | 0.62 0.012 75 | `#8a857e` | tram/old-street inlay |
| wall — red brick | 0.60 0.085 38 | `#ac6e5b` | dominant |
| wall — orange brick | 0.68 0.075 52 | `#be8b6d` | |
| wall — cream stone / render | 0.80 0.045 88 | `#cabd9d` | |
| wall — painted white | 0.85 0.015 90 | `#d1cdc3` | |
| roof — slate | 0.38 0.020 258 | `#3c434d` | hue 220° from brick |
| roof — clay pantile | 0.46 0.075 45 | `#7b4a34` | same family as brick, 0.14–0.22 L darker |
| roof — zinc | 0.34 0.015 250 | `#323940` | mansards and flat roofs |
| trim / window frame / stone banding | 0.94 0.010 90 | `#eeebe4` | white stone bands and frames on brick |
| glass | 0.52 0.035 235 | `#566d7a` | |
| vegetation — spring green | 0.52 0.095 140 | `#4a7640` | |
| vegetation — fresh leaf | 0.62 0.100 128 | `#75924e` | |
| vegetation — lime-light | 0.70 0.105 118 | `#98a759` | sunlit canopy |
| lawn | 0.74 0.085 125 | `#9eb579` | |
| water | 0.66 0.065 220 | `#639cae` | |
| accent — cornflower | 0.58 0.105 235 | `#2c83af` | doors, shutters, awnings, bike frames |
| accent — teal | 0.62 0.100 205 | `#1d97a3` | doors and shop fascias |
| ink | 0.24 0.020 40 | `#281c18` | |
| sky top / horizon | 0.84 0.065 240 / 0.94 0.020 85 | `#a5d1f1` / `#f1eadc` | clear blue zenith, warm haze |
| data ramp ("heather", sequential) | 0.93 0.03 285 → 0.66 0.10 307 → 0.38 0.12 330 | `#e5e6fc` → `#a282c2` → `#642560` | 40°+ from accent (205–235°) and brick (38–52°) |
| from binding | — | — | none yet; filled at Gate 5 |
| no data | 0.65 0.005 90 | `#908f8c` | always with a 45° hatch |
| plinth soil / rock | 0.55 0.03 60 / 0.45 0.025 55 | `#7f6e60` / `#615248` | world-edge strata |

The accent is brick's opposite (hue ≈ 38° vs. 205–235°). The sky and the accent are the same hue family on purpose, so doors read as a note of sky.

## Light
- key: azimuth 215° (south-west), elevation 42°, 5,200 K (`#ffe2c4`), intensity 2.6, exposure 1.3 (AgX)
- fill (sky): 9,500 K (`#cfe0ff`), hemisphere 1.8; ground bounce = ground × 0.6 (`#8f8c85`)
- shadow tint: `#6e7886` (cool), opacity ≈ 0.55 through the fill
- fog / atmosphere: colour = horizon `#f1eadc`, starts beyond the view at overview, density low
- dusk behaviour: no day cycle; fixed afternoon, windows unlit, lamps off

Elevation 42° is above the 35° threshold in palette-method, so ground stays at 0.95 as authored.

## Density and skyline
- height gradient: 2–3 storeys on the residential streets (brick terraces), rising to 4–5 along the main avenues and at corner buildings; nothing above 5 except the landmark. Final heights come from OSM tags where they exist; others are assumed and counted.
- landmark: the largest or most distinctive real footprint in the extract (expected: a hospital campus or a church; the actual one is chosen from the OSM data at Gate 3/4, not assumed now)
- street character: 6 m asphalt lanes, 2.5 m stone pavements and a 15 cm bluestone kerb; main avenues with plane or lime trees every 10 m; parked cars on locals; cobbled setts only where OSM says `surface=sett`/`paving_stones`
- world edge: diorama plinth, 8 m deep, soil and rock strata, a pale stone lip

## Signature motif
White-stone banding: a pale stone course at every floor line and stone window sills on brick, plus a three-sided first-floor bay window (the bow window of the Brussels terrace house) on ≥ 1 in 5 brick terrace buildings.

## Life (decorative unless the model tracks it)
- what moves: cars, a few cyclists, pedestrians on pavements, pigeons
- how much: quiet-to-busy sunny afternoon — vehicles per 100 m of road: local 1.0, avenue 2.0; pedestrians per 100 m of pavement 3
- model agents that move: none (households are anchored to buildings)

## Data in the world
- beauty-view treatment of the top colour: pitched roofs — roof tint 8 % toward the ramp + full-strength ridge cap; flat roofs — coping band
- data-lens look: neutral warm-grey world; roofs and upper 30 % of walls in the ramp
- what the user should notice first: which streets have retrofitted roofs, and where the shared-measure (condo) buildings are

## Not this
- not a beige plane of identical red boxes
- not a Dutch or Flemish pastiche: no canal houses in candy colours, no windmills
- not an overcast grey Brussels: no wet streets, no rain-dark brick, no hazy low sun; this is a bright blue-sky day with hard, short shadows
