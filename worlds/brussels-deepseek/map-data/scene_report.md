# Ingest report: Jette, Brussels

Source: `../worlds/brussels-deepseek/map-data/extract.json` (overpass-json). Attribution to carry with any published picture: **© OpenStreetMap contributors (ODbL)**.

## What was drawn

| item | count |
|---|---|
| buildings | 9216 |
| roads (incl. tram tracks) | 1320 |
| landuse polygons | 1091 |
| trees | 8705 (4521 mapped, 87 in tree rows, 4097 scattered) |
| extent | 3257 x 3445 m |

## The frame

Origin 50.879332, 4.317142. x is east and y is south before rotation, so with no rotation north points up and to the right on the screen. The frame was rotated by **0.0 degrees** (chosen from none (highest estimated asset share)). North now points **60.0 degrees clockwise from the top of the screen**.

Why rotate: the building assets need walls on the isometric axes. The rotation that makes most buildings fit was chosen from these candidates:

| from | rotation (deg) | grid strength (0 to 1) | buildings that fit an asset |
|---|---|---|---|
| none | 0.0 | 0.0 | 26% |
| building edges | -6.59 | 0.165 | 24% |
| road segments | -5.19 | 0.22 | 24% |
| buildings and roads | -6.02 | 0.183 | 24% |

Estimated share of buildings that will use an asset: **29%** after rotation, 26% without. The rest are drawn as generic extrusions (the renderer reports the exact count and the reasons). This is an estimate from each footprint's minimum bounding rectangle.

## Assumptions to confirm

Every default the ingest applied. Confirm, or supply better data.

