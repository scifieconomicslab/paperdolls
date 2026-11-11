# Recipe — life

Goal: the world is inhabited. Cars move along streets, people walk on
pavements, chimneys smoke, and cloud shadows drift. Motion is what makes a
viewer lean in, and it is what city builders get right.

Two kinds of life, never confused:

- **Model life:** mobile agents the model declares (`entities[*].kind ===
  'mobile'`). They are data. They are drawn at the same fidelity as the
  decoration, their positions come only from frames, and the legend explains
  them.
- **Decorative life:** traffic, pedestrians, boats, smoke, birds and clouds
  that the model does not track. These are seeded, labelled decorative in the
  About panel, frozen in snapshots, and off under `prefers-reduced-motion`.
  Decorative life never varies with model data unless the binding declares
  it. Busier streets because a model variable rose would be inventing a
  causal claim.

## 1. Road graph

Build a graph from `scene.roads`: nodes at shared endpoints (snap within
0.5 m), edges with polyline, length and class. Vehicles drive on edges and
choose a random next edge at nodes (no U-turns unless it is a dead end).
Drive on the region's side (the bible or the region table: left for uk, sa,
parts of ea and se), offset by half a lane.

## 2. Vehicles

| class | box parts | size (L × W × H) | where |
|---|---|---|---|
| car | body + cabin (inset 0.4, glass colour) + 4 dark wheel stubs | 4.3 × 1.8 × 1.45 | all roads |
| van | body + cab | 5.2 × 2.0 × 2.2 | streets+ |
| bus | long body, ribbon glass, accent stripe | 12 × 2.5 × 3.1 | avenues |
| truck | cab + box | 8 × 2.5 × 3.4 | industrial edges |
| bicycle | 2 thin rings + frame + paper-doll rider | 1.8 × 0.5 × 1.7 | cycleways |
| tram | 2–3 linked bodies | 30 × 2.6 × 3.4 | tram lines |

Genre fleets (carts, hover cars, rovers) come from the family pack and use
the same structure: body + cabin + running gear.

- **Colours:** about 65 % neutrals (white L 0.95, silver 0.78, grey 0.55,
  black 0.25) and 35 % muted colours (C ≤ 0.09) from the palette's hues.
  Buses and trams take the accent family. This mirrors real streets and
  keeps vehicles from competing with data.
- **Density:** from the bible (vehicles per 100 m of road). Defaults:
  residential 1.0, street 1.5, avenue 2–3. Cap at 600 moving vehicles.
- **Visibility floor:** whatever the density, the street shot must contain
  **≥ 2 moving vehicles and ≥ 6 pedestrians**. A "quiet" density of 0.5 per
  100 m left the exemplar's 62 m street frame without traffic. If needed,
  seed 2–3 vehicles on the edges nearest the street-shot target, or choose
  that target next to an avenue.
- **Parked cars:** 30–60 % of marked parking bays are filled. They do not
  move, which is cheap life.
- **Motion:** speed by class (residential 7 m/s, street 10, avenue 13), ease
  to 0 over 8 m before a node and wait 0–2 s (seeded), and keep 6 m from the
  car ahead on the same edge. Update instance matrices each frame. Yaw follows
  the polyline tangent, smoothed.

## 3. Pedestrians (paper dolls)

- Body: a capsule (r 0.22, length 0.8) in the **garment** colour, a paper
  head sphere (r 0.17), and two paper hand dots at street zoom. One paper tone
  for everyone; garments are 6–8 colours from the palette at C ≤ 0.10, plus
  the accent family on 15 %. No skin, hair, faces or identity signals.
- Walk on sidewalk centrelines and through parks and squares. Pick a random
  target door or node, walk 1.2–1.5 m/s, bob 0.04 m at 2 Hz, and fade in and
  out at doors.
- Density: 1 per 25–40 m of sidewalk, ×3 on squares and commercial streets.
  Cap at 2,000.
- Small groups: 20 % walk in pairs, and a few stand at shopfronts and bus
  stops.
- Visible only below 260 m view width.

## 4. Ambient motion

| element | build | where |
|---|---|---|
| chimney smoke | 4–6 billboard puffs (soft radial sprite, `NO_INK`) rising 0.6 m/s, growing and fading over 6 s | chimneys and industrial stacks, 30 % of them |
| birds | flocks of 5–9 tiny V shapes (2 tris), gliding on wide arcs, crossing every 20–40 s | above parks and water |
| cloud shadows | a large world-space noise (scale 300 m) scrolling at 3 m/s, multiplying lit surfaces by 0.85–1.0 via `onBeforeCompile` on ground and roof materials | whole scene, overview and neighbourhood only |
| boats | slow hulls (2 m/s) on water edges; moored boats bob 0.05 m | harbours, rivers |
| flags / awnings | small sinusoidal vertex sway | landmark, shops |

## 5. Model agents

- Interpolate agent positions between frames (`lerp` by sub-tick time) so
  movement is smooth at any playback speed. Snap when an agent teleports
  (distance > 3 × typical step).
- Draw agents with the same parts vocabulary: paper dolls for people-like
  agents, low-poly animals (body box + head box + 4 legs) for animal agents
  (wolf-sheep), and vehicles for vehicle agents. Breed is distinguished by
  **shape**, and by colour only if the binding declares it.
- When agents are many (> 2,000), switch at overview zoom to instanced
  billboards or a density heat layer. Report the switch.

## 6. Time

Decorative life runs on wall-clock time scaled by playback speed (paused →
traffic slows to a stop over 1 s, ambient continues gently). In snapshot mode
it runs on `clock=<seconds>` with a fixed seed so captures are deterministic.

## Common mistakes

- Nothing moves: the world feels like a screenshot even while the model
  runs.
- Everything moves too fast: city builders show traffic slower than real
  time. Halve real speeds if it looks frantic.
- Bright, saturated cars: they read as data markers.
