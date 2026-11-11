# Structures — economic archetypes and visual grammar

Structures are the general layer: buildings, walls, habitats, ruins,
infrastructure and other built forms. **Buildings are the common `kind`.**
This file documents the `real` world family's building grammar and the
normative economic-class vocabulary; the historical, fantasy and
science-fiction families add their own structure grammar packs and reuse the
same material roles. The binding maps agents to structures, not only to
buildings.

Two separate things live here, and the LLM must not confuse them:

1. **Economic classes** (`economic_class`): what a building *is* in the
   economy, taken from `/reference/building-archetypes.md`. Used by the
   archetype cascade in `tools/ingest/classify.py`, by model bindings
   (`match.economic_class_in`) and by the scene report.
2. **Visual archetypes** (`visual_archetype`): which pre-built façade the renderer stamps on a footprint. The renderer's business; never the model's. A `retail` economic class usually renders as a `shophouse`.

Everything here is a **proposal** (sizes, heights, grammar) — check with
local authors before policy use.

The **silhouettes** of this page's six archetypes (the roof types above:
flat+parapet, gable, low-pitch shed, plus setback tiers and masts) are authored
geometry in the plain pack, metrical from each building's own footprint and
height, in **all** looks.

## Economic classes (normative source: `/reference/building-archetypes.md`)

The classifier emits one of:

- Housing: `house`, `residential`, `detached`, `apartments`,
  `semidetached_house`, `terrace`, `bungalow`, `hut`, `static_caravan`,
  `cabin`
- Production & agriculture: `industrial`, `manufacture`, `factory`, `farm`,
  `farm_auxiliary`, `barn`, `greenhouse`, `silo`, `stable`, `cowshed`
- Trade & services: `retail`, `warehouse`, `kiosk`, `supermarket`, `office`,
  `garage`, `mixed_use`
- Public sector: `school`, `kindergarten`, `university`, `hospital`,
  `clinic`, `government`, `fire_station`, `civic`
- Energy & infrastructure: `storage_tank`, `digester`, `transformer_tower`,
  `service`
- Economic states: `construction`, `ruins`, `allotment_house`
- Plus `outbuilding` (sheds/garages/outbuildings seen as property
  accessories) and `other`.

`building=yes` (≈79 % of tagged buildings) receives an **explicit
`inferred: "fallback"` flag** from the procedural-mix step; the scene report shows the fallback share prominently. `construction` and `ruins` are first-class classes (not skipped). `proposed`, `no`, `collapsed`,
`abandoned`, `damaged` fold into `ruins`; `roof`, `shed`, `barn`-like, and similar non-economic storage types map to `outbuilding`.

## The inference cascade (implemented in `tools/ingest/classify.py`)

```
1. building=<specific value> in the ≥34-type table     → that class
2. shop/amenity/office/man_made/craft/industrial/
   healthcare/leisure/tourism/public_transport/
   power/railway/use tag present                       → USE_TAGS match → class
3. building:use=<value> resolvable to a class          → that class
4. landuse= farmyard|industrial|commercial|residential → class
5. procedural fallback: seeded draw from the local
   mix of classes 1–4 in the same extract              → flagged inferred="fallback"
```

Counts by rule appear in `scene_report.md`. Nothing is defaulted quietly.

## The `real` family's six structure archetypes

Other world families add their own archetypes and reuse the same material
roles. The table below is the `real` family's building grammar.

| kind | label | bay width | storey H | ground H | bays | style | roof |
|---|---|---|---|---|---|---|---|
| `terrace` | Terraced house | 2.4 m | 3.0 m | 3.2 m | 2–3 | house | pitch |
| `shophouse` | Shophouse | 3.2 m | 3.2 m | 4.0 m | 2–4 | shop | flat |
| `block` | Apartment block | 3.4 m | 3.0 m | 3.6 m | 3–9 | block | flat |
| `villa` | Detached house | 3.0 m | 2.9 m | 3.0 m | 2–4 | house | hip |
| `tower` | Tower | 4.0 m | 3.3 m | 4.5 m | 2–8 | tower | flat |
| `shed` | Shed / warehouse | 5.0 m | 6.0 m | 6.5 m | 2–8 | shed | pitchlow |