| category | rule | how many |
|---|---|---|
| road width | lanes tag at 3.1 m per lane: avenue width set from the tag instead of the class default | 92 |
| road width | lanes tag at 3.1 m per lane: local width set from the tag instead of the class default | 41 |
| road width | width tag: local width set from the tag instead of the class default | 18 |
| road class | highway=residential -> local | 470 |
| road class | highway=service -> local | 237 |
| road class | highway=tertiary -> avenue | 218 |
| road class | highway=cycleway -> cycle | 130 |
| road class | highway=living_street -> local | 100 |
| road class | highway=primary -> avenue | 50 |
| road class | highway=pedestrian -> pedestrian | 40 |
| road class | highway=secondary -> avenue | 37 |
| road class | highway=unclassified -> local | 17 |
| road class | highway=primary_link -> local | 1 |
| tram | 117 road(s) run along a tram line: street-running tram flagged | 117 |
| tram | 21 tram line(s) with no road alongside: drawn as their own track | 21 |
| storeys | building=yes with no levels or height: assumed 2 | 8545 |
| storeys | building=apartments with no levels or height: assumed 4 | 173 |
| storeys | building=house with no levels or height: assumed 2 | 157 |
| storeys | building=garages with no levels or height: assumed 1 | 82 |
| storeys | building=garage with no levels or height: assumed 1 | 27 |
| storeys | building=hospital with no levels or height: assumed 4 | 18 |
| storeys | building=school with no levels or height: assumed 3 | 15 |
| storeys | building=shed with no levels or height: assumed 1 | 12 |
| storeys | building=university with no levels or height: assumed 4 | 11 |
| storeys | building=residential with no levels or height: assumed 3 | 10 |
| storeys | building=retail with no levels or height: assumed 2 | 8 |
| storeys | building=greenhouse with no levels or height: assumed 1 | 6 |
| storeys | building=service with no levels or height: assumed 1 | 5 |
| storeys | building=church with no levels or height: assumed 1 | 4 |
| storeys | building=detached with no levels or height: assumed 2 | 4 |
| storeys | building=commercial with no levels or height: assumed 3 | 2 |
| storeys | building=warehouse with no levels or height: assumed 1 | 2 |
| storeys | building=industrial with no levels or height: assumed 1 | 2 |
| storeys | building=terrace with no levels or height: assumed 3 | 2 |
| storeys | building=bridge with no levels or height: assumed 2 | 2 |
| storeys | building=college with no levels or height: assumed 2 | 2 |
| storeys | building=construction with no levels or height: assumed 2 | 2 |
| storeys | building=parking with no levels or height: assumed 3 | 2 |
| storeys | building=civic with no levels or height: assumed 3 | 1 |
| storeys | building=train_station with no levels or height: assumed 1 | 1 |
| storeys | building=chapel with no levels or height: assumed 1 | 1 |
| storeys | building=office with no levels or height: assumed 4 | 1 |
| storeys | building=clubhouse with no levels or height: assumed 2 | 1 |
| storeys | building=brewery with no levels or height: assumed 2 | 1 |
| storeys | building=museum with no levels or height: assumed 2 | 1 |
| storeys | building=dormitory with no levels or height: assumed 4 | 1 |
| storeys | building=farm_auxiliary with no levels or height: assumed 1 | 1 |
| storeys | building=sports_centre with no levels or height: assumed 2 | 1 |
| archetype | building=yes -> auto (the region decides) | 8561 |
| archetype | building=apartments -> block | 241 |
| archetype | building=house -> villa | 170 |
| archetype | building=garages -> shed | 82 |
| archetype | building=garage -> shed | 27 |
| archetype | building=hospital -> auto (the region decides) | 18 |
| archetype | building=school -> auto (the region decides) | 17 |
| archetype | building=shed -> shed | 12 |
| archetype | building=university -> auto (the region decides) | 11 |
| archetype | building=residential -> auto (the region decides) | 10 |
| archetype | building=retail -> shophouse | 9 |
| archetype | building=greenhouse -> shed | 6 |
| archetype | building=detached -> villa | 6 |
| archetype | building=service -> shed | 5 |
| archetype | building=yes -> shophouse | 4 |
| archetype | building=church -> auto (the region decides) | 4 |
| archetype | building=office -> block | 3 |
| archetype | building=warehouse -> shed | 2 |
| archetype | building=industrial -> shed | 2 |
| archetype | building=terrace -> terrace | 2 |
| archetype | building=bridge -> auto (the region decides) | 2 |
| archetype | building=college -> auto (the region decides) | 2 |
| archetype | building=construction -> auto (the region decides) | 2 |
| archetype | building=parking -> auto (the region decides) | 2 |
| archetype | building=apartments with 11 storeys -> tower | 1 |
| archetype | building=apartments with 12 storeys -> tower | 1 |
| archetype | building=apartments with 13 storeys -> tower | 1 |
| archetype | building=civic -> auto (the region decides) | 1 |
| archetype | building=train_station -> auto (the region decides) | 1 |
| archetype | building=commercial -> shophouse | 1 |
| archetype | building=public -> auto (the region decides) | 1 |
| archetype | building=chapel -> auto (the region decides) | 1 |
| archetype | building=clubhouse -> auto (the region decides) | 1 |
| archetype | building=brewery -> auto (the region decides) | 1 |
| archetype | building=museum -> auto (the region decides) | 1 |
| archetype | building=dormitory -> block | 1 |
| archetype | building=commercial -> auto (the region decides) | 1 |
| archetype | building=transportation -> auto (the region decides) | 1 |
| archetype | building=farm_auxiliary -> shed | 1 |
| archetype | building=sports_centre -> auto (the region decides) | 1 |
| economic class | fallback: no use tag or specific type; assigned from the local mix of tagged buildings | 8545 |
| residential | probable: building=yes with no use tag, 30 m2 or more: probably a dwelling (a guess) | 7672 |
| residential | other: building=yes under 30 m2 and no use tag: an outbuilding | 867 |
| residential | residential: building=apartments: a dwelling type | 244 |
| residential | residential: building=house: a dwelling type | 170 |
| residential | other: building=garages: not a dwelling type | 82 |
| residential | other: building=garage: not a dwelling type | 27 |
| residential | other: building=yes with a use tag (amenity=*) | 20 |
| residential | other: building=hospital: not a dwelling type | 18 |
| residential | other: building=school: not a dwelling type | 17 |
| residential | other: building=shed: not a dwelling type | 12 |
| residential | other: building=university: not a dwelling type | 11 |
| residential | residential: building=residential: a dwelling type | 10 |
| residential | other: building=retail: not a dwelling type | 9 |
| residential | other: building=greenhouse: not a dwelling type | 6 |
| residential | residential: building=detached: a dwelling type | 6 |
| residential | other: building=service: not a dwelling type | 5 |
| residential | other: building=yes with a use tag (shop=*) | 4 |
| residential | other: building=church: not a dwelling type | 4 |
| residential | other: building=office: not a dwelling type | 3 |
| residential | other: building=commercial: not a dwelling type | 2 |
| residential | other: building=warehouse: not a dwelling type | 2 |
| residential | other: building=industrial: not a dwelling type | 2 |
| residential | residential: building=terrace: a dwelling type | 2 |
| residential | other: building=bridge: not a dwelling type | 2 |
| residential | other: building=college: not a dwelling type | 2 |
| residential | other: building=construction: a named type that is not a dwelling | 2 |
| residential | other: building=parking: not a dwelling type | 2 |
| residential | other: building=civic: not a dwelling type | 1 |
| residential | other: building=train_station: not a dwelling type | 1 |
| residential | other: building=yes with a use tag (leisure=*) | 1 |
| residential | other: building=public: not a dwelling type | 1 |
| residential | other: building=yes with a use tag (craft=*) | 1 |
| residential | other: building=chapel: not a dwelling type | 1 |
| residential | other: building=clubhouse: a named type that is not a dwelling | 1 |
| residential | other: building=brewery: a named type that is not a dwelling | 1 |
| residential | other: building=museum: a named type that is not a dwelling | 1 |
| residential | residential: building=dormitory: a dwelling type | 1 |
| residential | other: building=transportation: not a dwelling type | 1 |
| residential | other: building=farm_auxiliary: not a dwelling type | 1 |
| residential | other: building=sports_centre with a use tag (leisure=*) | 1 |
| courtyards | buildings with inner rings (courtyards): drawn as solid footprints | 27 |
| courtyards | landuse polygons with inner rings: holes ignored | 7 |
| neighbours | buildings within 1 m of each other (edge to edge) are neighbours: 8481 buildings have at least one | 8481 |
| landuse | garden from leisure=garden | 523 |
| landuse | park from landuse=grass | 353 |
| landuse | park from leisure=pitch | 42 |
| landuse | park from landuse=village_green | 29 |
| landuse | park from leisure=playground | 23 |
| landuse | park from leisure=park | 19 |
| landuse | water from natural=water | 15 |
| landuse | garden from landuse=allotments | 14 |
| landuse | park from landuse=forest | 12 |
| landuse | park from natural=wood | 9 |
| landuse | park from leisure=dog_park | 8 |
| landuse | square from  | 7 |
| landuse | park from natural=scrub | 7 |
| landuse | park from landuse=flowerbed | 7 |
| landuse | square from place=square | 5 |
| landuse | park from landuse=orchard | 4 |
| landuse | park from landuse=meadow | 3 |
| landuse | park from natural=grassland | 2 |
| landuse | park from landuse=shrubs, natural=scrub | 2 |
| landuse | park from landuse=cemetery | 1 |
| landuse | park from landuse=forest, natural=wood | 1 |
| landuse | water from leisure=fishing, natural=water | 1 |
| landuse | park from natural=wetland | 1 |
| landuse | park from landuse=grass, natural=grassland | 1 |
| landuse | park from landuse=railway, natural=grassland | 1 |
| landuse | square from natural=sand | 1 |
| tree kind | no species: the region's species mix decides | 3910 |
| tree kind | plane from species or leaf type | 274 |
| tree kind | oak from species or leaf type | 263 |
| tree kind | conifer from species or leaf type | 55 |
| tree kind | blossom from species or leaf type | 29 |
| tree kind | columnar from species or leaf type | 2 |
| tree rows | natural=tree_row with no spacing tag: a tree every 9 m | 12 |
| scatter | trees scattered into parks and woods (one per 70 to 400 m2 by type, at most 300 per area, 4000 in all): 4097 trees | 4097 |
| scatter | park or wood already has mapped trees: nothing scattered | 21 |

