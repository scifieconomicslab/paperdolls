/* R38: is the far layer (incrementally patched, sliced, cached) the same picture as drawing every building directly / from scratch, across the events that interleave with a patch pass?
 * Each scenario runs the real renderFrame sequence on a sim, lets everything settle, and compares the final pixels with a sim that was built in the final state and painted in one go (sliceLayers:false).
 * Scenarios: A theme (register) change in the middle of a patch pass; B zoom out and back in the middle of a pass; C resize in the middle; D a pan past the layer margin in the middle; E a second change set while the
 * first pass paints; F a change during the sliced repaint that follows a zoom; G trees off then on; H versioned style with segments (k of n) and overlays, patched twice; I elevation (terrain) with a patch.
 * Expected by the code: all SAME (REFUTED stale-layer hypotheses). A DIFFERS line would be a new bug.
 * Run: PAPERDOLLS_NODE_MODULES=<node_modules> node docs/state-machines/repro/r38-far-layer-consistency-matrix.js */
const R = require('./_render'), { A, V } = R;
const W = 900, H = 600, FAR = 0.35, S = ['none', 'queued', 'in_progress', 'finished'];
const base = V.makePlaceholderScene(7); base.buildings.forEach((b, i) => { if (i % 7 === 0) b.z = 2 + (i % 5); });
const withTerrain = JSON.parse(JSON.stringify(base)); withTerrain.terrain = { x0: -100, y0: -100, dx: 100, dy: 100, nx: 12, ny: 8, z: Array.from({ length: 96 }, (_, i) => (i % 12) * 3) };
const mk = (extra, sc) => R.mkSim(JSON.parse(JSON.stringify(sc || base)), Object.assign({ layerMs: 50, prewarm: false, buildMs: 1e9 }, extra || {}));
const view = (k, dx, dy, w, h) => { const v = R.viewAt(base, k, w || W, h || H); v.ox += dx || 0; v.oy += dy || 0; return v; };
const whole = s => !s._farP && !s._groundP && !s._farPatch && !(s._far && s._far.rough) && !s._farC && !s._groundC && A.sprites.builds === 0;
function settle(s, c, v) { let n = 0; for (; n < 4000; n++) { V.renderFrame(c, s, v, {}); if (n > 3 && whole(s)) break; } V.renderFrame(c, s, v, {}); return n; }
const shot = c => c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
function scratch(mutate, v, th, sc, versionedSetup) { const s = mk({ sliceLayers: false }, sc); if (th) V.setTheme(s, th); if (versionedSetup) versionedSetup(s); mutate(s); const c = R.ctx2d(v.w, v.h); settle(s, c, v); return shot(c); }
const mutate = s => { for (let i = 0; i < s.buildings.length; i += 9) s.buildings[i].src.state = S[(i / 9 | 0) % 4]; };
const mutate2 = s => { for (let i = 0; i < s.buildings.length; i += 5) s.buildings[i].src.state = S[(i / 5 | 0) % 4]; };
let bad = 0;
function scenario(name, run, want, sc) { R.resetSprites(); R.clock.set(0.25); const s = mk({}, sc), c = R.ctx2d(W, H), got = run(s, c), w = want(), d = diff(got, w); if (d) bad++; console.log(name.padEnd(66) + (d ? 'DIFFERS in ' + d + ' bytes' : 'same') + '   leftover _farPatch=' + JSON.stringify(s._farPatch)); }
const v0 = view(FAR), two = () => { /* two frames into a pass */ };
scenario('A theme change in the middle of a patch pass', (s, c) => { settle(s, c, v0); mutate(s); V.renderFrame(c, s, v0, {}); V.renderFrame(c, s, v0, {}); V.setTheme(s, R.theme('nw', 'brick', 'formal')); settle(s, c, v0); return shot(c); }, () => scratch(mutate, v0, R.theme('nw', 'brick', 'formal')));
scenario('B zoom in and back in the middle of a patch pass', (s, c) => { settle(s, c, v0); mutate(s); V.renderFrame(c, s, v0, {}); V.renderFrame(c, s, v0, {}); const v1 = view(0.5); for (let i = 0; i < 3; i++) V.renderFrame(c, s, v1, {}); settle(s, c, v0); return shot(c); }, () => scratch(mutate, v0));
scenario('C resize in the middle of a patch pass', (s, c) => { settle(s, c, v0); mutate(s); V.renderFrame(c, s, v0, {}); V.renderFrame(c, s, v0, {}); const c2 = R.ctx2d(800, 500), v2 = view(FAR, 0, 0, 800, 500); settle(s, c2, v2); return shot(c2); }, () => scratch(mutate, view(FAR, 0, 0, 800, 500)));
scenario('D pan past the margin in the middle of a patch pass', (s, c) => { settle(s, c, v0); mutate(s); V.renderFrame(c, s, v0, {}); V.renderFrame(c, s, v0, {}); const v3 = view(FAR, -700, 300); settle(s, c, v3); return shot(c); }, () => scratch(mutate, view(FAR, -700, 300)));
scenario('E a second change set while the first pass paints', (s, c) => { settle(s, c, v0); mutate(s); V.renderFrame(c, s, v0, {}); V.renderFrame(c, s, v0, {}); mutate2(s); settle(s, c, v0); return shot(c); }, () => scratch(s => { mutate(s); mutate2(s); }, v0));
scenario('F a change during the sliced repaint that follows a zoom', (s, c) => { settle(s, c, v0); const v1 = view(0.5); s.opts.layerMs = 2; for (let i = 0; i < 3; i++) V.renderFrame(c, s, v1, {}); mutate(s); s.opts.layerMs = 50; settle(s, c, v1); return shot(c); }, () => scratch(mutate, view(0.5)));
scenario('G trees switched off, then on', (s, c) => { settle(s, c, v0); const l = { buildings: true, vehicles: true, people: true, trees: false }; for (let i = 0; i < 30; i++) V.renderFrame(c, s, v0, l); for (let i = 0; i < 30; i++) V.renderFrame(c, s, v0, {}); settle(s, c, v0); return shot(c); }, () => scratch(() => { }, v0));
// H: a versioned style (as the pack store provides) with segments and overlays
const table = [{ data: null, roof: null, overlays: [], seg: null }, { data: '#c8452f', roof: '#ffd23f', overlays: ['insulation'], seg: { n: 4, k: 1, done: '#2e8b57', todo: null } }, { data: '#5b8db8', roof: null, overlays: ['marker', 'solar'], seg: { n: 6, k: 3, done: '#2e8b57', todo: null } }, { data: null, roof: '#2e8b57', overlays: [], seg: { n: 3, k: 3, done: '#2e8b57', todo: null } }];
const versioned = (s, code) => { const idx = new Map(s.buildings.map((e, i) => [e, i])); s.buildingStyle = e => table[code[idx.get(e)]]; s.frameVersion = 1; return { bump() { s.frameVersion++; } }; };
const N = base.buildings.length, codeA = Int8Array.from({ length: N }, (_, i) => i % 3 === 0 ? 1 : 0), codeB = Int8Array.from(codeA); for (let i = 0; i < N; i += 11) codeB[i] = 1 + (i % 3);
scenario('H versioned style with segments + overlays: patched twice (A -> B -> A)', (s, c) => { const code = Int8Array.from(codeA), st = versioned(s, code); settle(s, c, v0); code.set(codeB); st.bump(); settle(s, c, v0); code.set(codeA); st.bump(); settle(s, c, v0); return shot(c); },
  () => scratch(() => { }, v0, null, null, s => { versioned(s, Int8Array.from(codeA)); }));
scenario('I elevation (terrain grid + raised buildings) with a patch', (s, c) => { settle(s, c, v0); mutate(s); settle(s, c, v0); return shot(c); }, () => scratch(mutate, v0, null, withTerrain), withTerrain);
console.log(bad ? bad + ' scenario(s) differ' : 'all scenarios equal the from-scratch picture');
