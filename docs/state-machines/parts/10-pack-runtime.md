# 10 · Pack runtime layer (store, runtime adapter, worker, controller, play clock, compare, inspector, page bootstrap)

Baseline: `main` at 6b74ff7. Scope: `viz/packstore.js`, `viz/packruntime.js`, `viz/packworker.js`, `viz/packhost.js` (controller, inspector, interaction), `viz/packdash.js` (A/B compare), `viz/packhost.html` (bootstrap), contract in `docs/pack-spec.md` §Runtime interface / §Dashboard.
Repros: `docs/state-machines/repro/` (harness `_harness.js`, one script per finding, `run-all.sh` runs all). No engine code was changed.

How the repros work: the **real** `PackWorker.createServer`, `PackRuntime.create`, `PackStore`, `PackHost.createController` and `PackDash.createCompare` run in Node. Only the thread boundary and the event loop are faked: `FakeWorker` queues messages (structured-cloned) in two arrays, and the server's "let a new request in" yield is a promise the test releases by hand (`env.yieldOne()`). No timers, no sleeps. The model is a 5-entity double whose every frame encodes the run that made it (`load[0] = rate*1000 + t`), so a test can tell from a frame which run it came from. Commands assume the repo root; the jsdom one needs `PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules`.

## Summary: confirmed bugs, most harmful first

| # | Finding | Impact | Likelihood | Repro |
|---|---|---|---|---|
| 1 | **A/B flip leaves the inspector, the timeline readout and the hover tooltip showing the run that was on screen before the flip** (B-1) | wrong picture to a presenter: the map shows B, the selected building's numbers are A's | high: select a building, press `B` | r09 |
| 2 | **Inspector answers come from the worker's *current* run, not the run on screen**: while a re-run is in flight the extra rows describe the new, partly computed run for a time it has not reached, next to the old run's field values (I-1) | wrong picture (transient, lasts one re-run) | high: a building selected while a slider moves | r11 |
| 3 | **A failed B re-run is invisible**: `cmp.error` is set only for B's first start; a later failure leaves B's old frames under the new preset's label and "differences" list (C-2) | wrong picture, silent | medium-low: needs a parameter set the model rejects | r02 |
| 4 | **`on_params: continue` cannot work on the page**: the async controller pushes frame 0 and never asks for more; Play does nothing, sliders do nothing (K-1) | frozen timeline | certain for any `continue` pack (the toy pack uses `rerun`, `packs/toy-epidemic/pack.yaml:8`; no `continue` pack exists in this repo or in `/data/ScifiEconomicsLab`; check the Great Retrofit manifest) | r01 |
| 5 | **No watchdog / dead-worker handling**: a worker that never answers, or dies after `ready`, leaves `ctl.running` true forever with no banner; later requests are posted to the dead worker and hang; a request after `dispose()` neither resolves nor rejects (T-1, T-2) | hang, no message | low: needs a worker that dies or hangs without an `error` event | r05 |
| 6 | **Exceptions thrown inside the run's `onFrames` callback (e.g. `pushFrames` refusing a chunk) never reach the controller**; one lost chunk gives a "successful" run with a truncated timeline and no banner. Same class: a runtime that throws `''` is taken for a success (R-1) | silent truncated timeline | very low: `postMessage` is reliable and ordered; shown with injected loss | r07, r13a2, r13b |
| 7 | **Playhead jumps back silently when the new run's frames replace the old**: the clock keeps playing old frames past `want`, the replace clamps `t` with no `time` event (P-1) | cosmetic jump | high: press Play, move a slider | r03 |
| 8 | **Play sticks on a truncated timeline**: after a failed or cut-off run `playing` stays true, `t` stops at the last frame, the button reads "Pause" (P-2) | cosmetic (a banner shows on failure) | low | r04 |
| 9 | **A `setParams` that throws does not cancel the run in flight**: the worker computes the old run to the horizon for nobody (S-1) | wasted CPU | low | r08 |
| 10 | Small: stale `ctl.mode` after fallback; second `error` event builds a second inline runtime; Blob URL leaked when `new Worker` throws; double `revokeObjectURL`; compare-off leaves B's worker running and re-running; unsubscribe-during-emit still delivers; nested-emit order inversion; off-step preset never "active"; scrub beyond computed frames is lost | cosmetic / leak | low | r06, r05b, r13c, r13d, r13e, r10 |

REFUTED (code prevents it, evidence in §5): older run's chunks applied after a newer `setParams`; selection of an entity that disappears; a run completing under a paused or scrubbing playhead; messages reordered or duplicated; subscribers that throw; snapshot/restore/step racing a run (never called by the shell).

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
- S-I1: after `start`, `setParams`(restart) or `cancel` returns, no earlier `run` can compute another chunk. Maintained by `epoch++` (`:37,38,43`) and the check after each yield (`:51`). Holds only for successful ops (see S-1).
- S-I2: replies for one request id are `partial*` then exactly one of `{done}`, `{error}`, or a plain result (`:46-53,58,60`).
- S-I3: `run` never advances `rt` past `rt.horizon` (`:46,47`).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| S0 | `init` | impl registered | S1 | builds adapter `rt`; replies `{policy,horizon,entities,canInspect,canSnapshot}` | `:31-36` |
| S0 | `init` | no impl | S0 | error reply | `:32-33` |
| S1/S2 | `start` | any | S1 (S2→S3) | `epoch++`; `rt.start` re-inits; replies frame 0 | `:37` |
| S1/S2 | `setParams` | policy rerun, succeeds | S1 (S2→S3) | `rt.start`; `epoch++` after success | `:38` |
| S1/S2 | `setParams` | policy rerun, **throws** | unchanged (S2 stays S2) | error reply, **epoch not bumped** | `:38,61` → S-1 |
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
- **S-1 · failed `setParams` leaves the old run alive.** Status **CONFIRMED** (r08). Impact: wasted CPU; client drops the chunks (`ctl.gen`), store keeps the truncated old-run frames, banner says the model failed. Likelihood: a model rejecting a parameter set, then no further slider move.
  Cause: `epoch++` is after `rt.setParams` returns (`:38`); `PackRuntime.setParams`→`start` assigns `params` before `impl.init` can throw (`packruntime.js:166-167`), so on failure the adapter also holds *new* params with the *old* handle.
