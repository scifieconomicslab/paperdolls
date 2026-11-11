---
name: paperdolls-technology
description: The pinned technology stack and build rules — three.js, Mantine, React, Vite single-file, esbuild model bundling; the offline file:// delivery, worker runtime, determinism, WebGL2 requirement, and the performance and checker gates.
---

# Technology

Load at preflight and Gate 7. This is the only place versions and build rules
live. Do not invent versions in a world's code.

## 1. Stack

| concern | choice |
|---|---|
| 3D rendering | **three.js** (core renderer + bundled examples modules only) |
| UI | **Mantine** `@mantine/core`, `@mantine/hooks`; icons `@tabler/icons-react` |
| app | **React** / `react-dom` |
| build | **Vite** + `vite-plugin-singlefile` |
| model bundle | **esbuild** (bundle the world's `model.ts` to one ESM string at build) |
| runtime | browser **WebGL2**; simulation in a worker (`tools/stage`) |
| Python helpers | `numpy`, `pillow`, `pytest`, `jsonschema` (ingest/construct/checkers) |
| parity | **NetLogo 7.0.4** external process (not embedded; tests only) |

Pin exact versions in `package.json` and record them here. No PixiJS. No CDNs.
No web fonts.

### Known pins

Carried from the migrated page; bump deliberately and record the change.

| package | version |
|---|---|
| `@mantine/core`, `@mantine/hooks` | 9.7.3 |
| `@tabler/icons-react` | 3.34.1 |
| `react`, `react-dom` | 19.2.9 |
| `vite` | 8.3.4 |
| `vite-plugin-singlefile` | 2.3.4 |
| `esbuild` | 0.27.0 |
| `typescript` | 6.0.3 |
| `playwright` (checks) | 1.56.1 |
| `three`, `@types/three` | 0.180.0 (the scene-craft recipes' snippets are written against r180; after a bump, re-check the addon constructors: `SMAAPass`, `GTAOPass.setGBuffer`) |

## 2. Delivery: one offline file

- `visual/index.html` is self-contained: scripts, styles, scene and model
  inlined. It opens from `file://` with **zero network requests**.
- `vite-plugin-singlefile` with a large `assetsInlineLimit`; no external
  assets, no `fetch`, no telemetry, no font files.
- Verify with `tools/bench/check-single-file.mjs`.

## 3. Runtime

- The simulation **always** runs in a worker; the main thread renders and
  owns the UI and never steps the model. The stage wires it:
  `page/src/sim.worker.ts` calls `serveModel(model)` and the page uses
  `SimClient` (`tools/stage/src/sim.ts`), imported with `?worker&inline` so
  the page stays one file. Frames arrive with their entity columns as
  transferable typed arrays; pass `columns` to `serveModel` to send only what
  the scene draws. The main thread keeps the latest frame and interpolates
  mobile agents between frames (scene-craft life §5).
- A parameter change is a new run from t=0 with the same seed.
- Deterministic: seeded streams (e.g. mulberry32); the seed is recorded and
  visible; same seed → byte-identical frames.
- An optional recorded trajectory may be played or downloaded; it is labelled
  as a recording, not the live product.

## 4. Browser and access

- WebGL2 is required. A missing-WebGL browser gets a plain message, not a fake
  fallback render.
- Keyboard and focus, contrast, reduced motion, and the ui-rules accessibility
  floor.

## 5. Performance budgets

- 10,000 agents at 60 fps on the reference machine.
- p50 ≤ 16.7 ms at fit and street zoom; p95 ≤ 33 ms at mid, idle and playing.
- Measure with a real GPU Chromium-family browser; SwiftShader is not a verdict.
- Over budget: report numbers, offer trimming, never silently degrade.

```bash
node tools/bench/fps.mjs /abs/path/to/worlds/<name>/visual/index.html --dpr 1 2
```

## 6. Build and check

```bash
# from the world's page project
PAPERDOLLS_WORLD=/abs/path/to/worlds/<name> npm run build
node tools/bench/check-single-file.mjs /abs/path/to/worlds/<name>/visual/index.html
```

Expected: PASS lines, "one self-contained file". If WebGL or a browser is
missing, say the gate is unverifiable and record the reason.

## 7. Rules

- Update a version in one place; never pin in a world.
- No dependency that fetches at view time.
- Keep the bundle as small as the job allows; lazy-init the scene if a look is
  heavy.
- The technology skill never chooses a look, a palette or a model value.
