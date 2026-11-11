# Beauty review — brussels-sonnet (Gate 4 subset: street + neighbourhood)

Rounds 0–2 were build/iteration captures (debugging the pipeline, composition, facades, row segmentation, lamps, parked cars). Their captures were discarded and are not scored. Round 3 is the first formally scored round.

Exemplar: `real-nw-ashford` (closest family, but constructed brick town; this is a real 9,216-building commune).
Squint, neighbourhood: this world dark 4 % / mid 83 % / light 13 %, mean 132 (exemplar 12 / 86 / 2, mean 112). Squint, street: this world 6 / 89 / 5, mean 126 (exemplar 18 / 70 / 12, mean 120).

## Round 3 — 2026-11-11
| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 3 | neighbourhood squint: ground and sidewalks are the lightest band (13 % light), slate/zinc roofs darker than brick walls, but walls and most roofs sit in one mid band (83 %) and mean 132 is above the 100–130 band. |
| 2 | palette harmony | 4 | neighbourhood.png: brick red/orange, cream and white render, slate and pantile, one accent family (cornflower/teal doors and shutters); no competing saturated hue. |
| 5 | facade detail | 4 | street-90.png: framed windows with surrounds and sills, stone bands at each floor line, eave cornice, raised plinth with stepped doors in cornflower/teal/green leaves, shutters on ~28 % of buildings, bay windows on some, chimneys. Ground floors are distinct only by plinth and door. |
| 6 | street and ground | 3 | street.png: raised kerbed sidewalks, lamps, one parked car, tram bed; but no crossings, no hedges or fences, bare lawn plots, one blank salmon wall left of the church complex in neighbourhood.png, no benches or bins. |
| 8 | light and depth | 4 | street.png: crisp cast shadows of chimneys and rows across the road and lawn, warm walls against cool shadows, AO darkening at wall bases (lower left). |
| 10 | bible fidelity | 4 | sunny afternoon, brick terraces, white-stone banding, bay windows, cornflower and teal accents, no wet streets: matches the bible; the landmark church reads at neighbourhood zoom. |

average (Gate 4 subset): 3.67 — **FAIL**: criterion 6 is below the exemplar's 4; average is below 3.8; squint mean 132 is above the 100–130 band (the band is calibrated on an after-rain scene; exposure already lowered 1.3 → 1.12).

side-by-side vs real-nw-ashford (street.png), three biggest differences where the exemplar is better:
1. Street life and furniture: the exemplar has many parked and moving cars, people, benches, lamps, a paved square with a water feature; ours has one parked car and lamps. Criterion 6; recipes streets-and-ground §3–5, life §2.
2. Light: the exemplar has pale sunlit pavements against deep, cool shaded faces; ours is a flatter mid band with a bluish ground in shadow. Criterion 1/8; recipes light-and-time §1–2, render-pipeline §2.
3. Windows: the exemplar's tall windows and shopfronts make ground floors differ strongly from upper floors; ours has small paired windows and only a plinth/door to mark the ground floor. Criterion 5; recipe buildings §4.3.
Better than the exemplar: real fabric: terrace rows with colour-alternating plots, per-plot doors, stone banding and chimneys over 9,216 real footprints; a designed edge (the commune outline as a diorama plinth).

changes for next round: parked cars at the exemplar's density; crossings at junctions; hedges on plot edges; lower the ground's shadow blue; taller windows; fix the blank wall.

# Gate 7 — full rubric (street, neighbourhood, overview, lens, clip)

Rounds 4 and 5 (`round-4/`, `round-5/`) were interim captures while the data layer, life, crossings and the data lens were being built; they are not scored. Round 6 is the first scored round of Gate 7 (the Gate 4 rounds were 1–3). The page is the live Mantine page; captures use `?snapshot=1` which runs the real model in the worker to month 270 (0.75 × the horizon) first, baseline parameters.

