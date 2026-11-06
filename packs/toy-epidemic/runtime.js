/* Toy epidemic: a stochastic S-E-I-R model on a contact network of buildings. Small on purpose: it exists to show that a pack is
 * a manifest plus one file, and that moving a slider re-runs the model and redraws the map.
 *
 * Each entity is a building in one of four states (0 S, 1 E, 2 I, 3 R). Every day each susceptible building draws `contacts` contacts, some of them
 * nearby in the entity list and the rest anywhere; each infectious contact passes the infection with probability beta times the policy factor.
 * Exposed buildings turn infectious after `incubation_days`, and recover after `infectious_days`.
 * With a scene, bindScene makes one entity per residential building and the page draws it there; "nearby" still means nearby in the list, not on the street.
 * Deterministic: the same parameters and seed always give the same frames. It never uses Math.random.
 * It sends frame 0 whole and every later frame as a patch, and answers inspect() from a log of when each building changed state.
 *
 * Besides state and exposure it sends fields that exist to exercise the visual channels of the shell (segments, outline, halo, overlays, ground tint):
 * units (dwellings per building, from area and storeys), units_hit (how many of them are infectious today, rising through the infectious period), infected (exposed or
 * infectious, whose share by neighbourhood tints the ground), hub (the largest 5% by area: a meeting place) and vulnerable (the smallest quarter by area). units, hub and
 * vulnerable never change, so they are sent in frame 0 only.
 */
