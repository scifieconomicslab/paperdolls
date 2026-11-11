# Beauty review — conformance (house look, rebuilt from the markdown skills)

Captures: `node tools/bench/screenshots.mjs --world worlds/conformance --beauty --round N` (1440×900, dpr 1, Brave/ANGLE).
Helpers: `review.py squint` on `neighbourhood.png`, `review.py diff` on `clip-0` vs `clip-5`.
Exemplar: **none available** (`reference/exemplars/` is empty). The side-by-side was done against the art bible's text, which lowers confidence in every score.

> **Lost captures.** `page/vite.config.ts` had `emptyOutDir: true` with `outDir = ../visual`, so every build deleted
> `visual/review/`. The round-1 and round-2 PNGs and the first copy of this file were deleted by the next build.
> The round-1 and round-2 text below is restored from the notes written at the time; the images cannot be regenerated
> because the scene changed between rounds. Fixed (`emptyOutDir: false`) before round 3; recorded in `skill-gaps.md`.

## Round 1 — 2026-11-11 (captures lost)

What each image showed:
- overview: the whole town on an 8 m soil plinth under a blue-to-warm-haze sky; a ring of grey sheds at the edge, a dense brick carpet inside, the green spire and pond findable at the centre.
- neighbourhood: tight 5–6 storey brick and render blocks around the church and pond; dark, crowded, little ground visible.
- street: the church's crow-stepped east gable and tall windows, the pond with ripples and a quay, parked cars, bollards, benches, a flat-roofed block with cornice and coping.
- street-90: the church tower with clock and belfry, crow-stepped shophouse gables, a deep tower shadow over the street.
- lens: walls neutral brown-grey, roofs and upper walls in pale-to-mid lilac; values barely differ.
- clips: cars and walkers shift a few metres.

squint: dark 48 %, mid 52 %, **light 0 %**; mean 86, sd 22. diff clip-0→5: 0.51/255, 0.70 % of pixels.

| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 2 | no light band in the squint; pavements (meant to be lightest) sat in the same grey as walls |
| 2 | palette harmony | 3 | brick, render, slate and teal fascias read; every pitched roof lilac-grey from the 18 % data tint |
| 3 | data restraint | 3 | beauty keeps bricks (data on ridge caps/copings); lens spans only pale→mid lilac |
| 4 | silhouette and skyline | 3 | spire findable in ~1 s, sheds low at the edge, but inside is a uniform 4–6 storey carpet |
| 5 | facade detail | 4 | framed windows, sills, lintels, string courses, shopfronts, awnings, crow steps, roof boxes; residential ground floors like upper floors |
| 6 | street and ground | 4 | raised pavements, rounded kerbs, wet asphalt, parking, bollards, benches, lamps, pond quay; big flat beige plots |
| 7 | life | 3 | 0.70 % pixels changed; cars, walkers and smoke move, but most cars at street zoom are parked |
| 8 | light and depth | 3 | warm/cool faces, AO at bases, crisp fitted shadows; too dark overall (mean 86) |
| 9 | edge and framing | 3 | plinth and sky gradient designed; neighbourhood opening shot a wall of blocks |
| 10 | bible fidelity | 3 | brick, slate, white frames, crow steps present; not "tidy, rain-washed": a dense dark mid-rise city |

average: **3.1 — FAIL**

side-by-side vs art bible: 1) value too dark (criterion 1; light-and-time §1, palette-method §1). 2) no 2→6 storey gradient (criterion 4; composition §2). 3) after-rain not legible (criterion 10; streets-and-ground §6).

changes: exposure/key up, lighter toon shadow step and ground; heights recomposed as a true gradient; stronger puddles; haze.

## Round 2 — 2026-11-11 (captures lost)

Changes: heights recomposed (band low end at edge → high end at the square); exposure 1.1, key 3.0, fill 1.15; toon shadow step 120→150; ground/pavement L +0.03; stronger puddles; nearer fog.

- overview: the centre rises (4–6 storeys around church and pond) and falls to 2-storey houses and the shed ring.
- neighbourhood: brighter; church upper-left of centre with the pond below it, crow-stepped shophouses, garden trees, a bus; roofs mauve.
- street / street-90 / lens: as round 1, lighter; lens spread still weak.

squint: dark 25 %, mid 75 %, light 0 %; mean 102. diff 0.50/255, 0.65 %. Sampled pavement pixel (178,165,155): authored L 0.92 (~232) renders at ~165 after the low key, AgX and AO.

| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 3 | buildings now separate from streets as shapes; still 0 % light band |
| 2 | palette harmony | 3 | slate and clay roofs both drift to mauve under the tint and warm key |
| 3 | data restraint | 3 | beauty: data only on caps/copings; lens crowds the pale end of the ramp |
| 4 | silhouette and skyline | 4 | visible rise to the square, fall to the shed ring; spire identifiable in a second |
| 5 | facade detail | 4 | as round 1 |
| 6 | street and ground | 4 | kerbs, pavements, zebras, parked cars, quay, benches, bollards, lamps, hedges |
| 7 | life | 3 | 0.65 % pixels changed; small at street zoom |
| 8 | light and depth | 3 | brighter; contrast low |
| 9 | edge and framing | 3 | subject (church + pond) placed; no depth cue into the distance |
| 10 | bible fidelity | 3 | reads as a northern brick town; "after rain" weak |

average: **3.3 — FAIL**

changes: shift light from key to sky fill (up-facing ground gains on walls), exposure 1.3; roof tint 18 % → 8 %; snapshot default tick 120 → 150.

## Round 3 — 2026-11-11

Changes: key 2.6, sky fill 1.7, exposure 1.3; roof tint 8 %; default snapshot tick 150; `emptyOutDir: false`.

What each image shows:
- overview: as round 2, lighter; gradient and spire read; shed ring at the edge; plinth and gradient sky.
- neighbourhood: light stone pavements and the square now frame the blocks; church upper-left of centre, pond below it; slate roofs blue-grey and clay roofs red-brown are distinct again; teal shop fascias; trees in autumn gold and green; a bus on the avenue.
- street: church east gable with crow steps; wet asphalt with lighter puddle patches; the pond with ripple streaks and a moored boat; parked cars, benches, bollards, lamps; a corner shop with a teal door and awning.
- street-90: tower with clock and belfry; crow-stepped shophouse gables.
- lens: walls neutral, roofs and upper walls in a visible pale→mid violet spread; a few deeper roofs stand out.
- clip diff: localized changes only on pedestrians on the pavements and faint water ripples; no moving car crosses the street frame.

squint: dark 11 %, mid 88 %, light 2 %; mean 113. Unblurred: 12 % of pixels > 170, 28 % < 85.
Sampled luminance: pavement 180, square 172, slate roof 120, clay roof 101, sunlit brick 127, shaded brick 101.
diff clip-0→5: 0.51/255, 0.63 %.

| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 3 | blocks read as shapes against light pavements in the squint, but roofs (101–120) and walls (101–127) share one band and the helper finds only 2 % light |
| 2 | palette harmony | 4 | neighbourhood: low-chroma brick/render/slate/clay with teal as the only saturated family; bible palette recognisable |
| 3 | data restraint | 4 | beauty: data limited to ridge caps, copings and an 8 % tint, bricks untouched; lens: roofs + upper walls show a readable violet spread over a neutral town |
| 4 | silhouette and skyline | 4 | overview: rise to 5–6 storeys at the square, 2 storeys and sheds at the edge; spire found in a second |
| 5 | facade detail | 4 | street: framed windows with sills and lintels, string courses, shopfront with teal door and awning, crow steps, roof boxes; residential ground floors still like upper floors |
| 6 | street and ground | 4 | raised pavements with rounded kerbs, puddled asphalt, zebras, parking, quay, benches, bollards, lamps, hedges, park paths |
| 7 | life | 3 | diff shows only walkers (and ripples) changing; no moving car is in the street frame at local-street density 0.5/100 m |
| 8 | light and depth | 4 | warm sunlit faces vs cool shade faces on the church and blocks; AO at wall bases; crisp fitted shadows; ink clean |
| 9 | edge and framing | 3 | plinth + sky gradient designed; neighbourhood shot has its subject upper-left but no depth into the distance |
| 10 | bible fidelity | 4 | brick, slate, white frames, crow-stepped gables, wet puddled streets: a stranger with the bible would recognise it |

average: **3.7 — FAIL** (criteria 1, 7, 9 below 4)

side-by-side vs art bible: 1) value: pavements should be clearly the lightest band and roofs clearly darker than walls (criterion 1; palette-method §1). 2) life: the bible's "quiet" density leaves the street frame without traffic (criterion 7; life §2). 3) framing: no depth cue at neighbourhood zoom (criterion 9; camera §3).

