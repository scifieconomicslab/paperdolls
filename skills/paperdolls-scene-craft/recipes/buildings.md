# Recipe — buildings and other structures

Goal: at street zoom every building is a particular building, with a real
roof, a ground floor that says what it is, and a facade with rhythm. At
overview the rooflines vary and the landmark stands out. All geometry is
generated from `scene.json` plus a per-structure seed. There are no sprites
and no authored models.

The archetype table, economic classes and facade rules are in
`reference/structure-grammar.md` and `reference/buildings/visual.md`. This
recipe is how to **draw** them.

## 1. Masses

For each structure:

1. **Fit an oriented rectangle** (minimum-area rectangle of the convex hull).
   If rectangularity ≥ 0.82 and the min side is ≥ 3 m, draw the body as an
   oriented box. This is the common case, and it gives four clean faces for
   facades.
2. Otherwise, draw an `ExtrudeGeometry` of the footprint (`bevelEnabled:
   false`, depth = height) and treat each edge ≥ 3 m as a facade face. Count
   these in the report.
3. Height = `levels × storey_m + (ground_m − storey_m)`, with storey_m and
   ground_m from the archetype table in `reference/buildings/visual.md`.
   Defaults if a row is missing: storey 3.1 m; ground 3.0 m (houses,
   terraces), 3.8 m (shops, central blocks, offices), 4.2 m (sheds). Assumed
   levels stay assumed: draw them, and the report counts them.
4. Add a **plinth band**: the bottom 0.5–0.8 m, 4 % wider, wall colour L −
   0.08. Add a **cornice** (flat roofs): a 0.3–0.5 m band at the top, 0.25 m
   proud, trim colour. These two cheap boxes make a box read as architecture.

Draw rectangular bodies as one `InstancedMesh` of a unit box per material;
draw extruded ones merged per material (`BufferGeometryUtils.mergeGeometries`)
with vertex colours.

### 1.1 Clean real footprints first

OpenStreetMap walls arrive split into many short edges (buttresses, chamfers,
survey noise). Before fitting anything:

1. Simplify the ring (Douglas–Peucker, 0.4 m).
2. Merge consecutive edges whose directions differ by < 8°.
3. Fold every edge shorter than 1.5 m into its longer neighbour.

Only then pick facade faces: edges ≥ 3 m after cleaning. A building whose
faces are all shorter than 3 m gets the plinth, cornice and roof, with no
openings. Count both in the report.

### 1.2 Split long terraces into plots

A row of terraced houses is often mapped as one footprint 40–120 m long. One
body and one roof over it reads as a barracks (the first Jette runs drew 60 m
gables). Split it before drawing:

- **When:** residential archetypes (house, terrace, apartments, mixed with
  homes above), long side > 24 m, short side 6–16 m.
- **Street side:** the long edge nearest a road (`scene.roads`).
- **Plot widths:** walk along the street side cutting plots of 5–7.5 m in
  north-west Europe (Brussels, Amsterdam, London terraces: 5.5–7 m), seeded
  per footprint; other regions take theirs from the structure grammar. The
  last plot takes the remainder if ≥ 3.5 m, else joins its neighbour.
- **Each plot is a building:** its own wall colour from §3 variation, its
  own eave height (± 0.3–0.6 m, steps every 1–3 plots, never every plot), its
  own roof choice among the region's 2–3 terrace roofs, its own door and
  ground floor. Party walls between plots get a 0.15 m proud strip in trim
  colour on the facade so the plot line reads.
- **Roofs on a terrace:** ridges parallel to the street, broken at every eave
  step with a short gable end. Vary by seed: 30–50 % of plots get a dormer,
  chimneys sit on the party walls. **Never** repeat one identical gable per
  plot down the whole row; that sawtooth reads as a fence.
- The data stays on the **original structure**: every plot of one OSM
  building shows the same data value and highlights together on hover.

## 2. Roofs

Choose the roof by archetype and region (structure-grammar). Make unit
geometries once and scale them per instance.

