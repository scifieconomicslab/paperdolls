# Method: converting a NetLogo model to TypeScript, and the gates that verify it

Ported from `spikes/0b-agents/RESULTS.md` @ `f9a1a59` (CC BY 4.0). This is the method every NetLogo → TypeScript conversion in this project follows. The code in this folder is the worked example (Wolf Sheep Predation); a real conversion repeats the shape with the model's own procedures and pens.

Date: 2026-11-07. Reference: desktop NetLogo 7.0.4, headless, at `tools/NetLogo` (`NETLOGO_HOME`).

Paths in this document refer to this folder: `run-ts.ts`, `run-netlogo.mjs`, `compare.py`, `procedures.mjs`. `run-ts.ts` is model-generic (`--model <path.ts> [--series populations,monitor:sheep|all]`); `run-netlogo.mjs` takes `--model/--setup/--go/--metrics/--pens` (Wolf Sheep defaults); `compare.py` takes `--pens` and corrects KS alpha across pens × checkpoints (ticks 100/250/end, capped at the actual horizon).


## What was built

- **`src/agents.ts`**, the library (about 250 lines, Node 26 runs the TypeScript directly):
  - **Storage:** turtles and patches as struct-of-arrays typed columns, with slots reused after `die`.
  - **Agentsets:** breeds; `ask` (a snapshot in random order, dead agents skipped, newborns not visited); `with`, `countOf`, `oneOf`.
  - **Turtle commands:** `die` (which ends the agent's block, also from nested procedures), `hatch` (copies every variable, runs its block on the child), `fd`/`rt`/`lt`/`setxy` with NetLogo headings, a wrapping world.
  - **Spatial:** turtles-here via per-patch linked lists.
  - **Randomness:** NetLogo's ranges for `random`, `random-float`, `random-xcor` and `random-ycor`, on a seeded mulberry32 stream.
  - **Tests:** 8 unit tests of these semantics in `src/agents.test.ts`, all passing.
- **`models/wolf-sheep.ts`**: the NetLogo library's Wolf Sheep Predation, converted by hand procedure by procedure, each with its NetLogo source as a comment. It exposes its procedures by name for procedure tests.
- **`scripts/run-ts.ts`, `scripts/run-netlogo.mjs`**: N seeds × T ticks of each into the same CSV. The NetLogo side builds a BehaviorSpace experiment and runs `netlogo-headless.sh`.
- **`scripts/compare.py`**: the ensemble gate. For each plot pen and tick, it compares the means and 5–95% bands, flags runs of |z| > 3, and runs KS tests at ticks 100, 250 and 500 with a Bonferroni correction.
- **`scripts/procedures.mjs`**: procedure tests against NetLogo:
  - `grow-grass`, exact, on 6 fixture patches;
  - `move`, the distribution of heading change over 5,000 calls;
  - the wolves' turn from a fixture (a wolf and a sheep on one patch), over 2,000 repeats.

## Results

**The correct conversion passes everything.** 50 runs × 500 ticks at the default settings:

| Pen | NetLogo mean at t = 100 / 250 / 500 | TypeScript | Max abs z | KS p (100 / 250 / 500) |
|---|---|---|---|---|
| sheep | 212 / 166 / 162 | 212 / 165 / 156 | 2.30 | 0.996 / 0.508 / 0.358 |
| wolves | 56 / 73 / 77 | 54 / 74 / 77 | 3.44 | 0.954 / 0.841 / 0.678 |
| grass / 4 | 197 / 239 / 243 | 197 / 240 / 247 | 2.94 | 0.954 / 0.508 / 0.358 |

The three procedure tests pass as well.

**False alarms.** At 200 runs, one TypeScript-vs-TypeScript (A/A) comparison failed the first version of the gate (wolves, KS p = 0.003 at tick 100). That is expected when 9 tests run at α = 0.01. With a Bonferroni correction, all 4 A/A comparisons and all 5 NetLogo-vs-TypeScript comparisons pass.

**Power.** Four deliberately wrong conversions (`--mutant`):

| Mutant | What it breaks | Whole-model ensemble (50 runs) | Procedure tests |
|---|---|---|---|
| `hatch-no-fd` | newborns don't step away from their parent | **FAIL** (wolves z = 6.2 for 97 ticks; KS p = 0.004) | pass (no `hatch` test yet) |
| `grass-lt` | grass regrows one tick late (`<` for `<=`) | pass (grass z = 8.3, but only 14 ticks in a row) | **FAIL**: from brown/0, TS gives `35:-1`, NetLogo `55:30` |
| `turn-45` | `lt random 45` for `lt random 50` | pass | **FAIL**: heading change mean 2.54 against 0.15, z = 6.0 |
| `wolf-eat-first` | wolves eat before they move | pass | **FAIL**: sheep eaten 100% against 0% |

**The ensemble alone catches 1 of 4. Ensembles plus procedure tests catch 4 of 4.** Whole-model ensembles see only what changes the plotted aggregates. Three of these bugs barely do, yet each is a wrong model.

Caveat on the wolves' fixture: it was built knowing what the mutant changes. In the real gate, fixtures have to come from states recorded in NetLogo runs (or be generated per procedure), and their power has to be measured the same way.

**Speed.** Around 10,000 turtles: a 331×331 world (109,561 patches), initial numbers scaled to the area, 3 runs × 300 ticks:

| | Mean turtles after tick 50 | Time per tick |
|---|---|---|
| TypeScript (Node 26, one thread) | 10,329 | **9.8 ms** mean, 11.5 ms p95 (the `go` step only) |
| NetLogo 7.0.4 desktop, headless, one thread | 10,322 | about 40 ms (37.6 s wall for 900 ticks, including JVM start-up and per-tick metrics) |

At default size, 50 runs × 500 ticks took 13.6 s in TypeScript on one thread, and 6.7 s in NetLogo on 8 threads (39.8 s of CPU).

## What this changes in the plan

1. **Procedure tests are the main conversion gate; whole-model ensembles are the backstop.** That reverses the emphasis in plan 4.2.
2. **Every gate must correct for the number of tests it makes.** A KS test per pen per checkpoint at an uncorrected α gives false alarms.
3. **`check` should measure each pack's gate power by mutation**: inject a fixed set of small mutations (off-by-one comparisons, swapped statement order, a changed constant, a dropped command) into the converted model, and require the gates to catch them. A gate that misses its own mutants is reported, not trusted.
4. **Fixtures for random procedures come from recorded NetLogo states**, which needs a world import from NetLogo's `export-world` (Phase 3).
5. **Speed:** a converted model at 10,000 turtles steps in about 10 ms, within a frame budget, and the Session runs it in a worker anyway.

## Running it

```bash
npm install && npm test                                   # library tests
node scripts/run-ts.ts --runs 50 --ticks 500 --out results/ts.csv
NETLOGO_HOME=... node scripts/run-netlogo.mjs --runs 50 --ticks 500 --out results/netlogo.csv
python3 -I scripts/compare.py results/netlogo.csv results/ts.csv
node scripts/run-ts.ts --runs 50 --ticks 500 --mutant grass-lt --out results/ts-grass-lt.csv     # a wrong conversion
NETLOGO_HOME=... node scripts/procedures.mjs [--mutant turn-45]
node scripts/run-ts.ts --runs 3 --ticks 300 --size 165 --init-scale 42.12 --time --out results/ts-big.csv   # about 10,000 turtles
```
