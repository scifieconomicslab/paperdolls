/* packcharts.js: small embedded SVG charts and KPI tiles for model-pack pages. No dependencies, no network, no framework: it makes DOM nodes (a <figure> holding an
 * <svg>) from a document it is given, so it runs in the single-file page and in jsdom. Nothing here knows about the store; packhost.js feeds it.
 *
 *   const c = PackCharts.create(doc, { type: 'line' | 'area' | 'bar', title, unit, xUnit: 'Day', xLabel, register: 'colorfigures' | 'formal',
 *                                      horizon: 160, series: [{ key, label, values: [..], b: false }], categories: [{ label, value, valueB }],
 *                                      cursor: 12, onHover(t | null), onPick(t) });
 *   container.appendChild(c.el);   c.update({ series, cursor, ... });   c.setCursor(30);   c.hoverAt(40);   c.destroy();
 *   const k = PackCharts.kpis(doc, [{ label, value, unit, valueB, decimals }]);   k.update(tiles);
 *
 * line  : one line per series over time 0..horizon; a series with b: true is drawn dashed (the comparison run), in the colour of the series it compares with (colourOf).
 * area  : the series stacked; a b series is drawn as a dashed line along the top of its own stack.
 * bar   : one bar per category (a quintile, a delivery mode); valueB, when given, is drawn beside it as a dashed outline.
 * The colours are colour-blind safe (Okabe-Ito for colorfigures, Carbon's data-visualisation order for formal) and every series also has its own marker shape and, in the
 * legend, its name, so colour is never the only carrier. Sizes are in a viewBox, so the chart scales with its container. The hover readout is text under the title.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const PALETTES = {
    colorfigures: ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#b36b00', '#3a8fc7', '#7a6a4f', '#222222'],      // Okabe-Ito, the pale hues darkened to keep 3:1 on white
    formal: ['#6929c4', '#1192e8', '#005d5d', '#9f1853', '#fa4d56', '#198038', '#002d9c', '#b28600'],           // IBM Carbon categorical order
  };
  const THEME = {                       // CSS variables the page may override; these are the fallbacks
    colorfigures: { ink: '#231e16', muted: '#5d5950', grid: '#d6d1c4', paper: '#ffffff', font: 'system-ui,-apple-system,"Segoe UI",sans-serif' },
    formal: { ink: '#161616', muted: '#525252', grid: '#e0e0e0', paper: '#ffffff', font: '"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif' },
  };
  const MARKERS = ['circle', 'square', 'triangle', 'diamond', 'cross', 'circle', 'square', 'triangle'];
  const W = 440, H = 236, M = { l: 46, r: 14, t: 10, b: 30 };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isNum = v => typeof v === 'number' && v === v && isFinite(v);

  // ---- numbers ----
  function niceStep(span, n) {
    const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function niceTicks(lo, hi, n) {            // [ticks, lo', hi'] covering [lo, hi]
    if (!(hi > lo)) { hi = lo + 1; }
    const s = niceStep(hi - lo, n || 4), a = Math.floor(lo / s + 1e-9) * s, b = Math.ceil(hi / s - 1e-9) * s, out = [];
    for (let v = a; v <= b + s / 2; v += s) out.push(Math.abs(v) < s * 1e-9 ? 0 : +v.toPrecision(12));
    return [out, a, b];
  }
  function fmt(v, decimals) {
    if (!isNum(v)) return 'no data';
    const a = Math.abs(v);
    if (decimals !== undefined && decimals !== null) return v.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    if (a >= 1e9) return +(v / 1e9).toPrecision(3) + ' bn';
    if (a >= 1e6) return +(v / 1e6).toPrecision(3) + ' m';
    if (a >= 1e4) return Math.round(v).toLocaleString('en-GB');
    if (a >= 100) return String(Math.round(v * 10) / 10);
    if (a >= 1) return String(Math.round(v * 100) / 100);
    return String(+v.toPrecision(2));
  }
  const withUnit = (v, unit, decimals) => fmt(v, decimals) + (unit && isNum(v) ? ' ' + unit : '');
  // a series' values at time t, summed or listed, for the hover readout and the description
  const colourOf = (s, i) => (s.colourIndex !== undefined ? s.colourIndex : i);

  function marker(kind, x, y, r, fill, extra) {
    const f = ' fill="' + fill + '"' + (extra || '');
    if (kind === 'square') return '<rect x="' + (x - r) + '" y="' + (y - r) + '" width="' + 2 * r + '" height="' + 2 * r + '"' + f + '/>';
    if (kind === 'triangle') return '<path d="M' + x + ' ' + (y - r * 1.2) + 'L' + (x + r * 1.1) + ' ' + (y + r * 0.9) + 'L' + (x - r * 1.1) + ' ' + (y + r * 0.9) + 'Z"' + f + '/>';
    if (kind === 'diamond') return '<path d="M' + x + ' ' + (y - r * 1.3) + 'L' + (x + r * 1.3) + ' ' + y + 'L' + x + ' ' + (y + r * 1.3) + 'L' + (x - r * 1.3) + ' ' + y + 'Z"' + f + '/>';
    if (kind === 'cross') return '<path d="M' + (x - r) + ' ' + (y - r) + 'L' + (x + r) + ' ' + (y + r) + 'M' + (x + r) + ' ' + (y - r) + 'L' + (x - r) + ' ' + (y + r) + '" stroke="' + fill + '" stroke-width="2" fill="none"/>';
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"' + f + '/>';
  }

  function create(doc, spec0) {
    let spec = Object.assign({ type: 'line', title: '', unit: '', xUnit: 'Step', register: 'colorfigures', horizon: 1, series: [], categories: [], cursor: null, hidden: {} }, spec0);
    const el = doc.createElement('figure'); el.className = 'pc pc-' + spec.type; el.setAttribute('data-chart', spec.type);
    const cap = doc.createElement('figcaption'); cap.className = 'pc-title';
    const read = doc.createElement('div'); read.className = 'pc-readout'; read.setAttribute('aria-live', 'off');
    const svg = doc.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('role', 'img'); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('class', 'pc-svg'); svg.setAttribute('focusable', 'false'); svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block';
    const legend = doc.createElement('ul'); legend.className = 'pc-legend';
    el.appendChild(cap); el.appendChild(read); el.appendChild(svg); el.appendChild(legend);
    const uid = 'pc' + Math.random().toString(36).slice(2, 8);
    let hoverT = null, geo = null;

    const pal = () => PALETTES[spec.register] || PALETTES.colorfigures, th = () => THEME[spec.register] || THEME.colorfigures;
    const shown = () => spec.series.filter(s => !spec.hidden[s.key]);
    const hasB = () => spec.series.some(s => s.b) || spec.categories.some(c => isNum(c.valueB));

    function stackOf(list) {                       // area: cumulative sums per time for the A series and, separately, the B series
      const out = new Map(); const groups = [list.filter(s => !s.b), list.filter(s => s.b)];
      for (const g of groups) {
        const n = Math.max(0, ...g.map(s => s.values.length)); const acc = new Array(n).fill(0);
        for (const s of g) { const tops = []; for (let t = 0; t < n; t++) { const v = s.values[t]; acc[t] += isNum(v) ? v : 0; tops.push(acc[t]); } out.set(s, tops); }
      }
      return out;
    }

    function domainY() {
      let lo = 0, hi = -Infinity;
      if (spec.type === 'bar') {
        for (const c of spec.categories) for (const v of [c.value, c.valueB]) if (isNum(v)) { hi = Math.max(hi, v); lo = Math.min(lo, v); }
      } else if (spec.type === 'area') {
        for (const tops of stackOf(shown()).values()) for (const v of tops) if (isNum(v)) hi = Math.max(hi, v);
      } else for (const s of shown()) for (const v of s.values) if (isNum(v)) { hi = Math.max(hi, v); lo = Math.min(lo, v); }
      if (!isNum(hi)) hi = 1;
      if (hi <= lo) hi = lo + 1;
      return niceTicks(lo, hi, 4);
    }

    // ---- description for assistive technology (and for tests): what the chart says in words ----
    function describe() {
      const u = spec.unit ? ' ' + spec.unit : '', kind = spec.type === 'bar' ? 'Bar chart' : spec.type === 'area' ? 'Stacked area chart' : 'Line chart';
      if (spec.type === 'bar') {
        const parts = spec.categories.map(c => c.label + ' ' + withUnit(c.value, spec.unit) + (isNum(c.valueB) ? ' (comparison ' + withUnit(c.valueB, spec.unit) + ')' : ''));
        return kind + (spec.title ? ' of ' + spec.title : '') + '. ' + (parts.join('; ') || 'No data yet.') + '.';
      }
      const parts = spec.series.map(s => {
        const vs = s.values.filter(isNum); if (!vs.length) return s.label + ': no data';
        return s.label + ': ' + fmt(vs[0]) + ' at ' + spec.xUnit + ' 0, ' + fmt(vs[vs.length - 1]) + ' at ' + spec.xUnit + ' ' + (s.values.length - 1) + ', highest ' + fmt(Math.max(...vs)) + u;
      });
      return kind + (spec.title ? ' of ' + spec.title : '') + ', ' + spec.xUnit.toLowerCase() + ' 0 to ' + spec.horizon + '. ' + (parts.join('; ') || 'No data yet.') + '.';
    }

    // ---- drawing ----
    function frame(yTicks, y0, y1) {
      const pw = W - M.l - M.r, ph = H - M.t - M.b, th0 = th();
      const Y = v => M.t + ph - (v - y0) / (y1 - y0) * ph;
      let g = '';
      for (const v of yTicks) {
        const y = Y(v);
        g += '<line x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + y + '" y2="' + y + '" stroke="' + th0.grid + '" stroke-width="' + (v === 0 ? 1.4 : 0.8) + '"/>';
        g += '<text x="' + (M.l - 6) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10.5" fill="' + th0.muted + '">' + esc(fmt(v)) + '</text>';
      }
      return { g, pw, ph, Y };
    }

    function drawTime() {
      const [yt, y0, y1] = domainY(), fr = frame(yt, y0, y1), th0 = th(), P = pal(), pw = fr.pw, Y = fr.Y;
      const hz = Math.max(1, spec.horizon), X = t => M.l + t / hz * pw;
      let g = fr.g;
      const xs = niceTicks(0, hz, 5)[0].filter(t => t >= 0 && t <= hz);
      for (const t of xs) g += '<text x="' + X(t) + '" y="' + (H - M.b + 14) + '" text-anchor="middle" font-size="10.5" fill="' + th0.muted + '">' + t + '</text>';
      g += '<text x="' + (M.l + pw / 2) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="10.5" fill="' + th0.muted + '">' + esc(spec.xLabel || spec.xUnit.toLowerCase() + 's') + '</text>';
      const list = shown(), tops = spec.type === 'area' ? stackOf(list) : null;
      const colourIdx = new Map(spec.series.map((s, i) => [s, colourOf(s, i)]));
      const path = (vals) => { let d = '', pen = false; for (let t = 0; t < vals.length; t++) { const v = vals[t]; if (!isNum(v)) { pen = false; continue; } d += (pen ? 'L' : 'M') + (+X(t).toFixed(1)) + ' ' + (+Y(v).toFixed(1)); pen = true; } return d; };
      if (spec.type === 'area') {
        const A = list.filter(s => !s.b); let below = new Array(Math.max(0, ...A.map(s => s.values.length))).fill(0);
        for (const s of A) {
          const top = tops.get(s), c = P[colourIdx.get(s) % P.length]; if (!top.length) continue;
          let d = 'M' + (+X(0).toFixed(1)) + ' ' + (+Y(top[0]).toFixed(1));
          for (let t = 1; t < top.length; t++) d += 'L' + (+X(t).toFixed(1)) + ' ' + (+Y(top[t]).toFixed(1));
          for (let t = below.length - 1; t >= 0; t--) d += 'L' + (+X(t).toFixed(1)) + ' ' + (+Y(below[t]).toFixed(1));
          g += '<path d="' + d + 'Z" fill="' + c + '" fill-opacity="0.78" stroke="' + th0.paper + '" stroke-width="0.8" data-series="' + esc(s.key) + '"/>';
          below = top;
        }
        for (const s of list.filter(x => x.b)) g += '<path d="' + path(tops.get(s)) + '" fill="none" stroke="' + P[colourIdx.get(s) % P.length] + '" stroke-width="2" stroke-dasharray="6 4" data-series="' + esc(s.key) + '" data-b="1"/>';
      } else {
        for (const s of list) g += '<path d="' + path(s.values) + '" fill="none" stroke="' + P[colourIdx.get(s) % P.length] + '" stroke-width="' + (spec.register === 'formal' ? 1.8 : 2.2) + '"' + (s.b ? ' stroke-dasharray="6 4"' : '') + ' stroke-linejoin="round" data-series="' + esc(s.key) + '"' + (s.b ? ' data-b="1"' : '') + '/>';
      }
      geo = { X, Y, hz, list, tops, colourIdx, pw };
      return g;
    }

    function drawBars() {
      const [yt, y0, y1] = domainY(), fr = frame(yt, y0, y1), th0 = th(), P = pal(), cats = spec.categories, n = Math.max(1, cats.length), Y = fr.Y;
      const slot = fr.pw / n, both = cats.some(c => isNum(c.valueB)), bw = Math.min(46, slot * (both ? 0.36 : 0.62));
      let g = fr.g;
      cats.forEach((c, i) => {
        const cx = M.l + slot * (i + 0.5), x0 = both ? cx - bw - 1 : cx - bw / 2, base = Y(0);
        const bar = (v, x, dashed) => {
          if (!isNum(v)) return '<text x="' + (x + bw / 2) + '" y="' + (base - 4) + '" text-anchor="middle" font-size="10" fill="' + th0.muted + '">no data</text>';
          const yv = Y(v), top = Math.min(yv, base), h = Math.abs(base - yv);
          return '<rect x="' + x + '" y="' + top + '" width="' + bw + '" height="' + Math.max(h, 0.5) + '" fill="' + P[0] + '"' + (dashed ? ' fill-opacity="0.18" stroke="' + P[0] + '" stroke-width="1.8" stroke-dasharray="5 3" data-b="1"' : ' fill-opacity="0.9"') + ' data-cat="' + esc(c.label) + '"><title>' + esc(c.label + (dashed ? ' (comparison)' : '') + ': ' + withUnit(v, spec.unit)) + '</title></rect>' +
                 '<text x="' + (x + bw / 2) + '" y="' + (v >= 0 ? top - 3 : top + h + 11) + '" text-anchor="middle" font-size="10" fill="' + th0.ink + '">' + esc(fmt(v)) + '</text>';
        };
        g += bar(c.value, x0, false); if (both) g += bar(c.valueB, cx + 1, true);
        const words = String(c.label).split(/\s+/), lines = []; let cur = '';
        for (const w of words) { if (cur && (cur + ' ' + w).length > Math.max(6, slot / 5.6)) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
        lines.push(cur);
        lines.slice(0, 3).forEach((ln, j) => { g += '<text x="' + cx + '" y="' + (H - M.b + 13 + j * 11) + '" text-anchor="middle" font-size="10.5" fill="' + th0.muted + '">' + esc(ln) + '</text>'; });
      });
      geo = { slot, n };
      return g;
    }

    function drawCursor() {
      if (!geo || spec.type === 'bar') return '';
      const th0 = th(), P = pal(), { X, Y } = geo; let g = '';
      const at = (t, solid) => {
        if (t === null || t === undefined) return '';
        t = Math.max(0, Math.min(geo.hz, t)); const x = X(t);
        let s = '<line x1="' + x + '" x2="' + x + '" y1="' + M.t + '" y2="' + (H - M.b) + '" stroke="' + th0.ink + '" stroke-width="' + (solid ? 1.4 : 1) + '"' + (solid ? '' : ' stroke-dasharray="2 3"') + ' data-cursor="' + (solid ? 'time' : 'hover') + '" />';
        geo.list.forEach((sr) => {
          const i = spec.series.indexOf(sr), v = spec.type === 'area' ? (geo.tops.get(sr) || [])[t] : sr.values[t];
          if (isNum(v)) s += marker(MARKERS[i % MARKERS.length], x, Y(v), solid ? 3.4 : 3, P[geo.colourIdx.get(sr) % P.length], ' stroke="' + th0.paper + '" stroke-width="1"');
        });
        return s;
      };
      g += at(spec.cursor, true);
      if (hoverT !== null && hoverT !== spec.cursor) g += at(hoverT, false);
      return g;
    }

    function readoutText() {
      const t = hoverT !== null ? hoverT : spec.cursor;
      if (spec.type === 'bar') return '';
      if (t === null || t === undefined) return '';
      const parts = spec.series.filter(s => !spec.hidden[s.key]).map(s => s.label + ' ' + withUnit(s.values[t], spec.unit));
      return spec.xUnit + ' ' + t + (hoverT !== null && hoverT !== spec.cursor ? ' (pointer)' : '') + ': ' + (parts.join(' · ') || 'no data');
    }

    function drawLegend() {
      legend.textContent = '';
      const P = pal();
      const items = spec.type === 'bar' ? (hasB() ? [{ label: 'A', b: false }, { label: 'B (comparison)', b: true }] : []) : spec.series;
      items.forEach((s, idx) => {
        const i = spec.type === 'bar' ? 0 : idx, li = doc.createElement('li'), btn = doc.createElement('button');
        btn.type = 'button'; btn.className = 'pc-key'; btn.setAttribute('data-key', s.key || s.label);
        const off = !!spec.hidden[s.key];
        const col = P[colourOf(s, i) % P.length];
        const sw = '<svg width="30" height="12" viewBox="0 0 30 12" aria-hidden="true">' + (spec.type === 'area' && !s.b ? '<rect x="1" y="1" width="28" height="10" fill="' + col + '" fill-opacity="0.78"/>' : '<line x1="1" x2="29" y1="6" y2="6" stroke="' + col + '" stroke-width="2.2"' + (s.b ? ' stroke-dasharray="6 4"' : '') + '/>' + (spec.type === 'bar' ? '' : marker(MARKERS[i % MARKERS.length], 15, 6, 3, col))) + '</svg>';
        btn.innerHTML = sw + '<span></span>'; btn.lastChild.textContent = s.label;
        if (spec.type !== 'bar') { btn.setAttribute('aria-pressed', off ? 'false' : 'true'); btn.title = (off ? 'Show ' : 'Hide ') + s.label; btn.onclick = () => { spec.hidden = Object.assign({}, spec.hidden, { [s.key]: !spec.hidden[s.key] }); draw(); }; if (off) btn.className += ' off'; }
        else btn.disabled = true;
        li.appendChild(btn); legend.appendChild(li);
      });
      legend.hidden = !items.length;
    }

    function draw() {
      const th0 = th();
      el.setAttribute('data-register', spec.register);
      el.style.setProperty('--pc-ink', th0.ink); el.style.setProperty('--pc-muted', th0.muted); el.style.setProperty('--pc-font', th0.font);
      cap.textContent = spec.title + (spec.unit ? ' (' + spec.unit + ')' : '');
      cap.id = uid + '-t';
      const body = spec.type === 'bar' ? drawBars() : drawTime();
      const desc = describe();
      svg.setAttribute('aria-labelledby', uid + '-t ' + uid + '-d');
      svg.innerHTML = '<desc id="' + uid + '-d">' + esc(desc) + '</desc>' + '<g font-family="' + esc(th0.font) + '">' + body + '<g class="pc-cursor">' + drawCursor() + '</g></g>';
      read.textContent = readoutText();
      drawLegend();
      el.setAttribute('data-desc', desc);
    }
    function redrawCursor() {
      const g = svg.querySelector('.pc-cursor'); if (!g || spec.type === 'bar') return draw();
      g.innerHTML = drawCursor(); read.textContent = readoutText();
    }

    // ---- pointer: the x position of an event as a time ----
    function tFromX(clientX) {
      if (!geo || spec.type === 'bar') return null;
      const r = svg.getBoundingClientRect(); if (!r.width) return null;
      const vx = (clientX - r.left) / r.width * W, t = Math.round((vx - M.l) / geo.pw * geo.hz);
      return Math.max(0, Math.min(geo.hz, t));
    }
    const hoverAt = (t, silent) => { hoverT = t === null || t === undefined ? null : Math.max(0, Math.min(spec.horizon, Math.round(t))); redrawCursor(); if (!silent && spec.onHover) spec.onHover(hoverT); };
    svg.addEventListener('pointermove', e => { const t = tFromX(e.clientX); if (t !== null && t !== hoverT) hoverAt(t); });
    svg.addEventListener('pointerleave', () => { if (hoverT !== null) hoverAt(null); });
    svg.addEventListener('click', e => { const t = tFromX(e.clientX); if (t !== null && spec.onPick) spec.onPick(t); });

    draw();
    return {
      el, svg, legend, readout: read, get spec() { return spec; },
      update(next) { spec = Object.assign({}, spec, next); draw(); },
      setCursor(t) { if (t !== spec.cursor) { spec = Object.assign({}, spec, { cursor: t }); redrawCursor(); } },
      hoverAt, tFromX, describe,
      destroy() { if (el.parentNode) el.parentNode.removeChild(el); },
    };
  }

  // ---- KPI tiles: a label, a value with its unit, and (when a comparison is on) B's value and the difference ----
  function kpis(doc, tiles0) {
    const el = doc.createElement('div'); el.className = 'pc-kpis'; el.setAttribute('role', 'group');
    function update(tiles) {
      el.textContent = '';
      for (const t of tiles) {
        const d = doc.createElement('div'); d.className = 'pc-kpi'; d.setAttribute('data-kpi', t.id || t.label);
        const lab = doc.createElement('div'); lab.className = 'pc-kpi-label'; lab.textContent = t.label;
        const val = doc.createElement('div'); val.className = 'pc-kpi-value'; val.textContent = fmt(t.value, t.decimals);
        if (t.unit && isNum(t.value)) { const u = doc.createElement('span'); u.className = 'pc-kpi-unit'; u.textContent = ' ' + t.unit; val.appendChild(u); }
        d.appendChild(lab); d.appendChild(val);
        if (t.valueB !== undefined && t.valueB !== null) {
          const diff = isNum(t.value) && isNum(t.valueB) ? t.valueB - t.value : NaN, up = diff > 0, flat = diff === 0;
          const sgn = flat ? '±' : up ? '+' : '−', arrow = flat ? '=' : up ? '▲' : '▼';
          const pct = isNum(diff) && t.value ? ' (' + sgn + Math.abs(Math.round(diff / Math.abs(t.value) * 100)) + '%)' : '';
          const cmp = doc.createElement('div'); cmp.className = 'pc-kpi-cmp'; cmp.setAttribute('data-delta', isNum(diff) ? String(diff) : '');
          cmp.textContent = 'B ' + withUnit(t.valueB, t.unit, t.decimals) + ' · ' + (isNum(diff) ? arrow + ' ' + sgn + fmt(Math.abs(diff), t.decimals) + pct + ' vs A' : 'no difference to show');
          d.appendChild(cmp);
        }
        d.setAttribute('aria-label', d.textContent);
        el.appendChild(d);
      }
      el.hidden = !tiles.length;
    }
    update(tiles0 || []);
    return { el, update };
  }

  root.PackCharts = { create, kpis, niceTicks, fmt, PALETTES, THEME, MARKERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PackCharts;
})(typeof window !== 'undefined' ? window : globalThis);