Exemplar `real-nw-ashford` squint: neighbourhood 12 / 86 / 2, mean 112; street 18 / 70 / 12, mean 120. This world, round 6: neighbourhood 4 / 83 / 13, mean 133; street 7 / 88 / 5, mean 124.

## Round 6 — 2026-11-11
| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 3 | neighbourhood squint: 13 % light (ground, sidewalks, cream walls) against dark roofs, but walls and most roofs share the mid band (83 %) and the mean of 133 is above the 100–130 band (exposure already lowered 1.3 → 1.12 for the sunny moment). |
| 2 | palette harmony | 4 | neighbourhood.png: brick, cream and white render, slate and pantile, one accent family (cornflower and teal doors and shutters); the plum data ramp is the only other hue and sits 40° or more from the accents. |
| 3 | data restraint | 4 | street.png: state shows as a thin plum ridge cap or coping band and hatched grey caps on rental buildings (a few % of pixels), the world keeps its palette; lens.png shows every roof in the ramp and the walls desaturated. In the baseline most buildings are "none" (pale lavender), so the lens reads mostly pale with plum accents. |
| 4 | silhouette and skyline | 3 | overview.png: a diorama of the commune outline, heights 1–5 storeys with the church spire only readable at neighbourhood zoom; at overview the fabric reads as a carpet of similar roofs (storeys are assumed, 99 %). |
| 5 | facade detail | 4 | street-90.png: framed windows with sills and lintels, stone bands, eave cornice, stepped doors in accent leaves, shutters on ~28 %, bay windows, chimneys, plot-by-plot wall colours along terrace rows. |
| 6 | street and ground | 3 | street.png / neighbourhood.png: raised kerbed sidewalks, zebra crossings and stop lines at avenue junctions, lamps, parked and moving cars, pedestrians, tram beds, trees; but no hedges or fences, bare lawn plots, no benches or bins, and one large blank wall beside the church complex. |
| 7 | life | 4 | clip-0 vs clip-5: 1.77 % of pixels change (mean 1.19/255), localised on the streets; the street frame holds ≥ 4 moving cars and several paper-doll pedestrians. |
| 8 | light and depth | 4 | street.png: crisp cast shadows of chimneys and rows across road and lawn, warm walls against cool shadows, AO darkening at wall bases, haze softening the upper third of neighbourhood.png. |
| 9 | edge and framing | 4 | overview.png: the commune's own outline as a diorama plinth with soil and rock strata; neighbourhood.png: church spire on the upper-left third with terraces receding into haze. |
| 10 | bible fidelity | 4 | a sunny late-May afternoon, brick terraces with white-stone banding and bay windows, cornflower and teal doors, no wet streets; the landmark church reads at neighbourhood zoom. |

average: 3.7 — **FAIL** by the skill's rule (average below the exemplar's 3.8; criteria 4 and 6 at 3, below the exemplar's 4). Criterion 1 (3) and criterion 9 (4) meet the exemplar.

side-by-side vs real-nw-ashford (street.png): the three biggest differences where the exemplar is better:
1. **Street furniture and plots (criterion 6; streets-and-ground §4–5):** the exemplar has benches, a paved square with a water feature, hedges and varied plot surfaces; this world's plots are bare lawn or paving.
2. **Light and value separation (criterion 1/8; light-and-time §1–2):** the exemplar's pale sunlit pavements against deep cool shaded faces separate in the squint sheet; ours sits in one mid band.
3. **Skyline (criterion 4; composition §1):** the exemplar's invented spire and height gradient read from overview; real OSM fabric with assumed heights does not.
Better than the exemplar: a real place at full scale (9,216 buildings, 8,105 homes, 31,287 simulated households), terrace rows with per-plot walls, doors and stone banding, the commune outline as the world's edge, and a live data layer (state caps, pennants, cladding, lens).

changes for the next round if the user wants one: hedges and benches, a second landmark for the overview, a light-ground pass, fix the blank wall.
