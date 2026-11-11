# Recipe — data in the world

Goal: the model's variables are readable without destroying the world. The
world wears its palette, and the data shows up as **meaningful accents**. When
the user wants to read values precisely, they turn on the **data lens**.

The binding (`model-binding.json`) is unchanged: `bindings[].top_color`,
`wall_color`, and `architecture[]` readings with `treatment`, `preset`,
`scale` and `label`. Only declared fields change appearance.

## 1. Two views

| | beauty view (default) | data lens (`L` key, toolbar toggle) |
|---|---|---|
| world surfaces | full palette | neutral: each surface → OKLCH (L same, C × 0.15, h toward the bible's horizon hue); vegetation and water keep 40 % of their chroma |
| props, people, traffic | full | dimmed (L toward ground by 50 %), still moving |
| top colour | roof **coping band** or roof tint (below) | whole roof + upper 30 % of the walls in ramp colour |
| treatments | full geometry | full geometry, legend visible |
| no data | hatch on coping | hatch on whole roof |
| legend | compact, appears on hover/select | anchored, full |
| ink | normal | slightly stronger (inkAmount + 0.1) |

Switching lenses tweens colours over 300 ms (instant under reduced motion).
Implement it as a uniform `uLens` (0–1) in the structure, ground and prop
materials, mixing between the beauty colour and the lens colour. Do not
rebuild anything.

The data lens replaces the old `formal` look.

## 2. Top colour in the beauty view

Choose one of these in the art bible:

- **Coping band (default for flat roofs):** the parapet coping and a 0.4 m
  band on the roof edge take the ramp colour. Data covers about 10 % of the
  building's pixels, is crisp at every zoom, and the roof keeps its material.
- **Ridge cap (default for pitched roofs):** the ridge cap (buildings §2,
  0.55–0.75 m wide) at 100 % ramp colour, plus an optional roof tint of
  **≤ 10 %** that may not move the roof's L by more than 0.03. Pitched roofs
  are about 40 % of a building's pixels from 30° up, so a 45 % tint repaints the
  world and lifts dark roofs above the walls. The exemplar's first round turned
  every roof lilac that way. The exemplar uses an 8 % tint + 0.75 m cap.
- **Window light:** the fraction of lit windows follows the value. Use only
  for occupancy-like variables, and only at dusk or night moments.
- **Banner / flag:** a facade banner or roof flag in ramp colour. Use for
  sparse or boolean-ish variables.

Whatever you choose, the legend must show **that** surface (for example a
small roof icon with the band) next to the ramp.

## 3. Ramps

From palette-method §3. Sequential ramps are OKLCH-built with monotonic
lightness. Diverging ramps meet at a light neutral at the declared midpoint.
Categorical sets have ≤ 7 colours, each paired with a pattern.

- **Red↔green is banned**, including traffic-light semantics.
- The ramp's hues must not overlap the accent family (± 25°).
- The domain comes from the binding. If it is undeclared, use the declared
  `range` from `describe()`, never the per-frame min/max, which would make
  colours jump as values drift.

## 4. Treatments (structural readings)

Each treatment is geometry plus a scale, driven by per-instance attributes.

| generic treatment | preset | geometry (all instanced, toggled by `count`) |
|---|---|---|
| growth | `scaffold` | a lattice box 0.4 m outside the walls: thin vertical poles every 2 m and horizontal boards every storey, in a timber or steel tone; height = value × building height; a crane on the largest site |
| extent | `segments` | completed storeys switch to the "done" cladding colour bottom-up (a per-storey band instance) |
| extent | `panels` | roof panel arrays, dark blue-grey with a light grid texture, filling the roof area by value in rows |
| replacement | `wrap` | upper storeys re-clad in the treatment colour with a horizontal seam texture, from the top down by value |
| overlay | `band` | a 0.5 m course at a storey line in the treatment colour |
| mark | `flag` | a pennant on a 2 m pole at the roof corner, colour by state |
| mark | `outline` / `halo` | the structure is drawn into the ink pass with the mark colour and 2× width (attention) |
| state | `tint` | the plot ground tints by category, with a pattern per category |

Rules:
- At most three readings, as agreed at Gate 5.
- **A mark is for the exception.** If one state of a `mark` (flag, outline)
  covers more than 30 % of eligible structures at the default tick, do not
  draw that state: mark the minority instead, or leave it to the lens. Four
  thousand pennants on the opening frame are noise, not information.
- A treatment never implies a fact the model does not declare. Scaffold means
  "this declared process is running", nothing more.
- When a value changes, **explain the change**: the instance lifts 0.3 m and
  settles over 400 ms, or the band grows. No looping pulses.

## 5. No data

The `no data` state draws the neutral colour **plus a 45° hatch** (a
world-anchored stripe texture at 0.6 m spacing) on the same surface the data
would occupy. It is listed in the legend with the hatch swatch. It is never
the ramp's low end and never just grey.

## 6. Touching the world

- **Hover:** the structure under the cursor gets an accent outline, and a
  small tag follows the cursor showing its name or class and the top-colour
  value with its unit. Throttle picking to one raycast per frame against the
  body `InstancedMesh`es only. The outline technique, because the ink pass has no
  per-object input:
  1. Keep one plain `Mesh` per body geometry (box, gable…) on a `SELECT`
     layer with a white `MeshBasicMaterial`. On hover, copy the hovered
     instance's matrix into it (`getMatrixAt` → `matrix`,
     `matrixAutoUpdate = false`) and show it.
  2. Each frame render only the `SELECT` layer (camera layer mask) into a
     small `maskTarget` (R8 or RGBA, same size as the normal target).
  3. In the ink shader, sample the mask at ±2 px: if the centre is 0 and any
     neighbour is 1, output the accent colour. That draws a 2 px outline outside
     the silhouette, unaffected by occluders, which is what you want for
     selection.
- **Select (click):** the outline stays, the camera eases to frame the
  structure if it is off-centre, and a card opens with every displayed field
  (Gate 5) with units, the value history sparkline if available, and "no
  data" where missing. `Esc` closes it.
- **Agent select:** the same for mobile agents, and the camera follows the
  agent until the user pans.

## 7. Legend

The legend's swatches are sampled from the **same functions** that colour the
scene. Show the ramp with ticks and units, the beauty-view surface icon,
treatment icons with their labels, and the no-data hatch. In the beauty view
it is compact, and it expands in the data lens.

## Common mistakes

- Painting whole buildings with data by default: the world disappears (this
  is what made the conformance city red).
- Using per-frame min/max for the domain: colours flicker as the run
  evolves.
- Legend colours typed by hand: they drift from the scene.
