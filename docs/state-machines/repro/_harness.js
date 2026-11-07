/* Deterministic harness for the pack-runtime state-machine repros. No timers, no sleeps, no real workers.
 *
 *   const env = H.makeEnv({ impl, manifest, chunk });     // registers the runtime double under manifest.id
 *   const rt = env.worker();                              // PackWorker.create(..., mode 'worker') on a FakeWorker whose messages only move when the test says so
 *   await env.settle();                                   // run every pending microtask (promise callbacks), nothing else
 *   await env.drain();                                    // deliver every queued message in both directions until the network is quiet; chunk yields are NOT released
 *   await env.yieldOne() / env.yieldAll();               // release the server's "let a new request in" yield (run() between chunks), then drain
 *
 * The server inside FakeWorker is the real PackWorker.createServer with the real PackRuntime wrapper, so the only things faked are the thread boundary and
 * the event loop. Messages are structured-cloned on the way (as postMessage does).
 */
'use strict';
const path = require('path'), fs = require('fs');
const VIZ = path.join(__dirname, '..', '..', '..', 'viz');
for (const f of ['packvalidate.js', 'packstore.js', 'packruntime.js', 'packworker.js', 'packhost.js', 'packdash.js']) require(path.join(VIZ, f));
const G = globalThis;

// A tiny pack: one entity "thing" (5 of them), a series "totals", one numeric parameter. Every frame carries the run's parameter and its time, so a test
// can see from the frame alone which run produced it: load[0] = rate * 1000 + t.
const MANIFEST = () => ({
  spec: 1, id: 'repro', title: 'Repro', runtime: { type: 'js', entry: 'runtime.js', seed: 1, on_params: 'rerun' },
  time: { unit: 'day', steps: 40, speeds: [1, 4], speed: 4 },
  params: { rate: { type: 'number', min: 0, max: 1, step: 0.05, default: 0.5 } },
  presets: [{ id: 'low', label: 'Low', params: { rate: 0.2 } }, { id: 'bad', label: 'Bad', params: { rate: 0.95 } }],
  entities: { thing: { count: 5, fields: { kind: { type: 'category', values: ['a', 'b'] }, load: 'number' } } },
  series: { totals: { y: ['load', 'zero'], label: 'Totals' } },
  mappings: [{ entity: 'thing', field: 'kind', channel: 'wall', scale: { type: 'categorical', label: 'Kind', values: { a: { colour: '#112233', label: 'A' }, b: { colour: '#445566', label: 'B' } } } }],
});

// The model double. frame(t) is whole; rate > failAbove makes init throw; throwAtStep makes step number n throw.
function makeImpl(o) {
  o = o || {};
  const frame = h => ({ t: h.t, entities: { thing: { kind: Int8Array.from({ length: 5 }, (_, k) => (k + h.t) % 2), load: Float32Array.from({ length: 5 }, (_, k) => h.p.rate * 1000 + h.t + k * 0.001) } }, series: { totals: [h.p.rate * 1000 + h.t, 0] } });
  const impl = {
    inits: 0, steps: 0,
    init(p) { impl.inits++; if (o.failAbove !== undefined && p.rate > o.failAbove) throw new Error('model refuses rate ' + p.rate); return { p: Object.assign({}, p), t: 0, log: [] }; },
    step(h, n) {
      if (n === 0) return [frame(h)];
      const out = [];
      for (let i = 0; i < n; i++) { impl.steps++; if (o.throwAtStep === h.t + 1) throw new Error('model exploded at step ' + (h.t + 1)); h.t++; h.log.push(h.t); out.push(frame(h)); }
      return out;
    },
    // log-based, like packs/toy-epidemic/runtime.js:109: answers for any t from what has been simulated so far; for a t not yet simulated it has nothing logged.
    inspect(h, sel, t) { return { fields: [{ label: 'rate of this run', value: h.p.rate }, { label: 'asked for t', value: t }, { label: 'run has simulated to', value: h.t }, { label: 'events logged by t', value: h.log.filter(x => x <= t).length }] }; },
  };
  if (o.continue) impl.setParams = (h, p) => { h.p = Object.assign({}, p); return h; };
  return impl;
}

