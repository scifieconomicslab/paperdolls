/* terrainlib.js: synthetic terrain for tests, benchmarks and demos. No DOM. Real terrain comes from `paperdolls ingest --elevation FILE`.
 *
 *   Terrain.synthetic(bounds, { cell: 25, relief: 38, seed: 3 })  -> a scene.terrain grid ({ x0, y0, dx, dy, nx, ny, z })
 *   Terrain.attach(scene, grid)                                    -> writes b.z, road.z and tree z from the grid (what the ingest does with a DEM)
 *   Terrain.sample(grid, x, y)                                     -> bilinear height in metres
 *
 * The synthetic land is Jette-like in shape and size only (it is not data): a valley floor that wanders across the scene, a long rise on one side to
 * about `relief` metres over 1 to 2 km, and a few metres of gentle noise. Heights are rounded to 0.1 m, as the ingest writes them.
 */
(function (root) {
  'use strict';
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const smooth = t => t * t * (3 - 2 * t);
  function valueNoise(seed, period) {                         // smooth 2D noise in [0, 1], lattice spacing = period metres
    const R = rng(seed), tab = new Float32Array(1024); for (let i = 0; i < 1024; i++) tab[i] = R();
    const h = (i, j) => tab[((i * 73856093) ^ (j * 19349663)) & 1023];
    return (x, y) => { const u = x / period, v = y / period, i = Math.floor(u), j = Math.floor(v), fu = smooth(u - i), fv = smooth(v - j);
      return (h(i, j) * (1 - fu) + h(i + 1, j) * fu) * (1 - fv) + (h(i, j + 1) * (1 - fu) + h(i + 1, j + 1) * fu) * fv; };
  }
  function synthetic(bounds, opts) {
    opts = Object.assign({ cell: 25, relief: 38, seed: 3, noise: 2.5 }, opts || {});
    const [x0, y0, x1, y1] = bounds, d = opts.cell, nx = Math.ceil((x1 - x0) / d) + 1, ny = Math.ceil((y1 - y0) / d) + 1, W = x1 - x0, Hh = y1 - y0;
    const n1 = valueNoise(opts.seed, 400), n2 = valueNoise(opts.seed + 1, 120), z = new Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * d, y = y0 + j * d, u = (x - x0) / W, v = (y - y0) / Hh;
      // the valley floor wanders from the north-west to the south-east; distance across it (in km) decides the height: a long rise on one side (the hill), a short one on the other
      const across = (v - 0.5 - 0.18 * Math.sin(u * 5.2 + 0.7) - 0.25 * (u - 0.5)) * Hh / 1000;
      const rise = across > 0 ? opts.relief * smooth(Math.min(1, across / 1.5)) : opts.relief * 0.45 * smooth(Math.min(1, -across / 1.0));
      z[j * nx + i] = Math.round((rise + opts.noise * (n1(x, y) - 0.5) * 2 + opts.noise * 0.3 * (n2(x, y) - 0.5) * 2) * 10) / 10;
    }
    return { x0, y0, dx: d, dy: d, nx, ny, z };
  }
  function sample(T, x, y) {
    let u = (x - T.x0) / T.dx, v = (y - T.y0) / T.dy;
    u = Math.max(0, Math.min(T.nx - 1, u)); v = Math.max(0, Math.min(T.ny - 1, v));
    const i = Math.min(T.nx - 2, Math.floor(u)), j = Math.min(T.ny - 2, Math.floor(v)), fu = u - i, fv = v - j, k = j * T.nx + i, z = T.z;
    return (z[k] * (1 - fu) + z[k + 1] * fu) * (1 - fv) + (z[k + T.nx] * (1 - fu) + z[k + T.nx + 1] * fu) * fv;
  }
  // Writes the heights the grid gives onto the scene's own elements (and keeps the grid for the ground). A building's z is the mean over its footprint's corners and centre.
  function attach(scene, T, opts) {
    const r1 = v => Math.round(v * 10) / 10, mean = pts => pts.reduce((s, p) => s + sample(T, p[0], p[1]), 0) / pts.length;
    for (const b of scene.buildings) b.z = r1(mean(b.footprint));
    for (const r of scene.roads) r.z = r.pts.map(p => r1(sample(T, p[0], p[1])));
    scene.trees = scene.trees.map(t => { const o = t.slice(); while (o.length < 4) o.push(null); o[4] = r1(sample(T, t[0], t[1])); return o; });
    if (!opts || opts.grid !== false) scene.terrain = T;
    return scene;
  }
  root.Terrain = { synthetic, sample, attach };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Terrain;
})(typeof window !== 'undefined' ? window : globalThis);
