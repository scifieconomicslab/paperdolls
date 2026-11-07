# Part 30: rendering engine (draw path, layer caches, sprite cache, zoom machines, picking, page state)

Base: `main` at aa2d936. Scope: `viz/vizlib.js` (renderer loop, ground and far layers, far-layer patching, entity drawing, agents, sim, `validateScene`, `setTheme`), `viz/assetlib.js` (sprite cache, themes, asset cache), `viz/buildinglib.js` (`fitFootprint`, asset parameters), `viz/camera.js`, `viz/controls.js`, `viz/zoomhold.js`, `viz/refocus.js`, `viz/packpick.js` and the highlight code of `viz/packhost.js` (`drawChannels`, `bindInteraction`), `viz/replay.js`, `viz/viewer.html` and `viz/packhost.html` (page state), `docs/known-issues.md`. No engine code was changed. Evidence is in `docs/state-machines/repro/` (`_render.js` plus `r30` to `r38`).

How the repros work: the **real** `viz/*.js` files are loaded into a `vm` context on node-canvas (`_render.js`). The only fakes are the clock and the event source. `performance.now()` inside the engine is a counter that moves 0.25 ms per read (`R.clock.set(step)`), so every time budget (`layerMs`, `buildMs`, `prewarmMs`, the 20 ms coarse budget) is a fixed number of clock reads and a run is identical on every machine. There is no rAF and no sleep: one call of `renderFrame` is one frame; zoom, pan, resize and state changes are applied between calls. Canvas calls are counted by wrapping `getContext` (`R.census`). Wall-clock milliseconds appear only where the ratio is the point (R36, R37) and are marked. Run from the repo root:

```bash
PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules node docs/state-machines/repro/r31-outline-halo-ignore-z.js     # or any r30..r38
PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules sh docs/state-machines/repro/run-all.sh                         # all repros of parts 10 and 30
```

Observed output of the last run is committed next to each script (`rNN-….out.txt`). `run-all.sh` runs r30 to r38 too (about 3 minutes in total; its per-script timeout is now 180 s because r36 takes about 80 s).

## Summary: confirmed bugs, most harmful first (grouped by cause = one issue each)

Impact is for the Great Retrofit demo (a policymaker pans and zooms a Jette-scale map while a model plays); likelihood is for someone doing that.

