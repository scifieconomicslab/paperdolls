/* packworker.js: runs a pack's `js` runtime off the main thread, behind the same interface as the runtime adapter (packruntime.js), made asynchronous.
 *
 *   const rt = PackWorker.create(manifest, { sources: { runtime, entry }, mode: 'auto', counts, attrs });   // mode: 'auto' | 'worker' | 'inline'; counts and attrs from PackRuntime.bindScene
 *   rt.async === true; rt.mode  // 'worker' or 'inline' (the same-thread fallback: node, jsdom, or a page whose worker will not start)
 *   await rt.start(params, seed)            -> frame 0
 *   await rt.setParams(params)              -> { restarted, frame }       ('rerun' starts again, 'continue' keeps the state)
 *   await rt.run(toT, onFrames)             -> { cancelled }              onFrames(frames) is called with each chunk as it arrives
 *   await rt.step(n)                        -> frames
 *   await rt.inspect({ entity, id }, t)     -> detail | null              the runtime's answer for one entity, on demand
 *   await rt.snapshot() / rt.restore(snap)  rt.cancel()   rt.dispose()
 *
 * The runtime object itself (init, step, run, setParams, snapshot, restore, inspect) is the one a pack registers with PaperDolls.registerRuntime; it does not change.
 * One server (createServer) answers every request, whether it sits in a worker or on the main thread, so the two modes behave the same and the tests cover both.
 * A request that starts a new run cancels the one in progress: the server runs in chunks (default 16 frames) and looks between them. Frames are structured-cloned
 * (not transferred): a runtime that handed out arrays it still uses would otherwise lose them, and a frame is small next to a patch of thousands.
 *
 * The worker is made from a Blob of text: packruntime.js, this file, the pack's runtime source and one line, PackWorker.serve(self). The page keeps those
 * sources as text; no file or network is needed, so the single-file build stays single-file. If a worker cannot be made (no Worker, a blocked Blob URL), or dies
 * before it answers, the same server is used on the main thread and the requests already sent are repeated.
 */
