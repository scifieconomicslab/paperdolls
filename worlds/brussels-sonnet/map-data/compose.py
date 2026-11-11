#!/usr/bin/env python3
"""Composition pass for brussels-sonnet (recipes/composition.md §3, OSM = framing only).

Reads scene.json, writes
  scene.composed.json  compact scene: footprints rounded to 0.1 m, composed storeys, landmark, bound flag
  ground.json          carriageway / sidewalk / pedestrian / cycle polygons (shapely union, clean junctions)
and appends a summary to scene_report.md. Seeded (md5 of id): same input -> same output.
Needs shapely (not in requirements.txt; see skill-gaps).
"""
import json, hashlib, math, collections
from shapely.geometry import LineString, Polygon, MultiPolygon, shape, mapping
from shapely.ops import unary_union

S = json.load(open('scene.json'))

def h01(key):
    return int(hashlib.md5(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF

# commune outline (diorama edge) from the relation geometry in extract.json, same local frame as the ingest
import math
from shapely.ops import linemerge, polygonize
EX = json.load(open('extract.json'))
rel = next(e for e in EX['elements'] if e['type'] == 'relation' and e['id'] == S['area']['osm_relation'])
lat0, lon0 = S['area']['origin']['lat'], S['area']['origin']['lon']
KY = 6371008.8 * math.pi / 180; KX = KY * math.cos(math.radians(lat0))
lines = [LineString([((g['lon'] - lon0) * KX, -(g['lat'] - lat0) * KY) for g in m['geometry']]) for m in rel['members'] if m['role'] == 'outer' and len(m.get('geometry', [])) > 1]
polys = list(polygonize(linemerge(lines)))
BND = unary_union(polys).simplify(1.5)

# ---- roads -> polygons ------------------------------------------------------
WIDTH = {'avenue': 8.0, 'local': 5.5, 'cycle': 2.5, 'pedestrian': 5.0}
SIDE = {'avenue': 3.0, 'local': 2.0}
veh, ped, cyc, side_src = [], [], [], []
tram = []
avenue_lines = []
for r in S['roads']:
    pts = r['pts']
    if len(pts) < 2: continue
    ln = LineString(pts)
    c = r['class']
    if c == 'tramway':
        tram.append([[round(x, 1), round(y, 1)] for x, y in pts]); continue
    w = r.get('width') or WIDTH.get(c, 5.5)
    if c in ('avenue', 'local'):
        veh.append(ln.buffer(w / 2, cap_style=2, join_style=1))
        side_src.append(ln.buffer(w / 2 + SIDE[c], cap_style=2, join_style=1))
        if c == 'avenue': avenue_lines.append(ln)
    elif c == 'pedestrian':
        ped.append(ln.buffer(w / 2, cap_style=2, join_style=1))
    elif c == 'cycle':
        cyc.append(ln.buffer(w / 2, cap_style=2, join_style=1))
    if r.get('tram') and c != 'tramway':
        tram.append([[round(x, 1), round(y, 1)] for x, y in pts])
V = unary_union(veh)
_CLIP = None
P = unary_union(ped) if ped else Polygon()
C = unary_union(cyc).difference(V) if cyc else Polygon()
SW = unary_union(side_src).difference(V).difference(P) if side_src else Polygon()
P = P.difference(V)

def rings(g, tol=0.15):
    out = []
    geoms = g.geoms if hasattr(g, 'geoms') else [g]
    for p in geoms:
        if p.is_empty or p.geom_type != 'Polygon' or p.area < 4: continue
        p = p.simplify(tol)
        if p.is_empty or p.geom_type != 'Polygon': continue
        rr = [[[round(x, 1), round(y, 1)] for x, y in p.exterior.coords[:-1]]]
        for i in p.interiors:
            if Polygon(i).area > 6:
                rr.append([[round(x, 1), round(y, 1)] for x, y in i.coords[:-1]])
        out.append(rr)
    return out

lines = [[[round(x, 1), round(y, 1)] for x, y in r['pts']] for r in S['roads'] if r['class'] in ('avenue', 'local') and len(r['pts']) > 1]
ave = [[[round(x, 1), round(y, 1)] for x, y in r['pts']] for r in S['roads'] if r['class'] == 'avenue' and len(r['pts']) > 1]
_clip = BND.buffer(0)
V = V.intersection(_clip); SW = SW.intersection(_clip); P = P.intersection(_clip); C = C.intersection(_clip)
def _clipline(pts):
    ln = LineString(pts).intersection(_clip); out = []
    for g in (ln.geoms if hasattr(ln, 'geoms') else [ln]):
        if g.geom_type == 'LineString' and g.length > 2: out.append([[round(x, 1), round(y, 1)] for x, y in g.coords])
    return out
tram = [seg for t in tram for seg in _clipline(t)]
lines = [seg for l in lines for seg in _clipline(l)]
ave = [seg for l in ave for seg in _clipline(l)]
ground = {'lines': lines, 'avenues': ave, 'carriage': rings(V), 'sidewalk': rings(SW), 'pedestrian': rings(P), 'cycle': rings(C), 'tram': tram}
ground['boundary'] = rings(BND, 1.0)
json.dump(ground, open('ground.json', 'w'), separators=(',', ':'))

# ---- buildings --------------------------------------------------------------
AV = unary_union([l.buffer(30) for l in avenue_lines]) if avenue_lines else Polygon()
RELIGIOUS = ('church', 'cathedral', 'chapel', 'mosque', 'synagogue', 'temple')
# rule (revised after the first render: the hospital campus is a flat megastructure, a poor landmark): largest NAMED religious building,
# else largest religious, else largest civic-type building
cands = [b for b in S['structures'] if b['osm'].get('building') in RELIGIOUS and b['osm'].get('name')] or [b for b in S['structures'] if b['osm'].get('building') in RELIGIOUS] \
    or [b for b in S['structures'] if b['osm'].get('building') in ('civic', 'public', 'hospital', 'train_station', 'university')]
landmark = max(cands, key=lambda b: b['area'])['id'] if cands else None

stat = collections.Counter()
out = []
for b in S['structures']:
    lv = b['levels']; assumed = b['levels_assumed']
    src = b['osm'].get('levels_source')
    area = b['area']; nb = len(b['neighbours'])
    new = lv
    if assumed and b['osm'].get('building') == 'yes' and src == 'global-default':
        r = h01('lv' + b['id'])
        if area < 30: new = 1
        elif area < 60: new = 1 if r < 0.6 else 2
        else:
            new = 2
            _mr = Polygon(b['footprint']).minimum_rotated_rectangle.exterior.coords
            _e = [((_mr[i+1][0]-_mr[i][0])**2 + (_mr[i+1][1]-_mr[i][1])**2) ** 0.5 for i in range(2)]
            _L, _W = max(_e), min(_e)
            if nb >= 2 and area < 160: new = 3 if r < 0.55 else 2        # terrace-like row house
            if area >= 400: new = 3 + (1 if r < 0.5 else 0)
            if area >= 1200: new = 4 + (1 if r < 0.4 else 0)
            if _W <= 14 and _L >= 20 and area < 1500: new = 3 if r < 0.7 else 2   # mapped terrace row: houses, not a block
            if AV.contains(Polygon(b['footprint']).centroid) and new < 5 and r > 0.35: new += 1
        stat[(lv, new)] += 1
    elif assumed and b['osm'].get('building') == 'house':
        new = 2 + (1 if h01('lv' + b['id']) < 0.3 else 0)
    b2 = {'id': b['id'], 'fp': [[round(x, 1), round(y, 1)] for x, y in b['footprint']],
          'lv': new, 'lva': bool(assumed), 'area': area,
          'res': b['residential'], 'bound': b['residential'] in ('residential', 'probable'),
          'osm': b['osm'].get('building'), 'ec': b['economic_class'], 'nb': nb}
    if new != lv: b2['lv0'] = lv
    if b['id'] == landmark:
        b2['landmark'] = True
        b2['lv'] = max(b2['lv'], 4)
    if b['osm'].get('name'): b2['name'] = b['osm']['name']
    out.append(b2)

comp = {'area': S['area'], 'buildings': out, 'landuse': [{'kind': l['kind'], 'fp': [[round(x, 1), round(y, 1)] for x, y in l['footprint']]} for l in S['landuse']],
        'trees': [[round(t[0], 1), round(t[1], 1)] + list(t[2:]) for t in S['trees']]}
json.dump(comp, open('scene.composed.json', 'w'), separators=(',', ':'))

dist = collections.Counter(b['lv'] for b in out)
changed = sum(1 for b in out if 'lv0' in b)
rep = f"""

## Composition pass (compose.py, seeded by building id)

OSM world: framed, not reshaped. Nothing was added, removed or merged; the 9,216 structures are unchanged.

- Ground: carriageways, sidewalks, pedestrian and cycle areas are shapely unions of the road centre-lines at the report's widths
  (avenue/local sidewalk 3 m / 2 m are **proposals**, not data). {len(ground['carriage'])} carriageway, {len(ground['sidewalk'])} sidewalk polygons; {len(tram)} tram lines.
- Landmark rule: the largest named religious building (else largest religious, else largest civic-type) -> {landmark}
  ({next(b['area'] for b in S['structures'] if b['id']==landmark)} m2, osm building={next(b['osm'].get('building') for b in S['structures'] if b['id']==landmark)}); a church: tall nave and spire are drawn by the scene as decorative emphasis. Real structure, only its emphasis is a choice.
- **Storeys, composed (ASSUMED, not measured):** the ingest assumed 2 storeys for every untagged building=yes. Because that would draw a flat carpet, storeys
  were re-assumed by rule: <30 m2 -> 1; 30-60 m2 -> 1-2; terrace-like (>=2 touching neighbours, <160 m2) -> 2-3; >=400 m2 -> 3-4; >=1200 m2 -> 4-5; a mapped terrace row (min-rect width <=14 m, length >=20 m, <1500 m2) -> 2-3 whatever its area; +1 within 30 m of an avenue.
  {changed} buildings changed; storey histogram now {dict(sorted(dist.items()))}. All remain `levels_assumed: true` (99% of storeys are assumed either way).
- Bound structures (households' homes, user choice at Gate 3): residential + probable = {sum(1 for b in out if b['bound'])}; unbound scenery = {sum(1 for b in out if not b['bound'])}.
"""
import re
_r=open("scene_report.md").read()
_r=re.sub(r"\n\n## Composition pass.*", "\n", _r, flags=re.S); open("scene_report.md","w").write(_r)
if "## Composition pass" not in _r: open("scene_report.md","a").write(rep)
print(rep)
