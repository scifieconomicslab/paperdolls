/* Diagnostic: how much of a scene is actually hidden, and what would culling it save?
 *
 * For one view it paints every drawable item (buildings, trees, vehicles, people) as a flat unique colour in painter order, with
 * anti-aliasing off, then counts the pixels each item keeps. Items that keep none are fully hidden. Then it times the real renderer
 * drawing everything against drawing only the items that keep a pixel: that second time is the best any occlusion culling could do,
 * because it assumes the visibility test is free.
 *
 * Usage: node viz/occlusion_probe.js [scene.json] [family] ; env TALL=1 makes every building 4 to 8 storeys (a worst case for hiding).
 * Needs the node 'canvas' package. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib; A.sprites.factory = (w, h) => createCanvas(w, h);
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8'));
const fam = pal.families.find(f => f.id === (process.argv[3] || 'nw'));
const scene = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : V.makePlaceholderScene(7);
if (process.env.TALL) { let s = 12345; scene.buildings.forEach(b => { s = (s * 1103515245 + 12345) & 0x7fffffff; b.levels = 4 + (s % 5); if (b.archetype === 'shed' || b.archetype === 'villa' || b.archetype === 'terrace') b.archetype = 'block'; }); }
const W = 1200, H = 700, theme = A.theme(fam, undefined, 'colorfigures');
const sim = V.createSim(scene, { seed: 5, theme, region: fam.id });
for (let i = 0; i < 40; i++) V.stepSim(sim, 0.1);

function viewAt(k) {
  const fit = V.fitView(scene, W, H, 0.06), B = V.sceneBounds(scene), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2, s = k;
  return { w: W, h: H, scale: s, ox: W / 2 - (cx - cy) * s * 0.8660254, oy: H / 2 - (cx + cy) * s * 0.5 };
}
function collect(view) {
  const out = [], P = (x, y) => [view.ox + (x - y) * view.scale * 0.8660254, view.oy + (x + y) * view.scale * 0.5];
  for (const e of sim.buildings) if (e._asset) { const p = P(e.fit.cx, e.fit.cy); out.push({ kind: 'building', o: e, asset: e._asset, x: p[0], y: p[1], sc: view.scale, d: e.fit.cx + e.fit.cy }); }
  for (const t of sim.trees) if (t._asset) { const p = P(t.x, t.y); out.push({ kind: 'tree', o: t, asset: t._asset, x: p[0], y: p[1], sc: view.scale, d: t.x + t.y + 0.5 }); }
  for (const a of sim.agents) {
    const pose = V.agentPose(a, sim), h = A.snapHeading(pose.heading), p = P(pose.x, pose.y);
    const asset = a.group === 'vehicles' ? A.getAsset('vehicles', a.kind, h) : A.getAsset('people', a.kind, h, A.flagsOf(a.outfits));
    out.push({ kind: a.group === 'vehicles' ? 'vehicle' : 'person', o: a, asset, x: p[0], y: p[1], sc: view.scale * (a.group === 'people' ? A.STYLE.person : A.STYLE.vehicle), d: pose.x + pose.y });
  }
  return out.filter(it => {                                  // only items whose whole sprite is inside the view, so edges do not bias the count
    const b = it.asset.bbox, x0 = it.x + b.minX * it.sc, x1 = it.x + b.maxX * it.sc, y0 = it.y + b.minY * it.sc, y1 = it.y + b.maxY * it.sc;
    it.box = [x0, y0, x1, y1]; return x0 >= 0 && y0 >= 0 && x1 <= W && y1 <= H;
  });
}
function silhouette(ctx, it, colour) {
  ctx.fillStyle = colour;
  for (const pr of it.asset.prims) { ctx.beginPath(); pr.pts.forEach((q, i) => { const x = it.x + q[0] * it.sc, y = it.y + q[1] * it.sc; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill(); }
}
function probe(view) {
  // one real frame first so every entity has its sprite and colours
  V.renderFrame(createCanvas(W, H).getContext('2d'), sim, view, {});
  const items = collect(view).sort((a, b) => a.d - b.d);
  const idc = createCanvas(W, H), ctx = idc.getContext('2d'); ctx.antialias = 'none';
  items.forEach((it, i) => { const id = i + 1; silhouette(ctx, it, '#' + id.toString(16).padStart(6, '0')); });
  const px = ctx.getImageData(0, 0, W, H).data, seen = new Int32Array(items.length + 1); let covered = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) { covered++; seen[(px[i] << 16) | (px[i + 1] << 8) | px[i + 2]]++; }
  const sc = createCanvas(1, 1); let drawn = 0;
  const stat = {};
  items.forEach((it, i) => {
    const b = it.box, w = Math.ceil(b[2] - b[0]) + 2, h = Math.ceil(b[3] - b[1]) + 2, c = createCanvas(w, h), cx = c.getContext('2d'); cx.antialias = 'none';
    silhouette(cx, { asset: it.asset, x: it.x - b[0] + 1, y: it.y - b[1] + 1, sc: it.sc }, '#fff');
    const d = cx.getImageData(0, 0, w, h).data; let area = 0; for (let k = 3; k < d.length; k += 4) if (d[k] > 0) area++;
    it.area = area; it.vis = seen[i + 1]; drawn += area;
    const s = stat[it.kind] || (stat[it.kind] = { n: 0, hidden: 0, mostly: 0, area: 0, vis: 0 });
    s.n++; s.area += area; s.vis += it.vis; if (it.vis < 2) s.hidden++; else if (it.vis < 0.25 * area) s.mostly++;
  });
  return { items, stat, overdraw: drawn / Math.max(1, covered), coveredPx: covered };
}
// identical frames (nothing moves), the two variants interleaved, the median of many: this removes drift and warm-up noise
function medianMs(sA, sB, view, n) {
  const ca = createCanvas(W, H).getContext('2d'), cb = createCanvas(W, H).getContext('2d'), ta = [], tb = [], run = (s, c) => { const t0 = process.hrtime.bigint(); V.renderFrame(c, s, view, {}); return Number(process.hrtime.bigint() - t0) / 1e6; };
  run(sA, ca); run(sB, cb); run(sA, ca); run(sB, cb);
  for (let i = 0; i < n; i++) { ta.push(run(sA, ca)); tb.push(run(sB, cb)); }
  const med = x => x.sort((p, q) => p - q)[x.length >> 1];
  return [med(ta), med(tb)];
}
console.log(`scene: ${scene.buildings.length} buildings, ${scene.trees.length} trees, ${sim.agents.length} agents${process.env.TALL ? ' (every building made 4 to 8 storeys)' : ''}`);
console.log('px/m | in view | fully hidden | mostly hidden (<25% visible) | overdraw | draw all | draw only visible | upper bound on saving');
for (const k of (process.env.SCALES || '1.7,3,5,8').split(',').map(Number)) {
  const view = viewAt(k), r = probe(view), tot = r.items.length, hid = Object.values(r.stat).reduce((a, s) => a + s.hidden, 0), most = Object.values(r.stat).reduce((a, s) => a + s.mostly, 0);
  const keep = new Set(r.items.filter(it => it.vis >= 2).map(it => it.o));
  const inView = new Set(r.items.map(it => it.o)), keepOrOut = o => keep.has(o) || !inView.has(o);          // items outside the view are untouched
  const s2 = Object.assign(Object.create(sim), { buildings: sim.buildings.filter(keepOrOut), trees: sim.trees.filter(keepOrOut), agents: sim.agents.filter(keepOrOut), _ground: null, _far: null });
  const [tAll, tVis] = medianMs(sim, s2, view, 21);
  const by = Object.entries(r.stat).map(([k2, s]) => `${k2} ${s.n} (hidden ${s.hidden}, mostly ${s.mostly})`).join('; ');
  console.log(`${String(k).padEnd(4)} | ${String(tot).padEnd(7)} | ${hid} (${(hid / tot * 100).toFixed(1)}%) | ${most} (${(most / tot * 100).toFixed(1)}%) | ${r.overdraw.toFixed(2)}x | ${tAll.toFixed(1)} ms | ${tVis.toFixed(1)} ms | ${((1 - tVis / tAll) * 100).toFixed(0)}%\n       ${by}`);
}
