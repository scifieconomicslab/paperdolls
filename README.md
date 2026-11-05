# lab-render

A Claude plugin from the Sci-Fi Economics Lab. It draws agent-based economic simulations and real places as isometric pictures, in a hand-inked style (colorfigures) or a grey technical style (formal), for policy audiences.

It makes two kinds of project:

- **Model replay.** Runs the Great Retrofit v2 model (or another model file that follows [the interface](docs/model-interface.md)), records each building's retrofit state and investor ownership week by week, and draws chosen weeks as frames in one offline HTML page.
- **Place scene.** Turns an OpenStreetMap extract into a scene and opens it in an offline viewer, with a report of every assumption made.

The two are not linked. The model has building ids and no coordinates, so a replay cannot yet sit on a real map.

## Install

In Claude Code:

```
/plugin marketplace add scifieconomicslab/lab-render
/plugin install lab-render@scifi-economics-lab
```

The plugin needs Python 3.10 or newer with numpy, pillow and pyyaml. Run `/lab-render:doctor` to check. If packages are missing it prints the `pip install` command and asks before running it.

Node.js is optional. Only the JavaScript tests use it.

## Use

Ask Claude to make a replay or a scene, or run a command:

| Command | What it does |
|---|---|
| `/lab-render:start` | Runs the intake and writes `render.yaml`. |
| `/lab-render:preview` | Exports a model run, runs the checks, renders keyframes. |
| `/lab-render:build` | Builds the replay page after you approve the frames. |
| `/lab-render:place` | Builds a place scene from OpenStreetMap and reads the report with you. |
| `/lab-render:doctor` | Checks that everything needed is installed. |

The intake is a fixed interview. It asks one question at a time and builds up to a decision table that we can agree to or modify before committing. The questions are listed in [docs/intake-questions.md](docs/intake-questions.md).

## Command line

Everything runs without Claude. The plugin puts `bin/lab-render` on the PATH. From a checkout, run `bin/lab-render`, or `pip install -e .` for a `lab-render` command.

```
lab-render doctor
lab-render looks --region nw
lab-render intake init render.yaml
lab-render intake next render.yaml
lab-render intake answer render.yaml ID "value"
lab-render intake show render.yaml

# model replay
lab-render export render.yaml --out trajectory.npz
lab-render check render.yaml
lab-render frames render.yaml trajectory.npz --out frames/
lab-render build render.yaml trajectory.npz --out replay.html

# place scene
lab-render place render.yaml
lab-render viewer render.yaml
```

The lower-level OpenStreetMap commands are `osm-query`, `osm-fetch` and `ingest`. `assets/demo_render.yaml` holds the Great Retrofit demo configuration (120 households, seed 42).

## What the ingest reads

Buildings (levels, height, type, shop), roads (class, lanes, width, cycle lanes, tunnels), tram lines (matched to the road they run along, or kept as a track), landuse (parks, gardens, squares, water), trees (species, tree rows, scattering into parks and woods), multipolygon relations, and an administrative boundary to clip to. It accepts Overpass JSON, OSM XML and GeoJSON.

The building assets need walls on the isometric axes, and real streets sit at arbitrary angles. The ingest estimates the dominant street direction and rotates the whole frame, choosing the rotation with the highest estimated share of buildings that fit an asset. The report lists every candidate.

Nothing is defaulted quietly. Storeys taken from a building type, an archetype taken from a tag, a width taken from a lane count, trees scattered into a park: each is counted in `scene_report.md` for you to confirm.

## Known issues:

- The 36 palettes (three looks in each of twelve regions) are proposals chosen by eye.
- Facade rules, fleets, tree mixes and drive sides are proposals too.
- Layout, people and vehicles are invented.
- The OpenStreetMap ingest has run only on a synthetic extract. The Overpass query and fetch client have not been run against the live service.

The full list of open problems, including the Great Retrofit model's, is in [docs/known-issues.md](docs/known-issues.md).

## Layout

- `.claude-plugin/`: `plugin.json` and `marketplace.json`.
- `skills/`: `lab-render-visuals` (the workflow and its rules) and `palettes`.
- `commands/`: `start`, `preview`, `build`, `place`, `doctor`.
- `agents/fleet-researcher.md`: researches a place's vehicle fleet, with sources and dates.
- `bin/lab-render`: the launcher.
- `lab_render/`: the Python pipeline. `lab_render/ingest/` is the OpenStreetMap ingest.
- `viz/`: the isometric library and viewer. See [viz/README.md](viz/README.md).
- `vendor/greatretrofit_v2/`: the vendored model and its licence.
- `assets/`: palettes, the intake question bank, the demo configuration and the icon.
- `samples/`: a demo replay and a synthetic OpenStreetMap extract.
- `tests/`: the pytest suite, which also runs the JavaScript tests.

## Develop

```
pip install -r requirements-dev.txt
npm install        # optional: canvas and jsdom for the JavaScript tests
python -m pytest tests -q
```

Without `npm install` the canvas and viewer tests skip. If `bin/lab-render` gives "Permission denied", run `chmod +x bin/lab-render`.

## Licence

CC BY 4.0 (see [LICENSE](LICENSE)). The vendored Great Retrofit model in `vendor/greatretrofit_v2/` is MIT-licensed, with its own `LICENSE`. OpenStreetMap data is ODbL: carry "© OpenStreetMap contributors" with any picture or scene file.
