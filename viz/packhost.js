/* packhost.js: the shell of a model-pack page. It turns the manifest into controls and a legend, runs the runtime when a parameter moves, plays the
 * timeline, and styles the buildings of the existing renderer from the current frame. It talks to everything through the store (packstore.js).
 *
 *   const ctl  = PackHost.createController({ manifest, runtime, store, immediate });   // runs the model; ctl.flush() re-runs if a parameter moved
 *   PackHost.mountUI({ manifest, store, controller: ctl, doc, regions: { left, right, bottom }, display: [...] });
 *   PackHost.bindRenderer({ manifest, store, controller: ctl, sim, bound });                  // sim.buildingStyle reads the store's current frame
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
  const drawnEntity = manifest => { const m = (manifest.mappings || []).find(x => x.channel === 'wall' || x.channel === 'overlay'); return m ? m.entity : null; };
  const num = v => (Math.round(v * 1000) / 1000);

  // ---- legend: made from the mappings, so it can describe only what is drawn ----
  function legendFor(manifest) {
    return (manifest.mappings || []).filter(m => m.channel === 'wall' || m.channel === 'overlay').map(m => {
      const f = fieldOf(manifest, m.entity, m.field), title = m.scale.label || (f && f.label) || m.field;
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
  function createController(o) {
    const { manifest, runtime, store } = o, horizon = manifest.time.steps;
    const ctl = { wall: 0, dirty: false, runs: 0, lastRunMs: 0, error: null, acc: 0 };
    const clock = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
    function rerun() {
      const t0 = clock();
      try {
        const res = runtime.setParams(store.params());
        if (res.restarted) store.pushFrames([res.frame].concat(runtime.run(horizon)), { replace: true });
        else if (!store.length()) store.pushFrames([runtime.start(store.params())], { replace: true });
        ctl.error = null;
      } catch (e) { ctl.error = e.message; if (root.console) root.console.error(e); }
      ctl.runs++; ctl.lastRunMs = clock() - t0; ctl.onRun && ctl.onRun(ctl);
    }
    ctl.start = () => {
      try { store.pushFrames([runtime.start(store.params())].concat(runtime.policy === 'rerun' ? runtime.run(horizon) : []), { replace: true }); ctl.error = null; }
      catch (e) { ctl.error = e.message; if (root.console) root.console.error(e); }
    };
    // a changed parameter marks the model stale; the re-run happens once, at the next flush, however many events came before it (the page flushes from a zero-delay timer and again every animation frame, so a hidden tab still answers)
    store.subscribe('params', () => { ctl.dirty = true; if (o.immediate) ctl.flush(); else if (o.schedule) o.schedule(); });
    ctl.flush = () => { if (!ctl.dirty) return false; ctl.dirty = false; rerun(); return true; };
    // "continue" models make a frame only when the clock reaches it
    ctl.ensure = t => { while (runtime.policy === 'continue' && store.length() <= t && runtime.t < horizon) store.pushFrames(runtime.step(1)); };
    ctl.advance = dt => {
      const tm = store.time(); if (!tm.playing) return;
      ctl.acc += dt * tm.speed;
      while (ctl.acc >= 1) {
        ctl.acc -= 1;
        const next = store.time().t + 1;
        if (next > horizon) { store.setPlaying(false); ctl.acc = 0; break; }
        ctl.ensure(next); store.setTime(next);
      }
    };
    ctl.togglePlay = () => { const tm = store.time(); if (!tm.playing && tm.t >= horizon) store.setTime(0); store.setPlaying(!tm.playing); };
    ctl.setWall = i => { const n = wallMaps(manifest).length; ctl.wall = Math.max(0, Math.min(Math.max(0, n - 1), i | 0)); };
    return ctl;
  }

  // ---- renderer: style the buildings from the current frame ----
  function bindRenderer(o) {
    const { manifest, store, controller: ctl, sim } = o, R = o.Replay || root.Replay, en = drawnEntity(manifest);
    if (!en) return { ok: false, error: 'the manifest maps nothing to the map' };
    // With a bindScene result (o.bound, from PackRuntime.bindScene) entity k stands on the scene building the pack named; without one, the invented fixed order (Replay.place).
    const bound = o.bound && o.bound.bound && o.bound.pos[en] ? o.bound : null;
    const count = bound ? bound.counts[en] : (manifest.entities[en] || {}).count || 0;
    let placement = null, rank = new Map(), entityOf, placed;
    if (bound) {
      const pos = bound.pos[en], byScene = new Map();           // scene building index -> entity index
      pos.forEach((si, k) => { if (si >= 0) byScene.set(si, k); });
      sim.buildings.forEach((e, i) => { if (byScene.has(i)) rank.set(e, byScene.get(i)); });
      placed = byScene.size;
      entityOf = k => (pos[k] >= 0 ? sim.buildings[pos[k]] : null);
    } else {
      placement = R.place(sim.scene, count);
      if (!placement.ok) return { ok: false, error: placement.error };
      sim.buildings.forEach((e, i) => rank.set(e, placement.rank[i]));
      placed = count;
      entityOf = k => sim.buildings[placement.order[k]];
    }
    const walls = wallMaps(manifest).filter(m => m.entity === en).map(m => ({ field: m.field, sc: scaleFor(manifest, m) }));
    const overlays = overlayMaps(manifest).filter(m => m.entity === en).map(m => ({ field: m.field, sc: scaleFor(manifest, m) }));
    const none = { data: null, overlays: [] };
    sim.buildingStyle = e => {
      const k = rank.get(e), fr = store.frame(), d = fr && fr.entities[en];
      if (!d || k === undefined || k >= count) return none;
      const w = walls[Math.min(ctl ? ctl.wall : 0, walls.length - 1)], ov = [];
      for (const m of overlays) { const o2 = m.sc.overlay(d[m.field][k]); if (o2) ov.push(o2); }
      return { data: w ? w.sc.colour(d[w.field][k]) : null, overlays: ov };
    };
    return { ok: true, bound: !!bound, placement, entityOf, count, placed, warnings: bound ? bound.warnings : [], dispose() { sim.buildingStyle = null; } };
  }

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
    for (const region of ['left', 'right', 'bottom']) {
      const host = reg[region]; if (!host) continue;
      for (const item of layout[region] || []) { if (!item.control) continue; const n = components[item.control] && components[item.control](item); if (n) host.appendChild(n); }
    }
    const refresh = () => refreshers.forEach(f => f());
    const offs = [store.subscribe('params', refresh), store.subscribe('time', refresh), store.subscribe('frames', refresh)];
    refresh();
    return { refresh, destroy() { offs.forEach(f => f()); } };
  }

  root.PackHost = { legendFor, scaleFor, createController, bindRenderer, mountUI, NO_DATA };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PackHost;
})(typeof window !== 'undefined' ? window : globalThis);
