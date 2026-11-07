/* R31 (issue paperdolls#14, reproduced): outline, halo, the selection halo, the visibility test, ground tint and ground marks are placed at ground height 0, while the building
 * (sprite or extrusion), its shadow and its ground are drawn at the building's terrain height e.z. On a hill the highlight floats below the building by z*scale px.
 * The real PackHost.bindRenderer / bindInteraction run in Node; the canvas is a recorder that keeps every moveTo/lineTo, so the vertices can be compared with where the building is drawn.
 * Run: PAPERDOLLS_NODE_MODULES=<node_modules> node docs/state-machines/repro/r31-outline-halo-ignore-z.js */
const R = require('./_render'), { A, V, g } = R, PackHost = g.PackHost, PStore = g.PackStore, Pick = g.Pick;
// a scene on a hill: terrain rises 40 m over 600 m along x
const scene = V.makePlaceholderScene(7);
scene.terrain = { x0: -100, y0: -100, dx: 100, dy: 100, nx: 12, ny: 8, z: Array.from({ length: 96 }, (_, i) => (i % 12) * 40 / 11) };
const N = scene.buildings.length, RED = '#c0392b';
const probe = V.createSim(scene, { seed: 5, theme: R.theme(), region: 'nw', relief: 1 }); let HI = 0; probe.buildings.forEach((e, i) => { if (e.z > probe.buildings[HI].z) HI = i; });   // the highest building
const manifest = { spec: 1, id: 'z', title: 'z', runtime: { type: 'js', entry: 'r.js' }, time: { unit: 'year', steps: 2, speeds: [1], speed: 1 }, params: {},
  entities: { b: { count: N, fields: { state: { type: 'category', values: ['no', 'part', 'all'] }, cannot: 'boolean' } } },
  mappings: [
    { entity: 'b', field: 'state', channel: 'wall', scale: { type: 'categorical', label: 'S', values: { no: { colour: '#c9c2b0', label: 'No' }, part: { colour: '#e0a030', label: 'Some' }, all: { colour: '#2e9d6a', label: 'All' } } } },
    { entity: 'b', field: 'cannot', channel: 'outline', lod: { far: 'show' }, scale: { type: 'categorical', label: 'C', values: { true: { colour: RED, label: 'Cannot' }, false: { colour: null, label: 'Can' } } } },
    { entity: 'b', field: 'cannot', channel: 'halo', lod: { far: 'show' }, scale: { type: 'categorical', label: 'H', values: { true: { colour: '#1d4ed8', label: 'Cannot' }, false: { colour: null, label: 'Can' } } } },
  ] };
const store = PStore.create(manifest);
const sim = V.createSim(scene, { seed: 5, theme: R.theme(), region: 'nw', relief: 1 });
const b = PackHost.bindRenderer({ manifest, store, controller: { wall: 0 }, sim }); if (!b.ok) throw new Error(b.error);
const KM = Array.from(b.index).indexOf(HI);                                                                // the model building that stands on scene building HI (placement is by distance from the centre)
store.pushFrames([{ t: 0, entities: { b: { state: Int8Array.from({ length: N }, (_, i) => i % 3), cannot: Float32Array.from({ length: N }, (_, i) => (i === KM ? 1 : 0)) } }, series: {} }], { replace: true });
const e = sim.buildings[HI], k = 2.5, view0 = R.viewAt(scene, k, 1200, 700);
const view = { w: 1200, h: 700, scale: k, ox: view0.ox, oy: view0.oy }; { const p = V.proj(view, e.fit.cx, e.fit.cy, e.z); view.ox += 600 - p[0]; view.oy += 350 - p[1]; }   // the building as drawn (at e.z) is in the middle of the screen
const rec = () => { const o = { pts: [], paths: [] }; const f = (n) => (x, y) => { o.pts.push([n, x, y]); };
  return Object.assign(o, { save() {}, restore() {}, beginPath() { o.paths.push(o.pts.length); }, closePath() {}, stroke() {}, fill() {}, clearRect() {}, setLineDash() {}, moveTo: f('m'), lineTo: f('l'), strokeStyle: '', lineWidth: 0, globalAlpha: 1, lineJoin: '', lineCap: '' }); };
const proj = (p, z) => V.proj(view, p[0], p[1], z);
console.log('building ' + HI + ': terrain height e.z = ' + e.z.toFixed(2) + ' m, view scale ' + k + ' px/m  =>  expected offset between ground-0 and true position: ' + (e.z * k).toFixed(1) + ' px');

