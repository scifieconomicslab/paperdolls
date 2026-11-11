# Recipe — streets and ground

Goal: the ground plane reads as a place where people live, with kerbs,
pavements, crossings, plots and textures, instead of grey ribbons on beige.
At neighbourhood zoom the streets are the second thing the eye reads after
the roofs.

## 1. Road geometry

Build every road as **merged** geometry per material (never one mesh per
segment):

1. Offset each polyline by ± half width to get a strip. Use
   `BufferGeometryUtils.mergeGeometries` per material. Miter joints, capped
   at 2× width.
2. **Junctions:** at nodes where ≥ 3 roads meet, draw a filled polygon (the
   convex hull of the strip ends) in road colour. This covers the overlap
   artefacts.

| class | carriageway | sidewalk each side | markings |
|---|---|---|---|
| motorway / trunk | 2 × 2 × 3.5 m | none (verge 3 m grass) | edge lines, dashed lane lines |
| avenue / primary | 2 × 2 × 3.25 m | 3–5 m | centre double line, dashed lanes, crossings |
| street / secondary | 2 × 3 m | 2–3 m | dashed centre line |
| residential | 5–6 m | 1.5–2.5 m | none or faint centre dashes |
| pedestrian / square | — | the whole width, paved pattern | none |
| cycleway | 2–3 m, cycle colour (muted accent) | — | bicycle stencil at street zoom |
| tram / rail | sleepers + 2 rails (thin light boxes) | — | — |

If a road has an explicit `width`, use it. Otherwise use the class table.
These are proposals: record them.

### 1.1 Block slabs (preferred where roads enclose blocks)

Per-road sidewalk strips overlap at every junction. Where the roads form
blocks (grids, most constructed worlds, most OSM centres), build the city
the other way round:

1. Lay the carriageways as one flat merged mesh at z = 0 covering all road
   space, including junctions (no junction patches needed).
2. For each block (the area enclosed by road edges), extrude **one raised
   slab**: the block polygon inset by half the road width, with 3–6 m rounded
   corners, height 0.15 m, in kerb colour. Its outer edge is the kerb.
3. On top of it, the pavement ring (block outline inset by the kerb width,
   0.2 m) and the plot (inset by the sidewalk width) as flat fills.
4. Parks and squares are blocks too; their slab carries paths and paving
   instead of plots.

This gives clean kerbs, rounded corners and no overlaps in about 40 lines.
The exemplar uses it. Use per-road strips only for roads that do not enclose
blocks (rural roads, cul-de-sacs).

## 2. Kerbs and sidewalks

- A sidewalk is a strip from the carriageway edge outward, **raised 0.15 m**,
  in sidewalk colour, with a kerb line along its outer edge 0.2 m wide in trim
  or sidewalk L + 0.05. The height step gives a light crease (ink from
  normals) and a sliver of shadow. This is the most important street detail.
- At junction corners, round the sidewalk with a 3–6 m radius.
- Use a paving texture at street zoom only: a 1 m grid of hairlines at
  L − 0.03, world-anchored.

## 3. Markings

Markings are instanced thin quads (0.01 m above the road, `polygonOffset`)
in L 0.92 C 0.01, at 85 % opacity. Use yellow only where the region uses
yellow (the bible says so).

- **Crossings:** zebra stripes (0.5 m wide, 0.5 m gap, 3–4 m long) at
  junctions where both roads are street class or above.
- **Stop lines** at minor-road arms.
- **Parking:** on residential and street classes, mark bays along the kerb
  where `life.md` parks cars.

## 4. Street furniture (street zoom LOD)

| item | spacing | geometry |
|---|---|---|
| lamp | 25–30 m, alternating sides on avenues | pole 0.12 × 6 m, arm, head (emissive at dusk) |
| street tree | see nature-and-water | on sidewalks ≥ 3 m wide |
| bench | near squares, parks, bus stops | slab + 2 legs |
| bin | by benches and crossings | small cylinder |
| bus stop | every 300–400 m on avenues | shelter: roof slab + glass back |
| bollards | edges of pedestrian areas | rows of 0.2 × 0.9 m cylinders |
| signage | junctions of avenues | pole + plate in accent |

All are instanced, seeded and decorative (labelled).

## 5. Plots and land use

- **Plot ground:** inside blocks, the ground is not bare. Use the house
  colour plus a treatment by building class: lawns (vegetation L + 0.08,
  C × 0.7) for houses, paving for commerce and centre, gravel or concrete for
  industry. Where plot polygons are unknown, tint a 3–6 m buffer around each
  footprint and leave the rest as base ground.
- **Plot edges:** low walls (0.6 m), hedges (nature-and-water) or fences
  (posts + 2 rails) along street-facing plot edges of houses. Choose per
  region.
- **Land use polygons:** fill them with their role colour modulated by
  world-anchored noise (±0.03 L), and give them a 0.5–1 m edge band (parks: a
  path or hedge line; water: a shoreline, see nature-and-water; pitches:
  white lines). Never a flat polygon with a jagged edge.
- **Every kind and cover gets its own surface.** `scene.landuse` carries a
  coarse `kind` and a finer `cover`; map each one the scene contains, and
  make a table of them in `palette.ts`. None may fall back to a flat fill
  (the beauty review's flat-patch check catches it):

  | kind / cover | surface |
  |---|---|
  | park, grass, meadow | lawn colour with mowing stripes or tufts; meadow paler and rougher |
  | wood, scrub | darker ground under dense instanced trees or bushes (nature-and-water), never ground alone |
  | pitch, playground | pitch green with white lines; playground with a soft-fall colour patch and 2–4 play props |
  | cemetery | lawn with rows of small stones and a few conifers |
  | allotments, garden, orchard | small plots in alternating greens and soil, sheds, rows of trees for orchards |
  | rail (railway land) | ballast grey-brown gravel texture; the `scene.rails` lines on top (§5.1) |
  | bare (brownfield, construction) | packed earth with tyre marks, a few spoil heaps, a fence along roads |
  | water | nature-and-water |
  | square | below |

- **Parks** get paths (curved 2–3 m strips in sidewalk colour), clustered
  trees, benches and a few flower beds in the accent family.
- **Squares** get a paving pattern (a large grid or concentric rings), a
  central feature (fountain, statue plinth, kiosk), trees in a ring and
  benches. A square is a stage, so detail it.

### 5.1 Railways

`scene.rails` holds above-ground lines, already cut to the boundary. Draw each
as a 3.5 m ballast bed (gravel texture, L 0.62–0.70) per track, with sleepers
as an instanced strip every 0.6 m at street zoom and two rails (0.08 m, metal
tone) on top; merge into one mesh per material. Where several lines run
together, lay one wide bed. Add catenary masts every 50 m in electrified
regions, and an occasional train (life) if the bible wants motion there.
Never draw a railway as a road.

## 6. Materials

Road: `MeshLambertMaterial` with a noise map (±0.02 L, a few darker patches
of repaired asphalt). For a wet moment, lower L by 0.08 and add a faint
reflection of the sky colour (a mix toward horizon colour at 10 %).
Cobble and stone surfaces (historical, some regions) use a 0.4 m cell texture.

## Common mistakes

- Roads drawn per segment with boxes: z-fighting at junctions and
  thousands of draw calls.
- No sidewalk or kerb: buildings sit straight on asphalt.
- Markings at full white and full opacity: too loud. Keep them at 85 % and
  slightly warm.
