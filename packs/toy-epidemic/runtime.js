/* Toy epidemic: a stochastic S-E-I-R model on a contact network of buildings. Small on purpose: it exists to show that a pack is
 * a manifest plus one file, and that moving a slider re-runs the model and redraws the map.
 *
 * Each entity is a building in one of four states (0 S, 1 E, 2 I, 3 R). Every day each susceptible building draws `contacts` contacts, some of them
 * nearby in the entity list and the rest anywhere; each infectious contact passes the infection with probability beta times the policy factor.
 * Exposed buildings turn infectious after `incubation_days`, and recover after `infectious_days`.
 * Where an entity stands on the map is decided by the page (placement is invented), so "nearby" means nearby in the list, not on the street.
 * Deterministic: the same parameters and seed always give the same frames. It never uses Math.random.
 */
(function () {
  'use strict';
  const S = 0, E = 1, I = 2, R = 3;
  const LOCKDOWN = { none: 1, partial: 0.75, full: 0.4 };

  // mulberry32 with its state in the model handle, so a snapshot can carry it
  function draw(h) { h.s = (h.s + 0x6D2B79F5) | 0; let t = Math.imul(h.s ^ (h.s >>> 15), 1 | h.s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

  function frame(h) {
    const counts = [0, 0, 0, 0]; for (let i = 0; i < h.n; i++) counts[h.state[i]]++;
    return { t: h.t, entities: { building: { state: Int8Array.from(h.state), exposure: Float32Array.from(h.exposure) } }, series: { counts } };
  }

  PaperDolls.registerRuntime('toy-epidemic', {
    init(p, ents, seed) {
      const n = ents.building.count;
      const h = { p: Object.assign({}, p), n, t: 0, s: seed | 0, state: new Int8Array(n), timer: new Int16Array(n), exposure: new Float32Array(n) };
      for (let i = 0; i < n; i++) if (draw(h) < h.p.immunity) h.state[i] = R;
      let placed = 0, guard = 0;
      while (placed < h.p.initial_cases && guard++ < n * 20) { const i = Math.floor(draw(h) * n); if (h.state[i] === S) { h.state[i] = I; h.timer[i] = h.p.infectious_days; placed++; } }
      return h;
    },
    setParams(h, p) { h.p = Object.assign({}, p); return h; },
    step(h, k) {
      const out = [];
      if (k === 0) return [frame(h)];
      for (let s = 0; s < k; s++) { advance(h); out.push(frame(h)); }
      return out;
    },
    run(h, toT) { const out = []; while (h.t < toT) { advance(h); out.push(frame(h)); } return out; },
    snapshot(h) { return { p: h.p, t: h.t, state: Array.from(h.state), timer: Array.from(h.timer), exposure: Array.from(h.exposure), s: h.s }; },
    restore(h, snap) {
      h.p = Object.assign({}, snap.p); h.t = snap.t; h.state = Int8Array.from(snap.state); h.timer = Int16Array.from(snap.timer); h.exposure = Float32Array.from(snap.exposure);
      h.s = snap.s; return h;
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
        if (caught) { next[i] = E; nt[i] = p.incubation_days; }
      } else {
        h.exposure[i] = 0;
        if (s === E || s === I) { nt[i]--; if (nt[i] <= 0) { if (s === E) { next[i] = I; nt[i] = p.infectious_days; } else { next[i] = R; nt[i] = 0; } } }
      }
    }
    h.state = next; h.timer = nt; h.t++;
  }
})();
