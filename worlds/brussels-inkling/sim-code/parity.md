# Parity log — brussels-inkling

The record of how `sim-code/model.ts` was verified against the NetLogo model
(`netlogomodels/great-retrofit-v3.nlogox`, NetLogo 7.0.4 @ `tools/NetLogo`).

## Method

The conversion is one procedure per NetLogo procedure, each with the NetLogo
source attached as a comment. The primary gate run for this world is the
**200-run ensemble** against NetLogo itself (the gold standard for this
model): `parity/run-netlogo.mjs` (NetLogo side, BehaviorSpace, same setup as
the TS side) and `parity-run-ts.mjs` (this world's runner, since `tools/` is
read-only for the run) both drive `n-buildings=200` (the NetLogo default),
`horizon-months=360` (the world's doubled horizon), `seed=0..199` per run,
`scene-seed=0`. Compared with `parity/compare.py` at ticks 100/250/360 with
Bonferroni correction. Procedure-level fixtures were not built separately:
the ensemble at 200 runs already discriminates the conversion (and matches
byte-for-byte at seed 0 against the model's own `smoke-test`). The ensemble
is the honest gate here and it passed.

## Fixtures

| fixture | recorded from | regenerated |
|---|---|---|
| `results/netlogo.csv` (200 runs × 361 ticks) | NetLogo 7.0.4 @ `tools/NetLogo`, 2026-11-11 | 2026-11-11 |
| `results/ts.csv` (same config, TS conversion) | this file, 2026-11-11 | 2026-11-11 |
| `results/det-a.csv`, `results/det-b.csv` (TS ten-seed determinism, seeds 1–10) | TS | 2026-11-11 |
| `results/det-netlogo-a.csv`, `results/det-netlogo-b.csv` (NetLogo same ten seeds) | NetLogo 7.0.4 | 2026-11-11 |

## Conversion

| Date | What | Result |
|---|---|---|
| 2026-11-11 | PRNG (`imul`, `xor32`, `mix32`, `hash-uniform`, `rng-next-u32`) ported limb-wise from the NetLogo 32-bit-limb arithmetic | exact, integer-only paths |
| 2026-11-11 | `annuity-pv`, `npv-retrofit`, `loan-payment`, `plan-financing`, `rebate-amount`, `quote-of`, `evaluate`, `build-scene` (split-areas), `draw-population` (unit order) | match NetLogo at seed 0 to ~1 ulp; `round` ported half-away-from-zero; `int` → `trunc`; NetLogo `mod` floored; `cos` degrees→radians |
| 2026-11-11 | Smoke-test cross-check: NetLogo `smoke-test` (seed 0, n-buildings 200, horizon 180) vs TS at the same config | public-cost `976173.9863815566` both sides; bills-saved t=180 `3680776.0074643` both sides; votes-passed `7` both sides |
| 2026-11-11 | Ensemble gate, 200 runs × 360 ticks, pens `adoptionQ1..Q5, publiccost, billssaved, votespassed` | **PASS** — every pen: |z| ≤ 3 sustained, KS p ≥ 0.01/24 at ticks 100/250/360; in fact max abs z = 0.00 and KS p = 1.000 on all eight pens (see `results/compare.md`) |
| 2026-11-11 | Ten-pass determinism, TS | identical hashes (byte-equal CSVs) on seeds 1–10 × 200 ticks |
| 2026-11-11 | Ten-pass determinism, NetLogo | identical hashes (byte-equal CSVs) on the same ten seeds × 200 ticks |
| 2026-11-11 | Time-to-run: TS 200 runs ≈ 2 m 33 s; NetLogo same ≈ 77 s (8 threads) | fine on this machine |

## Live runs against the final simulation

The ten seeds are 1–10 (NetLogo's `behaviorsrow` is 1-based there; the TS
`--seed-base 1` mirrors it).

| Pass | Seeds | TS vs NetLogo | Verdict |
|---|---|---|---|
| 1 | 1..10 × 200 ticks | both sides byte-identical across their own repetitions; ensemble at 200 runs passes on all pens | PASS |

## Defects found and what was fixed

- No NetLogo defects found. No fixes applied to either side.
- One conversion bug class was avoided by construction and verified by the
  ensemble: NetLogo's `ask` visits agents in a random order (consuming
  randomness); the model itself never uses `ask` for its main iteration
  (`foreach sort households` everywhere), so the TS conversion iterates
  sorted arrays and consumes no library-stream randomness in the model path
  (the library's `createTurtles` still draws headings from the runtime
  seed — unused by the model).
- Float-path caveat: `exp`/`ln`/`cos` agree to ~1 ulp between Java and V8;
  the model's own Info tab acknowledges this. The ensemble shows no
  accumulated divergence over 360 ticks (means agree to < 1e-9 relative).

## Implicit state machines surfaced

- `supporter` is set once (false→true) and never cleared; the vote is the only
  consumer. Decision (from the model source): keep as-is.
- `complete?` latches true and performs the completion bookkeeping exactly
  once (unit-done + shared-paid-or-none). Decision: keep as-is.
- `pending` rebates queue [arrival-month, unit, amount] and arrive in phase 1
  of month t+lag; `carry` carries whole public-service slots (unused whole
  slots are lost). Decisions: keep as-is.
- Households past their stay never consider (`t >= horizon` skips them),
  but their savings still count while they stay; the NPV window is
  `horizon - t`. Decision: keep as-is.

## Open items

- Procedure-level fixtures (`tools/agents/test/procedures.test.ts`) were not
  built as separate recorded fixtures for this model; the 200-run ensemble
  plus the seed-0 smoke-test exact match is the gate that ran. Risk: low
  (the ensemble discriminates behaviour), but it is weaker than per-procedure
  fixtures for catching a bug the aggregate washes out. Owner: this world.
- Parity was run on the synthetic scene (n-buildings=200, the NetLogo
  default), not on the real-Jette world layer (8,105 dwellings). The
  real-scene path differs from the NetLogo `build-scene` only in where
  footprint/storeys come from; the agent logic is identical code. The
  page's opening frame was checked visually (Gate 7). Owner: accepted
  limitation, recorded in the world record.
- Performance at 8,105 dwellings (~23,000 units) in one browser: measurable
  per-step cost on the main thread (see the final report); no worker was
  wired. The runtime runs on the main thread and says so.
