# Engine state machines: states, invariants, transitions, reachable invalid states

Scope: the paperdolls engine, in three parts: the model-pack runtime layer (store, runtime adapter, worker, controller, play clock, A/B compare, inspector), the tooling and data pipeline (OSM ingest, pack build and check, dev server, intake, validators, scene binding), and the rendering engine (draw path, layer caches, sprite cache, zoom machines, picking, page state). The state machines of the Great Retrofit model that runs on it are in the Great Retrofit repository: [`docs/state-machines.md`](https://github.com/scifieconomicslab/greatretrofit/blob/main/docs/state-machines.md).

How to read each part. Every machine has an identity (name, owner `file:line`, explicit or implicit), states and the variables that encode them, invariants with the lines that should keep them, and a transition table (from, event, guard, to, side effects, `file:line`). Each reachable invalid state or transition has a status:

- **CONFIRMED**: a deterministic repro under `docs/state-machines/repro/` that was run, with its command and observed output in the text and a committed `.out.txt`.
- **SUSPECTED**: reasoned from the code; the text says what blocked a repro.
- **REFUTED**: looked possible, and the code prevents it (line given).
- **FIXED (hash)**: a confirmed finding that has a regression test failing before and passing after the fix; the transition tables and invariants in the text describe the code after the fix, and the repro now shows the held behaviour.

Line numbers refer to the commits named at the start of each part, so they drift as the code changes; re-derive them from the machine names when editing.

## Roll-up

| Part | Layer | Machines | Confirmed findings | Status | GitHub issues |
|---|---|---|---|---|---|
| 10 | Pack runtime | 9 | 10 | all FIXED | paperdolls #4, #5, #6, #7 |
| 20 | Tooling and data pipeline | 10 | 16 | all FIXED | paperdolls #8 to #13 |
| 30 | Rendering | see Part 30 | 11 (one of them, the GPU slowdown, was a performance finding with a corrected cause) | all FIXED | paperdolls #3, #14, #15, #17 to #22 |
| model | v3 model and its JavaScript runtime (other repository) | see the model document | 9 | FIXED except two decisions | greatretrofit #1 to #5 |

Still open after the fixes (none is a confirmed bug): the SUSPECTED and by-design items listed in Part 10 (R-0, P-4, I-2, B-4, and the small items in its "Still open" paragraph), the SUSPECTED items that need a real server or a kill in Part 20 (slow-trickle download without total timeout, an Overpass answer with an unrecognised `remark`, kill during a staged group write), and the open questions in Part 30 section 11. The model's two open design decisions (means test on the rebate; votes blocked by one owner who cannot pay) are issues greatretrofit #2 and #5.

Measured effect of the rendering fixes (RTX 4080 SUPER, Chromium 1243, GPU compositing and rasterisation confirmed from `SystemInfo.getInfo`, whole commune of Jette, 1440x900): far view idle / playing at 24 months a second, in frames per second: 0.8-1.1 / 0.7-1.0 before; 55-61 / 44-45 after, at DPR 1 and 2, plain and enriched scenes. Method and the full table are in `viz/README.md` and the Great Retrofit's `docs/verification/`.

## Part 10 · Pack runtime layer

Baseline of the analysis: `main` at 6b74ff7; the fixes were made on `aa2d936`. Scope: `viz/packstore.js`, `viz/packruntime.js`, `viz/packworker.js`, `viz/packhost.js` (controller, inspector, interaction), `viz/packdash.js` (A/B compare), `viz/packhost.html` (bootstrap), contract in `docs/pack-spec.md` §Runtime interface / §Dashboard.
Repros: `docs/state-machines/repro/` (harness `_harness.js`, one script per finding, `run-all.sh` runs all; its expected output after the fixes is `run-all.out.txt`). Assertions: `viz/test_pack_runtime.js` (pytest wrapper `tests/test_pack_runtime.py`).

**Status after the fixes.** All 10 confirmed findings are FIXED: #4 `f5765bd` (findings 1-3), #5 `aa30227` (findings 5, 6, 8, 9), #6 `d40e29a` (finding 4), #7 `4eadbf1` (findings 7, 10; the parts of finding 10 that live in the worker client were already done by `aa30227`). The machine descriptions and transition tables below describe the code **after** the fixes; the paragraphs and printed outputs headed "on aa2d936" are the evidence from before. Line numbers `:NN` inside findings are those of `aa2d936`. What is still open is listed in "Still open" at the end of the summary.

How the repros work: the **real** `PackWorker.createServer`, `PackRuntime.create`, `PackStore`, `PackHost.createController` and `PackDash.createCompare` run in Node. Only the thread boundary and the event loop are faked: `FakeWorker` queues messages (structured-cloned) in two arrays, and the server's "let a new request in" yield is a promise the test releases by hand (`env.yieldOne()`). No timers, no sleeps. The model is a 5-entity double whose every frame encodes the run that made it (`load[0] = rate*1000 + t`), so a test can tell from a frame which run it came from. Commands assume the repo root; the jsdom one needs `PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules`.

### Summary: confirmed bugs, most harmful first

| # | Finding | Impact | Likelihood | Repro | Status |
|---|---|---|---|---|---|
| 1 | **A/B flip leaves the inspector, the timeline readout and the hover tooltip showing the run that was on screen before the flip** (B-1) | wrong picture to a presenter: the map shows B, the selected building's numbers are A's | high: select a building, press `B` | r09 | **FIXED** `f5765bd`: the readout, the inspector and the tooltip subscribe to the compare view's `view` event; a flip clears the model rows and asks the run now on screen |
| 2 | **Inspector answers come from the worker's *current* run, not the run on screen** (I-1) | wrong picture (transient) | high | r11 | **FIXED** `f5765bd`: `ctl.shown` vs `ctl.gen`, `ctl.inspect` answers `{ stale: true }` while another run is being computed; the inspector keys answers on (entity, `store.runId()`, time) |
| 3 | **A failed B re-run is invisible** (C-2) | wrong picture, silent | medium-low | r02 | **FIXED** `f5765bd`: B's `onRun` sets and clears `cmp.error` for every run; `cmp.bOk()`/`bLabel()`, no differences listed, charts leave B out |
| 4 | **`on_params: continue` cannot work on the page** (K-1) | frozen timeline | certain for any `continue` pack (none exists yet) | r01 | **FIXED** `d40e29a`: implemented in the controller (`pull`: frames made as the clock or a scrub reaches them) |
| 5 | **No watchdog / dead-worker handling** (T-1, T-2) | hang, no message | low | r05 | **FIXED** `aa30227`: per-request watchdog, fallback or visible error, refusal after loss, rejection after `dispose()` |
| 6 | **Exceptions in the run's `onFrames` never reach the controller; a runtime that throws `''` is a success** (R-1) | silent truncated timeline | very low | r07, r13a2, r13b | **FIXED** `aa30227`: callback exceptions reject the run and cancel the server; `horizon+1` frames checked; `error !== undefined`; `pushFrames` atomic |
| 7 | **Playhead jumps back silently when the new run's frames replace the old** (P-1) | cosmetic jump | high | r03 | **FIXED** `4eadbf1`: the clock holds while a re-run catches up, so there is no jump; any remaining clamp emits `time` |
| 8 | **Play sticks on a truncated timeline** (P-2) | cosmetic | low | r04 | **FIXED** `aa30227` |
| 9 | **A `setParams` that throws does not cancel the run in flight** (S-1) | wasted CPU | low | r08 | **FIXED** `aa30227` |
| 10 | Small: stale `ctl.mode` (T-5); second `error` builds a second inline runtime (T-4); Blob URL leaked when `new Worker` throws (T-3); double `revokeObjectURL`; compare-off leaves B running (B-3); unsubscribe-during-emit; nested-emit order (F-2); off-step preset never "active" (F-3); scrub beyond computed frames lost (P-3); fallback drops `impl` (T-6); `PackRuntime.step(0)` throws (SM-13) | cosmetic / leak | low | r06, r05b, r13c, r13d, r13e, r10 | **FIXED** `aa30227` (T-3, T-4, T-5, T-6, double revoke) and `4eadbf1` (B-3, F-2, F-3, P-3, SM-13) |

**Still open** (nothing here is a confirmed bug; all of it was SUSPECTED or by design in the analysis and was not asked for): R-0 the adapter's `t` falls behind the model after a `step` whose frame k of n is invalid; I-2 the inspector's rejection path has no staleness check; P-4 the async `rerun` clock drops the fractional step while it waits; B-4 flipping to B before B has frames shows the "no data" map; the validator still accepts a preset value off the parameter step (the store now handles it, the validator is shared with `paperdolls/pack.py`, not touched here); `packhost.html` is **not exercised in a real browser** by any of this: the fixes are checked against the real modules in Node with a faked thread boundary and in jsdom, not against a real Worker, real timers or a real canvas.

REFUTED (code prevents it, evidence in §5, still true after the fixes): older run's chunks applied after a newer `setParams` (r12 passes unchanged); selection of an entity that disappears; a run completing under a paused or scrubbing playhead; messages reordered or duplicated; subscribers that throw; snapshot/restore/step racing a run (never called by the shell); cross-talk between A's and B's worker (B-5).

---

### 1 · Machines at a glance

| id | machine | kind | owner | variables |
|---|---|---|---|---|
| S | Worker-side request server | implicit | `viz/packworker.js:26-64` | `rt` (null or adapter), `epoch`, the suspended `run()` loop |
| R | Runtime adapter | implicit | `viz/packruntime.js:146-192` | `handle` (null/non-null), `t`, `params`, `policy` |
| T | Client / transport | explicit `mode`, implicit rest | `viz/packworker.js:87-136`, transports `:69-84` | `a.mode` ('worker'\|'inline'), option `mode` ('auto'\|'worker'\|'inline'), `ready`, `tr`, `pending`, `a.fellBack`, `init` promise |
| C | Run controller | implicit | `viz/packhost.js:80-149` | `ctl.gen`, `ctl.dirty`, `ctl.running`, `ctl.error`, `ctl.runs`, per-stream `held`/`replaced` |
| P | Play clock and time | explicit `time.playing`, implicit `acc` | `viz/packhost.js:133-144`, `viz/packstore.js:95-102` | `time.playing`, `time.t`, `time.speed`, `ctl.acc` |
| F | Store frames / versions / bound view | implicit | `viz/packstore.js:24-35,112-190` | `frames`, `gen`, `data`, `shown`, `bind.*.synced/syncT/syncGen` |
| I | Inspector request loop | implicit | `viz/packhost.js:486-520` | `busy`, `again`, `shown`, selection, time |
| B | A/B compare | implicit | `viz/packdash.js:32-123` | `enabled`, `showing`, `ctlB`, `runtimeB`, `bSource`, `error`, `flips` |
| Z | Page bootstrap | implicit | `viz/packhost.html:186-277` | order of construction, `labPack`, rAF loop |

The shell runs exactly this flow per slider event: `store.setParam` → `emit('params')` → `ctl.dirty = true` + `schedule()` (a 0 ms timer; also every animation frame calls `ctl.flush()`, `viz/packhost.html:262`) → `rerun()` → worker `setParams` (restarts) → `run` streamed in chunks of 16 → `put()` → `store.pushFrames` → `emit('frames')`.

---

### 2 · Machine S: worker-side request server (`createServer`)

**States** (implicit):
- `S0 Empty`: `rt === null`; only `init` is legal. Any other op throws `TypeError` on `rt.…` (caught at `:61`, reported as an error reply).
- `S1 Idle`: `rt` set, no `run` loop alive. `rt.t` is the end of the last run (or 0).
- `S2 Running(mine)`: a `run()` call is suspended at `await opts.yieldFn()` (`:50`); `epoch === mine` while it is current.
- `S3 Cancelled-pending`: a `run()` is suspended but `epoch !== mine`; it will reply `done+cancelled` at its next resume (`:51`) and exit.
- Impossible by design: two `run()` loops both current (each `run` takes `++epoch`, so at most one equals it).

**Invariants**
- S-I1: after `start`, `setParams`(restart) or `cancel` is **received**, no earlier `run` can compute another chunk. Maintained by `epoch++` (done before the op runs, so a failing `start`/`setParams` cancels too) and the check after each yield. Holds for failing ops since `aa30227` (was: only for successful ones, S-1).
- S-I4: an error reply always carries a non-empty message (`why(e)`), because the client tests `m.error !== undefined`.
- S-I2: replies for one request id are `partial*` then exactly one of `{done}`, `{error}`, or a plain result (`:46-53,58,60`).
- S-I3: `run` never advances `rt` past `rt.horizon` (`:46,47`).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| S0 | `init` | impl registered | S1 | builds adapter `rt`; replies `{policy,horizon,entities,canInspect,canSnapshot}` | `:31-36` |
| S0 | `init` | no impl | S0 | error reply | `:32-33` |
| S1/S2 | `start` | any | S1 (S2→S3) | `epoch++`; `rt.start` re-inits; replies frame 0 | `:37` |
| S1/S2 | `setParams` | policy rerun, succeeds | S1 (S2→S3) | `epoch++` first, then `rt.start` | `packworker.js` `ops.setParams` |
| S1/S2 | `setParams` | policy rerun, **throws** | S1 (S2→S3) | error reply; the epoch was bumped first, so the run in flight stops at its next yield (S-1 FIXED `aa30227`) | same |
| S1/S2 | `setParams` | policy continue | unchanged | params swapped in place, run continues | `:38`, `packruntime.js:173-176` |
| S1 | `run(toT)` | `rt.t < toT` | S2 | `mine=++epoch`; computes chunk, replies `partial`, awaits yield | `:45-50` |
| S1 | `run(toT)` | `rt.t >= toT` | S1 | immediate `done` | `:53` |
| S2 | yield resumes | `epoch===mine`, `rt.t<toT` | S2 | next chunk | `:47-50` |
| S2 | yield resumes | `epoch===mine`, `rt.t>=toT` | S1 | `done` | `:53` |
| S2/S3 | yield resumes | `epoch!==mine` | S1 | `done,cancelled` | `:51` |
| S1/S2 | `cancel` | | S1 (S2→S3) | `epoch++` | `:43` |
| S1/S2 | `inspect` / `snapshot` / `restore` / `step` | | unchanged | answered from the **current** handle, mid-run included; `restore`/`step` move `rt.t` under a live `run` | `:39-42` |
| any | second `run` while S2 | | S2 (new), old → S3 | second run continues from `rt.t`, **no restart** | `:46` |

**Reachable invalid states / transitions**
- **S-1 · failed `setParams` leaves the old run alive.** Status **FIXED `aa30227`** (was CONFIRMED, r08). Impact: wasted CPU; client drops the chunks (`ctl.gen`), store keeps the truncated old-run frames, banner says the model failed. Likelihood: a model rejecting a parameter set, then no further slider move.
  Cause: `epoch++` was after `rt.setParams` returned (`:38`); `PackRuntime.setParams`→`start` assigned `params` before `impl.init` could throw (`packruntime.js:166-167`), so on failure the adapter also held *new* params with the *old* handle.
  **FIXED `aa30227`**: `epoch++` before the call (rerun policy only; `continue` keeps its run); `PackRuntime.start` replaces `params`, `seed` and `handle` only after `init` succeeded. Tests: `#5 r08` (two cases).
```
$ node docs/state-machines/repro/r08-failed-setparams-does-not-cancel-run.js     # on aa2d936
setParams failed: ctl.error="runtime repro: model refuses rate 0.95" frames=9 pending yields=1
after releasing the server: 4 more partial chunks sent by the old run, model steps 8 -> 40 (horizon 40); store still 9 frames of rate 500
```
After the fix: `after releasing the server: 0 more partial chunks sent by the old run, model steps 8 -> 8 (horizon 40); store still 9 frames of rate 500`.
- **S-2 · `inspect`/`snapshot`/`restore`/`step` mid-run use the live handle** → see I-1 (inspect, was **CONFIRMED** r11, FIXED `f5765bd`: the controller withholds the answer). `restore`/`step`/`snapshot` are never sent by the shell (grep of `viz/packhost.js`, `viz/packdash.js`, `viz/packhost.html`: only `ctl.ensure` calls `runtime.step`, and only when `!isAsync`, `packhost.js:132`); status **REFUTED as unreachable from the UI** (but `continue` now calls `runtime.step` from the controller, always as the only request in flight and always at `t = frames made`, see §5 `pull`), a hazard only for a future caller (a `restore` mid-run would make the next chunk's `t` start at `snap.t+1` and trip `pushFrames` order).
- **S-3 · a second `run` without a restart continues from `rt.t`.** **REFUTED** for the shell: the controller always sends `start`/`setParams` first (`packhost.js:101,120`) and FIFO order guarantees they are handled before the `run` they precede.

---

### 3 · Machine R: runtime adapter (`PackRuntime.create`)

**States:** `R0 Unstarted` (`handle === null`, `t=0`) → `R1 Running(t)` (`handle` set). `step`/`run` throw `'start() first'` in R0 (`:177,179`). `inspect` returns `null` in R0 (`:186`).
**Invariants:** R-I1 each returned frame has `t === previous t + 1` (`take(..., t+1)` `:157,177,181`, only when `opts.validate`, default true `:147`); R-I2 `t <= horizon` (`:180`; `step` has **no** horizon guard, `:177`).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| any | `start(p,s)` | `init` ok, frame 0 valid | R1(0) | `params`, `seed`, `handle` replaced together after `init` returned, `t=0` | `packruntime.js` `start` |
| any | `start` | `init` throws | unchanged | nothing is replaced (FIXED `aa30227`; was: new params with the old handle) | same → S-1 |
| any | `start` | frame 0 invalid | R1(0) with an invalid frame withheld | `handle`, `t=0` set, error thrown | `:167-168` |
| R1 | `setParams(p)` | policy rerun | R1(0) | `start(p)` | `:172` |
| R1 | `setParams(p)` | policy continue | R1(t) | `impl.setParams`, handle maybe replaced | `:173-176` |
| R1 | `step(n)` | `n > 0` | R1(t+len) | `t += frames.length` **after** validation, so a throwing step leaves `t` behind the impl's own state | `:177` |
| R1 | `step(0)` | | R1(t) | returns `[the current frame]` (checked as frame `t`), does not advance (SM-13, FIXED `4eadbf1`; was: threw `t is N, expected N+1`) | `step` |
| R1 | `run(toT)` | `toT>t` | R1(t+len) | uses `impl.run` or `step` | `:178-183` |
| R1 | `restore(snap)` | | R1(snap.t) | | `:189` |

Reachable invalid: if `impl.step` advances then `take` throws (invalid frame k of n), `t` is not advanced although the impl's handle is (`:177`, `:181`). The adapter and the model disagree on the time from then on; every later frame fails `t is X, expected Y`. **SUSPECTED**, not reachable with a valid runtime; the shell recovers on the next `start` (a parameter change). **Still open** (R-0), not touched by the fixes.

---

### 4 · Machine T: client / transport (`PackWorker.create`)

**States.** Option `mode` (explicit): `'auto' | 'worker' | 'inline'`. Resulting `a.mode` (explicit): `'worker' | 'inline'`. Implicit lifecycle:
- `T0 Opening` (inside `open()`, synchronous).
- `T1 WorkerBooting`: `a.mode='worker'`, `ready=false`, `init` pending.
- `T2 WorkerReady`: `ready=true` (set in the `init.then`, `:120`).
- `T3 InlineBooting` / `T4 InlineReady`: same on `inlineTransport`; reached directly (`mode:'inline'`, no Worker, `new Worker` threw) or by fallback from T1.
- `T5 Lost`: the transport reported an error or did not answer within `timeoutMs` (default 20 s, restarted by every chunk of a run). Reached from T1/T2/T4. In `auto` mode from a worker it goes on to T3/T4 (below); otherwise it is a stable state: `lost = err`, every later `call` is rejected with it at once (before `aa30227`: **T5 Dead-undetected**, every request pended forever, T-1).
- `T6 Disposed`: `disposed = true` (`dispose()`), `tr.terminate()` called, `pending` rejected with `'disposed'`, every later `call` rejected with `'disposed'`, timers cleared (before `aa30227`: not modelled, later calls hung, T-2).
- `T7 Reinitialising`: a worker that **had** answered was lost in `auto` mode: the worker is terminated, an inline transport is attached, `ready = false`, the requests in flight are rejected with `recoverable: true`, and a fresh `init` is sent. The controller repeats its run once (§5).
- Impossible by design: `ready` true while `tr` is a worker that was terminated by the fallback (a fallback sets `ready = false` or happens before `ready`).

**Invariants:** T-I1 every `call` adds exactly one `pending` entry (with one watchdog timer) and every terminal reply/`error`/loss/`dispose` removes both; T-I2 there is one live transport (`tr`), the fallback terminates the old before attaching the new, and events of a transport that is no longer `tr` are ignored (`t !== tr`); T-I3 `a.mode` equals `tr.mode`, and `ctl.mode` reads it live; T-I4 a Blob URL is revoked exactly once, also when `new Worker` throws; T-I5 after `dispose()` or loss no timer is pending and no message is posted to the lost transport; T-I6 a request never waits longer than `timeoutMs` for the next message of its own.

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| T0 | `open()` | mode≠inline, Worker/Blob/URL present, `new Worker` ok | T1 | `createObjectURL(Blob)`; worker booted; `init` call sent | `:107-109,74-83,120` |
| T0 | `open()` | no Worker/Blob/URL.createObjectURL | T3 (auto) / throws (worker) | `a.fellBack = reason` | `:75-76,109-111` |
| T0 | `open()` | `createObjectURL` ok, `new Worker` throws | T3 (auto) | URL revoked, then the error is handled as above (T-3 FIXED `aa30227`) | `workerTransport` |
| T1 | `init` reply | | T2 | `ready`, info copied | `sendInit` |
| T1 | worker `error` event or watchdog timeout | `mode==='auto'`, `!ready` | T3 | `terminate()` (revokes URL once), inline transport attached, **all pending resent** (`init` only), timers re-armed | `lose` |
| T1 | worker `error` event or watchdog timeout | `mode==='worker'` | T5 | `lost = err`, transport terminated, pending rejected; no fallback | `lose` |
| T1 | **second** worker `error` event | before inline `init` answered | T3 | ignored: `t !== tr` (T-4 FIXED `aa30227`) | `lose` |
| T2 | worker `error` event or watchdog timeout | `mode==='auto'` | T7 | see above; the rejection carries `recoverable: true` | `lose` |
| T2 | worker `error` event or watchdog timeout | `mode==='worker'`, or the transport is inline | T5 | `lost = err`; pending rejected; later requests refused with `lost` (T-1 FIXED `aa30227`) | `lose` |
| T7 | inline `init` reply | | T4 | `ready` | `sendInit` |
| T1/T2/T4/T5 | `dispose()` | | T6 | pending rejected `'disposed'`; `terminate()` once; second call is a no-op | `dispose` |
| T6 | any `call` | | T6 | rejected `'disposed'` at once (T-2 FIXED `aa30227`) | `call` |
| T5 | any `call` | | T5 | rejected with `lost` at once | `call` |
| any | reply with `m.error !== undefined` | | | request rejected (a truthy test mistook `''` for success, R-1) | `receive` |
| any | reply for unknown id | | | ignored | `:95` |
| any | `partial` | pending exists | | watchdog re-armed; `onFrames(m.partial)` called inside `receive` in a `try`: an exception rejects the run's promise, drops the request and posts `cancel` to the server (R-1 FIXED `aa30227`; was: escaped the message handler) | `receive` |

**Reachable invalid states**
- **T-1 · silent or dead worker is never detected.** Status **FIXED `aa30227`** (was CONFIRMED, r05 a, c). Tests: `#5 r05a` (silent init: fallback in `auto`, visible error in `worker` mode), `#5 r05c` (silent crash; error then crash; `worker` mode refuses later requests). `ctl.running` stays true, `ctl.error` stays null, no banner (`packhost.html:251-252` only reports `ctl.error`). A worker that errors *after* `ready` rejects what is in flight, but `tr` keeps pointing at it. Impact: hang with no message; recovery only by reload. Likelihood: low in practice (a worker that dies without an `error` event, e.g. OOM kill, or a blob worker silently blocked by CSP); the fallback only covers errors *before the first answer*.
```
$ node docs/state-machines/repro/r05-silent-worker-dispose.js
(a) silent init: start() is pending, ctl.running=true, ctl.error=null, frames=0
    after a slider move: running=true error=null gen=2 (a new request is queued behind the dead init; still nothing)
(b) after dispose() x2: URL.revoked=["blob:fake/1","blob:fake/1"] (revoked twice), start() is pending
(c) worker died mid-run: ctl.error="worker out of memory" running=false
    next slider move: running=true error="worker out of memory" frames=9 (posted to the dead worker; the runtime never switches to inline)
```
- **T-2 · requests after `dispose()` hang.** **FIXED `aa30227`** (was CONFIRMED, r05 b, printed above; test `#5 r05b`): `start()` is `pending`, not rejected; `revokeObjectURL` runs twice for the same URL (harmless). The page never calls `dispose` (grep: no caller outside tests), so this is latent.
- **T-3 · Blob URL leaks when `new Worker` throws.** **FIXED `aa30227`** (was CONFIRMED, r06 c; test `#7 r06c`): `URL.created=1 URL.revoked=[]`. Impact: leak of one URL per attempt (≤2 per page: A and B).
- **T-4 · second `error` event builds a second inline runtime.** **FIXED `aa30227`** (was CONFIRMED, r06 b; test `#7 r06b`): `PackRuntime.create called 2 times`, and the URL is revoked twice. Real browsers fire one `error` for a failed load, so likelihood is very low. Impact: duplicated init work.
- **T-5 · `ctl.mode` is a stale copy.** **FIXED `aa30227`** (was CONFIRMED, r06 a; test `#7 r06a`): after fallback `rt.mode=inline`, `ctl.mode=worker` (`packhost.js:82` copied it once); `ctl.mode` is now a getter. Nothing reads `ctl.mode` in the shipped code (grep), so cosmetic; any future "worker" badge would lie.
```
$ node docs/state-machines/repro/r06-fallback-paths.js
(a) before the error: rt.mode=worker ctl.mode=worker
    after: rt.mode=inline ctl.mode=worker fellBack="SyntaxError in worker script" frames=41 revoked=["blob:fake/1"] log=["terminate blob:fake/1"]
(b) two error events before init is answered: PackRuntime.create called 2 times (expected 1); revoked=["blob:fake/1","blob:fake/1"]; mode=inline
(c) new Worker() throws: URL.created=1 URL.revoked=[] mode=inline fellBack="Worker construction blocked"
```
- **T-6 · the fallback drops `o.impl`** (`:103` built `inlineTransport(o.server)` while `open()` added `impl` at `:111`). **FIXED `aa30227`** (one `inlineOpts()` for both; test `#7 r06: the fallback ... keeps the runtime that was passed in`). Was **SUSPECTED**, test-only: the page registers the runtime in `PaperDolls.runtimes`, which the inline server falls back to (`:32`); a caller that passes `impl` without registering it would see `the runtime did not register itself` after a fallback. Not repro'd because no shipped caller does this.
- **T-7 · message loss, duplication or reordering.** `postMessage` is ordered and exactly-once; the inline transport preserves order because each reply is `Promise.resolve().then` in call order (`:71`). Duplicated terminal replies are ignored (`:95`). A **duplicated partial** is rejected by `pushFrames` order check (r07 style, harmless: the next chunk still fits). A **dropped partial** is R-1. Status **REFUTED for duplicates and reordering**, **CONFIRMED consequence under injected loss** (r07).
- **R-1 · exceptions in `onFrames` do not reach the run.** **FIXED `aa30227`** (was CONFIRMED under injected loss, r07; tests `#5 r07` ×3, `#5 r13a2`): the callback runs in a `try` in `receive`, the controller counts the frames it was given and fails a run that delivered other than `horizon+1`; the evidence on `aa2d936`: the dropped-chunk fault is only the trigger, the cause is `receive` calling `p.onFrames` outside any `try` and outside the request's promise (`:97`), and `put()` calling `store.pushFrames` which throws on any order/patch error (`packstore.js:143-144`). The controller cannot count it as a failure. Related: `reply(id, {error: ''})` is falsy at `:96`, so a runtime that **throws the empty string** is resolved as a success (**CONFIRMED**, r13 a2; `throw new Error('')` is *not* affected, r13 a1: it reports `Error`). Impact: silent truncated timeline (the page says nothing, `ctl.runs` increments). Likelihood: very low (needs a lost message or `throw ''`).
```
$ node docs/state-machines/repro/r07-dropped-chunk-silent-truncation.js     # on aa2d936
dropped 1 partial message; frames in store=17 of 41 ctl.error=null ctl.running=false ctl.runs=1
exceptions thrown out of the message handler (uncaught in a browser): ["frame t=25 out of order: expected 17","frame t=33 out of order: expected 17"]
Play: playing=true t=16
```
```
$ node docs/state-machines/repro/r13-store-and-small-cases.js      # (a1) (a2) (b), on aa2d936; after the fixes see run-all.out.txt
(a1) runtime threw new Error(""): ctl.error="runtime repro: Error" frames=0 -> reported (REFUTED: message becomes "Error")
(a2) runtime threw the empty string: ctl.error=null frames=1 ctl.runs=1 (error "" is falsy, so the client takes the failure for a success)
(b) pushFrames threw "frame t=5 out of order: expected 2": length=2 (was 3), events=[], time.t=2, frame() is null, bound load[0]=2 (stale value from the replaced run: 2)
(c) compare off: B worker dead=false, B re-ran anyway after enable(false): 1 run(s)
(d) validator ok=true (errors: []); after applyPreset("odd") rate=0.2 isPreset("odd")=false
(e) setTime(30) while 9 frames exist: t=8; after the run completed (41 frames) t=8
```

---

### 5 · Machine C: run controller (`createController`)

**Variables:** `ctl.gen` (monotonic run id), `ctl.shown` (the `gen` of the run whose frames are in the store), `ctl.dirty` (a parameter moved since the last flush), `ctl.running`, `ctl.holding` (a re-run has not yet replaced the old frames: the clock stands still), `ctl.pulling` (a `continue` step request is in flight), `ctl.error`, `ctl.notice` (the worker was replaced by the main thread), `ctl.runs`, `ctl.runParams`/`ctl.shownParams` (the parameters of the latest run / of the run on screen), `ctl.disposed`; per stream (closure of `stream()`): `held`, `replaced`, `got` (frames delivered); `want` (the time on screen when the run began; the replace waits for `max(want, time on screen now)`).

**States** (derived):
- `C0 Fresh`: `gen=0`, store empty.
- `C1 Idle-clean`: `!running`, `!dirty`, store holds a complete (or failed-partial) run for the current params.
- `C2 Dirty`: `dirty` (a param moved), run (if any) still computing the old params.
- `C3 Running(gen)`: `running`, `gen` current. Sub-states: `Awaiting-setParams`, `Holding` (`!replaced`, store still shows the **previous** run), `Streaming` (`replaced`, store shows the new run, growing).
- `C4 Superseded`: a stream whose `gen !== ctl.gen`: all of its results are dropped (`:90,102,106,121`).
- `C5 Failed`: `ctl.error` set, `!running`; store holds whatever frames had arrived (`shown !== gen` when the failed run never replaced the frames: `ctl.inspect` then withholds the model's answer, see I).
- `C6 Pulling` (policy `continue`): no run; `pulling` while one `step` request is in flight; `ctl.gen` is **not** bumped by a parameter change.
- `C7 Disposed`: `ctl.dispose()` was called: `gen` bumped (every answer dropped), subscription removed, runtime disposed, `flush` returns false.
- Impossible by design: two current streams.

**Invariants**
- C-I1 only the latest `gen` writes the store (`put` `:90`; `rerun` `:102,106`; `start` `:120-121`). Holds, see §REFUTED-1.
- C-I2 a parameter change is never lost: `dirty` is set before `schedule`/`flush` (`:129`), and cleared only when `rerun` reads `store.params()` after (`:130,101`). Holds.
- C-I3 `ctl.running` is true iff the latest gen has not finished. Holds since `aa30227`: a run that never gets an answer is failed by the watchdog (T), and `onRun` exceptions are caught in `finish` (C-4).
- C-I5 a run that is not cancelled has delivered exactly `horizon+1` frames, else it **failed** (`the run delivered N of M frames`).
- C-I6 while `holding`, the clock does not advance; the old frames are replaced only when the new run has reached the time on screen, so the replace never moves the playhead.
- C-I7 `inspect` answers only for the run on screen: `shown === gen`, or no run in flight and no error (I).
- C-I4 the frames on screen belong to one run. During `Holding` they belong to the **previous** one by design (comment `:77-79`); the controller does not expose which, so readers cannot tell (this is what I-1 and P-1 stumble on).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| C0/C1 | `start(want)` | async | C3 | `gen++`, `running`, `holding` (if frames exist), `runtime.start`, then `stream(gen,f0,want)` (rerun) or `pushFrames([f0])` + `shown=gen` (continue) | `start` |
| C0/C1/C3 | store `params` event | | C2 | `dirty=true`; `schedule()` or `flush()` if `immediate` | `offParams` |
| C2 | `flush()` | `dirty`, rerun | C3 | `dirty=false`; `gen++`; `holding`; `want=time.t`; `runtime.setParams(store.params())` | `rerun` |
| C2 | `flush()` | `dirty`, **continue** | C6 | `dirty=false`; **no** `gen++`; `runtime.setParams`; on success `error=null`, `finish`, pull more if asked | `rerun` |
| C3 | setParams reply | `gen` current, `restarted` | C3 Holding | `stream(gen,res.frame,want)` | `rerun` |
| C3 | setParams reply | `gen` stale | C4 | ignored | `rerun` |
| C3 Holding | partial chunk | `gen` current, `held.length ≤ max(want, t)` | Holding | `got += n`, `held += chunk` | `put` |
| C3 Holding | partial chunk | `held.length > max(want, t)` | Streaming | `pushFrames(held,{replace:true})`; `shown=gen`; `holding=false`; the playhead is already inside the new frames | `put` |
| C3 Streaming | partial chunk | | Streaming | `pushFrames(chunk)` (extend) | `put` |
| C3 | run resolves, not cancelled | `gen` current, `got === horizon+1` | C1 | `put([],true)` replaces if still Holding; `ctl.error=null`; `finish` | `stream` |
| C3 | run resolves, not cancelled | `gen` current, `got !== horizon+1` | C5 | throws `the run delivered N of M frames` → `failed` | `stream` |
| C3 | run resolves cancelled | | C4 | `put` skipped; the newer gen finishes | `stream` |
| C3 | `onFrames` throws (e.g. `pushFrames` refuses a chunk) | | C5 | the transport rejects the run's promise and cancels the server → `failed` (R-1 FIXED) | `receive` |
| C3 | any request rejects | `gen` current, `e.recoverable`, first time | C3 | `ctl.notice` set; `ctl.start(time.t)` on the main thread | `failed` |
| C3 | any request rejects | `gen` current, otherwise | C5 | `fail(e)` (`ctl.error`, `console.error`), `finish` (stops Play if the timeline ended) | `failed` |
| C6 | clock/scrub wants frame `t` | `length ≤ t ≤ horizon`, `!pulling`, `!error` | C6 | `pulling=true`; `runtime.step(t-length+1)`; on answer `pushFrames`; the answer is dropped if `gen` changed | `pull` |
| C6 | `step` rejects | | C5 | `fail(e)`; Play stopped; no retry until a parameter change succeeds | `pull` |
| any | `dispose()` | | C7 | see C7 | `dispose` |
| any | `flush()` | `!dirty` or disposed | | returns false | `flush` |
| any | `flush()` | `!dirty` | | returns false | `:130` |

**Reachable invalid states / transitions**
- **K-1 · `continue` policy has no way to get past frame 0 on the page.** **FIXED `d40e29a`** (was CONFIRMED, r01; 4 tests `#6 r01`; chosen over rejecting the key in the spec because the validators are shared with `paperdolls/pack.py` and the synchronous adapter and server already supported it). On `aa2d936`: The async `start` pushes only frame 0 for non-rerun (`:120`), `rerun` pushes nothing for `restarted:false` (`:104`), `ensure` is disabled for async (`:132`), and `advance` waits for frames that nothing requests (`:140`). The spec promises "frames are made only as the clock reaches them" (`docs/pack-spec.md:63`) and the validator accepts the value (`packvalidate.js:77`). Impact: frozen timeline, Play does nothing, slider moves have no visible effect. Likelihood: any pack declaring `continue` (none exists today).
```
$ node docs/state-machines/repro/r01-continue-policy-async.js     # on aa2d936
policy=continue frames after start+drain: 1 (horizon 40)
after 100 clock ticks: t=0 playing=true time events=[playing]
after a slider move: frames=1 frame0 load=500 (rate 0.5 -> 500, 0.8 -> 800)
model steps executed by the server: 0
```
After the fix, with the repro interleaving the model's answers between clock ticks (`run-all.out.txt`): `t=19 frames=21` after 100 ticks, frames made after the slider move carry the new rate (`822`), frames made before keep the old (`519`), `model starts: 1`, one `step` per frame made.
- **C-2 · B's failures are not surfaced** — **FIXED `f5765bd`**, see machine B: (compare controller `ctlB` has no `onRun`; `cmp.error` is set only after the first `start`, `packdash.js:86`, and never cleared) → machine B.
- **I-1 · see machine I.**
- **C-3 · stale frames under new parameters after a failed re-run.** The old frames stay on screen with the new slider values; a banner appears via `ctl.onRun` (`packhost.html:251`). Status: by design, **REFUTED as unnoticed** for A; for B it was unnoticed (C-2) and is now reported.
- **C-4 · `ctl.running` after `onRun` throws.** **FIXED `aa30227`** by catching it in `finish` (no dedicated test: the change is one `try`). Was: `finish` sets `running=false` before calling `onRun` (`:85`); an exception then becomes an unhandled rejection of the `.then` (`:106`). **SUSPECTED**, cosmetic, not repro'd (the page's `onRun` cannot throw).
- **C-5 · `want` is read once** (`:100`), so a user who keeps playing past it produced P-1. **FIXED `4eadbf1`**: the clock holds while the run catches up, and the replace waits for `max(want, time on screen now)`. See machine P.

#### REFUTED-1 · results of an older run arriving after a newer `setParams`
The server-side cancel is cooperative (chunk-level), so chunks of run 2 **are** in flight when run 3 starts. They are dropped by `if (gen !== ctl.gen) return` (`packhost.js:90`); `setParams` replies are dropped at `:102`. r12 delivers a chunk from the previous run after the client moved on and checks that every frame in the final store belongs to the newest run, and that `t` was not moved by the run completing under a scrubbing playhead.
```
$ node docs/state-machines/repro/r12-stale-chunks-are-dropped.js
chunks in flight when run 3 started: 1; frames now 41; distinct runs among frames: [0.9]; t=3 (never moved by the run completing)
```

#### Other concurrency candidates
| candidate | status | why |
|---|---|---|
| slider burst coalescing | REFUTED | `dirty` + one `flush` per frame (`packhost.js:129-130`, `packhost.html:262`); `rerun` reads the latest params |
| `start()` and a `rerun()` racing at boot | REFUTED | both bump `gen`; the loser's results are dropped (`:120-121`, `:102`); server handles `start` then `setParams` in order |
| run completes while paused or scrubbing | REFUTED | `pushFrames` extends only; `t` untouched unless beyond the end (`packstore.js:148-149`), r12 |
| reset during play | benign | `resetParams` is one `params` event (`packstore.js:81`) → same path as a slider move; the clock holds until the new run has caught up (P-1 FIXED) |
| run while `immediate` + sync adapter | REFUTED for the page | the page uses the async adapter and `schedule`; with `immediate` the whole run is inside the emit (`:129`), later `params` subscribers see new frames, harmless |

---

### 6 · Machine P: play clock and time (`advance`, `setTime`, `togglePlay`)

**Variables:** `time.playing` (explicit boolean), `time.t`, `time.speed`, `ctl.acc` (fractional steps).
**States:** `P0 Paused`, `P1 Playing`, `P2 Playing-waiting` (playing, `next >= store.length()`, async: the clock waits for frames; for `continue` it asks the model for the frame, otherwise it ends Play when no run is in flight), `P3 Playing-at-end` (`next > horizon` → paused), `P4 Playing-held` (playing while `ctl.holding`: the clock stands still until the re-run has caught up with the time on screen).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| P0 | `togglePlay` | | P1 | if `t>=horizon` first `setTime(0)`; `setPlaying(true)` | `togglePlay` |
| P1 | rAF `advance(dt)` | `ctl.holding` | P4 | `acc=0`, nothing else | `advance` |
| P4 | the re-run replaces the frames | `held.length > max(want, t)` | P1 | `holding=false`; `t` is inside the new frames, no `time` event needed | `put` |
| P1 | rAF `advance(dt)` | `acc>=1`, frame exists | P1 | `acc-=1`; `setTime(t+1)` (emit `time`) | `advance` |
| P1 | `advance` | `next >= store.length()`, rerun, `running` | P2 | `acc=0` (**drops the fraction**, P-4 still open) | `advance` |
| P2 | `advance` | rerun, `!running` (failed or cut off) | P0 | `setPlaying(false)` (P-2 FIXED) | `advance`, `finish` |
| P1 | `advance` | `next >= store.length()`, continue, no error | P2 | `acc=min(acc+1,2)` (the owed step is kept); `ensure(next)` → `pull` | `advance` |
| P2 | `advance` | continue, `ctl.error` | P0 | `acc=0`; `setPlaying(false)` | `advance` |
| P1 | `advance` | `next > horizon` | P0 | `setPlaying(false)`, `acc=0` | `advance` |
| P1/P2 | slider `oninput`, arrow keys, chart pick | | P0 | `setPlaying(false)`; `ensure(t)` (continue: `pull`); `setTime` (clamped to the frames held; **the wish is remembered**, P-3) | `packhost.js`, `packdash.js` |
| P0/P1 | `setSpeed(s)` | `s>0` | same | `time` event `speed` | `packstore.js` |
| any | `pushFrames` | `t` beyond the new last frame | same | `t` clamped, the place kept as `goal`, **`time` event emitted**; the playhead returns to the goal when frames arrive | `packstore.js` |
| any | `pushFrames` | `goal` set, frames now reach it | same | `t` moves to `min(goal, last)`; `time` event | `packstore.js` |
| any | `setTime(t)` | `t` beyond the last frame | same | `t` = last frame, `goal = t asked`; any later `setTime` replaces the goal | `packstore.js` |

Invariant P-I1 `0 <= t <= frames.length-1` once frames exist (`setTime`, the clamp in `pushFrames`). Holds, but `setTime` with an **empty** store allows `t` up to `horizon`, so `t` can exceed the frames until the first push (which then clamps it and announces it). P-I2 the playhead never moves without a `time` event.

**Reachable invalid / surprising**
- **P-1 · playhead jump back when a re-run's frames replace the old ones.** **FIXED `4eadbf1`** (was CONFIRMED, r03; tests `#7 r03` ×2). The fix is not to play on over the old frames while the new run catches up (P4), plus an announced clamp as a net. On `aa2d936`: With Play on and `t=30`, a slider move starts a run with `want=30`; the old 41 frames stay on screen and the clock plays them on to `t=38` (past `want`); the replace happens once 31+ frames have arrived and `pushFrames` clamps `t` to the new length: `t` goes 38 → 32, the picture switches runs, and **no `time` event** is emitted (only `frames`). Dependents that listen only to `time` (chart cursors, B follow) catch up through the `frames`/`series` events. Impact: visible jump, cosmetic. Likelihood: high (Play + slider).
```
$ node docs/state-machines/repro/r03-playhead-jump-on-replace.js     # on aa2d936
run in flight: store holds 41 frames, load at t=30 is 530 (old run, rate 0.5)
clock ran on: t=38 (old frames, load 538)
after replace: t=32 (was 38), frames=33, load at t is 832 (new run, rate 0.8)
time events during the jump: []  frames events: [replace:33]
```
After the fix: `clock after 8 ticks while the new run catches up: t=30 (held; old frames, load 530)`, `after replace: t=30 (was 30) ... load at t is 830`.
- **P-2 · play sticks on a truncated timeline.** **FIXED `aa30227`** (was CONFIRMED, r04; tests `#5 r04` ×2: stops after a failed run and after a lost chunk, and keeps waiting while a run is still coming). On `aa2d936`: After a run that fails at step 20, 17 frames remain; Play reaches `t=16` and stays there with `playing=true` (P2 never leaves: nothing will produce frame 17). A banner is shown for the failure, but the Pause button state is wrong, and the same happens after R-1 with no banner.
```
$ node docs/state-machines/repro/r04-play-stalls-after-failed-run.js     # on aa2d936
run finished: ctl.error="runtime repro: model exploded at step 20" running=false frames=17 of 41
after 20 s of clock: playing=true t=16 (stuck at the last frame; the Pause button is still showing)
```
- **P-3 · scrubbing beyond what a running re-run has produced is clamped and forgotten.** **FIXED `4eadbf1`** (was CONFIRMED, r13 e; test `#7 r13e`): `setTime(30)` with 9 frames → `t=8`, and `t=30` once the run has produced the frames.
- **P-4 · `acc=0` when waiting** loses the fractional step, so playback restarts slightly slow after waiting. **SUSPECTED**, cosmetic, no repro, **still open** for the rerun policy (the `continue` branch keeps the owed step).

---

### 7 · Machine F: store (frames, versions, bound view)

**Variables:** `frames[]`, `series`, `time.t`, `selection`, version counters `version.*`, `data` (frame at current time may differ), `shown` (what the map shows may differ), `gen` (bumped by every replace), `bind` map with per-entity `synced/syncT/syncGen`.
**States:** `F0 Empty` (`frames.length===0`) → `F1 Holding(n)` → (replace) `F1 Holding(m)`. Impossible by design: `time.t > frames.length-1` with frames present (clamped, `:148`) — except after a throwing `pushFrames` (F-1).

**Invariants**
- F-I1 frames are contiguous: `frames[i].t === i`; `pushFrames` is **atomic** (checked and resolved on the side, committed only when every frame is good).
- F-I2 `data` and `shown` move whenever the frame at `time.t` can differ (`:99,149,192`); the bound cache (`bound()`) returns the previous arrays only if `synced === data` (`:172`).
- F-I3 the patch fast path applies a patch only on top of the immediately preceding frame of the same `gen` (`:174`). Holds: each replace bumps `gen` (`:140`), `setTime` changes `syncT`; checked by reading, not attacked (rendering owners cover the bound view).
- F-I4 subscribers are called after the state changed; a throwing subscriber does not stop the others (`:41`). Holds.

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| any | `pushFrames(f, replace)` | contiguous | F1 | clears `frames`/`series`/`gen++` first; pushes; clamps `t`; `data/shown++` if the frame at `t` may differ; emits `frames`, `series` | `:138-152` |
| any | `pushFrames` | non-contiguous / bad patch | unchanged | throws; frames, series, `gen`, `time`, bound view untouched, no event (F-1 FIXED `aa30227`; was: old frames cleared, some new pushed, no event) | `pushFrames` |
| any | `setTime(t)` | clamped ≠ current | | `data/shown++`, emit `time` | `:95-99` |
| any | `select(sel)` | different | | emit `selection` | `:106-110` |
| any | `emit` from inside a handler | | | queued behind the event in progress (FIFO); a subscriber unsubscribed meanwhile is not called (F-2 FIXED `4eadbf1`) | `emit` |
| any | `runId()` | | | `gen`: changes when a replace happens (the run on screen) | `packstore.js` |
| any | `setParams(v)` | all legal | | emit `params` once, with changed names; all-or-nothing | `:70-80` |
| any | `invalidate()` | | | `shown++`, emit `view` | `:192` |

**Reachable invalid**
- **F-1 · `pushFrames(replace)` that throws leaves the store half replaced.** **FIXED `aa30227`** (was CONFIRMED, r13 b; test `#5 r13b`, also for an extending push). On `aa2d936`: length 3 → 2, `time.t=2` with `frame()` null, no event, and `bound()` keeps serving the old run's arrays. Only reachable through a protocol fault (R-1). Impact: map drawn from old data with the timeline of a shorter run; silent.
- **F-2 · unsubscribe-during-emit still delivers; a nested write inverts event order.** **FIXED `4eadbf1`** (was CONFIRMED, r10; tests `#7 r10a/b` and the throwing-handler control). On `aa2d936`: delivery is to a snapshot of subscribers (`:41`). Dependents that tear down in a handler (`destroy` of charts and the inspector, `packhost.js:518,542`) can still receive the event that is in flight. In practice nothing in the shell writes the store from a handler on the same store; `follow` writes a *different* store (`packdash.js:40-42`). Cosmetic.
```
$ node docs/state-machines/repro/r10-store-emit.js     # on aa2d936
(a) ["s2 called after s1 unsubscribed it"]
(b) later subscriber saw: ["v2 rate=0.9","v1 rate=0.9"] (event order inverted)
```
- **F-3 · preset values off the parameter step.** **FIXED `4eadbf1`** in the store (was CONFIRMED, r13 d; test `#7 r13d`): the validator accepts `rate: 0.22` for step 0.05 and the store snaps to 0.2; `isPreset` now compares with the snapped value, so the button is active after it is applied. The validator (shared with `paperdolls/pack.py`) still accepts it: harmless, not changed.
- **F-4 · selection of an entity that disappears or changes under a new frame.** **REFUTED**: entity counts are fixed for the page's life (`counts` come from `PackRuntime.bindScene` once, `packhost.html:193,197`; `entitySpec` `packruntime.js:42-50`), A and B use the same counts, so a selection `{entity,id}` stays valid across any re-run; `bindInteraction` guards `sel.id < binding.count` (`packhost.js:597`), and `entityRows` returns `[]` when a frame lacks the entity (`:339`). Selection also survives re-runs by design (the inspector re-asks on `frames` with `replace`, `:514`).

---

### 8 · Machine I: inspector request loop (`inspector()` in `mountUI`)

**Variables:** `busy`, `again`, `shown`, `store.selection()`, `store.runId()`, `store.time().t`, DOM nodes `fieldsEl` (frame values, synchronous) and `extraEl`/`note` (runtime answer, asynchronous).
**States:** `I0 Hidden` (no selection); `I1 Shown-idle`; `I2 Asking` (`busy`); `I3 Asking+Again` (`busy && again`).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| I0 | store `selection` | non-null | I1→I2 | clears extra rows; draws frame rows; `ask()` | `draw` |
| I1/I2/I3 | `time` or `frames`(replace) event | selection | I2 / I3 | `ask()`: if `busy` set `again` | `draw` |
| I1/I2/I3 | `view` event | flip | I2 / I3 | model rows cleared (they belong to the other run), frame rows redrawn from the run now shown, `ask()` (B-1 FIXED) | `draw` |
| I1/I2/I3 | `view` event | not a flip (wall chosen) | I2 / I3 | frame rows redrawn, `ask()` | `draw` |
| I2 | answer | key `(entity, id, runId, t)` equal to the key at ask time, a real answer | I1 (→I2 if `again`) | extra rows replaced | `ask` |
| I2 | answer | `{ stale: true }` (the model holds another run than the one on screen) | I1 (→I2 if `again`) | rows left as they are; the replace event asks again (I-1 FIXED) | `ask` |
| I2 | answer | key changed | I1 (→I2 if `again`) | answer dropped | `ask` |
| I2 | rejection | | I1 | `note = 'The model could not say: …'` **without** the staleness check (I-2, still open) | `ask` |
| any | selection cleared | | I0 | `hidden`; `shown=null`; an in-flight answer is later dropped by the key check | `draw` |

Invariant I-I1 the panel shows, together, frame values and a model answer for the same (entity, time, run). Holds since `f5765bd` (violated by I-1 and B-1 before). The controller withholds an answer while `shown !== gen` and (`running` or `error`); `store.runId()` of the compare view is `'a:'`/`'b:'` + the shown store's `gen`.

- **I-1 · the answer is not tied to the run on screen.** **FIXED `f5765bd`** (was CONFIRMED, r11; tests `#4 r11` ×3 incl. the jsdom inspector case). The evidence on `aa2d936`: `ctl.inspect` asks the worker's current handle (`packhost.js:147` → `packruntime.js:186`), at the time shown. While a re-run is in `Holding`, the store shows the old run but the worker has the new run at `t=8`: the inspector (key = selection + time only, `:497-500`) accepts the answer for day 30, which for a log-based model (the toy, `packs/toy-epidemic/runtime.js:109`) means "nothing happened yet", next to field values from the old run. The time events from Play re-ask on every tick (`:514`), so it is refreshed continuously while this window lasts. Window = duration of one re-run (sub-second for the toy; seconds for a large scene). Impact: wrong picture (transient). Likelihood: high.
```
$ node docs/state-machines/repro/r11-inspect-answers-from-partial-run.js     # on aa2d936
on screen at t=30: load 530 (old run, rate 0.5)
inspect answer: rate of this run=0.8; asked for t=30; run has simulated to=8; events logged by t=8
```
After the fix: `inspect answer: withheld (stale ...)`, then once the new run replaced the frames `rate of this run=0.8; asked for t=30; run has simulated to=40`.
- **I-2 · the rejection path skips the staleness check** (`:506`): an old error can overwrite the note of a newer selection. **SUSPECTED**, cosmetic, **still open**; blocked repro by there being no cheap way to make `inspect` fail on one selection only in the real flow (it would need a runtime throwing for one entity).
- **I-3 · answers across FIFO.** An answer for the old run cannot arrive after the new run's frames (single ordered channel, `setParams` reply precedes the new chunks), so the `frames`(replace) re-ask always follows the old answer. **REFUTED**.

---

### 9 · Machine B: A/B compare (`createCompare`)

**Variables:** `enabled`, `showing` ('a'|'b'), `ctlB`/`runtimeB` (null until enabled, and again null after it is switched off), `bSource`, `bShown` (the parameters of the run B's frames come from), `error`, `flips`, `snapshotsList`; `bOk()` = `!ctlB || !ctlB.error`. Two stores `A` (page) and `B`; `viewStore` reads A or B.
**States:** `B0 Off, never enabled` (`ctlB=null`); `B1 On, showing A`; `B2 On, showing B`; `B3 Off after use` (`ctlB` disposed and null, B's store keeps its settings and its last frames, `showing='a'`; was: worker alive and re-running, B-3), `B4 On, B failed` (`ctlB.error` set: `bOk()` false). Impossible by design: `showing==='b'` while `!enabled` (`show()` coerces, `enable(false)` flips back).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| B0/B3 | `enable(true)` | | B1 | picks B (first preset that differs from A, else a copy of A; only on the very first use); `createRuntime()` (second worker); `createController` with `onRun = bRan`; `ctlB.start()`; `follow()` | `enable` |
| B0/B3 | `enable(true)` | `createRuntime` throws | B0 | `error` set; `enabled=false` | `enable` |
| B1 | `show('b')` | | B2 | `flips++`; `follow()`; `view.__flipped()` → `view`/`*` subscribers, which since `f5765bd` include the readout, the inspector and the tooltip | `show` |
| B1/B2 | `enable(false)` | | B3 | `show('a')`; `ctlB.dispose()` (run dropped, subscription removed, worker terminated, Blob URL revoked once); `ctlB=runtimeB=null`; `bShown=null`; `error` cleared (emit `error` if it was set) (B-3 FIXED `4eadbf1`) | `enable` |
| B1/B2 | `setB(src)` | | same | `B.setParams`; ctlB marks dirty, re-run at next `cmp.flush()` (page frame loop) | `setB` |
| B3 | `cmp.flush()` | | B3 | `false`: nothing to run | `flush` |
| B1/B2 | B's run finishes | success | B1/B2 | `error=null`, `bShown={params of that run}`; emit `error` if it changed | `bRan` |
| B1/B2 | B's run finishes | failure (first start **or** any later re-run) | B4 | `error='The comparison run failed: …'`; emit `error`; `bOk()` false: `differences()` is empty, charts/KPIs leave B out, `bLabel()` names the last good run (C-2 FIXED `f5765bd`) | `bRan` |
| B4 | `setB(src)` and B's next run succeeds | | B1/B2 | error cleared (emit `error`), label and differences back | `bRan` |
| any | A `time` | | | `B.setTime(A.t)` | `follow` |
| any | B `frames` | | | `follow()` again (B's own time clamps to its frames) | `follow` |
| any | `inspect(sel)` | | | runtime chosen by `showing` **at call time**; the chosen controller withholds a stale answer (I) | `inspect` |

**Findings**
- **B-1 · flip leaves the inspector, the timeline readout and the tooltip stale.** **FIXED `f5765bd`** (was CONFIRMED, r09, jsdom; tests `#4 r09` ×2: inspector rows and readout both ways, tooltip). The evidence on `aa2d936`: `cmp.show` emits nothing the panels listen to: `view.subscribe` only forwards `view`/`*` to flip subscribers (`:113-121`), the inspector listens to `selection/time/frames` (`packhost.js:516`), the readout (via `refresh`) to `params/time/frames` (`:540`), the tooltip to `time` (`:590`). `follow()` after the flip emits `time` only if B's `t` differs from A's, which is normally not the case. Result (printed): after the flip the map shows B (`load[0]=200`) while the inspector still says `500` and `rate of this run 0.5` and the readout `load 500`; one `setTime` later they jump to B. The chart/KPI panels are unaffected (both runs always drawn). Impact: wrong picture on the presenter's most visible comparison action. Likelihood: high.
```
$ PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules node docs/state-machines/repro/r09-ab-flip-leaves-inspector-and-readout-stale.js     # on aa2d936
showing A  : map load[0]=500 | inspector fields: A | 500 | rate of this run 0.5 | readout: Totals: load 500 · zero 0
after flip : map load[0]=200 | inspector fields: A | 500 | rate of this run 0.5 | readout: Totals: load 500 · zero 0
time moved : map load[0]=201 | inspector fields: B | 201 | rate of this run 0.2 | readout: Totals: load 201 · zero 0
```
After the fix, "after flip" shows `map load[0]=200 | inspector ... | 200 | rate of this run 0.2 | readout: ... load 200` (the kind column reads `A` because it depends on the time, not the run).
- **C-2 (B-2) · B re-run failures are invisible.** **FIXED `f5765bd`** (was CONFIRMED, r02; tests `#4 r02` ×2: a later failure and recovery, a first-start failure and recovery). The evidence on `aa2d936`: `cmp.error` is written only from the first `start()` (`:86`) and never cleared; later `ctlB` failures set `ctlB.error` which nothing reads (`packhost.html:249-251` wires `compare.onChange('error')` and `ctl.onRun` for A only). After `setB(bad)` the compare panel's difference list says B is at 0.95 while B's frames and the map flip come from the 0.2 run. Related: a *start* failure sets `cmp.error` permanently, so the panel keeps showing the error after B recovers (`:212`, SUSPECTED, by reading `:86,212`; not repro'd). Impact: wrong picture, silent. Likelihood: medium-low.
```
$ node docs/state-machines/repro/r02-compare-b-failure-silent.js     # on aa2d936
B source={"preset":"low"} B rate=0.2 B frames=41 B frame5 load=205 (expect 205)
after setB(bad: rate 0.95, the model throws):
  ctlB.error      = "runtime repro: model refuses rate 0.95"
  cmp.error       = null   (what the page shows in the header and the compare panel)
  onChange events = [enabled,b]  (no "error")
  B.params().rate = 0.95   differences() = ["rate: A 0.5, B 0.95"]
  B frame5 load   = 205   (rate 0.2 run; the 0.95 run never produced a frame)
  map would show frame with load 205 under the label "Bad"
```
After the fix `cmp.error` is the failure, `onChange` saw `error`, `differences()` is `[]`, and the label is `Low (the new B run failed: this is the last good one)`. Also fixed in passing: a *start* failure no longer sticks (the earlier "SUSPECTED" note on `:86,212`): every B run clears or sets the message.
- **B-3 · compare off does not stop B.** **FIXED `4eadbf1`** (was CONFIRMED, r13 c; test `#7 r13c`): B's worker stayed alive and a later `B.setParam` still triggered a run (via `cmp.flush`, unconditional `:100`). Switching off now disposes B's controller and worker; switching on creates a fresh worker and re-runs B with the settings it was left with. Cost: one more model start when the comparison is switched back on.
- **B-4 · flipping to B before B has frames** shows the neutral "no data" map (`live = !!store.frame()` in `bindRenderer`) under the badge "Map shows B" until the first chunk. Transient, and permanent if B's start failed (B-2; the badge now says so: `B (its run failed: no data)`). **SUSPECTED** from `packdash.js:92-96` + `packhost.js:228-229`, not repro'd, **still open** for the transient part.
- **B-5 · snapshot/restore vs two handles.** The compare uses **two handles**, never snapshot/restore (`packdash.js:1-12`), so "A/B handles updated or disposed while a run is in flight" reduces to: B's controller has its own `gen` and its own worker, A's re-run cancels only A (**REFUTED** cross-talk: separate `FakeWorker` instances in r02/r09, separate servers and epochs). Disposal is done since `4eadbf1` (B-3) and `aa30227` (T-2).

---

### 10 · Machine Z: page bootstrap (`packhost.html`)

Order (`:186-277`): validate manifest → find runtime impl → `bindScene` on the main thread → `PackStore.create` → `makeRuntime()` (worker starts here) → controller → `createCompare` (B store only; no B worker yet) → renderer binding → UI → `ctl.start()` → rAF loop (`flush`, `compare.flush`, `advance`, render, highlight).

| step | failure | state afterwards |
|---|---|---|
| invalid manifest, missing impl, `bindScene` error | `problem()` and `return` | nothing built; page inert (correct) |
| `bindRenderer` not ok | `problem()` but the **runtime and controller already run** | worker computing a model that is not drawn; harmless |
| worker fails before answering | fallback (T) | single start; page continues |
| worker silent | watchdog (T-1 FIXED): fallback to the main thread, or the page header shows `The model failed: runtime …: the worker did not answer within N s` | no hang |
| worker lost after it was ready | the run is repeated on the main thread once; header shows `ctl.notice` (`The model worker stopped; ...`) | the page goes on, slower |
| rAF callback throws | caught; message once; `requestAnimationFrame` re-armed in `finally` (`:268-272`) | a persistent exception in `ctl.flush()` after `dirty=false` would lose that re-run: **REFUTED** for async (`rerun` does not throw synchronously, `:99-107`) |
| `onRun` message handling | shows `The model failed: …`, else `ctl.notice`; `problem('')` clears only a message starting with "The model failed". The compare's `error` event shows `cmp.error` and clears only a message starting with "The comparison run" | a stale "A frame failed…" stays until reload: cosmetic, **SUSPECTED** by reading, still open |

No double start: `ctl.start()` is called once (`:252`); `labPack` exposes handles for tests. No `pagehide` teardown; the page is the process, so leaks do not outlive it.

---

### 11 · Candidates the task asked about, and where they are answered

| candidate | answer |
|---|---|
| slider changes while a run is in flight | REFUTED corrupting (§5 REFUTED-1, r12); P-1, I-1 are the visible artefacts |
| results of an older run after a newer `setParams` | REFUTED, r12 |
| worker message reordering, drop, duplication | T-7: FIFO and exactly-once REFUTED as a risk; effect of a loss was CONFIRMED (R-1, r07), now FIXED: the run fails visibly |
| worker crash or failure to start; auto fallback | T-1, T-3, T-4, T-5 all FIXED (`aa30227`); fallback works before and after the first answer (r06 a, r05 a/c) |
| play timer firing during a re-run | P-1 FIXED (`4eadbf1`): the clock holds |
| run completes while paused or scrubbing | REFUTED |
| A/B handles updated or disposed while a run is in flight | B-2, B-3 FIXED (`f5765bd`, `4eadbf1`); no cross-talk (B-5) |
| selection of an entity that disappears | REFUTED (F-4) |
| inspector request answered for a stale time or stale run | stale time REFUTED (key check); stale run (I-1) and after A/B flip (B-1) FIXED (`f5765bd`) |
| `dispose()` twice or during a run | T-2 FIXED: second call is a no-op, revoke once, later requests rejected `'disposed'`; during a run: pending rejected with `'disposed'` (the controller's `ctl.dispose()` bumps `gen` first, so no banner); the page calls `ctl.dispose()` only for B when the comparison is switched off |
| store subscribers throwing | REFUTED (`packstore.js:41`; compare emit `packdash.js:36`; flip `:120`) |
| re-entrancy from subscribers | F-2 FIXED (`4eadbf1`) |
| reset during play | benign (§5 table) |
| retries: re-entering a state, double start, leaking worker/timers/blob URLs | T-3, T-4, B-3 FIXED. The watchdog creates one timer per request in flight; all are cleared when the request settles, on loss and on `dispose()` (test `#5 r05b`, `#7 dispose()`: none pending); the page's 0 ms `schedule` timers are one-shot. The controller retries a run once after the worker was replaced (`recoverable`). |

### 12 · Running everything

```
PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules sh docs/state-machines/repro/run-all.sh
```
Each script prints what it observed. The blocks pasted above headed "on aa2d936" are the output before the fixes; the output after them, for every script, is `docs/state-machines/repro/run-all.out.txt` (deterministic: running `run-all.sh` again reproduces it byte for byte). The assertions are in `viz/test_pack_runtime.js` (`node viz/test_pack_runtime.js`; pytest: `tests/test_pack_runtime.py`), which also holds the cases for the new transitions (watchdog, `continue`, dispose, holding clock). Every test of a fixed finding was run against `git archive aa2d936` and failed there (named in the commit messages); the controls that pass on both are `#5 r07: a complete run is not reported`, `#6 ... rerun still makes the whole timeline`, `#7 r10: a handler that throws does not stop the queue`.

Not verified in a real browser: a real `Worker` dying (OOM kill), a blob worker blocked by a CSP, the watchdog's default 20 s on a slow machine, the 0 ms timers, and the look of the header messages. The faked thread boundary reproduces the message sequences, not the browser's scheduling.

## Part 20 · Tooling and data pipeline

Scope: `paperdolls/ingest/` (fetch, readers, build, classify, adjacency, elevation, report), `place.py`, `cli.py` (ingest, osm-fetch, place, pack, export,
intake), `pack.py`, `packcheck.py`, `packdev.py`, `viewer_build.py`, `export.py`, `replay_build.py`, `spec.py`, `intake.py`, the `bindScene` flow
(`viz/packruntime.js`) and the three validators (`pack.py`, `viz/packvalidate.js`, `schemas/pack.schema.json`).
Base of the analysis: `main` at 6b74ff7 (re-run on aa2d936 before the fixes). **Status: every confirmed finding below is FIXED** on branch `claude/fix-tooling-4b12df`
by six commits, one per GitHub issue: #8 `d8401e2`, #9 `6ebc83e`, #10 `0180458`, #11 `4c48c0c`, #12 `db9bb18`, #13 `b5a3f6d`. The regression tests are in
`tests/test_tooling_robustness.py` (each is the port of a repro; they fail on aa2d936 and pass now). The repros were kept as they are, apart from the
changes noted in "Changes to the repros" below; their committed output now shows the held behaviour.

How to reproduce (from the repository root, no network: the only server is a local fake bound to 127.0.0.1):

```bash
PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules /data/ScifiEconomicsLab/TheGreatRetrofit/.venv/bin/python docs/state-machines/repro/tooling_repro.py      # T01..T30, or name some: ... T05 T23
PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules node docs/state-machines/repro/bindscene_repro.js                                                          # B01..B08
/data/ScifiEconomicsLab/TheGreatRetrofit/.venv/bin/python docs/state-machines/repro/validator_diff.py 3000 1                                                                                   # differential fuzz
```

Observed output of the last full run is committed next to the scripts: `tooling_repro.out.txt`, `bindscene_repro.out.txt`, `validator_diff.out.txt`.
A repro prints `REPRODUCED` when the invalid state or transition happened and `REFUTED` when the code held. For the `B` cases the label only says the
described behaviour was observed; whether it is a defect is judged in the text. **After the fixes all of T01 to T30 print `REFUTED` (the code holds)**; the
docstrings and the "Reachable invalid states" text below describe the behaviour on aa2d936 and are kept as the record of what was wrong.

### Confirmed bugs, ranked by impact

Impact is for the Great Retrofit use (a policymaker map of Jette built from an OSM extract); likelihood is for someone running the documented workflow.
Grouped by cause, which is how the issues should be filed.

| # | Bug | Repro | Impact | Likelihood | Group |
|---|-----|-------|--------|------------|-------|
| 1 | **FIXED (d8401e2, #8)** `place` reuses `out/extract.json` for any later spec: enlarge `place.bbox` and the old, smaller extract is ingested; scene covers the old area, no warning, no refetch | T05 | High: a silently wrong map | Medium (anyone who changes the area through the intake after a first run) | A: cache keyed by nothing |
| 2 | **FIXED (d8401e2, #9)** `fetch_overpass` lets `http.client.IncompleteRead` escape (a dropped connection during the 14 MB / 56 s download). `osm-fetch` and `place` end in a traceback, not `fetch failed` with the hint; same for valid JSON that is not an object | T01, T02, T03 | Medium: nothing is corrupted, the user is shown a stack trace on the one step that needs a retry | Medium to high on a flaky link | B: exceptions escape the CLI boundary |
| 3 | **FIXED (d8401e2, #8)** A truncated or wrong `extract.json` is used on every run; the message (`the ingest failed: Expecting ',' delimiter`) never mentions `--refetch` or deleting the file | T06 | Medium: a stuck pipeline | Low to medium | A |
| 4 | **FIXED (4c48c0c, #11)** Intake loses an answer when two `intake answer` commands overlap (read, modify, rewrite the whole file, no lock, no merge); both print `OK` | T23 | Medium: silent loss of a user decision (the confirmation gate catches only part of it) | Medium if the driving model issues parallel tool calls | F: intake state |
| 5 | **FIXED (0180458, #10)** A half-written `render.yaml` is a `YAMLError` traceback in every intake command; a file truncated to empty makes `intake next` start the interview from question one with `answered: 0` and no warning | T24 | Medium | Low | A (non-atomic writes) |
| 6 | **FIXED (db9bb18, #12)** `ingest` writes a scene with zero buildings and no warning when every building is degenerate (and `Infinity`/`NaN` end up in `scene.json` for an infinite coordinate, which is not JSON) | T09, T10 | Medium: a pack with `from: scene` then has nothing to bind | Low | C: ingest output not validated |
| 7 | **FIXED (b5a3f6d, #13)** Placeholder substitution runs over the whole page: a manifest string or runtime source containing `/*__SCENE__*/` (or any `/*__LIB__*/`) gets the scene or a library spliced in; the `MANIFEST` literal no longer parses and the page is blank | T15 | Medium (blank page, no error) | Very low | E |
| 8 | **FIXED (0180458, #10)** `Path.write_text` straight onto the output for `pack build --out`, `ingest` (3 files), `place` (3 files), `export` and `intake`: a reader sees a prefix; a failure on file 2 or 3 leaves a new scene beside an old or missing report | T14, T18 | Low to medium | Low | A |
| 9 | **FIXED (0180458, #10)** `export --out traj` (no `.npz`): numpy writes `traj.npz`, the command prints `wrote traj`, and the next command fails with `FileNotFoundError` | T22 | Low | Medium | A |
| 10 | **FIXED (6ebc83e, #9)** `pack.validate()` raises `TypeError` (str.join over a non-string) for manifests the JS validator reports as ordinary errors; `pack check`/`pack build` end in a traceback | T28 | Low | Low | G: validators |
| 11 | **FIXED (b5a3f6d, #13)** `pack.build()` reads the manifest three times and validates only the first read; an edit in between is built without validation | T16 | Low | Low | D: repeated reads |
| 12 | **FIXED (b5a3f6d, #13)** `runtime.entry` is not confined to the pack folder when `runtime.files` is absent (absolute path or `..` accepted by `check`, inlined by `build`); `runtime.files` is confined | T17 | Low (a pack is trusted code) | Low | D |
| 13 | **FIXED (6ebc83e, #9)** More uncaught exception types at the CLI: malformed element (`KeyError`), spec `n: abc` (`ValueError`), hand-written `place` block (`ValueError`/`IndexError`/`KeyError`), `pack dev` on invalid YAML (`PackError`) | T07, T08, T19, T27 | Low | Low | B |
| 14 | **FIXED (db9bb18, #12)** `ingest` data hygiene: duplicate scene ids pass through; self-crossing footprints are kept; `--max-buildings -1` miscounts; `--bbox` is silently dropped from the query when a relation is also given | T11, T12, T13, T29 | Low | Low | C |
| 15 | **FIXED (b5a3f6d, #13)** `--include FILE` for a file inside the pack folder that a runtime `require`s: `check`, `build`, `packcheck` and `pack dev` all call `check(path)` without `include`, so the documented flag is refused with `not inlined into the page` | T30 | Low to medium: blocks the documented shared-helper route | Medium for packs using `--include` | D |
| 16 | **FIXED (4c48c0c, #11)** Intake keeps stale bookkeeping across a goal change (`overrides_answered`, `override_keys`, `defaults`), so the overrides question is not asked again and the table can show `you said` for values that were reset | T25 | Low | Low | F |

Machines found sound before and after (no invalid state reached): the dev server lifecycle (T20, T21), the Overpass error paths for HTML error pages and 429 (T04), the intake
confirmation gate (T26), `bindScene` reporting of unknown ids (B01, B02, B07).

---

### M1. Overpass fetch (`ingest/fetch.py`, driven by `cli.cmd_osm_fetch` and `place.run`)

Identity: `fetch_overpass` [fetch.py:20](paperdolls/ingest/fetch.py:20); implicit machine, one request per call, no retry, no resume. Query text from `overpass_query` [query.py:54](paperdolls/ingest/query.py:54).

States and the variables that encode them:

| State | Encoded by |
|-------|-----------|
| idle | no request; `out_path` may or may not exist |
| requested | blocked in `urlopen` (timeout 360 s is per socket operation, not total) |
| body read | `raw` bytes in memory |
| rejected | `FetchError`; `out_path` untouched; for non-JSON, `<out>.raw` written ([fetch.py:37](paperdolls/ingest/fetch.py:37)) |
| saved | `out_path` holds `raw` (written in one `write_bytes`, [fetch.py:45](paperdolls/ingest/fetch.py:45)) |

Files on disk are state: `extract.json` (the cache, see M2), `extract.json.raw` (the rejected body, never read again, never deleted).

Invariants and the lines that keep them:

- `out_path` only ever holds JSON with a non-empty `elements` list and no `error` in `remark`: [fetch.py:35-45](paperdolls/ingest/fetch.py:35). Holds for every answer tested (T04).
- Every failure surfaces as `FetchError` so the CLI can say what to do: [fetch.py:27-32](paperdolls/ingest/fetch.py:27). Does not hold (T01, T03).
- An existing good extract survives a failed fetch: the write is the last statement. Holds (T04).

| From | Event | Guard | To | Side effects | Line |
|------|-------|-------|----|--------------|------|
| idle | `fetch_overpass` | none | requested | POST, User-Agent | 22-25 |
| requested | HTTP error | status 429, 504, 400 give hints | rejected | none | 27-30 |
| requested | URL/OS/timeout error | | rejected | none | 31-32 |
| requested | body cut short | | **escapes as `IncompleteRead`** | none | 26 (T01) |
| body read | not JSON | | rejected | writes `.raw` | 34-38 |
| body read | JSON but not an object | | **escapes as `AttributeError`** | none | 39 (T03) |
| body read | `remark` has "error", or no elements | | rejected | none | 39-44 |
| body read | otherwise | | saved | overwrites `out_path` in place | 45 |

Retries and rate limits: there is no retry, no back-off and no `Retry-After` handling by design (the CLI help says "one request, no retries"). A 429 gives
the hint text only (T04). Stale cache reuse and error-page poisoning: an HTML or 429 answer does not create or change `extract.json` (T04, REFUTED).
Overpass can also answer 200 with partial elements and a `remark` that does not contain the word "error" (for example an out-of-memory remark worded
differently); that would be saved as a complete extract. SUSPECTED: only the substring "error" is checked, and a repro needs a recorded real answer, which the
no-network rule forbids.

Reachable invalid states:

- **T01 FIXED (d8401e2)**, **T02 FIXED (d8401e2)**: a connection dropped mid-body raises `http.client.IncompleteRead` (an `HTTPException`, not an `OSError`). Observed:
  `IncompleteRead escaped (not FetchError): IncompleteRead(28 bytes read, 99972 more expected); out file exists=False`; through the command,
  `exit=1; ... http.client.IncompleteRead`. `place.run` catches only `FetchError` ([place.py:63-67](paperdolls/place.py:63)), so `paperdolls place` fails the same way
  and the query-saved hint, which exists for exactly this case, is never printed. Impact medium, likelihood medium to high (the real fetch is 14 MB over about a minute).
- **T03 FIXED (d8401e2)**: `200` with `[]`: `AttributeError: 'list' object has no attribute 'get'`. Same handling gap.
- **SUSPECTED** slow trickle: `timeout` bounds each socket read, not the whole download, so a server that sends a byte every 300 s never times out. Not reproduced (it takes minutes).
- **SUSPECTED** killed during `write_bytes`: a prefix of `extract.json` stays and M2 then reuses it (see T06 for the consequence, which is confirmed with a hand-made prefix).
- **T29 FIXED (d8401e2)**: `overpass_query(relation=R, bbox=B)` says "either, or both" and `osm-fetch` accepts both, but the query uses only `(area.a)`; the bbox is not in it. Observed: `bbox values in query=False; filter used=True`.

### M2. Place pipeline and the extract cache (`place.py`)

Identity: `place.run` [place.py:33](paperdolls/place.py:33); implicit; the state is the contents of `<output.dir>/` next to `render.yaml`: `query.ql`, `extract.json`,
`scene.json`, `scene_report.md`, `scene_report.json`.

States (derived from which files exist and whether they are consistent with the spec):

| State | Files | Variables |
|-------|-------|-----------|
| empty | none | |
| query saved | `query.ql` only (no network, or fetch failed) | |
| extracted | `extract.json` | consistent with the spec only if it was fetched for the same relation/bbox: **nothing records that** |
| scened | `scene.json` + both reports | scene built from `extract.json` with the spec of the last run |
| partly written | `scene.json` without one or both reports | after a failure between [place.py:74](paperdolls/place.py:74) and 76 |

Invariants that should hold, and what maintains them:

- `extract.json` is for the area the spec names now. **Nothing maintains it**: the only guard is `refetch or not extract.exists()` ([place.py:57](paperdolls/place.py:57)).
- `scene.json`, `scene_report.md`, `scene_report.json` describe the same ingest. Maintained by writing them one after another, no temp file or rename ([place.py:74-76](paperdolls/place.py:74)).
- A scene file used as given (`scene_file`) has the four lists: [place.py:48](paperdolls/place.py:48).

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| any | `place` | `kind` bbox/relation, no `extract.json` | extracted | writes `query.ql`, fetches (M1) |
| any | `place` | `extract.json` exists, no `--refetch` | (unchanged) | **no fetch, whatever the spec says** |
| extracted | ingest ok | | scened | writes scene, then md, then json |
| extracted | ingest error | | extracted | `PlaceError("the ingest failed: ...")` and nothing about refetching |
| any | `place --no-fetch` | no extract | query saved | `PlaceError` |
| any | `place` | `kind` = `extract_file` | | reads the user's file, no copy kept |

Reachable invalid states:

- **T05 FIXED (d8401e2)** (rank 1): spec `bbox` [50.00, 4.00, 50.01, 4.01], extract cached for it; the user enlarges to [49.90, 3.90, 50.10, 4.10] through the intake; `place` makes
  `fetch calls=0; buildings=2 for the NEW (larger) bbox; warnings=[]`. The scene is silently the old area. A changed `relation` fails loudly instead
  (`boundary relation ... is not in the file`), so only the bbox form is silent. Also `max_buildings` and `name` are applied fresh, so the scene mixes new options with old data.
- **T06 FIXED (d8401e2)**: a prefix of a JSON file as `extract.json` fails the same way on every run: `same failure twice=True; message="the ingest failed: Expecting ',' delimiter: line 1 column 65 (char 64)"`. The user must guess to pass `--refetch`.
- **T14/T18 pattern**: scene and reports are three separate writes; a failure on the second leaves a new `scene.json` beside an old report (see M3 for the repro on the `ingest` command, `place` has the same code shape).
- **T07 FIXED (6ebc83e)**: `spec.validate` for `place_scene` checks only `place.kind` and `look.region` ([spec.py:70-73](paperdolls/spec.py:70)), but `place.run` indexes `place["scene_path"]`, `place["extract_path"]`, `place["bbox"]` and `relation`. Observed: `osm_relation: ValueError: give a relation id...; bbox: IndexError: Replacement index 3 out of range...; extract_file: KeyError: 'extract_path'`. The intake would never leave these empty; a hand-written file does.
- REFUTED: a changed `output.dir` starts a clean cache (new folder), so only same-folder reuse is affected.

### M3. Ingest run (`ingest/build.py`, readers, classify, adjacency, elevation, report; `cli.cmd_ingest`)

Identity: `build.ingest` [build.py:80](paperdolls/ingest/build.py:80), a pure function of (file, options) except for the clock in `area.generated`; implicit pipeline:
read, clip, choose rotation, roads and trams, buildings, neighbours, landuse, trees, scene, elevation, report. `cmd_ingest` [cli.py:323](paperdolls/cli.py:323) writes three files.

States and variables: `feats, notes` after reading; `bld, roads, lands, tpts` after clipping; `lat0, lon0, rot` (frame); `road_out, bld_out, land_out, trees`; `scene`, `report`.
Files on disk: `scene.json`, `<stem>_report.md`, `<stem>_report.json` (written in that order, [cli.py:335-338](paperdolls/cli.py:335)).

Invariants and what is meant to maintain them:

1. Building ids are unique in the scene. Not enforced anywhere (ids come straight from the input: `w<id>`, `r<id>#k`, GeoJSON `id`).
2. Each footprint is a simple polygon of at least 3 points with area at least 8 m2: [build.py:249](paperdolls/ingest/build.py:249) enforces the count and area, not simplicity.
3. All coordinates are finite. Not enforced; the origin is a plain min/max ([build.py:150](paperdolls/ingest/build.py:150)).
4. The scene has buildings if the extract had buildings. The only emptiness check is before projection and simplification ([build.py:145](paperdolls/ingest/build.py:145)).
5. `neighbours` only name ids present in `buildings`: holds, built from `bld_out` after filtering ([build.py:272-274](paperdolls/ingest/build.py:272)); with duplicate ids a link is ambiguous.
6. `levels` is 1..60: [classify.py `building_levels`](paperdolls/ingest/classify.py:43) clamps (levels 0, negative or 9999 become the default 2, or 60). REFUTED as a defect; probe: `building:levels` 0, -3 give 2, 9999 gives 60, `height=1e9` is ignored above 400 m.

| From | Event | Guard | To | Side effects | Line |
|------|-------|-------|----|--------------|------|
| (start) | read file | format detected by first character | features | none | readers.py:197 |
| features | boundary relation named | relation found | clip ring set | | build.py:91-98 |
| features | boundary relation named | not found / open ring | `IngestError` | | 93-96 |
| features | clip, no buildings and no roads | | `IngestError` | | 145 |
| clipped | `--max-buildings N` | N truthy and fewer than the count | truncated to the nearest N | counts skipped | 153-156 |
| clipped | project buildings | ring < 3 points or < 8 m2 | dropped, counted in `skipped` | | 249-251 |
| built | elevation file | `ElevationError` | `IngestError` | | 358-359 |
| scene | CLI | | three writes | non-atomic | cli.py:335-338 |

Reachable invalid states (all deterministic, [tooling_repro.py](docs/state-machines/repro/tooling_repro.py)):

- **T08 FIXED (6ebc83e)**: an element without `type`, or a node without `lat`, raises `KeyError` in `read_overpass_json` ([readers.py:101-117](paperdolls/ingest/readers.py:101)); `cmd_ingest` and `place` catch `IngestError` and `ValueError` only. Observed: `no type: exit=1 KeyError: 'type'; node without lat: exit=1 KeyError: 'lat'`. A truncated file is a `ValueError` (JSON decode) and is handled.
- **T09 FIXED (db9bb18)**: a line and a zero-area bowtie as the only buildings, plus a road: `buildings=0; warnings=[]; skipped={'building smaller than 8 m2': 1}` (the 3-point 'line' is not a closed way, so the reader makes it a line feature, not a building, and it is not counted at all). Roads-only extracts are legal and equally silent. Consequence downstream: the toy `bindScene` throws and the pack page reports it (B04).
- **T10 FIXED (db9bb18)**: one building with `lon = Infinity` (Python `json` accepts it; Overpass does not emit it) gives `origin={'lat': 50.05, 'lon': inf}`, `frame rotated nan degrees`, an empty scene, exit 0, and `Infinity` inside `scene.json`, which a strict JSON parser rejects. `pack.load_scene` (Python `json`) accepts it and the page literal embeds it as the JS `Infinity`. NaN lat is dropped silently by `simplify_ring` (NaN comparisons are false), so only the infinite case propagates. Likelihood very low.
- **T11 FIXED (db9bb18)**: `ids=['w1', 'w1']; warnings=[]`. Source: two extracts concatenated, or a hand-edited scene. `bindScene` then handles it with a warning (B01).
- **T12 FIXED (db9bb18)**: `--max-buildings -1` with 3 buildings keeps 2 and reports 4 skipped (`len - N`); `--max-buildings 0` is treated as "no limit". Argparse allows both.
- **T13 FIXED (db9bb18)**: a self-crossing footprint with unequal lobes passes the area test (the shoelace sum is the difference of the lobes): `footprint=[[-8.16, 65.59], [11.26, 6.93], [30.5, 47.03], [-17.78, 45.54]]; self-crossings=1`. The renderer extrudes it as is.
- **T14 FIXED (0180458)**: with `scene_report.md` unwritable, `scene.json` is already replaced and `scene_report.json` is missing: `exit=1; scene.json written=True; scene_report.json written=False; IsADirectoryError`. A rerun after a fix repairs it, so the exposure is the window and an older report beside a new scene.
- REFUTED: zero buildings *and* zero roads is rejected (`nothing to draw`); `--rotation` garbage is a `ValueError` caught by `cmd_ingest`; a bbox with south above north yields `nothing to draw`, loudly.
- REFUTED: `neighbours` referencing a missing id cannot come out of `ingest`; it can come from a hand-edited scene and the toy `bindScene` drops unknown ids but keeps self links and repeats (B05).

Retries and idempotency: ingest is deterministic for the same input and `--seed` (scatter uses `random.Random(f"{seed}:{id}")`), except `area.generated`. Re-running after a failed run is safe; it overwrites all three files.
Concurrency: two `ingest` processes with the same `--out` interleave per file; the pair (scene, report) can end up from different runs. SUSPECTED, not reproduced (needs two real processes racing on one file).

### M4. Pack check and build (`pack.py`, `viewer_build.py`, `cli.cmd_pack`)

Identity: `check` [pack.py:604](paperdolls/pack.py:604), `build` [pack.py:767](paperdolls/pack.py:767), `cmd_pack` build branch [cli.py:305-317](paperdolls/cli.py:305); implicit. No state is kept between runs; the state is the set of files read.

Files read by one build, and how often: `pack.yaml` (in `check`: `load`; in `build`: `load`; in `runtime_files`: `load`, and again by `undeclared_scripts` inside `check`): 3 to 4 reads per build; each runtime file once in `check`'s
existence test and once in `runtime_source`; `--scene` once ([cli.py:306](paperdolls/cli.py:306)); `viz/*.js` and `assets/palettes.json` through `viewer_build._fill`.

Invariants: (1) what is built is what was validated; (2) the page parses (manifest and scene literals are JSON in a script); (3) the runtime inlined is exactly `runtime_files`; (4) the page is within `max_bytes` or the build fails; (5) the output file is complete or absent.

| From | Event | Guard | To | Side effects | Line |
|------|-------|-------|----|--------------|------|
| (start) | `pack build` | scene loads | scene held | none | cli.py:306 |
| scene held | `check` errors | any | `PackError` | exit | pack.py:772-774 |
| validated | read manifest again, read runtime files | file contains `</script` or `<!--` | `PackError` | | pack.py:704-706 |
| built | size over budget | trim stages one by one; still over | `PackError` | | pack.py:793-802 |
| built | write `--out` | | done | `write_text` onto the target | cli.py:310 |

Reachable invalid states:

- **T15 FIXED (b5a3f6d)**: `viewer_build._fill` ([viewer_build.py:23-30](paperdolls/viewer_build.py:23)) replaces `/*__KEY__*/` markers over the whole template in a fixed order, after `build` has already put the runtime source into the template ([pack.py:781](paperdolls/pack.py:781)) and with the manifest JSON inserted before the scene. A manifest string with `/*__SCENE__*/` receives the scene: `MANIFEST literal no longer parses (Expecting ',' delimiter: line 1 column 5530); the scene id w1 appears inside it: True`. A runtime that mentions `/*__VIZLIB__*/`, `/*__PALETTES__*/` etc. in a comment gets the library pasted in. The page is blank; `pack check` passes. Scene strings cannot do this because the scene is substituted last.
- **T16 FIXED (b5a3f6d)** (interleaving injected right after `check()` returns, which is an editor save during a build): `build returned a page (485099 bytes) embedding id 'BAD ID'; check() on the same folder now says ['id: required: ...']`. The dev server is not affected in the long run (its signature is taken first, so the next poll rebuilds), `pack build` is.
- **T17 FIXED (b5a3f6d)**: `runtime.entry` set to an absolute path outside the pack and no `runtime.files`: `check errors=[]; outside file inlined=True`. With `runtime.files` the same path is rejected ([pack.py:126](paperdolls/pack.py:126)).
- **T18 FIXED (0180458)**: non-atomic output. A concurrent reader of a 20 MB `write_text` saw sizes `[0, 2097152, 4194304, ...]`. A browser opened on `pack.html`, or a second `pack build` to the same `--out`, can read a prefix. Two writers at once (SUSPECTED, not reproduced: the outcome is up to the kernel) end as one complete file or a mix.
- REFUTED: size budget. `build` re-renders after each trim stage and fails when still over; stages never remove `id`, `footprint`, `levels`, `archetype`, `state`, `investor`, `area`, `residential`, `levels_assumed` ([pack.py:715-723](paperdolls/pack.py:715)).
- REFUTED: `runtime.files` containing `..`, absolute or Windows paths is rejected; a file listed twice is rejected; a listed file missing on disk is an error in `check`.
- NaN or infinite coordinates in a scene: `json.dumps` writes `NaN`/`Infinity`, which are legal JS literals in the page, so the page parses and the building is drawn at NaN (not drawn). Not an invalid page state; the cause is M3 (T10).

### M5. Pack dev server (`packdev.py`)

Identity: `DevState` [packdev.py:66](paperdolls/packdev.py:66) (page state), `DevServer` [packdev.py:208](paperdolls/packdev.py:208) (watcher thread plus one HTTP thread per request), the `CLIENT` script [packdev.py:22](paperdolls/packdev.py:22); explicit class, implicit state names.

States and the variables that encode them:

| State | Variables |
|-------|-----------|
| ok | `ok=True`, `html` = injected page, `errors=[]` |
| error | `ok=False`, `html` = error page, `errors` non-empty |
| building | `_lock` held by `refresh` (a GET blocks behind it) |
| stopping | `server.stopping` set; SSE loops exit within 15 s or at notify |

Each state has a `version` (monotone counter, bumped on every rebuild, including a `touch`) and `_sig` (path, mtime_ns, size for every watched file). The browser holds the version embedded in its page.

Invariants and the lines that maintain them:

1. The version embedded in a page is the version of that page: `_client` uses `self.version + 1` while building inside the same `cond` block that increments it ([packdev.py:123-132](paperdolls/packdev.py:123)). Holds (T20: `events per tab=[5, 5]`, versions strictly increasing).
2. A change during a build is not lost: `_sig` is taken before the files are read ([packdev.py:102](paperdolls/packdev.py:102)); a later change makes the next poll differ. Holds (T20 half-written scene).
3. A bad edit never stops the server: `except Exception` ([packdev.py:121](paperdolls/packdev.py:121)). Holds for build errors (T20).
4. Only loopback hosts are served: [packdev.py:156-159](paperdolls/packdev.py:156).
5. The scene is parsed once per scene change: `_scene_sig` ([packdev.py:109-113](paperdolls/packdev.py:109)).

| From | Event | Guard | To | Side effects | Line |
|------|-------|-------|----|--------------|------|
| (start) | `DevState()` | | ok or error | `refresh(force)` builds | 80 |
| ok / error | watcher tick (0.25 s), `GET /`, `GET /__status` | signature changed | building, then ok or error | `version += 1`, `notify_all` | 96-128, 222-229 |
| ok / error | same | unchanged | unchanged | none | 103 |
| any | `GET /__events` | | stream | first event at once; keep-alive every 15 s | 185-205 |
| stream | write fails | `BrokenPipe`, `ConnectionReset`, `OSError` | closed | none | 204 |
| any | `stop()` | | stopping | `notify_all`, `shutdown`, `server_close` | 237-242 |
| any | `serve()` ^C | | stopping | same | 255-261 |
| (start) | port in use | `OSError` in `DevServer()` | exit | `SystemExit("cannot start the server on port ...")` | cli.py:301-303 |

Client side: `CLIENT` reloads when the event or polled version differs from the embedded one, saving params and time to `sessionStorage` first and restoring after load ([packdev.py:25-34](paperdolls/packdev.py:25)).

Reachable invalid states and sound transitions:

- **T20 REFUTED** (invalid state not found; still holds after the fixes): start ok (v=1); break the manifest, `ok=False v=2`; fix by writing a temp file and `os.replace` (an editor's save), `ok=True v=3`; a half-written scene gives `ok=False`, completing it `ok=True v=5`; two tabs each got 5 events; one tab closed without a goodbye and the next change still built (`v=6`); `port in use -> SystemExit('cannot start the server on port ...')`; `stop took 0.02s`.
- **T21** (information): 20 saves over 2.9 s caused 6 rebuilds because the watcher coalesces inside its 0.25 s tick; every rebuild reloads every tab. Each rebuild of a 16 MB scene page is serialized under `_lock`, and a `GET /` during it waits. Not a defect.
- **T19 FIXED (6ebc83e)**: `pack dev` on an unparseable `pack.yaml` ends with `PackError` and a traceback. `DevState` survives (error page), but `serve()` calls `packmod.watched_files` for its banner line ([packdev.py:249](paperdolls/packdev.py:249)), which raises; `cmd_pack` catches `OSError` only. The server never starts, so the "fix the file and save, this page reloads" promise of the error page does not apply to the one case it is most useful for (a first typo).
- REFUTED: rename-over saves (temp file then replace) and a deleted-then-recreated runtime file: `stat` failures are recorded as `None` and the next poll rebuilds; the existing test `test_dev_server_survives_a_deleted_runtime_file_and_a_scene_change` covers deletion.
- REFUTED: handler reads `st.html` after `st.refresh()` without the condition lock; a rebuild between them serves the newer page, which embeds its own newer version, so the client is consistent.
- SUSPECTED, no repro: with a manifest that does not parse, `_signature` watches the manifest and scene only ([packdev.py:86-87](paperdolls/packdev.py:86)); a runtime file edited in that window is picked up at the next manifest save. Harmless because the fix is a manifest save.
- **T30 FIXED (b5a3f6d)**: `--include` files are watched, but `check` is called without `include` ([packdev.py:114](paperdolls/packdev.py:114), also [pack.py:772](paperdolls/pack.py:772) and [packcheck.py:302](paperdolls/packcheck.py:302)), so a runtime that `require`s an included file living in the pack folder is refused: `undeclared_scripts(include)=[]; build refused: the pack does not validate: runtime.js refers to ./prng.js, a file of the pack that is not inlined into the page`. `test_an_include_file_counts_as_declared` covers `undeclared_scripts` with include, not these call sites. An include outside the pack folder is not scanned, so it works.
- Two `pack dev` processes on one pack: independent, each with its own port; there is no shared output. Two on one port: the second fails with the message above (T20). Not a shared-state hazard.

### M6. Pack check (`packcheck.py`, `cli.cmd_pack` check branch)

Identity: `packcheck.run` [packcheck.py:300](paperdolls/packcheck.py:300); explicit `Result`; steps: manifest (`pack.check` plus `static_checks`), runtime under node, scene bind, parity.
Exit code: 0 ok, 1 errors, 2 could not run.

Invariant: the runtime run in node is the runtime the manifest names. The sources are read separately ([packcheck.py:325](paperdolls/packcheck.py:325)) from the validation, so the same repeated-read caveat as M4 applies (T16 pattern). Every error path before the run is a returned `Result`, not an exception, **except** `pack.validate` itself (T28).

- **T28 FIXED (6ebc83e)**: `pack.validate` raises `TypeError` instead of reporting, for two classes of invalid manifest: (a) `entities.*.fields.*.values` holds a non-string and a categorical `scale.values` key is not among them ([pack.py:419](paperdolls/pack.py:419) `', '.join(legal)`); (b) a param `group` that is truthy and not a string, and a layout `groups` entry naming a missing group ([pack.py:558](paperdolls/pack.py:558)). Observed: `a: TypeError: sequence item 1: expected str instance, float found; b: TypeError: sequence item 0: expected str instance, int found; cli pack check: exit=1 TypeError: sequence item 4: expected str instance, float found`. `pack dev` turns it into an error page that says `TypeError: ...`; the JS validator reports the real problem (`each value is a string...`).

### M7. Intake interview (`intake.py`, `cli.cmd_intake`)

Identity: `Intake` [intake.py:77](paperdolls/intake.py:77); explicit state machine. The state is the file `render.yaml` itself: answers at dotted paths, plus an `intake:` block (`version`, `defaults`, `override_keys`, `overrides_answered`, `shown`, `confirmed`). The question bank is `assets/intake_questions.yaml` (`when`, `always_ask`, `default`, `default_from`).

Per question, derived state ([intake.py:434-449](paperdolls/intake.py:434)): `missing`, `default`, `answered`, `invalid` (stored value no longer passes `parse`); a question that does not apply (its `when` is false) is absent. The interview state is `ask`, `fix`, `confirm`, `complete` ([intake.py:394-416](paperdolls/intake.py:394)).

Invariants and the lines that keep them:

1. Every stored answer passes `parse`: checked on write ([intake.py:268](paperdolls/intake.py:268)) and again on read (`check_existing`, `fix` status).
2. A confirmation refers to exactly the answers shown: `shown` is the hash of everything but `intake`; `confirmed` is true only while `shown == hash` ([intake.py:332-356](paperdolls/intake.py:332)); any `answer` calls `withdraw_confirmation` ([intake.py:271](paperdolls/intake.py:271)).
3. A goal change removes the other branch's answers ([intake.py:303-307](paperdolls/intake.py:303)).
4. `confirmed yes` is only accepted after `show` of the current table ([intake.py:342](paperdolls/intake.py:342)).
5. The file is always valid YAML holding the answers so far. **Not maintained** (T24).
6. One writer at a time. **Not maintained** (T23).

| From | Event | Guard | To | Side effects | Line |
|------|-------|-------|----|--------------|------|
| (none) | `init` | file absent or `--force` | `{intake: {version: 1}}` | `--force` also discards answers and confirmation | 90-95 |
| any | `answer id value` | id known, question applicable, value parses | same or next question | writes the answer, applies `after` side effects, withdraws confirmation, rewrites the file | 259-273 |
| any | `answer id value` | out of order but parseable (for example `model.params.n` before `model.source`) | | `model.source` later keeps `n`, `run_time`, `seed` | 308-319 |
| any | `answer look.look` before region | | rejected | `IntakeError` from `options()` | 126 |
| any | `answer replay.weeks` before `run_time` | | rejected | | 197 |
| any | `answer` twice, same value | | same | idempotent, withdraws confirmation | 268-271 |
| ask | `next` | default exists, not `always_ask` | default applied | writes the file | 407-410 |
| confirm | `show` | no missing or invalid | confirm, `shown` set | writes the file | 452-474 |
| confirm | `answer confirmed yes` | `shown == hash` | complete | | 342-347 |
| complete | `answer` anything | | confirm | confirmation withdrawn (T26) | 271 |
| complete | hand edit of `render.yaml` | | confirm | hash differs, `confirmed` false (T26) | 356 |

Sound (T26 REFUTED, nothing stale): `confirmed yes` before `show` is refused; an answer after confirmation withdraws it; answering the same question twice is accepted and idempotent; a hand edit after `show` makes `confirmed` false. A hand-written `render.yaml` with no `intake:` block skips the gate by design ([spec.py:185-187](paperdolls/spec.py:185)).

Reachable invalid states:

- **T23 FIXED (4c48c0c)**: `Intake.__init__` reads the file, `save` rewrites all of it ([intake.py:84, 97-100](paperdolls/intake.py:84)). Two instances that load before either saves lose the first answer: `after both answers: goal=None name='my project' (a's answer is gone; both commands printed OK)`. Real overlap needs two processes within a few milliseconds; the interleaving was injected between load and save of two instances. Likelihood depends on the driving model issuing parallel tool calls.
- **T24 FIXED (0180458)**: (a) a file cut inside a flow sequence gives `yaml.YAMLError` out of every command (`cmd_intake` catches `IntakeError`); (b) a file cut to zero bytes: `exit=0 status=ask progress={'answered': 0, 'of': 6}` while `goal` and `name` had been answered: the interview silently restarts, and the user's earlier decisions are gone from the file with no message. `save()` is a plain `write_text`, so a kill mid-write is the cause of both; a non-dict YAML document (a list) fails with `AttributeError` at `self.data.items()` (SUSPECTED, same cause, not run).
- **T25 FIXED (4c48c0c)**: changing `goal` deletes the other branch's answers but not their bookkeeping. After `model_replay`, `model.source=vendored`, overrides answered, `goal=place_scene`, `goal=model_replay`, `model.source=vendored`: `overrides_answered=True; question state=answered; model.params has 37 keys, rebuilt from the preset`. `apply_overrides` also "undoes" stale `override_keys` against the new preset. The overrides question is not asked again, and `show` prints `you said` for values that were reset. Likelihood low.
- **T27 FIXED (6ebc83e)**: `spec.validate` does `int(params["n"])` ([spec.py:80](paperdolls/spec.py:80)); `n: abc` or `n:` (null) is `ValueError`/`TypeError`, caught nowhere (`cmd_validate` and `_replay_spec` catch `SpecError`). A hand-written spec only; the intake parses `n` as an int.
- Half-written `render.yaml` while the gate reads it: `require_confirmed` loads YAML itself ([spec.py:185](paperdolls/spec.py:185)) and fails the same way as T24(a).

### M8. Export, trajectory file and replay build (`export.py`, `replay_build.py`, `cli.cmd_export/frames/build/replay`)

Identity: implicit; the state is the `.npz` trajectory on disk and the spec. `run_and_export` [export.py:129](paperdolls/export.py:129) writes with `np.savez_compressed` ([export.py:158](paperdolls/export.py:158)).

Invariants: the trajectory named in the next command exists and has the weeks the spec asks for; the replay page's `n` is the number of model buildings and the scene has at least that many ([cli.py:118-120](paperdolls/cli.py:118)); model variables used by the mapping are in the file ([cli.py:113-116](paperdolls/cli.py:113)).

- **T22 FIXED (0180458)**: `export --out traj` prints `wrote .../traj` and `traj.npz` is what exists: `export exit=0 printed 'wrote /tmp/.../traj'; file 'traj' exists=False; files=['render.yaml', 'traj.npz']; next command exit=1: FileNotFoundError`. Cause: numpy appends the suffix. Not atomic either; a kill during the save leaves a truncated zip that `np.load` rejects with `BadZipFile` (SUSPECTED, not run).
- **SUSPECTED**: `replay.weeks` are validated against `run_time` ([spec.py:84](paperdolls/spec.py:84)), but the trajectory records only the weeks the model calls the hook for (`weeks_recorded`); a model that stops early makes `codes_for_week` raise `IndexError` in `cmd_frames`. Blocked on a model that stops early: the toy model in `tests/` always runs every week and the vendored model is not installed here.
- REFUTED: `cmd_replay` with a scene smaller than the model is refused with a clear message ([cli.py:119](paperdolls/cli.py:119)); non-finite values in variables become `null` in the payload (`_clean`).

### M9. bindScene flow (`viz/packruntime.js`, `viz/packhost.js bindRenderer`, `viz/packstore.js bindScene`)

Identity: `PackRuntime.bindScene(manifest, impl, scene)` [packruntime.js:60](viz/packruntime.js:60); pure function; result `{ok, bound, error, warnings, counts, attrs, pos}`; consumed by `bindRenderer` [packhost.js:179-189](viz/packhost.js:179) and by `packcheck.js`.

States of one binding: `unbound` (runtime has no `bindScene`: `{ok:true, bound:false}`, invented placement), `failed` (`ok:false`), `bound` (`pos[name]` is an `Int32Array` of scene indices, `-1` for not drawn).

Invariants: `sceneIndex[name].length === count` ([packruntime.js:74](viz/packruntime.js:74)); each scene building is used by at most one entity ([packruntime.js:82](viz/packruntime.js:82)); an unknown id is a warning, not an error; `pos` has an entry per returned entity.

Transitions: exception in `impl.bindScene` becomes `failed`; wrong shape becomes `failed`; entity not in manifest becomes `failed`; null/undefined id gives `-1` silently; unknown id gives `-1` and a warning; second claim of a building gives `-1` and a warning.

Findings (`bindscene_repro.js`; `B` labels mean "observed", the verdict is here):

- **B01** duplicate scene ids: the scene key map keeps the first ([packruntime.js:67](viz/packruntime.js:67)); the toy runtime lists the id twice; observed `pos = [0,-1,2]` with the warning `1 building entities share a scene building with an earlier one (w1): not drawn`. Handled with a warning, but the message blames the model, not the scene (the real cause is M3, T11), and one residential building is silently left out of the model.
- **B02** a runtime that returns `'1'` for a scene id `1`: Map lookup is strict, `pos=-1,-1`, warning names both ids. Handled with a warning.
- **B03 CONFIRMED (silent), not in this fix set**: `bindScene` returning `{entities:{}, sceneIndex:{}}` while the manifest declares `building` from `scene`: `ok=true bound=true counts={} pos keys=<none> warnings=0`. `bindRenderer` sees `bound.pos[en]` undefined and falls back to the invented placement ([packhost.js:181](viz/packhost.js:181)), so the page draws entities on invented buildings as if unbound, without the "invented" caveat tied to a bound runtime and with no warning. Impact low (a runtime bug), but it is the one place where a pack author's mistake changes what is drawn without a message. Owner for the fix: sm-runtime/`packhost.js`.
- **B04** zero buildings, or none residential: the toy runtime throws, `PackRuntime` returns `ok:false` with `bindScene: the scene has no residential buildings to bind to`. Handled; whether the page shows it is sm-runtime's.
- **B05** `neighbours` naming `ghost`, itself, or repeated: observed `attrs.neighbours=[[1,0,1],[0]]` (the unknown is dropped, the self link and the repeat survive). The ingest never produces these; a hand-made scene can.
- **B06** missing, `0` and `"0"` ids: addressed as `#0`, `#1`, `0`, `"0"`, all distinct. REFUTED.
- **B07** entity count above the buildings the scene has: extras get `-1`; only unknown ids warn, `null`/`undefined` stay silent by documented design.
- **B08** NaN footprint with no `area`: the toy runtime computes `area` as NaN (JSON null) and derives units and hubs from it. Reaches the model; the ingest always sets `area`.
- `pos` of `-1` is handled downstream: `modelOf` and `index` ignore negative entries ([packhost.js:186](viz/packhost.js:186), [packstore.js bound](viz/packstore.js:178)); not attacked further here.

### M10. Validators: `pack.py`, `viz/packvalidate.js`, `schemas/pack.schema.json`

Identity: three implementations of one rule set, stated to agree on `tests/pack_cases.json`. The existing test compares the first two on the cases only.

Method: `validator_diff.py` generates 3000 manifests from the base case with 1 to 3 random mutations (wrong types, empty, NaN, inf, 2**70, deleted keys, extra keys) and runs `pack.validate`, the JS validator (through `validator_diff.js`, NaN/Infinity as JS literals, which is what the page contains) and the schema. Observed (`validator_diff.out.txt`):

```
{"total": 3000, "py_crash": 37, "js_crash": 0, "verdict_differs": 0, "message_set_differs": 268, "schema_accepts_but_both_reject": 101, "schema_rejects_but_both_accept": 44, "both_accept": 249}
```

- **Verdicts (errors empty or not): Python and JS never disagree** on the 2963 manifests where Python returned. REFUTED as a state disagreement.
- **37 Python crashes, 0 JS crashes**: T28 (above).
- **268 message-set differences**, all cosmetic: Python prints `None`/`nan`/`inf`/`[None]` and JS prints `undefined`/`NaN`/`Infinity`/`[object Object]` for the same bad value; `str(True)` versus `true` for non-string YAML keys. Messages are used verbatim in the dev error page and in `pack check`, so an author sees two wordings for one problem. Low.
- **Schema versus validators**: 101 manifests the schema accepts and both validators reject (expected: the schema is structural only; cross-references such as an unknown entity, a preset value out of range, a default outside min/max are semantic). 44 the schema rejects and **both validators accept**: unknown keys inside `scale.values.<v>` entries and inside enum `{value, label}` entries (the schema has `additionalProperties: false`, the validators ignore extra keys there), and a non-string `scale.label` (validators only warn "missing"). A pack with such keys passes `pack check`, builds, and is rejected by an editor using the schema.
- Not covered by the fuzz and agreed by reading: `time.speed`/`speeds`, `runtime.files` rules (Python only checks existence on disk; JS has no disk), `norm_file` (Python only; JS cannot see paths, the browser never needs it).

### After the fixes: new guards, invariants and transitions

Shared helpers (`d8401e2`): [paperdolls/fsutil.py](paperdolls/fsutil.py) has `write_atomic` (temp file in the target's folder, fsync, `os.replace`, temp removed on failure),
`write_atomic_group` (stage every file and check every target before the first replace; the caller lists the reports first and the scene last), `file_lock`
(advisory `flock` on `.<name>.lock`; `msvcrt` on Windows, not exercised here) and `read_yaml_mapping` (an unreadable, unparsable, empty or non-mapping file is an
error that names the file). `cli._run` is the error boundary: `SystemExit` passes through; known types (`OSError`, `ValueError` and so `SpecError`, `IngestError`,
`FetchError`, `PlaceError`, `PackError`, `IntakeError`; `HTTPException`, `BadZipFile`, `YAMLError`) become `error: <one line>` and exit 1; anything else prints `internal error: ...
re-run with --debug` (or `PAPERDOLLS_DEBUG=1`) and exits 1, with the traceback under `--debug`. `tests/conftest.py` now refuses any non-loopback connection, so no test can reach Overpass.

**M1 Overpass fetch.** Invariants now holding: `out_path` is written atomically and only ever holds an object with a non-empty `elements` list (`fetch.py`); every failure is
`FetchError`. Rows changed:

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| requested | body cut short (`IncompleteRead`, any `HTTPException`) | | rejected | `FetchError("the download ... was cut off ... Nothing was saved")`, hint to retry or use overpass-turbo |
| body read | JSON but not an object, `elements` not a list | | rejected | `FetchError("... not an Overpass result")` |
| body read | otherwise | | saved | `write_atomic` |

**M2 Place and the extract cache.** New state file `extract.meta.json` = `{relation, bbox, query_version, query_sha256}` written after a fetch. Invariant: `extract.json` is used only
when it parses as an object with `elements` AND its record equals the key of the current spec; the key includes a hash of the query text, so editing the query also invalidates.

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| any | `place` | record equals key, file parses | (unchanged) | no fetch |
| any | `place` | record differs (new bbox, new relation, new `QUERY_VERSION`) | extracted | refetch; warning `fetched a new extract: extract.json was fetched for bbox A, not for bbox B` in the report |
| any | `place` | no record, but `query.ql` is exactly this query (a hand export saved as the message told the user) | extracted | record written, file used |
| any | `place` | no record and no matching `query.ql`, or file damaged | extracted | refetch |
| any | `place --no-fetch` | extract unusable | query saved | `PlaceError` naming the reason and `place --refetch` |
| extracted | ingest error on a cached extract | | extracted | `PlaceError("the ingest failed: ... run 'paperdolls place --refetch' ...")` |
| extracted | ingest ok | | scened | `write_atomic_group`: `scene_report.md`, `scene_report.json`, then `scene.json` |
| any | `place` | hand-written place block missing a field | | `SpecError` from `spec.validate` (`_validate_place`), or `PlaceError` from `run` |

`place --endpoint URL` was added so tests and repros use a local fake. `overpass_query(relation, bbox)` now filters by both. A legacy `out/` folder from before the fix has an
extract with no record: it is refetched unless `query.ql` matches (the normal `place` flow wrote it), which is the one-time cost of the change.

**M3 Ingest.** Invariants 1 to 4 now hold (`build.py`, `validate.py`): ids are unique (the first is kept, later ones counted under `skipped`), footprints are simple (`geo.ring_self_crossings`,
proper crossings only), every number is finite (features with a non-finite or out-of-range latitude/longitude are dropped and counted; `allow_nan=False` on write), an empty scene is
warned about with the reasons. `validate_scene` (a port of the `validateScene` rules the ingest must meet) runs before the report is built; a violation is an `IngestError` and nothing is written.

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| (start) | read file | element lacks `type`/`lat`, or the JSON is not an object | `ValueError` naming the file | `ingest failed:` exit 1 |
| (start) | `--max-buildings N` | N below 1 | `IngestError` | exit 1 (0 no longer means no limit; leave the option out) |
| (start) | `--bbox` | not four finite numbers, south not below north or west not below east | `IngestError` / exit 1 | |
| features | any coordinate not finite or out of range | | feature dropped | `skipped` + warning |
| clipped | project buildings | ring crosses itself | dropped | `skipped["building footprint crosses itself"]` + warning |
| clipped | project buildings | id already used | dropped (first kept) | `skipped["building with an id already used (kept the first)"]` + warning |
| built | no buildings in the scene | | scene still written | warning with the counts of why |
| built | `validate_scene` finds errors | | `IngestError` | nothing written |
| scene | CLI | | one group write | reports first, scene last; a bad target replaces none |

Real data: the Jette extract (relation 58258, 9,214 buildings, 1,320 roads, 1,089 landuse, 8,705 trees) gives a scene, `scene_report.json` and `scene_report.md` identical to aa2d936's apart from `area.generated`
(Jette has no duplicate id and no self-crossing footprint); the committed fixture scene is reproduced by a test.

**M4 Pack check and build.** Invariants now holding: what is built is what was validated (one read of `pack.yaml`, one read of each runtime file, `pack._Sources`); the page parses
(`viewer_build._fill` substitutes in one pass, so put-in text is never rescanned); `runtime.entry` is a relative path inside the folder, also after symbolic links; the output is complete or absent.

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| (start) | `pack build` | scene loads | scene held | |
| scene held | read `pack.yaml` | once | manifest held | |
| manifest held | `check(path, include, manifest, sources)` | errors (including entry/files outside the folder, symlink escapes, an unincluded required sibling) | `PackError` | exit 1 |
| validated | read runtime files | once each, same bytes as the check | sources held | `</script`/`<!--` still refused |
| sources held | fill template | one pass: manifest, scene, title, runtime source | page | markers inside them stay text |
| built | size over budget | trim stages, as before | `PackError` if still over | |
| built | write `--out` | | done | `write_atomic` |

**M5 Pack dev.** T19: `serve()` no longer needs a parsed manifest for its banner, so `pack dev` on a first typo serves the error page and reloads on the fix. T30: `include` is passed to `check`.

**M6 Pack check.** `packcheck.run` reads the manifest and the runtime files once and passes them to `check`; `--include` is honoured. T28: `pack.validate` is total.

**M7 Intake.** Invariant 5 (the file is always valid YAML holding the answers so far) now holds by atomic replace; invariant 6 (one writer at a time) by an advisory lock.
Rows changed:

| From | Event | Guard | To | Side effects |
|------|-------|-------|----|--------------|
| any | `answer`, `confirmed`, `next`, `show` | lock `.render.yaml.lock` free | transaction | read the file as it is now, change, atomic write, release; re-entrant (`answer` calls `confirm`) |
| any | any command | file unparsable, empty or not a mapping | `IntakeError` (exit 3) naming the file | the file is left as it is |
| any | `answer goal X` | branch removed | the other branch's answers go with their bookkeeping | `defaults` entries under the removed keys, `override_keys`, `overrides_answered` removed (`model` branch) |
| any | `answer goal X` | same goal again | unchanged | |

`spec.load` and `require_confirmed` report an unreadable project file as `SpecError`. T27: `n` and `run_time` must be whole numbers (`SpecError`).

**M8 Export.** `run_and_export` normalises the name to `.npz`, writes atomically and returns the real path, which `export` prints; `export.load` finds `traj.npz` for `traj`, and a truncated archive is a message (`ValueError`).

**M10 Validators.** After the fixes `validator_diff.py 3000 1` reports `{"py_crash": 0, "js_crash": 0, "verdict_differs": 0, "locations_differ": 0, "schema_rejects_but_both_accept": 0, "disagreements": 0}`; the same for
seeds 1 to 12 (36,000 manifests). `wording_differs` (281 for seed 1) counts messages that flag the same places but print a bad value differently (`None`/`null`, `nan`/`NaN`, `{'a': 1}`/`[object Object]`);
`schema_accepts_but_both_reject` (101) is the expected semantic gap. Rules made equal in `pack.py` and `viz/packvalidate.js`: unknown keys in `scale.values.<v>` and enum `{value, label}` entries,
a non-string `scale.label`, `group` only on `groundtint`, `runtime.entry` a relative path inside the folder, `spec: true` is not 1, a preset key naming a parameter whose definition is falsy, the banner truthiness, and the
"no entry for" warning (strings only, own keys only). A bounded version runs in the test suite (`test_the_three_validators_agree_on_mutated_manifests`, 2 x 600 manifests).

#### Changes to the repros

`tooling_repro.py`: a guard refuses any non-loopback connection (running T05/T06 against the fixed code first reached the public Overpass: see "What went wrong while fixing"); T05 and T06 use `fake_fetch`;
T05 first runs `place` for the small bbox, then enlarges; T06 also checks the `--no-fetch` message; T12 treats the refusal as holding; T14 expects nothing replaced; T16 injects the edit after the first manifest read (the
`check()` hook no longer exists in `build`); T17 treats a refusing `build` as holding; T18 uses `write_atomic`; T22 gives its spec `replay.registers` and checks the printed path exists. `validator_diff.py` has `compare(n, seed)` with the hard-disagreement counters.
Outputs: `tooling_repro.out.txt` (T01 to T30 all `REFUTED`: the code holds), `validator_diff.out.txt`; `bindscene_repro.out.txt` is unchanged (the B cases are runtime-layer, owned by `fix-runtime`).

#### What went wrong while fixing, and what is not fixed

- **Two real Overpass requests were made by accident.** The committed T05/T06 repros called the real `fetch_overpass` once the cache was keyed (before, nothing was fetched). Running them once against the fixed code sent one bbox request each
  (50,4,50.01,4.01 and a larger one) to overpass-api.de from a temp folder; nothing was kept. The guard and `fake_fetch` above make that impossible; `tests/conftest.py` has the same guard.
- **New finding, fixed in `db9bb18`:** an out-of-range latitude (95) made aa2d936's ingest not finish within 15 s; it is now dropped like the other non-finite coordinates.
- Not fixed: the SUSPECTED items that need a real server or kill (slow-trickle download that never times out; an Overpass answer with a `remark` that does not contain "error"; kill during `write_bytes` is now atomic but a slow trickle is not bounded).
  Two `ingest` processes on one `--out` can still interleave at the granularity of whole files (each file is atomic, the group is not); the order reports-then-scene keeps a reader that sees the new scene reading its reports.
  `place` with `kind: scene_file` still copies the file as given (it checks the four lists only; the viewer validates). The `.lock` file stays beside `render.yaml`. `file_lock` on Windows (`msvcrt`) is written but not exercised. Message wording
  differences between the validators for bad values remain by design of the fuzz (counted, not failing). B01 to B08 (the runtime layer) were not touched.

### Implicit machines checked and found sound

- `readers.assemble_rings`: open relations are counted and reported (`open_relation_fragments`, `open_relations`), not silently dropped ([build.py:370-371](paperdolls/ingest/build.py:370)).
- Size trimming (`pack.TRIM_STAGES`): monotone, reports what was lost, never removes the fields the renderer and `bindScene` need.
- `DevState` scene cache: a failed scene load keeps the previous scene object but not its signature, so a fixed file reloads.

### Suggested issue grouping (done: A-G are GitHub issues #8 to #13, all fixed, see the top)

A. Caches and outputs without identity or atomicity: T05, T06, T14, T18, T22, T24 (extract keyed by the query; atomic write helper used by ingest, place, pack build, export, intake).
B. Exceptions that escape CLI boundaries: T01-T03, T07, T08, T19, T27, T28 (one catch-and-hint layer; `FetchError` for every network failure; `PackError`/`SpecError` for malformed input).
C. Ingest output not validated: T09-T13, T29 (unique ids, finite coordinates, warn on zero buildings, simple polygons, argument checks).
D. Repeated reads in `pack.build`, the unconfined `runtime.entry`, and `include` not passed to `check`: T16, T17, T30.
E. Template substitution over inlined content: T15 (substitute once, in one pass, or put the runtime in last).
F. Intake state: T23 (lock file or read-modify-write with a compare), T25 (reset bookkeeping with the branch).
G. Validators: T28, message normalisation, schema/validator agreement on unknown keys.

## Part 30 · Rendering engine

Base: `main` at aa2d936 (findings); fixes by `claude/fix-render-perf-ceb6f0` (#3, #14, #17, #18, #19, #22) and `claude/fix-render-geo-1d1d94` (#15, #20, #21), merged on `main`. Scope: `viz/vizlib.js` (renderer loop, ground and far layers, far-layer patching, entity drawing, agents, sim, `validateScene`, `setTheme`), `viz/assetlib.js` (sprite cache, themes, asset cache), `viz/buildinglib.js` (`fitFootprint`, asset parameters), `viz/camera.js`, `viz/controls.js`, `viz/zoomhold.js`, `viz/refocus.js`, `viz/packpick.js` and the highlight code of `viz/packhost.js` (`drawChannels`, `bindInteraction`), `viz/replay.js`, `viz/viewer.html` and `viz/packhost.html` (page state), `docs/known-issues.md`. No engine code was changed. Evidence is in `docs/state-machines/repro/` (`_render.js` plus `r30` to `r38`).

How the repros work: the **real** `viz/*.js` files are loaded into a `vm` context on node-canvas (`_render.js`). The only fakes are the clock and the event source. `performance.now()` inside the engine is a counter that moves 0.25 ms per read (`R.clock.set(step)`), so every time budget (`layerMs`, `buildMs`, `prewarmMs`, the 20 ms coarse budget) is a fixed number of clock reads and a run is identical on every machine. There is no rAF and no sleep: one call of `renderFrame` is one frame; zoom, pan, resize and state changes are applied between calls. Canvas calls are counted by wrapping `getContext` (`R.census`). Wall-clock milliseconds appear only where the ratio is the point (R36, R37) and are marked. Run from the repo root:

```bash
PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules node docs/state-machines/repro/r31-outline-halo-ignore-z.js     # or any r30..r38
PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules sh docs/state-machines/repro/run-all.sh                         # all repros of parts 10 and 30
```

Observed output of the last run is committed next to each script (`rNN-….out.txt`). `run-all.sh` runs r30 to r38 too (about 3 minutes in total; its per-script timeout is now 180 s because r36 takes about 80 s).

### Summary: confirmed bugs, most harmful first (grouped by cause = one issue each)

Impact is for the Great Retrofit demo (a policymaker pans and zooms a Jette-scale map while a model plays); likelihood is for someone doing that.

| # | Bug | Repro | Impact | Likelihood | Group |
|---|-----|-------|--------|------------|-------|
| 1 | **FIXED (ca30ea1)** **Outline, halo, selection halo, the visibility test, ground tint and ground marks are placed at ground height 0** (known: paperdolls#14, reproduced here). On a hill the highlight floats `z x scale` px below its building (90 px at 36 m and 2.5 px/m); `vis()` culls a building that is on screen and draws one that is 115 px off screen | R31 | High: a wrong picture on every hilly scene, in the feature the pack exists to show | Certain on Jette | A |
| 2 | **FIXED (ca30ea1)** **Ground marks (the far-zoom form of outline and halo) are redrawn from scratch every frame**: a clip and a hatch of strokes per cell, uncached. With them on, an idle settled far frame costs 6.6x (200 m cells) to 8.0x (100 m cells) of a plain one. This is the "enriched far zoom is about 10x slower than plain" half of paperdolls#3 | R36 | High: the demo's first screen | Certain for any pack with an outline or halo mapping at default `lod` | B |
| 3 | **FIXED (9e3b425)** **The idle far view is two canvas-to-canvas blits of 3.24x-view layers plus a full redraw on every animation frame, and there is no readback in that path at all.** The "per-frame `getImageData`/readback" explanation of paperdolls#3 is not what the code does: 0 `getImageData`, 0 `putImageData` per frame (default options), 2 `drawImage(canvas)` of 2.7 Mpx (DPR 1) or 10.9 Mpx (DPR 2) on 1200x700, about 9,900 sprite canvases created during the first paint. See §6 for what this leaves as the cause (not reproducible without a GPU) | R30 | High (demo risk) | Certain on a GPU browser | B |
| 4 | **FIXED (12a6d8b)** **The per-frame sprite build budget is bypassed whenever colours change on a settled view**: 362 sprites built in one frame (budget 60 and 8 ms), 370 ms in node, because the over-budget fallback only reuses a sprite already held for the same colours. One model month that recolours 400 visible buildings is a 0.3 s frame at neighbourhood zoom, then 32 builds a frame for ten frames | R37 | High: judder at every month of a playback below street zoom | High for any pack that recolours on time | C |
| 5 | **FIXED (12a6d8b)** **Sprite cache cliff**: past 90 Mpx `evict()` drops everything farther than 2.7x and, if still over 72 Mpx, clears the whole cache including the sprites the frame is using. At DPR 2, 10 px/m, 1920x1080 the placeholder city alone settles at 79.5 Mpx, so a slow pan hits it (at frame 175 here: 471 sprites dropped) | R34 | Medium: a rebuild hitch, no wrong pixels | Medium at DPR 2 and street zoom | C |
| 6 | **FIXED (303de53)** **`A.sprites.dpr` is read once at page load.** `resize()` sizes the canvases at the new DPR but layers and sprites stay at the old one (browser zoom, moving to another monitor): the picture is the low-resolution layer scaled up (541k of 8.6M bytes differ in R35c) and, the other way, 4x oversized layers | R35c | Medium: blur or wasted memory until reload | Medium (ctrl+wheel in a browser, a second screen) | D |
| 7 | **FIXED (303de53)** **The far layer is not keyed on the sprite `exact` flag**: a layer painted in the first two frames of a view (every new sim after `rebuild()`, region switch, first load) keeps octave-bucket sprites for good. At DPR 2 and 0.8 px/m 682k of 8.6M bytes (8%, up to 193 levels) differ from the exactly painted one | R32 | Low: softness, history-dependent | Certain for a new sim, visible only at DPR 2 between about 0.5 and 1 px/m | D |
| 8 | **FIXED (ca30ea1)** **A replay with a mapping installs a non-versioned `buildingStyle`, which switches the far layer off**: every building is drawn through the style callback every frame (1023 calls a frame in R35b; 9,214 on Jette). The pack page is not affected (its style is versioned) | R35b | Medium (old replay page only) | Certain there | B |
| 9 | **FIXED (ab851b9)** **Degenerate footprints (collinear or repeated points) pass `validateScene` and get `fit = {cx: 0, cy: 0}`**: painter's order, pick order and the terrain height all use the origin (R35a: sort key 4 instead of about 626; `e.z` 4 m where the terrain is 16.2 m) | R35a | Low to medium: a wrongly ordered or wrongly lifted building | Low (needs such a footprint in the OSM data; the ingest keeps only area >= 8 m2 but the viewer accepts any scene file) | E |
|  | **FIXED in `ab851b9` (#20):** `fitFootprint` returns the bounding-box centre for a degenerate hull (sort key 626.4, `e.z` from the terrain at that centre); `validateScene` counts them in a warning; test `viz/test_geo.js` | | | | |
| 10 | **FIXED (ab851b9)** **`levels` has no upper bound in `validateScene`**; an extruded (non-asset) building with 200,000 levels costs 1.0 s per frame (66 ms at 4 levels), every frame | R35f | Low to medium | Low | E |
|  | **FIXED in `ab851b9` (#20):** `MAX_LEVELS = 60` (the ingest's cap) applies in `createSim` (`e.levels`, params, archetype pick) and `drawBuilding`, with a counted `validateScene` warning; 200,000 levels now costs 16 ms (was 1,069 ms); the scene is not mutated | | | | |
| 11 | **FIXED (4dc3b43)** Small: `createSim` shares the scene's building objects, so a replay's `paintStates` leaves states in the scene the next sim starts from (R35d); `AssetLib.theme` caches by `family.id \|\| 'x'` so id-less families collide (R35e); `camera.maxScale` only ever rises (R33); `camera.zoomAt(NaN)` makes the scale NaN for good and nothing guards it (R35g) | R35d, R35e, R33, R35g | Low | Low | F |
|  | **FIXED in `4dc3b43` (#21):** `createSim` copies each building object (shallow; the footprint array stays shared); `AssetLib.theme` keys an id-less family by object identity (WeakMap); `camera.maxScale = max(opts.maxScale, 2 * minScale)` is recomputed on every fit, so it follows the scene down as well as up; `camera.zoomAt` ignores a NaN, zero, negative, infinite or non-number factor and non-finite pivots (`zoomTo`, `setZoomFraction` inherit it); tests in `viz/test_geo.js` | | | | |
| 12 | **Terrain looks faceted** (paperdolls#15, Great Retrofit `merged-build-gaps.md` P3): the relief shade was one grey per cell from the cell's own slope, so the 25 m grid showed as diamonds and staircases on grass and strongly on bare land, and the ingest's nearest-height fill past the DTM coverage showed as streaks at the south and east corners | images `docs/images/terrain-smooth/*_before.jpg` | Low (looks unfinished to a policymaker; no wrong data) | High (every Jette view with terrain) | G |
|  | **FIXED in `1833bf3` (#15):** per-vertex slopes (Sobel; heights blurred first when a cell is under 30 px) interpolated by a software Gouraud rasteriser; the shade fades over the ingest's fill; heights unchanged; cold ground paint on Jette 474 ms (main) vs 452 ms far, 489 vs 510 ms at 1 px/m; see "Terrain shading" below | | | | |

REFUTED (the code holds, evidence in the sections): a stale far layer after a patch, theme or register change, resize, zoom, pan past the margin, tree toggle, segments, overlays or elevation, including events in the middle of a patch pass (R38, 9 scenarios, all equal to a from-scratch painting); a held CSS transform that never clears, a lost end of zoom, re-entrancy of wheel/drag/keys during hold, refine or fade (R33, 300 random runs, 32,831 frames, 0 violations); eviction of a sprite while it is in use or being built (§3); `frameVersion` wrap (§2); hover or selection on a building a patch or `rebuild()` removes (§7); picking in the wrong painter's order with elevation (§7).

SUSPECTED (no repro, see sections): hover tooltip and dashed highlight stay on a building after a key pan (§7); the sprite silhouette of a fitted building differs from the footprint the pick uses (§7).

RESOLVED since the first writing: the GPU-only cost of the 3.24x layers and 9,900 sprite canvases (§6): measured on a real GPU and fixed in 9e3b425.

---

### 1 · Machines at a glance

| id | machine | kind | owner | encoding variables |
|---|---|---|---|---|
| L | World layer slot (`_ground`, `_far`): absent, rough, exact, stand-in, repainting | implicit | `vizlib.js:1032-1100` (`worldLayer`) | `sim[slot]`, `sim[slot+'P']`, `sim[slot+'C']`, `sim[slot+'Spare']`, `L.skey`, `L.sc`, `L.rough`, `L.ver` |
| F | Far-layer patch: index, diff, paint, fallback | implicit | `vizlib.js:1221-1301` (`farGrid`, `farPatch`) | `sim._farPatch {ver, phase, pos}`, `info.grid`, `grid.queue/dirty/qpos`, `info.sigs`, `L.ver` |
| Q | Zoom exactness and pre-render ("still" counters) | implicit, partly global | `vizlib.js:869-884`, `assetlib.js:316` | `sim._zoom {scale, still, moved, stillView}`, `sim._warm`, `A.sprites.exact / zooming / collect / builds` |
| S | Sprite cache: key, build, schedule, evict, prewarm | implicit, global | `assetlib.js:314-415` | `sprites.cache`, `.index`, `.pixels`, `.limit`, `.maxPixels`, `.builds`, `.maxBuilds`, `.maxZoomBuilds`, `.maxBuildMs`, `.frameStart` |
| E | Per-entity draw cache (building, tree, agent) | implicit | `vizlib.js:1353-1441` | `e._ck/_cols/_asset/_fast/_th/_st/_inv/_fv/_seg/_sm/_fdata/_froof`, `a._ck/_cols/_rc/_rcReg` |
| T | Theme, register, region switches | implicit | `vizlib.js:484-496` (`setTheme`), `viewer.html:279-286` | `sim.theme/palette/opts.theme/opts.register`, entity caches, `A.sprites.*`, layer keys |
| H | ZoomHold (stretch the drawn canvas while the scale moves) | explicit (`drawn`, `stretched`) | `zoomhold.js:15-52` | `drawn`, `prevScale`, `lastChange`, `stretch`, `stretched` |
| X | Refocus (live, zoom, refine, fade) | explicit `state` | `refocus.js:14-75` | `state`, `since`, `fadeEnd`, `lockUntil`, `front/back` roles, CSS opacity/transform |
| C | Camera | implicit | `camera.js:15-74` | `cx, cy, scale, w, h, fit, minScale, maxScale` |
| K | Controls: drag, pinch, wheel, keys, eased zoom | implicit | `controls.js:36-132` | `pointers`, `pinch`, `held`, `pend`, `pendX/Y`, `rafId`, `last` |
| P | Pages: viewer and pack page (`rebuild`, scene load, resize, frame loop, replay) | implicit | `viewer.html:105-300`, `packhost.html:176-279` | `sim`, `scene`, `state`, `replay`, `A.sprites.dpr`, canvas sizes, `rf` |
| I | Picking, hover, selection, highlight, outline/halo/marks channels | implicit | `packpick.js:37-76`, `packhost.js:250-332,596-664` | `hover`, `down`, `store.selection()`, `HL {ver, halo, outline, marks}`, `sim.frameVersion` |
| N | Agents: spawn, step, pose, motion | implicit | `vizlib.js:410-452,538-597` | `a.edge/s/dir/side/speed`, `a.motion`, `a.pose`, `sim.time` |
| V | Scene validation and footprint fit | implicit | `vizlib.js:287-331`, `buildinglib.js:360-386` | `check.ok`, `fit {ok, reason, cx, cy, ...}` |
| Z | Terrain and ground height (`z`) paths | implicit | many; table in §8 | `e.z`, `sim.relief`, `sim.terrain`, `sim.zmax` |

One frame, in order (`renderFrame`, `vizlib.js:832-854` -> `renderFrameInner`, `:869-998`): set per-frame sprite flags and budgets; update the exactness counters (Q); decide the ground layer key and call `worldLayer` for `_ground`; draw ground tint and marks; if the far view applies, `farPatch` then `worldLayer` for `_far`, then agents on top, and return; else collect, sort and draw every visible building, tree and agent; then fog, then pre-render neighbouring sprite scales if nothing was built.

---

### 2 · Machine L: world layer slot (`worldLayer`) and the far layer (`_far`)

**States** (per slot; the comment block at `vizlib.js:1102-1124` draws the same machine):
- `ABSENT`: `sim[slot]` undefined.
- `ROUGH`: `L.rough === true`, painted flat by `farCoarse` / `groundCoarse` in one pass, completed by a stepped generator `sim[slot+'C']` (20 ms a frame, `COARSE_MS`).
- `REPAINTING`: `sim[slot+'P']` holds a half-painted second canvas (`p.gen`), the old layer (if any) keeps the screen through `blitScaled`.
- `EXACT`: `L.skey === skey && L.sc === sc` and the view inside the margin (`LAYER_MARGIN` 0.4 of the view each side).
- `STALE (zoom)`: `L.sc !== sc` while the zoom is moving: the old layer blitted scaled (`:1035-1038`), within `LAYER_STAND_IN = [0.15, 8]`.
- `PATCHING` (far only): the machine F below runs on an `EXACT` layer.

**Encoding.** `skey = gkey + '|' + layers.trees` (+ `'|' + h` when `farPatch` is off); `gkey = view.w|view.h|famId|lookId|reg|surface|layers.buildings|detail|ink|posterize` (`:911`). `L.sc = scale.toFixed(4)`. `L.ver` is the signature the layer was last made current for (`null` after a full repaint).

**Invariants**
- L-I1 a layer on screen shows the current theme, size and scale or is a scaled stand-in for it. Maintained by the key (`:911,971`) and `outOfDate` (`:1060`). Holds (R38 A, B, C, D, F, G).
- L-I2 at most one repaint per slot is alive (`sim[slot+'P']`); a new key or scale abandons it and recycles its canvas (`:1065-1068`). Holds.
**Holds since 303de53** (the far layer is painted again once the view settles where exact sprites differ; sprites painted into a layer are exact whatever the frame budget, R32 and `viz/test_render.js`). Was: - L-I3 the pixels of an `EXACT` layer depend only on its key and data. **Violated for `exact`**: the key leaves out `A.sprites.exact` (comment `:974`), R32.
**Holds since 303de53** (`A.watchDpr`; `gkey` and the sprite keys include `q`). Was: - L-I4 the pixel density of a layer is the density of the canvas it is blitted to. **Violated** when `A.sprites.dpr` goes stale (R35c): `q` is read per frame (`:1033`) but the key has no `q`, and the page never refreshes it.

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| any | zoom moving (`zs.still < 2`) | `L.skey === skey`, `L.sc !== sc`, ratio inside stand-in | STALE | blit the old layer scaled, return | `:1035-1038` |
| ABSENT | first far frame | `coarse` painter, `steps`, `softStart`, slicing on | ROUGH | flat layer painted now; `sim[slot+'C']` stepped | `:1042-1049` |
| ROUGH | each frame | coarse generator alive | ROUGH | step 20 ms | `:1051-1055` |
| ROUGH or key changed | zoom stopped or key differs, ratio inside stand-in | no coarse generator running | REPAINTING | new canvas (spare reused), `layerMs` of slices a frame | `:1060-1072` |
| REPAINTING | generator finishes | | EXACT | swap in, old canvas becomes the spare, `L.ver = null`, `layerRepaints++` | `:1073-1077` |
| REPAINTING | key or scale changes | | REPAINTING (restart) | old partial canvas becomes the spare | `:1065-1068` |
| EXACT | view moved past the margin, or settled with a fraction of a pixel | | EXACT (new) | one synchronous repaint (`paint`), spare reused | `:1085-1097` |
| EXACT | `farPatch` fallback | more than 20% changed | outdated (`L.skey = null`) | next frame REPAINTING | `:1264-1265` |
| ROUGH | key or size changes | | REPAINTING | | `:1060` |

**Reachable invalid states**
**FIXED (303de53).** `L.exact` records whether the whole painting used exact sprites; `worldLayer` repaints once when it did not and `A.sprites.exact` is now true and the exact sprite scale differs from the octave one; layer painting sets `sprites.unbudgeted`. R32 now: 0 of 8.6M bytes differ at DPR 2, 0.8 px/m (was 682k). Original finding: - **L-1 · settled far layer depends on paint time. CONFIRMED** (R32). Impact low, likelihood certain for a fresh sim. Cause: `A.sprites.exact` is `still >= 2` (`:875`) and the first exact painting starts in the same frame as the rough one, so its early slices draw octave-bucket sprites (`sb = 2^ceil(log2(scale*q))`) scaled to `scale`; the layer is never repainted when the view settles ("flipped when the view settled and repainted the whole layer a second time for nothing", `:974`). The existing tests hide it by forcing `s._zoom = { scale, still: 10 }` (`viz/test_farlayer.js:23`).
```
$ node docs/state-machines/repro/r32-far-layer-pixels-depend-on-paint-time.js
DPR 1, 0.47 px/m: cold start vs exact-from-frame-0 -> 0 of 2160000 bytes differ, largest channel difference 0  (frames to whole: 23 / 46)
DPR 2, 0.47 px/m: cold start vs exact-from-frame-0 -> 0 of 8640000 bytes differ, largest channel difference 0  (frames to whole: 23 / 46)
DPR 2, 0.8 px/m: cold start vs exact-from-frame-0 -> 682263 of 8640000 bytes differ, largest channel difference 193  (frames to whole: 23 / 46)
```
  (At scale x DPR <= 1 octave and exact sprites are both `sb = 1`, which is why only DPR 2 between 0.5 and 1 px/m shows it.)
**FIXED (ca30ea1).** `Replay.create` with a mapping publishes `sim.frameVersion` and a shared style object per look; R35b now 0 style calls per idle frame (was 1,023). Original finding: - **L-2 · far layer off for a non-versioned style. CONFIRMED** (R35b). `far` needs `!sim.buildingStyle || versioned` (`:962`); `Replay.create` with a mapping installs `style` without a `frameVersion` (`replay.js:88`), so every building is drawn every frame. Impact medium on the old replay page, likelihood certain there; the pack page is versioned (`packhost.js:239,241`).
```
b  replay with a mapping, 1023 buildings, far view (0.35 px/m), 5 settled frames: style calls 5115 (1023 per frame), layerRepaints=1, far layer present=false (typeof frameVersion=undefined)
```
  (`layerRepaints=1` is the ground layer.) The same holds for the viewer's "numeric output" and "plain walls" modes and for any `bindData` on buildings (`:962`, `!sim.bindings.length`).
- **L-3 · the rough ground ignores terrain.** `groundCoarse` projects at z = 0 (`vizlib.js:1175`) while `farCoarse` lifts buildings by `e.z` (`:1152`): for the few frames the rough layers stand, buildings float above a flat ground on hills. Cosmetic, SUSPECTED by reading (no pixel test).
- **L-4 · the spare canvas can be overwritten while it is still `sim[slot]`.** In the synchronous branch the old layer's canvas becomes the spare and is immediately handed back by `layerCanvas` and cleared (`:1089-1093`). If `paint` throws, `sim[slot]` still points at that half-painted canvas with the old key. SUSPECTED: the repro needs a throwing painter, which no input reaches; a subsequent frame with the same key would blit the garbage.
- REFUTED: **stale far layer after a patch, theme or register change, resize, zoom, pan past the margin, trees toggled, segments (k of n), overlays, elevation, or any of these in the middle of a patch pass.** R38 runs 9 scenarios through the real frame loop and compares the final pixels with a sim built in the final state and painted once: all equal.
```
$ node docs/state-machines/repro/r38-far-layer-consistency-matrix.js
A theme change in the middle of a patch pass   same   ...   (B to I: same)
all scenarios equal the from-scratch picture
```

#### Machine F: far-layer patch (`farPatch`)

**States** (`sim._farPatch`): `null` (layer current); `{phase:'index'}` (lookup grid being built, 512 items a step); `{phase:'diff', pos}`; `{phase:'paint'}`. `grid.queue` is the work in depth order, `grid.dirty[n]` marks queued items, `info.sigs[i]` the signature each building was painted with. Signature: the style object for a versioned style, else `charCode(state)*2 + investor` (`:966-973`).

**Invariants**: F-I1 `info.sigs[i]` is the signature that building's pixels were drawn from (maintained at draw time, `:978`, and at diff, `:1258`); F-I2 a pass is only run on the layer it was started for (guards `:1244`); F-I3 `L.ver === h` implies no pending change (`:1246,1296-1299`).

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| null | new signature `h` | layer exact, same key and scale, no repaint running | index or diff | `farGrid` a few ms a frame | `:1244-1249` |
| index | grid whole | | diff | grid built once per layer | `:1221-1238` |
| diff | all items compared | queued <= 20% of buildings | paint | | `:1252-1267` |
| diff | all items compared | queued > 20% | null, `L.skey = null` | `farPatchFallbacks++` | `:1264-1265` |
| paint | queue empty | `st.ver === h` | null | `L.ver = st.ver`, `farPatches++` | `:1296-1298` |
| paint | queue empty | `h` moved on | diff (from item 0) | coalesced | `:1299` |
| any | layer key, scale or repaint changes | | stays set | `sim._farPatch` is not cleared (the guard returns early); the next pass on the new layer reuses the old object | `:1244` |

**Reachable invalid state F-1 · a stale pass object survives a layer change. SUSPECTED, and harmless by the argument below.** `sim._farPatch` keeps `{phase:'diff', pos:N}` from the old layer; the next pass on the new layer starts its diff at `pos` N, so items 0..N of the fresh layer are not compared in that first pass. They were drawn from current data a moment earlier, and any later change moves `h`, so `st.ver !== h` at the end of the pass restarts the diff from item 0 (`:1299`): the exposure closes itself. R38 A, B, C, D and F cut a pass in half and end on the right pixels. What blocked a failing repro: the window is a few frames wide and the change has to land in items 0..N.

---

### 3 · Machine S: sprite cache (`AssetLib.sprites`)

**Key.** `key = asset.id | heading | reg.id | sb | colourKey [| d/D] [| i] [| p<posterize>]`; `ikey` omits scale, detail and ink (`assetlib.js:337-344`). `asset.id` includes the asset parameters, overlays and segments (`getAsset`, `:730-750`; `buildinglib.js:422`). Inputs that are **not** in the key: the CSS scale that sets the ink width (`lwMul`, `:348`; octave sprites reused for several scales keep the ink width of the scale they were built at: a design choice), and `sprites.dpr` (`q` scales the ink width too).

**States** per request: `HIT` (key found), `HELD` (zooming and over budget: a sprite of the same `ikey` within 2.3 octaves is scaled), `BUILD`, `SKIP` (people and vehicles while zooming), `DEFER` (exact, over budget: draw the octave sprite and sharpen later).

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| request | key in cache | | HIT | blit 1:1 or resampled | `:394,412-414` |
| request | zooming, key missing, `builds >= maxZoomBuilds (16)` or time up | a held sprite within 2.3 octaves | HELD | scaled blit | `:399-402` |
| request | same | none held, people or vehicle | SKIP | nothing drawn | `:403` |
| request | exact, key missing, `builds >= maxBuilds (60)` or time up | | DEFER | re-enters `drawSprite` with `exact=false, zooming=true` | `:405-407` |
| DEFER | octave key missing, nothing held | building or tree | BUILD | `builds++`, **not counted against the budget that deferred it** | `:409` |
| BUILD | cache over `limit` (20000) or `pixels + w*h > maxPixels` (90 Mpx) | | evict | drop |ln(sb/wanted)| > 1; if still > 80% clear everything | `:347-350,329-335` |
| pre-render | frame built nothing, view still 8 frames | sprites seen this frame | BUILD x12, 4 ms | neighbouring octaves | `:372-384`, `vizlib.js:851` |

**Invariants**: S-I1 the cache never grows without bound (limit and pixel cap in `buildSprite`); S-I2 `index` lists exactly the cached sprites (rebuilt in `evict`, appended in `buildSprite`); S-I3 every frame builds at most `maxBuilds` / `maxBuildMs` worth (at least one): **violated, S-1**; S-I4 a sprite in use is never invalidated under the draw: holds, `sp` is a local object and `held` re-checks `cache.get(h.key) === h` (`:401`), eviction only deletes map entries.

**Reachable invalid states**
**FIXED (12a6d8b).** Over budget, a building keeps its last sprite (`holder._spk`), else the same shape in other colours (`sprites.staleOk`, screen draws only), and at most 64 buildings are restyled per frame; R37: 16 builds and 41 ms in the first frame (was 362, 370 ms), settled picture byte-identical to a from-scratch one. Transition row: `exact, over budget, nothing held for this look -> draw holder's last sprite / same shape, queue the exact one (built on a later frame)`. Original finding: - **S-1 · build budget bypassed on a colour change. CONFIRMED** (R37). The deferral branch (`:405-407`) assumes a coarser sprite of the same look is held; the `ikey` includes the colours, so a recoloured building has none, and the inner call builds the octave sprite at once (`:409`). Cost: one frame builds about N sprites for N changed buildings.
```
$ node docs/state-machines/repro/r37-build-budget-bypassed-on-colour-change.js
settled: builds in the last frame 0, 2028 sprites cached, 445 buildings on screen; budget per frame: maxBuilds Infinity (during a frame it is 60), 8 ms
frame after the change +0: sprites built 362   <-- budget is 60, wall 370 ms
frame after the change +1: sprites built 32, wall 72 ms
frame after the change +2: sprites built 32, wall 59 ms
```
  The following frames build the exact-scale sprites at 32 a frame (the 8 ms clock budget), so the stall is followed by ten soft frames. In a browser a build costs about 0.8 ms (comment `assetlib.js:320`): about 0.3 s. Likelihood: any pack that recolours on time at 1 to 6 px/m (below 1 px/m the far layer paints in slices and patches, which has its own budget).
**FIXED (12a6d8b).** `evict(sbWanted, needPx)` frees sprites not drawn in the current frame (`sp.used !== sprites.frame`), least recently drawn first, to 85% of the cap, and never clears the cache; R34: 0 sprites of the frame dropped (131 before), biggest drop in one frame under 25% of the cache (471 before). New invariant S-I: a sprite drawn in frame n is in the cache at the end of frame n. Original finding: - **S-2 · cache cliff. CONFIRMED** (R34). `evict` is all-or-nothing above 80% (`:331`).
```
$ node docs/state-machines/repro/r34-sprite-cache-cliff.js
settled (150 still frames): 406 sprites, 79.5 Mpx of 90 Mpx cap; clear-all line at 72 Mpx
pan of 400 frames: cache dropped by more than 20 sprites at 1 frame(s); first at frame 175, largest drop 471 sprites; pixels now 69.3 Mpx
after a clear-all, frames until the still view is sharp and builds nothing: 4 (builds per frame at 60 max: 116,60,2,0,0,...)
```
  (The last line clears the cache by hand to time the recovery; the drop at frame 175 is the real eviction.) Impact: one frame that rebuilds the whole view (and, because of S-1, ignores the budget). At DPR 1 the same view settles at 39 Mpx: no cliff.
- REFUTED: **eviction while a sprite is in use or being built.** Everything is synchronous; `evict` runs before the new sprite is created (`:349-350`), it only deletes map entries, and `drawSprite` holds `sp` as a local object. The occlusion path (`spritePlacement`, opt-in) looks the key up per call and returns null when missing (`:459-460`).
- REFUTED: **non-convergence of the budgeted scheduler** on a still view: every frame builds at least one, the missing set shrinks, and the machine ends at `builds === 0` (R34 settles in 4 frames after a clear; R37 in 11 after the change). It does not converge while the cache is over the cliff and the view keeps revealing sprites (S-2).
- REFUTED: **unbounded memory.** The unbounded structures are tiny: `themeCache` (one entry per family, look, register), `labCache` (colours), `drawFog.cache` (one), `sim._px`, `sim._tint`, `sim._farScratch` (grows to the largest patch box, never shrinks), `shadeMemo` (cleared above 5000 / 60000), `built` and `groupDefs` (cleared above 12000 / 4000). The layer canvases are the big ones: per sim two layers, two spares, one partial repaint: up to 5 x 3.24 x the view in device pixels (107 MB each on 1920x1080 at DPR 2 -> up to 0.5 GB, not freed when zooming in, because `sim._far` is kept while `far` is false).
- REFUTED: **sprite scheduling flicker** other than by design (people and vehicles skipped while zooming, soft-to-sharp when the exact sprite arrives).

---

### 4 · Machine E: per-entity draw cache, and Machine T: theme/register/region

**E states** per building: `FAST` (`e._fast`, default style, no binding, same theme object and same state/owner: draw the cached sprite), `VERSIONED` (`e._fv === sim.frameVersion`: draw without asking the style), `ASK` (call the style, recompute key, maybe new colours and asset). Trees: `_ck` over theme ids, kind, bound colour. Agents: `_ck` over register id and bound data.

**Invariants**: E-I1 the drawn sprite matches style(e), theme and register. Maintained by `_ck` (`:1374-1379`), `_th === pal` (theme **object** identity), `_fv` and the invalidations in `setTheme` (`:492-495`) and `bindData` (`:532-535`). E-I2 `frameVersion` is bumped whenever any style may have changed (contract, `:959-961`).

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| any | `setTheme(sim, th)` | | ASK | agents redressed from `ts`, `_ck/_rc` null; buildings `_ck/_fast/_fv` null; trees re-pick kind, `_ck/_asset` null | `:484-496` |
| any | `bindData(sim, selector, scale, fn)` | | ASK | `_ck`, `_fast` cleared for all; `sim.bindings` replaced | `:529-536` |
| FAST | state or owner differs, or theme object differs | | ASK | | `:1359` |
| VERSIONED | `frameVersion` differs, binding, or `segOn` crossed | | ASK | | `:1363` |
| ASK | style returns data/roof/overlays/seg | `e.params` | key -> new colours and asset | `getAsset` | `:1374-1379` |
| ASK | | no params | extrusion | `_fdata/_froof` kept for the VERSIONED path | `:1373` |

**Reachable invalid states**
- REFUTED: **stale entity after theme/register switch**: `setTheme` clears every cache and `_th` changes with the theme object; R38 A switches colour to formal in the middle of a patch pass and ends equal to the from-scratch picture. `lookSel.onchange`, `rC`, `rF` all call `setTheme` then `applyHooks` (`viewer.html:279-286`).
- REFUTED: **`frameVersion` wrap or non-bump**: a JavaScript number, compared with `===` and turned to `'v' + n` (`:966`); `ctl.setWall` bumps via `store.invalidate` (`packhost.js:147`, `packstore.js:192`); the A/B view sums both versions plus the flip count (`packdash.js:112`). `bindRenderer.dispose` sets the version to `undefined` and the style to null, which makes `far` re-sign by states and the diff fall back to a repaint (`:1264`). No stale path found.
- **E-1 · theme cache collision. CONFIRMED** (R35e). **FIXED `4dc3b43` (#21)** (r35e now prints `false`). `AssetLib.theme` keys `(fam.id || 'x') | look.id | reg` (`assetlib.js:128`); two family records without an `id` return the same theme object. Every record in `assets/palettes.json` has an id, so this needs a hand-made family. Impact low, likelihood very low.
```
e  two different id-less families give the same theme object: true (ground #cccccc and #cccccc; ...)
```
- **E-2 · scene objects shared between sims. CONFIRMED** (R35d). **FIXED `4dc3b43` (#21)**: `e.src` is now the sim's own copy, so a replay writes into the sim, not the scene (r35d prints 100 of 1023 finished before and after). Guard: anything that needs the scene's own object must use `sim.scene.buildings[i]`, not `e.src`. `createSim` wraps `scene.buildings[i]` (`e.src = b`) and `Replay.paintStates` writes `e.src.state` / `investor` (`replay.js:64-65`), so a rebuilt sim, a region switch or a scene reload of the same object starts with the last replay week's colours instead of the scene's own (`1023 of 1023 buildings already "finished"`). Impact low (the next `setWeek` repaints), likelihood medium on the old replay page.
- SUSPECTED: **a second `bindRenderer` on the same sim with an equal `frameVersion`** would find the far layer current and not repaint (the signature is the version string). Not reachable on the current pages (one bind per page); recorded because the contract (`:959-961`) puts the burden on the caller.

---

### 5 · Machines H and X: ZoomHold and Refocus (explicit), C camera, K controls

**H** states: `empty` (`drawn === null`), `held` (`stretched`), `live` (`drawn` set, transform cleared). **X** `state`: `live`, `zoom`, `refine`, `fade`.

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| X.live | frame, `shouldRender` true | | live | `render(front)`, `hold.rendered(view)` clears the transform | `refocus.js:62-63`, `zoomhold.js:43` |
| X.live | frame, `shouldRender` false | scale moved in the last `settleMs` (120) | zoom | reticle seeks, optional blur | `:63` |
| X.zoom | frame, still moving | | zoom | blur follows the stretch | `:65` |
| X.zoom | frame, `shouldRender` true | zoom stopped, or stretch beyond 0.3..8x | refine | `since = now`, `hold.place`, `render(back)` | `:65,47-50` |
| X.refine | `isDone()` or `maxWaitMs` (500) | | fade | back opacity transition, `fadeEnd` | `:41-46` |
| X.refine | frame, `shouldRender` false | a new zoom | zoom | `hideBack` | `:67` |
| X.fade | `now >= fadeEnd` | | live | `hold.rebind(back)`, roles swap, old front hidden | `:34-40,69` |
| X.fade | frame, `shouldRender` false | a new zoom | zoom | `hideBack` (opacity jumps to 0) | `:68` |
| any | `reset()` (resize, a failed frame, `enabled` off) | | live | `hold.reset`, rebind front, back hidden | `:56-57` |
| H | `shouldRender` | `drawn` null or size differs | true | | `zoomhold.js:31` |
| H | `shouldRender` | scale changed by more than `creep` (0.15%) | stamps `lastChange` | | `:33` |

**Invariants checked by R33, 300 seeded random runs of wheel/key zooms, pans, resizes, `enabled` toggles, `isDone` flips, long idles and throwing frames (32,831 frames after each of which they were evaluated):** (I1) in `live` with refocus enabled the hold is not active, the front transform is `none` and the back canvas is at opacity 0; (I2) the back canvas is hidden in `live`, `zoom`, `refine`; (I4) when the events stop and `isDone()` is true the machine is back in `live` within 120 frames, i.e. **no held transform survives and no end of zoom is lost**; (I5) the camera scale is finite and inside `[minScale, maxScale]`, the centre inside the bounds plus margin; (I6) a burst of 40 wheel events with eased zoom drains (`pendingZoom() === 0`) and leaves a finite scale.
```
$ node docs/state-machines/repro/r33-zoom-refocus-fuzz.js
I6 ordinary wheel burst: pendingZoom=0 scale finite=true
300 runs, 32831 frames checked, 0 invariant violations
I6 synthetic wheel deltaY=1e6 (smoothZoom): pendingZoom=0, camera scale=0.7901532076412859 -> finite
camera: maxScale on a 10 m scene 101.7, after setBounds to a 5 km scene 101.7 (a fresh camera on the 5 km scene has 32)
```
Status of the hunted cases: **wheel/drag/keys during hold, refine or fade: REFUTED** (re-entrancy is by polling: `shouldRender` is evaluated every frame from the camera, nothing keeps a copy of the zoom that could be lost); **a held transform that never clears: REFUTED** (`rendered` and `reset` both clear, a throwing frame goes through the page's `rf.reset()`, `viewer.html:276`); **resize during zoom: REFUTED** (`resize()` calls `rf.reset()` first, `viewer.html:174`; the layers re-key on width and height); **lost end-of-zoom with a very slow zoom** (steps under 0.15% a frame never stamp `lastChange`): REFUTED, it renders for real every frame, which is correct.

**Reachable invalid states**
- **X-1 · a fade aborted by a wheel tick pops.** `hideBack` sets `transition: none; opacity: 0` (`refocus.js:68`), so a back canvas half faded in disappears at once and the stretched front shows. By design (a documented explicit transition); cosmetic.
- **C-1 · `camera.zoomAt(NaN)` is permanent. CONFIRMED** (R35g). **FIXED `4dc3b43` (#21)**: `zoomAt` returns unchanged for a factor that is not a finite number above 0, and falls back to the canvas centre for a non-finite pivot. Invariant C-I-fin: `scale`, `cx`, `cy` are finite and within `[minScale, maxScale]` after any call, including NaN, 0, negative and infinite arguments (test `viz/test_geo.js`; r33 I6 now ends at a finite scale by guard, not by luck). Original finding: `clamp = max(min(max, min(.., v)))` returns NaN for NaN, nothing else guards. Reachable only with a NaN factor (a synthetic wheel with `deltaY: NaN`, a pinch with a NaN distance); with `smoothZoom` and `deltaY >= 465,000` `pend` becomes NaN and is cleared only by the camera-limit line (`controls.js:97`), by luck (R33). `renderFrame` with NaN, 0 or Infinity scale and with a zero-size view does not throw on node-canvas (R35g); the picture is blank. Impact low, likelihood very low.
- **C-2 · `maxScale` only rises** (`camera.js:24`), R33 last line. **FIXED `4dc3b43` (#21)**: the line now prints `after setBounds to a 5 km scene 32.0 (a fresh camera on the 5 km scene has 32)`. Semantics: `cam.maxScale` is derived (`opts.maxScale`, or twice `minScale` for a very large scene), never a high-water mark. Impact cosmetic (zoom limit stays that of a smaller scene after loading a bigger one).
- **K-1 · hover and tooltip are not recomputed when the camera moves without a pointer event** (A/D pan, W/S zoom keys, eased zoom ticks). See §7 I-2.
- REFUTED: **lost key release**: `release` on window blur clears `held`; a `keyup` is not filtered by the typing guard (`controls.js:80-83`). **Pointer bookkeeping**: capture, `pointerleave`, `lostpointercapture`, `pointercancel` all delete the pointer; a lifted finger of a pinch leaves a clean one-finger drag (`:62`).

---

### 6 · The GPU-canvas collapse (paperdolls#3): what the draw path does per frame. RESOLVED (9e3b425, measured on a real GPU)

Fixed in 9e3b425 (the facts below are from before the fix). Facts from code and from the canvas-call census (R30, 9,207 buildings, Fit view 1200x700, `getContext` wrapped; counts are exact, not timed):

| phase | `getImageData` / `putImageData` | `drawImage(canvas)` per frame | canvases created |
|---|---|---|---|
| first paint (343 frames) | 0 / 0 | 39 (2 layers + 37 sprite canvases) | 28.8 a frame, 9,872 in all (17.5 Mpx at DPR 1, 50 Mpx at DPR 2) |
| idle, settled | 0 / 0 | **2**, both layer canvases: 2.72 Mpx (DPR 1), **10.89 Mpx (DPR 2)** | 0 |
| one model patch (150 buildings, 361 a frame while painting) | 0 / 0 | the 2 layers + ~359 sprite blits into the scratch + 1 scratch-to-layer copy per patched rect | 9 |
| pan inside the margin | 0 / 0 | 2 | 0 |
| `sim.opts.pixel` + `posterize` (the viewer's "pixel" box), 6 frames | **808 / 808** (0.46 Mpx) | | |

```
$ node docs/state-machines/repro/r30-gpu-readback-census.js        (excerpt)
--- default options  (DPR 2, whole after 343 frames; ...)
  first paint totals: 9872 canvases created (50.14 Mpx), 13385 canvas-as-source drawImage calls; a 1920x1080 window at this DPR has layer canvases of 26.9 Mpx (107 MB) each, two of them blitted every frame, and a spare of each kept
  idle (settled)     per frame: getImageData 0  putImageData 0  drawImage(canvas) 2 [layer 2.0 x 10886kpx]  canvases created 0 (0 kpx)
  one patch (150 b.) per frame: getImageData 0  putImageData 0  drawImage(canvas) 304.5 [layer 2.0 x 10886kpx, sprite 302.5 x 1kpx]  canvases created 9 (7 kpx)
```
**Where a readback can come from** (all call sites of `getImageData` / `putImageData` in the draw path): `AssetLib.quantise` (`assetlib.js:318-322`; posterize only, once per sprite and per layer), `buildSpriteMask` (`:422`; occlusion only, opt-in and off by default), and the `willReadFrequently` low-resolution frame canvas `sim._px` (`vizlib.js:843`; pixel mode only). **None runs in the default far view**, idle or playing. So the 1 fps of paperdolls#3 is not a per-frame readback of this code. The diagnostic that "`willReadFrequently` on every canvas gives 23 fps, on one group leaves 0.9 fps" fits a different cause: `willReadFrequently: true` makes a canvas CPU-backed, so "all CPU" removes every GPU canvas cost at once, and "some CPU" adds GPU-CPU crossings on the blits between groups (layers, stage, sprites) that are still there.

**RESOLUTION, measured with `GPU=egl` (ANGLE on an RTX 4080 SUPER, Chromium 1243; the Great Retrofit's `scripts/measure_frames.mjs`; machine shared, load average 5 to 8):** the collapse was real at `6b74ff7` (whole-commune idle 0.8 fps, p50 1.7 s), commit 8c67787 (rough first paint, incremental patching) took it to about 21 fps idle/playing, and a bisect forcing `willReadFrequently` on every non-stage canvas gave 41 to 60 fps while forcing it on the stage canvases too changed nothing. Cause: GPU-backed offscreen canvases (candidates 1 and 2 below, the 9,900 sprites and the two 3.24x layers) written with thousands of small draws; candidates 3 (stacked stage canvases) and the per-frame full redraw were not it (a settled frame costs 3.5 to 5 ms of `renderFrame`; skipping redraws was not needed and vehicles move every frame). Fix: `AssetLib.canvasFactory(document)` makes offscreen canvases memory-backed; the tint and marks canvases stay on the GPU (`screenFactory`). After: far zoom idle 56 to 61 fps and playing 38 to 47 fps at DPR 1 and 2 on plain and enriched pages; table in `viz/README.md`. Not measured: the RTX 3080, a physical monitor, non-NVIDIA GPUs. The original ranking of candidates, kept for the record:
**Candidates for the cost on a GPU canvas, ranked by what the code shows (none verifiable without a GPU; SUSPECTED):**
1. *Two layer-sized canvases blitted by a full-window `drawImage` on every animation frame, plus a redraw of the stage canvas that nothing asked for.* Idle frames are full redraws: `Refocus.frame` in `live` calls `render(front)` whenever `shouldRender` is true, which it is every frame once the zoom is 120 ms old (`refocus.js:62-63`, `zoomhold.js:34`); there is no dirty check, even with the sim paused. The layers are 1.8x the view in each dimension, so 3.24x its pixels; at 1920x1080 and DPR 2 each is 26.9 Mpx (107 MB), with a spare each and a repaint canvas: the total is above typical GPU canvas budgets, which can force textures out and back or push Chrome to a software canvas.
2. *About 9,900 separate canvases for sprites* (`A.sprites.factory` is `document.createElement('canvas')`, `viewer.html:119`), each a GPU resource when the 2D context is created. The layers and the stage then take sprites as `drawImage` sources from thousands of distinct textures during the first paint and every patch.
3. *Stacked full-window canvases with `will-change: transform, opacity`* (`viewer.html:16`): two stage canvases and, on the pack page, a highlight canvas that is cleared and redrawn every frame (`packhost.html:267`), all recomposited each frame.
4. *The enriched-scene half of the issue is not a GPU effect*: R36 measures it in software (below).

What would settle it, for whoever has the GPU: count `GPU` memory in `chrome://gpu` / DevTools Performance while idling with (a) `LAYER_MARGIN = 0`, (b) sprites from `OffscreenCanvas` or `ImageBitmap`, (c) one stage canvas only, (d) `requestAnimationFrame` skipped while nothing changed.

#### The enriched scene (second finding of paperdolls#3), measured: B-2

**FIXED (ca30ea1).** `drawGroundMarks` paints into a view-sized canvas (on the GPU in the pages, `A.sprites.screenFactory`) keyed on version, cell count, view and relief; R36 after the change: idle far frame 6.2 ms plain, 9.2 ms with 200 m marks (1.5x), 8.7 ms with 100 m marks (1.4x), 7.9 ms with relief only, 8.1 ms with the tint; marks differ from the uncached drawing by at most 2 of 255 on 0.1% of bytes. Original finding: **CONFIRMED** (R36): ground marks are not cached. `drawGroundMarks` (`vizlib.js:1322-1338`) runs every frame: for each cell with a share above 0.02 it saves, clips to the parallelogram and strokes a hatch of up to `h / gap` lines. The cached ground layer and the far layer do not include it, and the tint beside it is cached (one blit, 1.4x). Wall-clock on node-canvas (software; the ratio is the evidence):
```
$ node docs/state-machines/repro/r36-idle-frame-cost-marks-and-tint.js
plain                                                      idle frame median 6.80 ms  (min 6.28, max 8.14)
terrain (relief) only                                      idle frame median 9.32 ms  (min 7.88, max 10.43)
+ ground marks, 200 m cells (204 cells)                    idle frame median 44.79 ms  (min 43.38, max 51.39)
+ ground marks, 100 m cells (704 cells)                    idle frame median 54.62 ms  (min 53.94, max 62.33)
+ ground tint, 40 m cells (4480 cells), opacity .5         idle frame median 9.71 ms  (min 9.28, max 10.39)
ratio to plain: marks(200 m) x6.6, marks(100 m) x8.0, tint x1.4
```
A pack with an outline or halo mapping at the default `lod` (`far: aggregate`, `cell: 200`, `packhost.js:178-182`) installs `sim.groundMarks` (`packhost.js:357`); the cells it returns do not change between frame versions, only with the view, and the hatch is drawn in screen space, so the cache would be a layer keyed like the tint's. Also uncached per frame at far zoom: `collectAgents` poses and sorts every agent (up to 1,500 vehicles and 4,000 people on a big network) although only vehicle dots are drawn, and `drawChannels` rings (cheap).

---

### 7 · Machine I: picking, hover, selection and highlight

**States.** Pointer: `idle` (`down === null`), `pressed` (`down` set), `dragging` (`down.moved`). `hover` (a model index or -1), `store.selection()`. Highlight canvas redrawn every frame (`drawHighlight`, `packhost.js:639`). Channels (`HL`) recomputed per `sim.frameVersion` (`:268-270`).

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| idle | move | no button | idle | `hover = pick.hit(camera.view(), x, y)` model index, tooltip | `:610-618` |
| idle | down | left | pressed | | `:619` |
| pressed | move | > 5 px | dragging | `hover = -1` | `:616` |
| pressed | up | not moved | idle | `store.select(hit \| null)` | `:620-624` |
| any | wheel | | same | `hover = -1`, tooltip hidden | `:626` |
| any | Esc | | same | clears selection | `:631` |
| any | store `time` | `hover >= 0` | same | tooltip text refreshed | `:637` |

**Invariants.** I-I1 the building picked is the one drawn topmost at that pixel. Maintained by sharing the renderer's sort key: pick `d = fit.cx + fit.cy + z` (`packpick.js:41`) equals `collectStatic`'s `d` (`vizlib.js:924`); equal keys fall to the later building in both (stable sort / `a.i > b.i`). Elevation: `touches` shifts the pixel's ground point by `z0` (`packpick.js:56`), the derivation in the header comment. REFUTED as a defect except for degenerate fits (E-1 below, R35a). I-I2 the highlight sits on the building it highlights: **violated for the halo and ground overlays, I-1**.

**Reachable invalid states**
**FIXED (ca30ea1).** `vis`, `ringPath`, `outlinePath` (new `z0` argument), the selection halo, the mark rings, `tintCell` and `paintGroundMarks` use the building's `e.z` or the terrain height at the cell's corners (centre for the rings); R31 now finds the outline at the building (centre y 345.3), culls the off-screen building and draws the on-screen one; `viz/test_render.js` checks the outline's pixel bounding box against the building's. Original finding: - **I-1 · highlights at z = 0 (paperdolls#14). CONFIRMED** (R31). In `drawChannels`: `vis` projects `(fit.cx, fit.cy, 0)` (`packhost.js:292`); `ringPath(..., 1.6, 0)` for halos (`:296`); `outlinePath` uses z of 0 and `h` (`:164-167`, `:302`). In `bindInteraction.drawHighlight`: the selection halo calls `ringPath(.., 1.6, 0)` (`:649`) while its outline uses `z0 = sh.z` (`:653`), so on a hill the two parts of the selection are `z x scale` px apart. `drawGroundTint` / `tintCell` and `drawGroundMarks` project at 0 (`vizlib.js:1340-1341,1327`) over a ground that `drawTerrain` lifts by the terrain height. Every other consumer uses the entity's `z`: the building and its shadow (`:898,903`), `farBox` (`:1207,1209`), `collectStatic` (`:923`), the culling (`:787`), picking (`packpick.js:41,56`), the silhouette (`:76`).
```
$ node docs/state-machines/repro/r31-outline-halo-ignore-z.js
building 1011: terrain height e.z = 36.20 m, view scale 2.5 px/m  =>  expected offset between ground-0 and true position: 90.5 px
outline: footprint corner drawn at y=435.8 (z=0) FOUND; where the building stands (z=e.z) it would be y=345.3 NOT FOUND in the outline -> outline is 90.5 px below its building
vis(): the centre of building 1011 projects to y=440.5 at z=0 but y=350.0 where it is drawn; ...
view shifted so the building is drawn 115 px ABOVE the top edge (truly off screen): outline vertices issued = 24  (drawn although invisible: vis() used z=0)
view shifted so the building is drawn at y=690 of 700 (visible, on screen): z=0 projection says y=780.5; outline vertices issued = 0  (CULLED although the building is on screen)
selection: first path starts at y=434.8 ... a footprint corner is at y=435.8 (z=0) / 345.3 (z=e.z). The channel halo (ringPath(..., 1.6, 0)) and the selection halo are both at z=0; the selection outline uses z0 = 36.20
ground cell at (320,220): terrain there is 15.3 m high, so the ground under it is drawn 38.2 px higher on screen than the tint/hatch cell ...
```
  Impact high, likelihood certain on Jette (63 m of relief). Both directions of the culling error are shown: an off-screen building drawn, an on-screen one culled.
- **I-2 · hover not refreshed by camera motion without a pointer event. SUSPECTED.** `hover` is recomputed only in `onMove` (`:610-618`); `onWheel` clears it, but A/D/W/S key motion and the eased-zoom ticks (`controls.js:87-100`) move the map under a still cursor without a pointer event, leaving the dashed highlight and the tooltip on a building that is no longer there until the mouse moves. No repro: it needs DOM pointer events with a real layout (jsdom has no layout; `getBoundingClientRect` would be faked and the test would only restate the code).
- **I-3 · tooltip not refreshed by `frames` / `view` events**: the subscription is `time` only (`:637`). Already ranked in part 10 (B-1); a re-run or an A/B flip leaves the old number until the mouse moves. Not repeated here.
- **I-4 · pick silhouette vs sprite. SUSPECTED, minor.** A fitted building is drawn as an asset at `fit.cx, fit.cy` with the fitted rectangle, while the pick tests the lifted *footprint*; a rotated or non-rectangular footprint fitted at up to `maxDevDeg` can be picked where the sprite is not and missed where it is. Not measured.
- REFUTED: **selection or hover on a building a frame patch, `rebuild()` or a recolour hides or removes.** The pack page builds one sim per page and never calls `rebuild`; selection holds a model id, mapped to a scene index through `binding.index`, `si < 0` skips (`:645`), `sel.id < binding.count` guards (`:643`). A patch changes colours, not geometry, and the highlight canvas is drawn above the map and read from the same arrays each frame.
- REFUTED: **picking with elevation in the wrong painter's order**: same sort key as the renderer, with z; verified by reading both. The brute-force test in `viz/test_terrain.js` already compares `hit` with `hitBrute`.
- **I-5 · `Pick.create` indexes once.** Heights and `z` are taken at creation (`packpick.js:37-44`); `sim.relief` is baked at `createSim`. Nothing changes them later in the shipped pages, so REFUTED; a future "relief" slider would need a re-index.

---

### 8 · Machine Z: where the ground height (z) is used, and Machine V: scene validation and fit

| consumer | uses z? | where |
|---|---|---|
| building drawing (sprite, extrusion), its ground shadow | yes | `vizlib.js:898,1385-1386,1389`; shadows `:903` |
| tree, agent, fountain | yes | `:477,595,933` |
| roads, ground terrain, relief shading | yes (own z per point or the grid) | `:649,692-733` |
| far layer boxes, grid, patch, rough layer | yes | `:1207,1209,1214,1152` |
| rough ground | **no** (L-3) | `:1175` |
| pick, pick silhouette | yes | `packpick.js:41,56,76` |
| outline, halo, `vis`, selection halo | **no** (I-1) | `packhost.js:292,296,302,649` |
| ground tint, ground marks | **no** (I-1) | `vizlib.js:1327,1340` |
| camera room for relief | yes | `camera.js:20-24`, `vizlib.js:610` |
| a degenerate footprint's terrain lookup | wrong point (E-1) | `buildinglib.js:363` -> `vizlib.js:465` |

**V invariants**: V-I1 a scene that passes `validateScene` renders without an exception and with finite geometry. V-I2 `fit.cx, fit.cy` are the footprint's centre.

| from | event | guard | to | where |
|---|---|---|---|---|
| raw | `validateScene` | arrays present | `ok` / errors (max 40) | `vizlib.js:287-331` |
| ok | `createSim` | | `fit` per building | `:462-471`, `buildinglib.js:360-386` |
| fit | hull < 3 points | collinear or repeated | `{ok:false, reason:'degenerate', cx:0, cy:0}` | `buildinglib.js:363` |

**Reachable invalid states**
- **V-1 · degenerate footprint: validated, fitted at the origin. CONFIRMED** (R35a). **FIXED `ab851b9` (#20)**: the paragraph and the first output block below are the state on `main` at 8cf239e; with the fix `r35a` prints `fit = {cx: 310, cy: 300}`, sort key 626.4 and one counted warning (committed `r35-small-cases.out.txt`). New invariant V-I-deg: every building's `fit.cx, fit.cy` lies inside its footprint's bounding box. `validateScene` needs only three finite points (`:303`); `fitFootprint` returns `cx = cy = 0` for a hull under three points (`buildinglib.js:363`), and `createSim` uses it for the terrain height (`:465`), the painter's key (`:924`), the pick key and the highlight cells. The extrusion itself is drawn at its true footprint, so the building appears but is sorted as if at the origin, and lifted by the terrain at the origin.
```
a  validateScene ok=true; fit={"ok":false,"reason":"degenerate","cx":0,"cy":0}; e.z=4 but the terrain at its footprint (305,300) is 16.2 m; renderer sort key d = fit.cx+fit.cy+z = 4 instead of ~626
```
  Likelihood: the ingest drops areas under 8 m2 (`build.py:249`, part 20 T09) but a self-crossing or collinear footprint can survive, and the viewer accepts any scene file.
- **V-2 · `levels` unbounded. CONFIRMED** (R35f). **FIXED `ab851b9` (#20)**: levels above 60 are drawn with 60 and counted (`N building(s) have more than 60 levels`); the output below is the state on `main`; with the fix r35f prints 65 / 18 / 16 ms for 4 / 20,000 / 200,000 levels. Original finding: `validateScene` requires `levels >= 1` and finite (`:304`); an extruded building loops `bays x levels` polygons per wall (`vizlib.js:136-138`) every frame; asset buildings are protected by the asset's own cap (R35: `b0 params true` for 2e6 levels, height 180 m).
```
f  levels -> validateScene ok / drawn as extrusion / first-frame ms: 4 -> true / true / 66; 20000 -> true / true / 123; 200000 -> true / true / 1069
```
  (The ingest clamps levels to 1..60, part 20 §ingest invariant 6, so only a hand-edited scene reaches this.)
- Other validator gaps seen, not repro'd: footprints may self-intersect (T13 of part 20); `terrain.z` of 100M cells passes the length test; a road with `width` but `pavement` over the width; `ids` may be absent for all buildings (then `hashStr('undefined')` gives every building the same seed). Impact low.

---

### 9 · Machine P: the pages (`viewer.html`, `packhost.html`)

**States.** Viewer: `sim` (rebuilt by `rebuild()`), `scene` (placeholder, file, embedded), `state {region, look, reg, seed, playing}`, `replay`, `A.sprites.dpr`, two canvases, `rf`. Pack page: one sim for the page, `binding`, `pick`, `inter`.

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| any | region select | | new sim | `state.look` reset, `rebuild()` | `viewer.html:279` |
| any | traffic, people slider `input`, drive select, detail box, "new seed" | each event | new sim | `createSim` (all agents, fits, terrain), `finish()`, `attachReplay()`, `applyHooks()`, `resize()` (canvases cleared, `rf.reset()`) | `:176-186,282-290` |
| any | look select, register buttons | | same sim | `setTheme`, `applyHooks` | `:280-286` |
| any | scene file | valid | new scene | `rebuild`, `focusScene` (camera refit) | `:161-170` |
| any | window `resize` | | same | canvases `width = clientWidth * dpr` (a local `dpr`), `rf.reset()`, `cam.resize` | `:171-175` |
| frame | exception in a frame | | same | message once, `rf.reset()`, next frame scheduled in `finally` | `:266-277` |

**Reachable invalid states**
**FIXED (303de53).** `A.watchDpr(window, cb)` sets `A.sprites.dpr` from `resize` and a re-armed `(resolution: Ndppx)` query; `resize()` sets it before sizing the canvases; layer and sprite keys include it. R35c: 0 bytes differ from a from-scratch drawing at the new ratio (was 541k). Original finding: - **P-1 · stale DPR. CONFIRMED** (R35c). `A.sprites.dpr` is assigned at load (`viewer.html:120`, `packhost.html:180`); `resize()` reads `window.devicePixelRatio` afresh for the canvases but never for `A.sprites.dpr`. After browser zoom (which also changes `clientWidth`, so the layers are repainted, but at the old `q`) or a move to another screen, the layers and sprites are made at the old density and blitted scaled. R35c renders the same view with `dpr=2` and with `dpr=1` on a 2x canvas:
```
c  far layer canvas: sprites.dpr=2 (matches the canvas) 3240x2160; sprites.dpr=1 left from page load, canvas now 2x 1620x1080; the two pictures differ in 540988 of 8640000 bytes (the second is the up-scaled low-resolution layer)
```
  Moving from 2x to 1x leaves layers four times bigger than needed. Impact medium (blur or memory), likelihood medium; a reload fixes it. Also the layer key has no `q` (L-I4).
- **P-2 · `rebuild()` per slider `input` event.** Each tick of Traffic or People creates a whole sim (agents, `fitFootprint` for every building, the road index) and throws away its layers: for Jette a new first paint (rough layer at once, exact in slices) each time, and the canvases are cleared by `resize()`. The state itself stays consistent: the old sim is garbage, the sprite cache is shared and keyed by look, `rf.reset()` returns to `live`, `isDone` reads the current `sim`. REFUTED as a correctness bug (setTheme or rebuild while sprites are built: there is no asynchronous building, a frame is atomic); it is a cost (D-2 below).
- **P-3 · the layers of a new sim are painted in the first two frames, with non-exact sprites** (L-1 above): every `rebuild()` fixes that softness for the life of the sim at DPR 2.
- **P-4 · `applyHooks` mutates `sim.buildingStyle`** to a non-versioned function (`plain` mode, `viewer.html:206`) or to `null`; the far layer follows through `far`, `skey` has no style term. Switching modes without the layer noticing is covered by `bindData`'s `_ck` reset and by the signature (`:966-973`). REFUTED stale, but note the modes `numeric output` and `plain walls` have no far layer at all (L-2).
- REFUTED: **resize during zoom** (resize resets the machine and re-keys the layers, §5), **a frame that throws leaves the zoom state broken** (`rf.reset()` in the `catch`).

---

### 10 · Machine N: agents (people, vehicles, trams)

States per agent: `walking/driving` (edge, `s`, `dir`, `side`), `driven` / `path` / `static` motion (`setMotion`), `pose` (explicit position). Invariants: N-I1 `0 <= s <= edge.len` after a step (`stepSim:561-574` re-seats on the next edge); N-I2 every edge has `len >= 0.1` (`buildNetwork:347`), so `agentPose` never divides by a tiny length; N-I3 spawn counts are capped (1,500 vehicles, 4,000 people, `:438`).
Reachable invalid states: none found that a shipped page reaches. Checked: a negative first `dt` (rAF time before `performance.now()` at load) moves an agent by a few centimetres and is clamped by the edge test; `mo.path` ending at time 0 with `loop` gives `sim.time % 0 = NaN` and a NaN pose (an API misuse, SUSPECTED, not in any shipped page); `opts = [e]` fallbacks keep an agent on its edge when it has no neighbour; people avoid blocked pavements (`isWalkable`). Agents are redressed from `a.ts` by `setTheme`, so nothing respawns. The only cost is per-frame work for agents that are not drawn at far zoom (§6).

---

### 11 · Open questions and follow-ups

- Verify §6 candidates 1 to 3 on a GPU Chrome (`chrome://gpu`, memory per canvas) before choosing a fix; the repro cannot.
- R36 measures software time on node-canvas; the GPU numbers come from `GPU=egl` runs of the real pages (§6). Not measured: the RTX 3080, a physical monitor, a non-NVIDIA GPU.
- After the fixes (branch `claude/fix-render-perf-ceb6f0`): the regression tests are in `viz/test_render.js` (run by `tests/test_render.py`); the repro outputs below were regenerated and show the held behaviour. The fixed findings keep their original text after the word FIXED.
- Not covered: the Python frame renderer (`paperdolls/render`, known-issues 10), the occlusion option (`cullHidden`, off by default; its mask readbacks are counted in R30 only for the pixel option), `drawFog`, the `pixel` finish beyond its readback count, and `treelib.js`.
- Suite state at the time of writing: see the commit message.

### Terrain shading (paperdolls#15, `1833bf3`)

**Finding (CONFIRMED by images, not a repro).** `drawTerrain` filled each ground cell (sub-divided to about 18 px) with one grey taken from that cell's slope, laid over the ground with soft-light. The shade was therefore piecewise constant: discontinuous at every grid line (visible blocks, strongest on bare land where slopes are noisy), and the ingest's nearest-height fill (`elevation.attach`, "holes take the nearest height") is a plateau along one axis whose row-to-row differences shaded as streaks. Evidence: `docs/images/terrain-smooth/valley_1_2.18_before.jpg`, `hill_1_2.18_before.jpg`, `overview_se_0.3_before.jpg` and the Great Retrofit images named in the issue.

**Now.**
- `terrainSlopes(T, passes)`: Sobel slope per grid vertex (cached on the terrain, one entry per blur level: 0 for a cell of 30 px or more, 1 for 12 to 30 px, 2 below 12 px, because a cell a few pixels wide cannot be read as a slope, only as noise).
- `shadeTri`: a small software Gouraud rasteriser into a one-byte-per-pixel grey buffer at css resolution (50% grey is neutral); each cell is two triangles whose corners are shaded by their own slope; the buffer becomes the soft-light canvas (an extra canvas of the view size is created only when the device pixel ratio is not 1).
- `edgeFade(T)`: a strip of 4 or more columns (or rows) along the border that each repeat their neighbour, at most 40% of the grid wide, is made-up land; the shade fades to neutral over it (weights blurred over two cells). A whole grid of equal columns (a plane tilted along y) is not touched.
- Heights are unchanged (`T.at`, bilinear): buildings, roads and trees still stand exactly on the drawn surface; the shading amplitude (`RELIEF_GAIN`, `RELIEF_AMP`) is unchanged, so mild relief still looks mild.
- The ingest's `--terrain-cell` default stays 25 m: with interpolated shading the cell is no longer visible, and a finer grid costs file size and ingest time without being needed for the picture (not measured; a finer DTM would add real detail, not remove faceting).

**Invariants.** G-I1 no kink at a cell edge: on a synthetic 6 m hill the share of pixels with a grey second difference above 2 levels is at most 0.2% at 15, 50 and 125 px cells (`main`: 0.6 to 1.0%; now 0.05 to 0.1%, the rest being 8-bit quantisation). G-I2 inside the data the shade is the same with or without a fill strip beyond it. G-I3 the shade over a fill strip is neutral (the ground colour).

**Cost** (`viz/terrain_views.js`, node-canvas, Jette enriched scene, 9,214 buildings, 135 x 142 grid, cold ground frame, median of 15, `main` and this branch interleaved in one process): 0.35 px/m 474 vs 452 ms, 1 px/m 489 vs 510 ms. Note: inside a `vm` context a global lookup (`Math`) is about 10x slower than in a browser, so `shadeTri` binds the `Math` functions it uses to local names; unbound it cost +30% in the harness and 13 ms in plain node.
