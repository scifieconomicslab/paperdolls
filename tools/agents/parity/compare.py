"""Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
Adds --pens; KS checkpoints cap at the actual horizon with Bonferroni adjusted.
"""
"""Ensemble gate (prototype of plan 4.2): compare two sets of runs pen by pen, tick by tick.

  python3 parity/compare.py results/netlogo.csv results/ts.csv [--out results/report.md]

For every pen and tick: mean, 5th and 95th percentiles of each side; a standardised mean difference z = (mean_b - mean_a) / SE.
Runs that stopped early (extinction) carry their last value forward, as a stopped NetLogo run would show.
Gate (initial thresholds):
  * a two-sample Kolmogorov-Smirnov test at ticks 100, 250 and the last tick does not reject at alpha = 0.01, Bonferroni-corrected
    over every test made (3 pens x 3 ticks: each p must exceed 0.01 / 9);
  * no pen has |z| > 3 for 20 or more ticks in a row.
Standard library only.
"""
import csv, math, sys, statistics as st
ALPHA = 0.01
from collections import defaultdict

PENS = ['sheep', 'wolves', 'grass4']

def load(path, ticks=None):
    runs = defaultdict(dict)
    with open(path) as f:
        for lineno, r in enumerate(csv.DictReader(f), start=2):
            try:
                runs[int(r['run'])][int(r['tick'])] = {k: float(r[k]) for k in PENS}
            except (KeyError, ValueError, TypeError) as e:
                missing = [k for k in (['run', 'tick'] + PENS) if k not in r or r[k] in (None, '')]
                sys.exit(f"{path}: row {lineno} is malformed ({e}). Expected columns run,tick,{','.join(PENS)}" + (f"; missing: {', '.join(missing)}" if missing else ""))
    T = ticks or max(max(v) for v in runs.values())
    out = {}
    for run, by in runs.items():
        last, series = None, []
        for t in range(T + 1):
            last = by.get(t, last); series.append(last)
        out[run] = series
    return out, T

def pct(xs, p):
    xs = sorted(xs); k = (len(xs) - 1) * p; f = math.floor(k); c = math.ceil(k)
    return xs[f] if f == c else xs[f] + (xs[c] - xs[f]) * (k - f)

def ks(a, b):
    a, b = sorted(a), sorted(b); n, m = len(a), len(b); i = j = 0; d = 0.0
    while i < n and j < m:
        x = min(a[i], b[j])
        while i < n and a[i] <= x: i += 1
        while j < m and b[j] <= x: j += 1
        d = max(d, abs(i / n - j / m))
    en = math.sqrt(n * m / (n + m)); lam = (en + 0.12 + 0.11 / en) * d
    p = 2 * sum((-1) ** (k - 1) * math.exp(-2 * k * k * lam * lam) for k in range(1, 101)) if lam > 0 else 1.0
    return d, max(0.0, min(1.0, p))

def main():
    global PENS
    if '--pens' in sys.argv:
        PENS = [p.strip() for p in sys.argv[sys.argv.index('--pens') + 1].split(',')]
    a_path, b_path = sys.argv[1], sys.argv[2]
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
    A, T = load(a_path); B, _ = load(b_path, T)
    pens = PENS
    kticks = sorted({min(100, T), min(250, T), T})
    global ALPHA
    ALPHA = 0.01 / (len(pens) * len(kticks))
    lines = [f'# Ensemble gate: {b_path} against {a_path}', '', f'{len(A)} runs against {len(B)} runs, ticks 0 to {T}.', '']
    ok = True
    lines += ['| Pen | Mean A (t=100/250/end) | Mean B | Ticks B mean inside A 5-95% band | Max abs z | Longest run abs z > 3 | KS p at 100 / 250 / end | Pass |', '|---|---|---|---|---|---|---|---|']
    for pen in pens:
        inside = 0; zmax = 0.0; runlen = best = 0; means = {}
        for t in range(T + 1):
            a = [s[t][pen] for s in A.values()]; b = [s[t][pen] for s in B.values()]
            ma, mb = st.fmean(a), st.fmean(b)
            se = math.sqrt(st.pvariance(a) / len(a) + st.pvariance(b) / len(b))
            z = 0.0 if se == 0 else (mb - ma) / se
            zmax = max(zmax, abs(z))
            runlen = runlen + 1 if abs(z) > 3 else 0; best = max(best, runlen)
            if pct(a, 0.05) <= mb <= pct(a, 0.95): inside += 1
            means[t] = (ma, mb)
        kss = []
        for t in kticks:
            kss.append(ks([s[t][pen] for s in A.values()], [s[t][pen] for s in B.values()])[1])
        passed = all(p > ALPHA for p in kss) and best < 20
        ok &= passed
        f = lambda i: '/'.join(f'{means[t][i]:.0f}' for t in kticks)
        lines.append(f'| {pen} | {f(0)} | {f(1)} | {inside}/{T + 1} | {zmax:.2f} | {best} | ' + ' / '.join(f'{p:.3f}' for p in kss) + f' | {"yes" if passed else "NO"} |')
    lines += ['', f'**Gate: {"PASS" if ok else "FAIL"}**', '']
    text = '\n'.join(lines); print(text)
    if out: open(out, 'w').write(text + '\n')
    sys.exit(0 if ok else 1)

main()
