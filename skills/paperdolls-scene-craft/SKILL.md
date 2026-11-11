---
name: paperdolls-scene-craft
description: How to draw a paperdolls world in three.js so it is detailed, alive and beautiful — the house style in numbers, the build order, the three zoom levels and what each must show, and the technique recipes (render pipeline, light, palette, buildings, streets, nature, water, life, data, camera, composition, performance). Use at Gate 4 (first render / style frame) and Gate 7 (full build).
---

# Scene craft

All rendering is three.js (core + `three/addons`). The repository ships **the
stage and nothing visual**: `tools/stage/` is the plumbing every world needs
(render pipeline, camera and controls, the snapshot contract, the model
worker), and it takes every colour and strength from the art bible. Everything
the eye judges (ground, buildings, streets, nature, life, data, palette) you
write for each world from this skill and its recipes. That is deliberate: a
shared kit of buildings caps every world at the kit's quality. What keeps
worlds consistent is the stage, the **house style below, in numbers**, and
the beauty gate (`paperdolls-beauty-review`).

**Start a page project** with `node tools/stage/vendor.mjs worlds/<name>`. It
creates `page/` from the template (pinned packages, single-file Vite config,
model worker, a `main.tsx` with the wiring in order) and copies the stage into
`page/src/stage/`. Never edit the copy: `vendor.mjs --check` fails on it at
Gate 7. If the stage is wrong, fix `tools/stage/` and say so in `skill-gaps.md`.
Do not start from another world's page.

Inputs: `map-data/scene.json` (geometry), `art-bible.md` (direction and
palette), `sim-code/model-binding.json` and `describe()` (data). Output: the
scene module inside the world's page project.

## 1. The house style (the contract)

These numbers are the paperdolls look. Change one only by recording it in the
art bible with a reason.

| lever | value |
|---|---|
| projection | `OrthographicCamera`, dimetric: elevation 30°, azimuth 45° (+ n·90° on rotate). z-up, metres |
| colour pipeline | `renderer.outputColorSpace = SRGBColorSpace`; `toneMapping = AgXToneMapping`; exposure **1.2–1.4** (calibrated 1.3 with the toon ramp and AO below); all palette colours authored in sRGB and converted by three |
| shading | `MeshToonMaterial` with a 3-step gradient map **150 / 210 / 255** (`NearestFilter`) for structures and props; `MeshLambertMaterial` for ground; no specular plastic. A darker ramp (e.g. 120/200/255) sinks the whole scene |
| ink | screen-space edge pass on depth + normals; 1.5 px at street, 1 px at neighbourhood, 0 at overview; ink = the surface colour × 0.35 shifted toward the bible's ink hue, never #000 |
| ambient occlusion | `GTAOPass` at half resolution, radius 1.6 m (street) → 3 m (overview), blend **0.65**; it must darken every wall–ground and wall–roof contact |
| shadows | one directional key; `PCFSoftShadowMap`, 2048²; shadow frustum **fitted to the visible area** every camera change; shadow opacity 0.55–0.75 tinted toward the fill colour |
| light | warm key against a cool sky fill (or the reverse, as the bible says): key 3,500–5,000 K at intensity **2.4–2.8**, fill 7,000–9,500 K as `HemisphereLight` at **1.5–1.8** (sky = fill, ground = ground colour × 0.6). At key elevation < 35°, hemisphere ≥ 0.6 × key, or the streets sink into shadow |
| depth cue | a **screen-space haze** toward the horizon colour (render-pipeline §6). `scene.fog` alone does nothing visible at neighbourhood zoom with an orthographic camera. Plus a vertical gradient background (sky top → horizon), never a flat fill |
| world edge | a designed edge: diorama plinth 6–12 m deep with a soil/rock face, or terrain falling into fog, or a coastline. Never a floating rectangle |
| value structure | ground lightest (OKLCH L ≥ 0.94) → walls (0.58–0.82) → roofs (≥ 0.15 below the wall mean) → ink darkest. Measure, don't guess: the neighbourhood squint must be at least as good as the exemplar's (beauty-review §2) |
| chroma budget | world surfaces OKLCH C ≤ 0.08; one accent family ≤ 0.16; data ramp reserved and distinct |
| variation | per structure: wall lightness ±5 %, hue ±4°, roof from 2–3 options, seeded; no two adjacent structures identical |
| data share | in the beauty view, data colour covers ≤ 15 % of structure pixels; the data lens shows it fully |
| motion | decorative life moves (labelled) and stops under `prefers-reduced-motion`; camera moves ease 250–400 ms (instant under reduced motion) |

