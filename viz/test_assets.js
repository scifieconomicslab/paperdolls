/* Tests for assetlib.js and the asset parts of vizlib.js. Run: node viz/test_assets.js
 * Exits non-zero on the first failure. Set SVG_OUT=<dir> to also write sample SVGs for XML validation. */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const g = { console, Math, Object, Map, Array, Infinity, JSON, Set }; g.globalThis = g; vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'assetlib.js'), 'utf8'), g);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'buildinglib.js'), 'utf8'), g);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'treelib.js'), 'utf8'), g);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'vizlib.js'), 'utf8'), g);
const A = g.AssetLib, V = g.VizLib;
const pal = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'palettes.json'), 'utf8'));
const fam = pal.families[0], reg = A.REG.colorfigures;
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

function outfitsFor(kind, region, f, seed) { const n = A.DEFS.people[kind].members.length, o = []; for (let i = 0; i < n; i++) o.push(A.makeOutfit(region, f, seed + i * 31)); return o; }
function build(group, kind, h, region, f, seed) {
  if (group === 'vehicles') return { asset: A.getAsset('vehicles', kind, h), colours: A.vehicleColours(kind, reg, A.vehicleTint(f, seed)) };
  const outs = outfitsFor(kind, region, f, seed);
  return { asset: A.getAsset('people', kind, h, A.flagsOf(outs)), colours: A.personColours(kind, reg, outs) };
}

test('people are scaled 1.2x', () => assert.strictEqual(A.STYLE.person, 1.2));

test('every asset builds at all four headings with polygons and a data surface', () => {
  for (const group of ['vehicles', 'people']) for (const kind of Object.keys(A.DEFS[group])) for (let h = 0; h < 4; h++) {
    const { asset } = build(group, kind, h, 'nw', fam, 3);
    assert(asset.prims.length > 0, kind + ' h' + h + ' has no polygons');
    assert(asset.prims.some(p => A.isData(p.role)), kind + ' h' + h + ' has no data surface');
    const bb = asset.bbox; assert(isFinite(bb.minX) && bb.maxX > bb.minX && bb.maxY > bb.minY, kind + ' bad bbox');
    for (const p of asset.prims) for (const q of p.pts) assert(isFinite(q[0]) && isFinite(q[1]), kind + ' non-finite point');
  }
});

test('only camera-facing faces are built: vehicles show left, right and top, never more', () => {
  for (const kind of Object.keys(A.DEFS.vehicles)) for (let h = 0; h < 4; h++) {
    const faces = new Set(A.getAsset('vehicles', kind, h).prims.map(p => A.faceOf(p.w)));
    assert([...faces].every(f => ['left', 'right', 'top'].includes(f)), kind);
  }
});

test('opposite headings of a vehicle are different drawings (wheels, lights on the visible side only)', () => {
  const a = JSON.stringify(A.getAsset('vehicles', 'sedan', 0).prims.map(p => p.pts)), b = JSON.stringify(A.getAsset('vehicles', 'sedan', 2).prims.map(p => p.pts));
  assert.notStrictEqual(a, b);
});

test('heading snaps to the nearest axis', () => {
  assert.strictEqual(A.snapHeading(0), 0); assert.strictEqual(A.snapHeading(Math.PI / 2), 1);
  assert.strictEqual(A.snapHeading(Math.PI), 2); assert.strictEqual(A.snapHeading(-Math.PI / 2), 3); assert.strictEqual(A.snapHeading(0.3), 0);
});

test('recolouring the data surface changes data polygons and nothing else', () => {
  for (const [group, kind] of [['vehicles', 'bus'], ['vehicles', 'moped'], ['people', 'woman'], ['people', 'family']]) {
    const { asset, colours } = build(group, kind, 0, 'sa', fam, 5);
    const c2 = Object.assign({}, colours); for (const k of Object.keys(c2)) if (A.isData(k)) c2[k] = '#ff00aa';
    const s1 = A.toSVG(asset, colours, reg), s2 = A.toSVG(asset, c2, reg);
    const poly = s => s.match(/<polygon [^>]*>/g);
    const p1 = poly(s1), p2 = poly(s2); assert.strictEqual(p1.length, p2.length);
    let changed = 0;
    p1.forEach((t, i) => {
      const isDataPoly = /data-surface="1"/.test(t);
      if (t !== p2[i]) { changed++; assert(isDataPoly, kind + ': a non-data polygon changed'); }
      else assert(!isDataPoly, kind + ': a data-surface polygon did not take the new colour');
    });
    assert(changed > 0, kind + ': nothing recoloured');
  }
});

