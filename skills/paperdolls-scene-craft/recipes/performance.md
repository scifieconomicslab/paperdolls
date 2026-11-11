# Recipe — performance

Goal: all the detail in the other recipes at 60 fps. The budgets are in
`paperdolls-technology` §5 (p50 ≤ 16.7 ms at fit and street, p95 ≤ 33 ms;
10,000 agents). Detail is never cut silently. If the budget fails, report the
numbers and offer specific trims.

## 1. Budgets

| item | budget |
|---|---|
| draw calls | ≤ 250 at neighbourhood zoom (`renderer.info.render.calls`) |
| triangles | ≤ 1.5 M visible |
| shadow casters | structures, roofs, trees, landmark; **not** windows, markings, people or small furniture |
| post | GTAO at half resolution (`ao.setSize(w/2, h/2)` or its resolution option), ink at full, SMAA at full |
| per-frame CPU | instance matrix updates for moving things only; no geometry creation |

## 2. Techniques

- **Instance everything repeated:** one `InstancedMesh` per part type
  (window glass, surround, sill, door, awning, AC unit, tree kind, car
  class…). A city of 500 buildings has about 40 part types, which means about
  40 draw calls, not 40,000.
- **Tile for culling:** an `InstancedMesh`'s bounding sphere covers all its
  instances, so nothing culls. Split instances into 128 m spatial tiles,
  giving one `InstancedMesh` per part per tile, and call
  `mesh.computeBoundingSphere()` after filling. At street zoom most tiles cull.
- **Merge the static ground:** roads, sidewalks, kerbs, markings, plots and
  land use go into a few merged geometries per material
  (`BufferGeometryUtils.mergeGeometries`).
- **LOD by view width:** buildings.md §8, life.md (pedestrians < 260 m),
  streets-and-ground (furniture at street zoom). Toggle `visible` on group
  tiles.
- **Dynamic usage:** moving instances use
  `instanceMatrix.setUsage(THREE.DynamicDrawUsage)`, and you set
  `needsUpdate` only on meshes that changed this frame.
- **Data updates:** write the per-instance colour or attribute arrays in
  place on a new frame from the worker. Never reallocate.
- **Adaptive resolution:** if the p90 frame time exceeds 20 ms for 2 s, step
  the pixel ratio 2 → 1.5 → 1, then disable AO at overview. Show a quiet
  "reduced quality" note in the analyst layer and report it in the final
  report.
- **Idle:** when paused, reduced motion is on, and the camera is still,
  render on demand (on input or data change) instead of every frame.

## 3. Measure

```bash
node tools/bench/fps.mjs /abs/path/worlds/<name>/visual/index.html --dpr 1 2
```

Run it at the overview, neighbourhood and street shots, both idle and playing.
Report the numbers in the final report next to the beauty-review scores:
beauty and speed are judged together.
