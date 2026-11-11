# Recipe — composition of the world

Goal: the map itself has a structure the eye can follow: a centre, a
skyline that rises and falls, a landmark, an edge, and some irregularity. A
uniform grid of similar plots is the hardest thing to make beautiful, however
good the rendering.

Apply this **before** buildings are drawn. Every change to `scene.json` made
here is seeded, recorded in `scene_report.md` and in the decisions log, and
labelled. Constructed worlds are synthetic anyway; OSM worlds may only be
**framed**, never reshaped.

## 1. What a composed world has

| element | constructed world | OSM world |
|---|---|---|
| centre | a square or market at the densest point | choose the crop so a real centre (square, station, high street) is inside it |
| height gradient | storeys rise toward the centre or along one avenue (spine) | as mapped; assumed storeys follow the same gradient rule and are counted as assumed |
| landmark | one structure marked `landmark: true` (+40–100 % height, distinct roof), labelled invented | the largest civic, religious, transport or tallest footprint, marked `landmark: true`; it is a real structure, only its emphasis is a choice |
| irregularity | perturb the street grid: one diagonal or curved road, blocks of 2–3 sizes, 5–15 % of junctions offset | free |
| edge | water, park belt, rail line, wall, or a plinth (render-pipeline §7) | crop along a natural boundary (river, rail, park) where possible |
| breathing space | 8–15 % of area as parks, squares, water | as mapped |
| contrast | at least one district of a different grain (industrial sheds, villas, towers) | as mapped |

## 2. Constructed worlds: using the constructor

`tools/construct` today offers these spec keys: `extent_m`, `seed`,
`street_pitch_m`, `avenue_every`, `park_blocks`, `pond`, `square`,
`centre_frac`, `industrial_frac`, `family`, `palette`, `structures`. Use them
first. The defaults give a uniform grid, so for most worlds you should set
`centre_frac` 0.2–0.3, `industrial_frac` 0.1–0.2, `park_blocks` ≥ 2, and
`square: true`.

The constructor does not yet produce a height gradient, a landmark or
irregular streets. Until it does, apply a **composition pass**: a short,
seeded script in `worlds/<name>/map-data/compose.py` that reads
`scene.json`, then writes `scene.composed.json` and a summary appended to
`scene_report.md`. It may:

1. **Height gradient:** first clamp each structure's storeys to the bible's
   band for its archetype (e.g. villas 2, terraces 2–3, central blocks 4–6),
   then place it inside that band by distance:
   `levels = round(lo + (hi − lo) · g(d))` with `g(d) = (1 − d/dmax)^1.5`
   (d = distance to the centre or spine). Mark them `levels_assumed: true`.
   Scaling the constructor's noisy storeys instead gives a plateau, not a
   gradient;
2. mark one central structure `landmark: true` and raise it;
3. merge 2–4 adjacent small parcels into one larger civic or market
   footprint;
4. remove buildings on one block and give that block to a park or water
   (counted);
5. **repairs**: re-seat land use that overlaps roads or buildings, close
   junction gaps where roads stop short, and trim or flag roads outside
   `extent_m` (all counted). The current constructor produces these defects.

**Merging or removing structures changes the model's entity count** when
structures are anchored agents (473 → 472 in the exemplar). Report the new
count next to the binding, re-confirm Gate 5's agents → structures answer,
and log it.

It may not invent a road network that contradicts `roads`. If the world
needs curved or diagonal streets, extend the constructor spec instead. That
is a tool change, so report it as a gap.

## 3. OSM worlds: framing

- Offer the user 2–3 crops (bbox or relation) and say which one contains a
  centre, a landmark and an edge. A crop that is all fabric with no centre
  will look like a texture.
- Pick the landmark by rule (largest civic or religious footprint, else
  tallest, else largest), and state the rule in the report.
- Keep everything else as mapped.

## 4. Breaking up the grid

The exemplar's overview still reads as a grid, because the constructor only
makes grids. Without touching roads you can still:

- give the outer ring of blocks a different grain (sheds, yards, allotments)
  and the band inside it a lower, greener grain;
- turn 1–3 blocks into a park belt or a water edge running across the town;
- vary block use so that no two adjacent blocks look alike at overview;
- line avenues with trees and leave locals bare, so the hierarchy shows.

## 5. Check

At overview zoom (beauty-review), you should be able to:

- point at the centre within one second;
- see the skyline rise somewhere and fall somewhere;
- find the landmark;
- see where the world ends and why.

If you cannot, recompose before building facades.
