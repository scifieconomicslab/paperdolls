# Closing the engine gaps: design

Source: the repository audit of 2026-11-05 (findings 1 to 6, defects, and the "what would make it an engine" list). The user approved working through the suggested fixes in order, with a test after each. This is the design those fixes follow.

## Why

paperdolls is a capable renderer plus a replay pipeline built for one model. For a person or an agent to use it on other agent-based models, a model must be able to say which of its variables to show and how, the replay must play through time in the same engine as the place viewer, and nothing on the picture may describe a model that is not the one drawn.

## Decisions

1. **A model declares a mapping, not a state machine.** `replay.mapping` in `render.yaml` is a list of `{variable, channel, scale, ...}`. A variable is read from each building in the `on_week` hook by dotted path (`building.wealth`, or `owner.income` through `households[owner_id]`). The four retrofit states stay as the default mapping for the vendored model, so nothing existing changes.
2. **Channels:** `wall` (colour the wall by the scale) and `overlay` (a categorical value picks the discrete geometry: `scaffold`, `solar`, `band`, `marker`). Heights and agents are not channels yet.
3. **Scales:** `categorical` (value to colour and label) and `sequential` (domain and colour stops). The legend is generated from the scale, never written by hand.
4. **One engine.** The replay page is the existing viewer plus a time axis: a trajectory embedded in the page, a scrubber and play control, and a `Replay` object that sets building styles from the current week. The Python PIL renderer stays for `frames` (keyframe PNGs) and is documented as legacy; `build` moves to the JS replay.
5. **Placement is honest and minimal.** Model building k is assigned to the k-th scene building in a stable order, and the page says so ("placement invented"). A scene with fewer buildings than the model is an error; extra scene buildings are drawn neutral. Real geocoded placement stays out of scope.
6. **Claims are measured.** README performance numbers and the "never run on live OpenStreetMap" statements are re-checked and corrected from evidence.

## Out of scope

Agents (people, vehicles) driven by model agents, building height as a channel, geocoded placement, bundled fonts, and the Great Retrofit model's own accounting problems (known-issues 1 to 3).
