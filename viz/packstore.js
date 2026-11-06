/* packstore.js: the one place a pack page keeps its state. Controls write parameters, the runtime writes frames, the renderer and the readouts read.
 * No DOM and no dependencies, so it runs in Node and in the single-file page.
 *
 *   const store = PackStore.create(manifest);
 *   const off = store.subscribe('params', ev => ...);        // topics: params, time, selection, frames, series, or '*' for all
 *   store.setParam('beta', 0.4);                              // clamped to the declared range; returns false if the name is unknown or the value is illegal
 *   store.applyPreset('lockdown'); store.setTime(10); store.select({ entity: 'building', id: 3 });
 *   store.pushFrames(frames); store.frame();                  // the frame at the current time, or null
 *
 * Nothing here talks to the renderer or the runtime: the shell (packhost.js) reads the store and writes it, which is what lets a pack replace
 * any one component without the others noticing. A frame is { t, entities: { name: { field: array } }, series: { name: [numbers] } } (see docs/pack-spec.md).
 * Subscribers are called synchronously, in the order they subscribed, after the state has changed. A subscriber that throws does not stop the others.
 */
(function (root) {
  'use strict';
  const PS = () => root.PackSpec;
  const TOPICS = ['params', 'time', 'selection', 'frames', 'series', 'view'];

  function create(manifest) {
    const spec = manifest.params || {}, time = manifest.time || {};
    const horizon = time.steps | 0;
    const subs = new Map(); let nextId = 1;
    const defaults = () => { const d = {}; for (const [k, p] of Object.entries(spec)) d[k] = p.default; return d; };
    const st = {
      params: defaults(),
      time: { t: 0, horizon, playing: false, speed: time.speed || (time.speeds && time.speeds[0]) || 1, unit: time.unit || 'step' },
      selection: null,
      frames: [],                                   // frames[t]; a re-run replaces them all
      series: {},                                   // name -> array of points, one per frame
      version: { params: 0, time: 0, selection: 0, frames: 0, series: 0, view: 0 },
      data: 0,                                       // bumped whenever the frame at the current time may differ
      shown: 0,                                      // bumped whenever what the map shows may have changed (the frame at the current time, or how it is read)
      gen: 0,                                        // bumped by every run that replaces the frames
      bind: new Map(),                               // entity -> bound typed arrays (see bindScene)
    };
    const store = { manifest };

    function emit(topic, detail) {
      st.version[topic]++;
      const ev = Object.assign({ topic, version: st.version[topic] }, detail || {});
      for (const [, s] of [...subs]) if (s.topic === topic || s.topic === '*') { try { s.fn(ev); } catch (e) { if (root.console) root.console.error(e); } }
    }
    store.subscribe = (topic, fn) => {
      if (topic !== '*' && !TOPICS.includes(topic)) throw new Error('unknown topic ' + topic + ' (known: ' + TOPICS.join(', ') + ', *)');
      const id = nextId++; subs.set(id, { topic, fn });
      return () => { subs.delete(id); };
    };
    store.version = topic => st.version[topic];

    // ---- parameters ----
    // A number is clamped to its range and snapped to its step; an enum or a boolean must be legal as it is.
    function coerce(name, v) {
      const p = spec[name];
      if (!p) return { ok: false, why: 'unknown parameter ' + name };
      if (p.type === 'number' || p.type === 'integer') {
        if (typeof v === 'string' && v.trim() !== '') v = Number(v);
        if (typeof v !== 'number' || !isFinite(v)) return { ok: false, why: name + ' must be a number' };
        if (p.type === 'integer') v = Math.round(v);
        else if (p.step) v = p.min + Math.round((v - p.min) / p.step) * p.step;
        v = Math.max(p.min, Math.min(p.max, v));
        if (p.step && p.type === 'number') v = +v.toFixed(10);        // 0.1 + 0.2 should not show as 0.30000000000000004
        return { ok: true, value: v };
      }
      const why = PS().checkValue(p, v);
      return why ? { ok: false, why: name + ' ' + why } : { ok: true, value: v };
    }
    store.params = () => Object.assign({}, st.params);
    store.param = name => st.params[name];
    store.setParam = (name, v) => store.setParams({ [name]: v });
    store.setParams = values => {
      const next = {}, changed = [];
      for (const [k, v] of Object.entries(values)) {
        const c = coerce(k, v);
        if (!c.ok) return false;                                      // all or nothing: a preset with one bad value changes nothing
        next[k] = c.value;
      }
      for (const [k, v] of Object.entries(next)) if (st.params[k] !== v) { st.params[k] = v; changed.push(k); }
      if (changed.length) emit('params', { changed });
      return true;
    };
    store.resetParams = () => { store.setParams(defaults()); };
    store.applyPreset = id => {
      const pr = (manifest.presets || []).find(p => p.id === id);
      if (!pr) return false;
      return store.setParams(Object.assign(defaults(), pr.params));     // a preset is complete: parameters it does not name return to their defaults
    };
    store.isPreset = id => {
      const pr = (manifest.presets || []).find(p => p.id === id); if (!pr) return false;
      const want = Object.assign(defaults(), pr.params);
      return Object.keys(want).every(k => st.params[k] === want[k]);
    };

    // ---- time ----
    store.time = () => Object.assign({}, st.time);
    store.setTime = t => {
      const last = Math.max(0, Math.min(horizon, st.frames.length ? st.frames.length - 1 : horizon));
      t = Math.max(0, Math.min(last, Math.round(+t) || 0));
      if (t === st.time.t) return false;
      st.time.t = t; st.data++; st.shown++; emit('time', { what: 't' }); return true;
    };
    store.setPlaying = on => { on = !!on; if (st.time.playing !== on) { st.time.playing = on; emit('time', { what: 'playing' }); } };
    store.setSpeed = s => { if (typeof s === 'number' && s > 0 && s !== st.time.speed) { st.time.speed = s; emit('time', { what: 'speed' }); } };

    // ---- selection (the inspector and the picking of later phases write here) ----
    store.selection = () => st.selection;
    store.select = sel => {
      const same = (a, b) => (a === b) || (a && b && a.entity === b.entity && a.id === b.id);
      sel = sel || null; if (same(sel, st.selection)) return false;
      st.selection = sel; emit('selection'); return true;
    };

    // ---- frames and series ----
    store.frames = () => st.frames;
    store.length = () => st.frames.length;
    store.frame = () => st.frames[st.time.t] || null;
    store.frameAt = t => st.frames[t] || null;
    // frames: the runtime's frames, in order. replace: drop what is held first (a re-run); else they extend it.
    // A frame is whole ({ t, entities, series }) or a patch over the one before it ({ t, patch: { entity: { field: { idx, val } } }, series }): idx lists the
    // entity numbers that changed and val their new values. A patch is applied here, so frame() and frameAt() always hold whole frames; the frame keeps its
    // `patch` so that a bound view (bindScene) can follow with the cost of the patch and not of the entity count.
    function resolve(f, prev) {
      if (f.entities || !f.patch) return f;
      if (!prev) throw new Error('frame t=' + f.t + ' is a patch but there is no frame before it');
      const ents = {};
      for (const [en, fields] of Object.entries(prev.entities)) {
        const out = {}, pf = f.patch[en] || {};
        for (const [fn, arr] of Object.entries(fields)) {
          const ch = pf[fn];
          if (!ch) { out[fn] = arr; continue; }                          // untouched field: shared with the frame before (frames are never mutated)
          const next = arr.slice ? arr.slice() : Array.from(arr);
          for (let i = 0; i < ch.idx.length; i++) next[ch.idx[i]] = ch.val[i];
          out[fn] = next;
        }
        ents[en] = out;
      }
      return { t: f.t, entities: ents, series: f.series, patch: f.patch };
    }
    store.pushFrames = (frames, opts) => {
      const replace = !!(opts && opts.replace);
      if (replace) { st.frames = []; st.series = {}; st.gen++; }
      const before = st.frames.length;
      for (const f0 of frames) {
        if (f0.t !== st.frames.length) throw new Error('frame t=' + f0.t + ' out of order: expected ' + st.frames.length);
        const f = resolve(f0, st.frames[st.frames.length - 1]);
        st.frames.push(f);
        for (const [name, pt] of Object.entries(f.series || {})) (st.series[name] || (st.series[name] = [])).push(pt);
      }
      if (st.time.t > st.frames.length - 1) st.time.t = Math.max(0, st.frames.length - 1);
      if (replace || before <= st.time.t || st.frames.length <= st.time.t) { st.data++; st.shown++; }         // frames added beyond the current time change nothing on the map
      emit('frames', { replace, length: st.frames.length });
      emit('series', { replace });
    };
    store.series = name => (name === undefined ? st.series : (st.series[name] || []));
    store.latest = name => { const a = st.series[name]; const pt = a && a[Math.min(st.time.t, a.length - 1)]; return pt === undefined ? null : pt; };    // the series point at the current time

    // ---- the bound view: per-entity typed arrays indexed by scene building, for the renderer ----
    // bindScene('building', { count: sceneCount, index }) : index[k] is the scene building that draws model entity k (-1 or undefined: not drawn).
    // bound('building') -> { version, fields: { state: Int8Array(sceneCount), exposure: Float32Array(sceneCount) }, scene } where fields hold the frame at
    // the current time. Category fields hold -1 and number fields NaN where nothing is bound. It is brought up to date when asked, by the patch alone when
    // the time has moved one step on to a patch frame, otherwise by a gather over the bound entities. Nothing is allocated after the first call.
    store.bindScene = (entity, o) => {
      const decl = ((manifest.entities || {})[entity] || {}).fields || {};
      const fields = {};
      for (const [fn, f0] of Object.entries(decl)) { const f = typeof f0 === 'string' ? { type: f0 } : f0; fields[fn] = f.type === 'category' ? new Int8Array(o.count).fill(-1) : new Float32Array(o.count).fill(NaN); }
      const idx = Int32Array.from({ length: o.index.length }, (_, k) => (o.index[k] === undefined || o.index[k] === null ? -1 : o.index[k]));
      st.bind.set(entity, { count: o.count, idx, fields, synced: -1, syncT: -1, syncGen: -1, stats: { full: 0, patch: 0, touched: 0 } });
      return store;
    };
    store.bound = entity => {
      const b = st.bind.get(entity); if (!b) return null;
      const fr = st.frames[st.time.t], data = fr && fr.entities && fr.entities[entity];
      if (b.synced === st.data || !data) return { version: st.shown, fields: b.fields, stats: b.stats };
      const patch = fr.patch && fr.patch[entity];
      if (patch && b.syncGen === st.gen && b.syncT === st.time.t - 1) {                              // one step on from a patch: touch only what changed
        for (const [fn, ch] of Object.entries(patch)) {
          const dst = b.fields[fn]; if (!dst) continue;
          for (let i = 0; i < ch.idx.length; i++) { const s = b.idx[ch.idx[i]]; if (s >= 0) { dst[s] = ch.val[i]; b.stats.touched++; } }
        }
        b.stats.patch++;
      } else {
        for (const fn of Object.keys(b.fields)) {
          const dst = b.fields[fn], src = data[fn]; if (!src) continue;
          dst.fill(dst instanceof Int8Array ? -1 : NaN);
          for (let k = 0; k < b.idx.length; k++) { const s = b.idx[k]; if (s >= 0) dst[s] = src[k]; }
        }
        b.stats.full++; b.stats.touched += b.idx.length;
      }
      b.synced = st.data; b.syncT = st.time.t; b.syncGen = st.gen;
      return { version: st.shown, fields: b.fields, stats: b.stats };
    };
    // What the map shows changes, though the data has not (which colouring is chosen): bumps the version the renderer keys its caches on.
    store.invalidate = () => { st.shown++; emit('view'); };
    store.shownVersion = () => st.shown;

    store.snapshot = () => JSON.parse(JSON.stringify({ params: st.params, time: st.time, selection: st.selection }));
    return store;
  }

  root.PackStore = { create, TOPICS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PackStore;
})(typeof window !== 'undefined' ? window : globalThis);
