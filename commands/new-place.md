---
description: Start a new replay for a place or model. Runs the intake questions and writes sim.yaml.
---

Start the intake for a new replay using the lab-render-visuals skill.

1. Ask what model and place this is, one question at a time.
2. Ask the time step, the weeks to show, the palette families and the registers.
3. Write `sim.yaml` in the project folder, with the parameters from the model.
4. Validate it with `python -m lab_render validate sim.yaml` and show the result.
5. Show a short table of decisions and ask for a go-ahead before exporting.
