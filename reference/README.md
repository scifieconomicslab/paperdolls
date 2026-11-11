# Reference set

Plain, LLM-readable material. Everything here is a **proposal** until checked
with local authors or measured; nothing is a measured fact about a real place.

| path | what it is |
|---|---|
| `render/palettes.json` | world-family palette families and their looks |
| `render/families.md`, `render/family-packs.json` | the world-family menu and packs |
| `render/formal.md` | the formal palette and Carbon tokens |
| `render/trees.md` | tree kinds and regional mixes |
| `look-grammar.md` | legacy: the old three looks (colorfigures, formal, voxel); new worlds use `skills/paperdolls-scene-craft/` |
| `structure-grammar.md` | **the structure/prop grammar that replaces the old JS asset libraries** |
| `building-archetypes.md` | the OSM economic-class cascade (normative) |
| `buildings/` | visual archetypes and regional facade grammar |
| `people/` | paper-doll kinds, selection, behaviour |
| `vehicles/` | vehicle classes, networks, fleets |
| `data/` | machine-readable kinds, mixes and fleets (open vocabulary) |
| `templates/world.md` | the world record template |
| `ui-rules/` | the blocking gates and the craft pass |

## Old names → new names

- **register** (the old drawing flag) → **look** (`colorfigures`, `formal`,
  `voxel`).
- **catalogue/lib/*.js** (authored geometry) → `structure-grammar.md` prose +
  `data/*.json`. Do not reintroduce a compiled asset library.
- **catalogue.html** and the fidelity screenshots are not carried.

Colours are materials and light, never who lives there. People are paper
dolls: one neutral tone, no identity signals.
