#!/usr/bin/env python3
"""Composition pass for the conformance world (scene-craft/recipes/composition.md §2).

Reads scene.json, writes scene.composed.json, appends a summary to scene_report.md.
Seeded and deterministic. Constructed world only: every change is synthetic and labelled.

  python worlds/conformance/map-data/compose.py
"""
import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEED = 4242
K = 0.25           # extra rise toward the centre, as a share of the band top
CAP = 6            # bible: nothing above 6 storeys except the landmark
# bible bands (northern brick town) applied before the gradient
BANDS = {'villa': (2, 2), 'terrace': (2, 3), 'block': (3, 5), 'shophouse': (2, 4), 'shed': (1, 2), 'tower': (5, 6)}
LANDMARK_MERGE = ['b234', 'b235']   # two parcels west of the market square -> the hall church
SQUARE_ID = 'l29'


def obb(points):
    """Minimum-area rectangle of a convex point set (rotating calipers over hull edges)."""
    pts = sorted(set(map(tuple, points)))
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0: lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0: upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    best = None
    for i in range(len(hull)):
        a, b = hull[i], hull[(i+1) % len(hull)]
        ang = math.atan2(b[1]-a[1], b[0]-a[0])
        c, s = math.cos(ang), math.sin(ang)
        xs = [p[0]*c + p[1]*s for p in hull]
        ys = [-p[0]*s + p[1]*c for p in hull]
        area = (max(xs)-min(xs)) * (max(ys)-min(ys))
        if best is None or area < best[0]:
            best = (area, ang, min(xs), max(xs), min(ys), max(ys))
    _, ang, x0, x1, y0, y1 = best
    c, s = math.cos(ang), math.sin(ang)
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return [[round(x*c - y*s, 2), round(x*s + y*c, 2)] for x, y in corners]