```
$ node docs/state-machines/repro/r08-failed-setparams-does-not-cancel-run.js
setParams failed: ctl.error="runtime repro: model refuses rate 0.95" frames=9 pending yields=1
after releasing the server: 4 more partial chunks sent by the old run, model steps 8 -> 40 (horizon 40); store still 9 frames of rate 500
```
- **S-2 · `inspect`/`snapshot`/`restore`/`step` mid-run use the live handle** → see I-1 (inspect, **CONFIRMED**, r11). `restore`/`step`/`snapshot` are never sent by the shell (grep of `viz/packhost.js`, `viz/packdash.js`, `viz/packhost.html`: only `ctl.ensure` calls `runtime.step`, and only when `!isAsync`, `packhost.js:132`); status **REFUTED as unreachable from the UI**, a hazard only for a future caller (a `restore` mid-run would make the next chunk's `t` start at `snap.t+1` and trip `pushFrames` order).
- **S-3 · a second `run` without a restart continues from `rt.t`.** **REFUTED** for the shell: the controller always sends `start`/`setParams` first (`packhost.js:101,120`) and FIFO order guarantees they are handled before the `run` they precede.

---

## 3 · Machine R: runtime adapter (`PackRuntime.create`)

**States:** `R0 Unstarted` (`handle === null`, `t=0`) → `R1 Running(t)` (`handle` set). `step`/`run` throw `'start() first'` in R0 (`:177,179`). `inspect` returns `null` in R0 (`:186`).
**Invariants:** R-I1 each returned frame has `t === previous t + 1` (`take(..., t+1)` `:157,177,181`, only when `opts.validate`, default true `:147`); R-I2 `t <= horizon` (`:180`; `step` has **no** horizon guard, `:177`).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| any | `start(p,s)` | `init` ok, frame 0 valid | R1(0) | `params` replaced first, `handle` replaced, `t=0` | `:165-169` |
| any | `start` | `init` throws | unchanged except `params` | **new params, old handle, old t** | `:166-167` → S-1 |
| any | `start` | frame 0 invalid | R1(0) with an invalid frame withheld | `handle`, `t=0` set, error thrown | `:167-168` |
| R1 | `setParams(p)` | policy rerun | R1(0) | `start(p)` | `:172` |
| R1 | `setParams(p)` | policy continue | R1(t) | `impl.setParams`, handle maybe replaced | `:173-176` |
| R1 | `step(n)` | | R1(t+len) | `t += frames.length` **after** validation, so a throwing step leaves `t` behind the impl's own state | `:177` |
| R1 | `run(toT)` | `toT>t` | R1(t+len) | uses `impl.run` or `step` | `:178-183` |
| R1 | `restore(snap)` | | R1(snap.t) | | `:189` |

Reachable invalid: if `impl.step` advances then `take` throws (invalid frame k of n), `t` is not advanced although the impl's handle is (`:177`, `:181`). The adapter and the model disagree on the time from then on; every later frame fails `t is X, expected Y`. **SUSPECTED**, not reachable with a valid runtime; the shell recovers on the next `start` (a parameter change).

---

## 4 · Machine T: client / transport (`PackWorker.create`)

**States.** Option `mode` (explicit): `'auto' | 'worker' | 'inline'`. Resulting `a.mode` (explicit): `'worker' | 'inline'`. Implicit lifecycle:
- `T0 Opening` (inside `open()`, synchronous).
- `T1 WorkerBooting`: `a.mode='worker'`, `ready=false`, `init` pending.
- `T2 WorkerReady`: `ready=true` (set in the `init.then`, `:120`).
- `T3 InlineBooting` / `T4 InlineReady`: same on `inlineTransport`; reached directly (`mode:'inline'`, no Worker, `new Worker` threw) or by fallback from T1.
- `T5 Dead-undetected`: worker died (or hung) without an error event: every request pends forever. **Not modelled in the code**, reachable (T-1).
- `T6 Disposed`: `tr.terminate()` called, `pending` rejected. **Not modelled**: nothing records it, so later calls are accepted (T-2).
- Impossible by design: `ready` true while `tr` is a worker that was terminated by the fallback (the fallback requires `!ready`, `:103`).

**Invariants:** T-I1 every `call` adds exactly one `pending` entry and every terminal reply/`error`/`onerror`/`dispose` removes it (`:96,98,105,133`); T-I2 there is one live transport (`tr`), the fallback terminates the old before attaching the new (`:103`); T-I3 `a.mode` equals `tr.mode` (`:101`).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| T0 | `open()` | mode≠inline, Worker/Blob/URL present, `new Worker` ok | T1 | `createObjectURL(Blob)`; worker booted; `init` call sent | `:107-109,74-83,120` |
| T0 | `open()` | no Worker/Blob/URL.createObjectURL | T3 (auto) / throws (worker) | `a.fellBack = reason` | `:75-76,109-111` |
| T0 | `open()` | `createObjectURL` ok, `new Worker` throws | T3 (auto) | **URL not revoked** (T-3) | `:79-80,109` |
| T1 | `init` reply | | T2 | `ready`, info copied | `:120` |
| T1 | worker `error` event | `mode==='auto'` | T3 | `terminate()` (revokes URL), inline transport attached, **all pending resent** (`init` only) | `:103` |
| T1 | worker `error` event | `mode==='worker'` | T1 | pending rejected with the error; no fallback | `:104` |
| T1 | **second** worker `error` event | before inline `init` answered | T3 again | another inline transport and another runtime are built (T-4) | `:103` |
| T2 | worker `error` event | | T2 (or T5) | pending rejected; `tr` unchanged; if the worker is dead, later `send`s are lost (T-1) | `:104` |
| T1/T2 | `dispose()` | | T6 | pending rejected `'disposed'`; `terminate()`; calling twice terminates twice | `:133` |
| T6 | any `call` | | T6 | `pending.set` + `tr.send` on a terminated transport: promise never settles (T-2) | `:113-118` |
| any | reply with `m.error` truthy | | | request rejected | `:96` |
| any | reply for unknown id | | | ignored | `:95` |
| any | `partial` | pending exists | | `onFrames(m.partial)` called **inside `receive`**, outside the request's promise | `:97` |

**Reachable invalid states**
- **T-1 · silent or dead worker is never detected.** Status **CONFIRMED** (r05 a, c). `ctl.running` stays true, `ctl.error` stays null, no banner (`packhost.html:251-252` only reports `ctl.error`). A worker that errors *after* `ready` rejects what is in flight, but `tr` keeps pointing at it. Impact: hang with no message; recovery only by reload. Likelihood: low in practice (a worker that dies without an `error` event, e.g. OOM kill, or a blob worker silently blocked by CSP); the fallback only covers errors *before the first answer*.
```
$ node docs/state-machines/repro/r05-silent-worker-dispose.js
(a) silent init: start() is pending, ctl.running=true, ctl.error=null, frames=0
    after a slider move: running=true error=null gen=2 (a new request is queued behind the dead init; still nothing)
(b) after dispose() x2: URL.revoked=["blob:fake/1","blob:fake/1"] (revoked twice), start() is pending
(c) worker died mid-run: ctl.error="worker out of memory" running=false
    next slider move: running=true error="worker out of memory" frames=9 (posted to the dead worker; the runtime never switches to inline)
```
- **T-2 · requests after `dispose()` hang.** **CONFIRMED** (r05 b, printed above): `start()` is `pending`, not rejected; `revokeObjectURL` runs twice for the same URL (harmless). The page never calls `dispose` (grep: no caller outside tests), so this is latent.
- **T-3 · Blob URL leaks when `new Worker` throws.** **CONFIRMED** (r06 c): `URL.created=1 URL.revoked=[]`. Impact: leak of one URL per attempt (≤2 per page: A and B).
- **T-4 · second `error` event builds a second inline runtime.** **CONFIRMED** (r06 b): `PackRuntime.create called 2 times`, and the URL is revoked twice. Real browsers fire one `error` for a failed load, so likelihood is very low. Impact: duplicated init work.
- **T-5 · `ctl.mode` is a stale copy.** **CONFIRMED** (r06 a): after fallback `rt.mode=inline`, `ctl.mode=worker` (`packhost.js:82` copies it once). Nothing reads `ctl.mode` in the shipped code (grep), so cosmetic; any future "worker" badge would lie.
```
$ node docs/state-machines/repro/r06-fallback-paths.js
(a) before the error: rt.mode=worker ctl.mode=worker
    after: rt.mode=inline ctl.mode=worker fellBack="SyntaxError in worker script" frames=41 revoked=["blob:fake/1"] log=["terminate blob:fake/1"]
(b) two error events before init is answered: PackRuntime.create called 2 times (expected 1); revoked=["blob:fake/1","blob:fake/1"]; mode=inline
(c) new Worker() throws: URL.created=1 URL.revoked=[] mode=inline fellBack="Worker construction blocked"
```
- **T-6 · the fallback drops `o.impl`** (`:103` builds `inlineTransport(o.server)` while `open()` adds `impl` at `:111`). **SUSPECTED**, test-only: the page registers the runtime in `PaperDolls.runtimes`, which the inline server falls back to (`:32`); a caller that passes `impl` without registering it would see `the runtime did not register itself` after a fallback. Not repro'd because no shipped caller does this.
- **T-7 · message loss, duplication or reordering.** `postMessage` is ordered and exactly-once; the inline transport preserves order because each reply is `Promise.resolve().then` in call order (`:71`). Duplicated terminal replies are ignored (`:95`). A **duplicated partial** is rejected by `pushFrames` order check (r07 style, harmless: the next chunk still fits). A **dropped partial** is R-1. Status **REFUTED for duplicates and reordering**, **CONFIRMED consequence under injected loss** (r07).
- **R-1 · exceptions in `onFrames` do not reach the run.** **CONFIRMED** under injected loss (r07); the dropped-chunk fault is only the trigger, the cause is `receive` calling `p.onFrames` outside any `try` and outside the request's promise (`:97`), and `put()` calling `store.pushFrames` which throws on any order/patch error (`packstore.js:143-144`). The controller cannot count it as a failure. Related: `reply(id, {error: ''})` is falsy at `:96`, so a runtime that **throws the empty string** is resolved as a success (**CONFIRMED**, r13 a2; `throw new Error('')` is *not* affected, r13 a1: it reports `Error`). Impact: silent truncated timeline (the page says nothing, `ctl.runs` increments). Likelihood: very low (needs a lost message or `throw ''`).
```
$ node docs/state-machines/repro/r07-dropped-chunk-silent-truncation.js
dropped 1 partial message; frames in store=17 of 41 ctl.error=null ctl.running=false ctl.runs=1
exceptions thrown out of the message handler (uncaught in a browser): ["frame t=25 out of order: expected 17","frame t=33 out of order: expected 17"]
Play: playing=true t=16
```
```
$ node docs/state-machines/repro/r13-store-and-small-cases.js      # (a1) (a2) (b)
(a1) runtime threw new Error(""): ctl.error="runtime repro: Error" frames=0 -> reported (REFUTED: message becomes "Error")
(a2) runtime threw the empty string: ctl.error=null frames=1 ctl.runs=1 (error "" is falsy, so the client takes the failure for a success)
(b) pushFrames threw "frame t=5 out of order: expected 2": length=2 (was 3), events=[], time.t=2, frame() is null, bound load[0]=2 (stale value from the replaced run: 2)
(c) compare off: B worker dead=false, B re-ran anyway after enable(false): 1 run(s)
(d) validator ok=true (errors: []); after applyPreset("odd") rate=0.2 isPreset("odd")=false
(e) setTime(30) while 9 frames exist: t=8; after the run completed (41 frames) t=8
```

---

## 5 · Machine C: run controller (`createController`)

**Variables:** `ctl.gen` (monotonic run id), `ctl.dirty` (a parameter moved since the last flush), `ctl.running`, `ctl.error`, `ctl.runs`; per stream (closure of `stream()`): `held` (chunks not yet in the store) and `replaced` (whether the old frames were already replaced); `want` (the time on screen when the run began).

**States** (derived):
- `C0 Fresh`: `gen=0`, store empty.
- `C1 Idle-clean`: `!running`, `!dirty`, store holds a complete (or failed-partial) run for the current params.
- `C2 Dirty`: `dirty` (a param moved), run (if any) still computing the old params.
- `C3 Running(gen)`: `running`, `gen` current. Sub-states: `Awaiting-setParams`, `Holding` (`!replaced`, store still shows the **previous** run), `Streaming` (`replaced`, store shows the new run, growing).
- `C4 Superseded`: a stream whose `gen !== ctl.gen`: all of its results are dropped (`:90,102,106,121`).
- `C5 Failed`: `ctl.error` set, `!running`; store holds whatever frames had arrived.
- Impossible by design: two current streams.

**Invariants**
- C-I1 only the latest `gen` writes the store (`put` `:90`; `rerun` `:102,106`; `start` `:120-121`). Holds, see §REFUTED-1.
- C-I2 a parameter change is never lost: `dirty` is set before `schedule`/`flush` (`:129`), and cleared only when `rerun` reads `store.params()` after (`:130,101`). Holds.
- C-I3 `ctl.running` is true iff the latest gen has not finished (`:85,100,119`). **Violated** when the latest run never gets an answer (T-1) or when `onRun` throws inside `finish`.
- C-I4 the frames on screen belong to one run. During `Holding` they belong to the **previous** one by design (comment `:77-79`); the controller does not expose which, so readers cannot tell (this is what I-1 and P-1 stumble on).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| C0/C1 | `start()` | async | C3 | `gen++`, `running`, `runtime.start`, then `stream(gen,f0,0)` (rerun) or `pushFrames([f0])` (continue) | `:117-122` |
| C0/C1/C3 | store `params` event | | C2 | `dirty=true`; `schedule()` or `flush()` if `immediate` | `:129` |
| C2 | `flush()` | `dirty` | C3 | `dirty=false`; `gen++`; `want=time.t`; `runtime.setParams(store.params())` | `:130,97-101` |
| C3 | setParams reply | `gen` current, `restarted` | C3 Holding | `stream(gen,res.frame,want)` | `:102-103` |
| C3 | setParams reply | `gen` current, not restarted (continue) | C1 | pushes `[res.frame]` only if the store is empty; `res.frame` is `null` for continue → nothing | `:104` → K-1 |
| C3 | setParams reply | `gen` stale | C4 | ignored | `:102` |
| C3 Holding | partial chunk | `gen` current, `held.length ≤ want` | Holding | `held += chunk` | `:90-91` |
| C3 Holding | partial chunk | `held.length > want` | Streaming | `pushFrames(held,{replace:true})`; `held=[]`; clamps `time.t` into the new length | `:92`, `packstore.js:140,148` |
| C3 Streaming | partial chunk | | Streaming | `pushFrames(chunk)` (extend) | `:93` |
| C3 | run resolves, not cancelled | `gen` current | C1 | `put([],true)` replaces if still Holding; `ctl.error=null`; `finish` | `:95,106` |
| C3 | run resolves cancelled | | C4 | `put` skipped; the newer gen finishes | `:95` |
| C3 | any request rejects | `gen` current | C5 | `fail(e)` (`ctl.error`, `console.error`), `finish` | `:106,121` |
| C3 | `onFrames` throws | | **unchanged** | exception escapes `receive`; run continues | `:97` → R-1 |
| any | `flush()` | `!dirty` | | returns false | `:130` |

**Reachable invalid states / transitions**
- **K-1 · `continue` policy has no way to get past frame 0 on the page.** **CONFIRMED** (r01). The async `start` pushes only frame 0 for non-rerun (`:120`), `rerun` pushes nothing for `restarted:false` (`:104`), `ensure` is disabled for async (`:132`), and `advance` waits for frames that nothing requests (`:140`). The spec promises "frames are made only as the clock reaches them" (`docs/pack-spec.md:63`) and the validator accepts the value (`packvalidate.js:77`). Impact: frozen timeline, Play does nothing, slider moves have no visible effect. Likelihood: any pack declaring `continue` (none exists today).
```
$ node docs/state-machines/repro/r01-continue-policy-async.js
policy=continue frames after start+drain: 1 (horizon 40)
after 100 clock ticks: t=0 playing=true time events=[playing]
after a slider move: frames=1 frame0 load=500 (rate 0.5 -> 500, 0.8 -> 800)
model steps executed by the server: 0
```
- **C-2 · B's failures are not surfaced** (compare controller `ctlB` has no `onRun`; `cmp.error` is set only after the first `start`, `packdash.js:86`, and never cleared) → machine B.
- **I-1 · see machine I.**
- **C-3 · stale frames under new parameters after a failed re-run.** The old frames stay on screen with the new slider values; a banner appears via `ctl.onRun` (`packhost.html:251`). Status: by design, **REFUTED as unnoticed** for A, **CONFIRMED unnoticed for B** (C-2).
- **C-4 · `ctl.running` after `onRun` throws.** `finish` sets `running=false` before calling `onRun` (`:85`); an exception then becomes an unhandled rejection of the `.then` (`:106`). **SUSPECTED**, cosmetic, not repro'd (the page's `onRun` cannot throw).
- **C-5 · `want` is read once** (`:100`), so a user who keeps playing past it produces P-1. See machine P.

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
| reset during play | CONFIRMED benign | `resetParams` is one `params` event (`packstore.js:81`) → same path as a slider move; play continues over old frames (P-1) |
| run while `immediate` + sync adapter | REFUTED for the page | the page uses the async adapter and `schedule`; with `immediate` the whole run is inside the emit (`:129`), later `params` subscribers see new frames, harmless |

