# Recipe — nature and water

Goal: greenery and water that feel soft and alive against the hard city:
trees with volume and variety, grass that is not a flat polygon, and water
that moves and has a shore.

## 1. Trees

Kinds (read `reference/render/trees.md` for regional mixes, as proposals):

| kind | construction (merged into one geometry per kind) | height |
|---|---|---|
| round deciduous | trunk (cylinder r 0.18, 6 sides) + 3 icosahedra (detail 1) clustered, radii 1.4 / 1.1 / 0.9, offsets ±0.6 m | 6–10 m |
| conifer | trunk + 3 stacked cones shrinking upward | 8–14 m |
| columnar (poplar, cypress) | trunk + a stretched icosahedron (scale z 2.5) | 8–12 m |
| palm | curved trunk (4 segments) + 6–8 flattened leaf blades (thin boxes) radiating | 6–10 m |
| shrub | 2 small icosahedra, no trunk | 1–2 m |
| flowering | round deciduous + a sparse bloom scatter (small icosahedra in bloom colour) | 4–7 m |

- **Vertex jitter:** before merging, displace canopy vertices by noise
  (±8 % of radius). Smooth icosahedra look like plastic balls.
- **Colour:** vertex colours, with the lower canopy half at vegetation L −
  0.06 (self-shadow) and the top at L + 0.04. Each instance gets
  `instanceColor` from the 3 vegetation tones, ± 3° hue.
- **Instances:** one `InstancedMesh` per kind, with scale 0.8–1.3 and a random
  z-rotation. Trees cast shadows (they are a big part of the beauty), but do
  not receive them on themselves at overview.
- **Wind (decorative):** in the vertex shader (`onBeforeCompile`), sway
  canopy vertices by `sin(time·0.8 + instancePhase) · 0.06 · heightFactor`.
  Turn it off under reduced motion and in snapshots.

### Placement

- **Street trees:** on sidewalks ≥ 3 m wide, every 8–12 m, 1 m from the
  kerb, skipping junction corners, driveways and bus stops. Use the same kind
  along a street, which feels planned.
- **Parks and woods:** Poisson-disc sampling (min distance 4–7 m) with a
  low-frequency noise mask, so trees cluster and leave clearings. Mix 2–3
  kinds.
- **Gardens:** 0–3 trees and 1–5 shrubs per house plot, behind the building
  line.
- `scene.json` trees (from OSM or the constructor) are placed first and
  marked as data. Generated ones are decorative and counted.
- Never place a tree on a road, building, water or another tree.

## 2. Grass, hedges, flowers

- Grass areas: vegetation tone modulated by world noise (two octaves, ±0.04 L,
  ±6° hue). For wild areas, add sparse grass tufts at street zoom (instanced
  small cones in vegetation L − 0.05).
- Hedges: extruded strips 0.8–1.4 m high and 0.6–1 m deep along plot edges,
  vertex-jittered tops, in vegetation tone 1.
- Flower beds: low strips with an instanced scatter of tiny boxes in 2
  accent colours. These are one of the few places the accent family may
  appear on nature.

## 3. Water

Water is the first thing the eye goes to. Make it worth looking at.

- **Depth gradient:** compute a distance-to-shore field on a canvas (draw
  the water polygon, blur it 20–40 px, read it back) and use it as a texture:
  shallow water L + 0.08 and C − 0.02, deep water at base. Rivers get the
  same treatment along their width.
- **Shoreline:** a 1–2 m band just inside the polygon at L + 0.12 C × 0.5
  (foam or sand), plus a 0.3–0.6 m embankment step if the bank is urban
  (quay wall in sidewalk/stone colour, 0.6 m high).
- **Surface shader (decorative motion):** a `ShaderMaterial` or
  `onBeforeCompile` on a Lambert plane with two scrolling world-space noise
  layers for ripple lines (thin light streaks, 10 % opacity) and a faint
  vertical sky-reflection tint. It sits on the `NO_INK` layer. Under reduced
  motion and in snapshots, freeze it.
- **Life on water:** moored boats along quays, a few slow-moving boats on
  larger water, both decorative (life.md).

## 4. Terrain

If `scene.terrain` is present, displace the ground plane by the grid
(`PlaneGeometry` with nx × ny segments, z from the grid). Seat buildings on
the minimum footprint z and extend their plinth down to the lowest corner.
Draw roads on terrain as draped strips (sample z per vertex). Add contour
hints with subtle hillshading: multiply the ground colour by a precomputed
`0.9 + 0.1 · dot(normal, keyDir)`.

## Common mistakes

- Lollipop trees, all the same size and colour, on a grid.
- Water as a flat blue polygon with jagged edges.
- Greenery as saturated as the accent family: it fights the data. Keep
  vegetation C ≤ 0.11.