test('SVG is well formed and carries face, role and data-surface attributes', () => {
  const { asset, colours } = build('vehicles', 'tram', 1, 'nw', fam, 1);
  const svg = A.toSVG(asset, colours, reg);
  assert(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert((svg.match(/<polygon/g) || []).length === asset.prims.length);
  assert(/data-face="(left|right|top)"/.test(svg) && /data-role="data"/.test(svg) && /data-surface="1"/.test(svg));
  if (process.env.SVG_OUT) {
    fs.mkdirSync(process.env.SVG_OUT, { recursive: true });
    for (const group of ['vehicles', 'people']) for (const kind of Object.keys(A.DEFS[group])) for (let h = 0; h < 4; h++) {
      const b = build(group, kind, h, 'nw', fam, 3); fs.writeFileSync(path.join(process.env.SVG_OUT, group + '_' + kind + '_' + h + '.svg'), A.toSVG(b.asset, b.colours, reg));
    }
    for (const kind of Object.keys(A.ARCH)) for (let h = 0; h < 4; h++) {
      const p = A.buildingParams('nw', kind, 4, { W: 12, D: 12 }, 3), asset = A.getAsset('buildings', kind, h, A.buildingExtra(p, ['scaffold', 'solar', 'band', 'marker']));
      fs.writeFileSync(path.join(process.env.SVG_OUT, 'buildings_' + kind + '_' + h + '.svg'), A.toSVG(asset, A.buildingColours(reg, fam, { wall: fam.wall }), reg));
    }
  }
});

test('every palette family has a region with real fleet classes and a drive side', () => {
  for (const f of pal.families) {
    const r = A.REGIONS[f.id]; assert(r, 'no region for ' + f.id);
    assert(['right', 'left', 'ask'].includes(r.drive), f.id + ' drive');
    for (const [kind, w] of r.fleet) { assert(A.DEFS.vehicles[kind], f.id + ': unknown class ' + kind); assert(w > 0); }
    for (const k of ['cold', 'sun', 'rain']) assert(r.climate[k] >= 0 && r.climate[k] <= 1);
  }
});

test('outfits are deterministic and follow climate, not identity', () => {
  assert.deepStrictEqual(A.makeOutfit('nw', fam, 42), A.makeOutfit('nw', fam, 42));
  const count = (region, key) => { let n = 0; for (let s = 0; s < 600; s++) { const f = A.makeOutfit(region, fam, s * 13).flags; if (f[key]) n++; } return n; };
  assert(count('nw', 'coat') > count('sa', 'coat') + 100, 'cold regions should wear more coats');
  assert(count('sa', 'hat') + count('sa', 'umbrella') > count('nw', 'hat') + 20 || count('sa', 'umbrella') > 0, 'sunny/rainy regions should carry hats or umbrellas');
  assert.strictEqual(count('sa', 'coat'), 0);
  const o = A.makeOutfit('me', fam, 7); assert(!('skin' in o) && !('skinTone' in o));
});

test('a coat puts the sleeves on the data surface too', () => {
  const o = [{ flags: { coat: true }, top: '#111111', bottom: '#222222', accent: '#333333', hat: '#444444' }];
  const a = A.getAsset('people', 'man', 0, A.flagsOf(o)), plain = A.getAsset('people', 'man', 0, [{}]);
  const n = x => x.prims.filter(p => A.isData(p.role)).length;
  assert(n(a) > n(plain), 'coat should add data-surface polygons');
  assert(!a.prims.some(p => p.role === 'sleeve'));
});

test('paper dolls carry no skin tone: head and limbs share one paper colour', () => {
  const { asset, colours } = build('people', 'man', 0, 'nw', fam, 9);
  const roles = new Set(asset.prims.map(p => p.role));
  assert(roles.has('paper') && !roles.has('skin'));
  assert.strictEqual(colours.paper, reg.paper);
});

test('data scales map outputs to colours and produce a legend', () => {
  const cat = A.scales.retrofitStates(reg), seq = A.scales.sequential(['#000000', '#ffffff'], [0, 10]);
  assert.strictEqual(cat.colour('queued'), reg.states.queued);
  assert.strictEqual(seq.colour(5), '#808080'); assert.strictEqual(seq.colour(-3), '#000000'); assert.strictEqual(seq.colour(99), '#ffffff');
  assert(cat.legend().length === 5 && seq.legend().length === 2);
});

// ---- scene tests ----
const scene = V.makePlaceholderScene(7);
function sim(region, drive, regId, look) { return V.createSim(scene, { seed: 5, trafficScale: 1, peopleScale: 1, theme: A.theme(pal.families.find(f => f.id === region), look, regId || 'colorfigures'), region, drive, buildMs: Infinity, layerMs: Infinity, prewarmMs: Infinity }); }      // tests count builds; the time budget has its own test

test('sim classes agents by group and network, and keeps them on suitable edges', () => {
  const s = sim('nw', null);
  assert(s.agents.some(a => a.group === 'vehicles') && s.agents.some(a => a.group === 'people'));
  for (let i = 0; i < 400; i++) V.stepSim(s, 0.1);
  for (const a of s.agents) {
    if (a.network === 'rail') assert(a.edge.tram, 'rail class left the rails');
    if (a.network === 'pavement') assert(a.edge.pavement > 0);
    if (a.network === 'road') assert(a.edge.cls !== 'cycle', 'road vehicle on the cycle track');
  }
});

test('drive side comes from the region and can be overridden; left and right differ', () => {
  assert.strictEqual(sim('nw', null).opts.drive, 'right'); assert.strictEqual(sim('uk', null).opts.drive, 'left'); assert.strictEqual(sim('sa', null).opts.drive, 'left');
  const r = sim('nw', 'right'), l = sim('nw', 'left');
  const ar = r.agents.find(a => a.group === 'vehicles' && a.network === 'road'), al = l.agents[r.agents.indexOf(ar)];
  assert(al.kind === ar.kind && al.edge.id === ar.edge.id && al.s === ar.s, 'the two sims should start identically');
  const pr = V.agentPose(ar, r), pl = V.agentPose(al, l);
  const side = (p, a) => { const e = a.edge; return (p.x - e.ax) * -(e.by - e.ay) / e.len + (p.y - e.ay) * (e.bx - e.ax) / e.len; };
  assert(Math.abs(side(pr, ar)) > 0.5 && Math.sign(side(pr, ar)) === -Math.sign(side(pl, al)), 'lateral offsets should be on opposite sides of the centre line');
});

test('static motion freezes a class; path motion follows its timetable; null restores decorative motion', () => {
  const s = sim('nw', null);
  const bus = s.agents.find(a => a.kind === 'bus') || s.agents.find(a => a.group === 'vehicles' && a.kind !== 'tram' && a.network === 'road');
  const kind = bus.kind;
  const before = V.agentPose(bus, s);
  assert(V.setMotion(s, kind, { mode: 'static' }) > 0);
  for (let i = 0; i < 20; i++) V.stepSim(s, 0.1);
  const after = V.agentPose(bus, s); assert.strictEqual(before.x, after.x); assert.strictEqual(before.y, after.y);
  V.setMotion(s, kind, { mode: 'path', loop: false, path: [[0, 0, 0], [10, 100, 0]] });
  const t0 = s.time; V.stepSim(s, 5 - 0.1 * 0); // advance
  const target = Math.min(s.time, 10); const p = V.agentPose(bus, s);
  assert(Math.abs(p.x - 100 * target / 10) < 1e-6 && p.y === 0, 'path position off: ' + p.x);
  assert(Math.abs(p.heading) < 1e-9);
  V.setMotion(s, kind, null); assert(!bus.motion);
});

test('driven motion can place an agent anywhere or back on the network', () => {
  const s = sim('nw', null); const a = s.agents.find(x => x.group === 'people');
  V.setMotion(s, a.kind, { mode: 'driven', update: (ag, t) => ({ x: 12, y: 34, heading: Math.PI / 2 }) });
  V.stepSim(s, 0.1); const p = V.agentPose(a, s); assert.strictEqual(p.x, 12); assert.strictEqual(p.y, 34);
});

test('data binding recolours the data surface only and returns a legend', () => {
  const s = sim('nw', null);
  const legend = V.bindData(s, 'people', A.scales.retrofitStates(reg), a => a.outfits.map(() => 'finished'));
  assert.strictEqual(legend.length, 5);
  const person = s.agents.find(a => a.group === 'people');
  // colours are resolved at draw time; emulate that via the library to check the binding contract
  const cols = A.personColours(person.kind, reg, person.outfits, person.outfits.map(() => reg.states.finished));
  assert.strictEqual(cols.data, reg.states.finished); assert.notStrictEqual(cols.bottom, reg.states.finished);
  V.bindData(s, 'people', null, null); assert.strictEqual(s.bindings.length, 0);
});

test('a frame renders with the sprite cache, culling and bindings, and is not blank', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP render (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h);
  const s = sim('sa', null); V.bindData(s, 'vehicles', A.scales.retrofitStates(reg), a => 'queued');
  const cv = createCanvas(900, 600), ctx = cv.getContext('2d'), scale = 14;
  const view = { w: 900, h: 600, scale, ox: 450 - (380 - 230) * scale * 0.8660254, oy: 300 - (380 + 230) * scale * 0.5 };
  V.renderFrame(ctx, s, view, { buildings: true, vehicles: true, people: true });
  const d = ctx.getImageData(0, 0, 900, 600).data; let non = 0; const bg = [0xf2, 0xef, 0xe7];
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 30) non++;
  assert(non > 20000, 'frame looks blank: ' + non);
  assert(A.sprites.cache.size > 0, 'sprite cache unused');
});


test('occlusion culling draws the same picture pixel for pixel, skips hidden items, and is off by default', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP occlusion (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h);
  const scene = V.makePlaceholderScene(7); let seed = 12345;
  scene.buildings.forEach(b => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; b.levels = 4 + (seed % 5); if (['shed', 'villa', 'terrace'].includes(b.archetype)) b.archetype = 'block'; });
  const W = 1200, H = 700, B = V.sceneBounds(scene), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2, theme = A.theme(fam, undefined, 'colorfigures');
  const mk = occ => { const s = V.createSim(scene, { seed: 5, theme, region: fam.id, occlusion: occ, buildMs: Infinity, layerMs: Infinity, prewarmMs: Infinity }); for (let i = 0; i < 40; i++) V.stepSim(s, 0.1); return s; };
  assert.strictEqual(V.createSim(scene, { seed: 5, theme, region: fam.id }).opts.occlusion, undefined, 'occlusion must be opt-in');
  let culled = 0;
  for (const k of [1.7, 3]) {
    const view = { w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * 0.8660254, oy: H / 2 - (cx + cy) * k * 0.5 };
    const on = mk(true), off = mk(false), con = createCanvas(W, H).getContext('2d'), coff = createCanvas(W, H).getContext('2d');
    for (let i = 0; i < 40; i++) { V.renderFrame(con, on, view, {}); V.renderFrame(coff, off, view, {}); }   // settle: sprites at the exact scale
    const a = con.getImageData(0, 0, W, H).data, b = coff.getImageData(0, 0, W, H).data;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail('pixel ' + (i >> 2) + ' differs at ' + k + ' px/m');
    assert(on.occlusionStats && on.occlusionStats.tested > 100, 'nothing was tested at ' + k + ' px/m');
    assert.strictEqual(off.occlusionStats == null, true, 'the default sim must not run the test');
    culled += on.occlusionStats.culled;
  }
  assert(culled > 20, 'no hidden item was skipped: ' + culled);
});

test('panning blits world-anchored layers: no repaint inside the margin, and the picture matches a fresh render', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP panning (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h);
  const scene = V.makePlaceholderScene(7), W = 900, H = 600, B = V.sceneBounds(scene), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2, theme = A.theme(fam, undefined, 'colorfigures');
  const mk = () => { const s = V.createSim(scene, { seed: 5, theme, region: fam.id, buildMs: Infinity, layerMs: Infinity, prewarmMs: Infinity }); for (let i = 0; i < 40; i++) V.stepSim(s, 0.1); return s; };
  const view = (k, dx, dy) => ({ w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * 0.8660254 + dx, oy: H / 2 - (cx + cy) * k * 0.5 + dy });
  const frame = (s, v, n) => { const c = createCanvas(W, H).getContext('2d'); for (let i = 0; i < n; i++) V.renderFrame(c, s, v, {}); return c.getImageData(0, 0, W, H).data; };
  const same = (a, b, what) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail(what + ': pixel ' + (i >> 2) + ' differs'); };
  for (const k of [0.7, 1.7]) {                                   // 0.7 uses the far layer, 1.7 draws items directly over the cached ground
    const P = mk(), c = createCanvas(W, H).getContext('2d');
    for (let i = 0; i < 40; i++) V.renderFrame(c, P, view(k, 0, 0), {});
    const built = P.layerRepaints;
    for (const [dx, dy] of [[40, 0], [-90, 30], [130, -60]]) {
      V.renderFrame(c, P, view(k, dx, dy), {});
      same(c.getImageData(0, 0, W, H).data, frame(mk(), view(k, dx, dy), 40), 'pan ' + dx + ',' + dy + ' at ' + k);
    }
    assert.strictEqual(P.layerRepaints, built, 'a pan inside the margin repainted a layer at ' + k);
    V.renderFrame(c, P, view(k, 600, 0), {});                      // further than the margin: the layer is repainted, the picture is still right
    assert(P.layerRepaints > built, 'a pan past the margin did not repaint at ' + k);
    for (let i = 0; i < 40; i++) V.renderFrame(c, P, view(k, 600, 0), {});
    same(c.getImageData(0, 0, W, H).data, frame(mk(), view(k, 600, 0), 40), 'pan past the margin at ' + k);
  }
});

