/* packcheck.js: runs a pack's JavaScript runtime for `paperdolls pack check` (paperdolls/packcheck.py starts it and reads its JSON).
 *
 *   node packcheck.js <job.json>
 *
 * job: { viz, manifest, sources: [text], scene: path|null, steps, parity: [case]|null }
 * The runtime runs in a vm context shaped like the page's main thread (no require, no module, no Math.random), with the same
 * packvalidate.js and packruntime.js the page uses. Output on stdout: { checks: [{ name, errors, warnings, ms }], parity: { caseName: { frames } | { error } } }.
 * Needs only node itself. Frames in the parity output are whole frames (patches applied), with category fields as indices.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {}, debug() {} } });
const run = (code, name) => vm.runInContext(code, ctx, { filename: name });
run("Math.random = function () { throw new Error('Math.random() was called: a runtime must be deterministic, use its own seeded generator'); };", 'guard');
run('globalThis.window = undefined;', 'shape');
for (const f of ['packvalidate.js', 'packruntime.js']) run(fs.readFileSync(path.join(job.viz, f), 'utf8'), f);

const checks = [];
function step(name, fn) {
  const t0 = Date.now(), c = { name, errors: [], warnings: [], ms: 0 };
  try { fn(c); } catch (e) { c.errors.push(String((e && e.message) || e)); }
  c.ms = Date.now() - t0; checks.push(c); return c;
}

// ---- load the runtime sources ----
const manifest = job.manifest;
let impl = null;
step('runtime loads and registers', c => {
  try { job.sources.forEach((s, i) => run(s, 'runtime source ' + (i + 1))); } catch (e) { c.errors.push('the runtime file failed to load: ' + ((e && e.message) || e)); return; }
  impl = run('PaperDolls.getRuntime', 'get')(manifest.id);
  if (!impl) c.errors.push('the runtime did not register itself as ' + manifest.id + ' (PaperDolls.registerRuntime(\'' + manifest.id + '\', ...))');
});
const PR = run('PackRuntime', 'PR');
if (impl) step('interface', c => { PR.checkInterface(manifest, impl).forEach(m => c.errors.push(m)); });

// ---- the scene ----
let counts = null, attrs = null, scene = null;
if (impl && job.scene) {
  step('bindScene on the scene', c => {
    scene = JSON.parse(fs.readFileSync(job.scene, 'utf8'));
    const b = PR.bindScene(manifest, impl, scene);
    if (!b.ok) { c.errors.push(b.error); return; }
    if (!b.bound) { c.warnings.push('the runtime has no bindScene: entities are drawn on scene buildings in an invented order'); return; }
    counts = b.counts; attrs = b.attrs;
    c.warnings.push(...b.warnings);
    const drawn = Object.entries(b.pos).map(([n, p]) => n + ': ' + p.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0) + ' of ' + p.length + ' on a scene building').join('; ');
    c.info = drawn;
    // determinism of the binding: same scene, same result
    const again = PR.bindScene(manifest, impl, scene);
    if (JSON.stringify(Object.keys(again.counts)) !== JSON.stringify(Object.keys(b.counts)) || Object.keys(b.counts).some(k => again.counts[k] !== b.counts[k] || PR.digest(again.pos[k]) !== PR.digest(b.pos[k]))) c.errors.push('bindScene gave a different result for the same scene: it must be deterministic');
  });
} else if (impl && Object.values(manifest.entities || {}).some(e => e.from === 'scene')) {
  step('scene', c => { c.info = 'no --scene: an entity declared from: scene runs on its count fallback'; });
}

// ---- running ----
const defaults = () => Object.fromEntries(Object.entries(manifest.params || {}).map(([k, v]) => [k, v.default]));
const horizon = manifest.time.steps;
const seriesNames = Object.keys(manifest.series || {});
const mk = () => PR.create(manifest, impl, { counts, attrs });

function runCase(label, params, steps) {
  step(label, c => {
    const p = Object.assign(defaults(), params || {}), n = Math.min(steps, horizon);
    const play = () => { const r = mk(); const f0 = r.start(p); return [f0].concat(r.run(n)); };
    let a, b;
    try { a = play(); b = play(); } catch (e) { c.errors.push('runtime failed: ' + e.message); return; }
    if (a.length !== n + 1) c.errors.push('run(' + n + ') gave ' + (a.length - 1) + ' steps, expected ' + n);
    // every declared series must be in every frame
    let missing = null;
    a.forEach((f, i) => { if (!missing) for (const s of seriesNames) if (!f.series || f.series[s] === undefined) { missing = 'series.' + s + ' is declared in the manifest but frame ' + i + ' does not carry it'; break; } });
    if (missing) c.errors.push(missing);
    if (PR.digest(a) !== PR.digest(b)) c.errors.push('two runs with the same parameters and seed differ: the runtime is not deterministic');
    const rr = mk();
    if (rr.canSnapshot) {
      rr.start(p); rr.step(Math.floor(n / 2)); const snap = rr.snapshot();
      const tail1 = rr.run(n); rr.restore(snap); const tail2 = rr.run(n);
      if (PR.digest(tail1) !== PR.digest(tail2)) c.errors.push('a restored snapshot does not continue as the original did');
    }
    const last = a[a.length - 1];
    c.info = (n + 1) + ' frames' + (last.patch ? ' (patches after frame 0)' : '');
  });
}
if (impl && !checks.some(c => c.errors.length)) {
  runCase('run with the default parameters', {}, job.steps);
  for (const pr of manifest.presets || []) runCase('run with preset ' + pr.id, pr.params, job.steps);
  // extremes: a minimum and a maximum for every numeric parameter, one at a time, catch ranges the runtime cannot handle
  step('parameter extremes stay inside the manifest', c => {
    const n = Math.min(job.steps, horizon, 12);
    for (const [k, d] of Object.entries(manifest.params || {})) {
      const vals = d.type === 'number' || d.type === 'integer' ? [d.min, d.max] : d.type === 'boolean' ? [!d.default] : d.type === 'enum' ? (d.values || []).map(v => (v && typeof v === 'object' ? v.value : v)) : [];
      for (const v of vals) {
        if (v === d.default) continue;
        try { const r = mk(); r.start(Object.assign(defaults(), { [k]: v })); r.run(n); } catch (e) { c.errors.push(k + ' = ' + v + ': ' + e.message); }
      }
    }
  });
}

// ---- parity: whole frames for each case ----
function whole(frames) {
  const out = []; let cur = null;
  for (const f of frames) {
    if (f.patch && cur) {
      const ents = {}; for (const [e, cols] of Object.entries(cur.entities)) ents[e] = Object.assign({}, cols);
      for (const [e, fields] of Object.entries(f.patch)) for (const [fn, ch] of Object.entries(fields)) {
        const col = Array.from(ents[e][fn]); for (let i = 0; i < ch.idx.length; i++) col[ch.idx[i]] = ch.val[i]; ents[e][fn] = col;
      }
      cur = { t: f.t, entities: ents, series: f.series };
    } else cur = { t: f.t, entities: f.entities, series: f.series };
    out.push({ t: cur.t, entities: Object.fromEntries(Object.entries(cur.entities).map(([e, cols]) => [e, Object.fromEntries(Object.entries(cols).map(([fn, a]) => [fn, Array.from(a)]))])), series: cur.series || {} });
  }
  return out;
}
const parity = {};
if (impl && job.parity) {
  for (const cs of job.parity) {
    try {
      const p = Object.assign(defaults(), cs.params || {}), cnt = {};
      for (const [e, v] of Object.entries(cs.entities || {})) cnt[e] = v.count;
      const r = PR.create(manifest, impl, { counts: Object.keys(cnt).length ? Object.assign({}, counts || {}, cnt) : counts, attrs });
      const f0 = r.start(p, cs.seed), rest = r.run(Math.min(cs.steps === undefined ? horizon : cs.steps, horizon));
      parity[cs.name] = { frames: whole([f0].concat(rest)) };
    } catch (e) { parity[cs.name] = { error: String((e && e.message) || e) }; }
  }
}
const SENTINEL = { NaN: '__NaN__', Infinity: '__Inf__', '-Infinity': '__-Inf__' };
const text = JSON.stringify({ checks, parity }, (k, v) => (typeof v === 'number' && !isFinite(v) ? SENTINEL[String(v)] : v))
  .replace(/"__NaN__"/g, 'NaN').replace(/"__Inf__"/g, 'Infinity').replace(/"__-Inf__"/g, '-Infinity');
process.stdout.write(text);
