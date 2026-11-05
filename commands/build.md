---
description: Build the single-file replay page after the user has approved the preview.
---

Only run this after the user has approved a preview.

1. Run `python -m lab_render build sim.yaml trajectory.npz --out replay.html`.
2. Report the file size and the check results.
3. State clearly which parts are invented (layout, people, vehicles) and which palettes are proposals.