changes for next round: ground 0.94 / pavement 0.89; roofs −0.04 L; AO blend 0.8 → 0.65; traffic local 0.5 → 1.0, avenue 1.5 → 2.0 per 100 m; neighbourhood haze stronger.

## Round 4 — 2026-11-11 (last round allowed)

Changes: ground L 0.94, pavement 0.89; roofs −0.04 L; AO blend 0.65; traffic local 1.0 / avenue 2.0 per 100 m; stronger haze.

What each image shows:
- overview: as round 3; centre rise and spire, shed ring, plinth, sky gradient. No fog visible on the far edge.
- neighbourhood: pavements and the square lighter; slate roofs blue-grey, clay roofs red-brown; more cars on the avenues; church upper-left of centre with the pond in front.
- street: church east gable, puddled asphalt, pond and quay, a black car moving along the square, parked cars, walkers in pairs, corner shop with teal door and awning.
- clip diff: localized changes on moving cars (left) and pedestrians on the pavements; nothing else changes.

squint: dark 12 %, mid 86 %, light 2 %; mean 112. diff clip-0→5: **1.31/255, 2.43 %**.

| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 3 | squint still lands 86 % in the mid band; pavements separate from blocks, but roofs and walls share one band and the light band is 2 % |
| 2 | palette harmony | 4 | low-chroma brick, render, slate, clay; teal the only saturated family; bible palette recognisable |
| 3 | data restraint | 4 | beauty keeps the palette with data on ridge caps/copings; the lens shows a readable violet spread on roofs and upper walls |
| 4 | silhouette and skyline | 4 | overview: rise to the square, fall to the edge; spire identifiable in a second |
| 5 | facade detail | 4 | street / street-90: framed windows with sills and lintels, string courses, shopfronts, awnings, crow steps, roof furniture; residential ground floors not distinct |
| 6 | street and ground | 4 | kerbs, pavements, puddled roads, zebras, parking, quay, benches, bollards, lamps, hedges, park paths |
| 7 | life | 4 | diff: two moving cars and ~20 walkers change position on streets and pavements (2.43 % of pixels); smoke and gulls present at wider zooms |
| 8 | light and depth | 4 | warm sunlit vs cool shade faces; AO at wall bases; fitted crisp shadows; clean ink |
| 9 | edge and framing | 3 | designed plinth and sky; the opening shot places the church upper-left but shows no depth into the distance (no haze gradient, no horizon) |
| 10 | bible fidelity | 4 | brick, slate, white frames, crow-stepped gables, wet puddled streets, a church on the market square |

average: **3.8 — FAIL** (criteria 1 and 9 at 3). Stopped after four rounds as the rubric requires; not relabelled.

side-by-side vs art bible (no exemplar): 1) value: the squint helper's fixed thresholds (85/170) and a dense 220 m neighbourhood view leave little ground visible; roofs need to sit a clear band below walls. 2) framing: at 30° elevation and 220 m width the frame never reaches the horizon, so the fog/haze depth cue in render-pipeline §6 never shows. 3) residential ground floors read like upper floors.

## Remaining gaps (honest stop after round 4)

- **Value structure (3).** What I would try next: roofs to L 0.32–0.36 (a full band below the walls), walls to the top of their band, a slight elevation of the key (35°) so streets get more direct light, and checking the result with the squint helper against an exemplar once one exists.
- **Edge and framing (3).** A depth cue at neighbourhood zoom: either a height-based haze (fog by world z or screen y, not camera depth, because ortho depth barely changes across the frame) or an opening shot framed to include a sliver of the world edge and sky.
- **Ground floors** of residential blocks still match the upper floors (buildings §4.3 asks for a difference).
- Hover outline and click-select card (data-in-the-world §6) are not implemented; only a hover tag is.

## Speed (with the round-4 build)

`node tools/bench/fps.mjs <page>[?shot=…] --dpr 1 2`, 1440×900, Brave/ANGLE (GPU), live page (not snapshot: traffic, smoke, water and wind running), 181 frames each:

| shot | dpr 1 p50 / p95 | dpr 2 p50 / p95 | errors |
|---|---|---|---|
| neighbourhood (opening) | 16.7 / 16.7 ms | 16.7 / 16.7 ms | none |
| overview | 16.7 / 16.8 ms | 16.7 / 16.7 ms | none |
| street | 16.7 / 16.8 ms | 16.7 / 16.7 ms | none |

All PASS (vsync-capped at 60 Hz). No tiling, LOD fade or adaptive resolution was needed.
Single file: `check-single-file.mjs` PASS, 1.67 MB.
