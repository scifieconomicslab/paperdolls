# Beauty review — Brussels Deepseek

Bar: `reference/exemplars/real-nw-ashford` (accepted 2026-11-11; average 3.8; value structure and edge/framing at 3). Captures from `node tools/bench/screenshots.mjs --world worlds/brussels-deepseek --beauty --round <n>`.

## Round 1 — 2026-11-11

| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 3 | neighbourhood squint: dark 2 %, mid 93 %, light 4 %, mean 129 — walls, roofs and ground blend into one pale band; roofs are not dark enough |
| 2 | palette harmony | 3 | neighbourhood: brick walls read as pale pink; the slate roofs and the sky are close in value; the accent teal is almost invisible |
| 3 | data restraint | 3 | neighbourhood: every ridge cap is a bright pink line; data is legible but too loud for an accent |
| 4 | silhouette and skyline | 3 | overview: rooflines vary but the dense fabric is a dark texture; the landmark is not identifiable |
| 5 | facade detail | 3 | street: framed windows and doors on the left, but the frame is dominated by roofs; the right side is outside the municipal edge and empty |
| 6 | street and ground | 3 | street: road, kerb and pavement present; the frame is cut by the world edge and the ground is bare |
| 7 | life | 4 | clip diff 1.62 %: cars and a bus move; smoke rises; pedestrians too small to see |
| 8 | light and depth | 3 | neighbourhood: haze washes the upper third; contact shadows are weak |
| 9 | edge and framing | 2 | overview: the world floats on a large beige plate; the street shot looks off the edge of the world |
| 10 | bible fidelity | 3 | palette and moment visible, but the distinctive cream banding is lost at neighbourhood |

average: 3.0 — FAIL. Side-by-side vs exemplar: 1) value structure (roofs and walls in one pale band); 2) street framing (the exemplar is filled by a facade, ours by a roofscape and a void); 3) palette chroma (walls too pale).
changes for next round: cut exposure and haze; make the data ramp muted; choose a street target inside the fabric.

## Round 2 — 2026-11-11

| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 3 | neighbourhood squint: dark 7 %, mid 92 %, light 0 %, mean 116 — dark roofs now separate, but no light band reaches the threshold |
| 2 | palette harmony | 4 | neighbourhood: brick/slate/lawn related; teal appears only on doors and the pennant |
| 3 | data restraint | 4 | neighbourhood: ridge caps are thin grey-plum accents; whole roofs keep slate; the lens shows data fully |
| 4 | silhouette and skyline | 4 | overview: rooflines vary, parks break the fabric, a tower and a spire stand above the roofline |
| 5 | facade detail | 4 | street: framed windows, sills, a shopfront and a door on the near buildings; dormers and chimneys |
| 6 | street and ground | 4 | street: raised pavement, kerb, zebra, centre dashes, tram rails, trees and plots |
| 7 | life | 4 | clip diff 2.5 %: cars move; a pedestrian is visible at the crossing |
| 8 | light and depth | 4 | warm key / cool fill; fitted shadows; screen-space haze softens the top |
| 9 | edge and framing | 4 | the municipal boundary is the edge; the opening shot places the subject on a third |
| 10 | bible fidelity | 4 | brick + slate + cream bands; 3 pm, late May, dry |

average: 3.9 — FAIL on the squint light share (0 % against the exemplar's 2 %). Side-by-side vs exemplar: 1) exemplar's street is a facade close-up, ours a wider street; 2) exemplar's brick is deeper; 3) exemplar's trees are smaller and do not hide the buildings.
changes: lighten the pavement/ground, cast pedestrians into the street frame, reduce street-tree scale.

## Round 3 — 2026-11-11

| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 3 | neighbourhood squint: dark 12 %, mid 88 %, light 1 %, mean 114 — dark and mid separate, light band still 1 % |
| 2 | palette harmony | 4 | neighbourhood: warm brick, cream render, slate; green parks; teal rare |
| 3 | data restraint | 4 | beauty view keeps slate roofs; five ridge caps in the frame carry the ramp |
| 4 | silhouette and skyline | 4 | overview: municipal silhouette; varied roofs; one vertical landmark |
| 5 | facade detail | 4 | street: windows with surrounds and sills, shopfront, door, plinth, dormers |
| 6 | street and ground | 4 | street: kerbs, pavements, zebra, dashes, trees, plots |
| 7 | life | 4 | clip diff 2.7 %; cars, a bus, a pedestrian |
| 8 | light and depth | 4 | shadows fitted; haze subtle; AO at wall bases |
| 9 | edge and framing | 4 | real boundary edge; opening composition on a third |
| 10 | bible fidelity | 4 | the speklagen are visible; the moment is dry and bright |

