/* packhost.js: the shell of a model-pack page. It turns the manifest into controls and a legend, runs the runtime when a parameter moves, plays the
 * timeline, and styles the buildings of the existing renderer from the current frame. It talks to everything through the store (packstore.js).
 *
 *   const ctl  = PackHost.createController({ manifest, runtime, store, immediate });   // runs the model; ctl.flush() re-runs if a parameter moved
 *   PackHost.mountUI({ manifest, store, controller: ctl, doc, regions: { left, right, bottom }, display: [...] });
 *   PackHost.bindRenderer({ manifest, store, controller: ctl, sim, bound });                  // sim.buildingStyle reads the store's bound typed arrays; sim.frameVersion follows the store
 *   PackHost.bindInteraction({ manifest, store, sim, binding, pick: Pick.create(sim), box, camera, doc, tip, controller });   // hover, click, Esc, arrows
 *
 * Only the first entity that has a wall or overlay mapping is drawn. When the pack's runtime has a bindScene, entity k stands on the scene building it names
 * (PackRuntime.bindScene); otherwise one entity to one scene building in a fixed order (Replay.place), which is invented and the page says so. Pure helpers (legendFor, scaleFor) have no DOM.
 */
(function (root) {
  'use strict';
  const NO_DATA = '#cfcabd';
  const fieldOf = (manifest, en, fn) => { const f = ((manifest.entities || {})[en] || { fields: {} }).fields[fn]; return typeof f === 'string' ? { type: f } : f; };
  const wallMaps = manifest => (manifest.mappings || []).filter(m => m.channel === 'wall');
  const overlayMaps = manifest => (manifest.mappings || []).filter(m => m.channel === 'overlay');
  const segMaps = manifest => (manifest.mappings || []).filter(m => m.channel === 'segments');
  const DRAWN = ['wall', 'overlay', 'segments'];
  const drawnEntity = manifest => { const m = (manifest.mappings || []).find(x => DRAWN.includes(x.channel)); return m ? m.entity : null; };
  const num = v => (Math.round(v * 1000) / 1000);

  // ---- legend: made from the mappings, so it can describe only what is drawn ----
  function legendFor(manifest) {
    return (manifest.mappings || []).filter(m => DRAWN.includes(m.channel)).map(m => {
      const f = fieldOf(manifest, m.entity, m.field), title = m.scale.label || (f && f.label) || m.field;
      if (m.channel === 'segments') return { title, kind: 'swatches', items: [{ label: 'Done: the first units of the building, drawn as sections of its walls', colour: m.scale.colour }, { label: 'Not yet', colour: m.scale.todo || null }] };
      if (m.scale.type === 'sequential') return { title, kind: 'ramp', colours: m.scale.colours.slice(), domain: m.scale.domain.slice(), noData: NO_DATA };
      const order = f && f.type === 'category' ? f.values.filter(v => v in m.scale.values) : Object.keys(m.scale.values);
      let items;
      if (m.channel === 'wall') { items = order.map(k => ({ label: m.scale.values[k].label, colour: m.scale.values[k].colour })); items.push({ label: 'No data', colour: NO_DATA }); }
      else {                                    // an overlay is one entry per marking, naming every value that carries it (the unmarked values share one entry)
        const by = new Map();
        for (const k of order) { const v = m.scale.values[k], key = v.overlay || ''; if (!by.has(key)) by.set(key, []); by.get(key).push(v.label); }
        items = [...by].map(([ov, labels]) => ({ label: labels.join(', '), overlay: ov || null }));
      }
      return { title, kind: 'swatches', items };
    });
  }

  // value -> colour, or overlay, for one mapping; the lookup for a category is built once (index into the field's values)
  function scaleFor(manifest, m) {
    const f = fieldOf(manifest, m.entity, m.field);
    if (m.scale.type === 'sequential') {
      const seq = root.Replay && root.Replay.sequential;
      return { colour: v => (v === v && v !== null ? seq(m.scale.colours, m.scale.domain, +v) : NO_DATA), overlay: () => null };
    }
    const names = f.type === 'category' ? f.values : ['false', 'true'];
    const lut = names.map(n => m.scale.values[n] || null);
    const at = v => (f.type === 'category' ? (v >= 0 ? lut[v] : null) : lut[v ? 1 : 0]) || null;
    return { colour: v => { const hit = at(v); return hit && hit.colour ? hit.colour : NO_DATA; }, overlay: v => { const hit = at(v); return hit && hit.overlay ? hit.overlay : null; } };
  }

  // ---- controller: owns the runtime, re-runs it, plays the timeline ----
  // The runtime is either the synchronous adapter (PackRuntime.create) or the asynchronous one (PackWorker.create, runtime.async === true). With the second a
  // re-run is a request that streams its frames back in chunks; a newer parameter change cancels it, and its late chunks are dropped (ctl.gen). The frames of the
  // run being replaced stay on screen until the new run has reached the time being looked at, so a slider moves the map without a flicker back to time 0.
  function createController(o) {
    const { manifest, runtime, store } = o, horizon = manifest.time.steps, isAsync = !!runtime.async;
    const ctl = { wall: 0, dirty: false, runs: 0, lastRunMs: 0, error: null, acc: 0, gen: 0, running: false, async: isAsync, mode: runtime.mode || 'inline' };
    const clock = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
    const fail = e => { ctl.error = (e && e.message) || String(e); if (root.console) root.console.error(e); };
    function finish(t0) { ctl.runs++; ctl.lastRunMs = clock() - t0; ctl.running = false; ctl.onRun && ctl.onRun(ctl); }
    // Stream a run into the store: hold the chunks until they reach `want` (or the run ends), replace the old frames with them once, then extend.
    function stream(gen, first, want) {
      let held = [first], replaced = false;
      const put = (frames, last) => {
        if (gen !== ctl.gen) return;
        held = held.concat(frames);
        if (!replaced && (held.length > want || last)) { store.pushFrames(held, { replace: true }); replaced = true; held = []; }
        else if (replaced && frames.length) { store.pushFrames(frames); held = []; }
      };
      return runtime.run(horizon, fr => put(fr, false)).then(r => { if (!r.cancelled) put([], true); });
    }
    function rerun() {
      const t0 = clock();
      if (isAsync) {
        const gen = ++ctl.gen; ctl.running = true; const want = store.time().t;
        runtime.setParams(store.params()).then(res => {
          if (gen !== ctl.gen) return null;
          if (res.restarted) return stream(gen, res.frame, want);
          if (!store.length()) store.pushFrames([res.frame || null].filter(Boolean), { replace: true });
          return null;
        }).then(() => { if (gen === ctl.gen) { ctl.error = null; finish(t0); } }, e => { if (gen === ctl.gen) { fail(e); finish(t0); } });
        return;
      }
      try {
        const res = runtime.setParams(store.params());
        if (res.restarted) store.pushFrames([res.frame].concat(runtime.run(horizon)), { replace: true });
        else if (!store.length()) store.pushFrames([runtime.start(store.params())], { replace: true });
        ctl.error = null;
      } catch (e) { fail(e); }
      finish(t0);
    }
    ctl.start = () => {
      if (isAsync) {
        const gen = ++ctl.gen, t0 = clock(); ctl.running = true;
        const done = runtime.start(store.params()).then(f0 => (gen !== ctl.gen ? null : runtime.policy === 'rerun' ? stream(gen, f0, 0) : store.pushFrames([f0], { replace: true })))
          .then(() => { if (gen === ctl.gen) { ctl.error = null; finish(t0); } }, e => { if (gen === ctl.gen) { fail(e); finish(t0); } });
        return done;
      }
      try { store.pushFrames([runtime.start(store.params())].concat(runtime.policy === 'rerun' ? runtime.run(horizon) : []), { replace: true }); ctl.error = null; }
      catch (e) { fail(e); }
      return Promise.resolve();
    };
    // a changed parameter marks the model stale; the re-run happens once, at the next flush, however many events came before it (the page flushes from a zero-delay timer and again every animation frame, so a hidden tab still answers)
    store.subscribe('params', () => { ctl.dirty = true; if (o.immediate) ctl.flush(); else if (o.schedule) o.schedule(); });
    ctl.flush = () => { if (!ctl.dirty) return false; ctl.dirty = false; rerun(); return true; };
    // "continue" models make a frame only when the clock reaches it (the asynchronous adapter streams a whole run instead)
    ctl.ensure = t => { while (!isAsync && runtime.policy === 'continue' && store.length() <= t && runtime.t < horizon) store.pushFrames(runtime.step(1)); };
    ctl.advance = dt => {
      const tm = store.time(); if (!tm.playing) return;
      ctl.acc += dt * tm.speed;
      while (ctl.acc >= 1) {
        ctl.acc -= 1;
        const next = store.time().t + 1;
        if (next > horizon) { store.setPlaying(false); ctl.acc = 0; break; }
        if (isAsync && next >= store.length()) { ctl.acc = 0; break; }              // the clock waits for the frame to arrive
        ctl.ensure(next); store.setTime(next);
      }
    };
    ctl.togglePlay = () => { const tm = store.time(); if (!tm.playing && tm.t >= horizon) store.setTime(0); store.setPlaying(!tm.playing); };
    ctl.setWall = i => { const n = wallMaps(manifest).length, w = Math.max(0, Math.min(Math.max(0, n - 1), i | 0)); if (w !== ctl.wall) { ctl.wall = w; store.invalidate(); } };
    // detail for one entity: the runtime's answer (a promise either way), at the time shown
    ctl.inspect = sel => { try { return Promise.resolve(runtime.inspect(sel, store.time().t)); } catch (e) { return Promise.reject(e); } };
    return ctl;
  }

  // ---- renderer: style the buildings from the current frame ----
  // The store keeps per-building values as typed arrays indexed by scene building (store.bindScene / store.bound). sim.buildingStyle reads them and returns one of a
  // small table of shared style objects (a wall colour and a set of overlays), so a draw allocates nothing. sim.frameVersion is the store's version of "what the map
  // shows": the renderer asks for a building's style again, and repaints its far-zoom layer, only when that number moves.
  const OVERLAYS = ['scaffold', 'solar', 'band', 'marker', 'insulation', 'community'];       // the bit of an overlay in a style's mask is its position here: only ever append
  const LEVELS = 128;                                       // a sequential scale is read in this many steps: a table of colours, not a string per building
  function bindRenderer(o) {
    const { manifest, store, controller: ctl, sim } = o, R = o.Replay || root.Replay, en = drawnEntity(manifest);
    if (!en) return { ok: false, error: 'the manifest maps nothing to the map' };
    // With a bindScene result (o.bound, from PackRuntime.bindScene) entity k stands on the scene building the pack named (pos[k], -1: not drawn); without one,
    // the invented fixed order (Replay.place).
    const bound = o.bound && o.bound.bound && o.bound.pos[en] ? o.bound : null;
    const count = bound ? bound.counts[en] : (manifest.entities[en] || {}).count || 0;
    let placement = null;
    if (!bound) { placement = R.place(sim.scene, count); if (!placement.ok) return { ok: false, error: placement.error }; }
    const nScene = sim.buildings.length, index = new Int32Array(count), modelOf = new Int32Array(nScene).fill(-1);
    for (let k = 0; k < count; k++) { index[k] = bound ? bound.pos[en][k] : placement.order[k]; if (index[k] >= 0) modelOf[index[k]] = k; }
    const placed = bound ? modelOf.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0) : count;
    sim.buildings.forEach((e, i) => { e._si = i; });
    store.bindScene(en, { count: nScene, index });
    // for each mapping: a code per value (0 is "no data") and a table from code to colour or overlay bit
    const reader = m => {
      const f = fieldOf(manifest, m.entity, m.field), sc = scaleFor(manifest, m), cols = [NO_DATA], bits = [0];
      let code;
      if (m.scale.type === 'sequential') {
        const lo = m.scale.domain[0], hi = m.scale.domain[1];
        for (let j = 0; j < LEVELS; j++) { cols.push(sc.colour(lo + (hi - lo) * j / (LEVELS - 1))); bits.push(0); }
        code = v => (v === v ? 1 + Math.max(0, Math.min(LEVELS - 1, Math.round((v - lo) / (hi - lo) * (LEVELS - 1)))) : 0);
      } else {
        const n = f.type === 'category' ? f.values.length : 2;
        for (let j = 0; j < n; j++) { cols.push(sc.colour(j)); const ov = sc.overlay(j); bits.push(ov ? 1 << OVERLAYS.indexOf(ov) : 0); }
        code = f.type === 'category' ? (v => (v >= 0 && v < n ? v + 1 : 0)) : (v => (v === v ? (v ? 2 : 1) : 0));
        bits[0] = 0;
      }
      return { field: m.field, code, cols, bits };
    };
    const walls = wallMaps(manifest).filter(m => m.entity === en).map(reader), overlays = overlayMaps(manifest).filter(m => m.entity === en).map(reader);
    // segments: k of n units. Both come from the frame; n is capped for drawing (AssetLib.segmentsFor) and the style carries the capped pair, so there are at most
    // 12 * 13 + 1 distinct values per mapping and the style objects stay shared. Only the first segments mapping of the drawn entity is used.
    const sm = segMaps(manifest).find(m => m.entity === en) || null, segCap = sm ? Math.min(sm.max || 12, (R && root.AssetLib ? root.AssetLib.SEG_MAX : 12)) : 0;
    const segOf = sm ? (i => {
      const n = F[sm.total][i], k = F[sm.field][i]; if (!(n >= 2) || !(k >= 0)) return 0;
      const sg = root.AssetLib.segmentsFor(Math.min(n, 1e6), k, segCap); return sg ? sg[0] * 13 + sg[1] + 1 : 0;
    }) : null;
    const NONE = { data: null, overlays: [], seg: null }, table = new Map();
    const styleOf = (w, code, mask, sg) => {                // one shared object per (wall mapping, wall code, overlay set, segment pair)
      const key = ((w * 1024 + code) * 64 + mask) * 256 + sg; let st = table.get(key);
      if (!st) {
        const ov = []; for (let b = 0; b < OVERLAYS.length; b++) if (mask & (1 << b)) ov.push(OVERLAYS[b]);
        st = { data: walls[w] ? walls[w].cols[code] : null, overlays: ov, seg: sg ? { n: Math.floor((sg - 1) / 13), k: (sg - 1) % 13, done: sm.scale.colour, todo: sm.scale.todo || null } : null }; table.set(key, st);
      }
      return st;
    };
    let F = store.bound(en).fields, live = !!store.frame();
    const sync = () => { F = store.bound(en).fields; live = !!store.frame(); sim.frameVersion = store.shownVersion(); };
    sim.buildingStyle = e => {
      const i = e._si;
      if (!live || modelOf[i] < 0) return NONE;
      const w = Math.min(ctl ? ctl.wall : 0, walls.length - 1);
      let mask = 0; for (let j = 0; j < overlays.length; j++) { const ov = overlays[j]; mask |= ov.bits[ov.code(F[ov.field][i])]; }
      const sg = segOf ? segOf(i) : 0;
      if (w < 0) return mask || sg ? styleOf(0, 0, mask, sg) : NONE;
      return styleOf(w, walls[w].code(F[walls[w].field][i]), mask, sg);
    };
    sync();
    const offs = ['time', 'frames', 'view'].map(t => store.subscribe(t, sync));
    const entityOf = bound ? (k => (index[k] >= 0 ? sim.buildings[index[k]] : null)) : (k => sim.buildings[placement.order[k]]);
    return { ok: true, bound: !!bound, placement, entityOf, count, placed, warnings: bound ? bound.warnings : [], entity: en, index, modelOf, nScene, sync,
             styleCount: () => table.size, dispose() { offs.forEach(f => f()); sim.buildingStyle = null; sim.frameVersion = undefined; } };
  }

  // ---- what one entity looks like at the time shown: the frame's own values, labelled the way the legend labels them ----
  function labelOf(manifest, en, fn, f, v) {
    if (f.type === 'category') {
      if (!(v >= 0 && v < f.values.length)) return 'no data';
      const name = f.values[v], m = (manifest.mappings || []).find(x => x.entity === en && x.field === fn && x.scale.type === 'categorical' && x.scale.values[name] && x.scale.values[name].label);
      return m ? m.scale.values[name].label : name;
    }
    if (f.type === 'boolean') return v === v ? (v ? 'yes' : 'no') : 'no data';
    return v === v ? String(Math.round(v * 1000) / 1000) : 'no data';
  }
  function entityRows(manifest, store, sel) {
    const fr = store.frame(), decl = ((manifest.entities || {})[sel.entity] || {}).fields || {}, data = fr && fr.entities && fr.entities[sel.entity];
    if (!data) return [];
    return Object.entries(decl).map(([fn, f0]) => { const f = typeof f0 === 'string' ? { type: f0 } : f0; return { label: f.label || fn, value: labelOf(manifest, sel.entity, fn, f, data[fn][sel.id]) }; });
  }
  const entityTitle = sel => sel.entity.charAt(0).toUpperCase() + sel.entity.slice(1) + ' ' + (sel.id + 1);

  // ---- UI ----
  function mountUI(o) {
    const { manifest, store, controller: ctl, doc } = o, reg = o.regions || {};
    const el = (tag, attrs, ...kids) => {
      const n = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n[k] = v; else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v === true ? '' : v); }
      for (const c of kids) if (c) n.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
      return n;
    };
    const P = manifest.params || {}, refreshers = [];
    const layout = Object.assign({ left: [{ control: 'params' }, { control: 'presets' }], right: [{ control: 'legend' }, { control: 'display' }], bottom: [{ control: 'timeline' }] }, manifest.layout || {});
    let uid = 0; const id = p => 'pk-' + p + '-' + (++uid);

    function paramRow(name) {
      const p = P[name], eid = id(name), label = p.label || name, unit = p.unit ? ' (' + p.unit + ')' : '';
      let input, out = null;
      if (p.type === 'boolean') {
        input = el('input', { type: 'checkbox', id: eid, 'data-param': name });
        input.onchange = () => store.setParam(name, input.checked);
        refreshers.push(() => { input.checked = !!store.param(name); });
      } else if (p.type === 'enum') {
        input = el('select', { id: eid, 'data-param': name }, ...(p.values || []).map(v => { const val = typeof v === 'object' ? v.value : v; return el('option', { value: val, text: typeof v === 'object' && v.label ? v.label : val }); }));
        input.onchange = () => store.setParam(name, input.value);
        refreshers.push(() => { input.value = store.param(name); });
      } else {
        input = el('input', { type: 'range', id: eid, 'data-param': name, min: p.min, max: p.max, step: p.step || (p.type === 'integer' ? 1 : (p.max - p.min) / 200) });
        out = el('output', { for: eid, class: 'pk-val' });
        input.oninput = () => store.setParam(name, input.value);      // fires while the slider moves: the model re-runs live
        refreshers.push(() => { input.value = store.param(name); out.textContent = num(store.param(name)); });
      }
      const row = el('div', { class: 'pk-row' + (p.type === 'boolean' ? ' pk-bool' : '') }, el('label', { for: eid, text: label + unit }), input, out, p.help ? el('small', { text: p.help }) : null);
      if (p.help) row.title = p.help;
      return row;
    }
    const components = {
      params(item) {
        const all = []; for (const [n, p] of Object.entries(P)) { const g = p.group || 'General'; if (!all.includes(g)) all.push(g); }
        const groups = item.groups || all, box = el('div', { class: 'pk-params' });
        for (const g of groups) {
          const names = Object.keys(P).filter(n => (P[n].group || 'General') === g);
          if (names.length) box.appendChild(el('fieldset', {}, el('legend', { text: g }), ...names.map(paramRow)));
        }
        return box;
      },
      presets() {
        const list = manifest.presets || []; if (!list.length) return null;
        const btns = list.map(pr => { const b = el('button', { type: 'button', 'data-preset': pr.id, title: pr.help || null, text: pr.label }); b.onclick = () => store.applyPreset(pr.id); return b; });
        refreshers.push(() => btns.forEach((b, i) => b.classList.toggle('on', store.isPreset(list[i].id))));
        return el('div', { class: 'pk-presets' }, el('b', { text: 'Presets' }), el('div', { class: 'pk-btns' }, ...btns));
      },
      legend() {
        const box = el('div', { class: 'pk-legend' });
        for (const sec of legendFor(manifest)) {
          const row = el('div', { class: 'pk-legrow' }, el('b', { text: sec.title }));
          const sw = (colour, text) => el('span', { class: 'pk-sw' }, el('i', { style: 'background:' + (colour || 'repeating-linear-gradient(45deg,#fff 0 3px,#ddd 3px 6px)') }), text);
          if (sec.kind === 'ramp') { row.appendChild(el('span', { class: 'pk-ramp' }, String(sec.domain[0]), el('i', { style: 'background:linear-gradient(90deg,' + sec.colours.join(',') + ')' }), String(sec.domain[1]))); row.appendChild(sw(sec.noData, 'No data')); }
          else for (const it of sec.items) row.appendChild(it.overlay !== undefined ? el('span', { text: (it.overlay ? it.overlay + ' on the building' : 'no marking') + ' = ' + it.label }) : sw(it.colour, it.label));
          box.appendChild(row);
        }
        const walls = wallMaps(manifest);
        if (walls.length > 1) {
          const sel = el('select', { id: id('wall'), 'data-wall': '' }, ...walls.map((m, i) => el('option', { value: i, text: m.scale.label || m.field })));
          sel.onchange = () => ctl.setWall(+sel.value);
          box.insertBefore(el('div', { class: 'pk-legrow' }, el('label', { for: sel.id, text: 'Colour walls by ' }), sel), box.firstChild);
        }
        return box;
      },
      display() {
        if (!o.display || !o.display.length) return null;
        return el('fieldset', { class: 'pk-display' }, el('legend', { text: 'Display' }), ...o.display.map(d => { const c = el('input', { type: 'checkbox', id: id(d.id), checked: !!d.checked }); c.onchange = () => d.onchange(c.checked); return el('label', { class: 'pk-check', for: c.id }, c, ' ' + d.label); }));
      },
      timeline() {
        const tm = manifest.time, play = el('button', { type: 'button', 'data-play': '' }), slider = el('input', { type: 'range', min: 0, max: tm.steps, step: 1, value: 0, 'aria-label': tm.unit, 'data-time': '' });
        const label = el('span', { class: 'pk-time' }), read = el('div', { class: 'pk-readout', 'aria-live': 'off' });
        const speed = el('select', { 'aria-label': 'Speed', 'data-speed': '' }, ...(tm.speeds || [store.time().speed]).map(s => el('option', { value: s, text: s + ' ' + tm.unit + (s === 1 ? '' : 's') + ' per second' })));
        play.onclick = () => ctl.togglePlay();
        slider.oninput = () => { store.setPlaying(false); ctl.ensure(+slider.value); store.setTime(+slider.value); };
        speed.onchange = () => store.setSpeed(+speed.value);
        const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
        const draw = () => {
          const t = store.time(); play.textContent = t.playing ? 'Pause' : 'Play'; slider.value = t.t; speed.value = t.speed;
          label.textContent = cap(tm.unit) + ' ' + t.t + ' of ' + tm.steps;
          const parts = Object.entries(manifest.series || {}).map(([n, s]) => { const pt = store.latest(n); return pt ? (s.label || n) + ': ' + s.y.map((y, i) => y + ' ' + pt[i]).join(' · ') : null; }).filter(Boolean);
          read.textContent = parts.join('   ');
        };
        refreshers.push(draw);
        return el('div', { class: 'pk-timeline' }, play, slider, label, el('label', {}, 'Speed ', speed), read);
      },
    };
    // The inspector: appears when something is selected. The frame's values show at once; the runtime is then asked for more (on demand, one question at a time,
    // asked again when the time moves) and its answer is added when it comes. It lives in regions.inspector, or else in the right-hand region.
    function inspector() {
      const root0 = el('section', { class: 'pk-inspector', hidden: true, 'aria-live': 'polite' });
      const title = el('b', { class: 'pk-ititle' }), clear = el('button', { type: 'button', 'data-clear': '', 'aria-label': 'Clear selection', text: '×' });
      const fieldsEl = el('dl', { class: 'pk-fields' }), extraEl = el('dl', { class: 'pk-fields pk-extra' }), note = el('p', { class: 'pk-note' });
      clear.onclick = () => store.select(null);
      root0.appendChild(el('header', {}, title, clear)); root0.appendChild(fieldsEl); root0.appendChild(extraEl); root0.appendChild(note);
      const put = (dl, rows) => { dl.textContent = ''; for (const r of rows) { dl.appendChild(el('dt', { text: r.label })); dl.appendChild(el('dd', { text: String(r.value) + (r.unit ? ' ' + r.unit : '') })); } };
      let busy = false, again = false, shown = null;
      const ask = () => {
        const sel = store.selection(); if (!sel || !ctl || !ctl.inspect) return;
        if (busy) { again = true; return; }
        busy = true; const key = sel.entity + ':' + sel.id + '@' + store.time().t;
        Promise.resolve(ctl.inspect(sel)).then(detail => {
          const now = store.selection();
          if (now && now.entity === sel.entity && now.id === sel.id && key === now.entity + ':' + now.id + '@' + store.time().t) {
            shown = detail || null;
            if (detail && detail.title) title.textContent = detail.title;
            put(extraEl, (detail && detail.fields) || []); note.textContent = (detail && detail.note) || '';
          }
        }, e => { note.textContent = 'The model could not say: ' + ((e && e.message) || e); }).then(() => { busy = false; if (again) { again = false; ask(); } });
      };
      const draw = ev => {
        const sel = store.selection();
        root0.hidden = !sel;
        if (!sel) { shown = null; return; }
        if (ev && ev.topic === 'selection') { put(extraEl, []); note.textContent = ''; shown = null; }
        title.textContent = entityTitle(sel); put(fieldsEl, entityRows(manifest, store, sel));
        if (!ev || ev.topic !== 'frames' || ev.replace) ask();
      };
      const offs2 = ['selection', 'time', 'frames'].map(t => store.subscribe(t, draw));
      refreshers.push(() => draw(null));
      root0.destroy = () => offs2.forEach(f => f());
      return root0;
    }
    for (const region of ['left', 'right', 'bottom']) {
      const host = reg[region]; if (!host) continue;
      for (const item of layout[region] || []) { if (!item.control) continue; const n = components[item.control] && components[item.control](item); if (n) host.appendChild(n); }
    }
    const ihost = reg.inspector || reg.right;
    if (ihost) ihost.appendChild(inspector());
    const refresh = () => refreshers.forEach(f => f());
    const offs = [store.subscribe('params', refresh), store.subscribe('time', refresh), store.subscribe('frames', refresh)];
    refresh();
    return { refresh, destroy() { offs.forEach(f => f()); } };
  }

  // ---- interaction: hover, click, keys ----
  // Pointer: moving over the map names the building under it (a tooltip); a click that is not a drag selects it, a click on nothing clears the selection.
  // Keys: Esc clears the selection, the left and right arrows step the time back and forward one step (and pause). Only model entities can be selected;
  // a scene building the model does not use is part of the picture and is ignored. All of it goes through the store: selection is store.select({entity, id}).
  function bindInteraction(o) {
    const { manifest, store, sim, binding, pick, box, camera, doc } = o, en = binding.entity, V = o.VizLib || root.VizLib;
    const tip = o.tip || null, DRAG = 5;
    const wall = () => { const m = wallMaps(manifest).filter(x => x.entity === en); return m[Math.min(o.controller ? o.controller.wall : 0, m.length - 1)] || null; };
    let hover = -1, down = null, lastXY = null;
    const modelAt = (px, py) => { const si = pick.hit(camera.view(), px, py); return si >= 0 && binding.modelOf[si] >= 0 ? { si, k: binding.modelOf[si] } : null; };
    function tipText(k) {
      const sel = { entity: en, id: k }, rows = entityRows(manifest, store, sel), w = wall(), lead = w ? rows.find(r => r.label === (fieldOf(manifest, en, w.field).label || w.field)) : rows[0];
      return entityTitle(sel) + (lead ? ': ' + lead.label + ' ' + lead.value : '');
    }
    function showTip(h, px, py) {
      if (!tip) return;
      if (!h) { tip.hidden = true; return; }
      tip.textContent = tipText(h.k); tip.hidden = false; tip.style.left = Math.round(px + 14) + 'px'; tip.style.top = Math.round(py + 16) + 'px';
    }
    const rel = e => { const r = box.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const onMove = e => {
      const [px, py] = rel(e); lastXY = [px, py];
      if (down || (e.buttons && e.pointerType === 'mouse')) { hover = -1; showTip(null); if (down && Math.hypot(px - down.x, py - down.y) > DRAG) down.moved = true; return; }
      const h = modelAt(px, py); hover = h ? h.k : -1; showTip(h, px, py);
    };
    const onDown = e => { if (e.pointerType === 'mouse' && e.button !== 0) return; const [px, py] = rel(e); down = { x: px, y: py, moved: false, id: e.pointerId }; };
    const onUp = e => {
      const d = down; down = null; if (!d || d.moved || e.pointerId !== d.id) return;
      const [px, py] = rel(e), h = modelAt(px, py);
      store.select(h ? { entity: en, id: h.k } : null);
    };
    const onLeave = () => { hover = -1; showTip(null); };
    const onWheel = () => { hover = -1; showTip(null); };
    const onKey = e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target, tag = t && t.tagName ? t.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;         // a focused slider keeps its own arrow keys
      if (e.key === 'Escape') { if (store.selection()) { store.select(null); e.preventDefault(); } hover = -1; showTip(null); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { store.setPlaying(false); store.setTime(store.time().t + (e.key === 'ArrowRight' ? 1 : -1)); e.preventDefault(); }
    };
    box.addEventListener('pointermove', onMove); box.addEventListener('pointerdown', onDown); box.addEventListener('pointerup', onUp); box.addEventListener('pointerleave', onLeave);
    box.addEventListener('pointercancel', () => { down = null; }); box.addEventListener('wheel', onWheel, { passive: true });
    doc.addEventListener('keydown', onKey);
    const offT = store.subscribe('time', () => { if (hover >= 0 && lastXY) showTip({ k: hover }, lastXY[0], lastXY[1]); });       // the tooltip's value follows the time
    // The outline of the selected (solid) and hovered (dashed) building: its footprint on the ground and lifted by its height, and the edges between.
    function drawHighlight(ctx, view) {
      ctx.clearRect(0, 0, view.w, view.h);
      const sel = store.selection(), items = [];
      if (hover >= 0 && !(sel && sel.id === hover)) items.push([hover, true]);
      if (sel && sel.entity === en && sel.id < binding.count) items.push([sel.id, false]);
      for (const [k, dashed] of items) {
        const si = binding.index[k]; if (si < 0) continue; const sh = pick.silhouette(si), P = (p, z) => V.proj(view, p[0], p[1], z);
        ctx.save(); ctx.lineJoin = 'round'; ctx.lineWidth = dashed ? 1.5 : 2.5; ctx.strokeStyle = dashed ? 'rgba(20,20,20,0.7)' : '#1d4ed8'; ctx.setLineDash(dashed ? [4, 3] : []);
        for (const z of [0, sh.h]) { ctx.beginPath(); sh.footprint.forEach((p, j) => { const q = P(p, z); if (j) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.stroke(); }
        ctx.beginPath(); for (const p of sh.footprint) { const a = P(p, 0), b = P(p, sh.h); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); } ctx.stroke();
        ctx.restore();
      }
    }
    return { drawHighlight, hovered: () => hover, modelAt, dispose() {
      box.removeEventListener('pointermove', onMove); box.removeEventListener('pointerdown', onDown); box.removeEventListener('pointerup', onUp); box.removeEventListener('pointerleave', onLeave); box.removeEventListener('wheel', onWheel);
      doc.removeEventListener('keydown', onKey); offT(); showTip(null);
    } };
  }

  root.PackHost = { legendFor, scaleFor, createController, bindRenderer, bindInteraction, mountUI, entityRows, entityTitle, NO_DATA };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PackHost;
})(typeof window !== 'undefined' ? window : globalThis);