### Storeys

| source | buildings | share |
|---|---|---|
| global-default | 8555 | 93% |
| type-default | 548 | 6% |
| tag | 113 | 1% |

Storey counts decide building height and, through the region, which archetype a building gets. Where the share from `tag` is low, heights are mostly assumed.

### Fields for the model binding

Each building also carries `area` (m2), `centroid`, `height` (m: the height tag, else storeys x 3.1 m), `levels_assumed` (storeys not read from the data: **9103** of 9216, 99%), `residential` and `neighbours`.

| residential class | buildings | share |
|---|---|---|
| residential | 433 | 5% |
| probable | 7672 | 83% |
| other | 1111 | 12% |

`residential`: a dwelling type (house, terrace, apartments, residential, ...). `probable`: a generic `building=yes` with no use tag and at least 30 m2: probably a dwelling, but a guess. `other`: a non-dwelling type, a use tag (shop, amenity, office, craft, industrial, tourism, healthcare, ...), a shed, or an outbuilding under 30 m2.

`neighbours`: buildings whose footprints touch or come within 1.0 m: 8481 buildings have at least one, 9209 links, at most 12 for one building.

### Economic classes

| class | buildings | share |
|---|---|---|
| apartments | 3334 | 36% |
| house | 2380 | 26% |
| outbuilding | 1284 | 14% |
| garage | 402 | 4% |
| school | 242 | 3% |
| hospital | 228 | 2% |
| other | 194 | 2% |
| university | 176 | 2% |
| residential | 152 | 2% |
| retail | 120 | 1% |
| civic | 117 | 1% |
| service | 117 | 1% |
| detached | 76 | 1% |
| supermarket | 70 | 1% |
| greenhouse | 69 | 1% |
| office | 41 | 0% |
| industrial | 31 | 0% |
| warehouse | 29 | 0% |
| terrace | 28 | 0% |
| kindergarten | 24 | 0% |
| construction | 23 | 0% |
| manufacture | 20 | 0% |
| hut | 17 | 0% |
| fire_station | 14 | 0% |
| government | 14 | 0% |
| farm_auxiliary | 14 | 0% |