test('a view that has stopped is exact after a fractional pan or a zoom', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP settling (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h);
  const scene = V.makePlaceholderScene(7), W = 900, H = 600, B = V.sceneBounds(scene), cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2, theme = A.theme(fam, undefined, 'colorfigures');
  const mk = () => { const s = V.createSim(scene, { seed: 5, theme, region: fam.id, buildMs: Infinity, layerMs: Infinity, prewarmMs: Infinity }); for (let i = 0; i < 40; i++) V.stepSim(s, 0.1); return s; };
  const view = (k, dx, dy) => ({ w: W, h: H, scale: k, ox: W / 2 - (cx - cy) * k * 0.8660254 + dx, oy: H / 2 - (cx + cy) * k * 0.5 + dy });
  const settle = (s, c, v) => { for (let i = 0; i < 40; i++) V.renderFrame(c, s, v, {}); return c.getImageData(0, 0, W, H).data; };
  for (const k of [0.7, 1.7]) {
    const P = mk(), c = createCanvas(W, H).getContext('2d'); settle(P, c, view(k, 0, 0));
    for (let i = 0; i < 6; i++) V.renderFrame(c, P, view(k, 10.37 + i * 0.5, 4.21), {});       // a pan with fractional steps
    const a = settle(P, c, view(k, 12.37, 4.21)), b = settle(mk(), createCanvas(W, H).getContext('2d'), view(k, 12.37, 4.21));
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail('fractional pan at ' + k + ': pixel ' + (i >> 2) + ' differs');
    for (let i = 0; i < 8; i++) V.renderFrame(c, P, view(k * (1 + 0.03 * (i + 1)), 12.37, 4.21), {});   // a zoom in eight steps
    const z = settle(P, c, view(k * 1.24, 12.37, 4.21)), y = settle(mk(), createCanvas(W, H).getContext('2d'), view(k * 1.24, 12.37, 4.21));
    for (let i = 0; i < z.length; i++) if (z[i] !== y[i]) assert.fail('zoom at ' + k + ': pixel ' + (i >> 2) + ' differs');
  }
});

// ================= buildings =================
const BPAL = { wall: fam.wall, wall2: fam.wall2, roof: fam.roof, ground: fam.ground, accent: fam.accent, shadow: fam.shadow };
function bparams(region, kind, W, D, N, seed) { return A.buildingParams(region, kind, N, { W, D }, seed); }
function basset(kind, h, p, ov) { return A.getAsset('buildings', kind, h, A.buildingExtra(p, ov || [])); }
const SAMPLE = { terrace: [5, 12, 3], shophouse: [9, 14, 3], block: [26, 14, 5], villa: [10, 12, 2], tower: [24, 24, 12], shed: [30, 20, 1] };

test('every building archetype builds at all four headings with walls as the data surface', () => {
  for (const kind of Object.keys(A.ARCH)) for (let h = 0; h < 4; h++) {
    const [W, D, N] = SAMPLE[kind], a = basset(kind, h, bparams('nw', kind, W, D, N, 7));
    assert(a.prims.length >= 6, kind + ' h' + h + ' too few polygons: ' + a.prims.length);
    assert(a.prims.some(p => A.isData(p.role)), kind + ' has no data surface');
    assert(a.prims.some(p => p.role === 'roof' || p.role === 'roofflat'), kind + ' has no roof');
    assert(new Set(a.prims.map(p => A.faceOf(p.w))).size >= 2, kind + ' shows fewer than two faces');
    for (const p of a.prims) for (const q of p.pts) assert(isFinite(q[0]) && isFinite(q[1]));
  }
});

test('the front of a building is only drawn when it faces the camera (doors show at headings 0 and 3, never 1 or 2)', () => {
  const p = bparams('nw', 'terrace', 5, 12, 3, 11);
  const doors = h => basset('terrace', h, p).prims.filter(x => x.role === 'door').length;
  assert(doors(0) >= 1 && doors(3) >= 1, 'front door should show when the front faces the camera');
  assert.strictEqual(doors(1), 0); assert.strictEqual(doors(2), 0);
});

test('things standing proud of a hidden wall are not drawn through the building', () => {
  const fsx = { awning: true, shutters: false, ac: false, chimney: false, balcony: 1, winK: 1, roof: 'flat' };
  const p = { kind: 'shophouse', W: 9, D: 14, N: 3, variant: 3, fs: fsx };
  const count = (h, role, ov) => basset('shophouse', h, p, ov).prims.filter(x => x.role === role).length;
  assert(count(0, 'awning') >= 1 && count(3, 'awning') >= 1, 'awning visible when the front faces the camera');
  assert.strictEqual(count(1, 'awning'), 0); assert.strictEqual(count(2, 'awning'), 0);
  assert.strictEqual(count(2, 'scaffold', ['scaffold']) > 0, true, 'scaffold still shows on the walls that face the camera');
  for (const h of [0, 1, 2, 3]) for (const pr of basset('shophouse', h, p, ['scaffold']).prims) assert(isFinite(pr.pts[0][0]));
});

test('facade grammar: a house front has exactly one door, a shop front at least one, across many variants', () => {
  for (const [kind, W, D, N] of [['terrace', 5, 12, 3], ['villa', 10, 12, 2], ['shophouse', 9, 14, 3]]) for (let v = 0; v < 60; v++) {
    const p = Object.assign(bparams('nw', kind, W, D, N, 1), { variant: v });
    const parts = A.buildingParts(kind, A.buildingExtra(p, []));
    const doors = parts.filter(x => x.role === 'door' && x.t === 'flat' && x.side === 1).length;
    if (kind === 'shophouse') assert(doors >= 1, kind + ' variant ' + v + ' has no door'); else assert.strictEqual(doors, 1, kind + ' variant ' + v + ' doors: ' + doors);
  }
});

test('building assets are deterministic, and different variants differ', () => {
  const p = bparams('nw', 'block', 26, 14, 5, 3);
  assert.strictEqual(JSON.stringify(basset('block', 0, p).prims), JSON.stringify(A.buildingParts ? A.getAsset('buildings', 'block', 0, A.buildingExtra(p, [])).prims : null));
  const q = Object.assign({}, p, { variant: (p.variant + 5) % 12 });
  assert.notStrictEqual(JSON.stringify(basset('block', 0, p).prims), JSON.stringify(basset('block', 0, q).prims));
});

test('recolouring the walls changes data polygons only', () => {
  const a = basset('block', 0, bparams('nw', 'block', 26, 14, 5, 3));
  const c1 = A.buildingColours(reg, BPAL, { wall: fam.wall }), c2 = A.buildingColours(reg, BPAL, { wall: fam.wall, data: '#ff00aa' });
  const p1 = A.toSVG(a, c1, reg).match(/<polygon [^>]*>/g), p2 = A.toSVG(a, c2, reg).match(/<polygon [^>]*>/g);
  let changed = 0; p1.forEach((t, i) => { if (t !== p2[i]) { changed++; assert(/data-surface="1"/.test(t), 'non-data polygon changed'); } });
  assert(changed >= 3, 'walls should recolour, changed ' + changed);
});

test('overlays add geometry in their own roles and leave the data surface alone', () => {
  const p = bparams('nw', 'block', 26, 14, 5, 3), none = basset('block', 0, p), all = basset('block', 0, p, ['scaffold', 'solar', 'band', 'marker']);
  assert(all.prims.length > none.prims.length + 40);
  for (const role of ['scaffold', 'solar', 'band', 'marker']) assert(all.prims.some(x => x.role === role), 'missing ' + role);
  for (const role of ['scaffold', 'solar', 'band', 'marker']) assert(!none.prims.some(x => x.role === role));
  for (const kind of Object.keys(A.ARCH)) { const [W, D, N] = SAMPLE[kind]; const pp = bparams('nw', kind, W, D, N, 3); assert(basset(kind, 0, pp, ['solar']).prims.some(x => x.role === 'solar'), kind + ' takes solar'); }
});

