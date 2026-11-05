"""Isometric block renderer driven by exported model state.

Replay only (v1): each frame is drawn from the states in one week of a trajectory.
Building positions are illustrative: building i is placed on the i-th free cell of a generated grid.
"""
import random
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from .palettes import REGISTERS, family_palette
from . import facades

STATE_NAMES = {0: "to_do", 1: "queued", 2: "in_progress", 3: "finished"}
LEGEND = [("To do", "to_do"), ("Queued", "queued"), ("In retrofit", "in_progress"),
          ("Retrofitted (held)", "finished"), ("Investor-owned (purple roof)", "investor")]

def _mix(a, b, t):
    return tuple(int(a[i]*(1-t) + b[i]*t) for i in range(3))

def _sc(c, k):
    return tuple(max(0, min(255, int(v*k))) for v in c)

def _font(sz, bold=False):
    for p in (["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"] if bold else ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]):
        try:
            return ImageFont.truetype(p, sz)
        except OSError:
            pass
    return ImageFont.load_default()

class Layout:
    """Grid with an avenue on the front row, a cross street on the right edge,
    a square in the middle and a two-lane boulevard running out to the left edge."""

    def __init__(self, n_buildings):
        cols, rows = 8, 6
        while True:
            cells = self._cells(cols, rows)
            if len(cells) >= n_buildings:
                break
            if cols <= rows + 2:
                cols += 2
            else:
                rows += 1
        self.cols, self.rows = cols, rows
        self.cells = cells[:n_buildings]
        self.ROW = rows - 1
        self.COL = cols - 1
        self.sq = (cols // 2 - 1, rows // 2 - 1)           # square: cells sq..sq+2 in both directions
        self.bl_rows = (self.sq[1] + 1, self.sq[1] + 2)    # boulevard rows
        self.square_cells = {(c, r) for c in range(self.sq[0], self.sq[0]+3) for r in range(self.sq[1], self.sq[1]+3)}

    @staticmethod
    def _cells(cols, rows):
        ROW, COL = rows - 1, cols - 1
        sq0c, sq0r = cols // 2 - 1, rows // 2 - 1
        bl = (sq0r + 1, sq0r + 2)
        out = []
        for r in range(ROW):
            for c in range(COL):
                if sq0c <= c <= sq0c + 2 and sq0r <= r <= sq0r + 2:
                    continue
                if c < sq0c and r in bl:
                    continue
                out.append((c, r))
        return out

class Renderer:
    def __init__(self, layout, seed):
        self.L = layout
        self.seed = seed
        self.W, self.H = 1500, 1000
        span = layout.cols + layout.rows
        self.TW = max(30, min(130, int(2 * self.W * 0.86 / span)))
        self.TH = self.TW // 2
        self.STOREY = max(8, int(self.TW * 0.22))
        # centre the grid horizontally, and place its middle at 42% of the height
        self.ox = self.W / 2 - (layout.cols - layout.rows) * self.TW / 4
        self.oy = self.H * 0.49 - span * self.TH / 4

    def P(self, c, r, z):
        return (self.ox + (c - r) * self.TW / 2, self.oy + (c + r) * self.TH / 2 - z)

    def _paste(self, img, quad, tex):
        P0 = np.array(quad[0], float)
        e1 = np.array(quad[1], float) - P0
        e2 = np.array(quad[3], float) - P0
        Mi = np.linalg.inv(np.column_stack([e1, e2]))
        xs = [p[0] for p in quad]; ys = [p[1] for p in quad]
        minx, miny = int(min(xs)) - 1, int(min(ys)) - 1
        bw, bh = int(max(xs)) - minx + 2, int(max(ys)) - miny + 2
        W, H = tex.size
        ox, oy = minx - P0[0], miny - P0[1]
        a = Mi[0, 0]*W; b = Mi[0, 1]*W; c = (Mi[0, 0]*ox + Mi[0, 1]*oy)*W
        dd = -Mi[1, 0]*H; e = -Mi[1, 1]*H; f = (1 - (Mi[1, 0]*ox + Mi[1, 1]*oy))*H
        warped = tex.transform((bw, bh), Image.AFFINE, (a, b, c, dd, e, f), resample=Image.NEAREST)
        mask = Image.new("L", (bw, bh), 0)
        ImageDraw.Draw(mask).polygon([(p[0]-minx, p[1]-miny) for p in quad], fill=255)
        img.paste(warped, (minx, miny), mask)

    def frame(self, palette_fam, register, codes, week_label="", investor=None, legend=None):
        """Return a PIL image. codes[i] = state code of building i (see STATE_NAMES).
        investor[i] = 1 if building i is owned by an investor household (purple roof)."""
        pal = family_palette(palette_fam)
        R = REGISTERS[register]
        L = self.L
        img = Image.new("RGB", (self.W, self.H), R["bg"])
        d = ImageDraw.Draw(img)
        ink = R["ink"]; lw = R["lw"]
        # ground
        for c in range(L.cols):
            for r in range(L.rows):
                pts = [self.P(c, r, 0), self.P(c+1, r, 0), self.P(c+1, r+1, 0), self.P(c, r+1, 0)]
                road = (r == L.ROW or c == L.COL or (r in L.bl_rows and c < L.sq[0]))
                insq = (c, r) in L.square_cells
                fill = pal["road"] if road else (pal["pave"] if insq else pal["ground"])
                d.polygon(pts, fill=fill)
        # boulevard out past the left edge
        d.polygon([self.P(-2.6, L.bl_rows[0], 0), self.P(L.sq[0], L.bl_rows[0], 0),
                   self.P(L.sq[0], L.bl_rows[1]+1, 0), self.P(-2.6, L.bl_rows[1]+1, 0)], fill=pal["road"])
        for k in (L.bl_rows[0]-0.07, L.bl_rows[1]+1.0):
            d.polygon([self.P(-2.6, k, 0), self.P(L.sq[0], k, 0), self.P(L.sq[0], k+0.07, 0), self.P(-2.6, k+0.07, 0)], fill=pal["pave"])
        # tram rails on the avenue
        for off in (L.ROW+0.35, L.ROW+0.65):
            d.line([self.P(0, off, 0), self.P(L.cols, off, 0)], fill=(120, 112, 100), width=2)
        # shadows
        for i, (c, r) in enumerate(L.cells):
            h = self._height(i)
            dx, dy = -h*0.38, h*0.10
            pts = [self.P(c, r, 0), self.P(c+1, r, 0), self.P(c+1, r+1, 0), self.P(c, r+1, 0)]
            d.polygon([(x+dx, y+dy) for x, y in pts], fill=_mix(pal["shadow"], R["bg"], 0.72))
        # depth-sorted items: buildings, trees, vehicles, people
        items = []
        for i, (c, r) in enumerate(L.cells):
            items.append((c + r + 1.0, "b", i))
        rng = random.Random(self.seed + 17)
        for k in range(max(2, L.cols // 2)):
            items.append((float(k*2 + L.sq[0] + L.sq[1]) + 0.5, "t", (L.sq[0] + 0.2 + (k % 2)*2.6, L.sq[1] + 0.2 + (k//2 % 2)*2.6)))
        cars_fr = [0.10, 0.28, 0.46, 0.66]
        for i, fr in enumerate(cars_fr):
            cx = L.cols*fr; cy = L.ROW + (0.2 if i % 2 == 0 else 0.7)
            items.append((cx + 0.25 + cy + 0.13, "car", (cx, cy, i)))
        items.append((L.cols*0.36 + 0.3 + L.ROW + 0.7 + 0.15, "van", (L.cols*0.36, L.ROW+0.7)))
        items.append((L.cols*0.74 + 0.3 + L.ROW + 0.2 + 0.15, "van", (L.cols*0.74, L.ROW+0.2)))
        items.append((L.cols*0.56 + 0.2 + L.ROW + 0.7 + 0.14, "bike", (L.cols*0.56, L.ROW+0.7)))
        items.append((L.cols*0.18 + 0.2 + L.ROW + 0.2 + 0.14, "bike", (L.cols*0.18, L.ROW+0.2)))
        items.append((L.cols*0.5 + L.ROW + 0.5, "tram", (0.4, L.cols - 0.8, L.ROW + 0.35)))
        items.append((-1.6 + 2.3 + 0.4, "car", (-1.6, 2.3, 9)))
        items.append((-2.2 + 3.4 + 0.5, "bus", (-2.2, 3.4)))
        items.append((L.sq[0] + 1.5 + L.sq[1] + 1.5, "fountain", (L.sq[0] + 1.5, L.sq[1] + 1.5)))
        for k in range(max(6, L.cols)):
            pc = rng.uniform(0, L.cols); pr = L.ROW - 0.1 if rng.random() < 0.5 else L.ROW + 1.05
            items.append((pc + pr + 0.05, "p", (pc, pr, k)))
        for k in range(8):
            pc = L.sq[0] + rng.uniform(0.2, 2.8); pr = L.sq[1] + rng.uniform(0.2, 2.8)
            items.append((pc + pr + 0.05, "p", (pc, pr, k+50)))
        items.sort(key=lambda t: t[0])
        for _, kind, v in items:
            if kind == "b":
                self._building(img, d, v, codes, pal, R, investor)
            elif kind == "t":
                self._tree(d, v, R)
            elif kind == "car":
                self._car(d, v[0], v[1], v[2], pal, R)
            elif kind == "van":
                self._van(d, v[0], v[1], R)
            elif kind == "bike":
                self._bike(d, v[0], v[1], R)
            elif kind == "bus":
                self._bus(d, v[0], v[1], R)
            elif kind == "tram":
                self._tram(d, v[0], v[1], v[2], R)
            elif kind == "fountain":
                self._fountain(d, v[0], v[1], R)
            elif kind == "p":
                self._person(d, v[0], v[1], v[2], R)
        # title and legend
        title = f"{palette_fam['name']} · {R['label']}"
        d.text((34, 24), title, font=_font(26, True), fill=ink)
        d.text((34, 60), f"{week_label}  Layout and vehicles illustrative. Palette proposed, not sampled.", font=_font(15), fill=ink)
        for i, (label, key) in enumerate(LEGEND if legend is None else legend):
            x = 34 + (i % 3)*330; y = 900 + (i // 3)*30
            col = (_mix(pal["roof"], R["investor"], 0.55) if key == "investor" else self._state_colour(key, pal, R))
            d.rectangle([x, y, x+20, y+20], fill=col, outline=ink)
            d.text((x+28, y+2), label, font=_font(14), fill=ink)
        return img

    # --- helpers -------------------------------------------------------
    def _box(self, d, c0, r0, z0, c1, r1, z1, base, R):
        top = _sc(base, R["tones"][0]); front = _sc(base, R["tones"][1]); side = _sc(base, R["tones"][2])
        A = [self.P(c0, r1, z0), self.P(c1, r1, z0), self.P(c1, r1, z1), self.P(c0, r1, z1)]
        B = [self.P(c1, r0, z0), self.P(c1, r1, z0), self.P(c1, r1, z1), self.P(c1, r0, z1)]
        T = [self.P(c0, r0, z1), self.P(c1, r0, z1), self.P(c1, r1, z1), self.P(c0, r1, z1)]
        d.polygon(A, fill=front, outline=R["ink"], width=R["lw"])
        d.polygon(B, fill=side, outline=R["ink"], width=R["lw"])
        d.polygon(T, fill=top, outline=R["ink"], width=R["lw"])

    def _height(self, i):
        return (2 + (i * 7919 + self.seed) % 4) * self.STOREY

    def _state_colour(self, key, pal, R):
        return {"to_do": pal["wall"], "queued": _mix(pal["wall"], R["queued"], 0.6),
                "in_progress": R["inprog"], "finished": R["finished"]}[key]

    def _building(self, img, d, i, codes, pal, R, investor=None):
        c, r = self.L.cells[i]
        code = int(codes[i]) if i < len(codes) else 0
        key = STATE_NAMES.get(code, "to_do")
        base = self._state_colour(key, pal, R)
        h = self._height(i)
        rows = h // self.STOREY + 2
        seed = self.seed + i * 2654435761 % 2**31
        k = random.Random(seed).uniform(0.93, 1.07)
        wall = tuple(max(0, min(255, int(v*k))) for v in base)
        win = "sash" if random.Random(seed+1).random() < 0.6 else "casement"
        status = key if key in ("in_progress", "queued") else None
        retro = key == "finished"
        texA = facades.texture(seed, rows, wall, win, retro, status)
        texB = facades.texture(seed + 7919, rows, wall, win, retro, status)
        # shadow
        dx, dy = -h*0.38, h*0.10
        sh = [self.P(c, r, 0), self.P(c+1, r, 0), self.P(c+1, r+1, 0), self.P(c, r+1, 0)]
        d.polygon([(x+dx, y+dy) for x, y in sh], fill=_mix(pal["shadow"], R["bg"], 0.72))
        A = [self.P(c, r+1, 0), self.P(c+1, r+1, 0), self.P(c+1, r+1, h), self.P(c, r+1, h)]
        B = [self.P(c+1, r, 0), self.P(c+1, r+1, 0), self.P(c+1, r+1, h), self.P(c+1, r, h)]
        T = [self.P(c, r, h), self.P(c+1, r, h), self.P(c+1, r+1, h), self.P(c, r+1, h)]
        self._paste(img, A, texA)
        self._paste(img, B, texB)
        roof = _mix(pal["roof"], R["investor"], 0.55) if (investor is not None and i < len(investor) and investor[i] == 1) else _sc(base, 1.14)
        d.polygon(T, fill=roof, outline=R["ink"])
        d.line(A + [A[0]], fill=R["ink"], width=R["lw"])
        d.line(B + [B[0]], fill=R["ink"], width=R["lw"])
        if key == "queued":
            d.line([self.P(c+1, r+1, 8), self.P(c, r+1, 8)], fill=R["queued"], width=5)

    def _tree(self, d, v, R):
        x, y = self.P(v[0], v[1], 0)
        d.ellipse([x-22, y-54, x+22, y-14], fill=_mix((120, 150, 110), R["bg"], 0.15), outline=R["ink"], width=R["lw"])
        d.line([(x, y-14), (x, y)], fill=R["ink"], width=R["lw"])

    def _car(self, d, c, r, i, pal, R):
        cols = [(90,108,134),(160,88,62),(216,208,190),(62,76,74),(122,138,152)]
        col = cols[i % len(cols)]
        self._box(d, c, r, 0, c+0.5, r+0.26, 11, col, R)
        self._box(d, c+0.12, r+0.04, 11, c+0.38, r+0.22, 19, _sc(col, 0.85), R)

    def _van(self, d, c, r, R):
        self._box(d, c, r, 0, c+0.62, r+0.3, 22, R["coop"], R)
        x, y = self.P(c+0.2, r+0.3, 11)
        d.text((x-12, y-6), "CO-OP", font=_font(9, True), fill=R["ink"])

    def _bike(self, d, c, r, R):
        x, y = self.P(c, r, 0)
        for dx in (-12, 12):
            d.ellipse([x+dx-7, y-13, x+dx+7, y+1], outline=R["ink"], width=R["lw"])
        d.rectangle([x+8, y-30, x+26, y-18], fill=R["coop"], outline=R["ink"], width=R["lw"])

    def _bus(self, d, c, r, R):
        self._box(d, c, r, 0, c+1.0, r+0.3, 28, (236, 226, 200), R)
        self._box(d, c, r, 0, c+1.0, r+0.3, 6, R["tram"], R)

    def _tram(self, d, c0, c1, r, R):
        self._box(d, c0, r, 0, c1, r+0.3, 30, R["tram"], R)

    def _fountain(self, d, c, r, R):
        x, y = self.P(c, r, 0)
        d.ellipse([x-46, y-20, x+46, y+20], fill=(200, 196, 186), outline=R["ink"], width=R["lw"])
        d.ellipse([x-38, y-15, x+38, y+15], fill=(170, 205, 222), outline=R["ink"], width=R["lw"])

    def _person(self, d, c, r, k, R):
        x, y = self.P(c, r, 0)
        col = R["figure"][k % len(R["figure"])]
        d.line([(x-3, y-14), (x-3, y)], fill=R["ink"], width=R["lw"])
        d.line([(x+3, y-14), (x+3, y)], fill=R["ink"], width=R["lw"])
        d.rounded_rectangle([x-6, y-34, x+6, y-13], radius=3, fill=col, outline=R["ink"], width=R["lw"])
        d.ellipse([x-4.5, y-45, x+4.5, y-36], fill=(250, 240, 225), outline=R["ink"], width=R["lw"])
