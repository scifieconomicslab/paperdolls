/* R35: small deterministic cases of part 30. Each block prints what it observed.
 *  a  degenerate footprint: validateScene accepts it, fit = {cx:0, cy:0}: painter's order, picking order and terrain height all use the origin
 *  b  a replay with a mapping installs a NON-versioned buildingStyle: the far layer is off, every building is drawn every frame
 *  c  A.sprites.dpr is read once at page load; the canvas is resized to the new DPR but layers and sprites stay at the old one
 *  d  createSim keeps the scene's own objects: state written through a sim (Replay.paintStates) is still there in the next sim made from the same scene
 *  e  AssetLib.theme() caches by (family.id || 'x', look.id, register): two families without an id are the same theme
 *  f  an extruded (non-asset) building with huge `levels` passes validateScene and costs time per storey, per frame
 *  g  what renderFrame does with a NaN, zero, negative or infinite scale and with a zero-size view (the camera clamps these out, but clamp(NaN) is NaN)
 * Run: PAPERDOLLS_NODE_MODULES=<node_modules> node docs/state-machines/repro/r35-small-cases.js */
const R = require('./_render'), { A, V, g } = R;
const W = 900, H = 600;
// ---- a
{
  const sc = V.makePlaceholderScene(7); sc.terrain = { x0: -100, y0: -100, dx: 100, dy: 100, nx: 12, ny: 8, z: Array.from({ length: 96 }, (_, i) => (i % 12) * 4) };
  sc.buildings.push({ id: 'collinear', footprint: [[300, 300], [310, 300], [320, 300]], levels: 3, archetype: 'terrace', state: 'none', investor: false });
  const chk = V.validateScene(sc), sim = V.createSim(sc, { seed: 1, theme: R.theme(), region: 'nw' }), d = sim.buildings[sim.buildings.length - 1];
  console.log('a  validateScene ok=' + chk.ok + '; fit=' + JSON.stringify({ ok: d.fit.ok, reason: d.fit.reason, cx: d.fit.cx, cy: d.fit.cy }) + '; e.z=' + d.z + ' but the terrain at its footprint (305,300) is ' + sim.terrain.at(305, 300).toFixed(1) + ' m; renderer sort key d = fit.cx+fit.cy+z = ' + (d.fit.cx + d.fit.cy + d.z) + ' instead of ~' + (610 + sim.terrain.at(305, 300)).toFixed(0));
}
// ---- b
{
  const sc = V.makePlaceholderScene(7), N = sc.buildings.length, sim = R.mkSim(sc, { layerMs: 1e9, buildMs: 1e9 });
  const data = { n: N, mapping: [{ variable: 'v', channel: 'wall', scale: { type: 'sequential', colours: ['#f4e9c8', '#c8452f'], domain: [0, 1] } }], weeks: [{ vars: { v: Array.from({ length: N }, (_, i) => i / N) } }] };
  const rp = g.Replay.create(sim, data); let calls = 0; const st = sim.buildingStyle; sim.buildingStyle = e => { calls++; return st(e); };
  const c = R.ctx2d(W, H), v = R.viewAt(sc, 0.35, W, H); for (let i = 0; i < 6; i++) V.renderFrame(c, sim, v, {}); calls = 0; for (let i = 0; i < 5; i++) V.renderFrame(c, sim, v, {});
  console.log('b  replay with a mapping, ' + N + ' buildings, far view (0.35 px/m), 5 settled frames: style calls ' + calls + ' (' + (calls / 5) + ' per frame), layerRepaints=' + (sim.layerRepaints || 0) + ', far layer present=' + !!sim._far + ' (typeof frameVersion=' + typeof sim.frameVersion + ')');
}
// ---- c
{
  const sc = V.makePlaceholderScene(7), v = R.viewAt(sc, 0.35, W, H), out = {};
  for (const [label, q] of [['sprites.dpr=2 (matches the canvas)', 2], ['sprites.dpr=1 left from page load, canvas now 2x', 1]]) {
    R.resetSprites(); A.sprites.dpr = q; const sim = R.mkSim(JSON.parse(JSON.stringify(sc)), { layerMs: 1e9 }), c = R.ctx2d(W * 2, H * 2); c.setTransform(2, 0, 0, 2, 0, 0);   // what resize() does: canvas.width = clientWidth * 2, setTransform(2)
    for (let i = 0; i < 6; i++) V.renderFrame(c, sim, v, {});
    out[label] = { px: c.getImageData(0, 0, W * 2, H * 2).data, layer: sim._far.cv.width + 'x' + sim._far.cv.height };
  }
  const ks = Object.keys(out); let n = 0; for (let i = 0; i < out[ks[0]].px.length; i++) if (out[ks[0]].px[i] !== out[ks[1]].px[i]) n++;
  console.log('c  far layer canvas: ' + ks[0] + ' ' + out[ks[0]].layer + '; ' + ks[1] + ' ' + out[ks[1]].layer + '; the two pictures differ in ' + n + ' of ' + out[ks[0]].px.length + ' bytes (the second is the up-scaled low-resolution layer)');
  console.log('   grep: A.sprites.dpr is assigned at viz/viewer.html:120 and viz/packhost.html:180 only (page load); resize() at viewer.html:172 / packhost.html:223 uses a local dpr for the canvases');
}
// ---- d
{
  const sc = V.makePlaceholderScene(7), s1 = R.mkSim(sc, {}), N = sc.buildings.length;
  const data = { n: N, mapping: [], states: [{ key: 'to_do', label: 'x' }], weeks: [{ codes: Array.from({ length: N }, () => 3) }] };
  g.Replay.create(s1, data);                                                       // no mapping: paintStates writes e.src.state on the SCENE's building objects
  const s2 = R.mkSim(sc, {});
  console.log('d  after a replay on sim 1, a new sim from the same scene starts with ' + s2.buildings.filter(e => e.state === 'finished').length + ' of ' + N + ' buildings already "finished" (scene object shared: e.src === scene.buildings[i] = ' + (s1.buildings[0].src === sc.buildings[0]) + ')');
}
// ---- e
{
  const t1 = A.theme({ name: 'a', wall: '#aaaaaa', wall2: '#bbbbbb', roof: '#111111', accent: '#ff0000', ground: '#cccccc', shadow: '#000000' }, undefined, 'colorfigures');
  const t2 = A.theme({ name: 'b', wall: '#00aa00', wall2: '#00bb00', roof: '#003300', accent: '#00ff00', ground: '#ddeedd', shadow: '#001100' }, undefined, 'colorfigures');
  console.log('e  two different id-less families give the same theme object: ' + (t1 === t2) + ' (ground ' + t1.ground + ' and ' + t2.ground + '; every palettes.json family has an id, so this needs a hand-made record)');
}
// ---- f
{
  const mk = lv => { const sc = V.makePlaceholderScene(7); const b = sc.buildings[0]; const [cx, cy] = b.footprint[0]; b.footprint = [[cx, cy], [cx + 12, cy + 12], [cx + 6, cy + 24], [cx - 6, cy + 12]]; b.levels = lv; b.archetype = 'terrace'; return sc; };   // rotated 45 degrees: no asset slot, drawn as an extrusion
  const times = {};
  for (const lv of [4, 20000, 200000]) { const sc = mk(lv), chk = V.validateScene(sc), sim = R.mkSim(sc, {}); const e = sim.buildings[0]; const c = R.ctx2d(W, H); const p = V.proj(R.viewAt(sc, 4, W, H), e.fit.cx, e.fit.cy, 0), v = R.viewAt(sc, 4, W, H);
    v.ox += 450 - p[0]; v.oy += 300 - p[1]; R.clock.set(0.25); const t0 = process.hrtime.bigint(); V.renderFrame(c, sim, v, { buildings: true, trees: false, vehicles: false, people: false }); times[lv] = { ok: chk.ok, extruded: !e.params, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; }
  console.log('f  levels -> validateScene ok / drawn as extrusion / first-frame ms: ' + Object.entries(times).map(([k, t]) => k + ' -> ' + t.ok + ' / ' + t.extruded + ' / ' + t.ms.toFixed(0)).join('; '));
}
// ---- g
{
  const out = [];
  for (const k of [NaN, 0, -1, Infinity]) { const s = R.mkSim(V.makePlaceholderScene(7)); const c = R.ctx2d(W, H); R.resetSprites(); try { const t0 = Date.now(); V.renderFrame(c, s, { w: W, h: H, scale: k, ox: 300, oy: 200 }, {}); out.push('scale ' + k + ': no error, ' + A.sprites.cache.size + ' sprites built'); } catch (e) { out.push('scale ' + k + ': THROWS ' + String(e.message).slice(0, 60)); } }
  for (const [w, h] of [[0, 0], [0, 300], [300, 0]]) { const s = R.mkSim(V.makePlaceholderScene(7)); const c = R.ctx2d(Math.max(1, w), Math.max(1, h)); try { V.renderFrame(c, s, { w, h, scale: 0.5, ox: 0, oy: 0 }, {}); out.push('view ' + w + 'x' + h + ': no error'); } catch (e) { out.push('view ' + w + 'x' + h + ': THROWS ' + String(e.message).slice(0, 60)); } }
  const cam = g.LabCamera.create({ bounds: [0, 0, 800, 600], width: 1200, height: 700 }); cam.zoomAt(NaN);
  console.log('g  ' + out.join('; ') + '. camera.zoomAt(NaN) leaves scale = ' + cam.scale + ' (clamp does not catch NaN, camera.js:zoomAt); every later view is NaN.');
}