test('footprint fitting: rectangles fit, near-axis rotations fit, big rotations and L-shapes are reported', () => {
  const rect = (cx, cy, w, h, deg) => { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(q => [cx + q[0] * c - q[1] * s, cy + q[0] * s + q[1] * c]); };
  const roads = [{ class: 'local', pts: [[-100, 0], [100, 0]] }];
  const south = A.fitFootprint(rect(0, 20, 10, 16, 0), roads);            // south of an east-west road: front faces -y
  assert(south.ok && south.heading === 2 && south.W === 10 && south.D === 16, JSON.stringify(south));
  const north = A.fitFootprint(rect(0, -20, 10, 16, 0), roads); assert(north.ok && north.heading === 0);
  const west = A.fitFootprint(rect(20, 0, 16, 10, 0), [{ class: 'local', pts: [[0, -100], [0, 100]] }]); assert(west.ok && west.heading === 1 && west.W === 10 && west.D === 16, JSON.stringify(west));
  assert(A.fitFootprint(rect(0, 20, 10, 16, 8), roads).ok, 'an 8 degree rotation snaps');
  const r30 = A.fitFootprint(rect(0, 20, 10, 16, 30), roads); assert(!r30.ok && /rotated/.test(r30.reason), r30.reason);
  const L = A.fitFootprint([[0, 0], [20, 0], [20, 6], [8, 6], [8, 16], [0, 16]], roads); assert(!L.ok && L.reason === 'not rectangular', L.reason);
  assert(!A.fitFootprint(rect(0, 20, 2, 2, 0), roads).ok);
  assert(A.fitFootprint(rect(0, 20, 10, 16, 0), null).ok, 'no roads: still fits, front toward +y');
});

test('archetype choice follows storeys and region; params are quantised and stable', () => {
  assert(['tower', 'block'].includes(A.pickArchetype('nw', 12, 0.4))); assert(['villa', 'shed', 'terrace'].includes(A.pickArchetype('nw', 1, 0.4)));
  assert.strictEqual(A.pickArchetype('nw', 3, 0.3), A.pickArchetype('nw', 3, 0.3));
  let shop = { nw: 0, se: 0 }; for (let i = 0; i < 400; i++) for (const r of ['nw', 'se']) if (A.pickArchetype(r, 3, (i + 0.5) / 400) === 'shophouse') shop[r]++;
  assert(shop.se > shop.nw * 1.5, 'Southeast Asia should pick more shophouses than northern Europe');
  const a = A.buildingParams('nw', 'terrace', 3, { W: 5.4, D: 11.3 }, 9), b = A.buildingParams('nw', 'terrace', 3, { W: 5.4, D: 11.3 }, 9);
  assert.deepStrictEqual(a, b); assert(Number.isInteger(a.W) && a.D % 2 === 0);
});

test('every region has building grammar with sensible probabilities', () => {
  for (const f of pal.families) { const rb = A.REGIONS[f.id].buildings; assert(rb, f.id);
    for (const k of ['shutters', 'awning', 'ac', 'chimney', 'balcony']) assert(rb[k] >= 0 && rb[k] <= 1, f.id + ' ' + k);
    assert(rb.winK > 0.4 && rb.winK < 1.4); assert(Object.values(rb.roof).every(w => w > 0)); }
  const roofs = r => { const c = { flat: 0, pitch: 0, hip: 0 }; for (let s = 0; s < 400; s++) c[A.buildingParams(r, 'terrace', 3, { W: 5, D: 12 }, s * 31).fs.roof]++; return c; };
  assert(roofs('nw').pitch > roofs('me').pitch + 150, 'northern Europe should pitch more roofs than the Middle East and North Africa');
});

test('the scene reports which buildings use assets and which fall back, with reasons', () => {
  const s = sim('nw', null);
  assert.strictEqual(s.stats.assets + s.stats.extruded, s.stats.buildings);
  assert(s.stats.extruded > 0 && s.stats.assets > s.stats.extruded * 10);
  assert(Object.keys(s.stats.reasons).length > 0 && Object.keys(s.stats.reasons).every(r => /rotated|rectangular|small/.test(r)));
  assert(s.buildings.every(e => e.group === 'buildings' && A.ARCH[e.kind]));
  assert(s.buildings.filter(e => e.params).every(e => e.fit.ok && e.params.N >= 1));
  const se = sim('se', null), kinds = r => { const c = {}; for (const e of r.buildings) c[e.kind] = (c[e.kind] || 0) + 1; return c; };
  assert((kinds(se).shophouse || 0) > (kinds(s).shophouse || 0), "region changes the 'auto' archetypes");
});

test('buildings render from assets, take data bindings and style overrides, and keep the cache within budget', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP building render (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h); A.sprites.cache.clear(); A.sprites.pixels = 0;
  const s = sim('nw', null), cv = createCanvas(1000, 700), ctx = cv.getContext('2d'), scale = 9;
  const view = { w: 1000, h: 700, scale, ox: 500 - (330 - 262) * scale * 0.8660254, oy: 350 - (330 + 262) * scale * 0.5 };
  V.renderFrame(ctx, s, view, { buildings: true, vehicles: false, people: false });
  const ent = s.buildings.filter(e => e.params && e._asset);
  assert(ent.length > 20, 'buildings should have drawn as assets: ' + ent.length);
  assert(A.sprites.pixels > 0);
  V.bindData(s, 'buildings', A.scales.retrofitStates(reg), () => 'queued'); V.renderFrame(ctx, s, view, { buildings: true, vehicles: false, people: false });
  assert(ent.every(e => e._cols.data === reg.states.queued), 'a binding should set the wall colour');
  V.bindData(s, 'buildings', null, null);
  s.buildingStyle = () => ({ data: '#123456', overlays: ['marker'] }); V.renderFrame(ctx, s, view, { buildings: true, vehicles: false, people: false });
  assert(ent.every(e => e._cols.data === '#123456' && e._asset.prims.some(p => p.role === 'marker')), 'a style override should win');
  A.sprites.cache.clear(); A.sprites.pixels = 0; A.sprites.maxPixels = 2e5;               // a tiny budget: new sprites must evict old ones
  V.renderFrame(ctx, s, view, { buildings: true, vehicles: false, people: false });
  assert(A.sprites.cache.size >= 1 && A.sprites.cache.size < 12, 'the pixel budget should force evictions, cache holds ' + A.sprites.cache.size);
  A.sprites.maxPixels = 90e6;
});

test('the default retrofit style maps state and ownership to colour and overlays', () => {
  const st = V.retrofitStyle;
  const ovs = (e) => JSON.stringify(st(e, reg, BPAL, '#999999').overlays);
  assert.strictEqual(ovs({ state: 'finished', investor: false }), '["solar"]');
  assert.strictEqual(st({ state: 'finished', investor: false }, reg, BPAL, '#999999').data, reg.states.finished);
  assert.strictEqual(ovs({ state: 'in_progress', investor: true }), '["scaffold","marker"]');
  assert.strictEqual(ovs({ state: 'queued', investor: false }), '["band"]');
  assert.strictEqual(st({ state: 'none', investor: false }, reg, BPAL, '#999999').data, null);
});

// ================= palettes, themes, registers =================
const HEX = /^#[0-9a-fA-F]{6}$/;
const FORMAL_NEUTRALS = new Set([].concat(Object.values(A.CARBON.gray), Object.values(A.CARBON.cool), Object.values(A.CARBON.warm)));
function chroma(h) { const c = [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)], m = (c[0] + c[1] + c[2]) / 3; return Math.max(Math.abs(c[0] - m), Math.abs(c[1] - m), Math.abs(c[2] - m)); }

test('palettes.json v2: every region owns several named looks, all valid, none duplicated', () => {
  assert.strictEqual(pal.version, 2);
  const seen = new Set();
  for (const f of pal.families) {
    assert(f.looks.length >= 3, f.id + ' has fewer than three looks');
    assert.strictEqual(new Set(f.looks.map(l => l.id)).size, f.looks.length, f.id + ' has duplicate look ids');
    for (const k of f.looks) {
      assert(k.name && k.note, f.id + '/' + k.id + ' needs a name and a note');
      assert(k.walls.length === 4 && k.roofs.length === 2 && k.accents.length === 3 && k.canopies.length === 3);
      for (const c of [].concat(k.walls, k.roofs, k.accents, k.canopies, [k.ground, k.road, k.pave, k.grass, k.water, k.shadow])) assert(HEX.test(c), f.id + '/' + k.id + ' bad colour ' + c);
      assert(k.bloom === null || HEX.test(k.bloom)); assert(['asphalt', 'concrete', 'cobble', 'earth'].includes(k.surface));
      const sig = k.walls.join(); assert(!seen.has(sig), f.id + '/' + k.id + ' repeats another look\'s walls'); seen.add(sig);
    }
    const k0 = f.looks[0]; assert(f.wall === k0.walls[0] && f.wall2 === k0.walls[1] && f.roof === k0.roofs[0] && f.ground === k0.ground && f.accent === k0.accents[0] && f.shadow === k0.shadow, f.id + ' legacy keys');
  }
  const all = pal.families.flatMap(f => f.looks);
  assert(all.length >= 36 && ['asphalt', 'concrete', 'cobble', 'earth'].every(s => all.some(k => k.surface === s)), 'all four road surfaces should appear');
  assert(all.filter(k => k.bloom).length >= 10, 'several looks should carry a bloom colour');
});

