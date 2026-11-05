# Intake questions

Generated from `assets/intake_questions.yaml` by `paperdolls intake docs`. Edit the YAML and regenerate, not this file.

The intake asks these questions in order. A question appears only when its `when` condition holds. Questions marked **always** are asked even when a default exists.

## What to make

### `goal`: Goal

Ask: "What do you want to make?"

Why: The answer decides which questions come next.

- type: choice; **always** asked
- options:
  - `model_replay`: A replay of one simulation run. Keyframes and a single replay page. Buildings sit on a generated grid, not on a real map.
  - `place_scene`: A scene of a real place. Built from OpenStreetMap and opened in the viewer. It does not show model output yet.
- note for the model: If the user wants a simulation drawn on a real map, say that this is not built yet (the model's buildings are not linked to real footprints) and ask which of the two they want first.

### `name`: Project name

Ask: "What should the project be called?"

Why: The name goes in page titles and file names.

- type: text; **always** asked; range: 3 to 80
- example answer: `Jette retrofit, base case`

### `audience`: Audience

Ask: "Who will look at the result?"

Why: It sets the suggested style: formal for planning documents, colorfigures for explainers.

- type: choice; **always** asked
- options:
  - `policymakers`: Policymakers. Print, briefings and planning documents.
  - `researchers`: Researchers. Colleagues who will read the method as well as the picture.
  - `public`: The general public. Explainers and talks.

## The model

### `model.source`: Model

Ask: "Which model should be replayed?"

Why: The replay is a picture of exported model state. It never recomputes the economics.

- type: choice; only when `goal` is model_replay; **always** asked
- options:
  - `vendored`: The Great Retrofit v2 model that ships with the plugin. Needs vendor/greatretrofit_v2/model.py. See the licence note in that folder.
  - `file`: Another model file. It must follow docs/model-interface.md.
- note for the model: Choose vendored only if `paperdolls doctor` reports the Great Retrofit model as present.

### `model.path`: Model file

Ask: "What is the path to the model file?"

Why: The plugin loads this file and calls run_simulation with a read-only hook.

- type: path; only when `goal` is model_replay, `model.source` is file; **always** asked
- example answer: `models/my_model.py`

### `model.params.n`: Buildings (n)

Ask: "How many buildings need retrofit (the model parameter n)?"

Why: It sets how many buildings are drawn. Runs with more than 2,000 take noticeably longer.

- type: int; only when `goal` is model_replay; **always** asked; range: 1 to 20000
- example answer: `120`

### `model.params.n_households`: Households

Ask: "How many households own those buildings (n_households)?"

Why: The Great Retrofit model gives each building to a household. It defaults to the number of buildings.

- type: int; only when `goal` is model_replay, `model.source` is vendored; default: the answer to `model.params.n`; range: 1 to 20000

### `model.params.run_time`: Weeks in the run

Ask: "How many weeks should the run last (run_time)?"

Why: One step of the model is one week. 520 weeks is ten years.

- type: int; only when `goal` is model_replay; **always** asked; range: 2 to 5200
- example answer: `260`
- note for the model: Rough cost: 500 households for 520 weeks takes about 3 seconds. 2,000 households for 1,040 weeks takes about 18 seconds.

### `model.params.seed`: Random seed

Ask: "Which random seed should the run use?"

Why: The same seed gives the same run, so the picture can be reproduced.

- type: int; only when `goal` is model_replay; default: `42`; range: 0 to 2147483647

### `model.params.overrides`: Other parameters

Ask: "Is there any other model parameter to change from its default? Give name=value pairs, or say none."

Why: Parameter names are checked against the model before they are saved.

- type: kv; only when `goal` is model_replay; default: `none`
- example answer: `enable_investors=false, build_cost=180000`

### `replay.weeks`: Keyframe weeks

Ask: "Which weeks should be shown as keyframes?"

Why: Each keyframe becomes a frame in the replay. Two to eight is the useful range.

- type: ints; only when `goal` is model_replay; **always** asked; range: 2 to 8
- example answer: `0, 26, 78, 259`
- note for the model: Offer the suggested weeks first. Weeks count from 0 to run_time minus 1.

## The place

### `place.kind`: How the place is found

Ask: "How should the place be found?"

Why: Each choice needs different details, and a named area clips most cleanly.

- type: choice; only when `goal` is place_scene; **always** asked
- options:
  - `osm_relation`: A named area, by OpenStreetMap relation id. Cleanest: the map is cut to the boundary.
  - `bbox`: A box on the map. South, west, north and east, in degrees.
  - `extract_file`: An OpenStreetMap file I already have. Overpass JSON, OSM XML or GeoJSON.
  - `scene_file`: A scene.json made by paperdolls earlier. Skips the ingest.
  - `placeholder`: No place yet. Uses the synthetic placeholder scene.

### `place.relation`: OSM relation id

Ask: "What is the OpenStreetMap relation id?"

Why: It names the boundary to cut the map to.

- type: int; only when `goal` is place_scene, `place.kind` is osm_relation; **always** asked; range: 1 to 99999999999
- example answer: `58258`
- note for the model: The id is the number in the address of the place's page on openstreetmap.org, for example .../relation/58258 for Jette. Offer to help find it if the user does not know.

### `place.bbox`: Box (S, W, N, E)

Ask: "What are the south, west, north and east edges of the box, in degrees?"

Why: The ingest keeps what lies inside the box.

- type: floats4; only when `goal` is place_scene, `place.kind` is bbox; **always** asked
- example answer: `50.870, 4.310, 50.900, 4.360`
- note for the model: Latitude runs from -90 to 90 and longitude from -180 to 180. Keep the box under about 5 km on a side, or the scene gets slow.

### `place.extract_path`: OSM file

Ask: "What is the path to the OpenStreetMap file?"

Why: The ingest reads it and writes the scene.

- type: path; only when `goal` is place_scene, `place.kind` is extract_file; **always** asked
- example answer: `data/jette.json`

### `place.scene_path`: Scene file

Ask: "What is the path to the scene file?"

Why: The viewer loads it directly.

- type: path; only when `goal` is place_scene, `place.kind` is scene_file; **always** asked
- example answer: `out/scene.json`

## The look

### `look.region`: Region

Ask: "Which region fits the place best?"

Why: A region sets the vehicles, trees, building styles and drive side. It is the only place choice; there is no separate palette choice.

- type: choice; **always** asked
- options: computed from regions
- note for the model: There are twelve options. Print them as a numbered list and ask for the number. Every regional detail is a proposal that local people should check.

### `look.look`: Look

Ask: "Which look should the buildings and streets have?"

Why: A look is a colour scheme within the region, named for its materials and light.

- type: choice; only when `goal` is place_scene; **always** asked
- options: computed from looks
- note for the model: The colours were chosen by eye, not sampled from photographs.

### `look.register`: Style

Ask: "Which drawing style?"

Why: Colorfigures keeps the region's colours with hand-inked lines. Formal is a grey technical drawing where colour is reserved for data.

- type: choice; **always** asked
- options: computed from registers
- note for the model: Offer the suggested style first. Formal uses Carbon grey tokens, and some of them are still to be checked against IBM's documentation.

### `look.drive`: Drive side

Ask: "Which side of the road does traffic drive on?"

Why: Countries in this region differ, so the plugin does not guess.

- type: choice; only when `goal` is place_scene; **always** asked when `look.region` is se or ea or sb; default: `auto`
- options:
  - `auto`: Use the region's default. Right-hand traffic for most regions.
  - `right`: Right
  - `left`: Left

## Output

### `output.dir`: Output folder

Ask: "Which folder should the results go in?"

Why: Every file the plugin writes goes there.

- type: text; default: `paperdolls-out`; range: 1 to 120
