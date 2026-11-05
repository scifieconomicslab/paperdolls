/* Renders a scripted camera tour of the placeholder scene to PNG frames, one per tick, with every build budget off, so the result is
 * smooth however slow each frame was to draw (a screen recording of a live browser drops frames). Encode the frames with ffmpeg.
 * Usage: node viz/record_tour.js outdir [fps=30] [seconds=28] [width=1280] [height=720]     Needs the node 'canvas' package.
 * Env: STILLS=t1,t2 writes only the frames at those seconds (to pick shots). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { createCanvas } = require(process.env.NODE_CANVAS || 'canvas');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set, Date, Int32Array, Uint8Array }; g.globalThis = g; vm.createContext(g);
for (const f of ['assetlib.js', 'buildinglib.js', 'treelib.js', 'vizlib.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib; A.sprites.factory = (w, h) => createCanvas(w, h);
const out = process.argv[2] || '.', FPS = +(process.argv[3] || 30), SECS = +(process.argv[4] || 28), W = +(process.argv[5] || 1280), H = +(process.argv[6] || 720);
const pal = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'palettes.json'), 'utf8'));
const fam = pal.families.find(f => f.id === 'sa'), C30 = 0.8660254;
const scene = V.makePlaceholderScene(7), theme = A.theme(fam, 'whitewash', 'colorfigures');
const B = V.sceneBounds(scene), S = Math.max(B[2] - B[0], B[3] - B[1]);
const fit = Math.min(W * 0.94 / (S * C30 + 1), H * 0.94 / (S * 0.5 + 1));
// shots: [seconds, world x, world y, px per metre]. The camera glides between them; scale is interpolated in log space so a zoom feels even.
const SHOTS = JSON.parse(process.env.SHOTS || 'null') || [
  [0.0, 420, 260, fit], [3.0, 420, 260, fit * 1.4], [8.0, 455, 262, 11], [11.5, 520, 262, 15], [15.0, 225, 200, 8], [18.5, 190, 133, 16],
  [22.0, 300, 130, 5], [25.0, 400, 280, 1.8], [28.0, 420, 260, fit],
];
const ease = t => t * t * (3 - 2 * t);
function pose(t) {
  let i = 0; while (i < SHOTS.length - 2 && t > SHOTS[i + 1][0]) i++;
  const a = SHOTS[i], b = SHOTS[i + 1], u = ease(Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))));
  return { x: a[1] + (b[1] - a[1]) * u, y: a[2] + (b[2] - a[2]) * u, k: Math.exp(Math.log(a[3]) + (Math.log(b[3]) - Math.log(a[3])) * u) };
}
const view = p => ({ w: W, h: H, scale: p.k, ox: W / 2 - (p.x - p.y) * p.k * C30, oy: H / 2 - (p.x + p.y) * p.k * 0.5 });
const sim = V.createSim(scene, { seed: 11, theme, region: 'sa', detail: true, fog: true, buildMs: Infinity, layerMs: Infinity, prewarmMs: Infinity });
for (let i = 0; i < 60; i++) V.stepSim(sim, 0.1);                                           // let the people and traffic spread out
const cv = createCanvas(W, H), c = cv.getContext('2d'), N = Math.round(FPS * SECS), only = process.env.STILLS ? process.env.STILLS.split(',').map(Number) : null;
fs.mkdirSync(out, { recursive: true });
for (let f = 0; f < N; f++) {
  const t = f / FPS; V.stepSim(sim, 1 / FPS);
  if (only && !only.some(s => Math.abs(s - t) < 0.5 / FPS)) continue;
  const v = view(pose(t));
  for (let i = 0; i < 4; i++) V.renderFrame(c, sim, v, {});                            // the same view a few times: the renderer treats a view that has held still as settled and draws it at exact scale, not from stretched stand-ins
  fs.writeFileSync(path.join(out, 'f' + String(f).padStart(5, '0') + '.png'), cv.toBuffer('image/png'));
  if (f % 60 === 0) console.log('frame', f, 'of', N);
}