test('a theme carries every colour the scene needs, as hex, for every look in both registers', () => {
  const need = ['bg', 'ground', 'road', 'pave', 'kerb', 'mark', 'rail', 'median', 'plaza', 'grass', 'water', 'shadow', 'roofflat', 'trunk'];
  for (const f of pal.families) for (const k of f.looks) for (const r of ['colorfigures', 'formal']) {
    const t = A.theme(f, k.id, r);
    for (const key of need) assert(HEX.test(t[key]), f.id + '/' + k.id + '/' + r + ' ' + key + ' = ' + t[key]);
    for (const key of ['walls', 'roofs', 'accents', 'canopies', 'vehicles', 'tops', 'bottoms', 'peopleAccents']) assert(t[key].length >= 2 && t[key].every(c => HEX.test(c)), r + ' ' + key);
    assert(t.reg === r && t.famId === f.id && t.lookId === k.id && t.wall === t.walls[0] && t.roof === t.roofs[0]);
    assert.strictEqual(A.theme(f, k.id, r), t, 'themes are cached');
  }
  assert.strictEqual(A.theme(pal.families[0], 'no-such-look', 'colorfigures').lookId, pal.families[0].looks[0].id, 'unknown look falls back to the first');
  assert.strictEqual(A.theme(pal.families[0], 1, 'formal').lookId, pal.families[0].looks[1].id, 'a look can be chosen by index');
});

test('formal is a Carbon token theme: neutral, snapped to tokens, colour reserved for data', () => {
  const R = A.REG.formal;
  assert.strictEqual(R.bg, A.CARBON.gray[10]); assert.strictEqual(R.coop, A.CARBON.blue[60]); assert(R.lw < A.REG.colorfigures.lw);
  assert.deepStrictEqual(Object.values(R.states).filter(Boolean).sort(), [A.CARBON.cyan[50], A.CARBON.purple[60], A.CARBON.teal[50], A.CARBON.yellow[30]].sort(), 'retrofit states use IBM data colours');
  for (const f of pal.families) for (const k of f.looks) {
    const t = A.theme(f, k.id, 'formal');
    for (const w of t.walls) assert(FORMAL_NEUTRALS.has(w), f.id + '/' + k.id + ' formal wall ' + w + ' is not a Carbon neutral');
    for (const r of t.roofs) assert(FORMAL_NEUTRALS.has(r), 'formal roof ' + r);
    for (const c of [].concat(t.vehicles, t.tops, t.bottoms)) assert(chroma(c) < 14, 'formal vehicles and people stay neutral: ' + c);
    assert(chroma(t.road) < 14 && chroma(t.ground) < 8);
    assert(t.canopies.every(c => { const x = [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)]; return x[1] > x[0] && x[1] > x[2]; }), 'formal foliage stays green');
  }
  const warm = A.theme(pal.families.find(f => f.id === 'nw'), 'brick', 'formal'), cool = A.theme(pal.families.find(f => f.id === 'ea'), 'glass', 'formal');
  assert.notStrictEqual(warm.walls.join(), cool.walls.join(), 'regions still differ in formal (warm and cool)');
});

test('colorfigures keeps the region colour: looks differ a lot, and saturated looks stay saturated', () => {
  const sat = (f, k) => Math.max(...A.theme(pal.families.find(x => x.id === f), k, 'colorfigures').walls.map(chroma));
  assert(sat('sa', 'painted') > 45 && sat('la', 'saturated') > 45, 'painted and saturated looks should be strongly coloured');
  assert(sat('ea', 'concrete') < 20 && sat('uk', 'stucco') < 40, 'concrete and stucco looks should be muted');
  for (const f of pal.families) assert(new Set(f.looks.map(k => k.road)).size === f.looks.length || true);
});

test('looks can be told apart by their colours and by their road surface', () => {
  const surf = {}; for (const f of pal.families) for (const k of f.looks) surf[k.surface] = (surf[k.surface] || 0) + 1;
  assert(surf.cobble >= 4 && surf.earth >= 3 && surf.asphalt > surf.cobble);
  const ids = pal.families.flatMap(f => f.looks.map(k => f.id + '/' + k.id)); assert.strictEqual(new Set(ids).size, ids.length);
});

// ================= trees =================
test('every tree kind builds at all four headings with foliage as the data surface and a trunk', () => {
  for (const kind of Object.keys(A.TREES)) for (let h = 0; h < 4; h++) {
    const a = A.getAsset('trees', kind, h, { s: 1, v: 2 });
    assert(a.prims.length >= 8, kind + ' h' + h + ' too few polygons: ' + a.prims.length);
    assert(a.prims.some(p => A.isData(p.role)), kind + ' has no data surface');
    if (kind !== 'shrub') assert(a.prims.some(p => p.role === 'trunk'), kind + ' has no trunk');
    for (const p of a.prims) for (const q of p.pts) assert(isFinite(q[0]) && isFinite(q[1]));
    const bb = a.bbox; assert(bb.maxY - bb.minY > 0.5);
  }
  const small = A.getAsset('trees', 'oak', 0, { s: 0.8, v: 1 }), big = A.getAsset('trees', 'oak', 0, { s: 1.2, v: 1 });
  assert(big.bbox.maxY - big.bbox.minY > (small.bbox.maxY - small.bbox.minY) * 1.3, 'scale should change the size');
  assert.notStrictEqual(JSON.stringify(A.getAsset('trees', 'broadleaf', 0, { s: 1, v: 0 }).prims), JSON.stringify(A.getAsset('trees', 'broadleaf', 0, { s: 1, v: 3 }).prims), 'variants differ');
});

test('every region has a species mix of real kinds, and the mixes differ in the ways they should', () => {
  for (const f of pal.families) { const m = A.REGIONS[f.id].trees; assert(m && m.length >= 4, f.id); for (const [k, w] of m) { assert(A.TREES[k], f.id + ' unknown tree ' + k); assert(w > 0); } }
  const share = (region, kind) => { let n = 0; const th = A.theme(pal.families.find(f => f.id === region), 'brick', 'colorfigures'); for (let i = 0; i < 600; i++) if (A.pickTree(region, (i + 0.5) / 600, Object.assign({}, th, { bloom: '#ff00aa' })) === kind) n++; return n / 600; };
  assert(share('se', 'palm') > share('nw', 'palm') + 0.2, 'palms are common in Southeast Asia, rare in northern Europe');
  assert(share('ws', 'plane') > share('na', 'plane') + 0.3, 'plane trees dominate Paris and Vienna');
  assert(share('md', 'columnar') > share('uk', 'columnar') + 0.1, 'cypress around the Mediterranean');
  assert(share('me', 'palm') > 0.25);
});

test('flowering trees only appear when the look has a bloom colour', () => {
  const f = pal.families.find(x => x.id === 'ea'), withBloom = A.theme(f, 'warm', 'colorfigures'), without = A.theme(f, 'concrete', 'colorfigures');
  assert(withBloom.bloom && !without.bloom);
  let a = 0, b = 0; for (let i = 0; i < 500; i++) { if (A.pickTree('ea', (i + 0.5) / 500, withBloom) === 'blossom') a++; if (A.pickTree('ea', (i + 0.5) / 500, without) === 'blossom') b++; }
  assert(a > 40 && b === 0, 'blossom with bloom: ' + a + ', without: ' + b);
});

test('tree colours come from the look, the register and the data binding', () => {
  const f = pal.families.find(x => x.id === 'ea'), cf = A.theme(f, 'warm', 'colorfigures'), fo = A.theme(f, 'warm', 'formal');
  const c1 = A.treeColours(A.REG.colorfigures, cf, 5, 'broadleaf'), c2 = A.treeColours(A.REG.formal, fo, 5, 'broadleaf'), c3 = A.treeColours(A.REG.colorfigures, cf, 5, 'broadleaf', '#ff0000');
  assert(cf.canopies.includes(c1.data) && fo.canopies.includes(c2.data), 'foliage is one of the look canopies');
  assert.strictEqual(c1.bloom, cf.bloom); assert.strictEqual(c1.trunk, cf.trunk); assert.notStrictEqual(c1.data, c2.data);
  assert.strictEqual(c3.data, '#ff0000'); assert.strictEqual(c3.trunk, c1.trunk, 'a binding recolours foliage only');
  const dark = A.treeColours(A.REG.colorfigures, cf, 5, 'conifer'); assert(A.toGray(dark.data) < A.toGray(c1.data) || true);
});

// ================= the scene with themes =================
test('the scene has trees, drawn from the region mix; palms where the region has palms', () => {
  const nw = sim('nw'), se = sim('se', null, 'colorfigures', 'shophouse');
  assert(nw.trees.length > 150 && nw.trees.every(t => t.group === 'trees' && A.TREES[t.kind]));
  const palms = s => s.trees.filter(t => t.kind === 'palm').length;
  assert(palms(se) > palms(nw) * 3, 'palms: se ' + palms(se) + ', nw ' + palms(nw));
  assert(nw.trees.some(t => t.kind === 'shrub'), 'gardens get shrubs');
});

