/* packruntime.js: the runtime adapter for a model pack. One interface, so the shell never knows how a model is computed.
 *
 * A `js` runtime is a plain object registered by the pack's runtime file:
 *
 *   PaperDolls.registerRuntime('toy-epidemic', {
 *     init(params, entities, seed) -> handle        entities: { building: { count: 600, fields: ['state', 'exposure'] } }
 *     step(handle, n)              -> frames[]      advances n steps and returns the n new frames; n = 0 returns [the current frame] without advancing
 *     run(handle, toT)             -> frames[]      (optional) steps up to time toT and returns the new frames; used to fill the timeline in one go
 *     setParams(handle, params)    -> handle        required only when manifest.runtime.on_params is "continue": keep the state, use the new parameters from now on
 *     snapshot(handle)             -> state         (optional) a plain, structured-cloneable copy of everything that is needed to carry on
 *     restore(handle, state)       -> handle        (optional) the inverse of snapshot
 *     inspect(handle, id, t)       -> detail        (optional) what the inspector shows for one entity: id is { entity, id } (the shape of store.selection()), t the time shown;
 *                                                   detail is { title?, fields: [{ label, value, unit? }], note? }. Asked on demand, never sent with a frame.
 *     bindScene(scene)             -> { entities, sceneIndex }   (optional) build the entities from the real scene; see docs/pack-spec.md
 *   });
 *
 * A frame is { t, entities: { name: { field: array } }, series: { name: [numbers] } }. Time 0 is the state before the first step. Category fields
 * hold the index into the field's declared values (-1 for "no data"); number fields hold numbers (NaN for "no data"); every array has the entity's count.
 * After time 0 a frame may be a patch instead: { t, patch: { entity: { field: { idx: Int32Array, val: array } } }, series }, the entities and values that differ from the
 * frame before it. A patch costs what changed, not what exists, and the store applies it (packstore.js).
 *
 * Rules carried over from the model hook: a runtime is deterministic given (params, seed), and drawing never uses the model's random generator.
 * `PackRuntime.create` wraps a runtime, checks every frame against the manifest, and applies the manifest's on_params policy
 * ("rerun": a parameter change starts again from time 0; "continue": it calls setParams and the run goes on).
 */