class FakeURL { constructor() { this.created = 0; this.revoked = []; } createObjectURL() { return 'blob:fake/' + (++this.created); } revokeObjectURL(u) { this.revoked.push(u); } }

function makeEnv(o) {
  o = o || {};
  const manifest = o.manifest || MANIFEST(), impl = o.impl || makeImpl({ continue: !!o.continue });
  if (o.continue) manifest.runtime.on_params = 'continue';
  G.PaperDolls = G.PaperDolls || {}; G.PaperDolls.registerRuntime(manifest.id, impl);
  const env = { manifest, impl, toServer: [], toClient: [], yields: [], workers: [], URL: new FakeURL(), log: [], uncaught: [], delivered: [], dropped: [], dropClient: null };
  class FakeWorker {
    constructor(url) {
      if (env.failConstruct) throw new Error('Worker construction blocked');
      this.url = url; this.dead = false; this.onmessage = null; this.onerror = null; env.workers.push(this);
      this.server = G.PackWorker.createServer(m => { if (!this.dead) env.toClient.push({ w: this, m: structuredClone(m) }); }, { chunk: o.chunk || 8, impl, yieldFn: () => new Promise(r => env.yields.push(r)) });
    }
    postMessage(m) { if (!this.dead) env.toServer.push({ w: this, m: structuredClone(m) }); }
    terminate() { this.dead = true; env.log.push('terminate ' + this.url); }
    // test controls
    fail(msg) { if (this.onerror) this.onerror({ message: msg || 'boom', preventDefault() {} }); }
    crash() { this.dead = true; }                                  // dies silently: nothing more is delivered, nothing is reported
  }
  env.FakeWorker = FakeWorker;
  env.silentInit = false;                                           // when true the server swallows init and never answers (a worker that hangs while starting)
  env.worker = (extra) => G.PackWorker.create(manifest, Object.assign({ mode: 'worker', Worker: FakeWorker, Blob: function () {}, URL: env.URL, sources: { runtime: '', worker: '', entry: '' } }, extra || {}));
  env.settle = async () => { for (let i = 0; i < 40; i++) await null; };
  // deliver one queued message (client->server first), returns false when nothing is queued
  env.step = () => {
    if (env.toServer.length) { const { w, m } = env.toServer.shift(); if (w.dead) return true; if (env.silentInit && m.op === 'init') return true; w.server.handle(m); return true; }
    if (env.toClient.length) { const { w, m } = env.toClient.shift(); if (env.dropClient && env.dropClient(m)) { env.dropped.push(m); return true; } env.delivered.push(m); if (!w.dead && w.onmessage) { try { w.onmessage({ data: m }); } catch (e) { env.uncaught.push(e.message); } } return true; }
    return false;
  };
  env.drain = async () => { await env.settle(); while (env.step()) await env.settle(); };
  env.yieldOne = async () => { await env.drain(); const r = env.yields.shift(); if (r) r(); await env.drain(); return !!r; };
  env.yieldAll = async () => { while (env.yields.length) await env.yieldOne(); await env.drain(); };
  return env;
}

// A store + controller (async adapter) on a fake worker, started and idle.
function makePage(o, workerOpts) {
  const env = makeEnv(o), store = G.PackStore.create(env.manifest), runtime = env.worker(workerOpts);
  const ctl = G.PackHost.createController({ manifest: env.manifest, runtime, store });
  return { env, store, runtime, ctl };
}
const frameLoad = (store, t) => { const f = store.frameAt(t); return f ? Math.round(f.entities.thing.load[0] * 1000) / 1000 : null; };
module.exports = { makeEnv, makePage, makeImpl, MANIFEST, frameLoad, G, VIZ };
