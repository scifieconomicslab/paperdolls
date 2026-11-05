---
description: Start a new paperdolls project. Runs the intake and writes render.yaml.
---

Follow the "The intake" section of the paperdolls-visuals skill.

1. Run `paperdolls doctor`. If anything fails, show the fix it prints and stop until it is resolved.
2. Run `paperdolls intake init render.yaml` in the project folder. If the file exists, continue with `intake next` instead of starting over.
3. Ask one question at a time with `paperdolls intake next render.yaml`, and record each answer with `paperdolls intake answer`.
4. When the intake asks for confirmation, show the decision table from `paperdolls intake show` and wait for a yes before recording it.
