# Final report — Brussels Deepseek

World: `worlds/brussels-deepseek/` — The Great Retrofit v3 on the real residential fabric of Jette, Brussels (OSM relation 58258).

## Gates

| gate | result | note |
|---|---|---|
| Preflight | **FAIL (blocker recorded)** | 4 project files are missing from this checkout: `reference/render/catalogue/data/families.json`, `tools/page/src/generated/catalogue.ts`, `tools/page`, `tools/check-schemas.py`. Everything else PASS, including NetLogo 7.0.4 and Chromium. The world-record and binding schemas were validated with `jsonschema` directly. |
| Gate 1 — model brief | PASS | one breed (`households`) + a parallel building table; the buildings were promoted to an anchored breed for the renderer; every slider/switch/chooser live except `n-buildings` and `horizon-months` (structural); four plot groups + four key monitors on the dashboard |
| Gate 2 — world record | PASS | `brussels-deepseek.md`; description kept verbatim from the brief |
| Gate 2b — art bible | PASS | `real` / `nw` / `brick`; 3 pm late May, sunny; signature motif "speklagen" (cream limestone bands); palette proposed in OKLCH; approved and continued per the brief |
| Gate 3 — map source | PASS | OSM relation 58258; 20,269 elements fetched (2026-11-11); 9,216 structures; 93 % economic-class fallback and 98 % assumed storeys recorded |
| Gate 4 — map + style frame | PASS | 284-point municipal boundary is the world edge; 5,403 dwellings; 21 % footprints simplified to their oriented rectangle; top-down/iso captures; Gate 4 beauty subset met |
| Gate 5 — binding | PASS | months; buildings anchored to scene structures; top colour `retrofit_state` on the muted plum ramp (rental = no data); readings `approved` (flag) and `adoption` (segments); confirmed 16-edge causal graph; baseline + four parameter-set scenarios; world-record validator PASS; binding schema PASS |
| Gate 6 — parity | PASS | see below |
| Gate 7 — sign-off | PASS | single file, ui-rules PASS, beauty 4.0, FPS PASS, frame check clean; approved and continued per the brief |

## Required checks

- **World-record validator:** `tools/check-world.py` → **OK**.
- **Binding schema:** `schemas/model-binding.json` via `jsonschema` → **PASS**.
- **Scene schema:** `schemas/scene.json` via `jsonschema` → **PASS**.
- **Single-file check:** `tools/bench/check-single-file.mjs` → **PASS**, "one self-contained file".
- **Page:** `worlds/brussels-deepseek/visual/index.html`, **10,393,461 bytes (9.91 MiB)**, opens from `file://` with zero network requests, no fonts/CDNs/telemetry.
- **FPS** (Chromium, 1440 × 900, DPR 1, live, model playing):
  - opening neighbourhood: p50 **16.7 ms**, p95 **16.8 ms**, max 33.5 ms — PASS
  - overview: p50 16.7 ms, p95 16.8 ms, max 33.4 ms — PASS
  - street: p50 16.7 ms, p95 16.7 ms, max 33.4 ms — PASS
  - draw calls 199 at the opening zoom (budget ≤ 250); about 11.6 M triangles summed across the normal, shadow and colour passes (the recipe's 1.5 M per-pass triangle target is exceeded; FPS is the binding gate and passes). The available trim is an intermediate LOD for window surrounds above 150 m.
- **UI rules:** G1–G10 **PASS** (`ui-rules-pass.md`); craft pass applied (spacing 4 px scale, sentence-case group heads, 280 px sidebar, compact four-column dock, one main chart with ARIA and a data-table fallback, no loops, reduced motion); `?dev=1` frame check clean, zero console errors.
- **Beauty review:** **4 rounds**, final average **4.0 — PASS** (bar 3.8; no criterion below the exemplar):
  - value structure 4, palette harmony 4, data restraint 4, silhouette/skyline 4, facade detail 4, street/ground 4, life 4, light/depth 4, edge/framing 4, bible fidelity 4.
  - squint (neighbourhood): dark 8 %, mid 91 %, light 2 %, mean 119; exemplar 12 / 86 / 2, mean 112 — light share equal, mean in 100–130.
  - squint (street): 21 / 71 / 9, mean 118; exemplar 18 / 70 / 12, mean 120.
  - motion: clip-0 → clip-5 mean change 1.77/255, 2.55 % of pixels changed.
  - captures: `visual/review/round-1..4/`, scores in `visual/review/review.md`, comparison sheets `compare-street.png` and `compare-neighbourhood.png`.
- **Parity:** `sim-code/parity.md`.
  - procedure gates: **8/8 PASS** (world-local, exact values);
  - seed-0, 360-month trace: adopted 31, public cost €976,173.9863815566, bills saved €5,172,332.906744 (NetLogo …439; 1e-9), votes 7 — exact;
  - 200-run ensemble (seeds 0–199, 8 pens): **PASS**, all pens z = 0.00, KS p = 1.000 at 100/250/360;
  - determinism TS: ten seeds × two passes, hashes identical — PASS;
  - determinism NetLogo: ten seeds, two runs, byte-identical CSV sha256 `99735c4dbf1d96aeee7bd3be3a07d1db11c8fc39c11763da210a23dcbcdbfc71` — PASS;
  - the world branch (real OSM fabric) is not comparable to NetLogo and is not claimed as parity.
- **Snapshot:** `v1`, `worlds/brussels-deepseek/snapshots/v1/`, 5 files, manifest sha256 **12fd0e6de260d648738920c3ab31dc21d71c77b17ae1d4a631c23d834428f4b4**; log in `snapshots/LOG.md`.

## Skill gaps

**24 entries** in `skill-gaps.md`. The most consequential: four missing preflight files; two Overpass endpoints down before the third answered; the conformance scene scaffold assumes a grid, so the layout/streets/life modules were rewritten for OSM polylines; the ingest does not emit the boundary ring or forest/wood land use; the shared procedure harness has no home for a world's own fixtures; `run-netlogo.mjs` cannot vary a seed without a 200-value enumeration; the simulated model runs on the main thread (~6 ms a month, 16,140 households) rather than a worker; the beauty squint's light-share rule is sensitive on a dense real fabric; the snapshot tool copies `scene.json` while the page prefers `scene.composed.json`.

## Left undone / labelled

- **Simulation thread:** the model runs on the main thread (~6 ms a month); no worker is wired. Stated in the About panel and `ui-rules-pass.md`.
- **Two-run comparison:** scenarios start one run at a time; a side-by-side two-run comparison is not built.
- **Land use:** the extract's `landuse=forest` and `natural=wood` polygons are not emitted by the ingest; the large northern park/wood reads as ground with mapped trees. Not invented, named in `scene_report.md`.
- **Triangle budget:** ~11.6 M triangles across all passes (FPS passes). Trim recorded, not silently applied.
- **Sign-off:** no human answered; every gate answer was taken from the brief's list and recorded in the decisions log, per the brief.
- **Model inputs:** 98 % of dwelling storeys, 100 % of unit counts and all tenure assignments are labelled guesses; the results are illustrative, and every number in the model is a placeholder.

## The one thing I am least sure about

The world-mode building table: 5,403 dwellings with **98 % assumed storeys, 100 % assumed unit counts (80 m² each), and a seeded tenure draw**. The retrofit dynamics are faithful to NetLogo (parity proves the arithmetic), but the Jette fabric's occupancy is a guess, so the *level* of adoption and state spend in the world page is illustrative rather than measured. The map, the model and the rendering are honest about it; a local dataset of storeys/units/tenure would replace the guess without touching the code.