| # | Bug | Repro | Impact | Likelihood | Group |
|---|-----|-------|--------|------------|-------|
| 1 | **Outline, halo, selection halo, the visibility test, ground tint and ground marks are placed at ground height 0** (known: paperdolls#14, reproduced here). On a hill the highlight floats `z x scale` px below its building (90 px at 36 m and 2.5 px/m); `vis()` culls a building that is on screen and draws one that is 115 px off screen | R31 | High: a wrong picture on every hilly scene, in the feature the pack exists to show | Certain on Jette | A |
| 2 | **Ground marks (the far-zoom form of outline and halo) are redrawn from scratch every frame**: a clip and a hatch of strokes per cell, uncached. With them on, an idle settled far frame costs 6.6x (200 m cells) to 8.0x (100 m cells) of a plain one. This is the "enriched far zoom is about 10x slower than plain" half of paperdolls#3 | R36 | High: the demo's first screen | Certain for any pack with an outline or halo mapping at default `lod` | B |
| 3 | **The idle far view is two canvas-to-canvas blits of 3.24x-view layers plus a full redraw on every animation frame, and there is no readback in that path at all.** The "per-frame `getImageData`/readback" explanation of paperdolls#3 is not what the code does: 0 `getImageData`, 0 `putImageData` per frame (default options), 2 `drawImage(canvas)` of 2.7 Mpx (DPR 1) or 10.9 Mpx (DPR 2) on 1200x700, about 9,900 sprite canvases created during the first paint. See §6 for what this leaves as the cause (not reproducible without a GPU) | R30 | High (demo risk) | Certain on a GPU browser | B |
| 4 | **The per-frame sprite build budget is bypassed whenever colours change on a settled view**: 362 sprites built in one frame (budget 60 and 8 ms), 370 ms in node, because the over-budget fallback only reuses a sprite already held for the same colours. One model month that recolours 400 visible buildings is a 0.3 s frame at neighbourhood zoom, then 32 builds a frame for ten frames | R37 | High: judder at every month of a playback below street zoom | High for any pack that recolours on time | C |
| 5 | **Sprite cache cliff**: past 90 Mpx `evict()` drops everything farther than 2.7x and, if still over 72 Mpx, clears the whole cache including the sprites the frame is using. At DPR 2, 10 px/m, 1920x1080 the placeholder city alone settles at 79.5 Mpx, so a slow pan hits it (at frame 175 here: 471 sprites dropped) | R34 | Medium: a rebuild hitch, no wrong pixels | Medium at DPR 2 and street zoom | C |
| 6 | **`A.sprites.dpr` is read once at page load.** `resize()` sizes the canvases at the new DPR but layers and sprites stay at the old one (browser zoom, moving to another monitor): the picture is the low-resolution layer scaled up (541k of 8.6M bytes differ in R35c) and, the other way, 4x oversized layers | R35c | Medium: blur or wasted memory until reload | Medium (ctrl+wheel in a browser, a second screen) | D |
| 7 | **The far layer is not keyed on the sprite `exact` flag**: a layer painted in the first two frames of a view (every new sim after `rebuild()`, region switch, first load) keeps octave-bucket sprites for good. At DPR 2 and 0.8 px/m 682k of 8.6M bytes (8%, up to 193 levels) differ from the exactly painted one | R32 | Low: softness, history-dependent | Certain for a new sim, visible only at DPR 2 between about 0.5 and 1 px/m | D |
| 8 | **A replay with a mapping installs a non-versioned `buildingStyle`, which switches the far layer off**: every building is drawn through the style callback every frame (1023 calls a frame in R35b; 9,214 on Jette). The pack page is not affected (its style is versioned) | R35b | Medium (old replay page only) | Certain there | B |
| 9 | **Degenerate footprints (collinear or repeated points) pass `validateScene` and get `fit = {cx: 0, cy: 0}`**: painter's order, pick order and the terrain height all use the origin (R35a: sort key 4 instead of about 626; `e.z` 4 m where the terrain is 16.2 m) | R35a | Low to medium: a wrongly ordered or wrongly lifted building | Low (needs such a footprint in the OSM data; the ingest keeps only area >= 8 m2 but the viewer accepts any scene file) | E |
| 10 | **`levels` has no upper bound in `validateScene`**; an extruded (non-asset) building with 200,000 levels costs 1.0 s per frame (66 ms at 4 levels), every frame | R35f | Low to medium | Low | E |
| 11 | Small: `createSim` shares the scene's building objects, so a replay's `paintStates` leaves states in the scene the next sim starts from (R35d); `AssetLib.theme` caches by `family.id \|\| 'x'` so id-less families collide (R35e); `camera.maxScale` only ever rises (R33); `camera.zoomAt(NaN)` makes the scale NaN for good and nothing guards it (R35g) | R35d, R35e, R33, R35g | Low | Low | F |

REFUTED (the code holds, evidence in the sections): a stale far layer after a patch, theme or register change, resize, zoom, pan past the margin, tree toggle, segments, overlays or elevation, including events in the middle of a patch pass (R38, 9 scenarios, all equal to a from-scratch painting); a held CSS transform that never clears, a lost end of zoom, re-entrancy of wheel/drag/keys during hold, refine or fade (R33, 300 random runs, 32,831 frames, 0 violations); eviction of a sprite while it is in use or being built (§3); `frameVersion` wrap (§2); hover or selection on a building a patch or `rebuild()` removes (§7); picking in the wrong painter's order with elevation (§7).

SUSPECTED (no repro, see sections): hover tooltip and dashed highlight stay on a building after a key pan (§7); a GPU-only cost of the 3.24x layers and 9,900 sprite canvases (§6); the sprite silhouette of a fitted building differs from the footprint the pick uses (§7).

---

## 1 · Machines at a glance

| id | machine | kind | owner | encoding variables |
|---|---|---|---|---|
| L | World layer slot (`_ground`, `_far`): absent, rough, exact, stand-in, repainting | implicit | `vizlib.js:1032-1100` (`worldLayer`) | `sim[slot]`, `sim[slot+'P']`, `sim[slot+'C']`, `sim[slot+'Spare']`, `L.skey`, `L.sc`, `L.rough`, `L.ver` |
| F | Far-layer patch: index, diff, paint, fallback | implicit | `vizlib.js:1221-1301` (`farGrid`, `farPatch`) | `sim._farPatch {ver, phase, pos}`, `info.grid`, `grid.queue/dirty/qpos`, `info.sigs`, `L.ver` |
| Q | Zoom exactness and pre-render ("still" counters) | implicit, partly global | `vizlib.js:869-884`, `assetlib.js:316` | `sim._zoom {scale, still, moved, stillView}`, `sim._warm`, `A.sprites.exact / zooming / collect / builds` |
| S | Sprite cache: key, build, schedule, evict, prewarm | implicit, global | `assetlib.js:314-415` | `sprites.cache`, `.index`, `.pixels`, `.limit`, `.maxPixels`, `.builds`, `.maxBuilds`, `.maxZoomBuilds`, `.maxBuildMs`, `.frameStart` |
| E | Per-entity draw cache (building, tree, agent) | implicit | `vizlib.js:1353-1441` | `e._ck/_cols/_asset/_fast/_th/_st/_inv/_fv/_seg/_sm/_fdata/_froof`, `a._ck/_cols/_rc/_rcReg` |
| T | Theme, register, region switches | implicit | `vizlib.js:484-496` (`setTheme`), `viewer.html:279-286` | `sim.theme/palette/opts.theme/opts.register`, entity caches, `A.sprites.*`, layer keys |
| H | ZoomHold (stretch the drawn canvas while the scale moves) | explicit (`drawn`, `stretched`) | `zoomhold.js:15-52` | `drawn`, `prevScale`, `lastChange`, `stretch`, `stretched` |
| X | Refocus (live, zoom, refine, fade) | explicit `state` | `refocus.js:14-75` | `state`, `since`, `fadeEnd`, `lockUntil`, `front/back` roles, CSS opacity/transform |
| C | Camera | implicit | `camera.js:15-74` | `cx, cy, scale, w, h, fit, minScale, maxScale` |
| K | Controls: drag, pinch, wheel, keys, eased zoom | implicit | `controls.js:36-132` | `pointers`, `pinch`, `held`, `pend`, `pendX/Y`, `rafId`, `last` |
| P | Pages: viewer and pack page (`rebuild`, scene load, resize, frame loop, replay) | implicit | `viewer.html:105-300`, `packhost.html:176-279` | `sim`, `scene`, `state`, `replay`, `A.sprites.dpr`, canvas sizes, `rf` |
| I | Picking, hover, selection, highlight, outline/halo/marks channels | implicit | `packpick.js:37-76`, `packhost.js:250-332,596-664` | `hover`, `down`, `store.selection()`, `HL {ver, halo, outline, marks}`, `sim.frameVersion` |
| N | Agents: spawn, step, pose, motion | implicit | `vizlib.js:410-452,538-597` | `a.edge/s/dir/side/speed`, `a.motion`, `a.pose`, `sim.time` |
| V | Scene validation and footprint fit | implicit | `vizlib.js:287-331`, `buildinglib.js:360-386` | `check.ok`, `fit {ok, reason, cx, cy, ...}` |
| Z | Terrain and ground height (`z`) paths | implicit | many; table in §8 | `e.z`, `sim.relief`, `sim.terrain`, `sim.zmax` |

One frame, in order (`renderFrame`, `vizlib.js:832-854` -> `renderFrameInner`, `:869-998`): set per-frame sprite flags and budgets; update the exactness counters (Q); decide the ground layer key and call `worldLayer` for `_ground`; draw ground tint and marks; if the far view applies, `farPatch` then `worldLayer` for `_far`, then agents on top, and return; else collect, sort and draw every visible building, tree and agent; then fog, then pre-render neighbouring sprite scales if nothing was built.

---

## 2 · Machine L: world layer slot (`worldLayer`) and the far layer (`_far`)

**States** (per slot; the comment block at `vizlib.js:1102-1124` draws the same machine):
- `ABSENT`: `sim[slot]` undefined.
- `ROUGH`: `L.rough === true`, painted flat by `farCoarse` / `groundCoarse` in one pass, completed by a stepped generator `sim[slot+'C']` (20 ms a frame, `COARSE_MS`).
- `REPAINTING`: `sim[slot+'P']` holds a half-painted second canvas (`p.gen`), the old layer (if any) keeps the screen through `blitScaled`.
- `EXACT`: `L.skey === skey && L.sc === sc` and the view inside the margin (`LAYER_MARGIN` 0.4 of the view each side).
- `STALE (zoom)`: `L.sc !== sc` while the zoom is moving: the old layer blitted scaled (`:1035-1038`), within `LAYER_STAND_IN = [0.15, 8]`.
- `PATCHING` (far only): the machine F below runs on an `EXACT` layer.

**Encoding.** `skey = gkey + '|' + layers.trees` (+ `'|' + h` when `farPatch` is off); `gkey = view.w|view.h|famId|lookId|reg|surface|layers.buildings|detail|ink|posterize` (`:911`). `L.sc = scale.toFixed(4)`. `L.ver` is the signature the layer was last made current for (`null` after a full repaint).

**Invariants**
- L-I1 a layer on screen shows the current theme, size and scale or is a scaled stand-in for it. Maintained by the key (`:911,971`) and `outOfDate` (`:1060`). Holds (R38 A, B, C, D, F, G).
- L-I2 at most one repaint per slot is alive (`sim[slot+'P']`); a new key or scale abandons it and recycles its canvas (`:1065-1068`). Holds.
- L-I3 the pixels of an `EXACT` layer depend only on its key and data. **Violated for `exact`**: the key leaves out `A.sprites.exact` (comment `:974`), R32.
- L-I4 the pixel density of a layer is the density of the canvas it is blitted to. **Violated** when `A.sprites.dpr` goes stale (R35c): `q` is read per frame (`:1033`) but the key has no `q`, and the page never refreshes it.

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| any | zoom moving (`zs.still < 2`) | `L.skey === skey`, `L.sc !== sc`, ratio inside stand-in | STALE | blit the old layer scaled, return | `:1035-1038` |
| ABSENT | first far frame | `coarse` painter, `steps`, `softStart`, slicing on | ROUGH | flat layer painted now; `sim[slot+'C']` stepped | `:1042-1049` |
| ROUGH | each frame | coarse generator alive | ROUGH | step 20 ms | `:1051-1055` |
| ROUGH or key changed | zoom stopped or key differs, ratio inside stand-in | no coarse generator running | REPAINTING | new canvas (spare reused), `layerMs` of slices a frame | `:1060-1072` |
| REPAINTING | generator finishes | | EXACT | swap in, old canvas becomes the spare, `L.ver = null`, `layerRepaints++` | `:1073-1077` |
| REPAINTING | key or scale changes | | REPAINTING (restart) | old partial canvas becomes the spare | `:1065-1068` |
| EXACT | view moved past the margin, or settled with a fraction of a pixel | | EXACT (new) | one synchronous repaint (`paint`), spare reused | `:1085-1097` |
| EXACT | `farPatch` fallback | more than 20% changed | outdated (`L.skey = null`) | next frame REPAINTING | `:1264-1265` |
| ROUGH | key or size changes | | REPAINTING | | `:1060` |

**Reachable invalid states**
- **L-1 · settled far layer depends on paint time. CONFIRMED** (R32). Impact low, likelihood certain for a fresh sim. Cause: `A.sprites.exact` is `still >= 2` (`:875`) and the first exact painting starts in the same frame as the rough one, so its early slices draw octave-bucket sprites (`sb = 2^ceil(log2(scale*q))`) scaled to `scale`; the layer is never repainted when the view settles ("flipped when the view settled and repainted the whole layer a second time for nothing", `:974`). The existing tests hide it by forcing `s._zoom = { scale, still: 10 }` (`viz/test_farlayer.js:23`).
```
$ node docs/state-machines/repro/r32-far-layer-pixels-depend-on-paint-time.js
DPR 1, 0.47 px/m: cold start vs exact-from-frame-0 -> 0 of 2160000 bytes differ, largest channel difference 0  (frames to whole: 23 / 46)
DPR 2, 0.47 px/m: cold start vs exact-from-frame-0 -> 0 of 8640000 bytes differ, largest channel difference 0  (frames to whole: 23 / 46)
DPR 2, 0.8 px/m: cold start vs exact-from-frame-0 -> 682263 of 8640000 bytes differ, largest channel difference 193  (frames to whole: 23 / 46)
```
  (At scale x DPR <= 1 octave and exact sprites are both `sb = 1`, which is why only DPR 2 between 0.5 and 1 px/m shows it.)
- **L-2 · far layer off for a non-versioned style. CONFIRMED** (R35b). `far` needs `!sim.buildingStyle || versioned` (`:962`); `Replay.create` with a mapping installs `style` without a `frameVersion` (`replay.js:88`), so every building is drawn every frame. Impact medium on the old replay page, likelihood certain there; the pack page is versioned (`packhost.js:239,241`).
```
b  replay with a mapping, 1023 buildings, far view (0.35 px/m), 5 settled frames: style calls 5115 (1023 per frame), layerRepaints=1, far layer present=false (typeof frameVersion=undefined)
```
  (`layerRepaints=1` is the ground layer.) The same holds for the viewer's "numeric output" and "plain walls" modes and for any `bindData` on buildings (`:962`, `!sim.bindings.length`).
- **L-3 · the rough ground ignores terrain.** `groundCoarse` projects at z = 0 (`vizlib.js:1175`) while `farCoarse` lifts buildings by `e.z` (`:1152`): for the few frames the rough layers stand, buildings float above a flat ground on hills. Cosmetic, SUSPECTED by reading (no pixel test).
- **L-4 · the spare canvas can be overwritten while it is still `sim[slot]`.** In the synchronous branch the old layer's canvas becomes the spare and is immediately handed back by `layerCanvas` and cleared (`:1089-1093`). If `paint` throws, `sim[slot]` still points at that half-painted canvas with the old key. SUSPECTED: the repro needs a throwing painter, which no input reaches; a subsequent frame with the same key would blit the garbage.
- REFUTED: **stale far layer after a patch, theme or register change, resize, zoom, pan past the margin, trees toggled, segments (k of n), overlays, elevation, or any of these in the middle of a patch pass.** R38 runs 9 scenarios through the real frame loop and compares the final pixels with a sim built in the final state and painted once: all equal.
```
$ node docs/state-machines/repro/r38-far-layer-consistency-matrix.js
A theme change in the middle of a patch pass   same   ...   (B to I: same)
all scenarios equal the from-scratch picture
```

### Machine F: far-layer patch (`farPatch`)

**States** (`sim._farPatch`): `null` (layer current); `{phase:'index'}` (lookup grid being built, 512 items a step); `{phase:'diff', pos}`; `{phase:'paint'}`. `grid.queue` is the work in depth order, `grid.dirty[n]` marks queued items, `info.sigs[i]` the signature each building was painted with. Signature: the style object for a versioned style, else `charCode(state)*2 + investor` (`:966-973`).

**Invariants**: F-I1 `info.sigs[i]` is the signature that building's pixels were drawn from (maintained at draw time, `:978`, and at diff, `:1258`); F-I2 a pass is only run on the layer it was started for (guards `:1244`); F-I3 `L.ver === h` implies no pending change (`:1246,1296-1299`).

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| null | new signature `h` | layer exact, same key and scale, no repaint running | index or diff | `farGrid` a few ms a frame | `:1244-1249` |
| index | grid whole | | diff | grid built once per layer | `:1221-1238` |
| diff | all items compared | queued <= 20% of buildings | paint | | `:1252-1267` |
| diff | all items compared | queued > 20% | null, `L.skey = null` | `farPatchFallbacks++` | `:1264-1265` |
| paint | queue empty | `st.ver === h` | null | `L.ver = st.ver`, `farPatches++` | `:1296-1298` |
| paint | queue empty | `h` moved on | diff (from item 0) | coalesced | `:1299` |
| any | layer key, scale or repaint changes | | stays set | `sim._farPatch` is not cleared (the guard returns early); the next pass on the new layer reuses the old object | `:1244` |

**Reachable invalid state F-1 · a stale pass object survives a layer change. SUSPECTED, and harmless by the argument below.** `sim._farPatch` keeps `{phase:'diff', pos:N}` from the old layer; the next pass on the new layer starts its diff at `pos` N, so items 0..N of the fresh layer are not compared in that first pass. They were drawn from current data a moment earlier, and any later change moves `h`, so `st.ver !== h` at the end of the pass restarts the diff from item 0 (`:1299`): the exposure closes itself. R38 A, B, C, D and F cut a pass in half and end on the right pixels. What blocked a failing repro: the window is a few frames wide and the change has to land in items 0..N.

---

## 3 · Machine S: sprite cache (`AssetLib.sprites`)

**Key.** `key = asset.id | heading | reg.id | sb | colourKey [| d/D] [| i] [| p<posterize>]`; `ikey` omits scale, detail and ink (`assetlib.js:337-344`). `asset.id` includes the asset parameters, overlays and segments (`getAsset`, `:730-750`; `buildinglib.js:422`). Inputs that are **not** in the key: the CSS scale that sets the ink width (`lwMul`, `:348`; octave sprites reused for several scales keep the ink width of the scale they were built at: a design choice), and `sprites.dpr` (`q` scales the ink width too).

**States** per request: `HIT` (key found), `HELD` (zooming and over budget: a sprite of the same `ikey` within 2.3 octaves is scaled), `BUILD`, `SKIP` (people and vehicles while zooming), `DEFER` (exact, over budget: draw the octave sprite and sharpen later).

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| request | key in cache | | HIT | blit 1:1 or resampled | `:394,412-414` |
| request | zooming, key missing, `builds >= maxZoomBuilds (16)` or time up | a held sprite within 2.3 octaves | HELD | scaled blit | `:399-402` |
| request | same | none held, people or vehicle | SKIP | nothing drawn | `:403` |
| request | exact, key missing, `builds >= maxBuilds (60)` or time up | | DEFER | re-enters `drawSprite` with `exact=false, zooming=true` | `:405-407` |
| DEFER | octave key missing, nothing held | building or tree | BUILD | `builds++`, **not counted against the budget that deferred it** | `:409` |
| BUILD | cache over `limit` (20000) or `pixels + w*h > maxPixels` (90 Mpx) | | evict | drop |ln(sb/wanted)| > 1; if still > 80% clear everything | `:347-350,329-335` |
| pre-render | frame built nothing, view still 8 frames | sprites seen this frame | BUILD x12, 4 ms | neighbouring octaves | `:372-384`, `vizlib.js:851` |

**Invariants**: S-I1 the cache never grows without bound (limit and pixel cap in `buildSprite`); S-I2 `index` lists exactly the cached sprites (rebuilt in `evict`, appended in `buildSprite`); S-I3 every frame builds at most `maxBuilds` / `maxBuildMs` worth (at least one): **violated, S-1**; S-I4 a sprite in use is never invalidated under the draw: holds, `sp` is a local object and `held` re-checks `cache.get(h.key) === h` (`:401`), eviction only deletes map entries.

**Reachable invalid states**
- **S-1 · build budget bypassed on a colour change. CONFIRMED** (R37). The deferral branch (`:405-407`) assumes a coarser sprite of the same look is held; the `ikey` includes the colours, so a recoloured building has none, and the inner call builds the octave sprite at once (`:409`). Cost: one frame builds about N sprites for N changed buildings.
```
$ node docs/state-machines/repro/r37-build-budget-bypassed-on-colour-change.js
settled: builds in the last frame 0, 2028 sprites cached, 445 buildings on screen; budget per frame: maxBuilds Infinity (during a frame it is 60), 8 ms
frame after the change +0: sprites built 362   <-- budget is 60, wall 370 ms
frame after the change +1: sprites built 32, wall 72 ms
frame after the change +2: sprites built 32, wall 59 ms
```
  The following frames build the exact-scale sprites at 32 a frame (the 8 ms clock budget), so the stall is followed by ten soft frames. In a browser a build costs about 0.8 ms (comment `assetlib.js:320`): about 0.3 s. Likelihood: any pack that recolours on time at 1 to 6 px/m (below 1 px/m the far layer paints in slices and patches, which has its own budget).
- **S-2 · cache cliff. CONFIRMED** (R34). `evict` is all-or-nothing above 80% (`:331`).
```
$ node docs/state-machines/repro/r34-sprite-cache-cliff.js
settled (150 still frames): 406 sprites, 79.5 Mpx of 90 Mpx cap; clear-all line at 72 Mpx
pan of 400 frames: cache dropped by more than 20 sprites at 1 frame(s); first at frame 175, largest drop 471 sprites; pixels now 69.3 Mpx
after a clear-all, frames until the still view is sharp and builds nothing: 4 (builds per frame at 60 max: 116,60,2,0,0,...)
```
  (The last line clears the cache by hand to time the recovery; the drop at frame 175 is the real eviction.) Impact: one frame that rebuilds the whole view (and, because of S-1, ignores the budget). At DPR 1 the same view settles at 39 Mpx: no cliff.
- REFUTED: **eviction while a sprite is in use or being built.** Everything is synchronous; `evict` runs before the new sprite is created (`:349-350`), it only deletes map entries, and `drawSprite` holds `sp` as a local object. The occlusion path (`spritePlacement`, opt-in) looks the key up per call and returns null when missing (`:459-460`).
- REFUTED: **non-convergence of the budgeted scheduler** on a still view: every frame builds at least one, the missing set shrinks, and the machine ends at `builds === 0` (R34 settles in 4 frames after a clear; R37 in 11 after the change). It does not converge while the cache is over the cliff and the view keeps revealing sprites (S-2).
- REFUTED: **unbounded memory.** The unbounded structures are tiny: `themeCache` (one entry per family, look, register), `labCache` (colours), `drawFog.cache` (one), `sim._px`, `sim._tint`, `sim._farScratch` (grows to the largest patch box, never shrinks), `shadeMemo` (cleared above 5000 / 60000), `built` and `groupDefs` (cleared above 12000 / 4000). The layer canvases are the big ones: per sim two layers, two spares, one partial repaint: up to 5 x 3.24 x the view in device pixels (107 MB each on 1920x1080 at DPR 2 -> up to 0.5 GB, not freed when zooming in, because `sim._far` is kept while `far` is false).
- REFUTED: **sprite scheduling flicker** other than by design (people and vehicles skipped while zooming, soft-to-sharp when the exact sprite arrives).

---

## 4 · Machine E: per-entity draw cache, and Machine T: theme/register/region

**E states** per building: `FAST` (`e._fast`, default style, no binding, same theme object and same state/owner: draw the cached sprite), `VERSIONED` (`e._fv === sim.frameVersion`: draw without asking the style), `ASK` (call the style, recompute key, maybe new colours and asset). Trees: `_ck` over theme ids, kind, bound colour. Agents: `_ck` over register id and bound data.

**Invariants**: E-I1 the drawn sprite matches style(e), theme and register. Maintained by `_ck` (`:1374-1379`), `_th === pal` (theme **object** identity), `_fv` and the invalidations in `setTheme` (`:492-495`) and `bindData` (`:532-535`). E-I2 `frameVersion` is bumped whenever any style may have changed (contract, `:959-961`).

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| any | `setTheme(sim, th)` | | ASK | agents redressed from `ts`, `_ck/_rc` null; buildings `_ck/_fast/_fv` null; trees re-pick kind, `_ck/_asset` null | `:484-496` |
| any | `bindData(sim, selector, scale, fn)` | | ASK | `_ck`, `_fast` cleared for all; `sim.bindings` replaced | `:529-536` |
| FAST | state or owner differs, or theme object differs | | ASK | | `:1359` |
| VERSIONED | `frameVersion` differs, binding, or `segOn` crossed | | ASK | | `:1363` |
| ASK | style returns data/roof/overlays/seg | `e.params` | key -> new colours and asset | `getAsset` | `:1374-1379` |
| ASK | | no params | extrusion | `_fdata/_froof` kept for the VERSIONED path | `:1373` |

**Reachable invalid states**
- REFUTED: **stale entity after theme/register switch**: `setTheme` clears every cache and `_th` changes with the theme object; R38 A switches colour to formal in the middle of a patch pass and ends equal to the from-scratch picture. `lookSel.onchange`, `rC`, `rF` all call `setTheme` then `applyHooks` (`viewer.html:279-286`).
- REFUTED: **`frameVersion` wrap or non-bump**: a JavaScript number, compared with `===` and turned to `'v' + n` (`:966`); `ctl.setWall` bumps via `store.invalidate` (`packhost.js:147`, `packstore.js:192`); the A/B view sums both versions plus the flip count (`packdash.js:112`). `bindRenderer.dispose` sets the version to `undefined` and the style to null, which makes `far` re-sign by states and the diff fall back to a repaint (`:1264`). No stale path found.
- **E-1 · theme cache collision. CONFIRMED** (R35e). `AssetLib.theme` keys `(fam.id || 'x') | look.id | reg` (`assetlib.js:128`); two family records without an `id` return the same theme object. Every record in `assets/palettes.json` has an id, so this needs a hand-made family. Impact low, likelihood very low.
```
e  two different id-less families give the same theme object: true (ground #cccccc and #cccccc; ...)
```
- **E-2 · scene objects shared between sims. CONFIRMED** (R35d). `createSim` wraps `scene.buildings[i]` (`e.src = b`) and `Replay.paintStates` writes `e.src.state` / `investor` (`replay.js:64-65`), so a rebuilt sim, a region switch or a scene reload of the same object starts with the last replay week's colours instead of the scene's own (`1023 of 1023 buildings already "finished"`). Impact low (the next `setWeek` repaints), likelihood medium on the old replay page.
- SUSPECTED: **a second `bindRenderer` on the same sim with an equal `frameVersion`** would find the far layer current and not repaint (the signature is the version string). Not reachable on the current pages (one bind per page); recorded because the contract (`:959-961`) puts the burden on the caller.

---

## 5 · Machines H and X: ZoomHold and Refocus (explicit), C camera, K controls

**H** states: `empty` (`drawn === null`), `held` (`stretched`), `live` (`drawn` set, transform cleared). **X** `state`: `live`, `zoom`, `refine`, `fade`.

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| X.live | frame, `shouldRender` true | | live | `render(front)`, `hold.rendered(view)` clears the transform | `refocus.js:62-63`, `zoomhold.js:43` |
| X.live | frame, `shouldRender` false | scale moved in the last `settleMs` (120) | zoom | reticle seeks, optional blur | `:63` |
| X.zoom | frame, still moving | | zoom | blur follows the stretch | `:65` |
| X.zoom | frame, `shouldRender` true | zoom stopped, or stretch beyond 0.3..8x | refine | `since = now`, `hold.place`, `render(back)` | `:65,47-50` |
| X.refine | `isDone()` or `maxWaitMs` (500) | | fade | back opacity transition, `fadeEnd` | `:41-46` |
| X.refine | frame, `shouldRender` false | a new zoom | zoom | `hideBack` | `:67` |
| X.fade | `now >= fadeEnd` | | live | `hold.rebind(back)`, roles swap, old front hidden | `:34-40,69` |
| X.fade | frame, `shouldRender` false | a new zoom | zoom | `hideBack` (opacity jumps to 0) | `:68` |
| any | `reset()` (resize, a failed frame, `enabled` off) | | live | `hold.reset`, rebind front, back hidden | `:56-57` |
| H | `shouldRender` | `drawn` null or size differs | true | | `zoomhold.js:31` |
| H | `shouldRender` | scale changed by more than `creep` (0.15%) | stamps `lastChange` | | `:33` |

**Invariants checked by R33, 300 seeded random runs of wheel/key zooms, pans, resizes, `enabled` toggles, `isDone` flips, long idles and throwing frames (32,831 frames after each of which they were evaluated):** (I1) in `live` with refocus enabled the hold is not active, the front transform is `none` and the back canvas is at opacity 0; (I2) the back canvas is hidden in `live`, `zoom`, `refine`; (I4) when the events stop and `isDone()` is true the machine is back in `live` within 120 frames, i.e. **no held transform survives and no end of zoom is lost**; (I5) the camera scale is finite and inside `[minScale, maxScale]`, the centre inside the bounds plus margin; (I6) a burst of 40 wheel events with eased zoom drains (`pendingZoom() === 0`) and leaves a finite scale.
```
$ node docs/state-machines/repro/r33-zoom-refocus-fuzz.js
I6 ordinary wheel burst: pendingZoom=0 scale finite=true
300 runs, 32831 frames checked, 0 invariant violations
I6 synthetic wheel deltaY=1e6 (smoothZoom): pendingZoom=0, camera scale=0.7901532076412859 -> finite
camera: maxScale on a 10 m scene 101.7, after setBounds to a 5 km scene 101.7 (a fresh camera on the 5 km scene has 32)
```
Status of the hunted cases: **wheel/drag/keys during hold, refine or fade: REFUTED** (re-entrancy is by polling: `shouldRender` is evaluated every frame from the camera, nothing keeps a copy of the zoom that could be lost); **a held transform that never clears: REFUTED** (`rendered` and `reset` both clear, a throwing frame goes through the page's `rf.reset()`, `viewer.html:276`); **resize during zoom: REFUTED** (`resize()` calls `rf.reset()` first, `viewer.html:174`; the layers re-key on width and height); **lost end-of-zoom with a very slow zoom** (steps under 0.15% a frame never stamp `lastChange`): REFUTED, it renders for real every frame, which is correct.

**Reachable invalid states**
- **X-1 · a fade aborted by a wheel tick pops.** `hideBack` sets `transition: none; opacity: 0` (`refocus.js:68`), so a back canvas half faded in disappears at once and the stretched front shows. By design (a documented explicit transition); cosmetic.
- **C-1 · `camera.zoomAt(NaN)` is permanent. CONFIRMED** (R35g): `clamp = max(min(max, min(.., v)))` returns NaN for NaN, nothing else guards. Reachable only with a NaN factor (a synthetic wheel with `deltaY: NaN`, a pinch with a NaN distance); with `smoothZoom` and `deltaY >= 465,000` `pend` becomes NaN and is cleared only by the camera-limit line (`controls.js:97`), by luck (R33). `renderFrame` with NaN, 0 or Infinity scale and with a zero-size view does not throw on node-canvas (R35g); the picture is blank. Impact low, likelihood very low.
- **C-2 · `maxScale` only rises** (`camera.js:24`), R33 last line. Impact cosmetic (zoom limit stays that of a smaller scene after loading a bigger one).
- **K-1 · hover and tooltip are not recomputed when the camera moves without a pointer event** (A/D pan, W/S zoom keys, eased zoom ticks). See §7 I-2.
- REFUTED: **lost key release**: `release` on window blur clears `held`; a `keyup` is not filtered by the typing guard (`controls.js:80-83`). **Pointer bookkeeping**: capture, `pointerleave`, `lostpointercapture`, `pointercancel` all delete the pointer; a lifted finger of a pinch leaves a clean one-finger drag (`:62`).

---

## 6 · The GPU-canvas collapse (paperdolls#3): what the draw path does per frame

Not fixed, as asked. Facts from code and from the canvas-call census (R30, 9,207 buildings, Fit view 1200x700, `getContext` wrapped; counts are exact, not timed):

| phase | `getImageData` / `putImageData` | `drawImage(canvas)` per frame | canvases created |
|---|---|---|---|
| first paint (343 frames) | 0 / 0 | 39 (2 layers + 37 sprite canvases) | 28.8 a frame, 9,872 in all (17.5 Mpx at DPR 1, 50 Mpx at DPR 2) |
| idle, settled | 0 / 0 | **2**, both layer canvases: 2.72 Mpx (DPR 1), **10.89 Mpx (DPR 2)** | 0 |
| one model patch (150 buildings, 361 a frame while painting) | 0 / 0 | the 2 layers + ~359 sprite blits into the scratch + 1 scratch-to-layer copy per patched rect | 9 |
| pan inside the margin | 0 / 0 | 2 | 0 |
| `sim.opts.pixel` + `posterize` (the viewer's "pixel" box), 6 frames | **808 / 808** (0.46 Mpx) | | |

```
$ node docs/state-machines/repro/r30-gpu-readback-census.js        (excerpt)
--- default options  (DPR 2, whole after 343 frames; ...)
  first paint totals: 9872 canvases created (50.14 Mpx), 13385 canvas-as-source drawImage calls; a 1920x1080 window at this DPR has layer canvases of 26.9 Mpx (107 MB) each, two of them blitted every frame, and a spare of each kept
  idle (settled)     per frame: getImageData 0  putImageData 0  drawImage(canvas) 2 [layer 2.0 x 10886kpx]  canvases created 0 (0 kpx)
  one patch (150 b.) per frame: getImageData 0  putImageData 0  drawImage(canvas) 304.5 [layer 2.0 x 10886kpx, sprite 302.5 x 1kpx]  canvases created 9 (7 kpx)
```
**Where a readback can come from** (all call sites of `getImageData` / `putImageData` in the draw path): `AssetLib.quantise` (`assetlib.js:318-322`; posterize only, once per sprite and per layer), `buildSpriteMask` (`:422`; occlusion only, opt-in and off by default), and the `willReadFrequently` low-resolution frame canvas `sim._px` (`vizlib.js:843`; pixel mode only). **None runs in the default far view**, idle or playing. So the 1 fps of paperdolls#3 is not a per-frame readback of this code. The diagnostic that "`willReadFrequently` on every canvas gives 23 fps, on one group leaves 0.9 fps" fits a different cause: `willReadFrequently: true` makes a canvas CPU-backed, so "all CPU" removes every GPU canvas cost at once, and "some CPU" adds GPU-CPU crossings on the blits between groups (layers, stage, sprites) that are still there.

**Candidates for the cost on a GPU canvas, ranked by what the code shows (none verifiable without a GPU; SUSPECTED):**
1. *Two layer-sized canvases blitted by a full-window `drawImage` on every animation frame, plus a redraw of the stage canvas that nothing asked for.* Idle frames are full redraws: `Refocus.frame` in `live` calls `render(front)` whenever `shouldRender` is true, which it is every frame once the zoom is 120 ms old (`refocus.js:62-63`, `zoomhold.js:34`); there is no dirty check, even with the sim paused. The layers are 1.8x the view in each dimension, so 3.24x its pixels; at 1920x1080 and DPR 2 each is 26.9 Mpx (107 MB), with a spare each and a repaint canvas: the total is above typical GPU canvas budgets, which can force textures out and back or push Chrome to a software canvas.
2. *About 9,900 separate canvases for sprites* (`A.sprites.factory` is `document.createElement('canvas')`, `viewer.html:119`), each a GPU resource when the 2D context is created. The layers and the stage then take sprites as `drawImage` sources from thousands of distinct textures during the first paint and every patch.
3. *Stacked full-window canvases with `will-change: transform, opacity`* (`viewer.html:16`): two stage canvases and, on the pack page, a highlight canvas that is cleared and redrawn every frame (`packhost.html:267`), all recomposited each frame.
4. *The enriched-scene half of the issue is not a GPU effect*: R36 measures it in software (below).

What would settle it, for whoever has the GPU: count `GPU` memory in `chrome://gpu` / DevTools Performance while idling with (a) `LAYER_MARGIN = 0`, (b) sprites from `OffscreenCanvas` or `ImageBitmap`, (c) one stage canvas only, (d) `requestAnimationFrame` skipped while nothing changed.

### The enriched scene (second finding of paperdolls#3), measured: B-2

**CONFIRMED** (R36): ground marks are not cached. `drawGroundMarks` (`vizlib.js:1322-1338`) runs every frame: for each cell with a share above 0.02 it saves, clips to the parallelogram and strokes a hatch of up to `h / gap` lines. The cached ground layer and the far layer do not include it, and the tint beside it is cached (one blit, 1.4x). Wall-clock on node-canvas (software; the ratio is the evidence):
```
$ node docs/state-machines/repro/r36-idle-frame-cost-marks-and-tint.js
plain                                                      idle frame median 6.80 ms  (min 6.28, max 8.14)
terrain (relief) only                                      idle frame median 9.32 ms  (min 7.88, max 10.43)
+ ground marks, 200 m cells (204 cells)                    idle frame median 44.79 ms  (min 43.38, max 51.39)
+ ground marks, 100 m cells (704 cells)                    idle frame median 54.62 ms  (min 53.94, max 62.33)
+ ground tint, 40 m cells (4480 cells), opacity .5         idle frame median 9.71 ms  (min 9.28, max 10.39)
ratio to plain: marks(200 m) x6.6, marks(100 m) x8.0, tint x1.4
```
A pack with an outline or halo mapping at the default `lod` (`far: aggregate`, `cell: 200`, `packhost.js:178-182`) installs `sim.groundMarks` (`packhost.js:357`); the cells it returns do not change between frame versions, only with the view, and the hatch is drawn in screen space, so the cache would be a layer keyed like the tint's. Also uncached per frame at far zoom: `collectAgents` poses and sorts every agent (up to 1,500 vehicles and 4,000 people on a big network) although only vehicle dots are drawn, and `drawChannels` rings (cheap).

---

## 7 · Machine I: picking, hover, selection and highlight

**States.** Pointer: `idle` (`down === null`), `pressed` (`down` set), `dragging` (`down.moved`). `hover` (a model index or -1), `store.selection()`. Highlight canvas redrawn every frame (`drawHighlight`, `packhost.js:639`). Channels (`HL`) recomputed per `sim.frameVersion` (`:268-270`).

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| idle | move | no button | idle | `hover = pick.hit(camera.view(), x, y)` model index, tooltip | `:610-618` |
| idle | down | left | pressed | | `:619` |
| pressed | move | > 5 px | dragging | `hover = -1` | `:616` |
| pressed | up | not moved | idle | `store.select(hit \| null)` | `:620-624` |
| any | wheel | | same | `hover = -1`, tooltip hidden | `:626` |
| any | Esc | | same | clears selection | `:631` |
| any | store `time` | `hover >= 0` | same | tooltip text refreshed | `:637` |

**Invariants.** I-I1 the building picked is the one drawn topmost at that pixel. Maintained by sharing the renderer's sort key: pick `d = fit.cx + fit.cy + z` (`packpick.js:41`) equals `collectStatic`'s `d` (`vizlib.js:924`); equal keys fall to the later building in both (stable sort / `a.i > b.i`). Elevation: `touches` shifts the pixel's ground point by `z0` (`packpick.js:56`), the derivation in the header comment. REFUTED as a defect except for degenerate fits (E-1 below, R35a). I-I2 the highlight sits on the building it highlights: **violated for the halo and ground overlays, I-1**.

**Reachable invalid states**
- **I-1 · highlights at z = 0 (paperdolls#14). CONFIRMED** (R31). In `drawChannels`: `vis` projects `(fit.cx, fit.cy, 0)` (`packhost.js:292`); `ringPath(..., 1.6, 0)` for halos (`:296`); `outlinePath` uses z of 0 and `h` (`:164-167`, `:302`). In `bindInteraction.drawHighlight`: the selection halo calls `ringPath(.., 1.6, 0)` (`:649`) while its outline uses `z0 = sh.z` (`:653`), so on a hill the two parts of the selection are `z x scale` px apart. `drawGroundTint` / `tintCell` and `drawGroundMarks` project at 0 (`vizlib.js:1340-1341,1327`) over a ground that `drawTerrain` lifts by the terrain height. Every other consumer uses the entity's `z`: the building and its shadow (`:898,903`), `farBox` (`:1207,1209`), `collectStatic` (`:923`), the culling (`:787`), picking (`packpick.js:41,56`), the silhouette (`:76`).
```
$ node docs/state-machines/repro/r31-outline-halo-ignore-z.js
building 1011: terrain height e.z = 36.20 m, view scale 2.5 px/m  =>  expected offset between ground-0 and true position: 90.5 px
outline: footprint corner drawn at y=435.8 (z=0) FOUND; where the building stands (z=e.z) it would be y=345.3 NOT FOUND in the outline -> outline is 90.5 px below its building
vis(): the centre of building 1011 projects to y=440.5 at z=0 but y=350.0 where it is drawn; ...
view shifted so the building is drawn 115 px ABOVE the top edge (truly off screen): outline vertices issued = 24  (drawn although invisible: vis() used z=0)
view shifted so the building is drawn at y=690 of 700 (visible, on screen): z=0 projection says y=780.5; outline vertices issued = 0  (CULLED although the building is on screen)
selection: first path starts at y=434.8 ... a footprint corner is at y=435.8 (z=0) / 345.3 (z=e.z). The channel halo (ringPath(..., 1.6, 0)) and the selection halo are both at z=0; the selection outline uses z0 = 36.20
ground cell at (320,220): terrain there is 15.3 m high, so the ground under it is drawn 38.2 px higher on screen than the tint/hatch cell ...
```
  Impact high, likelihood certain on Jette (63 m of relief). Both directions of the culling error are shown: an off-screen building drawn, an on-screen one culled.
- **I-2 · hover not refreshed by camera motion without a pointer event. SUSPECTED.** `hover` is recomputed only in `onMove` (`:610-618`); `onWheel` clears it, but A/D/W/S key motion and the eased-zoom ticks (`controls.js:87-100`) move the map under a still cursor without a pointer event, leaving the dashed highlight and the tooltip on a building that is no longer there until the mouse moves. No repro: it needs DOM pointer events with a real layout (jsdom has no layout; `getBoundingClientRect` would be faked and the test would only restate the code).
- **I-3 · tooltip not refreshed by `frames` / `view` events**: the subscription is `time` only (`:637`). Already ranked in part 10 (B-1); a re-run or an A/B flip leaves the old number until the mouse moves. Not repeated here.
- **I-4 · pick silhouette vs sprite. SUSPECTED, minor.** A fitted building is drawn as an asset at `fit.cx, fit.cy` with the fitted rectangle, while the pick tests the lifted *footprint*; a rotated or non-rectangular footprint fitted at up to `maxDevDeg` can be picked where the sprite is not and missed where it is. Not measured.
- REFUTED: **selection or hover on a building a frame patch, `rebuild()` or a recolour hides or removes.** The pack page builds one sim per page and never calls `rebuild`; selection holds a model id, mapped to a scene index through `binding.index`, `si < 0` skips (`:645`), `sel.id < binding.count` guards (`:643`). A patch changes colours, not geometry, and the highlight canvas is drawn above the map and read from the same arrays each frame.
- REFUTED: **picking with elevation in the wrong painter's order**: same sort key as the renderer, with z; verified by reading both. The brute-force test in `viz/test_terrain.js` already compares `hit` with `hitBrute`.
- **I-5 · `Pick.create` indexes once.** Heights and `z` are taken at creation (`packpick.js:37-44`); `sim.relief` is baked at `createSim`. Nothing changes them later in the shipped pages, so REFUTED; a future "relief" slider would need a re-index.

---

## 8 · Machine Z: where the ground height (z) is used, and Machine V: scene validation and fit

| consumer | uses z? | where |
|---|---|---|
| building drawing (sprite, extrusion), its ground shadow | yes | `vizlib.js:898,1385-1386,1389`; shadows `:903` |
| tree, agent, fountain | yes | `:477,595,933` |
| roads, ground terrain, relief shading | yes (own z per point or the grid) | `:649,692-733` |
| far layer boxes, grid, patch, rough layer | yes | `:1207,1209,1214,1152` |
| rough ground | **no** (L-3) | `:1175` |
| pick, pick silhouette | yes | `packpick.js:41,56,76` |
| outline, halo, `vis`, selection halo | **no** (I-1) | `packhost.js:292,296,302,649` |
| ground tint, ground marks | **no** (I-1) | `vizlib.js:1327,1340` |
| camera room for relief | yes | `camera.js:20-24`, `vizlib.js:610` |
| a degenerate footprint's terrain lookup | wrong point (E-1) | `buildinglib.js:363` -> `vizlib.js:465` |

**V invariants**: V-I1 a scene that passes `validateScene` renders without an exception and with finite geometry. V-I2 `fit.cx, fit.cy` are the footprint's centre.

| from | event | guard | to | where |
|---|---|---|---|---|
| raw | `validateScene` | arrays present | `ok` / errors (max 40) | `vizlib.js:287-331` |
| ok | `createSim` | | `fit` per building | `:462-471`, `buildinglib.js:360-386` |
| fit | hull < 3 points | collinear or repeated | `{ok:false, reason:'degenerate', cx:0, cy:0}` | `buildinglib.js:363` |

**Reachable invalid states**
- **V-1 · degenerate footprint: validated, fitted at the origin. CONFIRMED** (R35a). `validateScene` needs only three finite points (`:303`); `fitFootprint` returns `cx = cy = 0` for a hull under three points (`buildinglib.js:363`), and `createSim` uses it for the terrain height (`:465`), the painter's key (`:924`), the pick key and the highlight cells. The extrusion itself is drawn at its true footprint, so the building appears but is sorted as if at the origin, and lifted by the terrain at the origin.
```
a  validateScene ok=true; fit={"ok":false,"reason":"degenerate","cx":0,"cy":0}; e.z=4 but the terrain at its footprint (305,300) is 16.2 m; renderer sort key d = fit.cx+fit.cy+z = 4 instead of ~626
```
  Likelihood: the ingest drops areas under 8 m2 (`build.py:249`, part 20 T09) but a self-crossing or collinear footprint can survive, and the viewer accepts any scene file.
- **V-2 · `levels` unbounded. CONFIRMED** (R35f): `validateScene` requires `levels >= 1` and finite (`:304`); an extruded building loops `bays x levels` polygons per wall (`vizlib.js:136-138`) every frame; asset buildings are protected by the asset's own cap (R35: `b0 params true` for 2e6 levels, height 180 m).
```
f  levels -> validateScene ok / drawn as extrusion / first-frame ms: 4 -> true / true / 66; 20000 -> true / true / 123; 200000 -> true / true / 1069
```
  (The ingest clamps levels to 1..60, part 20 §ingest invariant 6, so only a hand-edited scene reaches this.)
- Other validator gaps seen, not repro'd: footprints may self-intersect (T13 of part 20); `terrain.z` of 100M cells passes the length test; a road with `width` but `pavement` over the width; `ids` may be absent for all buildings (then `hashStr('undefined')` gives every building the same seed). Impact low.

---

## 9 · Machine P: the pages (`viewer.html`, `packhost.html`)

**States.** Viewer: `sim` (rebuilt by `rebuild()`), `scene` (placeholder, file, embedded), `state {region, look, reg, seed, playing}`, `replay`, `A.sprites.dpr`, two canvases, `rf`. Pack page: one sim for the page, `binding`, `pick`, `inter`.

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| any | region select | | new sim | `state.look` reset, `rebuild()` | `viewer.html:279` |
| any | traffic, people slider `input`, drive select, detail box, "new seed" | each event | new sim | `createSim` (all agents, fits, terrain), `finish()`, `attachReplay()`, `applyHooks()`, `resize()` (canvases cleared, `rf.reset()`) | `:176-186,282-290` |
| any | look select, register buttons | | same sim | `setTheme`, `applyHooks` | `:280-286` |
| any | scene file | valid | new scene | `rebuild`, `focusScene` (camera refit) | `:161-170` |
| any | window `resize` | | same | canvases `width = clientWidth * dpr` (a local `dpr`), `rf.reset()`, `cam.resize` | `:171-175` |
| frame | exception in a frame | | same | message once, `rf.reset()`, next frame scheduled in `finally` | `:266-277` |

**Reachable invalid states**
- **P-1 · stale DPR. CONFIRMED** (R35c). `A.sprites.dpr` is assigned at load (`viewer.html:120`, `packhost.html:180`); `resize()` reads `window.devicePixelRatio` afresh for the canvases but never for `A.sprites.dpr`. After browser zoom (which also changes `clientWidth`, so the layers are repainted, but at the old `q`) or a move to another screen, the layers and sprites are made at the old density and blitted scaled. R35c renders the same view with `dpr=2` and with `dpr=1` on a 2x canvas:
```
c  far layer canvas: sprites.dpr=2 (matches the canvas) 3240x2160; sprites.dpr=1 left from page load, canvas now 2x 1620x1080; the two pictures differ in 540988 of 8640000 bytes (the second is the up-scaled low-resolution layer)
```
  Moving from 2x to 1x leaves layers four times bigger than needed. Impact medium (blur or memory), likelihood medium; a reload fixes it. Also the layer key has no `q` (L-I4).
- **P-2 · `rebuild()` per slider `input` event.** Each tick of Traffic or People creates a whole sim (agents, `fitFootprint` for every building, the road index) and throws away its layers: for Jette a new first paint (rough layer at once, exact in slices) each time, and the canvases are cleared by `resize()`. The state itself stays consistent: the old sim is garbage, the sprite cache is shared and keyed by look, `rf.reset()` returns to `live`, `isDone` reads the current `sim`. REFUTED as a correctness bug (setTheme or rebuild while sprites are built: there is no asynchronous building, a frame is atomic); it is a cost (D-2 below).
- **P-3 · the layers of a new sim are painted in the first two frames, with non-exact sprites** (L-1 above): every `rebuild()` fixes that softness for the life of the sim at DPR 2.
- **P-4 · `applyHooks` mutates `sim.buildingStyle`** to a non-versioned function (`plain` mode, `viewer.html:206`) or to `null`; the far layer follows through `far`, `skey` has no style term. Switching modes without the layer noticing is covered by `bindData`'s `_ck` reset and by the signature (`:966-973`). REFUTED stale, but note the modes `numeric output` and `plain walls` have no far layer at all (L-2).
- REFUTED: **resize during zoom** (resize resets the machine and re-keys the layers, §5), **a frame that throws leaves the zoom state broken** (`rf.reset()` in the `catch`).

---

## 10 · Machine N: agents (people, vehicles, trams)

States per agent: `walking/driving` (edge, `s`, `dir`, `side`), `driven` / `path` / `static` motion (`setMotion`), `pose` (explicit position). Invariants: N-I1 `0 <= s <= edge.len` after a step (`stepSim:561-574` re-seats on the next edge); N-I2 every edge has `len >= 0.1` (`buildNetwork:347`), so `agentPose` never divides by a tiny length; N-I3 spawn counts are capped (1,500 vehicles, 4,000 people, `:438`).
Reachable invalid states: none found that a shipped page reaches. Checked: a negative first `dt` (rAF time before `performance.now()` at load) moves an agent by a few centimetres and is clamped by the edge test; `mo.path` ending at time 0 with `loop` gives `sim.time % 0 = NaN` and a NaN pose (an API misuse, SUSPECTED, not in any shipped page); `opts = [e]` fallbacks keep an agent on its edge when it has no neighbour; people avoid blocked pavements (`isWalkable`). Agents are redressed from `a.ts` by `setTheme`, so nothing respawns. The only cost is per-frame work for agents that are not drawn at far zoom (§6).

---

## 11 · Open questions and follow-ups

- Verify §6 candidates 1 to 3 on a GPU Chrome (`chrome://gpu`, memory per canvas) before choosing a fix; the repro cannot.
- R36 measured software time; the ratio on a GPU is not known.
- Not covered: the Python frame renderer (`paperdolls/render`, known-issues 10), the occlusion option (`cullHidden`, off by default; its mask readbacks are counted in R30 only for the pixel option), `drawFog`, the `pixel` finish beyond its readback count, and `treelib.js`.
- Suite state at the time of writing: see the commit message.