---

## 6 · Machine P: play clock and time (`advance`, `setTime`, `togglePlay`)

**Variables:** `time.playing` (explicit boolean), `time.t`, `time.speed`, `ctl.acc` (fractional steps).
**States:** `P0 Paused`, `P1 Playing`, `P2 Playing-waiting` (playing, `next >= store.length()`, async: the clock waits for frames, `:140`), `P3 Playing-at-end` (`next > horizon` → paused, `:139`).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| P0 | `togglePlay` | | P1 | if `t>=horizon` first `setTime(0)`; `setPlaying(true)` | `:144` |
| P1 | rAF `advance(dt)` | `acc>=1`, frame exists | P1 | `acc-=1`; `setTime(t+1)` (emit `time`) | `:136-142` |
| P1 | `advance` | `next >= store.length()` (async) | P2 | `acc=0` (**drops the fraction**) | `:140` |
| P1 | `advance` | `next > horizon` | P0 | `setPlaying(false)`, `acc=0` | `:139` |
| P1/P2 | slider `oninput`, arrow keys, chart pick | | P0 | `setPlaying(false)`; `setTime` (clamped to the frames held) | `packhost.js:472,585`, `packdash.js:132` |
| P0/P1 | `setSpeed(s)` | `s>0` | same | `time` event `speed` | `packstore.js:102` |
| any | `pushFrames(replace)` shorter than `t` | | same | `time.t` clamped **without** a `time` event | `packstore.js:148` |

