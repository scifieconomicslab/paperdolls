---
description: Start a new lab-render project. Runs the intake and writes render.yaml.
---

Follow the "The intake" section of the lab-render-visuals skill.

1. Run `lab-render doctor`. If anything fails, show the fix it prints and stop until it is resolved.
2. Run `lab-render intake init render.yaml` in the project folder. If the file exists, continue with `intake next` instead of starting over.
3. Ask one question at a time with `lab-render intake next render.yaml`, and record each answer with `lab-render intake answer`.
4. When the intake asks for confirmation, show the decision table from `lab-render intake show` and wait for a yes before recording it.
