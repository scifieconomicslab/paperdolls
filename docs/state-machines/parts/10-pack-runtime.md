# 10 · Pack runtime layer (store, runtime adapter, worker, controller, play clock, compare, inspector, page bootstrap)

Baseline of the analysis: `main` at 6b74ff7; the fixes were made on `aa2d936`. Scope: `viz/packstore.js`, `viz/packruntime.js`, `viz/packworker.js`, `viz/packhost.js` (controller, inspector, interaction), `viz/packdash.js` (A/B compare), `viz/packhost.html` (bootstrap), contract in `docs/pack-spec.md` §Runtime interface / §Dashboard.
Repros: `docs/state-machines/repro/` (harness `_harness.js`, one script per finding, `run-all.sh` runs all; its expected output after the fixes is `run-all.out.txt`). Assertions: `viz/test_pack_runtime.js` (pytest wrapper `tests/test_pack_runtime.py`).

**Status after the fixes.** All 10 confirmed findings are FIXED: #4 `f5765bd` (findings 1-3), #5 `aa30227` (findings 5, 6, 8, 9), #6 `d40e29a` (finding 4), #7 `4eadbf1` (findings 7, 10; the parts of finding 10 that live in the worker client were already done by `aa30227`). The machine descriptions and transition tables below describe the code **after** the fixes; the paragraphs and printed outputs headed "on aa2d936" are the evidence from before. Line numbers `:NN` inside findings are those of `aa2d936`. What is still open is listed in "Still open" at the end of the summary.

How the repros work: the **real** `PackWorker.createServer`, `PackRuntime.create`, `PackStore`, `PackHost.createController` and `PackDash.createCompare` run in Node. Only the thread boundary and the event loop are faked: `FakeWorker` queues messages (structured-cloned) in two arrays, and the server's "let a new request in" yield is a promise the test releases by hand (`env.yieldOne()`). No timers, no sleeps. The model is a 5-entity double whose every frame encodes the run that made it (`load[0] = rate*1000 + t`), so a test can tell from a frame which run it came from. Commands assume the repo root; the jsdom one needs `PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules`.

## Summary: confirmed bugs, most harmful first

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

## 1 · Machines at a glance

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

## 2 · Machine S: worker-side request server (`createServer`)

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

## 3 · Machine R: runtime adapter (`PackRuntime.create`)

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

## 4 · Machine T: client / transport (`PackWorker.create`)

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

## 5 · Machine C: run controller (`createController`)

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

### REFUTED-1 · results of an older run arriving after a newer `setParams`
The server-side cancel is cooperative (chunk-level), so chunks of run 2 **are** in flight when run 3 starts. They are dropped by `if (gen !== ctl.gen) return` (`packhost.js:90`); `setParams` replies are dropped at `:102`. r12 delivers a chunk from the previous run after the client moved on and checks that every frame in the final store belongs to the newest run, and that `t` was not moved by the run completing under a scrubbing playhead.
```
$ node docs/state-machines/repro/r12-stale-chunks-are-dropped.js
chunks in flight when run 3 started: 1; frames now 41; distinct runs among frames: [0.9]; t=3 (never moved by the run completing)
```

### Other concurrency candidates
| candidate | status | why |
|---|---|---|
| slider burst coalescing | REFUTED | `dirty` + one `flush` per frame (`packhost.js:129-130`, `packhost.html:262`); `rerun` reads the latest params |
| `start()` and a `rerun()` racing at boot | REFUTED | both bump `gen`; the loser's results are dropped (`:120-121`, `:102`); server handles `start` then `setParams` in order |
| run completes while paused or scrubbing | REFUTED | `pushFrames` extends only; `t` untouched unless beyond the end (`packstore.js:148-149`), r12 |
| reset during play | benign | `resetParams` is one `params` event (`packstore.js:81`) → same path as a slider move; the clock holds until the new run has caught up (P-1 FIXED) |
| run while `immediate` + sync adapter | REFUTED for the page | the page uses the async adapter and `schedule`; with `immediate` the whole run is inside the emit (`:129`), later `params` subscribers see new frames, harmless |

---

## 6 · Machine P: play clock and time (`advance`, `setTime`, `togglePlay`)

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

## 7 · Machine F: store (frames, versions, bound view)

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

## 8 · Machine I: inspector request loop (`inspector()` in `mountUI`)

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

## 9 · Machine B: A/B compare (`createCompare`)

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

## 10 · Machine Z: page bootstrap (`packhost.html`)

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

## 11 · Candidates the task asked about, and where they are answered

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

## 12 · Running everything

```
PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules sh docs/state-machines/repro/run-all.sh
```
Each script prints what it observed. The blocks pasted above headed "on aa2d936" are the output before the fixes; the output after them, for every script, is `docs/state-machines/repro/run-all.out.txt` (deterministic: running `run-all.sh` again reproduces it byte for byte). The assertions are in `viz/test_pack_runtime.js` (`node viz/test_pack_runtime.js`; pytest: `tests/test_pack_runtime.py`), which also holds the cases for the new transitions (watchdog, `continue`, dispose, holding clock). Every test of a fixed finding was run against `git archive aa2d936` and failed there (named in the commit messages); the controls that pass on both are `#5 r07: a complete run is not reported`, `#6 ... rerun still makes the whole timeline`, `#7 r10: a handler that throws does not stop the queue`.

Not verified in a real browser: a real `Worker` dying (OOM kill), a blob worker blocked by a CSP, the watchdog's default 20 s on a slow machine, the 0 ms timers, and the look of the header messages. The faked thread boundary reproduces the message sequences, not the browser's scheduling.
