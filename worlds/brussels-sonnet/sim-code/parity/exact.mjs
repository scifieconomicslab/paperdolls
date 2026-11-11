// Exact comparison of two run CSVs (same columns): reports the first differing cell and the max relative difference. Used for the deterministic model.
import { readFileSync } from 'node:fs';
const load = f => { const L = readFileSync(f, 'utf8').trim().split('\n'); return { head: L[0].split(','), rows: L.slice(1).map(l => l.split(',').map(Number)) }; };
const TOL = +(process.argv[4] ?? 1e-12);
const [a, b] = [load(process.argv[2]), load(process.argv[3])];
if (a.rows.length !== b.rows.length) console.log(`row count differs: ${a.rows.length} vs ${b.rows.length}`);
let worst = 0, first = null, bad = 0, n = 0;
for (let i = 0; i < Math.min(a.rows.length, b.rows.length); i++) for (let j = 2; j < a.head.length; j++) {
  const x = a.rows[i][j], y = b.rows[i][j]; n++;
  if (x === y) continue; const rel = Math.abs(x - y) / Math.max(1e-12, Math.abs(x), Math.abs(y)); if (rel < TOL) continue; bad++; if (rel > worst) worst = rel;
  if (!first) first = { run: a.rows[i][0], tick: a.rows[i][1], col: a.head[j], netlogo: x, ts: y };
}
console.log(`cells ${n}, differing ${bad}, max relative difference ${worst.toExponential(2)}`); if (first) console.log('first difference', first);
process.exit(bad ? 1 : 0);
