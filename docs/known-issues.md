# Known issues

Found during the audit of v0.1.0 and kept up to date. Severity is in brackets.

## Open

1. **The model's weekly counts do not reconcile.** `investor_purchases` counts transactions, so a resold building counts twice. The check reports a mismatch in most weeks, worst off by six. The render uses per-building state and is unaffected. Any policy claim built on the model's own aggregates is affected. (High)
2. **The model's "finished" aggregate means unsold finished buildings, not completed retrofits.** At week 259 the render shows 101 finished buildings while the aggregate shows 0. The completion check passes because 101 does not exceed 105. The authors should confirm which meaning is intended. (High)
3. **Wealth collapses toward zero.** Retrofit prices are paid from wealth and nothing replenishes it. Do not show wealth until this is settled. (High)
4. **The ingest has not been run on real OpenStreetMap data.** It was tested on a synthetic extract in all three formats. The Overpass query and the fetch client have not been run against the live service. (High)
5. **The final week is missing from the export.** The model reports `run_time + 1` weekly points, but the hook fires `run_time` times. The last week's aggregates exist and its per-building states do not. (Medium)
6. **No upstream check.** The plugin does not verify that the vendored file matches the upstream notebook. (Medium)
7. **Performance.** The model recomputes the wealth Gini over all households every week, and `check` runs the model several times. Large runs are slow. (Medium)
8. **Memory and file size.** The exporter loads every week into memory and the HTML embeds every frame. Eight frames give a 1.2 MB page, so a large spec can make a very large file. (Medium)
9. **A rerun with construction enabled is only covered by the relaxed check.** (Medium)
10. **The Python frame renderer is the older one.** `lab_render/render` (used by `frames` and `build`) does not use looks, trees or the formal theme. The JavaScript scene library does. The pipeline should move to it. (Medium)
11. **One frame rotation per scene.** A city with several street grids gets the rotation that suits the most buildings. The rest fall back to plain extrusions. The report gives the estimated share. (Medium)
12. **The model's buildings are not linked to the scene's buildings.** The model has ids and no coordinates. Assigning each to a real footprint is the spatial layer, which is not built. (Medium)
13. **Font fallback.** The renderer looks for DejaVu fonts and falls back to a small bitmap font on other systems. A font should be bundled. (Low)
14. **Missing buildings render as to-do without a warning.** If an id is missing in a week, the renderer shows it as to-do. (Low)
15. **The render seed is the model seed.** `frames` and `build` use the model's seed for layout. They should be separate. (Low)
16. **Vehicle and people positions are fixed offsets.** They fall outside a very small grid. A minimum grid size check is needed. (Low)
17. **The vendored model's copyright line is a placeholder.** `vendor/greatretrofit_v2/LICENSE` names "Sci-Fi Economics Lab". The original authors should confirm the holder. (Low)
18. **Carbon tokens.** Some of the formal register's grays are from memory of the Carbon palette and need checking against carbondesignsystem.com. See `viz/README.md`. (Low)

## Fixed

- The vendored model no longer imports plotting libraries, changes a global theme, adds a path pointing to the author's machine, or uses an unseeded global random number generator. Results are unchanged.
- The hook test compares every array in the result, not five.
- The one-state check passes when construction adds buildings. It requires at least n buildings with unique ids.
- The completions check uses a normal import.
- Parameter mismatches produce a readable error.
- Model paths in the spec resolve against the spec file. The vendored model is the default.
- Facade textures are cleared per palette, which bounds memory.
- Building heights depend on the render seed, so the seed changes the layout.
- The spec rejects the final week index, which the model does not export.
- The model's licence is settled: MIT, with the licence text in `vendor/greatretrofit_v2/LICENSE`.
- `lab-render doctor` replaces the missing setup step. It checks the install and prints the fix for each problem.
