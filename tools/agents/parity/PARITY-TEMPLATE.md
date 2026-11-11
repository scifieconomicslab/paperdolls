# Parity log — <world_name>

The record of how `sim-code/model.ts` was verified against your NetLogo model.
Append; never rewrite. Anyone auditing this world starts here.

## Method

Procedure tests are the primary gate (`tools/agents/test/procedures.test.ts`
and `tools/agents/scripts/procedures.mjs`, live vs NetLogo 7.0.4); the
ensemble comparison is the backstop (`parity/compare.py`, Bonferroni
correction, extinction carry-forward). Parity is statistical and
exact-by-fixture; it is never seed-for-seed.

## Fixtures

| fixture | recorded from | regenerated |
|---|---|---|
| `test/fixtures/netlogo-7.0.4.json` | NetLogo 7.0.4 @ `tools/NetLogo` | YYYY-MM-DD |
| `test/fixtures/procedures-7.0.4.json` | same | YYYY-MM-DD |

## Conversion

| Date | What | Result |
|---|---|---|
| YYYY-MM-DD | Hand-converted procedure X | matches: exact / KS p = 0.99 |
| YYYY-MM-DD | Ensemble gate, 200 runs | PASS / FAIL on pens … |

## Live runs against the final simulation

Ten passes required before the user signs off (`README.md` Gate 6):

| Pass | Seeds | TS vs NetLogo | Verdict |
|---|---|---|---|
| 1 | 1001..1010 | gate PASS / pens … | PASS |
| 2-10 | … | … | … |

## Defects found and what was fixed

- <model defect in NetLogo code, fixed there with the user's consent, or model kept as-is (e.g. unsold-finished counted as finished)>
- <conversion bug, fixed on the TS side>

## Implicit state machines surfaced

- <breed/entity whose behaviour flips on an unspoken predicate, e.g. "once finished, never re-queues"; decision: keep / fix TS / fix both>

## Open items

- <anything that remains unproven, with the reason and who owns it>
