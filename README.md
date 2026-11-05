# lab-render (v1)

Replay renders of agent-based economic simulations, drawn in a colorfigures-style isometric look for policy audiences.

**v1 is replay only.** A run is exported ahead of time and drawn as keyframes. There are no live parameter controls, no browser-side economics, and no geographic placement of buildings.

## What it does

1. Runs the vendored Great Retrofit model with a read-only hook and records each building's retrofit state and investor ownership, week by week.
2. Checks the export (determinism, hook invariance, one state per building, reconciliation, palette schema).
3. Draws keyframes of a generated block: buildings with rule-based facades in each retrofit state, a tram, a square, a boulevard, vehicles and paper-figure pedestrians.
4. Packs the keyframes into one offline HTML page.

## Install and run

```
pip install -e .            # or: pip install -r requirements.txt, then run from this folder
lab-render validate assets/demo_render.yaml
lab-render export assets/demo_render.yaml --out trajectory.npz
lab-render check assets/demo_render.yaml
lab-render frames assets/demo_render.yaml trajectory.npz --out frames/
lab-render build assets/demo_render.yaml trajectory.npz --out replay.html
```

Without installing, run `python -m lab_render ...` from this folder.

## OpenStreetMap ingest

Turns an OSM extract into the scene file the isometric viewer reads, and writes a report of every assumption.

```
lab-render osm-fetch --relation 58258 --out jette.json        # runs the Overpass query (needs network access)
lab-render osm-query --relation 58258 --out jette.ql          # or print the query and run it yourself at overpass-turbo.eu
lab-render ingest jette.json --boundary-relation 58258 --out jette_scene.json
```

- **Inputs**: Overpass JSON (from a query ending in `out geom;`), OSM XML, or GeoJSON (`osmium export`, Overpass Turbo). All three give the same scene.
- **Frame rotation**: the building assets need walls on the isometric axes, and real streets are at arbitrary angles. The ingest estimates the dominant street direction from the buildings and roads and rotates the whole frame, choosing the rotation with the highest estimated share of buildings that fit an asset. The report lists every candidate and the north bearing on screen.
- **What it reads**: buildings (levels, height, type, shop), roads (class, lanes, width, cycle lanes, tunnels), tram lines (matched to the road they run along, or kept as a separate track), landuse (parks, gardens, squares, water), trees (species, tree rows, scattering into parks and woods), multipolygon relations, and an administrative boundary to clip to.
- **Assumptions**: nothing is defaulted quietly. Storeys from a building type, an archetype from a tag, a width from a lane count, trees scattered into a park: each is counted and listed in `<scene>_report.md` for you to confirm.
- **Output**: `scene.json` (carries the OpenStreetMap attribution), `scene_report.md`, `scene_report.json`.

**What is not proven.** The environment this was built in cannot reach OpenStreetMap or Overpass, so it has **never run on real data**. It was tested on a synthetic extract with real structure, in all three formats, and the renderer was tested on its output. The Overpass query and the fetch client have **not been run against the live service** (the client was tested against a local stand-in). Run it on Jette and read the report before trusting any of it. See `viz/README.md` for the limits.

**What it does not do.** It does not connect the model's buildings to the scene's buildings. The model (v2) has building ids and no coordinates; assigning each to a real footprint is the spatial layer, and is still to be built.

## Layout of the plugin

- `.claude-plugin/plugin.json`: manifest.
- `skills/`: `lab-render-visuals` (workflow and rules) and `palettes`.
- `commands/`: `new-place`, `preview`, `build`.
- `agents/fleet-researcher.md`: researches a fleet for a place, with sources.
- `lab_render/`: the Python pipeline. `lab_render/ingest/` is the OpenStreetMap ingest.
- `vendor/greatretrofit_v2/`: the vendored model (see its NOTICE.md).
- `assets/`: `palettes.json` and the demo `sim.yaml`.
- `viz/`: the isometric library. `assetlib.js` (engine, themes, people, vehicles), `buildinglib.js` (buildings) and `treelib.js` (trees), all committed and tested; `vizlib.js` (scene, still a mock); catalogue and mock pages. See `viz/README.md`.
- `tests/`: pytest suite (pipeline, palettes, the ingest, and the JavaScript asset and viewer tests). `tests/osm_fixture.py` builds the synthetic OSM extract.

