# Whole commune of Jette: ingest run (P8)

Run on **2026-11-06** against the public Overpass service (`overpass-api.de`) for the administrative boundary of Jette, OSM relation **58258**, with the repo's own commands. It worked on the first try; nothing needed fixing.

```bash
paperdolls osm-fetch --relation 58258 --out cache/jette-commune-extract.json
paperdolls ingest cache/jette-commune-extract.json --boundary-relation 58258 --out cache/jette-commune-scene.json --name Jette
```

`cache/` is gitignored (the extract is 14 MB, the scene 4.4 MB). Rerun the two commands to regenerate. The scene and report are also copied to the shared notes folder (`jette-commune/`). The OSM data is the planet state of 2026-11-06 13:29 UTC (`timestamp_osm_base`), so a later run gives slightly different counts.

## Network behaviour

One POST, no retries, no polling, default endpoint, the repo's User-Agent. Query timeout set to 300 s in the query, client timeout 360 s. The answer came back in **56 s** (wall), HTTP 200, 14.4 MB of JSON, no `remark`. Nothing failed, so no fallback was needed. The extract is cached in `cache/`; the ingest and tests read the file, never the service. The earlier 2,162-building extract (bounding box 50.874,4.325,50.88,4.338) was reused for the tests (`cache/jette-bbox-extract.json`, not in the repo).

If the public server rate-limits (HTTP 429) or times out (504), `osm-fetch` says so and stops; the fallbacks are a smaller `--bbox`, another endpoint (`--endpoint`), or running `paperdolls osm-query --relation 58258` at overpass-turbo.eu and passing the exported file to `ingest`.

## What came back

| | |
|---|---|
| elements | 20,249: 15,690 ways, 4,521 nodes (all `natural=tree`), 38 relations |
| relations | 1 boundary (Jette, 11 members), 29 building multipolygons, 8 landuse/water multipolygons |
| ways | 10,103 buildings, 4,252 highways, 1,335 others (landuse, leisure, water, tram) |
| ways without geometry | 0 (`out geom;` worked) |
| relation fragments that failed to close | 0 (no warning from the reader; the boundary closed into one ring) |
| ingest warnings | none |

## What was drawn

| | |
|---|---|
| time | **3.5 s** to ingest (reading, clipping, classifying, adjacency, trees), single core |
| scene | 9,214 buildings, 1,320 roads (117 flagged as street-running tram, 21 own tram tracks), 1,089 landuse, 8,705 trees (4,521 mapped, 87 in rows, 4,097 scattered) |
| extent | 3,257 x 3,445 m |
| left out | 841 buildings under 8 m², 37 `building=roof`, 2 `construction`, 38 outside the clip; 2,184 footways, 324 driveways/parking aisles, 158 paths, 107 steps, 85 tunnels... |
| viewer | `validateScene` ok (88 ms), `createSim` 0.86 s for 9,214 buildings (node, no canvas) |

## Storeys: almost all assumed

| source | buildings | share |
|---|---|---|
| `tag` (building:levels) | 113 | 1.2% |
| `type-default` | 548 | 5.9% |
| `global-default` (building=yes, 2 storeys) | 8,553 | 92.8% |

`levels_assumed` is **true for 9,101 of 9,214 (98.8%)**. The 2,162-building test area is similar (about 98% assumed). So any model that reads storeys from OSM reads defaults, almost everywhere: the plan's "assumed" flag must be shown in the UI and the storey count must come from another source (the regional building register, or the pack's own typology) before it carries meaning.

## Asset fit

| | |
|---|---|
| ingest estimate | 28.8% after rotation, 26.4% without |
| renderer, exact (`sim.stats`) | **2,652 of 9,214 (28.8%)** drawn from assets, 6,562 as generic extrusions |
| reasons for extrusion | not rectangular 1,498; too small 420; the rest (about 4,600) rotated 12 to 45 degrees off the axes |

The estimate and the renderer agree. The frame rotation chosen was **0 degrees** ("none" had the highest asset share, 26%, against 24% for the building-edge, road and combined candidates): Jette is not one grid. Its districts run at different angles (the candidates' grid strengths are only 0.17 to 0.22 out of 1), so no single rotation fits more than about a quarter of the buildings, while the 2,162-building core fits 28% at 14.7 degrees. A per-building or per-district rotation is the real fix; it is a renderer change, not an ingest one, and it is not attempted here.

## Entity table (P3 fields) at commune scale

| | |
|---|---|
| `residential` | 433 residential (dwelling types), **7,672 probable** (plain `building=yes`, 30 m² or more, no use tag), 1,109 other (outbuildings under 30 m², garages, schools, hospitals, shops...) |
| neighbours | 8,480 buildings (92%) have at least one neighbour within 1.0 m; 9,207 links; at most 12 for one building |
| area | median 82 m² |

Only 433 buildings are tagged as a dwelling type, so the binding has to include `probable` to get any picture of the housing stock: with it, **8,105** model buildings (residential + probable); the toy pack's `bindScene` does this, takes 15 ms, and the 160-step toy run on those 8,105 entities takes about 1.4 s in node (the toy re-runs 600 entities in about 30 ms; this is a cost for P2 to remove, with a worker and `on_params: continue`). `probable` is a guess, counted in the report.

## What breaks, what does not

- **Nothing broke** in the readers, the relation clip or the boundary: the Overpass JSON reader handled relations, the boundary relation closed, no ways lacked geometry. The earlier note that the relation form of the query "has not been run" is now out of date and corrected (`ingest/query.py`, `ingest/fetch.py`, the CLI help).
- **Slow in the viewer, probably**: 9,214 buildings is within the validator's 30,000 limit and the ingest's 25,000 warning, but the first far-zoom frame cost 4.9 s at 12,000 buildings (known-issues #19). Not measured here in a real browser; P2/`pd-render` territory.
- **Not fixed (not cheap)**: per-district rotation (above); courtyards (27 buildings with inner rings are drawn solid); storeys (no data); no elevation (the scene is flat).
