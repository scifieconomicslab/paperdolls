/* Toy epidemic: a stochastic S-E-I-R model on a contact network of buildings. Small on purpose: it exists to show that a pack is
 * a manifest plus one file, and that moving a slider re-runs the model and redraws the map.
 *
 * Each entity is a building in one of four states (0 S, 1 E, 2 I, 3 R). Every day each susceptible building draws `contacts` contacts, some of them
 * nearby in the entity list and the rest anywhere; each infectious contact passes the infection with probability beta times the policy factor.
 * Exposed buildings turn infectious after `incubation_days`, and recover after `infectious_days`.
 * Where an entity stands on the map is decided by the page (placement is invented), so "nearby" means nearby in the list, not on the street.
 * Deterministic: the same parameters and seed always give the same frames. It never uses Math.random.
 * It sends frame 0 whole and every later frame as a patch, and answers inspect() from a log of when each building changed state.
 */
(function () {
  'use strict';
  const S = 0, E = 1, I = 2, R = 3;
  const LOCKDOWN = { none: 1, partial: 0.75, full: 0.4 };

  // mulberry32 with its state in the model handle, so a snapshot can carry it
  function draw(h) { h.s = (h.s + 0x6D2B79F5) | 0; let t = Math.imul(h.s ^ (h.s >>> 15), 1 | h.s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

  // Time 0 is sent whole; after that a frame is a patch: only the buildings whose state or exposure changed since the frame before. A day touches a few of the
  // 600 buildings (at 12,000 it would be thousands), and the shell applies the patch to its typed arrays without going over the rest.
  function whole(h) {
    const counts = [0, 0, 0, 0]; for (let i = 0; i < h.n; i++) counts[h.state[i]]++;
    return { t: h.t, entities: { building: { state: Int8Array.from(h.state), exposure: Float32Array.from(h.exposure) } }, series: { counts } };
  }
  function frame(h) {
    if (h.t === 0) { h.sent = true; h.pState = Int8Array.from(h.state); h.pExp = Float32Array.from(h.exposure); return whole(h); }
    const counts = [0, 0, 0, 0], si = [], sv = [], ei = [], ev = [];
    for (let i = 0; i < h.n; i++) {
      counts[h.state[i]]++;
      if (h.state[i] !== h.pState[i]) { si.push(i); sv.push(h.state[i]); }
      if (h.exposure[i] !== h.pExp[i]) { ei.push(i); ev.push(h.exposure[i]); }
    }
    h.pState = Int8Array.from(h.state); h.pExp = Float32Array.from(h.exposure);
    const building = {};
    if (si.length) building.state = { idx: Int32Array.from(si), val: Int8Array.from(sv) };
    if (ei.length) building.exposure = { idx: Int32Array.from(ei), val: Float32Array.from(ev) };
    return { t: h.t, patch: { building }, series: { counts } };
  }
  const NAMES = ['Susceptible', 'Exposed', 'Infectious', 'Recovered'];

  PaperDolls.registerRuntime('toy-epidemic', {
    init(p, ents, seed) {
      const n = ents.building.count;
      const h = { p: Object.assign({}, p), n, t: 0, s: seed | 0, state: new Int8Array(n), timer: new Int16Array(n), exposure: new Float32Array(n),
        eA: new Int16Array(n).fill(-1), iA: new Int16Array(n).fill(-1), rA: new Int16Array(n).fill(-1), sent: false };    // eA, iA, rA: the day each building became exposed, infectious, recovered
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
    snapshot(h) { return { p: h.p, t: h.t, state: Array.from(h.state), timer: Array.from(h.timer), exposure: Array.from(h.exposure), s: h.s, eA: Array.from(h.eA), iA: Array.from(h.iA), rA: Array.from(h.rA), pState: Array.from(h.pState || h.state), pExp: Array.from(h.pExp || h.exposure), sent: !!h.sent }; },
    restore(h, snap) {
      h.p = Object.assign({}, snap.p); h.t = snap.t; h.state = Int8Array.from(snap.state); h.timer = Int16Array.from(snap.timer); h.exposure = Float32Array.from(snap.exposure);
      h.s = snap.s; h.eA = Int16Array.from(snap.eA); h.iA = Int16Array.from(snap.iA); h.rA = Int16Array.from(snap.rA);
      h.pState = Int8Array.from(snap.pState); h.pExp = Float32Array.from(snap.pExp); h.sent = snap.sent; return h;
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