Invariant P-I1 `0 <= t <= frames.length-1` once frames exist (`setTime` `:96-97`, clamp `:148`). Holds, but `setTime` with an **empty** store allows `t` up to `horizon` (`:96`), so `t` can exceed the frames until the first push.

**Reachable invalid / surprising**
- **P-1 · playhead jump back when a re-run's frames replace the old ones.** **CONFIRMED** (r03). With Play on and `t=30`, a slider move starts a run with `want=30`; the old 41 frames stay on screen and the clock plays them on to `t=38` (past `want`); the replace happens once 31+ frames have arrived and `pushFrames` clamps `t` to the new length: `t` goes 38 → 32, the picture switches runs, and **no `time` event** is emitted (only `frames`). Dependents that listen only to `time` (chart cursors, B follow) catch up through the `frames`/`series` events. Impact: visible jump, cosmetic. Likelihood: high (Play + slider).
```
$ node docs/state-machines/repro/r03-playhead-jump-on-replace.js
run in flight: store holds 41 frames, load at t=30 is 530 (old run, rate 0.5)
clock ran on: t=38 (old frames, load 538)
after replace: t=32 (was 38), frames=33, load at t is 832 (new run, rate 0.8)
time events during the jump: []  frames events: [replace:33]
```
- **P-2 · play sticks on a truncated timeline.** **CONFIRMED** (r04). After a run that fails at step 20, 17 frames remain; Play reaches `t=16` and stays there with `playing=true` (P2 never leaves: nothing will produce frame 17). A banner is shown for the failure, but the Pause button state is wrong, and the same happens after R-1 with no banner.
```
$ node docs/state-machines/repro/r04-play-stalls-after-failed-run.js
run finished: ctl.error="runtime repro: model exploded at step 20" running=false frames=17 of 41
after 20 s of clock: playing=true t=16 (stuck at the last frame; the Pause button is still showing)
```
- **P-3 · scrubbing beyond what a running re-run has produced is clamped and forgotten.** **CONFIRMED** (r13 e): `setTime(30)` with 9 frames → `t=8`; when the run finishes `t` stays 8. Cosmetic.
- **P-4 · `acc=0` when waiting** loses the fractional step, so playback restarts slightly slow after waiting. **SUSPECTED**, cosmetic, no repro.