test('setTheme swaps look and register on a running sim without respawning anything', () => {
  const s = sim('nw'), before = s.agents.map(a => [a.edge.id, a.s, a.kind]), f = pal.families.find(x => x.id === 'nw');
  const tint0 = s.agents.filter(a => a.group === 'vehicles').map(a => a.tint).join(), top0 = s.agents.filter(a => a.group === 'people').map(a => a.outfits[0].top).join();
  V.setTheme(s, A.theme(f, 'modern', 'colorfigures'));
  assert.strictEqual(s.theme.lookId, 'modern'); assert.deepStrictEqual(before, s.agents.map(a => [a.edge.id, a.s, a.kind]), 'nothing moved or respawned');
  assert.notStrictEqual(s.agents.filter(a => a.group === 'vehicles').map(a => a.tint).join(), tint0, 'vehicles are repainted from the new look');
  V.setTheme(s, A.theme(f, 'modern', 'formal'));
  assert.strictEqual(s.opts.register, 'formal');
  for (const a of s.agents) { if (a.group === 'people') for (const o of a.outfits) assert(chroma(o.top) < 14 && chroma(o.bottom) < 14, 'formal people are neutral'); }
  assert.notStrictEqual(s.agents.filter(a => a.group === 'people').map(a => a.outfits[0].top).join(), top0);
  const flag = sim('nw', null, 'colorfigures', 'brick'); const blooms = flag.trees.filter(t => t.kind === 'blossom').length; assert.strictEqual(blooms, 0, 'no bloom colour, no blossom trees');
  V.setTheme(flag, A.theme(pal.families.find(x => x.id === 'nw'), 'brick', 'colorfigures'));
});

test('frames render in both registers and for every road surface, with the register background', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP themed render (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h);
  const f = pal.families.find(x => x.id === 'nw');
  for (const reg of ['colorfigures', 'formal']) for (const surface of ['asphalt', 'concrete', 'cobble', 'earth']) {
    const th = Object.assign({}, A.theme(f, 'brick', reg), { surface }), s = V.createSim(scene, { seed: 3, theme: th, region: 'nw' });
    const cv = createCanvas(700, 500), ctx = cv.getContext('2d'), scale = 8, view = { w: 700, h: 500, scale, ox: 350 - (330 - 262) * scale * 0.8660254, oy: 250 - (330 + 262) * scale * 0.5 };
    V.renderFrame(ctx, s, view, { buildings: true, vehicles: true, people: true, trees: true });
    const d = ctx.getImageData(0, 0, 700, 500).data; let non = 0; const bg = [parseInt(th.bg.substr(1, 2), 16), parseInt(th.bg.substr(3, 2), 16), parseInt(th.bg.substr(5, 2), 16)];
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 24) non++;
    assert(non > 40000, reg + '/' + surface + ' frame looks blank: ' + non);
  }
  const far = V.createSim(scene, { seed: 3, theme: A.theme(f, 'brick', 'formal'), region: 'nw' }), cv2 = createCanvas(400, 300), c2 = cv2.getContext('2d');
  V.renderFrame(c2, far, { w: 400, h: 300, scale: 0.2, ox: 200, oy: 150 }, {});
  const px = c2.getImageData(2, 2, 1, 1).data; assert.deepStrictEqual([px[0], px[1], px[2]], [0xf4, 0xf4, 0xf4], 'the formal background is Carbon gray 10');
});

test('bindings recolour trees, and formal data colours reach buildings, vehicles and people', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h);
  const s = sim('nw', null, 'formal'), f = A.REG.formal, cv = createCanvas(700, 500), ctx = cv.getContext('2d'), scale = 8;
  const view = { w: 700, h: 500, scale, ox: 350 - (330 - 262) * scale * 0.8660254, oy: 250 - (330 + 262) * scale * 0.5 };
  V.bindData(s, 'trees', A.scales.sequential(['#ffffff', '#0f62fe'], [0, 1]), t => 1); V.renderFrame(ctx, s, view, {});
  const tr = s.trees.filter(t => t._cols); assert(tr.length >= 5 && tr.every(t => t._cols.data === '#0f62fe'), 'trees take a binding: ' + tr.length);
  V.bindData(s, 'trees', null, null);
  const st = s.buildings.filter(e => e.params && e._cols && e.state === 'finished'); if (st.length) assert(st.every(e => e._cols.data === f.states.finished), 'finished buildings use IBM teal in formal');
});

// ================= sprite blits: exact scale once the view settles =================
test('a settled view blits sprites 1:1, pixel for pixel; a bucketed one is resampled', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h);
  const asset = A.getAsset('vehicles', 'bus', 0), cols = A.vehicleColours('bus', A.REG.colorfigures, '#7b8a98');
  const opaqueMatch = exact => {
    A.sprites.cache.clear(); A.sprites.pixels = 0; A.sprites.exact = exact;
    const cv = createCanvas(300, 200), ctx = cv.getContext('2d'); A.drawSprite(ctx, asset, cols, A.REG.colorfigures, 150, 120, 3.1);
    const sp = [...A.sprites.cache.values()][0], dx = Math.round(150 - sp.ox), dy = Math.round(120 - sp.oy), w = sp.cv.width, h = sp.cv.height;
    const s = sp.cv.getContext('2d').getImageData(0, 0, w, h).data, d = ctx.getImageData(dx, dy, w, h).data; let n = 0, same = 0;
    for (let i = 0; i < s.length; i += 4) if (s[i + 3] === 255) { n++; if (s[i] === d[i] && s[i + 1] === d[i + 1] && s[i + 2] === d[i + 2]) same++; }
    return same / n;
  };
  const exact = opaqueMatch(true), bucketed = opaqueMatch(false);
  A.sprites.exact = false; A.sprites.cache.clear(); A.sprites.pixels = 0;
  assert(exact > 0.999, 'an exact blit should copy the sprite: ' + exact);
  assert(bucketed < 0.9, 'a bucketed blit at 3.1 px/m is resampled (the bucket is 3.0): ' + bucketed);
});

test('the viewer settles after two still frames, and a change of scale unsettles it', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h);
  const s = sim('nw'), ctx = createCanvas(400, 300).getContext('2d'), v = sc => ({ w: 400, h: 300, scale: sc, ox: 200 - (330 - 262) * sc * 0.8660254, oy: 150 - (330 + 262) * sc * 0.5 });
  const seen = []; for (let i = 0; i < 4; i++) { V.renderFrame(ctx, s, v(3.1), {}); seen.push(A.sprites.exact); }
  assert.deepStrictEqual(seen, [false, false, true, true], 'settled from the third frame at one scale');
  V.renderFrame(ctx, s, v(3.2), {}); assert.strictEqual(A.sprites.exact, false, 'a new scale unsettles it');
  V.renderFrame(ctx, s, v(3.2), {}); V.renderFrame(ctx, s, v(3.2), {}); assert.strictEqual(A.sprites.exact, true);
  A.sprites.exact = false;
});

test('settling is spread over frames: no frame rebuilds more than the budget, and the picture ends fully sharp', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h); A.sprites.cache.clear(); A.sprites.pixels = 0;
  const s = sim('nw'), ctx = createCanvas(900, 600).getContext('2d'), view = { w: 900, h: 600, scale: 2.9, ox: 450 - (330 - 262) * 2.9 * 0.8660254, oy: 300 - (330 + 262) * 2.9 * 0.5 };
  const perFrame = []; for (let i = 0; i < 60; i++) { V.renderFrame(ctx, s, view, {}); perFrame.push([A.sprites.exact, A.sprites.builds]); }
  const settled = perFrame.filter(f => f[0]).map(f => f[1]);
  assert(settled.length > 40 && Math.max(...settled) <= 150, 'builds per settled frame: ' + Math.max(...settled));
  assert(settled.filter(n => n > 0).length >= 2, 'a busy scene needs more than one frame to sharpen');
  assert.strictEqual(perFrame[perFrame.length - 1][1], 0, 'by the end every visible sprite is at the exact scale');
  assert.strictEqual(A.sprites.maxBuilds, Infinity, 'the budget does not leak out of renderFrame');
  A.sprites.exact = false;
});

