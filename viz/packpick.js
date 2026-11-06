/* packpick.js: which building is under a screen point. No DOM, no canvas: it works on the sim's scene and the view ({ scale, ox, oy }), so Node tests it.
 *
 *   const pick = Pick.create(sim);          // once per sim: indexes every building by ground cell
 *   pick.hit(view, px, py)  -> index into sim.buildings, or -1       the building drawn topmost at that pixel
 *   pick.hitGround(gx, gy)  -> the same, for a ground point (what the pixel is, if nothing stood on it)
 *   pick.silhouette(i)      -> { footprint, h }                      what the hit test treats as building i
 *
 * The projection is sx = ox + (x - y) k cos30, sy = oy + (x + y) k / 2 - z k. A point at height z lands on the screen exactly where the ground point
 * (x - z, y - z) does. So a pixel's ground point g (z = 0) is on a building of height h when some z in [0, h] puts (g + (z, z)) inside the footprint:
 * the segment from g to g + (h, h) touches the polygon. That is the footprint lifted by the building's height (its silhouette), without drawing anything.
 * Several buildings can claim a pixel; the one drawn last wins, which is what the painter's order shows on top: the greatest fit.cx + fit.cy (the renderer's
 * sort key), and for a tie the later one in sim.buildings (the sort is stable). Trees and people are decoration and do not block a pick.
 * A 25 m grid keeps the test to the few buildings near the point: each building is listed in every cell its silhouette can reach.
 * The height is the renderer's (VizLib.entityHeight, the asset's height); the roof of a gabled sprite can rise a little above it.
 */
(function (root) {
  'use strict';
  const C30 = 0.8660254, CELL = 25;
  const cellKey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);

  const inside = (f, x, y) => {
    let ins = false;
    for (let i = 0, j = f.length - 1; i < f.length; j = i++) { const a = f[i], c = f[j]; if ((a[1] > y) !== (c[1] > y) && x < (c[0] - a[0]) * (y - a[1]) / (c[1] - a[1]) + a[0]) ins = !ins; }
    return ins;
  };
  // does the segment (x, y) to (x + h, y + h) cross the segment a to b? (parametric, both ends included)
  const crosses = (x, y, h, a, b) => {
    const rx = h, ry = h, sx = b[0] - a[0], sy = b[1] - a[1], den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return false;                             // parallel: any overlap would already show as a vertex inside, or at an end
    const qx = a[0] - x, qy = a[1] - y, t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };

  function create(sim, opts) {
    const height = (opts && opts.height) || (root.VizLib && root.VizLib.entityHeight);
    const items = [], grid = new Map();
    sim.buildings.forEach((e, i) => {
      const f = e.src.footprint; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of f) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
      const h = Math.max(0, height(e)), it = { i, f, h, d: e.fit.cx + e.fit.cy, x0: x0 - h, y0: y0 - h, x1, y1, bx0: x0, by0: y0, bx1: x1, by1: y1, dmin: x0 - y1, dmax: x1 - y0 };
      items.push(it);
      for (let cx = Math.floor(it.x0 / CELL); cx <= Math.floor(it.x1 / CELL); cx++) for (let cy = Math.floor(it.y0 / CELL); cy <= Math.floor(it.y1 / CELL); cy++) {
        const k = cellKey(cx, cy), l = grid.get(k); if (l) l.push(it); else grid.set(k, [it]);
      }
    });
    const stats = { tested: 0, queries: 0 };
    const touches = (it, gx, gy) => {
      if (gx < it.x0 || gx > it.x1 || gy < it.y0 || gy > it.y1) return false;
      const dd = gx - gy; if (dd < it.dmin || dd > it.dmax) return false;      // lifting keeps x - y, so the pixel column must cross the footprint's x - y range
      const f = it.f;
      if (inside(f, gx, gy) || inside(f, gx + it.h, gy + it.h)) return true;
      for (let i = 0, j = f.length - 1; i < f.length; j = i++) if (crosses(gx, gy, it.h, f[i], f[j])) return true;
      return false;
    };
    const better = (a, b) => !b || a.d > b.d || (a.d === b.d && a.i > b.i);
    function hitGround(gx, gy) {
      const l = grid.get(cellKey(Math.floor(gx / CELL), Math.floor(gy / CELL))); stats.queries++;
      if (!l) return -1;
      let best = null;
      for (const it of l) { stats.tested++; if (touches(it, gx, gy) && better(it, best)) best = it; }
      return best ? best.i : -1;
    }
    function hit(view, px, py) {
      const k = view.scale, a = (px - view.ox) / (k * C30), b = (py - view.oy) * 2 / k;
      return hitGround((a + b) / 2, (b - a) / 2);
    }
    // the same answer without the grid (for the tests)
    function hitBrute(gx, gy) { let best = null; for (const it of items) if (touches(it, gx, gy) && better(it, best)) best = it; return best ? best.i : -1; }
    return { hit, hitGround, hitBrute, stats, silhouette: i => ({ footprint: items[i].f, h: items[i].h }), count: items.length, cells: grid.size };
  }

  root.Pick = { create, inside, crosses, CELL };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Pick;
})(typeof window !== 'undefined' ? window : globalThis);
