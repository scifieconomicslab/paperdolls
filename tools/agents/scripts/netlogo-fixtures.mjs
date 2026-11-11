// Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
#!/usr/bin/env node
/* Records what desktop NetLogo 7.0.4 does for each primitive the library mirrors, into test/fixtures/netlogo-7.0.4.json. The tests compare the
 * library against that file, so CI does not need NetLogo; re-run this after changing a scenario or upgrading NetLogo.
 *   NETLOGO_HOME=/path/to/NetLogo\ 7.0.4 node scripts/netlogo-fixtures.mjs
 * Each scenario is a BehaviorSpace experiment on a host model (the library's Wolf Sheep Predation: turtles-own energy, patches-own countdown,
 * global max-sheep), whose setup builds the case and whose metrics report the results at step 0. */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SCENARIOS } from '../test/scenarios.mjs';

const home = process.env.NETLOGO_HOME || new URL('../../../tools/NetLogo/', import.meta.url).pathname;
const model = join(home, 'models/Sample Models/Biology/Wolf Sheep Predation.nlogox');
const dir = mkdtempSync(join(tmpdir(), 'nlfx-'));
const boxModel = join(dir, 'box.nlogox');                      // the same model with a view that does not wrap
writeFileSync(boxModel, readFileSync(model, 'utf8').replace(/wrappingAllowedX="true"/, 'wrappingAllowedX="false"').replace(/wrappingAllowedY="true"/, 'wrappingAllowedY="false"'));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// NetLogo's list syntax: [1 2 [3 "a"] true] -> JS
function parseNL(text) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const val = () => {
    ws();
    if (text[i] === '[') { i++; const out = []; for (;;) { ws(); if (text[i] === ']') { i++; return out; } out.push(val()); } }
    if (text[i] === '"') { let s = ''; i++; while (text[i] !== '"') { if (text[i] === '\\') i++; s += text[i++]; } i++; return s; }
    let tok = ''; while (i < text.length && !/[\s\]]/.test(text[i])) tok += text[i++];
    if (tok === 'true') return true; if (tok === 'false') return false;
    const n = Number(tok); return Number.isNaN(n) ? tok : n;
  };
  return val();
}
function csvLine(l) { const out = []; let cur = '', q = false; for (let k = 0; k < l.length; k++) { const ch = l[k]; if (q) { if (ch === '"') { if (l[k + 1] === '"') { cur += '"'; k++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }

const results = { netlogo: '7.0.4', host: 'Wolf Sheep Predation.nlogox', generated: new Date().toISOString().slice(0, 10), scenarios: {} };
for (const sc of SCENARIOS) {
  const metrics = Object.values(sc.metrics);
  const xml = `<?xml version="1.0" encoding="utf-8"?><experiments><experiment name="x" repetitions="1" sequentialRunOrder="true" runMetricsEveryStep="true" timeLimit="1">
<setup>${esc(sc.setup)}</setup><go>tick</go><metrics>${metrics.map(m => `<metric>${esc(m)}</metric>`).join('')}</metrics></experiment></experiments>`;
  writeFileSync(join(dir, 'e.xml'), xml);
  const table = join(dir, 'out.csv');
  execFileSync(join(home, 'netlogo-headless.sh'), ['--model', sc.wrap === false ? boxModel : model, '--setup-file', join(dir, 'e.xml'), '--experiment', 'x', '--table', table, '--threads', '1'], { stdio: ['ignore', 'ignore', 'inherit'] });
  const lines = readFileSync(table, 'utf8').trim().split('\n'), hi = lines.findIndex(l => l.startsWith('"[run number]"'));
  const cols = csvLine(lines[hi]), row = lines.slice(hi + 1).map(csvLine).find(r => r[cols.indexOf('[step]')] === '0');
  const out = {};
  for (const [name, expr] of Object.entries(sc.metrics)) out[name] = parseNL(row[cols.indexOf(expr)]);
  results.scenarios[sc.name] = out;
  console.log(sc.name, 'ok');
}
writeFileSync(new URL('../test/fixtures/netlogo-7.0.4.json', import.meta.url), JSON.stringify(results, null, 0) + '\n');
console.log('wrote test/fixtures/netlogo-7.0.4.json');
