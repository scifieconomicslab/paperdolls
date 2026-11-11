---
name: paperdolls-art-direction
description: Decide what a paperdolls world should look like before any geometry is built — write the world's art bible (mood, palette, light, density, skyline, signature motif, life) from the world description, get it approved at Gate 2b, and hold every later render to it. Use at Gate 2b, when a world feels generic, or when the user dislikes the look.
---

# Art direction

Load at Gate 2b. You leave this skill with one file,
`worlds/<name>/art-bible.md`, which the user has approved. Every later visual
decision (`paperdolls-scene-craft`) and every review
(`paperdolls-beauty-review`) is checked against that file.

Why this step exists: without a written direction, every world falls back to
the same default, a beige plane with uniformly coloured boxes. A world draws
people in when it feels like **a particular place at a particular moment**.
The bible is where you decide which place and which moment.

## 1. Read before you write

First open the closest exemplar in `reference/exemplars/` (its captures and
its art bible). It shows what a finished bible looks like and the quality
the world must reach. Do not copy its moment or motif.

Read the world record (`<name>.md`): the verbatim description, the family
(`real | historical | fantasy | scifi`) and the palette family or genre. Read
`reference/render/families.md` for the genre's direction words, and the
palette family in `reference/render/palettes.json` as **hue hints only**.
Those hex values are starting points, not the palette.

If the description is too thin to answer the questions in §2, ask the user
**one** question. The most useful one is usually:

> When you picture this place at its most characteristic, what time of day is
> it, what is the weather, and what is one thing you would see on every
> street?

## 2. The art bible

Copy this template to `worlds/<name>/art-bible.md` and fill in every heading.
Use concrete nouns and numbers. Never write "clean", "modern", "sleek",
"vibrant" or "beautiful". They decide nothing.

```markdown
# Art bible — <world name>

status: proposed | approved YYYY-MM-DD

## Mood
- three material nouns: <e.g. wet brick, slate, tram wire>
- moment: <time of day + season + weather, e.g. 4 pm, late October, after rain>
- one-line feeling: <what a visitor would say after ten seconds, e.g. "a tidy, tired port town">

## Palette (built with scene-craft/recipes/palette-method.md)
| role | OKLCH | hex | note |
|---|---|---|---|
| ground (plots, pavement) | | | lightest band |
| road | | | |
| wall ×3–4 | | | building band |
| roof ×2–3 | | | hue distinct from walls |
| trim / window frame | | | |
| glass | | | |
| vegetation ×3 | | | |
| water | | | |
| accent family ×2 | | | the only saturated hue |
| ink | | | dark shade, never #000 |
| sky top / horizon | | | background gradient |
| data ramp | | | reserved; shares no hue with accent; written to `top_color.ramp` |
| from binding | | | treatment / flag colours declared in the binding: fixed inputs, keep accent and ramp ≥ 30° away |
| no data | | | neutral + hatch |

## Light
- key: azimuth <deg>, elevation <deg>, <K> kelvin, intensity <n>
- fill (sky): <K> kelvin; ground bounce colour <hex>
- shadow tint: <hex>, opacity <0–1>
- fog / atmosphere: colour <hex>, start <m>, density <low|mid>
- dusk behaviour: <windows glow? lamps? only if the day cycle is on>

## Density and skyline
- height gradient: <where is it tallest, where lowest, e.g. 2–3 storeys at edge rising to 8 at the market square>
- landmark: <one structure that reads at overview zoom, and why it belongs to the model>
- street character: <width, trees or not, parked cars or not, kerb height>
- world edge: <plinth | terrain into fog | coastline | wall> and its material

## Signature motif
<one recurring detail that makes this world itself, e.g. green shutters, rooftop water tanks, tram catenary, prayer flags, neon kanji signs. It appears on at least 1 in 5 buildings.>

## Life (decorative unless the model tracks it)
- what moves: <vehicles, pedestrians, boats, smoke, birds>
- how much: <quiet | busy> — vehicles per 100 m of road <n>, pedestrians per 100 m of sidewalk <n>
- model agents that move: <breed → how they are drawn, or "none">

## Data in the world
- beauty-view treatment of the top colour: <roof coping band | roof tint | banner | window light>
- data-lens look: <neutral world tone>
- what the user should notice first: <e.g. "which streets have retrofitted roofs">

## Not this
<two or three things this world must not look like, e.g. "not a generic US suburb", "not cyberpunk neon even though it is sci-fi">
```

### How to fill it well

- **Moment beats palette.** "Late afternoon, low sun, after rain" already
  settles the light angle (elevation 25–35°), the temperature (3,800–4,500 K),
  wet dark roads, long shadows and lit windows. Choose the moment first, then
  derive the palette from it.
- **Contrast of temperature.** Pair a warm key light with a cool sky fill, or
  the reverse for a cold world. The shadow side should shift hue, not only go
  darker. This one choice does more for depth than any amount of geometry.
- **One saturated family.** The world is mostly low-chroma. The accent family
  (shop awnings, doors, signage, flowers) carries all the saturated colour,
  and the data ramp is kept apart from it, so data never camouflages as
  decoration.
- **Real places look specific.** For `real` worlds, write what is actually
  characteristic of the region's built fabric: roof material, wall material,
  street trees, shutters, awnings, balconies, roof tanks, AC units. Cite
  climate and building type, never the identity of the people who live there.
- **Genre worlds pick a lane.** Choose one genre from `families.md` and
  commit to it. Do not blend two palettes. A sci-fi world can still be quiet.
- **The landmark must be honest.** It is a decorative or model-declared
  structure, and the world record labels it as such. In a constructed world it
  can be invented (labelled). In an OSM world, use a real large or distinctive
  footprint (station, church, market hall, tower), not a fabricated one.

## 3. Gate 2b — approve the bible

Show the user the bible's **Mood**, **Light**, **Signature motif**, **Not
this** and the palette as swatches: a small HTML strip, or the hex list
rendered as a table. Ask one question:

> Is this the place and the moment you meant?

Edit until they say yes. Set `status: approved YYYY-MM-DD`, append to the
decisions log:

```text
- YYYY-MM-DD — Gate 2b (art bible): approved; moment "<moment>"; motif "<motif>"; palette proposed
```

and record `look: house` in the world record and, at Gate 5, in
`model-binding.json` (the page's world plugin must accept `house`). Name the
data ramp here (palette-method §3); the world record's Top colour section
takes its name at Gate 5. An old record that still says red↔green is
migrated here and logged. The palette remains a **proposal** (it was chosen by
eye), and the page's About panel says so.

## 4. The style frame (at Gate 4)

The bible is words. The first render, at Gate 4, is the **style frame**: one
street-zoom image of the most characteristic block, built to the bible. At
Gate 4 the user approves two things: that the map is the place they meant,
and that the style frame matches the bible. Run
`paperdolls-beauty-review` §Gate 4 before showing it.

If the user dislikes the style frame, return to the bible and change the
**moment** or the **palette** first. Changing geometry first is rarely the
fix.

## 5. Changing the direction later

A change to the bible is a new decision. Append it to the decisions log, set
`status` back to `proposed` until the user approves, and re-run the beauty
review. Never quietly drift from the bible during the build.