## 2. The three zoom levels

Every world is judged at three zooms. Build detail for all three, and use LOD
to hide what a zoom cannot show.

| zoom | view width | must show | hide |
|---|---|---|---|
| **overview** | whole extent + 10 % | districts, skyline variation, landmark, water/park shapes, world edge, roof colour variety | openings, props, people |
| **neighbourhood** (opening shot) | ~180–260 m | window rhythm, sidewalks and markings, tree canopies, moving vehicles, roof furniture | people below 1 px, small street furniture |
| **street** | ~50–70 m | framed windows with sills, distinct ground floors (doors, shopfronts, awnings), roof detail, walking people, lamps, benches, fences, the signature motif | — |

**The page opens at neighbourhood zoom on the most interesting cluster**
(landmark or densest centre), not at fit. `F` fits to overview.

## 3. Build order

Build in this order and capture after each numbered step (beauty-review §1).
Do not polish step 6 while step 2 still looks flat.

0. **Look at the bar.** Open the closest exemplar in `reference/exemplars/`:
   its four captures and its art bible. Note three things it does that your
   world must also do. Its worked code is listed in the exemplar README; read
   it for technique when a recipe leaves you guessing, but write your own
   scene.
1. **Stage + light + ground + world edge.** Vendor the stage, fill its
   `StageLook` and `PlinthLook` from the art bible (`palette.ts`), add the
   plinth from `scene.area.boundary`, and lay the ground. An empty diorama
   should already look good: lit, graded, with a designed edge. You do not
   write the composer, ink, haze, shadow fit or AO; tune them through
   `StageLook`.
   → `recipes/render-pipeline.md`, `recipes/light-and-time.md`,
   `recipes/palette-method.md`
2. **Masses + roofs.** Correct footprints, heights and real roof shapes, with
   per-structure colour variation, AO and ink. Check overview now.
   **Calibrate here, before any detail:** capture, run `review.py pack`
   (numbers only; you need not open the board yet), and tune exposure,
   hemisphere and the palette's value bands until no `value:` FLAG remains. Value
   problems found after facades exist cost three rounds; found here they cost
   minutes.
   → `recipes/buildings.md` §1–3
3. **Streets and ground.** Roads with sidewalks and kerbs, markings,
   crossings, plot surfaces, land use with texture. → `recipes/streets-and-ground.md`
4. **Facades.** Openings, ground floors, trim, roof furniture, the signature
   motif. Check street zoom now. → `recipes/buildings.md` §4–7
5. **Nature and water.** Trees, hedges, grass variation, shorelines, water
   shader. → `recipes/nature-and-water.md`
6. **Life.** Vehicles, pedestrians, ambient motion, model agents.
   → `recipes/life.md`
7. **Data.** Beauty-view treatments, the data lens, hover and selection,
   legend colours. → `recipes/data-in-the-world.md`