(function () {
  'use strict';
  const S = 0, E = 1, I = 2, R = 3;
  const LOCKDOWN = { none: 1, partial: 0.75, full: 0.4 };

  // mulberry32 with its state in the model handle, so a snapshot can carry it
  function draw(h) { h.s = (h.s + 0x6D2B79F5) | 0; let t = Math.imul(h.s ^ (h.s >>> 15), 1 | h.s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

  // Time 0 is sent whole; after that a frame is a patch: only the buildings whose state or exposure changed since the frame before. A day touches a few of the
  // 600 buildings (at 12,000 it would be thousands), and the shell applies the patch to its typed arrays without going over the rest.
  // derived per-building values for the visual channels
  function derive(h) {
    for (let i = 0; i < h.n; i++) {
      h.inf[i] = h.state[i] === E || h.state[i] === I ? 1 : 0;
      h.hit[i] = h.state[i] === I ? Math.min(h.units[i], Math.ceil(h.units[i] * (h.t - h.iA[i] + 1) / h.p.infectious_days)) : 0;
    }
  }
  const STATIC = ['units', 'hub', 'vulnerable'], DYNAMIC = { state: 'state', exposure: 'exposure', units_hit: 'hit', infected: 'inf' };
  function whole(h) {
    derive(h);
    const counts = [0, 0, 0, 0]; for (let i = 0; i < h.n; i++) counts[h.state[i]]++;
    return { t: h.t, entities: { building: { state: Int8Array.from(h.state), exposure: Float32Array.from(h.exposure), units: Int8Array.from(h.units), units_hit: Int8Array.from(h.hit), infected: Int8Array.from(h.inf),
                                              hub: Int8Array.from(h.hub), vulnerable: Int8Array.from(h.vulnerable) } }, series: { counts } };
  }
  function frame(h) {
    if (h.t === 0) { h.sent = true; derive(h); keep(h); return whole(h); }
    derive(h);
    const counts = [0, 0, 0, 0], building = {}, idx = {}, val = {};
    for (const f of Object.keys(DYNAMIC)) { idx[f] = []; val[f] = []; }
    for (let i = 0; i < h.n; i++) {
      counts[h.state[i]]++;
      for (const f of Object.keys(DYNAMIC)) if (h[DYNAMIC[f]][i] !== h.prev[f][i]) { idx[f].push(i); val[f].push(h[DYNAMIC[f]][i]); }
    }
    for (const f of Object.keys(DYNAMIC)) if (idx[f].length) building[f] = { idx: Int32Array.from(idx[f]), val: (f === 'exposure' ? Float32Array : Int8Array).from(val[f]) };
    keep(h);
    return { t: h.t, patch: { building }, series: { counts } };
  }
  function keep(h) { h.prev = {}; for (const f of Object.keys(DYNAMIC)) h.prev[f] = h[DYNAMIC[f]].slice(); }       // what the next patch is taken against
  const NAMES = ['Susceptible', 'Exposed', 'Infectious', 'Recovered'];

  // Reference bindScene: one model building per residential scene building. A scene from the ingest says which ('residential' or 'probable'); an older
  // scene or the placeholder has no class, so every building that is not a shed counts. Order is the scene's. Buildings with no id are addressed as "#<index>".
  // The model also gets each building's area, storeys, whether the storeys were assumed, and its neighbours (as entity indices) in entities.building.attrs.
  function bindScene(scene) {
    const key = PackRuntime.sceneKey, ids = [], at = { area: [], levels: [], levels_assumed: [], neighbours: [] }, entityOfKey = new Map();
    (scene.buildings || []).forEach((b, i) => {
      const dwelling = b.residential !== undefined ? b.residential !== 'other' : b.archetype !== 'shed';
      if (!dwelling) return;
      entityOfKey.set(key(b, i), ids.length); ids.push(key(b, i));
      at.area.push(b.area !== undefined ? b.area : footprintArea(b.footprint)); at.levels.push(b.levels); at.levels_assumed.push(b.levels_assumed === undefined ? null : b.levels_assumed);
    });
    (scene.buildings || []).forEach((b, i) => {
      const k = entityOfKey.get(key(b, i)); if (k === undefined) return;
      at.neighbours[k] = (b.neighbours || []).map(n => entityOfKey.get(n)).filter(j => j !== undefined);
    });
    if (!ids.length) throw new Error('the scene has no residential buildings to bind to');
    return { entities: { building: { count: ids.length, attrs: at } }, sceneIndex: { building: ids } };
  }
  function footprintArea(ring) { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }

  // units, hub and vulnerable from the geometry the scene gave (area, storeys); without it, from the entity number
  function statics(h, at) {
    const n = h.n, area = at && at.area && at.area.length === n ? at.area : null, levels = at && at.levels && at.levels.length === n ? at.levels : null;
    if (!area) { for (let i = 0; i < n; i++) { h.units[i] = 1 + (i * 7) % 9; h.hub[i] = i % 20 === 0 ? 1 : 0; h.vulnerable[i] = i % 4 === 0 ? 1 : 0; } return; }
    const sorted = Array.from(area).sort((a, b) => a - b), q25 = sorted[Math.floor(n * 0.25)], q95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
    for (let i = 0; i < n; i++) {
      h.units[i] = Math.max(1, Math.min(40, Math.round(area[i] * (levels ? levels[i] : 2) / 90)));            // a dwelling per 90 m2 of floor, at most 40
      h.hub[i] = area[i] >= q95 ? 1 : 0; h.vulnerable[i] = area[i] < q25 ? 1 : 0;
    }
  }

  PaperDolls.registerRuntime('toy-epidemic', {
    bindScene,
    init(p, ents, seed) {
      const n = ents.building.count;
      const h = { p: Object.assign({}, p), n, t: 0, s: seed | 0, state: new Int8Array(n), timer: new Int16Array(n), exposure: new Float32Array(n),
        eA: new Int16Array(n).fill(-1), iA: new Int16Array(n).fill(-1), rA: new Int16Array(n).fill(-1), sent: false,    // eA, iA, rA: the day each building became exposed, infectious, recovered
        hit: new Int8Array(n), inf: new Int8Array(n), prev: null, units: new Int8Array(n), hub: new Int8Array(n), vulnerable: new Int8Array(n) };
      statics(h, ents.building.attrs);
      for (let i = 0; i < n; i++) if (draw(h) < h.p.immunity) { h.state[i] = R; h.rA[i] = 0; }
      let placed = 0, guard = 0;
      while (placed < h.p.initial_cases && guard++ < n * 20) { const i = Math.floor(draw(h) * n); if (h.state[i] === S) { h.state[i] = I; h.iA[i] = 0; h.timer[i] = h.p.infectious_days; placed++; } }
      return h;
    },
    setParams(h, p) { h.p = Object.assign({}, p); return h; },
    step(h, k) {
      const out = [];
      if (k === 0) return [h.t === 0 ? frame(h) : whole(h)];          // the current frame again, whole, without moving the baseline the patches are taken against
      for (let s = 0; s < k; s++) { advance(h); out.push(frame(h)); }
      return out;
    },
    run(h, toT) { const out = []; while (h.t < toT) { advance(h); out.push(frame(h)); } return out; },
    // What the inspector shows for one building at day t, from the log of transitions (so it is right at any day of the run, not only the last one).
    inspect(h, sel, t) {
      const i = sel.id; if (sel.entity !== 'building' || !(i >= 0 && i < h.n)) return null;
      const upTo = (a, d) => (a[i] >= 0 && a[i] <= d ? 'day ' + a[i] : '–');
      const st = h.rA[i] >= 0 && h.rA[i] <= t ? R : h.iA[i] >= 0 && h.iA[i] <= t ? I : h.eA[i] >= 0 && h.eA[i] <= t ? E : S;
      const fields = [{ label: 'State on day ' + t, value: NAMES[st] }, { label: 'Exposed', value: upTo(h.eA, t) }, { label: 'Infectious from', value: upTo(h.iA, t) }, { label: 'Recovered', value: upTo(h.rA, t) }];
      return { title: 'Building ' + (i + 1) + ' · ' + NAMES[st], fields, note: h.rA[i] === 0 ? 'Immune from the start.' : h.iA[i] === 0 ? 'One of the first cases.' : '' };
    },
    snapshot(h) {
      if (!h.prev) { derive(h); keep(h); }                  // before any frame the baseline for the next patch is the state now
      return { p: h.p, t: h.t, state: Array.from(h.state), timer: Array.from(h.timer), exposure: Array.from(h.exposure), s: h.s, eA: Array.from(h.eA), iA: Array.from(h.iA), rA: Array.from(h.rA), sent: !!h.sent, units: Array.from(h.units), hub: Array.from(h.hub), vulnerable: Array.from(h.vulnerable), prev: Object.fromEntries(Object.entries(h.prev).map(([k, v]) => [k, Array.from(v)])) };
    },
    restore(h, snap) {
      h.p = Object.assign({}, snap.p); h.t = snap.t; h.state = Int8Array.from(snap.state); h.timer = Int16Array.from(snap.timer); h.exposure = Float32Array.from(snap.exposure);
      h.s = snap.s; h.eA = Int16Array.from(snap.eA); h.iA = Int16Array.from(snap.iA); h.rA = Int16Array.from(snap.rA);
      h.units = Int8Array.from(snap.units); h.hub = Int8Array.from(snap.hub); h.vulnerable = Int8Array.from(snap.vulnerable); h.hit = new Int8Array(h.n); h.inf = new Int8Array(h.n); h.sent = snap.sent;
      h.prev = snap.prev ? { state: Int8Array.from(snap.prev.state), exposure: Float32Array.from(snap.prev.exposure), units_hit: Int8Array.from(snap.prev.units_hit), infected: Int8Array.from(snap.prev.infected) } : null; return h;
    },
  });

  function advance(h) {
    const p = h.p, n = h.n, old = h.state, next = Int8Array.from(old), nt = Int16Array.from(h.timer);
    const factor = (LOCKDOWN[p.lockdown] || 1) * (p.masks ? 0.8 : 1), pass = Math.min(1, p.beta * factor), reach = Math.max(2, Math.round(n * 0.02));
    for (let i = 0; i < n; i++) {
      const s = old[i];
      if (s === S) {
        let hits = 0, caught = false;
        for (let c = 0; c < p.contacts; c++) {
          let j = draw(h) < p.local_share ? i + Math.round((draw(h) * 2 - 1) * reach) : Math.floor(draw(h) * n);
          j = ((j % n) + n) % n;
          if (old[j] === I) { hits++; if (!caught && draw(h) < pass) caught = true; }
        }
        h.exposure[i] = hits / p.contacts;
        if (caught) { next[i] = E; nt[i] = p.incubation_days; h.eA[i] = h.t + 1; }
      } else {
        h.exposure[i] = 0;
        if (s === E || s === I) { nt[i]--; if (nt[i] <= 0) { if (s === E) { next[i] = I; nt[i] = p.infectious_days; h.iA[i] = h.t + 1; } else { next[i] = R; nt[i] = 0; h.rA[i] = h.t + 1; } } }
      }
    }
    h.state = next; h.timer = nt; h.t++;
  }
})();