---

## 7 · Machine F: store (frames, versions, bound view)

**Variables:** `frames[]`, `series`, `time.t`, `selection`, version counters `version.*`, `data` (frame at current time may differ), `shown` (what the map shows may differ), `gen` (bumped by every replace), `bind` map with per-entity `synced/syncT/syncGen`.
**States:** `F0 Empty` (`frames.length===0`) → `F1 Holding(n)` → (replace) `F1 Holding(m)`. Impossible by design: `time.t > frames.length-1` with frames present (clamped, `:148`) — except after a throwing `pushFrames` (F-1).

**Invariants**
- F-I1 frames are contiguous: `frames[i].t === i` (`:143`).
- F-I2 `data` and `shown` move whenever the frame at `time.t` can differ (`:99,149,192`); the bound cache (`bound()`) returns the previous arrays only if `synced === data` (`:172`).
- F-I3 the patch fast path applies a patch only on top of the immediately preceding frame of the same `gen` (`:174`). Holds: each replace bumps `gen` (`:140`), `setTime` changes `syncT`; checked by reading, not attacked (rendering owners cover the bound view).
- F-I4 subscribers are called after the state changed; a throwing subscriber does not stop the others (`:41`). Holds.

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| any | `pushFrames(f, replace)` | contiguous | F1 | clears `frames`/`series`/`gen++` first; pushes; clamps `t`; `data/shown++` if the frame at `t` may differ; emits `frames`, `series` | `:138-152` |
| any | `pushFrames` | non-contiguous / bad patch | **half state** | for replace: old frames already cleared, some new pushed, **no event, `data` not bumped** | `:140-144` → F-1 |
| any | `setTime(t)` | clamped ≠ current | | `data/shown++`, emit `time` | `:95-99` |
| any | `select(sel)` | different | | emit `selection` | `:106-110` |
| any | `setParams(v)` | all legal | | emit `params` once, with changed names; all-or-nothing | `:70-80` |
| any | `invalidate()` | | | `shown++`, emit `view` | `:192` |

