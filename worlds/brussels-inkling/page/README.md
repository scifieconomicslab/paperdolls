# Conformance page

A worked example of the paperdolls page. The scene in `src/scene/` was written
from `skills/paperdolls-scene-craft/` and its recipes; the shell is adapted from
`skills/paperdolls-interface-ui/reference/`. It is **not** the product and not a
fixed engine: a real world writes its own scene from the recipes.

## Build

```bash
npm install
PAPERDOLLS_WORLD=$(cd .. && pwd) npm run build   # look comes from sim-code/model-binding.json ("house")
```

Output: `../visual/index.html` — one self-contained file. The build does not
empty `../visual/`, so beauty-review captures in `../visual/review/` survive.

The legacy `colorfigures` / `formal` / `voxel` looks were drawn by the deleted
box-drawing kit; `PAPERDOLLS_LOOK` is still accepted by the plugin but every
build now renders the house scene.

## How it is wired

- `src/world-plugin.ts` reads `../map-data/scene.composed.json` (the composition
  pass, `../map-data/compose.py`; falls back to `scene.json`),
  `../sim-code/model-binding.json`, `../conformance.md`, `../art-bible.md` and
  `reference/render/palettes.json`, bundles `model.ts` with esbuild, and exposes
  it as `virtual:page`. `PAPERDOLLS_WORLD` overrides the world folder.
- `src/scene/` is the scene, one file per concern in the scene-craft build order:
  `palette.ts` (the art bible in OKLCH), `util.ts` (seeded noise, unit
  geometries, instanced parts, the house material with lens/data hooks),
  `layout.ts` (roads, blocks, structure rectangles, facade faces),
  `pipeline.ts` (renderer, GTAO, ink, SMAA, lights, sky, fog, plinth),
  `buildings.ts`, `streets.ts`, `nature.ts`, `life.ts`, `data.ts`,
  `camera.ts`, and `index.ts` (assembly + snapshot URL contract +
  `window.__paperdollsReady`).
- `src/theme.ts` builds the Mantine theme from the palette's UI tokens.
- `src/App.tsx` is the shell: canvas, sidebar controls, bottom dock, analyst
  drawer. The simulation runs on the main thread here; the production path runs
  it in a worker (see `paperdolls-technology`).

## Controls

Drag to pan, wheel to zoom (anchored at the cursor); `A`/`D` and arrows pan,
`W`/`S` zoom, `F` fit, `Q`/`E` (or `R`) rotate, `L` data lens, `Space`
play/pause. Zoom, fit, rotate and lens buttons are in the canvas overlay; the
shortcut list is in the About drawer.

## Checks

```bash
node ../../../../tools/bench/check-single-file.mjs ../visual/index.html
node ../../../../tools/bench/fps.mjs ../visual/index.html --dpr 1
node ../../../../tools/bench/screenshots.mjs --world ..
```
