/* Load a scene file the way the viewer does: validate it, build the sim, render a frame. Prints one JSON line.
 * Usage: node viz/test_scene_file.js scene.json [family-id] [look-id] [register]
 * Used by tests/test_ingest.py to check that ingest output works in the real renderer. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib;
const scene = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8'));
const fam = pal.families.find(f => f.id === (process.argv[3] || 'nw'));
const out = { check: V.validateScene(scene) };
if (out.check.ok) {
  let t = Date.now();
  const sim = V.createSim(scene, { seed: 5, theme: A.theme(fam, process.argv[4], process.argv[5] || 'colorfigures'), region: fam.id });
  out.createMs = Date.now() - t; out.stats = sim.stats; out.agents = sim.agents.length; out.trees = sim.trees.length; out.density = +sim.density.toFixed(2);
  out.treeKinds = {}; sim.trees.forEach(x => out.treeKinds[x.kind] = (out.treeKinds[x.kind] || 0) + 1);
  out.roadClasses = {}; scene.roads.forEach(r => out.roadClasses[r.class] = (out.roadClasses[r.class] || 0) + 1);
  try {
    const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
    A.sprites.factory = (w, h) => createCanvas(w, h);
    const W = 900, H = 600, cv = createCanvas(W, H), ctx = cv.getContext('2d'), view = V.fitView(scene, W, H, 0.06);
    t = Date.now(); V.renderFrame(ctx, sim, view, {}); out.firstFrameMs = Date.now() - t;
    t = Date.now(); V.stepSim(sim, 0.05); V.renderFrame(ctx, sim, view, {}); out.warmFrameMs = Date.now() - t;
    const bg = A.REG[sim.theme.reg].bg, d = ctx.getImageData(0, 0, W, H).data, b = [parseInt(bg.substr(1, 2), 16), parseInt(bg.substr(3, 2), 16), parseInt(bg.substr(5, 2), 16)];
    let non = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - b[0]) + Math.abs(d[i + 1] - b[1]) + Math.abs(d[i + 2] - b[2]) > 24) non++;
    out.nonBlank = non / (W * H);
    if (process.env.PNG_OUT) fs.writeFileSync(process.env.PNG_OUT, cv.toBuffer('image/png'));
  } catch (e) { out.renderSkipped = String(e.message).slice(0, 80); }
}
console.log(JSON.stringify(out));