**Reachable invalid**
- **F-1 · `pushFrames(replace)` that throws leaves the store half replaced.** **CONFIRMED** (r13 b): length 3 → 2, `time.t=2` with `frame()` null, no event, and `bound()` keeps serving the old run's arrays. Only reachable through a protocol fault (R-1). Impact: map drawn from old data with the timeline of a shorter run; silent.
- **F-2 · unsubscribe-during-emit still delivers; a nested write inverts event order.** **CONFIRMED** (r10): delivery is to a snapshot of subscribers (`:41`). Dependents that tear down in a handler (`destroy` of charts and the inspector, `packhost.js:518,542`) can still receive the event that is in flight. In practice nothing in the shell writes the store from a handler on the same store; `follow` writes a *different* store (`packdash.js:40-42`). Cosmetic.
```
$ node docs/state-machines/repro/r10-store-emit.js
(a) ["s2 called after s1 unsubscribed it"]
(b) later subscriber saw: ["v2 rate=0.9","v1 rate=0.9"] (event order inverted)
```
- **F-3 · preset values off the parameter step.** **CONFIRMED** (r13 d): the validator accepts `rate: 0.22` for step 0.05; the store snaps to 0.2, so `isPreset` is never true and the preset button never shows as active. Cosmetic; fix would be in the validator.
- **F-4 · selection of an entity that disappears or changes under a new frame.** **REFUTED**: entity counts are fixed for the page's life (`counts` come from `PackRuntime.bindScene` once, `packhost.html:193,197`; `entitySpec` `packruntime.js:42-50`), A and B use the same counts, so a selection `{entity,id}` stays valid across any re-run; `bindInteraction` guards `sel.id < binding.count` (`packhost.js:597`), and `entityRows` returns `[]` when a frame lacks the entity (`:339`). Selection also survives re-runs by design (the inspector re-asks on `frames` with `replace`, `:514`).

---

## 8 · Machine I: inspector request loop (`inspector()` in `mountUI`)

**Variables:** `busy`, `again`, `shown`, `store.selection()`, `store.time().t`, DOM nodes `fieldsEl` (frame values, synchronous) and `extraEl`/`note` (runtime answer, asynchronous).
**States:** `I0 Hidden` (no selection); `I1 Shown-idle`; `I2 Asking` (`busy`); `I3 Asking+Again` (`busy && again`).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| I0 | store `selection` | non-null | I1→I2 | clears extra rows; draws frame rows; `ask()` | `:508-514` |
| I1/I2/I3 | `time` or `frames`(replace) event | selection | I2 / I3 | `ask()`: if `busy` set `again` | `:494-497,514` |
| I2 | answer | selection and time equal to the ones at ask time | I1 (→I2 if `again`) | extra rows replaced | `:499-505` |
| I2 | answer | selection or time changed | I1 (→I2 if `again`) | answer dropped | `:500` |
| I2 | rejection | | I1 | `note = 'The model could not say: …'` **without** the staleness check | `:506` |
| any | selection cleared | | I0 | `hidden`; `shown=null`; an in-flight answer is later dropped by the selection check | `:510-511` |
| any | `view` event (A/B flip) | | **no transition** | not subscribed | `:516` → B-1 |