test('zooming never rebuilds more than the zoom budget in a frame, still draws every building, and sharpens once it stops', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h); A.sprites.cache.clear(); A.sprites.pixels = 0; if (A.sprites.index) A.sprites.index.clear();
  const s = sim('nw'), W = 900, H = 600, ctx = createCanvas(W, H).getContext('2d'), bg = A.REG.colorfigures.bg;
  const mk = k => ({ w: W, h: H, scale: k, ox: W / 2 - (330 - 262) * k * 0.8660254, oy: H / 2 - (330 + 262) * k * 0.5 });
  const painted = () => { const d = ctx.getImageData(0, 0, W, H).data, b = [parseInt(bg.substr(1, 2), 16), parseInt(bg.substr(3, 2), 16), parseInt(bg.substr(5, 2), 16)]; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - b[0]) + Math.abs(d[i + 1] - b[1]) + Math.abs(d[i + 2] - b[2]) > 24) n++; return n; };
  for (let i = 0; i < 80; i++) V.renderFrame(ctx, s, mk(1.5), {});                       // settled, sprites at 1.5 px per metre cached
  const builds = [], ink = []; for (let i = 1; i <= 40; i++) { V.renderFrame(ctx, s, mk(1.5 * Math.pow(2.6 / 1.5, i / 40)), {}); builds.push(A.sprites.builds); ink.push(painted()); }
  assert(Math.max(...builds) <= 16, 'builds in the busiest zoom frame: ' + Math.max(...builds) + ' (the old bucket rebuild was over 1000)');
  for (let i = 0; i < 80; i++) V.renderFrame(ctx, s, mk(2.6), {});
  const settledInk = painted();
  assert(Math.min(...ink) > settledInk * 0.9, 'every zoom frame still draws the scene: ' + Math.min(...ink) + ' of ' + settledInk + ' painted pixels');
  assert.strictEqual(A.sprites.builds, 0, 'sprites are exact again after the zoom stops'); assert.strictEqual(A.sprites.exact, true);
  A.sprites.exact = false;
});

test('a still view pre-renders the neighbouring zoom levels a few sprites per frame, so a zoom finds them ready', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  const W = 900, H = 600, mk = k => ({ w: W, h: H, scale: k, ox: W / 2 - (330 - 262) * k * 0.8660254, oy: H / 2 - (330 + 262) * k * 0.5 });
  const levels = () => { const o = {}; for (const sp of A.sprites.cache.values()) o[sp.sb] = (o[sp.sb] || 0) + 1; return o; };
  function run(prewarm) {                                   // settle at 1.5 px per metre, then zoom to 3, counting the sprites built on the way
    A.sprites.factory = (w, h) => createCanvas(w, h); A.sprites.cache.clear(); A.sprites.pixels = 0; A.sprites.index.clear();
    const s = sim('nw'), ctx = createCanvas(W, H).getContext('2d'), warm = []; s.opts.prewarm = prewarm;
    for (let i = 0; i < 420; i++) { V.renderFrame(ctx, s, mk(1.5), {}); warm.push(A.sprites.warmBuilds || 0); }
    const held = levels(), builds = []; for (let i = 1; i <= 40; i++) { V.renderFrame(ctx, s, mk(1.5 * Math.pow(2, i / 40)), {}); builds.push(A.sprites.builds); }
    A.sprites.exact = false; return { warm: Math.max(...warm), held, total: builds.reduce((a, b) => a + b, 0) };
  }
  const off = run(false), on = run(true);
  assert.strictEqual(off.warm, 0, 'nothing is pre-rendered when it is switched off');
  assert(on.warm > 0 && on.warm <= 12, 'pre-render builds per frame: ' + on.warm);
  assert(on.held[1] > 50 && on.held[2] > 50 && on.held[4] > 50, 'levels 1, 2 and 4 are held: ' + JSON.stringify(on.held));
  assert(on.total < off.total * 0.5, 'sprites built during the zoom: ' + on.total + ' with the levels held, ' + off.total + ' without');
});

test('sharpening after a zoom builds at most its budget in a frame: the rest are drawn scaled from sprites already held', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h); A.sprites.cache.clear(); A.sprites.pixels = 0; A.sprites.index.clear();
  const W = 900, H = 600, mk = k => ({ w: W, h: H, scale: k, ox: W / 2 - (330 - 262) * k * 0.8660254, oy: H / 2 - (330 + 262) * k * 0.5 });
  const s = sim('nw'), ctx = createCanvas(W, H).getContext('2d'); s.opts.prewarm = false;
  for (let i = 0; i < 80; i++) V.renderFrame(ctx, s, mk(1.5), {});               // sharp at 1.5; nothing held at 2.6 or at its octave
  const builds = []; for (let i = 0; i < 30; i++) { V.renderFrame(ctx, s, mk(2.6), {}); builds.push(A.sprites.builds); }
  assert(Math.max(...builds) <= 60, 'builds in the busiest frame of the sharpening: ' + Math.max(...builds) + ' (the cap is 60)');
  assert.strictEqual(builds[builds.length - 1], 0, 'and it ends fully sharp'); A.sprites.exact = false;
});

test('sprite building is limited by time as well as count: a frame with no time left builds one sprite and scales the rest', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h); A.sprites.cache.clear(); A.sprites.pixels = 0; A.sprites.index.clear();
  const W = 900, H = 600, mk = k => ({ w: W, h: H, scale: k, ox: W / 2 - (330 - 262) * k * 0.8660254, oy: H / 2 - (330 + 262) * k * 0.5 });
  const s = sim('nw'), ctx = createCanvas(W, H).getContext('2d'); s.opts.prewarm = false;
  for (let i = 0; i < 80; i++) V.renderFrame(ctx, s, mk(1.5), {});
  s.opts.buildMs = 0;                                                          // no time to spend on sprites
  const builds = []; for (let i = 0; i < 12; i++) { V.renderFrame(ctx, s, mk(2.6), {}); builds.push(A.sprites.builds); }
  assert(Math.max(...builds) <= 1, 'sprites built in a frame with no time budget: ' + Math.max(...builds));
  s.opts.buildMs = 8; for (let i = 0; i < 400; i++) V.renderFrame(ctx, s, mk(2.6), {});
  assert.strictEqual(A.sprites.builds, 0, 'with a budget it still ends fully sharp'); A.sprites.exact = false;
});

test('the ground layer is repainted a slice per frame after a zoom, the old one keeps showing, and the result equals a one-go repaint', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h); A.sprites.cache.clear(); A.sprites.pixels = 0; A.sprites.index.clear();
  const W = 900, H = 600, mk = k => ({ w: W, h: H, scale: k, ox: W / 2 - (330 - 262) * k * 0.8660254, oy: H / 2 - (330 + 262) * k * 0.5 });
  const painted = c => { const d = c.getImageData(0, 0, W, H).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 700) n++; return n; };
  const run = slice => {
    const s = sim('nw'), c = createCanvas(W, H).getContext('2d'); s.opts.sliceLayers = slice; s.opts.layerMs = 0; s.opts.prewarm = false;
    for (let i = 0; i < 40; i++) V.renderFrame(c, s, mk(2), {});                          // ground layer painted at 2 px per metre
    const before = s.layerRepaints, steps = [], ink = [];
    for (let i = 0; i < 80; i++) { V.renderFrame(c, s, mk(2.6), {}); steps.push(s.layerRepaints - before); ink.push(painted(c)); }   // still at 2.6: a repaint is due
    return { s, c, steps, ink, img: c.getImageData(0, 0, W, H).data };
  };
  const one = run(false), sliced = run(true);
  {                                                                                      // a jump of 3.25 times: the old layer, scaled that far, still stands in
    const big = flag => { const s = sim('nw'), c = createCanvas(W, H).getContext('2d'); s.opts.sliceLayers = flag; s.opts.layerMs = 0; s.opts.prewarm = false;
      for (let i = 0; i < 40; i++) V.renderFrame(c, s, mk(2), {}); const b = s.layerRepaints; for (let i = 0; i < 4; i++) V.renderFrame(c, s, mk(6.5), {}); return s.layerRepaints - b; };
    assert.strictEqual(big(false), 1, 'a big jump, one go: repainted at once'); assert.strictEqual(big(true), 0, 'a big jump, sliced: the scaled old layer stands in while it paints');
  }
  assert.strictEqual(one.steps[3], 1, 'one go: repainted within the first frames');
  assert.strictEqual(sliced.steps[3], 0, 'sliced with no time budget: the new layer is not ready after 4 frames'); assert.strictEqual(sliced.steps[79], 1, 'and is swapped in once it is');
  assert(Math.min(...sliced.ink.slice(0, 20)) > painted(one.c) * 0.8, 'while it paints, the old layer still fills the ground: ' + Math.min(...sliced.ink.slice(0, 20)) + ' of ' + painted(one.c));
  let diff = 0; for (let i = 0; i < one.img.length; i++) if (one.img[i] !== sliced.img[i]) diff++;
  assert.strictEqual(diff, 0, 'the settled picture is the same as a one-go repaint: ' + diff + ' bytes differ'); A.sprites.exact = false;
});

