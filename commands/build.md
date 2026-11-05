---
description: Build the single-file replay page after the user has approved the preview.
---

Run this only after the user has approved the frames from the preview.

1. Run `paperdolls build render.yaml trajectory.npz --out replay.html`.
2. Report the file size and the check results from the preview.
3. To offer the live page too, run `paperdolls replay render.yaml trajectory.npz --out live.html` (add `--scene scene.json` for a place scene). It plays the run through time with a legend made from `replay.mapping`; say that placement is invented.
4. State which parts are invented (layout, people, vehicles, trees, building styles) and that the palettes are proposals.
