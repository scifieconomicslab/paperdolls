/* packdash.js: the dashboard layer of a model-pack page (P5): chart and KPI components for the layout engine, and the A/B compare.
 * It reads stores and draws with packcharts.js; it never touches the renderer. packhost.js's mountUI asks it for the components a manifest's layout names.
 *
 *   const cmp = PackDash.createCompare({ manifest, store, createRuntime, schedule });     // B: a second store and a second runtime handle, made on first use
 *   const view = cmp.viewStore;                                                            // a store-shaped view that reads A or B: hand it to bindRenderer / bindInteraction / mountUI
 *   PackHost.mountUI({ ..., store: view, compare: cmp, register: 'colorfigures' });        // mountUI draws chart / kpis / compare items with PackDash.components
 *
 * Why a second runtime handle and not snapshot/restore: A and B are two independent runs of the same model, both always complete (a full timeline each) and both
 * wanted at once (B's lines over A's, B's frames for the map flip). One handle would have to be re-run or restored every time the picture changes; two handles run
 * once each, in parallel in two workers, and a moved slider re-runs only A. The cost is a second copy of the model in memory and a second worker, made only
 * when the comparison is first switched on. snapshot/restore stays what it is for: a continuing model checking itself (PackRuntime.checkRuntime).
 */
(function (root) {
  'use strict';
  const PH = () => root.PackHost, PS = () => root.PackStore, PC = () => root.PackCharts;
  const isNum = v => typeof v === 'number' && v === v && isFinite(v);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  // the i-th value of a series point (a point is an array, or a bare number for a one-value series)
  const valueOf = (pt, i) => (pt === undefined || pt === null ? NaN : Array.isArray(pt) || ArrayBuffer.isView(pt) ? pt[i] : (i === 0 ? pt : NaN));
  const column = (points, i) => { const out = new Array(points.length); for (let t = 0; t < points.length; t++) out[t] = valueOf(points[t], i); return out; };
  const defaultsOf = manifest => { const d = {}; for (const [k, p] of Object.entries(manifest.params || {})) d[k] = p.default; return d; };
  const sameParams = (a, b) => Object.keys(a).every(k => a[k] === b[k]);

  // ---- the series a component reads: the value names it draws, and where its numbers come from ----
  function seriesInfo(manifest, name, only) {
    const s = (manifest.series || {})[name]; if (!s) return null;
    const names = only && only.length ? only : s.y;
    return { def: s, names, index: names.map(n => s.y.indexOf(n)) };
  }

  // ---- A/B compare ----
  function createCompare(o) {
    const { manifest, store: A } = o, B = PS().create(manifest), horizon = manifest.time.steps;
    const cmp = { manifest, A, B, enabled: false, showing: 'a', bSource: null, snapshotsList: [], ctlB: null, runtimeB: null, error: null, bShown: null };
    const listeners = []; let flips = 0;
    const emit = what => { for (const f of [...listeners]) { try { f(what); } catch (e) { if (root.console) root.console.error(e); } } };
    cmp.onChange = fn => { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; };

    // B follows A's clock: same time on screen, so the map flip and the charts' cursor agree
    const follow = () => { B.setTime(A.time().t); };
    A.subscribe('time', follow);
    B.subscribe('frames', follow);

    // what B is: a preset, a snapshot of A, or a parameter set; a complete set (what the preset does not name returns to its default)
    cmp.paramsOf = src => {
      if (!src) return defaultsOf(manifest);
      if (src.preset) { const pr = (manifest.presets || []).find(p => p.id === src.preset); return Object.assign(defaultsOf(manifest), pr ? pr.params : {}); }
      if (src.snapshot) { const sn = cmp.snapshotsList.find(x => x.id === src.snapshot); return Object.assign(defaultsOf(manifest), sn ? sn.params : {}); }
      return Object.assign(defaultsOf(manifest), src.params || {});
    };
    cmp.labelOf = src => {
      if (!src) return 'defaults';
      if (src.preset) { const pr = (manifest.presets || []).find(p => p.id === src.preset); return pr ? pr.label : src.preset; }
      if (src.snapshot) { const sn = cmp.snapshotsList.find(x => x.id === src.snapshot); return sn ? sn.label : src.snapshot; }
      return 'custom';
    };
    cmp.labelOfParams = p => {                                        // what a finished run was made from, in the words of the presets and snapshots
      const same = q => Object.keys(p).every(k => p[k] === q[k]);
      const pr = (manifest.presets || []).find(x => same(cmp.paramsOf({ preset: x.id }))); if (pr) return pr.label;
      const sn = cmp.snapshotsList.find(x => same(cmp.paramsOf({ snapshot: x.id }))); return sn ? sn.label : 'custom';
    };
    // B is usable when its last run succeeded. After a failed run B still holds the frames of the run before (they stay on the map and nothing else describes them):
    // the label says which run that is, the charts leave B out and there is nothing to list as a difference.
    cmp.bOk = () => !(cmp.ctlB && cmp.ctlB.error);
    cmp.bLabel = () => (cmp.bOk() ? cmp.labelOf(cmp.bSource) : (cmp.bShown ? cmp.labelOfParams(cmp.bShown.params) + ' (the new B run failed: this is the last good one)' : 'B (its run failed: no data)'));
    const bRan = c => {                                                // every finished run of B's controller, the first and each later one
      const was = cmp.error;
      if (c.error) cmp.error = 'The comparison run failed: ' + c.error;
      else { cmp.error = null; cmp.bShown = { params: c.shownParams }; }
      if (cmp.error !== was) emit('error');
    };
    cmp.setB = src => {
      cmp.bSource = src; B.setParams(cmp.paramsOf(src));            // the controller of B (once made) sees the change and re-runs
      emit('b'); return true;
    };
    cmp.snapshot = label => {                                         // keep A's parameters as they are now
      const id = 's' + (cmp.snapshotsList.length + 1), sn = { id, label: label || 'Snapshot ' + (cmp.snapshotsList.length + 1), params: A.params() };
      cmp.snapshotsList.push(sn); emit('snapshots'); return sn;
    };
    cmp.differences = () => {                                         // where B differs from A, in the words of the controls
      const a = A.params(), b = B.params(), out = [];
      if (!cmp.bOk()) return out;
      for (const [k, p] of Object.entries(manifest.params || {})) if (a[k] !== b[k]) {
        const show = v => { if (p.type === 'enum') { const e = (p.values || []).find(x => (typeof x === 'object' ? x.value : x) === v); return e && typeof e === 'object' && e.label ? e.label : String(v); } if (p.type === 'boolean') return v ? 'on' : 'off'; return String(Math.round(v * 1000) / 1000) + (p.unit ? ' ' + p.unit : ''); };
        out.push({ name: k, label: p.label || k, a: show(a[k]), b: show(b[k]) });
      }
      return out;
    };

    cmp.enable = on => {
      on = !!on; if (on === cmp.enabled) return;
      cmp.enabled = on;
      if (on && !cmp.ctlB) {
        if (!cmp.bSource) {                                           // first use: B is the first preset that differs from A, else a copy of A
          const mine = (manifest.presets || []).find(p => !sameParams(cmp.paramsOf({ preset: p.id }), A.params()));
          B.setParams(mine ? cmp.paramsOf({ preset: mine.id }) : A.params()); cmp.bSource = mine ? { preset: mine.id } : { params: A.params() };
        }
        try {
          cmp.runtimeB = o.createRuntime();
          cmp.ctlB = PH().createController({ manifest, runtime: cmp.runtimeB, store: B, schedule: o.schedule, immediate: o.immediate });
          cmp.ctlB.onRun = bRan;
          cmp.ctlB.start(); follow();
        } catch (e) { cmp.error = 'Could not start the comparison run: ' + ((e && e.message) || e); cmp.enabled = false; if (root.console) root.console.error(e); }
      }
      if (!cmp.enabled && cmp.showing === 'b') cmp.show('a');
      emit('enabled');
    };
    cmp.show = which => {
      which = which === 'b' && cmp.enabled ? 'b' : 'a';
      if (which === cmp.showing) return;
      cmp.showing = which; flips++; follow(); cmp.view.__flipped(); emit('showing');
    };
    cmp.toggleShow = () => cmp.show(cmp.showing === 'a' ? 'b' : 'a');
    // the inspector asks the runtime of the run on screen
    cmp.inspect = (sel, fallback) => (cmp.showing === 'b' && cmp.ctlB ? cmp.ctlB.inspect(sel) : fallback(sel));
    cmp.flush = () => (cmp.ctlB ? cmp.ctlB.flush() : false);

    // ---- the view store: reads A or B (what is on the map), writes A. Frames, series and the bound arrays come from the run on screen; parameters,
    // time, selection and everything else are A's. Both stores are bound to the scene, so a flip costs a gather and no re-run.
    const READS = ['frame', 'frameAt', 'frames', 'length', 'series', 'latest', 'bound'];
    const FRAME_TOPICS = ['time', 'frames', 'series'];
    const view = {};
    const live = () => (cmp.showing === 'b' ? B : A);
    for (const k of Object.keys(A)) if (typeof A[k] === 'function') view[k] = (...a) => A[k](...a);
    view.manifest = manifest;
    for (const k of READS) view[k] = (...a) => live()[k](...a);
    view.bindScene = (en, opts) => { A.bindScene(en, opts); B.bindScene(en, opts); return view; };
    view.shownVersion = () => A.shownVersion() + B.shownVersion() + flips;
    view.runId = () => cmp.showing + ':' + live().runId();             // which run is on the map: tells A's frames from B's even when both are at the same generation
    const flipSubs = [];
    view.subscribe = (topic, fn) => {
      const offA = A.subscribe(topic, ev => { if (!(cmp.showing === 'b' && FRAME_TOPICS.includes(topic))) fn(ev); });
      const offB = FRAME_TOPICS.includes(topic) ? B.subscribe(topic, ev => { if (cmp.showing === 'b') fn(ev); }) : () => {};
      const sub = { topic, fn }; if (topic === 'view' || topic === '*') flipSubs.push(sub);
      return () => { offA(); offB(); const i = flipSubs.indexOf(sub); if (i >= 0) flipSubs.splice(i, 1); };
    };
    view.__flipped = () => { for (const s of [...flipSubs]) { try { s.fn({ topic: 'view', flip: true }); } catch (e) { if (root.console) root.console.error(e); } } };
    cmp.view = view; cmp.viewStore = view;
    return cmp;
  }

  // ---- components for mountUI ----
  // ctx: { manifest, store (the one the page reads: A, or the view), compare?, doc, el, id, refreshers, register, cmpStoreA }
  function components(ctx) {
    const { manifest, doc, el } = ctx, cmp = ctx.compare || null, A = cmp ? cmp.A : ctx.store, ctl = ctx.controller;
    const charts = [], tms = manifest.time, xUnit = cap(tms.unit);
    let hoverBusy = false;
    const hoverAll = (from, t) => { if (hoverBusy) return; hoverBusy = true; try { for (const c of charts) if (c !== from) c.hoverAt(t, true); } finally { hoverBusy = false; } };
    const pick = t => { A.setPlaying(false); if (ctl && ctl.ensure) ctl.ensure(t); A.setTime(t); };
    const bOn = () => !!(cmp && cmp.enabled && cmp.ctlB && cmp.bOk());

    function chart(item) {
      const info = seriesInfo(manifest, item.series, item.y); if (!info) return null;
      const type = item.chart, title = item.title || info.def.label || item.series, unit = item.unit || info.def.unit || '';
      const box = el('div', { class: 'pk-item pk-chart', 'data-chart-series': item.series });
      const spec0 = { type, title, unit, xUnit, xLabel: item.x || info.def.x || undefined, register: ctx.register || 'colorfigures', horizon: tms.steps, cursor: A.time().t };
      const c = PC().create(doc, Object.assign(spec0, { onHover: t => hoverAll(c, t), onPick: pick }));
      const compareOn = () => item.compare !== false && bOn();
      function data() {
        const pts = A.series(item.series), ptsB = compareOn() ? cmp.B.series(item.series) : null;
        if (type === 'bar') {
          const at = A.time().t, ptA = pts[Math.min(at, pts.length - 1)], ptB = ptsB && ptsB.length ? ptsB[Math.min(at, ptsB.length - 1)] : undefined;
          return { categories: info.names.map((n, j) => ({ label: n, value: valueOf(ptA, info.index[j]), valueB: ptsB ? valueOf(ptB, info.index[j]) : undefined })) };
        }
        const series = info.names.map((n, j) => ({ key: n, label: n, values: column(pts, info.index[j]), colourIndex: j }));
        if (ptsB) info.names.forEach((n, j) => series.push({ key: n + '@b', label: n + ' (B)', values: column(ptsB, info.index[j]), b: true, colourIndex: j }));
        return { series };
      }
      const redraw = () => c.update(Object.assign(data(), { cursor: A.time().t }));
      redraw();
      const offs = [A.subscribe('series', redraw)];
      offs.push(A.subscribe('time', () => { if (type === 'bar') redraw(); else c.setCursor(A.time().t); }));
      if (cmp) { offs.push(cmp.B.subscribe('series', () => { if (compareOn()) redraw(); }), cmp.B.subscribe('time', () => { if (type === 'bar' && compareOn()) redraw(); }), cmp.onChange(w => { if (w === 'enabled' || w === 'b' || w === 'error') redraw(); })); }
      charts.push(c); box.appendChild(c.el); box.destroy = () => { offs.forEach(f => f()); charts.splice(charts.indexOf(c), 1); };
      box.chart = c;
      return box;
    }

    // a KPI reads one value of one series: at the time on screen, at the end of the run, or its highest or lowest
    function reading(points, i, at, t) {
      if (!points || !points.length) return NaN;
      if (at === 'final') return valueOf(points[points.length - 1], i);
      if (at === 'max' || at === 'min') { let best = NaN; for (const p of points) { const v = valueOf(p, i); if (isNum(v) && (!isNum(best) || (at === 'max' ? v > best : v < best))) best = v; } return best; }
      return valueOf(points[Math.min(t, points.length - 1)], i);
    }
    function kpis(item) {
      const box = el('div', { class: 'pk-item pk-kpis' }); if (item.title) box.appendChild(el('b', { class: 'pk-item-title', text: item.title }));
      const k = PC().kpis(doc, []); box.appendChild(k.el);
      const specs = item.kpis.map(d => { const info = seriesInfo(manifest, d.series); const name = d.y === undefined ? info.def.y[0] : d.y; return { d, info, i: info.def.y.indexOf(name) }; });
      function redraw() {
        const t = A.time().t, on = bOn();
        k.update(specs.map(({ d, info, i }) => ({
          id: d.label, label: d.label, unit: d.unit || info.def.unit || '', decimals: d.decimals,
          value: reading(A.series(d.series), i, d.at || 'now', t), valueB: on ? reading(cmp.B.series(d.series), i, d.at || 'now', t) : undefined })));
      }
      redraw();
      const offs = [A.subscribe('series', redraw), A.subscribe('time', redraw)];
      if (cmp) offs.push(cmp.B.subscribe('series', () => { if (bOn()) redraw(); }), cmp.B.subscribe('time', () => { if (bOn()) redraw(); }), cmp.onChange(w => { if (w === 'enabled' || w === 'b' || w === 'error') redraw(); }));
      box.destroy = () => offs.forEach(f => f()); box.kpis = k;
      return box;
    }

    // the A/B compare panel: a switch, what B is, a way to hold the current settings as B, which run the map shows, and where B differs from A
    function compare() {
      if (!cmp) return null;
      const presets = manifest.presets || [];
      const toggle = el('input', { type: 'checkbox', id: ctx.id('cmp'), 'data-compare': '' });
      const sel = el('select', { id: ctx.id('cmpb'), 'data-compare-b': '', 'aria-label': 'What B is' });
      const hold = el('button', { type: 'button', 'data-compare-hold': '', title: 'Keep the settings as they are now, to compare against later', text: 'Hold current settings' });
      const bBtn = el('button', { type: 'button', 'data-show': 'b', 'aria-pressed': 'false', text: 'B' }), aBtn = el('button', { type: 'button', 'data-show': 'a', 'aria-pressed': 'true', text: 'A' });
      const diff = el('ul', { class: 'pk-diff', 'aria-label': 'Where B differs from A' }), msg = el('p', { class: 'pk-note', role: 'status' });
      const optionsFor = () => {
        sel.textContent = '';
        const g1 = el('optgroup', { label: 'Presets' }, ...presets.map(p => el('option', { value: 'p:' + p.id, text: p.label })));
        if (presets.length) sel.appendChild(g1);
        if (cmp.snapshotsList.length) sel.appendChild(el('optgroup', { label: 'Snapshots' }, ...cmp.snapshotsList.map(s => el('option', { value: 's:' + s.id, text: s.label }))));
        const cur = cmp.bSource; sel.value = cur && cur.preset ? 'p:' + cur.preset : cur && cur.snapshot ? 's:' + cur.snapshot : '';
      };
      toggle.onchange = () => cmp.enable(toggle.checked);
      sel.onchange = () => { const v = sel.value; cmp.setB(v.startsWith('p:') ? { preset: v.slice(2) } : { snapshot: v.slice(2) }); };
      hold.onclick = () => { const sn = cmp.snapshot(); cmp.setB({ snapshot: sn.id }); if (!cmp.enabled) { toggle.checked = true; cmp.enable(true); } };
      aBtn.onclick = () => cmp.show('a'); bBtn.onclick = () => cmp.show('b');
      const draw = () => {
        toggle.checked = cmp.enabled; optionsFor(); sel.disabled = !cmp.enabled; hold.disabled = false; bBtn.disabled = !cmp.enabled;
        aBtn.setAttribute('aria-pressed', String(cmp.showing === 'a')); bBtn.setAttribute('aria-pressed', String(cmp.showing === 'b')); aBtn.classList.toggle('on', cmp.showing === 'a'); bBtn.classList.toggle('on', cmp.showing === 'b');
        diff.textContent = '';
        if (cmp.enabled) for (const d of cmp.differences()) diff.appendChild(el('li', { text: d.label + ': A ' + d.a + ', B ' + d.b }));
        if (cmp.enabled && cmp.bOk() && !diff.childNodes.length) diff.appendChild(el('li', { text: 'B has the same settings as A.' }));
        msg.textContent = cmp.error || (cmp.enabled ? 'The map shows ' + (cmp.showing === 'b' ? 'B (' + cmp.bLabel() + ')' : 'A (the current settings)') + '. Press B on the keyboard to flip.' : '');
      };
      ctx.refreshers.push(draw); cmp.onChange(draw); A.subscribe('params', draw);
      const keys = e => {
        if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'b' && e.key !== 'B') || !cmp.enabled) return;
        const t = e.target, tag = t && t.tagName ? t.tagName.toUpperCase() : ''; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
        cmp.toggleShow(); e.preventDefault();
      };
      doc.addEventListener('keydown', keys);
      const root0 = el('section', { class: 'pk-item pk-compare', 'aria-label': 'A/B compare' },
        el('label', { class: 'pk-check', for: toggle.id }, toggle, el('b', { text: ' Compare A with B' })),
        el('div', { class: 'pk-cmprow' }, el('label', { for: sel.id, text: 'B is ' }), sel, hold),
        el('div', { class: 'pk-cmprow', role: 'group', 'aria-label': 'Map shows' }, el('span', { text: 'Map shows ' }), aBtn, bBtn), diff, msg);
      root0.destroy = () => doc.removeEventListener('keydown', keys);
      draw();
      return root0;
    }
    return { chart, kpis, compare, destroy() { for (const c of [...charts]) c.destroy(); } };
  }

  root.PackDash = { createCompare, components, valueOf, column, defaultsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PackDash;
})(typeof window !== 'undefined' ? window : globalThis);
