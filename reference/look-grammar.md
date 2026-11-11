# Look grammar

A **look** is a style × palette preset. It never changes the scene geometry; it
decides how the same roles are drawn. Three looks are in scope.

## Styles

| style | what it does |
|---|---|
| `vector` | flat three-tone faces by orientation, heavy ink, paper ground; the colorfigures lineage |
| `voxel` | boxy stepped masses from footprints and storeys; blocky props |

## Palettes

- **warm** — the world's palette family look in `reference/render/palettes.json`
  (`walls`, `roofs`, `accents`, `ground`, `road`, `pave`, `grass`, `canopies`,
  `bloom`, `water`, `shadow`).
- **formal** — the same look snapped to Carbon neutrals in CIELAB
  (`reference/render/formal.md`); colour reserved for data.

## The three looks

| look | style | palette |
|---|---|---|
| `colorfigures` | vector | warm |
| `formal` | vector | formal |
| `voxel` | voxel | warm (or formal on request) |

Every look renders every role. An asset that only works in one look is a bug in
the grammar, not an exception.

## Roles (the only surface a look may colour)

`wall`, `roof`, `data`, `trim`, `glass`, `door`, `paper`, `garment`, `canopy`,
`leaf1`, `leaf2`, `bloom`, `trunk`, `ground`, `road`, `pave`, `water`, `shadow`,
`ink`, plus treatment roles.

Rules:

1. Geometry owns roles; the look owns colours; the style owns drawing.
2. `data` is the only recolourable surface. A style may not introduce a second
   data colour.
3. Missing data is a named `no data` tone in every look; never the ramp's low
   end.
4. People are `paper` + `garment` only. No skin, hair or identity token exists.
5. Red↔green is banned everywhere, data ramps included (G3). Superseded by
   `paperdolls-scene-craft/recipes/palette-method.md` §3.

## Formal mapping

Walls and roofs desaturate and snap to the nearest Carbon neutral; pavements
white; a faint grid may appear; greenery uses Carbon green, water Carbon blue;
states use Carbon data colours. The numeric tokens are in
`reference/render/formal.md`; verify recalled values before policy use.

## Adding a look

A new look is a new style × palette row plus, if it is a new style, a
description of how the roles are drawn. It is never a new renderer, a sprite
sheet, or a per-world one-off. Record it as a proposal until checked.
