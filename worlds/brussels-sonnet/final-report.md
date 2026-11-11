# Final report — brussels-sonnet (Jette, Brussels), 2026-11-11

Status: **signed off by the user on 2026-11-11, accepting the failed beauty review.** This run followed `skill.md` interactively, gate by gate; every gate was answered by the user.

| item | result |
|---|---|
| world-record validator (`tools/check-world.py`) | PASS |
| binding schema (`schemas/model-binding.json`) | PASS |
| single-file check (`tools/bench/check-single-file.mjs`) | PASS ×4, "one self-contained file", 4.04 MB |
| FPS (real GPU: NVIDIA RTX 4080 SUPER via ANGLE) | 60 fps (p50 16.7, p95 ≤ 16.8 ms, vsync-capped) at overview, neighbourhood and street zoom, idle and playing a 31,287-household run, dpr 1 and 2; uncapped render cost 0.6–2.1 ms. **Over the perf recipe budgets:** 134 / 454 / 278 draw calls (overview / neighbourhood / street; budget 250) and 6.9–8.9 M triangles counted across shadow, normal and colour passes (budget 1.5 M visible). `page/fps-all.mjs` |
| ui-rules | gates G1–G10 PASS, process checks PASS; craft pass done with weak spots listed in `ui-rules-pass.md` |
| beauty review | **FAIL**: round 6 average 3.7 (exemplar 3.8); criteria 4 skyline = 3 and 6 street and ground = 3 are below the exemplar's 4; criterion 1 = 3 meets it. Rounds: 3 at Gate 4 (accepted by the user despite the fail) + 1 scored at Gate 7 (interim rounds 4–5 unscored). `visual/review/review.md` |
| parity | NetLogo 7.0.4: 25 procedure gates PASS; 13-configuration matrix 150,176 cells 0 differ; 200-run ensemble PASS (1,155,200 cells, 0 differ); determinism 10 of 10 on both sides. **Map mode (8,105 buildings, 31,287 households) has no NetLogo twin.** `sim-code/parity.md` |
| runtime | simulation in a Web Worker (24 ms mean, 46 ms worst per month step at full scale; the main thread renders and owns the UI) |
| page | `worlds/brussels-sonnet/visual/index.html` |
| snapshot | `snapshots/v2` (sign-off; v1 = hand-over), see each `manifest.json` |

## What the user chose
Horizon doubled to 360 months; `n-buildings` = the real residential buildings of Jette (8,105: 433 tagged + 7,672 guessed); art bible: real / nw / brick, 3 pm in late May, sunny; map: OSM relation 58258; top colour = building retrofit state on the plum ramp; two structural readings (shared-measure pennant, adoption-progress cladding); the confirmed 19-node causal graph; baseline + four scenarios.

## What is invented (also in the page's About tab)
99 % of storeys; the guessed homes; units per building and simulated tenure; the landmark rule and its tower; decorative life, lamps, parked cars, generated trees; road widths and sidewalks; palette and moment.

## The one thing I am least sure about
That the numbers on screen mean anything for Jette. The real-map run is a different building table from the one NetLogo can run (real footprints, 99 % assumed storeys, guessed homes, simulated tenure) feeding a model whose every number is a placeholder: the code is verified against NetLogo, the map-mode result is not.

## Files
`brussels-sonnet.md` (record), `art-bible.md`, `map-data/`, `sim-code/` (model, binding, parity), `page/` (sources), `visual/` (page + review), `ui-rules-pass.md`, `skill-gaps.md` (48 entries), `snapshots/v1/`.