// 1. outline (drawChannels): the bottom footprint ring is the first path; compare its first vertex with the building's own footprint corner at e.z and at 0
const c1 = rec(); b.drawChannels(c1, view);
const v0 = e.src.footprint[0], at0 = proj(v0, 0), atZ = proj(v0, e.z), got = c1.pts.find(p => p[0] === 'm' && Math.abs(p[1] - at0[0]) < 1e-6 && Math.abs(p[2] - at0[1]) < 1e-6);
const anyAtZ = c1.pts.some(p => Math.abs(p[1] - atZ[0]) < 1e-6 && Math.abs(p[2] - atZ[1]) < 1e-6);
console.log('outline: footprint corner drawn at y=' + at0[1].toFixed(1) + ' (z=0) ' + (got ? 'FOUND' : 'not found') + '; where the building stands (z=e.z) it would be y=' + atZ[1].toFixed(1) + ' ' + (anyAtZ ? 'FOUND' : 'NOT FOUND in the outline') + ' -> outline is ' + (at0[1] - atZ[1]).toFixed(1) + ' px below its building');
// 2. visibility test: put the building's true position just above the top edge so it is on screen only when z is used
const k2 = 2.5, vTop = { w: 1200, h: 700, scale: k2, ox: view.ox, oy: view.oy };
const sy0 = V.proj(vTop, e.fit.cx, e.fit.cy, 0)[1], syz = V.proj(vTop, e.fit.cx, e.fit.cy, e.z)[1];
console.log('vis(): the centre of building ' + HI + ' projects to y=' + sy0.toFixed(1) + ' at z=0 but y=' + syz.toFixed(1) + ' where it is drawn; vis() tests the first (packhost.js:' + 'drawChannels vis)');
// shift the view so the drawn building is at y = -40 (off the top, outside pad) but the z=0 test says it is visible, and the reverse
const shift = (target) => ({ w: 1200, h: 700, scale: k2, ox: vTop.ox, oy: vTop.oy + (target - syz) });
const pad = 14 * k2 + 20;
const vOff = shift(-(pad + 60));                                                  // drawn above the top, beyond the padding: invisible
const cOff = rec(); b.drawChannels(cOff, vOff);
const vOn = shift(700 + pad + 30 - e.z * k2 * 0 );                                // drawn below the bottom
console.log('view shifted so the building is drawn ' + (pad + 60).toFixed(0) + ' px ABOVE the top edge (truly off screen): outline vertices issued = ' + cOff.pts.length + (cOff.pts.length ? '  (drawn although invisible: vis() used z=0)' : '  (culled)'));
const vIn = shift(690 - 0);                                                         // drawn 10 px above the bottom edge: visible; at z=0 it projects ~90 px lower, past the padding
const cIn = rec(); b.drawChannels(cIn, vIn); const sy0b = V.proj(vIn, e.fit.cx, e.fit.cy, 0)[1];
console.log('view shifted so the building is drawn at y=690 of 700 (visible, on screen): z=0 projection says y=' + sy0b.toFixed(1) + '; outline vertices issued = ' + cIn.pts.length + (cIn.pts.length ? '' : '  (CULLED although the building is on screen)'));

// 3. selection halo (bindInteraction.drawHighlight): halo ring at z=0 but the outline at z0
store.select({ entity: 'b', id: KM });
const box = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) }, doc = { addEventListener() {}, removeEventListener() {} };
const pick = Pick.create(sim), inter = PackHost.bindInteraction({ manifest, store, sim, binding: b, pick, box, camera: { view: () => view }, doc });
const c3 = rec(); inter.drawHighlight(c3, view);
const ringY = c3.pts.filter(p => p[0] === 'm').map(p => p[2]);
console.log('selection: first path starts at y=' + ringY[0].toFixed(1) + ' ... a footprint corner is at y=' + at0[1].toFixed(1) + ' (z=0) / ' + atZ[1].toFixed(1) + ' (z=e.z). The channel halo (ringPath(..., 1.6, 0)) and the selection halo are both at z=0; the selection outline uses z0 = ' + pick.silhouette(HI).z.toFixed(2));
// 4. ground tint / marks are drawn with z=0 over a ground that is lifted by the terrain
const T = sim.terrain, cell = { x0: 300, y0: 200, x1: 340, y1: 240 }, mx = (cell.x0 + cell.x1) / 2, my = (cell.y0 + cell.y1) / 2;
console.log('ground cell at (' + mx + ',' + my + '): terrain there is ' + T.at(mx, my).toFixed(1) + ' m high, so the ground under it is drawn ' + (T.at(mx, my) * k).toFixed(1) + ' px higher on screen than the tint/hatch cell (VizLib.tintCell and drawGroundMarks call proj(view, x, y, 0))');
b.dispose();
