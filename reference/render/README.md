# The look system

How paperdolls looks. A page does not pick colours itself: the **world family**
fixes the grammar and selection, the **palette family** fixes the colour, the
**look** chooses one of the three schemes, and the **style** fixes how the page
is drawn. All are chosen before the build and inlined; nothing is fetched at
view time.

> Every colour here is a **proposal chosen by eye, not sampled from
> photographs**, and every regional or genre table is a proposal to check with
> local authors. The palette file carries the same caveat
> (`"status": "proposed_starting_values"`).

## Families and looks

- **World family** — `real`, `historical`, `fantasy`, `scifi`. It supplies a set
  of palette families, a structure grammar, a fleet, people/tree mixes and
  treatment presets.
- **Palette family** — the colour unit inside a world family. For `real` these
  are the 12 regions; for the other families they are genres in
  [`families.md`](families.md). Each palette family has three looks.
- **Look** — one of the three colour variations of a palette family.
- **Drawing look (the page's look)** — `colorfigures`, `formal` or `voxel`; all
  three.js. Roles and rules are in [`../look-grammar.md`](../look-grammar.md).

## The three drawing looks

| look | style | palette | reads as |
|---|---|---|---|
| `colorfigures` | vector | warm | hand-inked flat colour, heavy ink, paper ground |
| `formal` | vector | formal | technical drawing, hairlines, colour reserved for data |
| `voxel` | voxel | warm or formal | blocky stepped masses from footprints and storeys |

`colorfigures` keeps the palette's own colours, flat with orientation tones.
`formal` snaps walls and roofs to Carbon neutrals in CIELAB and reserves colour
for data; tokens are in [`formal.md`](formal.md). `voxel` re-meshes structures
as blocky columns; the palette is the world's look.

## Files in this folder

| File | What it is |
|---|---|
| `palettes.json` | the `real`-family looks plus the authored proposal families |
| `family-packs.json` | world-family packs: structure kinds, fleet, mixes, treatments |
| `families.md` | the world-family menu |
| `formal.md` | the formal palette and Carbon tokens |
| `trees.md` | tree kinds and the `real` family's species mixes |

The look-agnostic roles, the look definitions and the rules for adding a
look live in [`../look-grammar.md`](../look-grammar.md). The asset grammar lives
in [`../structure-grammar.md`](../structure-grammar.md).

## Rules for the LLM

- Never invent a look. Offer the three looks of the world family named in the
  world description from `render/palettes.json`, or a site-specific look the
  user authors.
- Never present a proposal colour as verified. The world record notes
  "look: `<id>` (proposed)".
- The top-colour ramp is a **data** channel: the binding names the variable,
  the art bible names the ramp (palette-method §3). Red↔green is banned (G3).
  The look only supplies the neutrals it sits on.
- If the user wants a specific brand/city palette, write it into the world
  record and `palettes.json` as a new look with `status: "site_specific"`,
  never overwrite the stock palette families.
