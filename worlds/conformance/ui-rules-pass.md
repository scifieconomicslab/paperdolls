# ui-rules pass — conformance world

Run date: 2026-11-11. Builds: `worlds/conformance/visual`,
`visual-formal`, `visual-voxel` (one self-contained file each). Browser: Brave
with ANGLE/GL on an NVIDIA RTX 4080 SUPER (not SwiftShader).

## Blocking gates

| gate | result | evidence |
|---|---|---|
| G1 appearance encodes only model state | **PASS** | Roofs read the declared `depth`; the `approved` reading draws one mark; walls use the look material, never data; people/vehicles/trees are labelled decoration |
| G2 people are paper dolls | **PASS** | One `paper` tone for head/limbs; `garment` is the only personal colour; no skin, hair, face or identity token exists |
| G3 red↔green reserved for data | **PASS** | The only red→green spectrum is the declared roof ramp; the UI accent is brick, states use single colours |
| G4 model is the source of truth | **PASS** | Outputs read frame series; mean depth and approved share are computed in the model, not the renderer |
| G5 missing data ≠ zero | **PASS** | Legend carries a "No data" swatch; stats show "No data" when a value is undefined; `colourScale` maps NaN to the no-data tone |
| G6 inventions labelled | **PASS** | Sidebar note and About drawer label decoration and proposals; the page says "model, not forecast" |
| G7 attribution present | **PASS** | paperdolls CC BY 4.0, Colorfigures (April Zhu, MIT), model licence. Constructed map, so no ODbL line is required |
| G8 determinism posture | **PASS** | Same seed twice → identical 80-tick series (script check); parameter/scenario changes restart from t=0 with the same seed |
| G9 accessibility floor | **PASS** | `:focus-visible` ring; focusable canvas; drag/wheel and A/D pan, W/S zoom, F fit, R rotate, Space play/pause; reduced-motion starts paused and disables transitions; text/dim tokens exceed 4.5:1 |
| G10 no network at view time | **PASS** | `check-single-file.mjs` PASS ×3, zero external refs |

## Gate 7 process checks

- **Two-layer UI — PASS (partial analyst layer).** Policy view is the default;
  the About drawer exposes provenance (look/family/palette/seed), assumptions,
  licence, tick, the controls list and a raw-series export. Parity and `?dev=1`
  frame check are absent because the conformance fixture has no NetLogo source.
- **Units — PASS.** Mean depth (share), approved share (share), approved
  structures (structures), legend domain 0–1.
- **Scenarios — PASS.** Baseline/Subsidy segmented control maps to the declared
  `grant-round` intervention; switching restarts from t=0.
- **Impact view — PASS.** Draws the confirmed causal graph only
  (`subsidy → depth`, `depth → approved_share`).
- **Recorded trajectory — N/A.** Not requested for this world.

## Craft pass (after the gates)

- **Direction.** A working model instrument: warm paper and brick, one calm
  accent, data on the roofs. Product: a retrofit ledger a policy reader can
  scrub. Character: warm, legible, technical. World: a constructed NW town.
  Moments: the roof ramp, the stat cards, the legend. Signature: the paper
  world-card over the canvas.
- **Spacing.** 4 px rhythm in the shell; 12/16/20–24 card spacing; one-off
  values removed. Sidebar 296 px, dock columns 250/1fr/300.
- **Type.** One system-ui family, mono for figures; sizes 11/12/13/17/19;
  weights 400–600; sentence case (tracked uppercase labels removed).
- **Copy.** Plain, specific, no hype; "model, not forecast" is stated twice.
- **Icons.** One Tabler line set, one stroke and size; no emoji.
- **Layout.** Fluid canvas, right controls, full-width dock; nothing overlaps
  the map. Policy default, analyst drawer explicit. The camera has visible
  zoom/fit/rotate controls and a grab cursor.
- **Charts.** Stat cards with sparklines; no axes invented, no dual scales; a
  text value backs every line.
- **Details.** Nested radii (10–14), hairlines, focus rings, one floating card.
- **Motion.** Only the timeline/progress; reduced motion honoured; camera moves
  are instant.
- **Honesty.** Decoration labelled, proposals named, "No data" first-class.

## Interaction

Verified headlessly on the built page, paused:

- wheel changes the view and does not scroll the page (`scrollY = 0`);
- drag pans; `W`/`S` zoom; `A`/`D` pan;
- `F` returns to fit within 16 anti-aliased pixels (0.002 % of the canvas);
- `R` rotates; `Space` pauses;
- zero console errors.

## Performance (valid GPU)

1440×900, playing, 3 s sample, Brave + ANGLE/GL (RTX 4080 SUPER):

| look | p50 | p95 |
|---|---|---|
| colorfigures | 16.7 ms | 16.7 ms |
| formal | 16.7 ms | 16.8 ms |
| voxel | 16.7 ms | 16.7 ms |

All three meet the gate (p50 ≤ 16.7, p95 ≤ 33).

## Screenshots

`worlds/conformance/map-data/verify/`: the Gate-4 set (`top-down.png`,
`iso-0.png`, `iso-90.png` from `tools/bench/screenshots.mjs`) and the per-look
renders (`iso-{colorfigures,formal,voxel}.png`).
