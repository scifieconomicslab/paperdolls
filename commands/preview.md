---
description: Export a run and render keyframes for review. Uses the current sim.yaml.
---

1. Run `python -m lab_render export sim.yaml --out trajectory.npz`.
2. Run `python -m lab_render check sim.yaml` and report every line, including WARN lines.
3. Run `python -m lab_render frames sim.yaml trajectory.npz --out frames/` and show the frame paths.
4. Ask for feedback. Do not build the full page until the user approves.
