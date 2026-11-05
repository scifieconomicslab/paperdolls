---
name: paperdolls-visuals
description: Make isometric visuals for policy audiences with paperdolls. Use when the user wants to draw an agent-based economic simulation (the Great Retrofit model or another model file) as a replay page, or build a scene of a real place from OpenStreetMap and open it in the viewer. Covers the intake, the checks, the frames, the replay page and the viewer.
---

# paperdolls visuals

A project is one of two kinds. A **model replay** records one run of a simulation and draws chosen weeks as isometric frames in a single HTML page. A **place scene** turns OpenStreetMap data into a scene and opens it in an offline viewer. The two are not linked yet: the model's buildings have ids but no coordinates, so a replay cannot sit on a real map.

The commands are in the plugin's `bin/` folder, which is on the Bash tool's PATH, so run them as `paperdolls ...`. If the command is not found, run `python3 "${CLAUDE_PLUGIN_ROOT}/bin/paperdolls" ...` instead.

## Rules

1. **The model is the source of truth.** Read states from the export. Never compute an economic quantity in the renderer.
2. **Say what is invented.** Layout, people, vehicles, trees, building styles and every palette are proposals until local authors check them. Every output carries that note.
3. **Appearance encodes only what the model tracks.** Retrofit state and investor ownership may drive appearance. Race, ethnicity, religion and any inferred identity may not. People are paper dolls with one neutral paper tone and no skin tones.
4. **Confirm before building.** The intake ends with a decision table. Show it, wait for a yes, and record the yes. The build commands refuse to run without it.
5. **Look facts up.** Registry shares, low-emission rules and transport facts come from a source with a date. Use the `fleet-researcher` agent for fleets. Never fill a gap from memory.
6. **Do not invent data.** If OpenStreetMap cannot be reached, say so and give the user the query to run by hand.

## Start: check the install

Run `paperdolls doctor`. It checks the Python version, the three packages (numpy, pillow, pyyaml), the palettes, the viewer templates and the vendored model. If packages are missing, show the user the install command it prints and ask before running it.

## The intake

The intake is a fixed interview that fills in `render.yaml`. The program decides the next question and checks every answer, so you only relay.

1. `paperdolls intake init render.yaml`
2. `paperdolls intake next render.yaml` prints the next question: the ID, what to ask, why, how to present it, the options and a suggested answer. Ask the user exactly that, one question at a time. Use buttons or a numbered list when it says so.
3. `paperdolls intake answer render.yaml ID "<the answer>"` records it. If it prints `REJECTED`, read the message to the user, in plain words, and ask again.
4. Repeat from step 2. When `next` says `confirm`, run `paperdolls intake show render.yaml`, show the table to the user, and ask whether it is right.
5. Record the reply with `paperdolls intake answer render.yaml confirmed yes`. Changing any answer afterward withdraws the yes, and you have to show the table again.

Do not guess an answer, and do not edit `render.yaml` by hand. Lines marked "note for you" are for you; do not read them aloud. The full list of questions is in `docs/intake-questions.md`.

If the user wants a simulation drawn on a real map, say that this is not built yet and ask which of the two projects they want first.

## Model replay

Run these in order. Stop on any `FAIL` or non-zero exit.

```
paperdolls export render.yaml --out trajectory.npz
paperdolls check render.yaml
paperdolls frames render.yaml trajectory.npz --out frames/
```

`check` prints PASS or WARN for each test. Report every line to the user, including WARN lines. The Great Retrofit model has known WARNs: its weekly counts do not always add up to the building count, and its "finished" aggregate counts unsold finished buildings, not completed retrofits. The render uses per-building state, so it is unaffected, but the model's authors should hear about both. See `docs/known-issues.md`.

Show the frames and ask for feedback. Change `render.yaml` through the intake, not the renderer. When the user approves the frames:

```
paperdolls build render.yaml trajectory.npz --out replay.html
```

Report the file size and say which parts are invented. Another model file must follow `docs/model-interface.md`. For a model that is not Great Retrofit, set `replay.legend` in `render.yaml` to name the four states in that model's words; without it the frames say "State 1" to "State 4". Never leave retrofit wording on another model's picture.

## Place scene

1. `paperdolls place render.yaml` finds the extract, ingests it and writes `scene.json` and `scene_report.md` in the output folder. With a relation id or a box it runs the Overpass query itself. If the network is blocked it stops, saves `query.ql`, and tells you what to do: ask the user to run the query at overpass-turbo.eu (Export, raw OSM data, JSON), save the file as `extract.json` in the output folder, and run `place` again.
2. Read `scene_report.md` and summarise it for the user: how many buildings, roads and trees were drawn; the frame rotation; the estimated share of buildings that fit an asset; where storeys came from; what was left out; every warning.
3. Show the assumptions and wait for a yes: storeys taken from a building type, archetypes assigned from tags, road widths from lane counts, trees scattered into parks. If most storeys are defaults, say the heights are mostly assumed.
4. If the estimated asset share is low (many street grids, curved streets), tell the user plainly. The rest are drawn as plain extrusions and counted.
5. `paperdolls viewer render.yaml` writes one HTML file. Open it with the user. Drag or A and D pan, the wheel or W and S zoom, and Fit shows the whole scene.

The ingest has had one live run: a bounding box in Jette, Brussels, which gave 2,162 buildings of which only 28% fit an asset. Relation queries and other cities have not been run live. Say so, and ask the user to read the report before trusting the scene.

OpenStreetMap data is ODbL. Carry "© OpenStreetMap contributors" with any picture, and check the share-alike terms before publishing a scene file, which is a derived database. This is not legal advice.

## Region, look and register

A region fixes the fleet, climate, building grammar, trees and drive side. Each region has three looks, named by materials and light. The register is `colorfigures` (the region's own colours, hand-inked) or `formal` (a grey technical drawing, with colour reserved for data). See the `palettes` skill. List them with `paperdolls looks` or `paperdolls looks --region nw`.

Drive side defaults to the region's guess. For Southeast Asia, East Asia and Sub-Saharan Africa the intake always asks, because countries differ. Never assume it.

## What is not built

- No live parameter changes. Each run is exported ahead of time.
- No link between model buildings and real footprints.
- People and vehicles are placed by rule and are decoration unless a class is given motion. Label decorative motion as decoration.
- No browser-side economics.

Known problems are in `docs/known-issues.md`.
