# Structure grammar

This is the prose grammar for everything a scene is made of. It replaces the
authored JavaScript asset libraries: you define a structure by its **parameters
and roles**, and every look draws it. Do not add a sprite; add a grammar row.

## What a structure is

A structure has:

- a **kind** (`building`, `wall`, `habitat`, `ruin`, `infrastructure`, `other`,
  or a world-specific kind);
- a **footprint** in metres (a polygon);
- a **height** or **storeys** (assumed heights are counted and labelled);
- a **roles** map binding its surfaces (`wall`, `roof`, `data`, `trim`, `glass`,
  `door`, …) to the look;
- optional **state**, **economic class**, **neighbours**, **centroid**.

A scene's `structures[]` carries these. The vocabulary is open: a new kind needs
roles and a grammar row, not an enum change.

## Parametric building grammar

A building is drawn from a handful of parameters. No two worlds need the same
values, and no values are universal truths.

| parameter | meaning |
|---|---|
| `archetype` | a grammar row: terrace, shophouse, block, villa, tower, shed, or a world-specific row |
| `W` | frontage width (m) |
| `D` | depth (m) |
| `N` | storeys |
| `bay` | facade module width (m) |
| `storey_m` | storey height (m) |
| `roof` | flat, pitch, hip, mono-pitch, stepped, or a world-specific silhouette |
| `style` | facade grammar: house, shop, block, tower, shed, or a world-specific row |
| `sides` | blank, few, windows, ribbon |
| `overlays` | discrete geometry a simulation may switch on: band, scaffold, wrap, panels, flag, tint, outline, halo, segments |

Storeys default from the map data where present; otherwise from a type table,
counted as an assumption and labelled.

## Facade grammar

Windows, doors, shopfronts, awnings, balconies, shutters, cornices and roof
furniture are *procedural rules keyed to the region and archetype*, not art
files. A facade style declares proportions and features; a seeded variant
decides which bays get which. Regional facade tables are **proposals** to check
with local authors; they follow climate and building type, never identity.

## Structures that are not buildings

Walls, habitats, ruins and infrastructure declare the same roles and use the
same grammar. A wall has a footprint and a height, no storeys. A habitat may
have a different silhouette row. A ruin may suppress roof and glass roles. The
renderer treats them as structures; only the grammar row differs.

## Props

- **People** — paper dolls: one neutral paper tone for head and limbs; garment is
  the only personal colour; no skin, hair, face or identity variation. Nine
  compositional kinds and a mix, in `reference/data/people.json`.
- **Vehicles** — classes assigned to a network (`road`, `cycle`, `rail`) and a
  playback speed; fleets per region in `reference/data/vehicles.json`.
- **Trees** — nine kinds and regional species mixes in
  `reference/data/trees.json`; foliage takes the look's canopy tones.

## Selection

Selection is by rule from the world description, then the palette family's
proposal, then the user. Nothing is invented silently. Every regional, family or
genre mix is labelled a proposal until checked.

## Adding a structure kind

1. Add a row here: name, roles, parameters, silhouette rule.
2. Let the map or construct emit that `kind`.
3. The look colours its roles; the style draws it. No renderer change.
4. If it cannot be drawn, report it by name and count — never drop it silently.
