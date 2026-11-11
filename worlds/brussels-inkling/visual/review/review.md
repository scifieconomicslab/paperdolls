# Beauty review — brussels-inkling

Bar: `reference/exemplars/real-nw-ashford/` (average 3.8; value structure 3,
edge-and-framing 3, everything else 4). OSM relation 58258 (Jette), © OpenStreetMap contributors (ODbL).

## Round 1 — 2026-11-11

Gate-4 subset (criteria 1, 2, 5, 6, 8, 10), on the style-frame captures.

| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 4 | squint: dark 6% mid 90% light 4%; mean 122 stddev 26 (exemplar: 112/24, light 2%); three bands separate: pale ground/plaza, mid brick walls, dark roofs |
| 2 | palette harmony | 4 | low-chroma brick field, one accent family (bottle green doors/awnings), teal enamel signs; plum ramp reserved and distinct |
| 5 | facade detail | 4 | framed openings on every visible facade; string-course motif + crow-stepped gables on 941 gable ends; roof furniture (chimneys 5,426, AC units, stair bulkheads, PV strips); ground-floor shopfronts 593 vs plain doors 7,470; gault brick band at each storey on red/brown brick |
| 6 | street and ground | 4 | kerbed pavements, cycle lanes (red), tram rails on 138 roads, avenue centre dashes 2,398, kerbside parking 3,119, plots with lawn/garden/square textures, 8,449 data trees + 452 street + 2,588 park trees, market stalls crowd the square (decorative, labelled); bookmark: plaza is large but broken by stalls, benches, bollards and a tram alignment |
| 8 | light and depth | 4 | warm 4,900 K key (220° azimuth, 50° elevation) against 8,500 K fill; long crisp shadows fitted to view; GTAO 0.55 contact darkening; ink outlines clean; the sunny 3 pm moment reads instantly |
| 10 | bible fidelity | 4 | sunny late-May 3 pm, brick suburb, tram lines, Sint-Pieterskerk civic presence on the market square, UZ block as skyline mass; motif visible; "not this" honoured (not rainy, not postcard-Dutch) |

average (Gate-4 subset): 4.0 — Gate 4 PASS. The bar at Gate 7 is the whole rubric.

squint: `round-1/neighbourhood-squint.png` (light 4% ≥ exemplar 2%; mean 122 within 100–130; stddev 26 ≥ 24).

side-by-side vs `real-nw-ashford` (`round-1/compare-street.png`, `round-1/compare-neighbourhood.png`):
1) exemplar's facades are richer — arched windows, parapets, cornices, shop awnings — mine are uniform rows of the same window (buildings §4.2–4.3; kept: ours gains gault string courses + crow steps; partial fix)
2) exemplar's square is furnished densely (ranked parked cars, benches, pool, people) — mine opened pale and sparse (streets-and-ground §5; fixed with market stalls + bollards + benches; people remain modest)
3) exemplar's palette is warmer/dirtier (rain-washed) — mine reads cleaner/sunnier, which is correct for a 3 pm sunny brief, but the plaza tone washed toward white (palette-method §1; fixed pale stone → warmer granite)

changes for round 2: hemisphere bounce 0.6→0.72, GTAO 0.65→0.55, plaza tone 0.88→0.83 (warmer), market stalls on the square (decorative, labelled), road-edge distance check for stalls/vehicles.

## Round 2 — 2026-11-11

| # | criterion | score | evidence |
|---|---|---|---|
| 1 | value structure | 4 | squint (round-2): three bands separate; mean ≈ 122 stddev ≈ 26 — unchanged |
| 2 | palette harmony | 4 | warm granite plaza, muted green verge cap (untagged open grounds read as lawn, not mud), same accent discipline |
| 3 | data restraint | 4 | beauty view: ridge caps/coping bands carry plum on ≤ 15 % of building pixels (2,132 storeys clad commune-wide + plum caps on pitched/flat roofs); lens shows it at a glance; no data → grey + hatch |
| 4 | silhouette and skyline | 4 | gable/hip/flat/mono silhouettes with variation (6,917 gable, 1,314 hip, 164 flat, 821 mono, 941 crow-stepped); UZ block mass NW; height gradient 2→4–5; roof furniture breaks the roofline |
| 5 | facade detail | 4 | unchanged from round 1 (4); motif visible on gable ends and every storey line on brick |
| 6 | street and ground | 4 | plaza now warm stone with sett grid + 3 market stalls + benches + bollards; roads read as asphalt with rails; cycle lanes red; pavements pale; parked cars ranked kerbside |
| 7 | life | 4 | clip-0 vs clip-5 diff: localised changes on cars and pedestrians (mean 0.99/255, 1.39 % changed px); vehicles + pedestrians + smoke + pigeons all move; reduced-motion respected |
| 8 | light and depth | 4 | warmer/cooler split holds up; shadow boundary on the plaza reads; contact darkening present with GTAO 0.55 (was 0.65 — the deep crush under the big block is lifted) |
| 9 | edge and framing | 4 | commune-shaped plinth (extruded boundary ring, strata walls + limestone cap); the world is the silhouette of Jette, not a rectangle; opening shot = market square, subject on a third, skyline depth behind |
| 10 | bible fidelity | 4 | the moment, the brick, the band courses, the tram, the market — a stranger read against the bible would recognise this world |

average: 4.0 — PASS against the exemplar (all ten ≥ its per-criterion scores; 1 and 9 at 4 vs 3, squint equal or better).

side-by-side: the three round-1 gaps were addressed (facades: motif retained; square: stalls/benches/bollards added; plaza tone: warmer). The exemplar remains stronger on shopfront density (we have 593 vs its constant commercial street frontage) and on grime/dirt variation. We win on edge-and-framing (commune silhouette), on tree density (8,449 data trees) and on the market square's function as a focal point.

Gate 4 (round 1 subset): PASS. Gate 7 scores as above.
