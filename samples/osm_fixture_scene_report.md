# Ingest report: Fixtureville

Source: `samples/osm_fixture_extract.json` (overpass-json). Attribution to carry with any published picture: **© OpenStreetMap contributors (ODbL)**.

## What was drawn

| item | count |
|---|---|
| buildings | 134 |
| roads (incl. tram tracks) | 11 |
| landuse polygons | 5 |
| trees | 48 (8 mapped, 9 in tree rows, 31 scattered) |
| extent | 511 x 332 m |

## The frame

Origin 50.8819, 4.330145. x is east and y is south before rotation, so with no rotation north points up and to the right on the screen. The frame was rotated by **-37.28 degrees** (chosen from building edges (highest estimated asset share)). North now points **85.5 degrees clockwise from the top of the screen**.

Why rotate: the building assets need walls on the isometric axes. The rotation that makes most buildings fit was chosen from these candidates:

| from | rotation (deg) | grid strength (0 to 1) | buildings that fit an asset |
|---|---|---|---|
| none | 0.0 | 0.0 | 0% |
| building edges | -37.28 | 0.957 | 96% |
| road segments | -37.0 | 0.962 | 96% |
| buildings and roads | -37.18 | 0.959 | 96% |

Estimated share of buildings that will use an asset: **97%** after rotation, 0% without. The rest are drawn as generic extrusions (the renderer reports the exact count and the reasons). This is an estimate from each footprint's minimum bounding rectangle.

## Assumptions to confirm

Every default the ingest applied. Confirm, or supply better data.

| category | rule | how many |
|---|---|---|
| road class | highway=residential -> local | 6 |
| road class | highway=secondary -> avenue | 1 |
| road class | highway=tertiary -> avenue | 1 |
| road class | highway=cycleway -> cycle | 1 |
| road class | highway=pedestrian -> pedestrian | 1 |
| road width | lanes tag at 3.1 m per lane: avenue width set from the tag instead of the class default | 1 |
| road width | width tag: avenue width set from the tag instead of the class default | 1 |
| tram | 1 road(s) run along a tram line: street-running tram flagged | 1 |
| tram | 1 tram line(s) with no road alongside: drawn as their own track | 1 |
| archetype | building=terrace -> terrace | 54 |
| archetype | building=house -> villa | 49 |
| archetype | building=apartments -> block | 10 |
| archetype | building=retail -> shophouse | 9 |
| archetype | building=yes -> auto (the region decides) | 9 |
| archetype | building=warehouse -> shed | 1 |
| archetype | building=yes with 14 storeys -> tower | 1 |
| archetype | building=church -> auto (the region decides) | 1 |
| storeys | building=house with no levels or height: assumed 2 | 45 |
| storeys | building=retail with no levels or height: assumed 2 | 9 |
| storeys | from height tag at 3.1 m per storey | 9 |
| storeys | building=warehouse with no levels or height: assumed 1 | 1 |
| storeys | building=church with no levels or height: assumed 1 | 1 |
| courtyards | buildings with inner rings (courtyards): drawn as solid footprints | 1 |
| landuse | park from leisure=park | 1 |
| landuse | water from natural=water | 1 |
| landuse | square from place=square | 1 |
| landuse | park from natural=wood | 1 |
| landuse | garden from leisure=garden | 1 |
| tree kind | no species: the region's species mix decides | 4 |
| tree kind | plane from species or leaf type | 1 |
| tree kind | palm from species or leaf type | 1 |
| tree kind | umbrella from species or leaf type | 1 |
| tree kind | oak from species or leaf type | 1 |
| tree kind | conifer from species or leaf type | 1 |
| scatter | trees scattered into parks and woods (one per 70 to 400 m2 by type, at most 300 per area, 4000 in all): 31 trees | 31 |
| scatter | park or wood already has mapped trees: nothing scattered | 1 |

### Storeys

| source | buildings | share |
|---|---|---|
| tag | 69 | 51% |
| type-default | 56 | 42% |
| height | 9 | 7% |

Storey counts decide building height and, through the region, which archetype a building gets. Where the share from `tag` is low, heights are mostly assumed.

## Left out

| what | how many |
|---|---|
| building=roof | 1 |
| building=construction | 1 |
| buildings outside the clip | 1 |
| highway=footway (not drivable) | 1 |
| service road: driveway, parking aisle or private | 1 |
| road in a tunnel or below ground | 1 |
| building smaller than 8 m2 | 1 |
| landuse smaller than 20 m2 | 1 |

## Warnings

None.

## Not inferred, ask the user

- **Drive side**: not read from the data. Set it from the region, or override it when the place differs from its region default.
- **Retrofit states and ownership**: every building starts as `none` and not investor-owned. The model export supplies them.
- **Building heights beyond the tags**: nothing was measured or looked up.