| roof | shape | parameters |
|---|---|---|
| flat + parapet | parapet ring 0.8–1.1 m high, 0.25 m thick, coping in trim colour; roof surface slightly darker than the roof colour | 1–4 roof objects (§6) |
| gable | prism along the long axis | pitch 30–45°; overhang 0.3–0.5 m on all sides |
| hip | four slopes, short ridge | ridge = long − short side; make 3 geometries for ridge ratios 0, 0.3, 0.6 and pick the nearest |
| mono-pitch / shed | single slope | 8–15°; industrial and outbuildings |
| sawtooth | 3–6 repeated mono-pitches with glazed vertical faces | factories, large sheds |
| dome / stepped / spire | genre rows | from the family's structure grammar |

The unit gable runs along +x, spanning x ∈ [−½, ½], y ∈ [−½, ½], z ∈ [0, 1]:

```ts
function unitGable(): THREE.BufferGeometry {
  const v = [ // slopes (2 quads = 4 tris) + gable ends (2 tris); non-indexed for flat normals
    -.5,-.5,0,  .5,-.5,0,  .5,0,1,   -.5,-.5,0,  .5,0,1,  -.5,0,1,   // south slope
     .5,.5,0, -.5,.5,0, -.5,0,1,    .5,.5,0, -.5,0,1,   .5,0,1,    // north slope
    -.5,.5,0, -.5,-.5,0, -.5,0,1,                                  // west gable
     .5,-.5,0,  .5,.5,0,  .5,0,1,                                  // east gable
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
```

- **Roof instance:** scale `(L + 2·oh, W + 2·oh, rh + oh·tan(pitch))` with its
  base at the wall top, in roof colour, where `rh = (W/2)·tan(pitch)`. The extra
  `oh·tan(pitch)` keeps the pitch constant when the overhang widens the base.
  Without it, every overhang flattens the roof.
- **Gable infill:** the same geometry scaled `(L, W, rh − 0.05)`, in wall
  colour. This fills the triangular gable walls under the overhang. Two
  instances, and the house reads correctly.
- A 0.14 m thin dark slab under the roof's edge (the fascia's shadow line,
  `L + 2·oh × W + 2·oh`) sells the overhang at street zoom and hides the small
  gap between the raised eave and the wall.
- **Ridge cap:** a 0.55–0.75 m wide, 0.3 m strip along the ridge in trim
  colour. It is where pitched roofs carry data (data-in-the-world §2) and it
  gives every roof a crisp top line at neighbourhood zoom.

## 3. Colour and variation

Follow palette-method §5. In addition:

- Corner and landmark buildings get the most distinct wall colour of the set.
- Terraces: neighbouring units alternate between 2 wall colours and share a
  roof colour, with the roof ridge continuous across units.
- Industrial structures use the low-chroma end; civic structures the trim
  colour as their wall colour.

## 4. Facades

A facade face has an origin `p0` (left end at ground), a unit direction `u`
along the face, an outward normal `n`, and a length `Lf`.

```ts
const bays = Math.max(1, Math.round(Lf / bay));
const bw = Lf / bays;
const basis = new THREE.Matrix4().makeBasis(u, n, Z);          // x along face, y outward, z up
for (let s = 0; s < levels; s++) {
  const z0 = s === 0 ? 0 : groundH + (s - 1) * storeyH;
  for (let b = 0; b < bays; b++) {
    const module = pickModule(seed, s, b, bays, style);         // §4.1
    const c = p0.clone().addScaledVector(u, (b + 0.5) * bw);
    place(module, basis, c, z0, bw, s === 0 ? groundH : storeyH);
  }
}
```

`place()` writes instance matrices into one `InstancedMesh` **per part**.
Each part's unit geometry faces +y (outward), so the basis orients it.

### 4.1 Modules and rules

