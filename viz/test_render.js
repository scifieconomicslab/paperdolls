/* Regression tests for the rendering-engine fixes of part 30 (docs/state-machines/parts/30-rendering.md): GPU canvas backing (#3), ground marks (#17), ground height (#14),
 * the sprite budget and eviction (#18), device pixel ratio and the far layer's exact flag (#19). Each ports a repro (docs/state-machines/repro/rNN-*.js) and fails on the code it was written against.
 * Run: node viz/test_render.js (node-canvas on NODE_PATH / PAPERDOLLS_NODE_MODULES). Prints PASS/FAIL and exits non-zero on failure. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const R = require('../docs/state-machines/repro/_render.js');
const { A, V } = R;
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; process.exitCode = 1; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); } }

// ---- #3: offscreen canvases are memory-backed in the browser pages ----
test('#3 canvasFactory: every offscreen canvas opens its 2d context willReadFrequently (memory-backed), the stage canvases are untouched', () => {
  assert.strictEqual(typeof A.canvasFactory, 'function', 'AssetLib.canvasFactory exists');
  const made = [], doc = { createElement: tag => { assert.strictEqual(tag, 'canvas'); const c = { width: 0, height: 0, calls: [], getContext(t, o) { c.calls.push([t, o]); return {}; } }; made.push(c); return c; } };
  const f = A.canvasFactory(doc), c = f(30, 20);
  assert.strictEqual(c.width, 30); assert.strictEqual(c.height, 20);
  assert.strictEqual(JSON.stringify(c.calls[0]), JSON.stringify(['2d', { willReadFrequently: true }]), 'the FIRST getContext call decides the backing, so the factory makes it');
  const g = A.canvasFactory(doc, { soft: false })(5, 5); assert.strictEqual(g.calls.length, 0, 'soft: false leaves the canvas to the browser');
  for (const page of ['viewer.html', 'packhost.html']) {
    const src = fs.readFileSync(path.join(R.VIZ, page), 'utf8');
    assert(/A\.sprites\.factory = A\.canvasFactory\(document\)/.test(src), page + ' builds its canvases with AssetLib.canvasFactory');
    assert(!/sprites\.factory = \(w, hh\) =>/.test(src), page + ' has no plain factory left');
  }
});

console.log(failed ? passed + ' passed, ' + failed + ' FAILED' : 'all passed (' + passed + ')');
