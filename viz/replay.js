/* replay.js: plays a model's trajectory through the scene. No DOM, so it can be tested in Node.
 *
 * Replay.create(sim, data) with data = {
 *   weeks:   [{ codes?: [..], investor?: [..], vars?: { 'building.wealth': [..], .. } }, ..]   one entry per week, indexed by model building k
 *   mapping: [{ variable, channel: 'wall' | 'overlay', scale: {type, ..} }, ..]               the declared mapping; [] means the four state codes
 *   states:  [{ key, label }, ..]                                                             the legend labels for the four state codes
 * }
 * Model building k is drawn on scene building k (see place). A value the model did not set (NaN) is drawn as "no data", never as zero.
 * The legend is built from the scales themselves, so it can describe only what is drawn.
 */
(function (root) {
  'use strict';
  const NO_DATA = '#cfcabd';
  const STATES = ['to_do', 'queued', 'in_progress', 'finished'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const hex = c => '#' + c.map(v => ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2)).join('');

  // colours spread evenly over the domain; a value outside the domain takes the nearest end
  function sequential(colours, domain, v) {
    const t = clamp((v - domain[0]) / (domain[1] - domain[0]), 0, 1), p = t * (colours.length - 1), i = Math.min(colours.length - 2, Math.floor(p)), f = p - i;
    const a = rgb(colours[i]), b = rgb(colours[i + 1]);
    return hex(a.map((x, j) => x + (b[j] - x) * f));
  }
  const key = v => String(Object.is(v, -0) ? 0 : v);

  // Model building k is drawn on a scene building: the scene's buildings are ordered by distance from its centre (ties by position in the
  // scene), and model building k takes the k-th. Placement is invented and the page says so. Scene buildings beyond the model are extras.
  function place(scene, nModel) {
    const bs = scene.buildings, nb = bs.length;
    if (nb < nModel) return { ok: false, error: 'model has ' + nModel + ' buildings, scene has ' + nb + '. Use a scene with at least as many buildings.' };
    let cx = 0, cy = 0; for (const b of bs) { cx += b.footprint[0][0]; cy += b.footprint[0][1]; } cx /= nb || 1; cy /= nb || 1;
    const dist = bs.map(b => Math.hypot(b.footprint[0][0] - cx, b.footprint[0][1] - cy));
    const order = bs.map((b, i) => i).sort((a, b) => (dist[a] - dist[b]) || (a - b)), rank = new Array(nb);
    order.forEach((si, k) => { rank[si] = k; });
    return { ok: true, order, rank, assigned: nModel, extra: nb - nModel };
  }

  function create(sim, data) {
    const A = root.AssetLib, mapping = data.mapping || [], weeks = data.weeks || [], idx = new Map();
    const nModel = data.n || Math.max(0, ...weeks.map(w => Math.max((w.codes || []).length, ...Object.values(w.vars || {}).map(a => a.length))));
    const placement = place(sim.scene, nModel);
    if (placement.ok) sim.buildings.forEach((e, i) => idx.set(e, placement.rank[i]));
    const walls = mapping.filter(m => m.channel === 'wall'), overlays = mapping.filter(m => m.channel === 'overlay');
    const r = { sim, data, week: 0, weeks: weeks.length, playing: false, speed: 4, acc: 0, wall: 0, mapping, NO_DATA, placement, error: placement.ok ? null : placement.error };
    r.entityOf = k => sim.buildings[placement.order[k]];                    // the scene building that draws model building k
    const value = (m, k) => { const w = weeks[r.week], a = w && w.vars && w.vars[m.variable]; const v = a && k < a.length ? a[k] : NaN; return v === undefined ? NaN : v; };
    function colourOf(m, v) {
      if (!(v === v)) return NO_DATA;
      if (m.scale.type === 'sequential') return sequential(m.scale.colours, m.scale.domain, v);
      const hit = m.scale.values[key(v)]; return hit && hit.colour ? hit.colour : NO_DATA;
    }
    function style(e) {
      const k = idx.get(e); let data = null; const ov = [];
      const wm = walls[Math.min(r.wall, walls.length - 1)];
      if (wm) data = colourOf(wm, value(wm, k));
      for (const m of overlays) { const v = value(m, k), hit = v === v ? m.scale.values[key(v)] : null; if (hit && hit.overlay) ov.push(hit.overlay); }
      return { data, overlays: ov };
    }
    function paintStates() {                                // with no mapping, the four state codes go onto the scene and the default style draws them
      const w = weeks[r.week] || {};
      sim.buildings.forEach(e => {
        const k = idx.get(e), c = w.codes && w.codes[k];
        e.src.state = c === undefined ? 'to_do' : (STATES[c] || 'to_do');
        e.src.investor = !!(w.investor && w.investor[k]);
      });
    }
    r.setWeek = t => { r.week = clamp(Math.round(t) || 0, 0, Math.max(0, weeks.length - 1)); if (placement.ok && !mapping.length) paintStates(); };
    r.setWall = i => { r.wall = clamp(i | 0, 0, Math.max(0, walls.length - 1)); };
    r.advance = dt => {
      if (!r.playing) return;
      r.acc += dt * r.speed;
      while (r.acc >= 1) { r.acc -= 1; if (r.week < weeks.length - 1) r.setWeek(r.week + 1); else { r.playing = false; r.acc = 0; } }
    };
    r.legend = () => {
      if (!mapping.length) {
        const reg = A.REG[sim.theme.reg] || A.REG.colorfigures;
        return [{ title: 'State', kind: 'swatches', items: (data.states || []).map(s => ({ label: s.label, colour: s.key === 'to_do' ? null : (reg.states[s.key] || null) })) }];
      }
      return mapping.map(m => {
        const title = m.scale.label || m.variable;
        if (m.scale.type === 'sequential') return { title, kind: 'ramp', colours: m.scale.colours.slice(), domain: m.scale.domain.slice(), noData: NO_DATA };
        const items = Object.keys(m.scale.values).map(k => { const v = m.scale.values[k]; return m.channel === 'wall' ? { label: v.label, colour: v.colour } : { label: v.label, overlay: v.overlay }; });
        if (m.channel === 'wall') items.push({ label: 'No data', colour: NO_DATA });
        return { title, kind: 'swatches', items };
      });
    };
    if (placement.ok && mapping.length) sim.buildingStyle = style;
    if (placement.ok) r.setWeek(0);
    return r;
  }

  root.Replay = { create, place, sequential, NO_DATA };
})(typeof window !== 'undefined' ? window : globalThis);