| module | parts | size (of bay width bw, storey h) |
|---|---|---|
| window | surround, glass, sill, (lintel), (shutters) | w = bw·0.45·winK, h = 0.5–0.6·h, sill at 0.9 m |
| tall window | surround, glass, sill | h = 0.7·h (civic, older centres) |
| balcony window | glass door, slab 1.2 m deep, railing | stack vertically in one bay column |
| door | recessed dark box, door leaf (accent), step, (canopy) | 1.0–1.2 × 2.2 m |
| shopfront | full-bay glass, stall riser 0.5 m, fascia band 0.6 m, (awning) | ground floor only |
| ribbon | continuous glass band per storey, spandrel in wall/trim | office |
| roller door | corrugated panel, frame | 3–4.5 × 3.5–4.5 m |
| high window | narrow strip at 0.75·h | industrial, side walls |
| blank | — | side walls of terraces, party walls |

Rules (from structure-grammar):
- exactly one door per street face, placed in a seeded bay, with none on
  party walls;
- ≥ 1 shopfront when the ground floor is retail or mixed use;
- never three `blank` modules in a row on a street face;
- balconies stack in one column;
- side faces of terraces are blank; side faces of detached houses get
  windows at half density.

### 4.2 Making openings read as openings

Do not cut holes. Layer thin parts so light and ink do the work:

| part | geometry | offset (outward) | colour |
|---|---|---|---|
| surround | box w+0.2 × 0.03 × h+0.2 | 0.015 | trim |
| glass | box w × 0.05 × h | 0.03 | glass, with the texture below |
| sill | box w+0.3 × 0.15 × 0.08 | 0.075, below glass | trim |
| lintel / hood | box w+0.3 × 0.12 × 0.12 | above glass | trim or wall L−0.06 |
| shutters | 2 × box w/2 × 0.04 × h | beside glass | motif / accent |

The sill and lintel cast small shadows, and the ink pass outlines the
surround. The **glass texture** is a `CanvasTexture` of 32×64 px: glass
colour; the top 25 % darker by L 0.08 (eave reflection); a 1 px mullion and
transom in trim colour; and a faint diagonal highlight. Make one texture per
window type. Lit windows (light-and-time §5) use the same texture with
emissive.

### 4.3 Ground floors by economic class

| class | ground floor |
|---|---|
| retail, mixed_use, supermarket, kiosk | shopfronts on street faces; fascia band in accent family; awnings on 40–60 % of shops (sloped prism, accent colour, stripes optional) |
| office, government | ribbon or tall glazing; a canopy over the entrance |
| apartments, residential | a **raised ground floor** (plinth band 0.9–1.2 m in a darker wall tone or stone, with 2–3 steps up to the door); door with a trim surround and fanlight; ground-floor windows with railings or a different lintel; balconies above on 30–60 % of blocks |
| house, terrace, villa, detached | the same raised plinth and steps; door with coloured leaf (accent); low front wall, railings or hedge at the plot edge; a bay window on 20–40 % of houses |

The ground floor must be distinguishable from the upper floors **for every
class** at street zoom. The exemplar's known weakness was residential
ground floors that read like the floors above.
| industrial, warehouse, manufacture | roller doors on the street face, high windows, a loading apron (concrete plot) |
| school, hospital, civic | tall windows, a pronounced entrance, the trim colour as wall |
| construction | scaffold (see data-in-the-world: only if declared; otherwise a plain unfinished body without roof) |
| ruins | broken top (per-bay random height), no glass, rubble boxes at the base |

## 5. Signature motif

The bible names one motif. Implement it as a part or a module, apply it to
≥ 20 % of eligible buildings by seed, and give it the accent or motif colour.
A motif that replaces a gable end (crow steps, Dutch gables, false fronts)
sets the roof's **end overhang to 0** on those ends, or the overhang pokes
through it. The exemplar's crow-stepped gables are 5 steps with a coping
slab on each step's shoulder.
Examples: shutters, rooftop water tanks, flower boxes under sills, neon
signs on fascias, prayer flags between roofs, tiled door surrounds, laundry
lines on balconies.

