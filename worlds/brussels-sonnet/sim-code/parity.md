# Parity log — brussels-sonnet

The record of how `sim-code/model.ts` was verified against `netlogomodels/great-retrofit-v3.nlogox` (NetLogo 7.0.4, headless, `tools/NetLogo`).
Append; never rewrite. Date of every entry: 2026-11-11.

## Method

This model is **fully deterministic given its two seeds**: every random draw goes through its own mulberry32 / `hash_uniform` (ported in the NetLogo source), never NetLogo's `random`. So the gates are **exact, seed for seed** (unlike the template's statistical default): the same `seed`, `scene-seed` and parameters must give the same value of every pen at every tick. The skill's 200-run KS ensemble was run as well (it passes trivially, p = 1.000).

What is compared: 16 outputs per tick (adoption by quintile Q1–Q5, public cost, bills saved, votes passed, units that cannot front the cost, adopted units, four building-state counts, shared measures pending / approved). Tolerance 1e-12 relative (a few cells differ in the last bit, ≈ 5e-16, from floating-point `pow`/`exp`; no integer differs).

Parity scope: **synthetic building table only** (the table NetLogo builds: lognormal footprints, random storeys, seeded tenure), 200 buildings (and 50 in one configuration). **Map mode has no NetLogo twin** (see Open items).

## Fixtures

Pure reporters are evaluated live in NetLogo as BehaviorSpace metrics and in TypeScript with the same arguments (`parity/procedures.ts`); there are no recorded fixture files. No fixture was regenerated.

## Conversion

| Date | What | Result |
|---|---|---|
| 2026-11-11 | `hash-uniform`, `mix32`, `imul` (PRNG core) | 8 cases, exact |
| 2026-11-11 | `monthly-rate`, `annuity-pv`, `npv-retrofit`, `loan-payment`, `rebate-amount`, `plan-financing` | 17 cases (25 gates in all), all PASS (≤ 1e-12) |
| 2026-11-11 | `build-scene`, `split-areas`, `draw-population`, quintiles, free hours, `prepare-costs` | agree: sums of income, savings, area, squares of area, horizon, free-hours, queue draws, quintile·area identical to 1e-15 after the fix below |
| 2026-11-11 | `go`, `pay-part`, `cash-phase`, votes, public-service queue, metrics | scenario matrix `parity/matrix.mjs`: 13 configurations × 2 seeds × 360 ticks × 16 pens = 150,176 cells, **0 differ** (baseline, passthrough, public_service, public_service + means test, refundable + means test, no credit, open credit, flat energy, shock energy with lag 0, no shared measure, no peer effect + low vote, rich savings + high deduction, small scene with scene-seed 7 and 50 buildings) |
| 2026-11-11 | Ensemble gate, 200 runs × 360 ticks, `seed` 0..199, 200 buildings, defaults | **PASS** on all 16 pens (`parity/results/compare.md`); exact check: 1,155,200 cells, 0 differ |

## Live runs against the final simulation

| Check | Result |
|---|---|
| Determinism, TypeScript: same 3 seeds, 10 separate processes | PASS: 1 distinct hash (`d07f6912aac6967b`) |
| Determinism, NetLogo: same 3 seeds, 10 separate processes | PASS: 1 distinct hash (`35fa987a361734a0`) |
| TypeScript vs NetLogo, final model | scenario matrix and 200-run ensemble above (the template's "ten passes of the gate" was done as 10-pass determinism on each side plus these; not 10 repeated ensembles) |

## Defects found and what was fixed

- **Conversion bug (mine), fixed on the TS side:** `split-areas` sets `rng-state int (hash-uniform scene-seed k 2 * 4294967296)`. I read `2 * 4294967296` as the third argument (so rng-state would be 0 for every building). NetLogo's prefix reporters take their arguments without infix, so it is `int ((hash-uniform scene-seed k 2) * 2^32)`. The first run disagreed from tick 0 (sum of squared unit areas 4,724,930 vs NetLogo 4,746,221); fixed, now identical. Only the NetLogo comparison could catch it.
- **NetLogo model, kept as-is, harmless:** `refresh-plots` prints an empty line every tick; `color-buildings` places one building per patch in a 25-wide grid, so the NetLogo model cannot show more than 400 buildings (its slider maximum). The TypeScript model has no such limit (the user's request: n-buildings = the real residential count).
- No model defect was found that changes results; nothing was changed in the NetLogo file.

## Implicit state machines surfaced

All kept as in NetLogo (nothing fixed):
- **Rental buildings are never modelled:** no adoption, no vote, but their units stay in `n-units`, quintiles and the adoption-by-quintile denominator.
- **A household that has finished (`complete?`) never reconsiders;** one that has paid its own part but whose building's shared measure never passes stays "partial" for ever.
- **`supporter` is permanent:** once a household supports a shared measure it never withdraws; an approved shared measure is never revoked.
- **A household stops considering at its expected stay** (`t >= horizon`) and stops accruing saved bills then.
- **Public-service slots are whole per month, the remainder carried, unused whole slots are lost;** a shared measure needs ceil(units × shared-share) slots.
- **Same-month decisions are not seen by others:** adoption shares and canvassing pressure are read from the start-of-month snapshot.

## Open items

- **Map mode (the real Jette buildings, 8,105 buildings / 31,287 households) has no NetLogo twin:** NetLogo cannot take a building table from outside, and its list code would be far too slow. The map mode runs the same code as the synthetic mode, with only the footprint and storey draws replaced by the map's footprints and **assumed** storeys. Parity is therefore proven for the code, not for map-mode numbers. Owner: the user, if a NetLogo model with an imported building table is wanted.
- **Ensemble variation is the `seed` only** (`scene-seed` fixed at 0 in the 200-run gate; scene-seed 7 appears in the matrix). Baseline adoption is low (about 36 of 722 households), so the matrix, not the baseline ensemble, is what exercises the other code paths.
- **Every number in the source model is a placeholder** (its own header says so); passing parity shows the TypeScript behaves like the NetLogo model, not that either is true.