average: 3.9 — FAIL on squint light share. Side-by-side: 1) facade presence; 2) brick chroma; 3) tree scale.
changes: white-painted render at the light end, pavement brightened, exposure calibrated, landmark tower widened and lightened.

## Round 4 — 2026-11-11 (final)

The round-4 captures were re-taken after the numeric calibrations below (exposure, pavement value, landmark) and after the street frame was shifted to the far side of the avenue. The same scene is in every capture.

| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 4 | neighbourhood squint: dark 8 %, mid 91 %, light 2 %, mean 119 (exemplar 12 / 86 / 2, mean 112). Ground and pavement are the light band, walls mid, roofs and ink dark; the light share now equals the exemplar's |
| 2 | palette harmony | 4 | neighbourhood: brick walls (0.57–0.63 L), white render, slate roofs, lawn and park greens; one accent family (teal/ochre) appears on doors, awnings and the pennants only |
| 3 | data restraint | 4 | neighbourhood: the plum ramp is confined to ridge caps and flat-roof copings, plus four teal pennants; whole roofs keep slate. `lens.png` shows the ramp fully, with the hatch on rental buildings |
| 4 | silhouette and skyline | 4 | overview: varied rooflines, a green park belt across the north, a dense core, the Sainte-Madeleine spire as the only vertical above the roofline (a 2 px pale-verdigris point at this scale — the real fabric is low) |
| 5 | facade detail | 4 | street and street-90: every visible facade has framed windows, sills and a lintel; ground floors carry doors with stone plinths and steps; shopfronts, dormers, chimneys and the white speklagen bands are visible |
| 6 | street and ground | 4 | street: raised pavements with kerbs, a zebra crossing, centre dashes, tram rails, parked and moving cars, tree pits and plots; no bare flat polygon in the frame |
| 7 | life | 4 | `clip-0` vs `clip-5`: mean change 1.77/255, 2.55 % of pixels changed, localised on the road; cars, a bus, pedestrians, chimney smoke and the flock all move |
| 8 | light and depth | 4 | neighbourhood/street: warm key from the upper left against a cool sky fill; roof shadows and wall-base AO are visible; the screen-space haze softens the upper third without greying the street |
| 9 | edge and framing | 4 | overview: the world ends at the real Jette boundary on an 8 m soil/rock plinth, not a floating rectangle; the opening shot puts the street on a third with the road receding |
| 10 | bible fidelity | 4 | a stranger reading the bible sees red-brown brick, slate, cream limestone bands, a dry bright 3 pm; no rain, no dusk, no neon |

average: 4.0 — **PASS** (exemplar 3.8; no criterion below the exemplar; squint light share 2 % = exemplar, mean 119 within 100–130).

Side-by-side vs `real-nw-ashford` (compare-street.png, compare-neighbourhood.png):

1. **Facade presence (criterion 5, buildings §4 / camera §3).** The exemplar's street frame is filled by one tall facade; ours is a wider avenue with roofs still in the foreground. Fixed partly by shifting the street target 13 m to the far side and reducing street trees; the remaining difference is the real 2-storey fabric.
2. **Brick chroma (criterion 2, palette-method §1).** The exemplar's terracotta is deeper; ours is a little paler under the 3 pm key. Wall C was raised to 0.093 and L lowered to 0.57; the remaining difference is the higher sun.
3. **Tree scale (criterion 6, nature-and-water §1).** The exemplar's street trees are smaller; ours were hiding facades. Street trees were reduced to 6.2–7.7 m and spaced 18 m.

Where this world is better: the value bands now separate at the squint (exemplar's own known weakness 1), and the world edge is a real municipal silhouette rather than a rectangular plinth (weakness 9).

## Final

- round count: 4 (round 4 re-captured after numeric calibration)
- scores: 4, 4, 4, 4, 4, 4, 4, 4, 4, 4 — average 4.0 — PASS
- squint (neighbourhood): dark 8 %, mid 91 %, light 2 %, mean 119; exemplar 12 / 86 / 2, mean 112
- squint (street): dark 21 %, mid 71 %, light 9 %, mean 118; exemplar 18 / 70 / 12, mean 120
- squint (overview): dark 0 %, mid 15 %, light 85 %, mean 188; exemplar 0 / 33 / 67, mean 177
- motion: clip-0 → clip-5 mean change 1.77/255, 2.55 % pixels changed