## 6. Roof furniture

| roof | objects (seeded, 1–4 per roof) |
|---|---|
| flat | AC units (1 × 0.8 × 0.8, grille texture), stair bulkhead (2.5 × 3 × 2.6), water tank on legs (r 0.6–1.2), skylights, vent stacks, antennas |
| pitched | chimneys (0.6 × 0.6, 1–1.5 m above the slope) on 50–80 % of houses in cold regions; dormers on roofs longer than 10 m |
| industrial | roof vents in a row, skylight strips |

**Never add decorative solar panels, green roofs or other retrofit-looking
objects** when the model declares a related treatment. Decoration must not
imitate data.

## 7. Non-building structures

| kind | drawing |
|---|---|
| wall | extruded strip; coping; historical walls get crenellations (alternating 0.6 m merlons) and towers at corners |
| habitat / dome | half-sphere or capsule, segmented rings; ribs as ink lines from the normal pass |
| infrastructure | tanks (cylinder + domed top), pylons (tapered lattice: 4 thin boxes + crossbars), silos (cylinder + cone) |
| landmark | the archetype's grammar pushed: +40–100 % height, a distinct roof (spire, clock, dome, crown), trim colour, and extra surface detail (§7.1) |

Genre families (`reference/render/families.md`) add their own rows in
`reference/structure-grammar.md` using these parts.

### 7.1 Landmarks

Every world needs one landmark you find in a second at overview
(`composition.md` says which structure). Pick it from the data first:
`amenity=place_of_worship`, `building=church|cathedral|chapel`,
`amenity=townhall`, a station, then the largest civic footprint. Draw it from
parts, using its real footprint's oriented rectangle:

| landmark | parts (sizes for a footprint of length L, width W) |
|---|---|
| **church** | nave: gable body L × W, eaves 9–12 m, steep roof 45–50°; west tower: square W × 0.6 at the narrow end, 2.2–2.8 × the nave eaves, with a spire 1.0–1.4 × the tower height (or a pyramid/onion cap by region); optional apse: half-cylinder at the east end, radius W/2, eaves 0.8 × the nave; tall arched windows (bay 4 m, 2:1 arches), a rose or round window on the tower front |
| **town hall** | hip-roofed block, eaves 1.3 × its neighbours; a central clock tower of 0.25 W square rising 1.6–2 × the eaves, with a lantern or spire; stone or pale trim colour; a raised ground floor with an arcade or steps |
| **station** | a long low hall with a barrel or sawtooth roof over the tracks, plus a head building with a clock; sits on `scene.rails` |
| **school / hospital** | the archetype's block pushed by height only; use them as the landmark only when nothing above exists |

Keep the landmark's walls in the world palette, take trim or the accent for
its roof crown, and give it 1.5 × the facade detail density of its
neighbours. If nothing qualifies, `composition.md` raises the largest central
structure and labels the emphasis as invented.

## 8. LOD

| view width | show |
|---|---|
| > 600 m | masses, roofs, cornices only |
| 200–600 m | + windows (glass only, no sill/lintel), shopfront fascias, awnings, roof furniture |
| < 200 m | + everything: surrounds, sills, lintels, shutters, doors, balcony railings, motif |

Switch groups by toggling `visible`. Fade with opacity only if it costs
nothing; a hard switch is fine. Instance counts and tiling are in
performance.md.

## Common mistakes

- Windows as flat dark rectangles with no surround or sill: they read as
  stickers.
- Identical window grids on every building: vary `bay`, `winK`, lintels and
  shutters per building and region.
- A 4-sided cone as a "pitched roof": it reads as a toy. Use gable or hip
  with an overhang.
- A ground floor that looks like the upper floors: the street loses its life.
- One roof over a 60 m terrace footprint, or one identical gable repeated
  per plot: split it (§1.2) and vary it.
- Facades placed on raw OSM edges: half the faces are slivers (§1.1).
- No landmark because the map has no tag for one: pick by rule (§7.1).
