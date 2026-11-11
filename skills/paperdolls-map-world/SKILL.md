---
name: paperdolls-map-world
description: How to acquire a real place from OpenStreetMap or construct one natively, how to clean structures through the archetype cascade without inventing facts, the scene contract, and how to verify the map in the chosen look before anything is built on it.
---

# The map and the world

Load at Gate 3 (source) and Gate 4 (verify). Two equal paths, one output:
`map-data/scene.json` plus `map-data/scene_report.md`.

## 1. Ask the source

In one message:

> a) Import a place from OpenStreetMap — a relation id, a bounding box, or an
>    extract file.
> b) Construct a place from your description.

Neither is privileged.

## 2. OSM path

```bash
cd tools
../.venv/bin/python -m ingest osm-query --relation <id> --out ../worlds/<name>/map-data/query.ql
../.venv/bin/python -m ingest osm-fetch --relation <id> --out ../worlds/<name>/map-data/extract.json
../.venv/bin/python -m ingest ingest ../worlds/<name>/map-data/extract.json \
    --out ../worlds/<name>/map-data/scene.json \
    --boundary-relation <id>      # or --bbox "south,west,north,east"
```

If the server is busy (429, 502, 504): Overpass is often at capacity, so
retry before giving up. Wait 30 s, 60 s, then 120 s between attempts, and on
the third try add `--endpoint https://overpass.kumi.systems/api/interpreter`.
If all four attempts fail, or the machine is offline: save `query.ql`, give
the exact overpass-turbo path and the file to hand back, and stop. Never
proceed without data; never substitute a bbox for a relation the user named.

**Finding the relation id.** When the user names a place but not an id, search
nominatim (`https://nominatim.openstreetmap.org/search?q=<place>&format=json`)
and take the `osm_id` of the result whose `osm_type` is `relation` and whose
`type` is `administrative`. Show the user the name and id before fetching.

**Cleaning.** Apply the cascade in `reference/building-archetypes.md`:
`building=<known type>` → `shop|amenity|office|man_made|craft|industrial|…` →
`building:use` → `landuse` → a seeded procedural fallback from the local mix.
Record, per structure, an `economic_class` (or `outbuilding`/`other`) and a
visual role. Count every rule. Lifecycle keys (`abandoned`, `collapsed`,
`proposed`, `no`) fold into state or `out`.

**Land use.** Natural and leisure features land as land-use polygons (wood,
scrub, grassland, water, wetland, sand, bare_rock; park, garden, pitch,
playground, golf_course, nature_reserve, dog_park, allotments, cemetery,
orchard, meadow, farmland). When categories are unclear, offer enrichment from
a local classified raster (CORINE defaults) and let the user map the classes:

```bash
../.venv/bin/python -m ingest landuse-classes --raster FILE --emit-mapping OUT.json
../.venv/bin/python -m ingest ingest extract.json --landuse-raster FILE --landuse-mapping OUT.json --out scene.json
```

Ambiguous codes stay counted fallbacks. The osmlanduse WMS pull is not
automated; if no raster can be had, say so and keep OSM-only tagging.

## 3. Construct path

```bash
cd tools
../.venv/bin/python -m construct spec > ../worlds/<name>/map-data/spec.json
# edit spec.json with the user's answers: extent, seed, pitch, square/pond/parks,
# district flavour, and any explicit non-building structures
../.venv/bin/python -m construct generate --spec ../worlds/<name>/map-data/spec.json \
    --out ../worlds/<name>/map-data/scene.json
../.venv/bin/python -m construct validate ../worlds/<name>/map-data/scene.json
```

The generator is seeded and deterministic. The world record must say the map is
synthetic. Districts and archetypes in the spec are parameters, not realism
claims; a new structure kind is a new row in the spec and the grammar, never a
code branch.

## 4. The scene contract

`scene.json` is the interface. Its **shape** is enforced; its **vocabulary is
open** (see `schemas/scene.json`).

```jsonc
{
  "area": { "name", "source": "osm|constructed", "attribution", "origin",
            "rotation_deg", "north_on_screen_deg", "extent_m", "generated",
            "ingest_version", "family", "palette", "boundary": [[x, y], …] },
  "structures": [{ "id", "kind", "footprint", "levels", "archetype",
                   "roles": { "wall": "…", "roof": "…" }, "economic_class",
                   "state", "height", "levels_assumed", "centroid", "neighbours" }],
  "roads": [{ "id", "class", "pts", "width", "tram", "cycle", "name" }],
  "landuse": [{ "id", "kind", "cover", "footprint" }],
  "rails": [{ "id", "kind", "pts" }],
  "trees": [[x, y] | [x, y, kind] | [x, y, kind, scale]],
  "terrain": { "x0", "y0", "dx", "dy", "nx", "ny", "z": [] }
}
```

- `area.boundary` is the clip polygon in scene metres: the world's edge. The
  plinth, the ground plane and the overview camera fit use it, never the
  bounding rectangle. Roads, rails and land use are already cut to it.
- `landuse.kind` is coarse (park, garden, water, square, rail, bare) and
  `cover` is finer (wood, scrub, grass, meadow, pitch, playground, cemetery,
  allotments, orchard, railway, brownfield, …). Every kind and every cover the
  scene carries gets its own surface (`nature-and-water`); none may fall back
  to a flat untextured fill.
- `rails` are above-ground railway lines: ballast, sleepers and two rails, on
  their own cutting or embankment, never drawn as roads.
- **Which structures households live in.** Each building carries
  `residential`: `residential` (tagged), `probable` (an untagged building the
  type and size rules call a likely home) or `other`. A model's households
  stand on `residential` and `probable` only; say the probable share aloud as
  a guess. A model that needs non-homes (shops, workplaces) binds those by
  `economic_class`.
- `structures` is the general array; `kind: "building"` is the common case.
- `roles` maps the structure's surfaces to material roles the renderer
  understands. A new kind must declare roles; it does not need a new enum value.
- Missing values are absent or `null`, never a zero that looks measured.
- Legacy `buildings` is accepted when `structures` is absent.

## 5. Read the report to the user

Say aloud: structure count, rotation and why, asset fit percentage, extrusion
share, assumed-storey share, fallback share, the skipped table and warnings.
Call out specifically:

- fallback > ~50%: "X% of structures have no readable use; their class is a
  seeded guess. Confirm, provide better data, or accept."
- most storeys assumed: "heights are mostly assumed, not measured."

## 6. Verify — Gate 4

Build once and snapshot in the chosen look:

```bash
node tools/bench/screenshots.mjs --world /abs/path/to/worlds/<name>
```

The page implements `?snapshot=1&view=top|iso&angle=<deg>`; the script writes
`top-down.png`, `iso-0.png` and `iso-90.png` to `map-data/verify/`.

Put the three on one sheet and open only that:

```bash
.venv/bin/python tools/bench/review.py sheet worlds/<name>/map-data/verify/sheet.png \
    worlds/<name>/map-data/verify/top-down.png worlds/<name>/map-data/verify/iso-0.png \
    worlds/<name>/map-data/verify/iso-90.png --labels top-down,iso-0,iso-90
```

Attach `sheet.png` and the report's three numbers.
Ask: *is this the place you meant?* Fix and re-snapshot until yes. Do not rotate
or reshape by hand; if the map is blank, re-check the rotation table and run
`--rotation none` as a diagnostic.

## 7. What the map must never do

- Invent a structure, a road, a land use or a count.
- Present an assumed height or class as measured.
- Drop a polygon or a skipped structure silently.
- Fetch anything at view time.