def main():
    rnd = random.Random(SEED)
    scene = json.loads((HERE / 'scene.json').read_text())
    blds = scene['buildings']
    by_id = {b['id']: b for b in blds}
    sq = next(l for l in scene['landuse'] if l['id'] == SQUARE_ID)
    pond = next(l for l in scene['landuse'] if l['kind'] == 'water')

    # 0. square: the constructor's square polygon crosses two roads and contains b267.
    #    Re-seat it on the block that holds the pond (306.96-351.65 x 219.32-262.83), inset for pavements.
    old_sq = sq['footprint']
    sq['footprint'] = [[310.5, 222.8], [348.1, 222.8], [348.1, 259.3], [310.5, 259.3]]
    sq['composed'] = 're-seated on the pond block'
    cx = sum(p[0] for p in sq['footprint']) / 4
    cy = sum(p[1] for p in sq['footprint']) / 4

    # 1. height gradient toward the square (after clamping to the bible's bands)
    dmax = max(math.hypot(b['centroid'][0]-cx, b['centroid'][1]-cy) for b in blds)
    changed, before = 0, {}
    for b in blds:
        lo, hi = BANDS.get(b['archetype'], (2, 4))
        lv0 = b['levels']
        d = math.hypot(b['centroid'][0]-cx, b['centroid'][1]-cy)
        # round 2: the recipe's `levels * (1 + k(1-d/dmax))` on noisy constructor storeys gave a plateau, not a gradient.
        # Instead place each structure inside its archetype band by distance: band low end at the edge, high end at the square.
        g = max(0.0, 1 - d / (dmax * 0.75)) ** 1.3
        lv = lo + (hi - lo) * g + K * hi * g + rnd.uniform(-0.45, 0.45)
        lv = max(1, min(CAP, int(round(lv))))
        before[b['id']] = lv0
        if lv != lv0:
            changed += 1
            b['levels'] = lv
            b['levels_assumed'] = True
            b['levels_composed'] = True
        b['height'] = round(lv * 3.1, 1)

    # 2-3. landmark: merge two parcels into one civic footprint, mark it, raise it
    parts = [by_id[i] for i in LANDMARK_MERGE]
    fp = obb([p for b in parts for p in b['footprint']])
    lm = dict(parts[0])
    lm.update({
        'id': 'b234', 'footprint': fp, 'archetype': 'church', 'economic_class': 'civic',
        'residential': 'other', 'landmark': True, 'landmark_kind': 'hall church with spire',
        'landmark_invented': True, 'levels': 4, 'levels_assumed': True, 'height': 16.0,
        'centroid': [round(sum(p[0] for p in fp)/4, 2), round(sum(p[1] for p in fp)/4, 2)],
        'area': round(math.dist(fp[0], fp[1]) * math.dist(fp[1], fp[2]), 1),
        'merged_from': LANDMARK_MERGE, 'neighbours': [],
        'osm': {'building': 'composed:church', 'levels_source': 'composition'},
    })
    removed = [b['id'] for b in parts[1:]]
    blds = [lm if b['id'] == 'b234' else b for b in blds if b['id'] not in removed]
    for b in blds:
        b['neighbours'] = [n for n in b.get('neighbours', []) if n not in removed]
    scene['buildings'] = blds
    scene['structures'] = [dict(b, kind='building') for b in blds]
    scene['area']['composed'] = {'pass': 'compose.py', 'seed': SEED}

    out = HERE / 'scene.composed.json'
    out.write_text(json.dumps(scene, separators=(',', ':')))

    hist0, hist1 = {}, {}
    for b in blds:
        hist1[b['levels']] = hist1.get(b['levels'], 0) + 1
    for v in before.values():
        hist0[v] = hist0.get(v, 0) + 1
    ring = lambda r0, r1: [b['levels'] for b in blds if not b.get('landmark') and r0 <= math.hypot(b['centroid'][0]-cx, b['centroid'][1]-cy) < r1]
    mean = lambda xs: sum(xs) / len(xs) if xs else 0
    summary = f"""
## Composition pass (`compose.py`, seed {SEED}) — synthetic, labelled

Recipe: `skills/paperdolls-scene-craft/recipes/composition.md` §2. Output: `scene.composed.json` (the page builds from it).

- **Centre:** the market square `{SQUARE_ID}`. The constructor's square polygon {old_sq[0]}–{old_sq[2]} crossed roads `w8`/`w23`
  and contained structure `b267`; it was re-seated on the pond block, {sq['footprint'][0]}–{sq['footprint'][2]}. Pond `{pond['id']}` unchanged.
- **Height gradient:** storeys first clamped to the art bible's bands ({', '.join(f'{k} {v[0]}–{v[1]}' for k, v in BANDS.items())}),
  then placed in the band by distance: `lo + (hi − lo)·g + {K}·hi·g`, g = max(0, 1 − d/(0.75·dmax))^1.3 (+ seeded ±0.45), capped at {CAP}.
  {changed} of {len(before)} structures changed storeys; all are `levels_assumed: true`, `levels_composed: true`.
  Mean storeys by distance from the square: 0–100 m {mean(ring(0, 100)):.1f}, 100–200 m {mean(ring(100, 200)):.1f},
  200–300 m {mean(ring(200, 300)):.1f}, 300 m+ {mean(ring(300, 9999)):.1f}.
  Storey histogram before {dict(sorted(hist0.items()))}; after {dict(sorted(hist1.items()))}.
- **Landmark (invented, labelled):** `b234` + `b235` merged into one footprint (`b234`, {lm['area']} m²), archetype `church`,
  `landmark: true`, a brick hall church with a slate spire. Structure count {len(before)} → {len(blds)}
  (the model creates one anchored agent per structure, so the run has {len(blds)} agents).
- **Not changed:** roads, parks, gardens, trees, economic classes of all other structures. No buildings removed for parks.
- **Not done (gap):** irregular streets (one diagonal/curved road) need a constructor change; breathing space is ~2 % of area,
  below the recipe's 8–15 %, because turning more blocks into parks would delete model structures.
"""
    rep = HERE / 'scene_report.md'
    text = rep.read_text()
    marker = '\n## Composition pass'
    if marker in text:
        text = text[:text.index(marker)]
    rep.write_text(text.rstrip() + '\n' + summary)
    print(summary)


if __name__ == '__main__':
    main()
