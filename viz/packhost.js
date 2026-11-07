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
  const DRAWN = ['wall', 'overlay', 'segments', 'outline', 'halo', 'groundtint'];
  const drawnEntity = manifest => { const m = (manifest.mappings || []).find(x => DRAWN.includes(x.channel)); return m ? m.entity : null; };
  const tintMap = (manifest, en) => (manifest.mappings || []).find(m => m.channel === 'groundtint' && m.entity === en) || null;
  const num = v => (Math.round(v * 1000) / 1000);

  // ---- legend: made from the mappings, so it can describe only what is drawn ----
  // Only what is on the map: of the wall mappings, the one in use (wallIdx, as the "Colour walls by" chooser numbers them); every overlay and other channel is drawn at
  // once, so each is listed. A section says which kind it is (`role`: what it paints) and `active: true`; `heading` is the title with its role in front.
  const WHERE = { both: 'Walls and roofs', roof: 'Roofs', wall: 'Walls' };
  function legendFor(manifest, wallIdx) {
    const walls = wallMaps(manifest), wi = Math.max(0, Math.min(walls.length - 1, wallIdx | 0)), live = walls[wi];
    return (manifest.mappings || []).filter(m => DRAWN.includes(m.channel) && (m.channel !== 'wall' || m === live)).map(m => {
      const sec = legendSection(manifest, m);
      sec.active = true; sec.channel = m.channel;
      if (m.channel === 'wall') { sec.role = WHERE[m.colour === 'roof' ? 'roof' : m.colour === 'wall+roof' ? 'both' : 'wall']; sec.heading = sec.role + ': ' + sec.title; }
      else { sec.role = { overlay: 'Marking', segments: 'Sections', outline: 'Outline', halo: 'Halo', groundtint: 'Ground tint' }[m.channel]; sec.heading = m.channel === 'groundtint' ? sec.title : sec.role + ': ' + sec.title; }
      return sec;
    });
  }
  function legendSection(manifest, m) {
    {
      const f = fieldOf(manifest, m.entity, m.field), title = m.scale.label || (f && f.label) || m.field;
      if (m.channel === 'groundtint') {
        const g = m.group || {}, how = (m.aggregate || 'mean') + ' over ' + (g.grid ? 'a ' + g.grid + ' m grid' : 'each ' + g.field + ' (cells of ' + (g.cell || 40) + ' m)');
        return { title: title + ' (ground tint)', kind: 'ramp', colours: m.scale.colours.slice(), domain: m.scale.domain.slice(), noData: null, noDataLabel: 'No buildings of the model', note: 'Ground under the buildings: ' + how };
      }
      if (m.channel === 'outline' || m.channel === 'halo') {          // one entry per value that is highlighted; values with no colour are not drawn and not listed
        const f2 = fieldOf(manifest, m.entity, m.field), names = f2 && f2.type === 'category' ? f2.values : Object.keys(m.scale.values);
        const lod = lodOf(m, m.channel), note = lod && lod.far === 'aggregate' ? 'Zoomed out, a hatch on the ground shows the share of buildings marked per ' + lod.cell + ' m cell (denser = more)' : lod && lod.far === 'hide' ? 'Drawn per building only when zoomed in' : null;
        const sec = { title, kind: 'swatches', items: names.filter(k => m.scale.values[k] && m.scale.values[k].colour).map(k => ({ label: m.scale.values[k].label, colour: m.scale.values[k].colour, mode: m.channel })) };
        if (note) sec.note = note; return sec;
      }
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
    }
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
    const ctl = { wall: 0, dirty: false, runs: 0, lastRunMs: 0, error: null, acc: 0, gen: 0, shown: 0, shownParams: null, runParams: null, running: false, async: isAsync, get mode() { return runtime.mode || 'inline'; } };
    const clock = () => (root.performance && root.performance.now ? root.performance.now() : Date.now());
    const fail = e => { ctl.error = (e && e.message) || String(e); if (root.console) root.console.error(e); };
    function finish(t0) { if (!ctl.error) ctl.shownParams = ctl.runParams; ctl.runs++; ctl.lastRunMs = clock() - t0; ctl.running = false; ctl.onRun && ctl.onRun(ctl); }
    // Stream a run into the store: hold the chunks until they reach `want` (or the run ends), replace the old frames with them once, then extend.
    function stream(gen, first, want) {
      let held = [first], replaced = false;
      const put = (frames, last) => {
        if (gen !== ctl.gen) return;
        held = held.concat(frames);
        if (!replaced && (held.length > want || last)) { store.pushFrames(held, { replace: true }); ctl.shown = gen; replaced = true; held = []; }
        else if (replaced && frames.length) { store.pushFrames(frames); held = []; }
      };
      return runtime.run(horizon, fr => put(fr, false)).then(r => { if (!r.cancelled) put([], true); });
    }
    function rerun() {
      const t0 = clock();
      if (isAsync) {
        const gen = ++ctl.gen; ctl.running = true; const want = store.time().t; ctl.runParams = store.params();
        runtime.setParams(ctl.runParams).then(res => {
          if (gen !== ctl.gen) return null;
          if (res.restarted) return stream(gen, res.frame, want);
          if (!store.length()) store.pushFrames([res.frame || null].filter(Boolean), { replace: true });
          ctl.shown = gen;
          return null;
        }).then(() => { if (gen === ctl.gen) { ctl.error = null; finish(t0); } }, e => { if (gen === ctl.gen) { fail(e); finish(t0); } });
        return;
      }
      try {
        ctl.runParams = store.params();
        const res = runtime.setParams(ctl.runParams);
        if (res.restarted) store.pushFrames([res.frame].concat(runtime.run(horizon)), { replace: true });
        else if (!store.length()) store.pushFrames([runtime.start(store.params())], { replace: true });
        ctl.shown = ctl.gen; ctl.error = null;
      } catch (e) { fail(e); }
      finish(t0);
    }
    ctl.start = () => {
      if (isAsync) {
        const gen = ++ctl.gen, t0 = clock(); ctl.running = true; ctl.runParams = store.params();
        const done = runtime.start(ctl.runParams).then(f0 => (gen !== ctl.gen ? null : runtime.policy === 'rerun' ? stream(gen, f0, 0) : (store.pushFrames([f0], { replace: true }), void (ctl.shown = gen))))
          .then(() => { if (gen === ctl.gen) { ctl.error = null; finish(t0); } }, e => { if (gen === ctl.gen) { fail(e); finish(t0); } });
        return done;
      }
      try { ctl.runParams = store.params(); store.pushFrames([runtime.start(ctl.runParams)].concat(runtime.policy === 'rerun' ? runtime.run(horizon) : []), { replace: true }); ctl.shown = ctl.gen; ctl.error = null; }
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
    // detail for one entity: the runtime's answer (a promise either way), at the time shown. The runtime answers from the run it holds now; while a newer run is being computed
    // (or the newer run failed) that is not the run whose frames are on screen, so the answer is withheld: { stale: true }, and the caller asks again when the frames are replaced.
    ctl.inspect = sel => {
      if (isAsync && ctl.shown !== ctl.gen && (ctl.running || ctl.error)) return Promise.resolve({ stale: true });
      try { return Promise.resolve(runtime.inspect(sel, store.time().t)); } catch (e) { return Promise.reject(e); }
    };
    return ctl;
  }

  // ---- renderer: style the buildings from the current frame ----
  // The store keeps per-building values as typed arrays indexed by scene building (store.bindScene / store.bound). sim.buildingStyle reads them and returns one of a
  // small table of shared style objects (a wall colour and a set of overlays), so a draw allocates nothing. sim.frameVersion is the store's version of "what the map
  // shows": the renderer asks for a building's style again, and repaints its far-zoom layer, only when that number moves.
  // ---- outline and halo: drawn on the canvas above the map, never part of a sprite, so a highlight costs no sprite and survives any recolouring ----
  // ring: a footprint pushed outward by `grow` metres, as one closed subpath at height z. outlineBuilding: footprint at the ground, at height h, and the edges between.
  function ringPath(ctx, V, view, fp, grow, z) {
    let cx = 0, cy = 0; for (const p of fp) { cx += p[0]; cy += p[1]; } cx /= fp.length; cy /= fp.length;
    fp.forEach((p, j) => { const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy) || 1, q = V.proj(view, p[0] + dx / d * grow, p[1] + dy / d * grow, z || 0); if (j) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
    ctx.closePath();
  }
  function outlinePath(ctx, V, view, fp, h, edges) {
    for (const z of edges ? [0, h] : [0]) { fp.forEach((p, j) => { const q = V.proj(view, p[0], p[1], z); if (j) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); }
    if (edges) for (const p of fp) { const a = V.proj(view, p[0], p[1], 0), b = V.proj(view, p[0], p[1], h); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  }
  // value -> colour or null for one outline or halo mapping (a category by index, a boolean by 0 and 1)
  function highlightReader(manifest, m) {
    const f = fieldOf(manifest, m.entity, m.field), cat = f.type === 'category', vals = m.scale.values, names = cat ? f.values : ['false', 'true'];
    const lut = names.map((n, j) => { const v = vals[n] || (!cat ? vals[j ? '1' : '0'] : null); return v && v.colour ? v.colour : null; });
    return { field: m.field, at: cat ? (v => (v >= 0 && v < lut.length ? lut[v] : null)) : (v => (v === v ? lut[v ? 1 : 0] : null)) };
  }

  // Level of detail of an outline or halo mapping: `lod: {min_scale, far, cell}`. Below min_scale (px per metre) a building is no longer outlined on its own: far says what is
  // drawn instead (aggregate: the share flagged per ground cell, hide: nothing, show: the outline at every zoom).
  const LOD_MIN_SCALE = 1.2, LOD_CELL = 200;
  function lodOf(m, channel) {
    if (!m) return null;
    const l = m.lod || {}, far = l.far || 'aggregate';
    return { far, minScale: far === 'show' ? 0 : (typeof l.min_scale === 'number' ? l.min_scale : LOD_MIN_SCALE), cell: typeof l.cell === 'number' ? l.cell : LOD_CELL, channel };
  }
  const OVERLAYS = ['scaffold', 'solar', 'band', 'marker', 'insulation', 'community'];       // the bit of an overlay in a style's mask is its position here: only ever append
  const NEUTRAL_ROOF = '#d4d9dd';                           // the roof of a building outside the model while a mapping paints roofs
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
      const on = m.colour || 'wall';                                     // which surfaces the data colour paints: the walls, the roof, or both
      return { field: m.field, code, cols, bits, wall: on !== 'roof', roof: on !== 'wall' };
    };
    const walls = wallMaps(manifest).filter(m => m.entity === en).map(reader), overlays = overlayMaps(manifest).filter(m => m.entity === en).map(reader);
    // segments: k of n units. Both come from the frame; n is capped for drawing (AssetLib.segmentsFor) and the style carries the capped pair, so there are at most
    // 12 * 13 + 1 distinct values per mapping and the style objects stay shared. Only the first segments mapping of the drawn entity is used.
    const sm = segMaps(manifest).find(m => m.entity === en) || null, segCap = sm ? Math.min(sm.max || 12, (R && root.AssetLib ? root.AssetLib.SEG_MAX : 12)) : 0;
    const segOf = sm ? (i => {
      const n = F[sm.total][i], k = F[sm.field][i]; if (!(n >= 2) || !(k >= 0)) return 0;
      const sg = root.AssetLib.segmentsFor(Math.min(n, 1e6), k, segCap); return sg ? sg[0] * 13 + sg[1] + 1 : 0;
    }) : null;
    // A mapping that paints the roof makes the roofs of the buildings it does not cover (not part of the model) a light neutral, so the data colour is what stands out;
    // otherwise they keep the look's roof.
    const NONE = { data: null, overlays: [], seg: null }, NONE_ROOF = { data: null, overlays: [], seg: null, roof: NEUTRAL_ROOF }, table = new Map();
    const noneFor = w => (walls[w] && walls[w].roof ? NONE_ROOF : NONE);
    const styleOf = (w, code, mask, sg) => {                // one shared object per (wall mapping, wall code, overlay set, segment pair)
      const key = ((w * 1024 + code) * 64 + mask) * 256 + sg; let st = table.get(key);
      if (!st) {
        const ov = []; for (let b = 0; b < OVERLAYS.length; b++) if (mask & (1 << b)) ov.push(OVERLAYS[b]);
        const wm = walls[w], col = wm ? wm.cols[code] : null;
        st = { data: wm && wm.wall ? col : null, roof: wm && wm.roof ? col : null, overlays: ov, seg: sg ? { n: Math.floor((sg - 1) / 13), k: (sg - 1) % 13, done: sm.scale.colour, todo: sm.scale.todo || null } : null }; table.set(key, st);
      }
      return st;
    };
    let F = store.bound(en).fields, live = !!store.frame();
    const sync = () => { F = store.bound(en).fields; live = !!store.frame(); sim.frameVersion = store.shownVersion(); };
    sim.buildingStyle = e => {
      const i = e._si;
      const w = Math.min(ctl ? ctl.wall : 0, walls.length - 1);
      if (!live || modelOf[i] < 0) return noneFor(w);
      let mask = 0; for (let j = 0; j < overlays.length; j++) { const ov = overlays[j]; mask |= ov.bits[ov.code(F[ov.field][i])]; }
      const sg = segOf ? segOf(i) : 0;
      if (w < 0) return mask || sg ? styleOf(0, 0, mask, sg) : NONE;
      return styleOf(w, walls[w].code(F[walls[w].field][i]), mask, sg);
    };
    sync();
    // outline and halo: per frame version the buildings to highlight are gathered by colour; a draw strokes one path per colour and kind (the canvas above the map)
    const hlMaps = ['halo', 'outline'].map(ch => (manifest.mappings || []).filter(m => m.channel === ch && m.entity === en).map(m => highlightReader(manifest, m)));
    const HL = { ver: NaN, halo: [], outline: [], builds: 0, marks: [] };
    // level of detail: the first mapping of each kind says from which scale (pixels per metre) a building is drawn on its own (lod.min_scale) and what is drawn below it
    // (lod.far: aggregate, hide or show). 'aggregate' puts the share of flagged buildings per ground cell (lod.cell metres) on the ground, under the buildings.
    const lods = ['halo', 'outline'].map(ch => lodOf((manifest.mappings || []).find(m => m.channel === ch && m.entity === en), ch));
    const sceneBox = () => root.VizLib.sceneBounds(sim.scene);                 // marks stay on the ground: a cell is cut at the scene's edge
    const cellGrids = new Map();                                              // cell size -> { of: Int32Array scene building -> cell, cells: [{x0, y0, x1, y1, n}] }
    const gridOf = size => {
      let g = cellGrids.get(size); if (g) return g;
      const of = new Int32Array(nScene).fill(-1), cells = [], at = new Map();
      for (let i = 0; i < nScene; i++) {
        if (modelOf[i] < 0) continue; const e = sim.buildings[i], ix = Math.floor(e.fit.cx / size), iy = Math.floor(e.fit.cy / size), key = ix + ',' + iy; let c = at.get(key);
        if (c === undefined) { c = cells.length; at.set(key, c); cells.push({ x0: ix * size, y0: iy * size, x1: (ix + 1) * size, y1: (iy + 1) * size, n: 0 }); }
        of[i] = c; cells[c].n++;
      }
      cellGrids.set(size, g = { of, cells }); return g;
    };
    function refreshHL() {
      if (HL.ver === sim.frameVersion) return;
      HL.ver = sim.frameVersion; HL.builds++; HL.marks = [];
      ['halo', 'outline'].forEach((kind, ci) => {
        const by = new Map();
        if (live && hlMaps[ci].length) for (let i = 0; i < nScene; i++) {
          if (modelOf[i] < 0) continue;
          let col = null; for (const r of hlMaps[ci]) { col = r.at(F[r.field][i]); if (col) break; }
          if (col) { let a = by.get(col); if (!a) by.set(col, a = []); a.push(i); }
        }
        HL[kind] = [...by].map(([colour, idx]) => ({ colour, idx: Int32Array.from(idx) }));
        const lod = lods[ci];
        if (lod && lod.far === 'aggregate' && lod.minScale > 0 && HL[kind].length) {             // per ground cell: the share flagged, in the colour most of the flagged ones have
          const gd = gridOf(lod.cell), tally = new Map();
          for (const g of HL[kind]) for (const i of g.idx) { const c = gd.of[i]; if (c < 0) continue; let t = tally.get(c); if (!t) tally.set(c, t = new Map()); t.set(g.colour, (t.get(g.colour) || 0) + 1); }
          for (const [c, t] of tally) { let best = null, bn = 0, tot = 0; for (const [col, n] of t) { tot += n; if (n > bn) { best = col; bn = n; } } const cell = gd.cells[c], bd = sceneBox(); HL.marks.push({ kind, x0: Math.max(cell.x0, bd[0]), y0: Math.max(cell.y0, bd[1]), x1: Math.min(cell.x1, bd[2]), y1: Math.min(cell.y1, bd[3]), share: tot / cell.n, flagged: tot, colour: best, minScale: lod.minScale }); }
        }
      });
    }
    function drawChannels(ctx, view) {
      if (!hlMaps[0].length && !hlMaps[1].length) return 0;
      refreshHL();
      const V = root.VizLib, sc = view.scale, pad = 14 * sc + 20; let drawn = 0;
      const solo = ci => !lods[ci] || sc >= lods[ci].minScale;                              // zoomed out past min_scale a kind is not drawn per building (see the ground marks)
      const vis = e => { const p = V.proj(view, e.fit.cx, e.fit.cy, 0), h = V.entityHeight(e) * sc; return p[0] > -pad && p[0] < view.w + pad && p[1] > -pad && p[1] - h < view.h + pad; };
      ctx.save(); ctx.lineJoin = 'round';
      if (solo(0)) for (const g of HL.halo) for (const [w, a] of [[9, 0.18], [4.5, 0.36]]) {           // a soft glow: two translucent strokes of a ring a little outside the footprint
        ctx.strokeStyle = g.colour; ctx.lineWidth = w; ctx.globalAlpha = a; ctx.beginPath();
        for (let j = 0; j < g.idx.length; j++) { const e = sim.buildings[g.idx[j]]; if (vis(e)) { ringPath(ctx, V, view, e.src.footprint, 1.6, 0); if (a > 0.3) drawn++; } }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (solo(1)) for (const g of HL.outline) {
        ctx.strokeStyle = g.colour; ctx.lineWidth = sc < 0.8 ? 1.6 : 2.4; ctx.beginPath();
        for (let j = 0; j < g.idx.length; j++) { const e = sim.buildings[g.idx[j]]; if (vis(e)) { outlinePath(ctx, V, view, e.src.footprint, V.entityHeight(e), sc >= 0.8); drawn++; } }
        ctx.stroke();
      }
      // below min_scale with aggregate: besides the hatch on the ground (VizLib.drawGroundMarks, hidden wherever buildings stand close), a thin ring on the cell, as large as the share of
      // flagged buildings in it. A hairline ring covers a few pixels of any roof, so the dense parts show where the flag is without hiding the state colour.
      if (HL.marks.length) {
        ctx.lineWidth = 1.4; ctx.globalAlpha = 0.95;
        for (const mk of HL.marks) {
          if (sc >= mk.minScale || !(mk.share >= 0.05)) continue;
          const cx = (mk.x0 + mk.x1) / 2, cy = (mk.y0 + mk.y1) / 2, r = Math.max(3 / sc, 0.5 * Math.min(mk.x1 - mk.x0, mk.y1 - mk.y0) * Math.sqrt(Math.min(1, mk.share)) * 0.7);
          const a = V.proj(view, cx - r, cy - r, 0), b = V.proj(view, cx + r, cy - r, 0), c = V.proj(view, cx + r, cy + r, 0), d = V.proj(view, cx - r, cy + r, 0);
          if (Math.max(a[0], b[0], c[0], d[0]) < 0 || Math.min(a[0], b[0], c[0], d[0]) > view.w || Math.max(a[1], b[1], c[1], d[1]) < 0 || Math.min(a[1], b[1], c[1], d[1]) > view.h) continue;
          ctx.strokeStyle = mk.colour; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.stroke(); drawn++;
        }
      }
      ctx.restore(); return drawn;
    }
    // ground tint: the ground under the buildings coloured by an aggregate of one field over a neighbourhood. A neighbourhood is a cell of a coarse grid ({grid: metres}) or the
    // group a field names ({field, cell}): the ground is cut into small cells ({cell} metres), each takes the group most of its buildings are in, and a group's aggregate
    // (mean, sum, min or max of the field, over the buildings of the model, ignoring missing values) colours all its cells. The cells are fixed at bind time; the colours are
    // gathered once per frame version (sim.groundTint.cells(version)) and VizLib.drawGroundTint draws them under the buildings.
    const tm = tintMap(manifest, en), GT = { ver: NaN, cells: [], builds: 0, info: null };
    if (tm) {
      const gr = tm.group, size = gr.grid || gr.cell || 40, byField = !!gr.field, agg = tm.aggregate || 'mean', colourOf = scaleFor(manifest, tm).colour, lo = tm.scale.domain[0], hi = tm.scale.domain[1];
      const gfield = byField ? fieldOf(manifest, en, gr.field) : null, cellMap = new Map(), cellList = [];
      for (let i = 0; i < nScene; i++) {
        if (modelOf[i] < 0) continue; const e = sim.buildings[i], ix = Math.floor(e.fit.cx / size), iy = Math.floor(e.fit.cy / size), key = ix + ',' + iy; let c = cellMap.get(key);
        if (!c) { c = { x0: ix * size, y0: iy * size, x1: (ix + 1) * size, y1: (iy + 1) * size, members: [] }; cellMap.set(key, c); cellList.push(c); }
        c.members.push(i);
      }
      const fold = (acc, v) => { if (v === v) { acc.n++; acc.sum += v; if (v < acc.min) acc.min = v; if (v > acc.max) acc.max = v; } };
      const value = acc => (acc.n ? (agg === 'sum' ? acc.sum : agg === 'min' ? acc.min : agg === 'max' ? acc.max : acc.sum / acc.n) : NaN);
      const fresh = () => ({ n: 0, sum: 0, min: Infinity, max: -Infinity });
      GT.refresh = () => {
        if (GT.ver === sim.frameVersion) return GT.cells; GT.ver = sim.frameVersion; GT.builds++;
        const out = [], vals = F[tm.field];
        if (!live) { GT.cells = out; return out; }
        if (!byField) { for (const c of cellList) { const acc = fresh(); for (const i of c.members) fold(acc, vals[i]); const v = value(acc); if (v === v) out.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, v, colour: colourOf(Math.max(lo, Math.min(hi, v))) }); } GT.info = { groups: out.length }; }
        else {
          const gv = F[gr.field], groups = new Map(), cellGroup = new Array(cellList.length);
          const gid = i => { const g = gv[i]; return g === g && g >= 0 ? g : null; };       // a missing group (NaN, -1 for a category) belongs to no neighbourhood
          cellList.forEach((c, ci) => {
            const tally = new Map(); let best = null, bn = 0;
            for (const i of c.members) { const g = gid(i); if (g === null) continue; const n = (tally.get(g) || 0) + 1; tally.set(g, n); if (n > bn || (n === bn && g < best)) { best = g; bn = n; } }
            cellGroup[ci] = best;
          });
          for (let i = 0; i < nScene; i++) { if (modelOf[i] < 0) continue; const g = gid(i); if (g === null) continue; let acc = groups.get(g); if (!acc) groups.set(g, acc = fresh()); fold(acc, vals[i]); }
          cellList.forEach((c, ci) => { const acc = cellGroup[ci] === null ? null : groups.get(cellGroup[ci]); const v = acc ? value(acc) : NaN; if (v === v) out.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, v, group: cellGroup[ci], colour: colourOf(Math.max(lo, Math.min(hi, v))) }); });
          GT.info = { groups: groups.size };
        }
        GT.cells = out; return out;
      };
      sim.groundTint = { cells: () => GT.refresh(), opacity: tm.opacity === undefined ? 0.5 : tm.opacity, version: () => sim.frameVersion };
    }
    // the aggregate marks of outline and halo: ground cells (world metres) with the share flagged, drawn by VizLib.drawGroundMarks only while the view is below the kind's min_scale
    if (lods.some(l => l && l.far === 'aggregate' && l.minScale > 0)) sim.groundMarks = { cells: (ver, view) => { refreshHL(); return HL.marks.filter(c => view.scale < c.minScale); }, version: () => sim.frameVersion };
    const offs = ['time', 'frames', 'view'].map(t => store.subscribe(t, sync));
    const entityOf = bound ? (k => (index[k] >= 0 ? sim.buildings[index[k]] : null)) : (k => sim.buildings[placement.order[k]]);
    // What the real building under model entity k is: the scene's own fields, and whatever the pack passed as the entity's attrs (bindScene). Published on the binding
    // and on the store (store.sceneInfo), so the tooltip and the inspector can name the building without the page wiring it in.
    const ATTR_SEEN = ['id', 'area', 'levels', 'levels_assumed', 'residential'], battrs = bound && bound.attrs && bound.attrs[en] && typeof bound.attrs[en] === 'object' ? bound.attrs[en] : null;
    const sceneInfo = { bound: !!bound, of(k) {
      const si = k >= 0 && k < count ? index[k] : -1, b = si >= 0 && sim.buildings[si] ? sim.buildings[si].src : null; if (!b) return null;
      const attrs = []; if (battrs) for (const [name, arr] of Object.entries(battrs)) { if (ATTR_SEEN.includes(name) || !arr || typeof arr.length !== 'number') continue; const v = arr[k]; if (v === null || v === undefined || typeof v === 'object' || (typeof v === 'number' && !(v === v))) continue; attrs.push({ label: name.replace(/_/g, ' '), value: typeof v === 'number' ? num(v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v) }); }
      return { id: b.id, area: b.area, levels: b.levels, assumed: !!b.levels_assumed, residential: b.residential, attrs };
    } };
    store.sceneInfo = sceneInfo;
    return { ok: true, bound: !!bound, placement, sceneInfo, entityOf, count, placed, warnings: bound ? bound.warnings : [], entity: en, index, modelOf, nScene, sync, drawChannels, highlights: () => { refreshHL(); return { halo: HL.halo, outline: HL.outline, marks: HL.marks, builds: HL.builds }; }, lod: () => ({ halo: lods[0], outline: lods[1] }), tint: tm ? () => { GT.refresh(); return { cells: GT.cells, builds: GT.builds, info: GT.info }; } : null,
             styleCount: () => table.size, dispose() { offs.forEach(f => f()); sim.buildingStyle = null; sim.frameVersion = undefined; sim.groundTint = null; sim.groundMarks = null; } };
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
  const entityTitle = (sel, info) => {
    const s = info && info.of ? info.of(sel.id) : null, name = sel.entity.charAt(0).toUpperCase() + sel.entity.slice(1);
    return s && s.id ? name + ' ' + s.id : name + ' ' + (sel.id + 1);                // the OSM id when the entity stands on a real building, else its number in the model
  };
  const RES = { residential: 'residential (tagged as a dwelling)', probable: 'probable (a guess: plain building, 30 m\u00b2 or more)', other: 'other (not counted as housing)' };
  // The real building under an entity: id, footprint, storeys (and whether they were assumed), residential class, then the pack's own attrs. [] without a scene building.
  function sceneRows(info, sel) {
    const s = info && info.of ? info.of(sel.id) : null; if (!s) return [];
    const rows = [{ label: 'OSM id', value: s.id }];
    if (s.area === s.area && typeof s.area === 'number') rows.push({ label: 'Footprint', value: Math.round(s.area), unit: 'm\u00b2' });
    if (typeof s.levels === 'number') rows.push({ label: 'Storeys', value: s.levels + (s.assumed ? ' (assumed: not in the map data)' : '') });
    if (s.residential) rows.push({ label: 'Residential class', value: RES[s.residential] || String(s.residential) });
    return rows.concat(s.attrs);
  }

  // ---- the readout under the timeline: one line per series with the numbers formatted (never a raw float, never NaN) ----
  const hasDashboard = manifest => ['left', 'right', 'bottom'].some(r => ((manifest.layout || {})[r] || []).some(it => it && (it.chart || it.kpis)));
  const fmtNum = (v, unit) => {
    if (typeof v !== 'number' || !isFinite(v)) return 'n/a';
    const F = root.PackCharts && root.PackCharts.fmt, t = F ? F(v) : String(Math.round(v * 100) / 100);
    return t + (unit && unit !== 'share' && unit !== 'ratio' ? ' ' + unit : '');
  };
  function readoutRows(manifest, store) {
    const out = [];
    for (const [n, s] of Object.entries(manifest.series || {})) {
      const pt = store.latest(n); if (!pt) continue;
      out.push({ label: s.label || n, parts: s.y.map((y, i) => ({ name: y, text: fmtNum(pt[i], s.unit) })) });
    }
    return out;
  }

  // ---- UI ----
  // o.display: the viewer's own switches [{id, label, checked, onchange}] for the Display control, which a layout item may reduce and reorder (items: [ink, fog]).
  // o.compare / o.register: the A/B compare (packdash.js) and the chart register ('colorfigures' or 'formal'). Charts and KPI tiles are made by PackDash.components.
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
    // The text readout under the timeline exists only for a pack that declares no chart and no KPI tile (those show the same numbers properly).
    const showReadout = !hasDashboard(manifest);
    const drawReadout = (host, rows) => {
      const key = JSON.stringify(rows); if (host._key === key) return; host._key = key;
      host.textContent = '';
      if (!rows.length) return;
      const list = el('ul', {}, ...rows.map(r => el('li', {}, el('b', { text: r.label + ': ' }), r.parts.map(p => p.name + ' ' + p.text).join(' · '))));
      host.appendChild(rows.length > 4 ? el('details', {}, el('summary', { text: 'Values at this time (' + rows.length + ' series)' }), list) : list);
    };
    const components = {
      params(item) {
        const all = []; for (const [n, p] of Object.entries(P)) { const g = p.group || 'General'; if (!all.includes(g)) all.push(g); }
        const groups = item.groups || all, box = el('div', { class: 'pk-params' });
        // every group is a collapsible section: open on a wide screen, closed on a phone (one tap opens it) so the map is not buried under the sliders
        const mq = doc.defaultView && doc.defaultView.matchMedia ? doc.defaultView.matchMedia('(max-width: 860px)') : null, narrow = !!(mq && mq.matches);
        for (const g of groups) {
          const names = Object.keys(P).filter(n => (P[n].group || 'General') === g);
          if (names.length) box.appendChild(el('details', { class: 'pk-group', open: !narrow }, el('summary', { text: g }), el('div', { class: 'pk-gbody' }, ...names.map(paramRow))));
        }
        if (mq && mq.addEventListener) mq.addEventListener('change', e => { for (const d of box.querySelectorAll('details.pk-group')) d.open = !e.matches; });          // the window crossed the phone breakpoint (rotated, resized): reset to that layout's default
        return box;
      },
      presets() {
        const list = manifest.presets || []; if (!list.length) return null;
        const btns = list.map(pr => { const b = el('button', { type: 'button', 'data-preset': pr.id, 'aria-pressed': 'false', title: pr.help || pr.label, text: pr.label }); b.onclick = () => store.applyPreset(pr.id); return b; });
        const reset = el('button', { type: 'button', 'data-reset': '', class: 'pk-reset', title: 'Return every setting to its default', text: 'Reset' }); reset.onclick = () => store.resetParams();
        refreshers.push(() => btns.forEach((b, i) => { const on = store.isPreset(list[i].id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }));
        return el('div', { class: 'pk-presets', role: 'group', 'aria-label': 'Presets' }, el('b', { text: 'Presets' }), el('div', { class: 'pk-btns' }, ...btns, reset));
      },
      legend() {
        const box = el('div', { class: 'pk-legend', 'aria-live': 'polite' }), body = el('div', { class: 'pk-legbody' });
        const sw = (colour, text, mode) => el('span', { class: 'pk-sw' }, el('i', { style: mode === 'outline' ? 'background:transparent;border:2px solid ' + colour : mode === 'halo' ? 'background:transparent;box-shadow:0 0 5px 2px ' + colour : 'background:' + (colour || 'repeating-linear-gradient(45deg,#fff 0 3px,#ddd 3px 6px)') }), text);
        const draw = () => {                                                // only the colouring on screen and the overlays and channels that are drawn
          body.textContent = '';
          for (const sec of legendFor(manifest, ctl ? ctl.wall : 0)) {
            const row = el('div', { class: 'pk-legrow', 'data-channel': sec.channel }, el('b', { text: sec.heading }));
            if (sec.kind === 'ramp') { row.appendChild(el('span', { class: 'pk-ramp' }, String(sec.domain[0]), el('i', { style: 'background:linear-gradient(90deg,' + sec.colours.join(',') + ')' }), String(sec.domain[1]))); row.appendChild(sw(sec.noData, sec.noDataLabel || 'No data')); if (sec.note) row.appendChild(el('small', { text: sec.note })); }
            else for (const it of sec.items) row.appendChild(it.overlay !== undefined ? el('span', { text: (it.overlay ? it.overlay + ' on the building' : 'no marking') + ' = ' + it.label }) : sw(it.colour, it.label, it.mode));
            if (sec.kind === 'swatches' && sec.note) row.appendChild(el('small', { text: sec.note }));
            body.appendChild(row);
          }
        };
        box.appendChild(body); draw();
        const walls = wallMaps(manifest);
        let sel = null;
        if (walls.length > 1) {
          sel = el('select', { id: id('wall'), 'data-wall': '' }, ...walls.map((m, i) => el('option', { value: i, text: m.scale.label || m.field })));
          sel.onchange = () => ctl.setWall(+sel.value);
          box.insertBefore(el('div', { class: 'pk-legrow' }, el('label', { for: sel.id, text: 'Colour walls by ' }), sel), box.firstChild);
        }
        const redraw = () => { if (sel && ctl && String(ctl.wall) !== sel.value) sel.value = String(ctl.wall); draw(); };
        const off = store.subscribe('view', redraw); box.destroy = () => { if (off) off(); };       // the legend follows the chosen colouring, wherever the choice was made
        return box;
      },
      display(item) {
        const all = o.display || [], list = item && item.items ? item.items.map(n => all.find(d => d.id === n)).filter(Boolean) : all;       // the pack may reduce and reorder the viewer's switches; the ones it leaves out keep their state
        if (!list.length) return null;
        return el('fieldset', { class: 'pk-display' }, el('legend', { text: 'Display' }), ...list.map(d => { const c = el('input', { type: 'checkbox', id: id(d.id), checked: !!d.checked }); c.onchange = () => d.onchange(c.checked); return el('label', { class: 'pk-check', for: c.id }, c, ' ' + d.label); }));
      },
      timeline() {
        const tm = manifest.time, play = el('button', { type: 'button', 'data-play': '' }), slider = el('input', { type: 'range', min: 0, max: tm.steps, step: 1, value: 0, 'aria-label': tm.unit, 'data-time': '' });
        const label = el('span', { class: 'pk-time' }), read = showReadout ? el('div', { class: 'pk-readout', 'aria-live': 'off' }) : null;
        const speed = el('select', { 'aria-label': 'Speed', 'data-speed': '' }, ...(tm.speeds || [store.time().speed]).map(s => el('option', { value: s, text: s + ' ' + tm.unit + (s === 1 ? '' : 's') + ' per second' })));
        play.onclick = () => ctl.togglePlay();
        slider.oninput = () => { store.setPlaying(false); ctl.ensure(+slider.value); store.setTime(+slider.value); };
        speed.onchange = () => store.setSpeed(+speed.value);
        const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
        const draw = () => {
          const t = store.time(); play.textContent = t.playing ? 'Pause' : 'Play'; slider.value = t.t; speed.value = t.speed;
          label.textContent = cap(tm.unit) + ' ' + t.t + ' of ' + tm.steps;
          if (read) drawReadout(read, readoutRows(manifest, store));
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
      let busy = false, again = false, shown = null; const info = () => o.scene || store.sceneInfo;
      const ask = () => {
        const sel = store.selection(); if (!sel || !ctl || !ctl.inspect) return;
        if (busy) { again = true; return; }
        // an answer is good for one (entity, run on screen, time); it is dropped if any of the three has moved by the time it arrives
        const keyNow = () => { const n = store.selection(); return n ? n.entity + ':' + n.id + '#' + (store.runId ? store.runId() : 0) + '@' + store.time().t : ''; };
        busy = true; const key = keyNow();
        Promise.resolve(ctl.inspect(sel)).then(detail => {
          if (key === keyNow() && !(detail && detail.stale)) {            // a stale reply (the model is busy with another run) leaves the rows of the run on screen as they are
            shown = detail || null;
            const own = detail && detail.title && !(info() && info().of(sel.id) && info().of(sel.id).id);        // the OSM id names a building on a scene; the model's own title is then a row
            if (own) title.textContent = detail.title;
            put(extraEl, ((detail && detail.fields) || []).concat(detail && detail.title && !own ? [{ label: 'Model', value: detail.title }] : [])); note.textContent = (detail && detail.note) || '';
          }
        }, e => { note.textContent = 'The model could not say: ' + ((e && e.message) || e); }).then(() => { busy = false; if (again) { again = false; ask(); } });
      };
      const draw = ev => {
        const sel = store.selection();
        root0.hidden = !sel;
        if (!sel) { shown = null; return; }
        if (ev && (ev.topic === 'selection' || ev.flip)) { put(extraEl, []); note.textContent = ''; shown = null; }       // a flip to the other run: its rows are not these
        const info = o.scene || store.sceneInfo; title.textContent = entityTitle(sel, info); put(fieldsEl, sceneRows(info, sel).concat(entityRows(manifest, store, sel)));
        if (!ev || ev.topic !== 'frames' || ev.replace) ask();
      };
      const offs2 = ['selection', 'time', 'frames', 'view'].map(t => store.subscribe(t, draw));
      refreshers.push(() => draw(null));
      root0.destroy = () => offs2.forEach(f => f());
      return root0;
    }
    // dashboard components (P5, viz/packdash.js): charts and KPI tiles named by the layout, and the A/B compare panel
    const dash = root.PackDash ? root.PackDash.components({ manifest, store, controller: ctl, compare: o.compare, doc, el, id, refreshers, register: o.register }) : null;
    components.compare = item => (dash ? dash.compare(item) : null);
    const mounted = [];
    for (const region of ['left', 'right', 'bottom']) {
      const host = reg[region]; if (!host) continue;
      for (const item of layout[region] || []) {
        const make = item.control ? components[item.control] : item.chart ? (dash && dash.chart) : item.kpis ? (dash && dash.kpis) : null;
        const n = make && make(item); if (n) { n.setAttribute('data-item', item.control || (item.chart ? 'chart' : 'kpis')); host.appendChild(n); mounted.push(n); }
      }
    }
    // The inspector is docked: when the page gives it a region (the map's box) it lies over the map's corner, always in view, whatever the side columns scroll to.
    // A press, move or wheel on the panel must not reach the map under it (it would select another building or drag the camera).
    const ihost = reg.inspector || reg.right, panel = ihost ? inspector() : null;
    if (panel) {
      if (reg.inspector) { panel.classList.add('pk-docked'); for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'pointerleave', 'wheel', 'dblclick']) panel.addEventListener(ev, e => e.stopPropagation()); }
      ihost.appendChild(panel);
    }
    const refresh = () => refreshers.forEach(f => f());
    const offs = [store.subscribe('params', refresh), store.subscribe('time', refresh), store.subscribe('frames', refresh), store.subscribe('view', refresh)];
    refresh();
    return { refresh, destroy() { offs.forEach(f => f()); for (const n of mounted) if (n.destroy) n.destroy(); if (dash) dash.destroy(); } };
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
      const s = binding.sceneInfo ? binding.sceneInfo.of(k) : null;           // the real building: footprint and storeys, with an assumed storey count marked
      const real = s ? [typeof s.area === 'number' && s.area === s.area ? Math.round(s.area) + ' m\u00b2' : '', typeof s.levels === 'number' ? s.levels + ' storeys' + (s.assumed ? ' (assumed)' : '') : ''].filter(Boolean).map(x => ' \u00b7 ' + x).join('') : '';
      return entityTitle(sel, binding.sceneInfo) + real + (lead ? ': ' + lead.label + ' ' + lead.value : '');
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
    const retip = () => { if (hover >= 0 && lastXY) showTip({ k: hover }, lastXY[0], lastXY[1]); };
    const offT = (offs => () => offs.forEach(f => f()))(['time', 'view'].map(t => store.subscribe(t, retip)));       // the tooltip's value follows the time and the A/B flip
    // The outline of the selected (solid) and hovered (dashed) building: its footprint on the ground and lifted by its height, and the edges between.
    function drawHighlight(ctx, view) {
      ctx.clearRect(0, 0, view.w, view.h);
      if (binding.drawChannels) binding.drawChannels(ctx, view);                  // the pack's own outline and halo channels, under the selection
      const sel = store.selection(), items = [];
      if (hover >= 0 && !(sel && sel.id === hover)) items.push([hover, true]);
      if (sel && sel.entity === en && sel.id < binding.count) items.push([sel.id, false]);
      for (const [k, dashed] of items) {
        const si = binding.index[k]; if (si < 0) continue; const sh = pick.silhouette(si), P = (p, z) => V.proj(view, p[0], p[1], z);
        if (!dashed) {                                                                // selection is the same channel as the pack's own: a halo, then the outline
          ctx.save(); ctx.lineJoin = 'round'; ctx.strokeStyle = '#1d4ed8';
          for (const [w, a] of [[9, 0.16], [4.5, 0.3]]) { ctx.lineWidth = w; ctx.globalAlpha = a; ctx.beginPath(); ringPath(ctx, V, view, sh.footprint, 1.6, 0); ctx.stroke(); }
          ctx.restore();
        }
        ctx.save(); ctx.lineJoin = 'round'; ctx.lineWidth = dashed ? 1.5 : 2.5; ctx.strokeStyle = dashed ? 'rgba(20,20,20,0.7)' : '#1d4ed8'; ctx.setLineDash(dashed ? [4, 3] : []);
        const z0 = sh.z || 0;                                                   // the ground height the building stands at (terrain)
        for (const z of [z0, z0 + sh.h]) { ctx.beginPath(); sh.footprint.forEach((p, j) => { const q = P(p, z); if (j) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.stroke(); }
        ctx.beginPath(); for (const p of sh.footprint) { const a = P(p, z0), b = P(p, z0 + sh.h); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); } ctx.stroke();
        ctx.restore();
      }
    }
    return { drawHighlight, hovered: () => hover, modelAt, dispose() {
      box.removeEventListener('pointermove', onMove); box.removeEventListener('pointerdown', onDown); box.removeEventListener('pointerup', onUp); box.removeEventListener('pointerleave', onLeave); box.removeEventListener('wheel', onWheel);
      doc.removeEventListener('keydown', onKey); offT(); showTip(null);
    } };
  }

  root.PackHost = { legendFor, scaleFor, createController, bindRenderer, bindInteraction, mountUI, entityRows, entityTitle, sceneRows, readoutRows, hasDashboard, NO_DATA };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PackHost;
})(typeof window !== 'undefined' ? window : globalThis);
