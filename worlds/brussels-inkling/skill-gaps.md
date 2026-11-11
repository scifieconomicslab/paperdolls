# Skill gaps — brussels-inkling

Every time a skill is unclear, wrong, missing a file, or forced a guess, add an entry.

## Preflight (2026-11-11)
- `paperdolls-technology` / `paperdolls-pipeline` §Preflight: `tools/check-env.py` reports 4 FAIL lines — `reference/render/catalogue/data/families.json`, `tools/page/src/generated/catalogue.ts`, `tools/page` and `tools/check-schemas.py` do not exist in this checkout. Remedy printed is "run from the repository root" (we were at the root). Cannot fix without writing outside `worlds/brussels-inkling/`, which the brief forbids. Effect: Gate 7 cannot use `tools/check-schemas.py` if it is needed; `tools/page` missing means the page scaffold must come from `worlds/conformance/page` (explicitly allowed by the brief). NetLogo 7.0.4 IS present, so Gate 6 can run for real. Recorded; continuing.

## Gate 3 — map ingest (2026-11-11)
- `paperdolls-map-world` §Ingest: the commune boundary (used to clip roads and to shape the world plinth) is not assembled by the ingest tool from the relation's outer ways as a polygon; a separate Overpass query collected the 10 outer ways and they were joined by hand in `world-plugin.ts` (`communeBoundary` projection) and used by the page for the plinth silhouette and road clipping. The skill does not cover relation-multipolygon assembly; the boundary here is fetched and joined directly.
- `paperdolls-map-world` §Verify: roads at the commune edge had to be clipped to the boundary polygon before rendering, or they bled past the plinth into the sky. Done in the page build, not in the map-data. The verify screenshots (`map-data/verify/*.png`) show the clipped result.

## Gate 6 — parity (2026-11-11)
- `paperdolls-netlogo-to-ts` §Parity / profiling: the NetLogo PRNG's arithmetic 32-bit `nlBitAnd` loop consumed 68.7% of conversion time at 22,993 units in the browser. The skill does not cover PRNG performance. What was done: rewrote the PRNG to native 32-bit ops (`Math.imul`, `&`, `|`, `^`, `>>>`) preserving exact NetLogo semantics; verified byte-identical outputs (seeds 0–1 vs saved CSV, then a full 200-run re-run of the ensemble with byte-compare — PASS). The optimization changed no semantics; it was justified by a profile, not by feel.
- `paperdolls-netlogo-to-ts` §Parity: the gate was run on the synthetic scene (n-buildings=200), not on the real-Jette layer. The skill does not say which scene to parity if the world uses a real map with structural `n-buildings`. Decision (recorded in `sim-code/parity.md` and the world record): ensemble on the synthetic scene, accepted as the gate that ran; the real-scene path shares the identical agent-logic code, differing only in where footprint/storeys come from.

## Gate 7 — sign-off (2026-11-11)
- `paperdolls-scene-craft` §Trees / nature: the map-data tree leaves were first drawn single-sided and rendered black from below; the skill's nature recipe does not mention winding/side. Fix: `side: THREE.DoubleSide` on the leaf material. Visual-only change, no data touched.
- `paperdolls-technology` §Frame check / snapshot wait: the snapshot tool's screenshot wait is 15 s; a cold page open costs ~5.5–7.5 s of build plus 360 ticks of model steps on the main thread, so the opening frame landed late and the frame-check timed out on the first attempts. Fix: page opens at tick 120 (SNAP_TICK=120) so `__paperdollsReady` lands well inside the wait; the sim continues from t=0 on user input. Recorded; not a correctness issue.
- `paperdolls-map-world` §Map: the R0 motorway ring and untagged open grounds are absent from the ingest (road whitelist / no landuse tag), so Jette's motorway edge renders as muted grass. The skill's failure playbook covers overpass unreachable and >50% fallback classes but not missing whitelisted roads; nothing was invented to fill the gap. Noted in the About drawer.
- `paperdolls-pipeline` §Decisions: Gate 3's log line and the original mapping table recorded 22,986 units (a `round()` half-even slip when counting units by hand at Gate 3). The model's `round` is half-away-from-zero; recounting from `scene.json` with the same rule and the page's own frame check both give 22,993. Fixed in the mapping table; the Gate 3 log line left unedited per append-only; correction recorded in the Gate 7 line.

## Final tally
- Entries: 9 (preflight 1, Gate 3 2, Gate 6 2, Gate 7 4)
- Nothing in this list is a defect in the skills as written except the boundary-assembly gap (Gate 3) and the nature double-side omission (Gate 7), which are candidate skill edits.
