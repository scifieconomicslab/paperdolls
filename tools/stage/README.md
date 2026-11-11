# Stage

The plumbing every world page needs and no world should rewrite: about 600
lines of TypeScript for three.js r180.

| file | what it does | recipe |
|---|---|---|
| `src/pipeline.ts` | renderer, lights, sky, GTAO + ink + screen-space haze + SMAA + output, shadows fitted to the view, the boundary plinth | `render-pipeline.md`, `light-and-time.md` |
| `src/camera.ts` | dimetric ortho rig, the three shots, an overview that fits the boundary, pan/zoom/rotate/fit, easing | `camera.md` |
| `src/snapshot.ts` | the snapshot URL contract, `__paperdollsReady`, the default tick | scene-craft SKILL §6 |
| `src/sim.ts` | the model in a Web Worker: `serveModel` (worker) and `SimClient` (page) | technology §3 |

**It owns no look.** Every colour and strength comes in through `StageLook`
and `PlinthLook`, filled from the art bible. Buildings, streets, nature, life,
data and palette are the world's own code, built from the scene-craft
recipes. If you find yourself wanting to add geometry or a material here, it
belongs in the world.

## Use

```bash
node tools/stage/vendor.mjs worlds/<name>           # copies src/ to page/src/stage/ + STAGE.json
node tools/stage/vendor.mjs worlds/<name> --check   # the copy is unedited (Gate 7)
```

```ts
import { createStage, createCameraRig, buildPlinth, readSnapshot, applyShot, markReady } from './stage/index.ts';

const snap = readSnapshot();
const stage = createStage(canvas, look);                       // look: from palette.ts / the art bible
const rig = createCameraRig(stage.camera, { boundary: scene.area.boundary, subject, streetSubject, snapshot: snap.snapshot, reduced });
rig.onChange = () => stage.setView(rig.state.target, rig.state.width);
stage.scene.add(buildPlinth(scene.area.boundary, plinthLook));
// ... the world adds its own ground, buildings, streets, nature, life ...
applyShot(rig, snap);                                          // or rig.shot('neighbourhood') for the live opening
rig.attach(canvas);
```

The worker file imports `./stage/sim.ts` directly (not `index.ts`), so three.js
stays out of the worker bundle.

Change the stage here, bump `VERSION`, and re-vendor the worlds that want the
change. Never edit a world's copy; `--check` fails on an edited copy.