(function (root) {
  'use strict';
  const PD = root.PaperDolls || (root.PaperDolls = {});
  const registry = PD.runtimes || (PD.runtimes = {});
  PD.registerRuntime = (id, impl) => {
    if (typeof id !== 'string' || !id) throw new Error('registerRuntime needs the pack id');
    if (!impl || typeof impl.init !== 'function' || typeof impl.step !== 'function') throw new Error('runtime ' + id + ' needs init(params, entities, seed) and step(handle, n)');
    registry[id] = impl; return impl;
  };
  PD.getRuntime = id => registry[id] || null;

  const plain = v => (ArrayBuffer.isView(v) ? Array.from(v) : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);
  const digest = frames => JSON.stringify(plain(frames), (k, v) => (typeof v === 'number' && !isFinite(v) ? String(v) : v));     // NaN and infinity survive JSON as text, so they compare

  // What the runtime is given as `entities`: the declared counts and field names.
  // `attrs` (optional, from bindScene): per-entity arrays about the real buildings, handed to the model as entities.<name>.attrs.
  function entitySpec(manifest, counts, attrs) {
    const out = {};
    for (const [name, e] of Object.entries(manifest.entities || {})) {
      const n = counts && counts[name] !== undefined ? counts[name] : e.count || 0;
      out[name] = { count: n, fields: Object.keys(e.fields || {}) };
      if (attrs && attrs[name]) out[name].attrs = attrs[name];
    }
    return out;
  }

  // ---- bindScene: let the pack build its entities from the real scene ----
  // A scene building is addressed by its id; a building with no id is addressed as "#<index>" (sceneKey), so a pack can bind to any scene.
  const sceneKey = (b, i) => (b && b.id !== undefined && b.id !== null ? b.id : '#' + i);

  // impl.bindScene(scene) -> { entities: { name: { count, attrs? } }, sceneIndex: { name: [id | null, ...] } }   (sceneIndex[name].length === count)
  // Returns { ok, bound, error?, warnings[], counts, attrs, pos } where pos[name] is an Int32Array: the scene building index of entity k, or -1 when the entity
  // stands on no building (null, an id the scene does not have, or an id an earlier entity of the same kind already took). Those are warnings, never errors:
  // the model still runs, the entity is just not drawn.
  function bindScene(manifest, impl, scene) {
    const none = { ok: true, bound: false, warnings: [], counts: null, attrs: null, pos: {} };
    if (!impl || typeof impl.bindScene !== 'function') return none;
    const fail = m => ({ ok: false, bound: false, error: 'bindScene: ' + m, warnings: [], counts: null, attrs: null, pos: {} });
    let res;
    try { res = impl.bindScene(scene); } catch (e) { return fail(e.message); }
    if (!res || typeof res !== 'object' || !res.entities || typeof res.entities !== 'object' || !res.sceneIndex || typeof res.sceneIndex !== 'object') return fail('must return { entities, sceneIndex }');
    const where = new Map(); (scene.buildings || []).forEach((b, i) => { const k = sceneKey(b, i); if (!where.has(k)) where.set(k, i); });
    const warnings = [], counts = {}, attrs = {}, pos = {};
    for (const [name, e] of Object.entries(res.entities)) {
      if (!(manifest.entities || {})[name]) return fail('entities.' + name + ' is not declared in the manifest');
      if (!e || !Number.isInteger(e.count) || e.count < 0) return fail('entities.' + name + '.count must be a whole number');
      const idx = res.sceneIndex[name];
      if (!Array.isArray(idx) && !ArrayBuffer.isView(idx)) return fail('sceneIndex.' + name + ' is missing');
      if (idx.length !== e.count) return fail('sceneIndex.' + name + ' has ' + idx.length + ' entries for ' + e.count + ' entities');
      counts[name] = e.count; if (e.attrs) attrs[name] = e.attrs;
      const p = new Int32Array(e.count).fill(-1), taken = new Set(), unknown = [], dup = [];
      for (let k = 0; k < e.count; k++) {
        const id = idx[k]; if (id === null || id === undefined) continue;
        if (typeof id !== 'string' && typeof id !== 'number') return fail('sceneIndex.' + name + '[' + k + '] must be a scene building id or null');
        const i = where.get(id);
        if (i === undefined) { unknown.push(id); continue; }
        if (taken.has(i)) { dup.push(id); continue; }
        taken.add(i); p[k] = i;
      }
      pos[name] = p;
      if (unknown.length) warnings.push(unknown.length + ' ' + name + ' entities name a building the scene does not have (' + unknown.slice(0, 3).join(', ') + (unknown.length > 3 ? ', ...' : '') + '): not drawn');
      if (dup.length) warnings.push(dup.length + ' ' + name + ' entities share a scene building with an earlier one (' + dup.slice(0, 3).join(', ') + (dup.length > 3 ? ', ...' : '') + '): not drawn');
    }
    return { ok: true, bound: true, warnings, counts, attrs, pos };
  }
  const fieldType = f => (typeof f === 'string' ? { type: f } : f);

  // Problems with a frame, as strings (none: the frame is good). Series points given as a bare number are accepted for a one-value series.
  function checkFrame(manifest, ents, frame, wantT) {
    const bad = [];
    if (!frame || typeof frame !== 'object') return ['frame is not an object'];
    if (frame.t !== wantT) bad.push('t is ' + frame.t + ', expected ' + wantT);
    if (frame.patch && !frame.entities) {
      if (wantT === 0) bad.push('frame 0 must be whole, not a patch');
      for (const [name, pf] of Object.entries(frame.patch)) {
        const e = (manifest.entities || {})[name];
        if (!e) { bad.push('patch.' + name + ' is not an entity of the manifest'); continue; }
        for (const [fn, ch] of Object.entries(pf)) {
          const f0 = (e.fields || {})[fn]; if (f0 === undefined) { bad.push('patch.' + name + '.' + fn + ' is not a field'); continue; }
          const f = fieldType(f0), where = 'patch.' + name + '.' + fn;
          if (!ch || !ch.idx || !ch.val || ch.idx.length !== ch.val.length) { bad.push(where + ' needs idx and val of the same length'); continue; }
          let ok = true;
          for (let i = 0; i < ch.idx.length && ok; i++) {
            const k = ch.idx[i], v = ch.val[i];
            if (!(Number.isInteger(k) && k >= 0 && k < ents[name].count)) { bad.push(where + '.idx[' + i + '] = ' + k + ' is not an entity number below ' + ents[name].count); ok = false; }
            else if (f.type === 'category' ? !(Number.isInteger(v) && v >= -1 && v < f.values.length) : (typeof v !== 'number' && typeof v !== 'boolean')) { bad.push(where + '.val[' + i + '] = ' + v + ' is not a legal value'); ok = false; }
          }
        }
      }
    } else for (const [name, e] of Object.entries(manifest.entities || {})) {
      const data = frame.entities && frame.entities[name];
      if (!data) { bad.push('no entities.' + name); continue; }
      for (const [fn, f0] of Object.entries(e.fields || {})) {
        const f = fieldType(f0), a = data[fn];
        if (!a || typeof a.length !== 'number') { bad.push('entities.' + name + '.' + fn + ' is not an array'); continue; }
        if (a.length !== ents[name].count) { bad.push('entities.' + name + '.' + fn + ' has ' + a.length + ' values, expected ' + ents[name].count); continue; }
        if (f.type === 'category') {
          for (let i = 0; i < a.length; i++) if (!(Number.isInteger(a[i]) && a[i] >= -1 && a[i] < f.values.length)) { bad.push('entities.' + name + '.' + fn + '[' + i + '] = ' + a[i] + ' is not an index into ' + f.values.join('/') + ' (or -1)'); break; }
        } else for (let i = 0; i < a.length; i++) if (typeof a[i] !== 'number' && typeof a[i] !== 'boolean') { bad.push('entities.' + name + '.' + fn + '[' + i + '] is not a number'); break; }
      }
    }
    for (const [name, pt] of Object.entries(frame.series || {})) {
      const s = (manifest.series || {})[name];
      if (!s) { bad.push('series.' + name + ' is not declared in the manifest'); continue; }
      const arr = typeof pt === 'number' ? [pt] : pt;
      if (!Array.isArray(arr) || arr.length !== s.y.length || !arr.every(x => typeof x === 'number')) bad.push('series.' + name + ' must be ' + s.y.length + ' number(s) for ' + s.y.join(', '));
    }
    return bad;
  }

  // Missing parts of the interface, given the manifest's policy.
  function checkInterface(manifest, impl) {
    const bad = [];
    if (!impl || typeof impl.init !== 'function') bad.push('init is missing');
    if (!impl || typeof impl.step !== 'function') bad.push('step is missing');
    if (impl && (manifest.runtime || {}).on_params === 'continue' && typeof impl.setParams !== 'function') bad.push('setParams is missing (runtime.on_params is "continue")');
    if (impl && (!!impl.snapshot !== !!impl.restore)) bad.push('snapshot and restore go together');
    return bad;
  }

  function create(manifest, impl, opts) {
    opts = Object.assign({ validate: true, counts: null, attrs: null }, opts || {});
    const missing = checkInterface(manifest, impl);
    if (missing.length) throw new Error('runtime ' + manifest.id + ': ' + missing.join('; '));
    const rt = manifest.runtime || {}, policy = rt.on_params || 'rerun', horizon = manifest.time.steps;
    const ents = entitySpec(manifest, opts.counts, opts.attrs);
    let handle = null, t = 0, seed = rt.seed === undefined ? 1 : rt.seed, params = null;
    const take = (frames, from) => {
      if (!Array.isArray(frames)) throw new Error('runtime ' + manifest.id + ': step/run must return an array of frames');
      frames.forEach((f, i) => {
        for (const k of Object.keys(f.series || {})) if (typeof f.series[k] === 'number') f.series[k] = [f.series[k]];
        if (opts.validate) { const bad = checkFrame(manifest, ents, f, from + i); if (bad.length) throw new Error('runtime ' + manifest.id + ', frame ' + (from + i) + ': ' + bad.slice(0, 3).join('; ')); }
      });
      return frames;
    };
    const r = {
      manifest, policy, horizon, entities: ents,
      get t() { return t; },
      // Begin again from time 0 with these parameters. Returns the frame at time 0.
      start(p, s) {
        params = Object.assign({}, p); if (s !== undefined) seed = s;
        handle = impl.init(Object.assign({}, params), plain(ents), seed); t = 0;
        return take(impl.step(handle, 0), 0)[0];
      },
      // New parameters: a re-run starts again (and returns the frame at time 0); "continue" keeps the state and returns null.
      setParams(p) {
        if (policy === 'rerun') return { restarted: true, frame: r.start(p) };
        params = Object.assign({}, p);
        const h = impl.setParams(handle, Object.assign({}, params)); if (h !== undefined) handle = h;
        return { restarted: false, frame: null };
      },
      step(n) { if (!handle) throw new Error('start() first'); n = Math.max(0, n | 0); const fr = take(impl.step(handle, n), t + 1); t += fr.length; return fr; },
      run(toT) {
        if (!handle) throw new Error('start() first');
        toT = Math.min(horizon, toT | 0); if (toT <= t) return [];
        const fr = impl.run ? take(impl.run(handle, toT), t + 1) : take(impl.step(handle, toT - t), t + 1);
        t += fr.length; return fr;
      },
      canInspect: typeof impl.inspect === 'function',
      // Detail for one entity, from the model's own state (the end of the run), asked for on demand. null when the runtime cannot say.
      inspect(sel, tShown) { if (!handle || !impl.inspect) return null; return impl.inspect(handle, { entity: sel.entity, id: sel.id }, tShown === undefined ? t : tShown) || null; },
      canSnapshot: !!(impl.snapshot && impl.restore),
      snapshot() { if (!impl.snapshot) throw new Error('this runtime has no snapshot'); return { t, params: Object.assign({}, params), state: impl.snapshot(handle) }; },
      restore(snap) { if (!impl.restore) throw new Error('this runtime has no restore'); const h = impl.restore(handle, snap.state); if (h !== undefined) handle = h; t = snap.t; params = Object.assign({}, snap.params); },
    };
    return r;
  }

  // The checks every runtime must pass (also run by `paperdolls pack check` once it can run a runtime, and by the toy pack's tests):
  //   same (params, seed) -> the same frames; a snapshot restored later continues exactly as the original did; frames match the manifest.
  function checkRuntime(manifest, impl, params, steps) {
    const out = [], p = Object.assign({}, ...Object.entries(manifest.params).map(([k, v]) => ({ [k]: v.default })), params || {}), n = Math.min(steps || manifest.time.steps, manifest.time.steps);
    const play = () => { const r = create(manifest, impl); const f0 = r.start(p); return [f0].concat(r.run(n)); };
    let a, b;
    try { a = play(); b = play(); } catch (e) { return ['runtime failed: ' + e.message]; }
    if (a.length !== n + 1) out.push('run(' + n + ') gave ' + (a.length - 1) + ' steps');
    if (digest(a) !== digest(b)) out.push('two runs with the same parameters and seed differ: the runtime is not deterministic');
    const rr = create(manifest, impl);
    if (rr.canSnapshot) {
      rr.start(p); rr.step(Math.floor(n / 2)); const snap = rr.snapshot();
      const tail1 = rr.run(n); rr.restore(snap); const tail2 = rr.run(n);
      if (digest(tail1) !== digest(tail2)) out.push('a restored snapshot does not continue as the original did');
    }
    return out;
  }

  root.PackRuntime = { create, checkFrame, checkInterface, checkRuntime, entitySpec, digest, bindScene, sceneKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PackRuntime;
})(typeof window !== 'undefined' ? window : globalThis);
