# Parity log — Brussels Deepseek

The record of how `sim-code/model.ts` was verified against
`netlogomodels/great-retrofit-v3.nlogox` (NetLogo 7.0.4 at `tools/NetLogo`).
Append; never rewrite.

## Method

- **Procedure gates.** The repo's shared procedure harness
  (`tools/agents/test/procedures.test.ts`) carries fixtures for the wolf-sheep
  sample, not for this model. The world may not edit `tools/`, so its
  procedure gates are in `sim-code/parity/procedures.test.ts` and run with
  `node --test sim-code/parity/procedures.test.ts`: 8 exact checks of
  `monthly-rate`, `annuity-pv`, `npv-retrofit`, `loan-payment`,
  `plan-financing`, `rebate-amount` and `hash-uniform`, against values
  computed independently in Python from the NetLogo formulas. **8/8 PASS.**
- **Exact end-to-end.** Seed 0, 360 months, synthetic scene (world = null):
  NetLogo and TypeScript agree to the last displayed digit on all four
  headline outputs (table below). This exercises every procedure in `go` and
  the PRNG stream.
- **Ensemble.** 200 seeds (0–199) on both sides, 360 months, 8 pens:
  `Q1..Q5` adoption, cumulative public cost, cumulative bills saved, votes
  passed. `tools/agents/parity/compare.py`, Bonferroni at 0.01 over 24
  tests. **PASS.** Report: `sim-code/parity/results/ensemble-report.md`.
- **Determinism.** Ten seeds (1–10), each run twice, both sides; whole
  series streams hashed. **PASS on both.**

## Fixtures

| fixture | recorded from | regenerated |
|---|---|---|
| `sim-code/parity/procedures.test.ts` | formulas in the NetLogo source, computed in Python | 2026-11-11 |
| seed-0 360-month trace | `netlogo-headless.sh` via `parity/run-netlogo.mjs`, seed 0 | 2026-11-11 |
| `sim-code/parity/results/netlogo.csv` | 200 seeds, 360 ticks, NetLogo 7.0.4 | 2026-11-11 |
| `sim-code/parity/results/ts.csv` | same 200 seeds, same ticks, TypeScript | 2026-11-11 |

## Conversion

| Date | What | Result |
|---|---|---|
| 2026-11-11 | PRNG: mulberry32 + `hash_uniform` ported byte-for-byte (16-bit limb multiply replaced by `Math.imul` on `>>>0`) | `hash-uniform` gate exact |
| 2026-11-11 | Economics: monthly rate, annuity PV, NPV, loan payment, financing plan, rebate cap, credit limit, loan-rate premium | 5/5 procedure tests PASS |
| 2026-11-11 | Setup: `build-scene`, `draw-population`, quintiles, free hours, costs; scene rules preserved; world branch reads the real dwellings | exact 360-month trace |
| 2026-11-11 | `go`: cash, snapshot, considerations, public-service rationing, payment, shared votes, metrics | exact 360-month trace |
| 2026-11-11 | Ensemble gate, 200 runs | PASS on all 8 pens (z = 0.00; KS p = 1.000 at 100/250/360) |

### Seed-0, 360 months (synthetic scene)

| output | NetLogo 7.0.4 | TypeScript |
|---|---|---|
| adopted units (`n-complete`) | 31 | 31 |
| public cost (€) | 976173.9863815566 | 976173.9863815566 |
| bills saved (€) | 5172332.906744439 | 5172332.906744438 |
| votes passed | 7 | 7 |

The last-digit difference on bills saved is 1e-9, from the order of
floating-point accumulation; it does not change a rounded output and the
ensemble distribution is identical.

## Live runs against the final simulation

| Pass | Seeds | TS vs NetLogo | Verdict |
|---|---|---|---|
| 1 | 1–10 | ensemble pens identical (z = 0.00, KS p = 1.000) | PASS |
| 2 | 1–10 | TS ten passes identical (hashes equal) | PASS |
| 3 | 1–10 | NetLogo ten runs twice: identical CSV sha256 `99735c4dbf1d96aeee7bd3be3a07d1db11c8fc39c11763da210a23dcbcdbfc71` | PASS |
| 4–10 | 0–199 | the 200-run ensemble is the sustained check; no pen drifts | PASS |

## Defects found and what was fixed

- **None in the model's arithmetic.** The port was written from the source and
  matched on the first seed-0 run; no alpha, checkpoint or horizon was tuned.
- **NetLogo's `round`** is half away from zero; the port uses
  `Math.floor(|x| + 0.5)` with the sign restored. Python's half-to-even is
  not used, so the port follows NetLogo.
- **The model's `cost-per-retrofit` is `false` before the first retrofit.**
  It is excluded from the ensemble CSV (a `false` cannot be parsed as a
  float) but is covered by the exact 360-month trace; the UI shows "no data",
  never zero.

## Implicit state machines surfaced

1. **"Once complete, never re-queues."** A household with `complete?` is
   skipped in the consideration phase forever, even if it later moves (the
   model has no moving). Kept as in the model; named here because it is not
   obvious from `go`.
2. **"Support is permanent."** `supporter` is set once and never cleared, even
   if the shared measure is still pending years later or the household's
   finances worsen. Kept; it is the model's declared behaviour.
3. **"Tax capacity does not carry."** `tax-left` is reduced by each rebate but
   never topped up; one year of capacity serves all payments. Kept.
4. **"A failed vote blocks nobody's own part."** Own-part payments happen
   before the vote, so a household can retrofit its unit while its building's
   shared measure fails. Kept.
5. **Public-service slots are lost, not banked.** Unused whole slots are
   discarded; only the fractional `carry` survives. Kept.

## World branch (not comparable to NetLogo)

NetLogo has no OSM scene branch, so the world-mode building table cannot be
compared to it. The branch only changes where the building/unit table comes
from:

- 5,403 dwelling buildings from `map-data/scene.composed.json` (the same
  dwelling whitelist as the map report), sorted by OSM id, anchored by scene
  index;
- floor area = footprint area × storeys × 0.8; unit = 80 m²; tenure from the
  same seeded `hash-uniform(scene-seed, k, 1)` rule — all labelled guesses;
- 16,140 households; `n-buildings` is inert when a world is supplied.

The synthetic branch (world = null) is the parity branch and is unchanged.

## Open items

- Storeys are assumed for 98 % of the dwelling buildings and units are
  assumed for 100 %; the model's world-mode results inherit those guesses.
  They are not a finding.
- The cost-per-retrofit pen is not in the ensemble (see above); the exact
  trace covers it.
- NetLogo's `smoke-test` experiment is fixed at 180 months; the runs above
  use the harness's 360-month experiment, so they are not the embedded
  experiment. Seed-0 at 180 months also matched the embedded smoke-test
  exactly (31 adopted / 976173.9863815566 / 3680776.007464334 / 7).
