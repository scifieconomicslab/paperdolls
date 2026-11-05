"""Rule-based facade textures. Offline and cached: a facade costs about 0.2 ms to generate.

Borrowed ideas (rule-based generation, weighted choice, rejection of rule-breaking results). Plain Python, no third-party generator code.
Rules are placeholders to be checked against local facade photographs.
"""
import random
from PIL import Image, ImageDraw

COLS = 5
CW, CH = 40, 34
INK = (35, 30, 22)
GLASS = (170, 196, 214)
RETRO_WALL = (226, 216, 196)
SOLAR = (46, 60, 92)

def _row_kinds(rows):
    return ["roof"] + ["upper"] * (rows - 2) + ["ground"]

def _sample_row(rng, kind, style):
    if kind == "roof":
        return ["C"] * COLS
    if kind == "ground":
        w = {"D": 0.34, "W": 0.44, "X": 0.22} if style == "house" else {"S": 0.62, "D": 0.26, "X": 0.12}
    else:
        w = {"W": 0.70, "B": 0.18, "X": 0.12}
    keys = list(w)
    return [rng.choices(keys, weights=[w[k] for k in keys])[0] for _ in range(COLS)]

def _valid(g, style):
    for row in g:
        for c in range(COLS - 2):
            if row[c] == row[c+1] == row[c+2] == "X":
                return False
    ground = g[-1]
    doors = ground.count("D")
    if style == "house" and doors != 1:
        return False
    if style == "shop" and doors < 1:
        return False
    run = 0
    for m in ground:
        run = run + 1 if m == "S" else 0
        if run > 3:
            return False
    for r in range(1, len(g) - 1):
        for c in range(COLS):
            if g[r][c] == "B" and g[r+1][c] not in ("W", "B"):
                return False
        if g[r].count("W") < 3:
            return False
    return True

def generate(seed, rows):
    """Deterministic facade grid for a seed. Rows = storeys + 2 (roof, upper floors, street)."""
    if rows < 3:
        raise ValueError("a facade needs at least 3 rows")
    rng = random.Random(seed)
    kinds = _row_kinds(rows)
    for _ in range(10000):
        style = rng.choices(["house", "shop"], weights=[0.7, 0.3])[0]
        g = [_sample_row(rng, k, style) for k in kinds]
        if _valid(g, style):
            return style, g
    raise RuntimeError("no valid facade found; rules are too strict")

def _sc(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)

def _draw_cell(d, x, y, m, wall, win, retro):
    if retro and m in "WXBS":
        wall = RETRO_WALL
    if m in "WXBCSD":
        d.rectangle([x, y, x+CW, y+CH], fill=wall if m != "C" else _sc(wall, 0.7), outline=INK)
    if m == "C":
        if retro:
            d.rectangle([x+5, y+10, x+CW-5, y+18], fill=SOLAR, outline=INK)
        return
    if m == "W":
        inset = 6 if win == "sash" else 8
        d.rectangle([x+inset, y+7, x+CW-inset, y+CH-5], fill=GLASS, outline=INK, width=1)
        if win == "casement":
            d.line([x+CW//2, y+7, x+CW//2, y+CH-5], fill=INK)
        else:
            d.line([x+inset, y+CH//2, x+CW-inset, y+CH//2], fill=INK)
        if retro:
            d.rectangle([x+4, y+CH-5, x+CW-4, y+CH-3], fill=(240, 236, 228), outline=INK)
    if m == "B":
        d.rectangle([x+6, y+6, x+CW-6, y+CH-12], fill=GLASS, outline=INK)
        d.rectangle([x+3, y+CH-10, x+CW-3, y+CH-8], fill=(60, 60, 60))
    if m == "D":
        d.rectangle([x+9, y+11, x+CW-9, y+CH], fill=(88, 54, 40), outline=INK)
    if m == "S":
        d.rectangle([x+2, y, x+CW-2, y+9], fill=(200, 80, 60), outline=INK)
        d.rectangle([x+4, y+11, x+CW-4, y+CH-4], fill=GLASS, outline=INK)

_cache = {}

def texture(seed, rows, wall, win="sash", retro=False, status=None):
    """RGB texture for one building face. Cached on all arguments."""
    key = (seed, rows, tuple(wall), win, retro, status)
    if key in _cache:
        return _cache[key]
    _, g = generate(seed, rows)
    img = Image.new("RGB", (COLS*CW, rows*CH), tuple(wall))
    d = ImageDraw.Draw(img)
    for r in range(rows):
        for c in range(COLS):
            _draw_cell(d, c*CW, r*CH, g[r][c], tuple(wall), win, retro)
    if status == "in_progress":
        for k in (0.35, 0.6):
            y = int(rows*CH*(1-k))
            d.line([0, y, COLS*CW, y], fill=INK, width=2)
    if status == "queued":
        d.rectangle([0, rows*CH-7, COLS*CW, rows*CH], fill=(111, 150, 200))
    _cache[key] = img
    return img

def clear_cache():
    _cache.clear()
