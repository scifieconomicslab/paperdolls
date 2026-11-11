---
name: paperdolls-netlogo-to-ts
description: How to read a NetLogo model, convert it to TypeScript procedure by procedure against the Model/Run contract, and prove behavioural parity with fixtures, a 200-run ensemble and ten-pass determinism.
---

# NetLogo → TypeScript

Load at Gate 1 (reading) and Gate 6 (conversion and parity). The model is the
source of truth; the conversion must behave like it, not merely compile.

## 1. Read the model fully

For a `.nlogo`/`.nlogox`, extract and record:

- every breed and every turtle/patch variable;
- the `go` loop and every `to-report` it calls;
- every `random` use, seed reference and `with-local-rng`;
- every hidden state machine (e.g. "once finished, never re-queue"); name it;
- every candidate interactive parameter: every slider, switch and chooser, plus
  anything the code branches on in a way the user cares about;
- every declared output: plot pens, monitors, series.

**Places kept in a table.** Some models keep their places (buildings,
dwellings, plots) as a list of records with no coordinates, and let agents
"live in" a record. That is spatial enough. Make the table an anchored breed:
at Gate 5 each record becomes one scene structure (map-world §4 says which),
taking its attributes (floor area, storeys) from the scene. Keep the model's
own generator for the table: it is what NetLogo runs, so parity uses it (§5).

Ask Gate 1 from `paperdolls-pipeline`.

## 2. The contract you write against

A world's `sim-code/model.ts` exports `defineModel(...)` by default. It imports
the thin runtime **by relative path**, never by package name:

```ts
import { defineModel, COLOR, type Ctx, type AnyAgent } from '../../../tools/agents/library/index.ts';
```

The renderer-facing contract (do not change it per world):

```ts
interface Model { describe(): Description; start(input: RunInput): Run }
interface Description {
  title: string;
  time: { unit: 'hours'|'days'|'weeks'|'months'|'years'|'tick'; horizon: number };
  params: Record<string, ParamSpec>;        // drives the controls
  entities: Record<string, EntitySpec>;     // breed -> kind: mobile | anchored | unplaced | link
  series: Record<string, SeriesSpec>;       // plots and monitors
  kpis: Record<string, KpiSpec>;
  interventions: Record<string, InterventionSpec>;
  reads: { world: string[]; data: string[] };
}
interface RunInput { params: Record<string, ParamValue>; scenario: Intervention[]; world: World | null; data: Record<string, DataTable>; seed: number }
interface Run { readonly frame: Frame; readonly done: boolean; step(): Frame }
interface Frame { t: number; entities: Record<string, Record<string, Column>>; series: Record<string, number[]>; events?: ModelEvent[] }
```

Rules:
- `params` is the inline `params` block in `model.ts`; there is no `params.ts`.
  Each parameter carries type, range, default and
  `tier: 'lever' | 'assumption' | 'structural'`.
- The step unit lives in `describe().time.unit`, not as a parameter.
- A parameter change is a new `start()` from tick 0 with the same seed.
- `checkFrame` must be clean in dev/test builds.

## 3. Convert procedure by procedure

One procedure at a time, following the NetLogo source line by line, with the
NetLogo source attached as a comment above the converted procedure. When you
find an implicit state machine, stop, explain it in plain words, and fix both
codes only with the user's consent — or record the decision.

Validate:

```bash
cd tools/agents && npm run typecheck
```

## 4. Parity before any acceptance

Run the procedure gates first; they must pass before the ensemble:

```bash
npm test
node --test test/procedures.test.ts
```

Every converted procedure needs a gate: exact comparison where NetLogo is exact,
KS where random. Fixtures live in `test/fixtures/`. If a fixture gap blocks a
procedure, record it with `scripts/procedures.mjs --record` and show the user
what changed before accepting the fixture.

## 5. Ensemble acceptance — 200 runs

Results go in the world, never in `tools/` (`W` = `worlds/<name>/sim-code/parity/results`,
as an absolute path or relative to `tools/agents`):

```bash
NETLOGO_HOME=tools/NetLogo node parity/run-netlogo.mjs --runs 200 --ticks <N> \
  --model <path.nlogox> --setup "<setup with the per-run seed>" --go go \
  --out $W/netlogo.csv --metrics "<pens>" --pens "<pens>"
node parity/run-ts.ts --model worlds/<name>/sim-code/model.ts --runs 200 \
  --ticks <N> --seed-base 1001 [--seed-param <name>] --out $W/ts.csv
python3 parity/compare.py $W/netlogo.csv $W/ts.csv --pens "<pens>"
```

**Seeds.** When the model's randomness flows through its own seed slider (a
NetLogo port's own PRNG), vary that slider per run on both sides: on the TS
side `--seed-param <name>`; on the NetLogo side put it in `--setup`, e.g.
`set seed (1000 + behaviorspace-run-number) setup`. Never enumerate 200
values in `--constants`.

**Scope with a real map.** Parity is run on the configuration NetLogo can run:
the model's own synthetic world (its generated table, its default sizes). The
page's real-map run is the same code fed map-derived inputs and has **no
NetLogo twin**. Say exactly that in `parity.md`, the About panel and the final
report; never call the map run "verified".

Pass only when every pen passes (Bonferroni; |z| < 3 sustained). A ten-run
ensemble decides nothing; you may watch its curves, not accept on it.

If it fails: read the table, fix the conversion bug you can see, and never tune
alpha/checkpoints/horizon to pass. If the bug is NetLogo's, explain it and fix
both with consent, or preserve and label the defect.

## 6. Determinism — ten passes, both sides

```bash
node scripts/determinism-runs.mjs --model worlds/<name>/sim-code/model.ts [--seed-param <name>] --out-dir $W
NETLOGO_HOME=tools/NetLogo node scripts/determinism-netlogo.mjs --out-dir $W \
  --model <path.nlogox> --setup "<same setup>" --metrics "<pens>" --pens "<pens>"
```

The TypeScript model, run ten times with the same seeds, must produce identical
output; the NetLogo script runs the same ten runs twice and compares the CSVs
byte for byte. If NetLogo cannot run here, say so; do not claim it passed.

## 7. Write the parity log

Copy `tools/agents/parity/PARITY-TEMPLATE.md` to
`worlds/<name>/sim-code/parity.md` and fill it: fixture dates, procedure-gate
results, the 200-run table, determinism for both sides, defects found and fixed,
hidden state machines surfaced, open items. Show it before Gate 6 closes.
