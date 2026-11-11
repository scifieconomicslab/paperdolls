# The conformance world

One tiny, deliberately boring world used to prove the pipeline end to end and
all three looks. Nothing here is real: a constructed scene, a fixture model, and
honest toys.

A run should leave:

```text
worlds/conformance/
  conformance.md            # the world record (from reference/templates/world.md)
  map-data/spec.json        # the construction spec
  map-data/scene.json       # the scene contract
  map-data/scene_report.md  # counts and assumptions
  map-data/verify/          # top-down + two isometric snapshots, per look
  sim-code/model.ts         # the converted fixture model
  sim-code/model-binding.json
  sim-code/parity.md
  visual/index.html
```

## Acceptance

- `tools/check-world.py` passes.
- `schemas/model-binding.json` validates.
- `tools/bench/check-single-file.mjs` passes.
- `tools/bench/fps.mjs` passes on a GPU browser.
- `tools/bench/screenshots.mjs` writes `top-down.png`, `iso-0.png`, `iso-90.png`.
- `reference/ui-rules/paperdolls-gates/` G1–G10 pass, then the craft pass.
- All three looks render the same scene: `colorfigures`, `formal`, `voxel`.
- Ten-pass determinism is identical.
- **Adaptivity:** add one new structure kind and one new treatment by editing
  `reference/structure-grammar.md` and the world record only — no renderer
  change — and confirm all three looks draw it.