How each class was reached:

| source | buildings |
|---|---|
| fallback | 8545 |
| tag | 644 |
| use-tag | 27 |

**93% of buildings were classed by the procedural fallback** (no resolvable use tag or specific type — mostly bare `building=yes`). These are seeded guesses from the local mix of tagged buildings, not data. Confirm them, or supply better tags, before binding a model to economic classes.

## Left out

| what | how many |
|---|---|
| highway=footway (not drivable) | 2202 |
| building smaller than 8 m2 | 841 |
| service road: driveway, parking aisle or private | 324 |
| highway=path (not drivable) | 158 |
| highway=steps (not drivable) | 107 |
| landuse smaller than 20 m2 | 89 |
| road in a tunnel or below ground | 85 |
| buildings outside the clip | 38 |
| building=roof | 37 |
| highway=platform (not drivable) | 30 |
| highway=track (not drivable) | 20 |
| highway=no (unknown) | 3 |
| highway=traffic_island (unknown) | 2 |
| highway=busway (unknown) | 2 |
| highway=construction (not drivable) | 2 |
| road shorter than 1 m | 1 |

## Warnings

- 93% of buildings have no resolvable use tag or specific type; their economic class is a seeded guess from the local mix of tagged buildings. Confirm the 'economic class' assumptions in the report before binding a model to it.

## Not inferred, ask the user

- **Drive side**: not read from the data. Set it from the region, or override it when the place differs from its region default.
- **Retrofit states and ownership**: every building starts as `none` and not investor-owned. The model export supplies them.
- **Building heights beyond the tags**: nothing was measured or looked up.



## Addendum — Jette framing pass (2026-11-11)

This pass only frames; it reshapes nothing. `scene.composed.json` is the scene the renderer reads.

| item | value |
|---|---|
| landmark | `w223403345` — Église Sainte-Madeleine - Sint-Magdalenakerk |
| boundary ring | 284 points, 5.17 km² (relation 58258) |
| rule | largest named religious footprint (building=church with a name), else largest religious, else largest civic, else tallest |
| footprint drawn as one oriented box | 7298 of 9216 (79%); rectangularity ≥ 0.82 and short side ≥ 3 m |
| footprint simplified to its oriented rectangle | 1918 (21%) — counted, not hidden |
| dwelling buildings the model binds to | 5403 (residential, dwelling-class whitelist) |
| dwellings with assumed storeys | 5307 of 5403 (98%) — guessed, not measured |

The ingest's "29 % fitting an asset" estimate applies to the legacy axis-aligned
asset grammar. This world draws an oriented box from each footprint's own
minimum-area rectangle, so every structure gets an oriented mass; the table above
states how many footprints that box simplifies.