## What is proposed and what is not

- Palettes are proposals, not sampled from photographs: 36 looks, three per region. Replace them before policy use.
- Facade rules are placeholders, to be checked against real facade photographs.
- Layout, people and vehicles are invented, and every output says so.

## Audit (v0.1.0)

Found during the audit, with the status after fixes.

**Fixed**

- The model's import of plotting libraries, a global theme change, a sys.path line pointing to the author's machine, and an unseeded global rng were removed from the vendored copy. Results are unchanged.
- The hook test compared only five arrays. It now compares every array in the result.
- The one-state check failed whenever construction added buildings. It now requires at least n buildings, with unique ids.
- The completions check was built with `__import__` tricks. It now uses a normal import.
- Parameter mismatches produce a readable error.
- Model paths in the spec resolve against the spec file, and the vendored model is the default.
- Facade textures are cleared per palette, which bounds memory.
- Building heights depend on the render seed, so the seed now changes the layout.
- The spec rejects the final week index, which the model does not export.

**Open, found by the audit**

1. **Model licence.** The Great Retrofit code is MIT-licensed; the licence ships in `vendor/greatretrofit_v2/LICENSE`. Confirm the copyright holder name. (Low)
2. **Model's weekly counts do not reconcile.** `investor_purchases` counts transactions, so resold buildings count twice. The check reports a mismatch in most weeks, worst off by six. The render uses per-building state and is unaffected. (High, for any policy claim built on the model's own aggregates.)
3. **The model's "finished" aggregate means unsold finished buildings, not completed retrofits.** At week 259 the render shows 101 finished buildings, but the aggregate shows 0. The completion check passes because 101 does not exceed 105. Authors should confirm which meaning is intended. (High)
4. **Wealth collapses toward zero** (from the earlier analysis), because retrofit prices are paid from wealth and nothing replenishes it. Do not show wealth until this is settled. (High)
5. **The final week is missing from the export.** The model reports run_time+1 weekly points, but the hook fires run_time times. The last week's aggregates exist, but its per-building states do not. (Medium)
6. **No upstream check.** The plugin does not verify that the vendored file matches the upstream notebook, as planned. (Medium)
7. **Performance.** The model recomputes the wealth Gini over all households every week, and `check` runs the model several times. Large runs will be slow. (Medium)
8. **Memory and file size.** The exporter loads every week into memory, and the HTML embeds every frame. Eight frames give a 1.2 MB page, so a large spec can make a very large file. (Medium)
9. **Font fallback.** The renderer looks for DejaVu fonts and falls back to a tiny bitmap font on other systems. Bundle a font. (Low)
10. **Missing buildings render as to-do silently.** If an id is missing in a week, the renderer shows it as to-do without a warning. (Low)
11. **The render seed is the model seed.** `frames` and `build` use the model's seed for layout. They should be separate. (Low)
12. **Final-week aggregates and ids.** A rerun with construction enabled has not been tested. The construction path is only covered by the relaxed check. (Medium)
13. **Vehicle and people positions are fixed offsets.** They fall outside a very small grid. Add a minimum grid size check. (Low)
14. **No setup command.** Users must install requirements by hand. Add a `setup` step. (Low)
15. **The Python frame renderer is the older one.** `lab_render/render` (used by `frames` and `build`) does not use looks, trees or the formal theme; the JavaScript scene library does. The pipeline should move to it. (Medium)
16. **The ingest has never run on real OpenStreetMap data**, and its Overpass query and fetch client have not been run against the live service. (High)
17. **One frame rotation per scene.** A city with several street grids gets the rotation that suits the most buildings; the rest fall back to generic extrusions. The report gives the estimated share. (Medium)

## License

CC BY 4.0 (see `LICENSE`). The vendored model in `vendor/greatretrofit_v2/` is MIT-licensed (see its `LICENSE`).