(function (root) {
  'use strict';
  const nextTick = () => new Promise(r => setTimeout(r, 0));

  // ---------- the server: one runtime, answering messages ----------
  function createServer(post, opts) {
    opts = Object.assign({ chunk: 16, yieldFn: nextTick }, opts || {});
    let rt = null, epoch = 0;
    const reply = (id, o) => post(Object.assign({ id }, o));
    const why = e => String((e && e.message) || e || 'the runtime failed without a message');          // never the empty string: a client reads an empty `error` as no error
    const ops = {
      init(m) {
        const impl = (opts.impl) || (root.PaperDolls && root.PaperDolls.getRuntime(m.manifest.id));
        if (!impl) throw new Error('the runtime did not register itself as ' + m.manifest.id);
        rt = root.PackRuntime.create(m.manifest, impl, { counts: m.counts || null, attrs: m.attrs || null });
        return { policy: rt.policy, horizon: rt.horizon, entities: rt.entities, canInspect: rt.canInspect, canSnapshot: rt.canSnapshot };
      },
      start(m) { epoch++; return { frame: rt.start(m.params, m.seed) }; },
      setParams(m) { if (rt.policy === 'rerun') epoch++; return rt.setParams(m.params); },             // a restart cancels the run in flight even when it fails: the old run is of no use to anyone
      step(m) { return { frames: rt.step(m.n) }; },
      inspect(m) { return { detail: rt.inspect(m.sel, m.t) }; },
      snapshot() { return { snap: rt.snapshot() }; },
      restore(m) { rt.restore(m.snap); return {}; },
      cancel() { epoch++; return {}; },
    };
    async function run(m) {
      const mine = ++epoch, toT = Math.min(rt.horizon, m.toT | 0), chunk = Math.max(1, m.chunk || opts.chunk);
      while (rt.t < toT) {
        const fr = rt.run(Math.min(toT, rt.t + chunk));
        reply(m.id, { partial: fr });
        await opts.yieldFn();                                    // lets a new request (a moved slider) in between chunks
        if (epoch !== mine) { reply(m.id, { done: true, cancelled: true }); return; }
      }
      reply(m.id, { done: true, cancelled: false });
    }
    return {
      handle(m) {
        try {
          if (m.op === 'run') { run(m).catch(e => reply(m.id, { error: why(e) })); return; }
          if (!ops[m.op]) throw new Error('unknown request ' + m.op);
          reply(m.id, ops[m.op](m));
        } catch (e) { reply(m.id, { error: why(e) }); }
      },
    };
  }
  // inside a worker: scope is `self`
  function serve(scope) { const server = createServer(m => scope.postMessage(m)); scope.onmessage = e => server.handle(e.data); return server; }

  // ---------- transports ----------
  function inlineTransport(opts) {
    const t = { mode: 'inline', onmessage: null, onerror: null, send(msg) { Promise.resolve().then(() => server.handle(msg)); }, terminate() { t.onmessage = null; } };
    const server = createServer(m => Promise.resolve().then(() => { if (t.onmessage) t.onmessage(m); }), opts);
    return t;
  }
  function workerTransport(o) {
    const W = o.Worker || root.Worker, B = o.Blob || root.Blob, U = o.URL || root.URL;
    if (!W || !B || !U || !U.createObjectURL) throw new Error('no Worker in this environment');
    const src = o.sources;
    const code = [src.runtime, src.worker, src.entry, 'PackWorker.serve(self);'].join('\n;\n');
    const url = U.createObjectURL(new B([code], { type: 'text/javascript' }));
    let w, closed = false;
    try { w = new W(url); } catch (e) { U.revokeObjectURL(url); throw e; }                  // the URL was made: do not leave it behind
    const t = { mode: 'worker', onmessage: null, onerror: null, send: msg => w.postMessage(msg), terminate() { if (closed) return; closed = true; w.terminate(); U.revokeObjectURL(url); } };
    w.onmessage = e => { if (t.onmessage) t.onmessage(e.data); };
    w.onerror = e => { if (e && e.preventDefault) e.preventDefault(); if (t.onerror) t.onerror(new Error((e && e.message) || 'the worker failed')); };
    return t;
  }

  // ---------- the client: the adapter the shell talks to ----------
  // Every request has a watchdog (o.timeoutMs, default 20 s; a run's chunks each restart it). A request that gets no answer, or a transport that reports an error, means the
  // transport is lost: before its first answer, in 'auto' mode, the same requests are repeated on the main thread; after it was ready, the model's state is gone, so the
  // requests in flight are rejected with `recoverable: true` (the controller repeats its run) and the main thread starts from a fresh init; otherwise (mode 'worker', or already
  // on the main thread) the error stays and every later request is refused with it at once. After dispose() requests are rejected with 'disposed'. No timer outlives either.
  function create(manifest, o) {
    o = Object.assign({ mode: 'auto', timeoutMs: 20000 }, o || {});
    const timers = o.timers || { set: (f, ms) => { const h = setTimeout(f, ms); if (h && h.unref) h.unref(); return h; }, clear: h => clearTimeout(h) };
    let tr = null, nextId = 1, ready = false, disposed = false, lost = null, init = null;
    const pending = new Map();                                   // id -> { msg, resolve, reject, onFrames, timer }
    const info = { policy: (manifest.runtime || {}).on_params || 'rerun', horizon: manifest.time.steps, entities: null, canInspect: false, canSnapshot: false };
    const a = { async: true, manifest, policy: info.policy, horizon: info.horizon, mode: 'inline', fellBack: null, canInspect: false, canSnapshot: false, entities: null };
    const inlineOpts = () => Object.assign({}, o.server, o.impl ? { impl: o.impl } : {});
    const arm = p => { timers.clear(p.timer); p.timer = timers.set(() => { if (pending.get(p.msg.id) === p) lose(new Error('runtime ' + manifest.id + ': the ' + tr.mode + ' did not answer within ' + Math.round(o.timeoutMs / 100) / 10 + ' s'), tr); }, o.timeoutMs); };
    const drop = id => { const p = pending.get(id); if (p) { timers.clear(p.timer); pending.delete(id); } return p; };
    const failAll = err => { for (const id of [...pending.keys()]) { const p = drop(id); p.reject(err); } };
    const cancelRun = () => { if (tr && !lost && !disposed) tr.send({ id: nextId++, op: 'cancel' }); };       // its reply has no request waiting and is ignored

    function receive(m) {
      const p = pending.get(m.id); if (!p) return;
      if (m.error !== undefined) { drop(m.id); p.reject(new Error('runtime ' + manifest.id + ': ' + (m.error || 'failed without a message'))); return; }
      if (m.partial) {
        arm(p);
        if (p.onFrames) { try { p.onFrames(m.partial); } catch (e) { drop(m.id); p.reject(e); cancelRun(); } }        // a failing consumer ends the run, through the run's promise
        return;
      }
      drop(m.id); p.resolve(m);
    }
    function attach(t) { tr = t; a.mode = t.mode; t.onmessage = m => { if (t === tr) receive(m); }; t.onerror = err => lose(err, t); }
    function sendInit() {
      init = call('init', { manifest, counts: o.counts || null, attrs: o.attrs || null }).then(m => { ready = true; for (const k of ['policy', 'horizon', 'entities', 'canInspect', 'canSnapshot']) { info[k] = m[k]; a[k] = m[k]; } return m; });
      init.catch(() => {});                                      // a failure surfaces through the requests that wait on it
    }
    // transport t is not going to answer (an error event, or no answer in time)
    function lose(err, t) {
      if (disposed || t !== tr) return;                          // a late or second event of a transport that was already replaced
      const worker = t.mode === 'worker';
      if (worker && o.mode === 'auto') {
        a.fellBack = err.message; t.terminate(); attach(inlineTransport(inlineOpts()));
        if (!ready) { for (const p of pending.values()) { arm(p); tr.send(p.msg); } return; }       // never answered: the requests already sent are repeated here
        ready = false; const e = Object.assign(new Error(err.message), { recoverable: true });
        failAll(e); sendInit(); return;                          // answered before: the model's state died with the worker; start again on this thread
      }
      lost = err; t.terminate(); failAll(err);
    }
    function open() {
      if (o.mode !== 'inline') {
        try { attach(workerTransport(o)); return; } catch (e) { if (o.mode === 'worker') throw e; a.fellBack = e.message; }
      }
      attach(inlineTransport(inlineOpts()));
    }
    function call(op, args, onFrames) {
      return new Promise((resolve, reject) => {
        if (disposed) { reject(new Error('disposed')); return; }
        if (lost) { reject(lost); return; }
        const msg = Object.assign({ id: nextId++, op }, args || {}), p = { msg, resolve, reject, onFrames, timer: null };
        pending.set(msg.id, p); arm(p); tr.send(msg);
      });
    }
    open();
    sendInit();
    Object.assign(a, {
      ready: () => init,
      start: (params, seed) => init.then(() => call('start', { params, seed })).then(m => m.frame),
      setParams: params => init.then(() => call('setParams', { params })),
      step: n => init.then(() => call('step', { n })).then(m => m.frames),
      // the frames up to toT, in chunks, each handed to onFrames as it arrives; { cancelled: true } when a newer start, setParams or cancel overtook the run.
      // An exception thrown by onFrames ends the run: the promise rejects with it and the server is told to stop.
      run: (toT, onFrames) => init.then(() => call('run', { toT }, onFrames)).then(m => ({ cancelled: !!m.cancelled })),
      inspect: (sel, t) => init.then(() => (info.canInspect ? call('inspect', { sel, t }).then(m => m.detail) : null)),
      snapshot: () => init.then(() => call('snapshot')).then(m => m.snap),
      restore: snap => init.then(() => call('restore', { snap })),
      cancel: () => init.then(() => call('cancel')),
      dispose() { if (disposed) return; disposed = true; failAll(new Error('disposed')); if (tr) tr.terminate(); },
    });
    return a;
  }

  root.PackWorker = { create, createServer, serve, inlineTransport, workerTransport };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PackWorker;
})(typeof window !== 'undefined' ? window : globalThis);