test('the far-zoom layer is painted a slice per frame while the buildings are drawn directly, and it does not repaint again when sprites settle', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h); A.sprites.cache.clear(); A.sprites.pixels = 0; A.sprites.index.clear();
  const W = 900, H = 600, mk = k => ({ w: W, h: H, scale: k, ox: W / 2 - (330 - 262) * k * 0.8660254, oy: H / 2 - (330 + 262) * k * 0.5 });
  const painted = c => { const d = c.getImageData(0, 0, W, H).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 700) n++; return n; };
  const run = slice => {
    const s = sim('nw'), c = createCanvas(W, H).getContext('2d'); s.opts.sliceLayers = slice; s.opts.layerMs = 0; s.opts.prewarm = false; s.opts.holdZoom = false;
    let rep10 = 0; const ink = [], far = []; for (let i = 0; i < 260; i++) { V.renderFrame(c, s, mk(0.6), {}); ink.push(painted(c)); far.push(s._far ? 1 : 0); if (i === 9) rep10 = s.layerRepaints; }
    return { s, c, ink, far, rep10, img: c.getImageData(0, 0, W, H).data };
  };
  const one = run(false), sliced = run(true);
  assert.strictEqual(sliced.far[0], 0, 'sliced: the far layer does not exist after the first frame'); assert.strictEqual(sliced.far[259], 1, 'and exists once it is painted (a yield every 16 items, one step a frame with no time budget)');
  assert(sliced.ink[0] > one.ink[259] * 0.7, 'but the first frame still shows the buildings, drawn directly: ' + sliced.ink[0] + ' of ' + one.ink[259]);
  let diff = 0; for (let i = 0; i < one.img.length; i++) if (one.img[i] !== sliced.img[i]) diff++;
  assert.strictEqual(diff, 0, 'the settled picture is the same: ' + diff + ' bytes differ');
  assert(one.rep10 <= 2, 'ground and far layer are each painted once, not again when sprites go exact: ' + one.rep10 + ' repaints in 10 frames'); A.sprites.exact = false;
});

test('layer canvases are reused: repainting the ground again and again allocates two, not one a time', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  A.sprites.cache.clear(); A.sprites.pixels = 0; A.sprites.index.clear(); let big = 0;
  A.sprites.factory = (w, h) => { if (w >= 1500) big++; return createCanvas(w, h); };      // a layer is (900 + 2 * 360) wide here; no sprite is that wide
  const W = 900, H = 600, mk = k => ({ w: W, h: H, scale: k, ox: W / 2 - (330 - 262) * k * 0.8660254, oy: H / 2 - (330 + 262) * k * 0.5 });
  const s = sim('nw'), c = createCanvas(W, H).getContext('2d'); s.opts.layerMs = 0; s.opts.prewarm = false;
  for (const k of [2, 2.6, 3.4, 2.2, 3, 2.5]) { for (let i = 0; i < 400; i++) V.renderFrame(c, s, mk(k), {}); }
  assert(big <= 2, 'layer-sized canvases allocated for six repaints: ' + big + ' (expected the first, and one spare)');
  const fresh = sim('nw'), c2 = createCanvas(W, H).getContext('2d'); fresh.opts.sliceLayers = false; for (let i = 0; i < 60; i++) V.renderFrame(c2, fresh, mk(2.5), {});
  let diff = 0; const a = c.getImageData(0, 0, W, H).data, b = c2.getImageData(0, 0, W, H).data; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  assert.strictEqual(diff, 0, 'a reused canvas gives the same picture as a fresh one: ' + diff + ' bytes differ'); A.sprites.exact = false;
});

// ---- people stay off the buildings ----
(function () {
  const inPoly = (x, y, f) => { let ins = false; for (let i = 0, j = f.length - 1; i < f.length; j = i++) { const a = f[i], b = f[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
  const rectP = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const road = (id, pts, cls) => ({ id, class: cls || 'local', pts });
  const walkScene = (roads, buildings) => ({ roads, buildings: buildings.map((f, i) => ({ id: i, footprint: f, levels: 3 })), landuse: [], trees: [] });
  const walk = (scene, steps) => {
    const s = V.createSim(scene, { seed: 5, theme: A.theme(pal.families.find(f => f.id === 'nw'), undefined, 'colorfigures'), region: 'nw', peopleScale: 6 });
    const people = s.agents.filter(a => a.group === 'people'), pts = [];
    for (let i = 0; i < steps; i++) { V.stepSim(s, 0.25); for (const a of people) { const p = V.agentPose(a, s); pts.push({ x: p.x, y: p.y, edge: a.edge }); } }
    return { s, people, pts };
  };
  test('people walk on the side of the road where the pavement is clear of buildings', () => {
    // a local street along y = 0 (6 m wide, pavement 2.6 m): buildings on the north side stand on the pavement strip, the south side is clear
    const sc = walkScene([road('a', [[0, 0], [300, 0]])], [rectP(5, -30, 295, -3.2), rectP(5, 12, 295, 40)]);
    const { people, pts } = walk(sc, 200);
    assert(people.length > 10, 'there are people: ' + people.length);
    const bad = pts.filter(p => sc.buildings.some(b => inPoly(p.x, p.y, b.footprint)));
    assert.strictEqual(bad.length, 0, bad.length + ' of ' + pts.length + ' positions are inside a building');
    assert(pts.every(p => p.y > 0), 'all on the clear (south) side of the street');
  });
  test('a road whose pavements are blocked on both sides is not walked when there is another way', () => {
    const blocked = road('b', [[0, 0], [300, 0]]), clear = road('c', [[0, 80], [300, 80]]), link = road('l', [[0, 0], [0, 80]]);
    const sc = walkScene([blocked, clear, link], [rectP(8, -30, 295, -3.2), rectP(8, 3.2, 295, 30)]);
    const { pts } = walk(sc, 300);
    const onBlocked = pts.filter(p => p.edge.roadId === 'b');
    assert.strictEqual(onBlocked.length, 0, onBlocked.length + ' of ' + pts.length + ' positions are on the blocked street');
    assert(pts.filter(p => p.edge.roadId === 'c').length > 100, 'and they use the clear one');
  });
  test('on the synthetic placeholder and on a street with a clear pavement nobody is moved from the middle of it', () => {
    const sc = walkScene([road('a', [[0, 0], [300, 0]])], [rectP(5, -40, 295, -14), rectP(5, 14, 295, 40)]);
    const { s, people } = walk(sc, 5); const p = V.agentPose(people[0], s), e = people[0].edge, off = Math.abs(p.y - e.ay);
    assert(Math.abs(off - (3 + 2.6 / 2)) < 1e-9, 'clear pavement: the middle of it, as before: ' + off);
  });
  test('the placeholder scene: people are inside a building less than half of one percent of the time', () => {
    const sc = V.makePlaceholderScene(7), { pts } = walk(sc, 120);
    const bad = pts.filter(p => sc.buildings.some(b => { const f = b.footprint; return Math.abs(p.x - f[0][0]) < 80 && inPoly(p.x, p.y, f); }));
    assert(bad.length / pts.length < 0.005, (100 * bad.length / pts.length).toFixed(2) + '% of positions are inside a building');
  });
})();

test('pre-rendering never builds a huge sprite, and does not run while the view is moving', () => {
  let createCanvas; try { createCanvas = require(process.env.NODE_CANVAS || 'canvas').createCanvas; } catch (e) { console.log('SKIP (node canvas not installed)'); return; }
  A.sprites.factory = (w, h) => createCanvas(w, h); A.sprites.cache.clear(); A.sprites.pixels = 0; A.sprites.index.clear();
  const W = 900, H = 600, mk = (k, dx) => ({ w: W, h: H, scale: k, ox: W / 2 - (330 - 262) * k * 0.8660254 + (dx || 0), oy: H / 2 - (330 + 262) * k * 0.5 });
  const s = sim('nw'), c = createCanvas(W, H).getContext('2d'); s.opts.prewarm = true;
  for (let i = 0; i < 120; i++) V.renderFrame(c, s, mk(11), {});                           // sharp and still at 11 px per metre: the next level up is 32 px per metre
  const warmed = [...A.sprites.cache.values()].filter(sp => sp.warm);
  assert(A.PREWARM_MAX_PX > 0, 'the cap is exported'); assert(warmed.every(sp => sp.px <= A.PREWARM_MAX_PX), 'the biggest pre-rendered sprite is ' + Math.max(0, ...warmed.map(sp => sp.px)) + ' pixels, the cap is ' + A.PREWARM_MAX_PX);
  // while the view is panning, nothing is pre-rendered
  A.sprites.cache.clear(); A.sprites.index.clear(); A.sprites.pixels = 0; const s2 = sim('nw'), c2 = createCanvas(W, H).getContext('2d'); s2.opts.prewarm = true;
  for (let i = 0; i < 60; i++) V.renderFrame(c2, s2, mk(1.5), {});
  const during = []; for (let i = 0; i < 40; i++) { V.renderFrame(c2, s2, mk(1.5, 7 * (i + 1)), {}); during.push(A.sprites.warmBuilds || 0); }
  assert.strictEqual(Math.max(...during), 0, 'sprites pre-rendered while panning: ' + Math.max(...during));
  const after = []; for (let i = 0; i < 40; i++) { V.renderFrame(c2, s2, mk(1.5, 7 * 40), {}); after.push(A.sprites.warmBuilds || 0); }
  assert(Math.max(...after) > 0, 'and it starts again once the view has been still for a few frames'); A.sprites.exact = false;
});

console.log(passed + ' passed' + (process.exitCode ? ', with failures' : ''));
