---
description: Export a model run, check it and render keyframes for review. Uses the current render.yaml.
---

The project must be a model replay with a confirmed `render.yaml`.

1. Run `paperdolls export render.yaml --out trajectory.npz`.
2. Run `paperdolls check render.yaml` and report every line, including WARN lines. Stop on any FAIL.
3. Run `paperdolls frames render.yaml trajectory.npz --out frames/` and show the frame paths.
4. Ask for feedback. Do not build the full page until the user approves.
