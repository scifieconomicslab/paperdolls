# ui-rules pass — brussels-sonnet (2026-11-11)

Built page: `visual/index.html` (4.04 MB, one file). Gates run first, then the craft pass.

## Blocking gates (reference/ui-rules/paperdolls-gates)

| gate | result | evidence |
|---|---|---|
| G1 appearance encodes only model state | PASS | Dynamic recolouring happens in one module (`scene/data.ts`): ridge/coping colour and roof tint from the declared building state, hatch for "not modelled", pennant colour from the shared-measure status, cladding height from adopted ÷ units, and the lens uniform. Everything else (walls, trees, cars, people, lamps) is static or decorative and labelled. Verified by grep: `setColorAt` outside `data.ts` only writes initial seeded colours. |
| G2 people are paper dolls | PASS | `life.ts`: one paper tone (`oklch 0.90 0.018 85`) for every head; garments from the palette; no skin, hair or faces; no identity wording in the legend, About or alt text. |
| G3 no red↔green spectrum | PASS | Top colour: heather ramp (hue 285° → 330°); chart lines: quintile series on one purple ramp, other series in accent/neutral; no red↔green. Green appears only as vegetation and some door/shutter leaves (decorative), never as a scale. |
| G4 model is the source of truth | PASS | The page computes no economic quantity. Charts and tiles read frame series verbatim. Derived on screen and labelled as derived: the building-state bar (share of buildings from the four state counts) and the number of cladded storeys (round(adopted ÷ units × storeys)). |
| G5 missing ≠ zero | PASS | "Cost per retrofit" is NaN until the first retrofit and shows "no data" (checked at month 0); NaN breaks the chart line; rentals are "no data" with a 45° hatch on the cap, listed in the legend. |
| G6 inventions labelled | PASS | About tab lists: assumed storeys (99 %), the guessed homes (7,672), units per building, simulated tenure, the landmark rule and the decorative tower, decorative life with counts, palette and moment. The world record carries the same. |
| G7 attribution | PASS | Sidebar line and About: © OpenStreetMap contributors (ODbL); paperdolls CC BY 4.0, Sci-Fi Economics Lab; Colorfigures by April Zhu (MIT). The NetLogo model's licence is stated as not declared. Matches `CREDITS.md`. |
| G8 determinism | PASS | Dev tab: same parameters and seed twice give identical series over 61 frames (run by script: `{"same":true,"frames":61}`); the model also passes 10-pass determinism on both sides (`sim-code/parity.md`). Changing a parameter restarts from month 0 with the same seed. |
| G9 accessibility floor | PASS | Visible focus ring (2 px solid on buttons), full keyboard camera (D pans, W zooms, F fits; verified by script), `prefers-reduced-motion` stops life and uses instant camera moves, 171 text elements all ≥ 4.5:1 (measured). |
| G10 no network at view time | PASS | 0 network requests at load (Playwright request log); `check-single-file.mjs`: PASS ×4, "one self-contained file". |

## Gate 7 process checks
- Two-layer UI: policy view by default; drawer with About, Provenance, Parity, Series and `?dev=1` Dev tab. PASS
- Units: every tile, axis and control carries a unit or range. PASS
- Scenarios: five named scenarios from the binding; baseline comparison runs the same seed with default parameters in a second worker run. PASS
- Impact view: draws exactly the 19 nodes and 21 edges confirmed at Gate 5; parameters you changed are highlighted. PASS
- Recorded trajectory: none; the page says so in Provenance. PASS

## Craft pass (spacing → type → copy → icons → layout → charts → details → motion)
Direction: *product* a live model of retrofit decisions in Jette; *character* tidy, brick, daylight; *world* brick terraces with white-stone bands; *moments* the roof ridge states, pennants, cladding and the adoption chart; *signature* the step unit ("month 215 / 360") as the quiet timeline caption.
- Spacing on a 4 px grid (sidebar 16, dock 12/16). Type: system-ui plus ui-monospace for figures, sentence case. Copy: plain, no hype. Icons: Tabler line set only. Layout: fluid canvas, 296 px sidebar, full-width dock with timeline + legend, one main chart, impact view. Charts: zero baseline, NaN gaps, direct labels, cursor readout, ARIA title and description; the series table is in the drawer as the fallback. Motion: eased camera moves 320–400 ms, instant under reduced motion.
- Not done / weak: the dock text is small (9–10 px in the impact graph); 40 sliders in the sidebar are long; no table fallback beside each chart (only the drawer's Series tab).