A building asset is parametrised `{kind, W, D, N, variant, fs, ov, seg?}` —
W (frontage, quantised to whole metres), D (depth, quantised to 2 m),
N storeys, `variant` (facade seed), `fs` (regional facade style:
`shutters/awning/ac/chimney/balcony/winK/roof`), and `ov` (the `real`
family's preset geometry: `band|scaffold|wrap|panels|flag|tint|outline|
solar|marker|insulation|community|segments`), optional `seg:[n,k]` (k of n
sections done).

## Treatments vs overlays

The generic treatment grammar is **mark, overlay, replacement, growth,
state, extent**. A treatment is a declared-variable reading; an overlay is
geometry. The `real` family's presets map one to the other:

| generic treatment | `real` preset | geometry / channel |
|---|---|---|
| mark | `flag`, `outline`, `halo` | a pennant, an attention line or a halo |
| overlay | `band`, `solar`, `marker`, `insulation`, `community` | a course, roof panels, a marker or insulation |
| replacement | `wrap` | upper storeys re-clad; depth driven by a sequential value |
| growth | `scaffold` | an animated scaffold while a process occupies the structure |
| state | `tint`, `band` | a plot tint or a status course |
| extent | `segments`, `panels` | per-storey progress or installed capacity |

Existing `solar`, `marker`, `insulation` and `community` geometry is
`real`-family preset geometry, not a generic treatment. Other families supply
their own presets under the same generic treatments; no preset may imply a
fact the model does not declare.

## Facade grammar (proposal)

Each wall is a grid of **modules**: `window`, `balcony-window`, `door`,
`shopfront`, `ribbon glazing`, `roller door`, `high window`, `blank`.
Rules per module grid:

- exactly one `door` per street face,
- ≥ 1 `shopfront` when `style == 'shop'`,
- never 3 `blank` in a row,
- balconies stack vertically in one column,
- `winK` scales window width (0.6 me tower … 1.1 ws).

Roofs: `flat+parapet` (with optional plant), `pitch`, `hip`, `pitchlow`
(shed). Chimneys, solar arrays and AC units appear per the regional style.

## Footprint fit — the FIT test

A real OSM footprint is used only if it is "near-rectangular and near axis":

```
FIT = { maxDevDeg: 12, minRectangularity: 0.82, minSide: 3 }
rectangularity = footprint area / (min-area rect from convex hull)
heading        = nearest of 4 axis headings; front faces nearest road
```

Failures fall back to a **generic extrusion** and are **counted in the
report** (≈28 % of Jette failed fit in the one live run; ~99 % of storeys
were assumed). Nothing is silently approximated. Cycleways and tram tracks
are not building fronts.

The FIT test applies to building footprints. Walls, habitats, ruins and
infrastructure may use their own family grammar or be constructed; their
fallback to a generic structure is counted in the same report.

## Regional archetype mix and facade grammar

`/reference/buildings/region-mix.md` lists, per palette family/region:
multiple weights per archetype, roof mix, shutters/awning/ac/chimney
probabilities, balcony probability, `winK`, and the storey-band table
(`BAND`) used when `visual_archetype == "auto"`. Palette-family docs are
proposals; check with local authors.

## Known limitations (carry them into expectations)

- One rotation per scene; multi-grid places get only the grid that fits the
  plurality of structures — the rest are extrusions, counted.
- Heights are overwhelmingly assumed, not measured (`levels_assumed` flag).
- The economic class is inferred from tags as documented above; treat
  `inferred:"fallback"` entries as guesses.
- Rendering heights (storeys × 3.1 m) are defaults, not measurements.
- Non-building structures (walls, habitats, ruins, infrastructure) use the
  family's own grammar or a generic extrusion; the scene report counts them.

## Sources

`viz/buildinglib.js` @ `f9a1a59` (CC BY 4.0); `/reference/building-archetypes.md`
(existing research, normative for the class set).