Invariant I-I1 the panel shows, together, frame values and a model answer for the same (entity, time, run). **Violated** by I-1 and B-1.

- **I-1 · the answer is not tied to the run on screen.** **CONFIRMED** (r11). `ctl.inspect` asks the worker's current handle (`packhost.js:147` → `packruntime.js:186`), at the time shown. While a re-run is in `Holding`, the store shows the old run but the worker has the new run at `t=8`: the inspector (key = selection + time only, `:497-500`) accepts the answer for day 30, which for a log-based model (the toy, `packs/toy-epidemic/runtime.js:109`) means "nothing happened yet", next to field values from the old run. The time events from Play re-ask on every tick (`:514`), so it is refreshed continuously while this window lasts. Window = duration of one re-run (sub-second for the toy; seconds for a large scene). Impact: wrong picture (transient). Likelihood: high.
```
$ node docs/state-machines/repro/r11-inspect-answers-from-partial-run.js
on screen at t=30: load 530 (old run, rate 0.5)
inspect answer: rate of this run=0.8; asked for t=30; run has simulated to=8; events logged by t=8
```
- **I-2 · the rejection path skips the staleness check** (`:506`): an old error can overwrite the note of a newer selection. **SUSPECTED**, cosmetic; blocked repro by there being no cheap way to make `inspect` fail on one selection only in the real flow (it would need a runtime throwing for one entity).
- **I-3 · answers across FIFO.** An answer for the old run cannot arrive after the new run's frames (single ordered channel, `setParams` reply precedes the new chunks), so the `frames`(replace) re-ask always follows the old answer. **REFUTED**.

---

## 9 · Machine B: A/B compare (`createCompare`)

**Variables:** `enabled`, `showing` ('a'|'b'), `ctlB`/`runtimeB` (null until first enable), `bSource`, `error`, `flips`, `snapshotsList`. Two stores `A` (page) and `B`; `viewStore` reads A or B.
**States:** `B0 Off, never enabled` (`ctlB=null`); `B1 On, showing A`; `B2 On, showing B`; `B3 Off after use` (`ctlB` alive, `showing='a'`). Impossible by design: `showing==='b'` while `!enabled` (`show()` coerces, `:93`, `enable(false)` flips back, `:89`). Not by design but reachable: B3 with B's worker and controller alive and re-running (B-3).