8. **Camera.** The stage's rig already does controls, easing, the three
   shots and the snapshot URLs. Your part: choose `subject` (the landmark or
   the bible's subject) and `streetSubject` (the style-frame block), drive
   your LOD from `rig.state.width`, and call `markReady()` only when the frame
   is final. → `recipes/camera.md` §3, `recipes/composition.md`
9. **Performance pass.** → `recipes/performance.md`

`recipes/composition.md` applies **before** step 2 if the world is
constructed, or if an OSM crop has no centre.

## 4. Recipes

| recipe | read when |
|---|---|
| [render-pipeline](recipes/render-pipeline.md) | setting up renderer, composer, AO, ink, shadows, background, fog |
| [light-and-time](recipes/light-and-time.md) | key/fill/sky, colour temperature, optional day cycle, dusk lights |
| [palette-method](recipes/palette-method.md) | building the bible's palette and data ramps in OKLCH |
| [composition](recipes/composition.md) | the map lacks a centre, landmark, height gradient or edge |
| [buildings](recipes/buildings.md) | masses, roofs, facades, ground floors, roof furniture, non-building structures |
| [streets-and-ground](recipes/streets-and-ground.md) | roads, sidewalks, markings, plots, land use, street furniture |
| [nature-and-water](recipes/nature-and-water.md) | trees, hedges, grass, flowers, water, shorelines, terrain |
| [life](recipes/life.md) | traffic, pedestrians, smoke, birds, cloud shadows, model agents |
| [data-in-the-world](recipes/data-in-the-world.md) | top colour, treatments, data lens, ramps, no-data, hover/select |
| [camera](recipes/camera.md) | projection, zoom levels, opening shot, controls, snapshot URLs |
| [performance](recipes/performance.md) | budgets, instancing, merging, LOD, adaptive resolution |

Recipes contain short snippets. Apart from `render-pipeline` and `camera`,
whose mechanics now live in the stage (read them to understand and tune it),
they are **techniques to write into the world's code**, not modules to import.
Write them in the world's style, and keep one file per concern
(`palette.ts`, `ground.ts`, `buildings.ts`, `streets.ts`, `nature.ts`,
`life.ts`, `data.ts`).

## 5. Data contract (unchanged from the old skill)

- Only fields declared in `model-binding.json` / `describe()` change
  appearance. Decorative surfaces never take data colour.
- Missing data is a named state (`no data` tone + hatch), never the low end
  of a ramp.
- People are paper dolls: one paper tone for heads and hands, garment is the
  only personal colour, no identity signals.
- The renderer computes no economic quantity.
- Decorative life, trees, the landmark (if invented), placements and palettes
  are labelled in the About panel.
- Nothing is fetched at view time.

## 6. Snapshot URL contract

The page must implement these query parameters; the beauty gate and Gate 4
capture depend on them:

| param | effect |
|---|---|
| `snapshot=1` | hide UI chrome, fix the seed of all decorative randomness, disable easing |
| `shot=overview\|neighbourhood\|street` | set that zoom on the default target |
| `lens=1` | turn the data lens on |
| `angle=<deg>` | azimuth offset (0, 90, 180, 270) |
| `view=top` | straight-down orthographic (map check) |
| `t=<tick>` | advance the model to tick t before capture. Default: `defaultTick()` from the stage, fed the top-colour field every 10th tick of one headless run: the largest interquartile range for a continuous field, the most mixed states (entropy) for a categorical one, else 0.75 × horizon. A tick where every value is equal makes the lens unreadable |
| `clock=<seconds>` | set decorative-life time; the capture tool steps it for clip frames |

The stage implements the parsing and the camera side (`readSnapshot`,
`applyShot`). The world does the rest: jump the model to `t` in its worker
(`sim.run(id, t, false)`, posting only the last frame, so a 360-tick jump does
not stall the page), apply that frame, hold decorative randomness to the seed
and life to `clock`, then call `markReady()`. The capture tool waits 15 s for
that flag; a page that misses it gets a fixed wait and a warning.

## 7. Build hygiene

- Pin the snippets to the repo's three.js version (`paperdolls-technology`
  §1; the stage and recipes are written against r180). After an upgrade, fix
  the stage's addon constructors first.
- The template already sets `emptyOutDir: false` (beauty-review captures live
  in `visual/review/`) and inlines the worker. Keep both.
- Keep palette and light constants in one `palette.ts`, mirroring the art
  bible's tables, so a bible change is a one-file change.

## 8. Never

- Ship a scene where a structure is only a box with a slab on top.
- Repaint whole structures with data in the beauty view.
- Use a red↔green ramp anywhere.
- Leave the world on a flat floating rectangle, or a flat background fill.
- Open at fit zoom.
- Rebuild geometry per tick: update instance attributes only.
- Claim a zoom level looks right without capturing it.