| from | event | guard | to | effects | where |
|---|---|---|---|---|---|
| B0 | `enable(true)` | | B1 | picks B (first preset that differs from A, else a copy of A); `createRuntime()` (second worker); `createController`; `ctlB.start()`; `follow()` | `:74-86` |
| B0 | `enable(true)` | `createRuntime` throws | B0 | `error` set; `enabled=false` | `:87` |
| B1 | `show('b')` | | B2 | `flips++`; `follow()`; `view.__flipped()` → only `view`/`*` subscribers | `:92-96` |
| B2 | `enable(false)` | | B3 | `show('a')`; **no dispose**, no pause of B | `:89` |
| B1/B2/B3 | `setB(src)` | | same | `B.setParams`; ctlB marks dirty, re-run at next `cmp.flush()` (page frame loop) | `:57-60`, `packhost.html:263` |
| B3 | `enable(true)` | `ctlB` exists | B1 | nothing restarted (B kept running meanwhile) | `:77` |
| any | A `time` | | | `B.setTime(A.t)` | `:40-41` |
| any | B `frames` | | | `follow()` again (B's own time clamps to its frames) | `:42` |
| any | `inspect(sel)` | | | runtime chosen by `showing` **at call time** | `:99` |

**Findings**
- **B-1 · flip leaves the inspector, the timeline readout and the tooltip stale.** **CONFIRMED** (r09, jsdom). `cmp.show` emits nothing the panels listen to: `view.subscribe` only forwards `view`/`*` to flip subscribers (`:113-121`), the inspector listens to `selection/time/frames` (`packhost.js:516`), the readout (via `refresh`) to `params/time/frames` (`:540`), the tooltip to `time` (`:590`). `follow()` after the flip emits `time` only if B's `t` differs from A's, which is normally not the case. Result (printed): after the flip the map shows B (`load[0]=200`) while the inspector still says `500` and `rate of this run 0.5` and the readout `load 500`; one `setTime` later they jump to B. The chart/KPI panels are unaffected (both runs always drawn). Impact: wrong picture on the presenter's most visible comparison action. Likelihood: high.
```
$ PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules node docs/state-machines/repro/r09-ab-flip-leaves-inspector-and-readout-stale.js
showing A  : map load[0]=500 | inspector fields: A | 500 | rate of this run 0.5 | readout: Totals: load 500 · zero 0
after flip : map load[0]=200 | inspector fields: A | 500 | rate of this run 0.5 | readout: Totals: load 500 · zero 0
time moved : map load[0]=201 | inspector fields: B | 201 | rate of this run 0.2 | readout: Totals: load 201 · zero 0
```
- **C-2 (B-2) · B re-run failures are invisible.** **CONFIRMED** (r02). `cmp.error` is written only from the first `start()` (`:86`) and never cleared; later `ctlB` failures set `ctlB.error` which nothing reads (`packhost.html:249-251` wires `compare.onChange('error')` and `ctl.onRun` for A only). After `setB(bad)` the compare panel's difference list says B is at 0.95 while B's frames and the map flip come from the 0.2 run. Related: a *start* failure sets `cmp.error` permanently, so the panel keeps showing the error after B recovers (`:212`, SUSPECTED, by reading `:86,212`; not repro'd). Impact: wrong picture, silent. Likelihood: medium-low.
```
$ node docs/state-machines/repro/r02-compare-b-failure-silent.js
B source={"preset":"low"} B rate=0.2 B frames=41 B frame5 load=205 (expect 205)
after setB(bad: rate 0.95, the model throws):
  ctlB.error      = "runtime repro: model refuses rate 0.95"
  cmp.error       = null   (what the page shows in the header and the compare panel)
  onChange events = [enabled,b]  (no "error")
  B.params().rate = 0.95   differences() = ["rate: A 0.5, B 0.95"]
  B frame5 load   = 205   (rate 0.2 run; the 0.95 run never produced a frame)
  map would show frame with load 205 under the label "Bad"
```
- **B-3 · compare off does not stop B.** **CONFIRMED** (r13 c): B's worker stays alive and a later `B.setParam` still triggers a run (via `cmp.flush`, unconditional `:100`). Resource retention (one worker, one model copy) and wasted CPU; by design per the spec comment ("made only when first switched on") but never released.
- **B-4 · flipping to B before B has frames** shows the neutral "no data" map (`live = !!store.frame()` in `bindRenderer`) under the badge "Map shows B" until the first chunk. Transient, and permanent if B's start failed (B-2). **SUSPECTED** from `packdash.js:92-96` + `packhost.js:228-229`, not repro'd.
- **B-5 · snapshot/restore vs two handles.** The compare uses **two handles**, never snapshot/restore (`packdash.js:1-12`), so "A/B handles updated or disposed while a run is in flight" reduces to: B's controller has its own `gen` and its own worker, A's re-run cancels only A (**REFUTED** cross-talk: separate `FakeWorker` instances in r02/r09, separate servers and epochs). Disposal is never done (B-3, T-2).

---

## 10 · Machine Z: page bootstrap (`packhost.html`)

Order (`:186-277`): validate manifest → find runtime impl → `bindScene` on the main thread → `PackStore.create` → `makeRuntime()` (worker starts here) → controller → `createCompare` (B store only; no B worker yet) → renderer binding → UI → `ctl.start()` → rAF loop (`flush`, `compare.flush`, `advance`, render, highlight).

| step | failure | state afterwards |
|---|---|---|
| invalid manifest, missing impl, `bindScene` error | `problem()` and `return` | nothing built; page inert (correct) |
| `bindRenderer` not ok | `problem()` but the **runtime and controller already run** | worker computing a model that is not drawn; harmless |
| worker fails before answering | fallback (T) | single start; page continues |
| worker silent | **hang** (T-1) | no banner |
| rAF callback throws | caught; message once; `requestAnimationFrame` re-armed in `finally` (`:268-272`) | a persistent exception in `ctl.flush()` after `dirty=false` would lose that re-run: **REFUTED** for async (`rerun` does not throw synchronously, `:99-107`) |
| `onRun` message handling | `problem('')` clears only a message starting with "The model failed" (`:251`) | a stale "A frame failed…" or "The comparison run failed…" stays until reload: cosmetic, **SUSPECTED** by reading |

No double start: `ctl.start()` is called once (`:252`); `labPack` exposes handles for tests. No `pagehide` teardown; the page is the process, so leaks do not outlive it.

---

## 11 · Candidates the task asked about, and where they are answered

| candidate | answer |
|---|---|
| slider changes while a run is in flight | REFUTED corrupting (§5 REFUTED-1, r12); P-1, I-1 are the visible artefacts |
| results of an older run after a newer `setParams` | REFUTED, r12 |
| worker message reordering, drop, duplication | T-7: FIFO and exactly-once REFUTED as a risk; effect of a loss CONFIRMED (R-1, r07) |
| worker crash or failure to start; auto fallback | T-1 CONFIRMED (hang), T-3/T-4/T-5 CONFIRMED (leaks, stale mode), fallback itself works (r06 a) |
| play timer firing during a re-run | P-1 CONFIRMED |
| run completes while paused or scrubbing | REFUTED |
| A/B handles updated or disposed while a run is in flight | B-2, B-3 CONFIRMED; no cross-talk (B-5) |
| selection of an entity that disappears | REFUTED (F-4) |
| inspector request answered for a stale time or stale run | stale time REFUTED (key check `packhost.js:500`); stale run CONFIRMED (I-1); after A/B flip CONFIRMED (B-1) |
| `dispose()` twice or during a run | T-2 CONFIRMED (double revoke harmless; later requests hang); during a run: pending rejected with `'disposed'`, which the controller would show as "The model failed: disposed" (`packhost.js:106`); never called by the page |
| store subscribers throwing | REFUTED (`packstore.js:41`; compare emit `packdash.js:36`; flip `:120`) |
| re-entrancy from subscribers | F-2 CONFIRMED (low) |
| reset during play | benign (§5 table) |
| retries: re-entering a state, double start, leaking worker/timers/blob URLs | T-3, T-4, B-3 CONFIRMED; no timers are created by the runtime layer (the page's 0 ms `schedule` timers are one-shot, `packhost.html:199,201`) |

## 12 · Running everything

```
PAPERDOLLS_NODE_MODULES=/data/ScifiEconomicsLab/scifirender/paperdolls/node_modules sh docs/state-machines/repro/run-all.sh
```
Each script prints what it observed (full output of each is pasted above, taken at commit `6b74ff7` plus this note). They do not assert; they must be turned into assertions by the fixing step, each flipping the printed line to the expected value.
