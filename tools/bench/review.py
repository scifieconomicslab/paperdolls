#!/usr/bin/env python3
"""Image helpers for the beauty review (skills/paperdolls-beauty-review).

They compute; they never judge. The reviewer looks at the outputs.

  python tools/bench/review.py pack <round-dir> --exemplar <exemplar-dir>
      The one command a round needs. Measures everything (squint, motion,
      framing, sky, flat patches) against the exemplar, prints a short table
      with FLAG lines, writes metrics.json, and builds the only two images the
      reviewer opens: board.png (exemplar vs world: neighbourhood, street,
      overview) and extras.png (lens, street-90).

  python tools/bench/review.py squint <image.png> [--out <png>]
      Blur (8 px) + greyscale + 3-level posterise, side by side with the
      original. Prints the share of pixels in each value band.

  python tools/bench/review.py sheet <out.png> <img> [<img> ...] [--labels a,b,...]
      Contact sheet: images in a row (wrapping at 3), each scaled to 720 px
      wide, labelled. Use it to put a capture next to an exemplar.

  python tools/bench/review.py diff <a.png> <b.png> [--out <png>]
      Mean absolute pixel change between two frames (0-255), plus a diff
      image. Used on clip frames: ~0 means nothing moved.
"""
import argparse
import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps, ImageStat


def squint(path: Path, out: Path | None) -> int:
    img = Image.open(path).convert("RGB")
    grey = ImageOps.grayscale(img.filter(ImageFilter.GaussianBlur(8)))
    bands = grey.point(lambda v: 0 if v < 85 else (128 if v < 170 else 255))
    hist = bands.histogram()
    total = img.width * img.height
    dark, mid, light = hist[0] / total, hist[128] / total, hist[255] / total
    print(f"value bands  dark {dark:.0%}  mid {mid:.0%}  light {light:.0%}")
    print(f"blurred luminance  mean {ImageStat.Stat(grey).mean[0]:.0f}  stddev {ImageStat.Stat(grey).stddev[0]:.0f}")
    out = out or path.with_name(path.stem + "-squint.png")
    w = img.width // 2
    h = img.height // 2
    sheet = Image.new("RGB", (w * 3, h), "white")
    sheet.paste(img.resize((w, h)), (0, 0))
    sheet.paste(grey.convert("RGB").resize((w, h)), (w, 0))
    sheet.paste(bands.convert("RGB").resize((w, h)), (w * 2, 0))
    sheet.save(out)
    print(out)
    return 0


def sheet(out: Path, images: list[Path], labels: list[str]) -> int:
    tiles = []
    for i, p in enumerate(images):
        im = Image.open(p).convert("RGB")
        scale = 720 / im.width
        im = im.resize((720, max(1, round(im.height * scale))))
        label = labels[i] if i < len(labels) else p.stem
        canvas = Image.new("RGB", (im.width, im.height + 28), "white")
        canvas.paste(im, (0, 28))
        ImageDraw.Draw(canvas).text((8, 6), label, fill=(30, 30, 30))
        tiles.append(canvas)
    cols = min(3, len(tiles))
    rows = (len(tiles) + cols - 1) // cols
    th = max(t.height for t in tiles)
    out_img = Image.new("RGB", (cols * 720 + (cols - 1) * 8, rows * th + (rows - 1) * 8), (235, 235, 235))
    for i, t in enumerate(tiles):
        out_img.paste(t, ((i % cols) * 728, (i // cols) * (th + 8)))
    out_img.save(out)
    print(out)
    return 0


def diff(a: Path, b: Path, out: Path | None) -> int:
    ia, ib = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    if ia.size != ib.size:
        print("images differ in size", file=sys.stderr)
        return 2
    d = ImageChops.difference(ia, ib)
    mean = sum(ImageStat.Stat(d).mean) / 3
    changed = sum(1 for v in ImageOps.grayscale(d).getdata() if v > 12) / (ia.width * ia.height)
    print(f"mean abs change {mean:.2f}/255; pixels changed {changed:.2%}")
    out = out or a.with_name(f"{a.stem}-vs-{b.stem}.png")
    ImageOps.autocontrast(d).save(out)
    print(out)
    return 0


# ---- measured checks (used by pack) -------------------------------------

def _near(a, b, t):
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2]) <= t


def _bands(path: Path) -> dict:
    img = Image.open(path).convert("RGB")
    grey = ImageOps.grayscale(img.filter(ImageFilter.GaussianBlur(8)))
    hist = grey.point(lambda v: 0 if v < 85 else (128 if v < 170 else 255)).histogram()
    total = img.width * img.height
    st = ImageStat.Stat(grey)
    return {"dark": hist[0] / total, "mid": hist[128] / total, "light": hist[255] / total,
            "mean": st.mean[0], "stddev": st.stddev[0]}


def _coverage(path: Path) -> float:
    """Share of the overview frame that is world, not background. Background is
    whatever matches the left or right edge pixel of the same row (sky and void
    are vertical gradients)."""
    im = Image.open(path).convert("RGB").resize((360, 225))
    px, (w, h), n = im.load(), im.size, 0
    for y in range(h):
        left, right = px[0, y], px[w - 1, y]
        n += sum(1 for x in range(w) if not (_near(px[x, y], left, 24) or _near(px[x, y], right, 24)))
    return n / (w * h)


def _sky(overview: Path, shot: Path) -> float:
    """Share of a shot showing the background colour (sky/void) of the overview."""
    o = Image.open(overview).convert("RGB")
    key = o.getpixel((o.width // 2, 3))
    im = Image.open(shot).convert("RGB").resize((360, 225))
    px = im.load()
    return sum(1 for y in range(225) for x in range(360) if _near(px[x, y], key, 30)) / (360 * 225)


def _flat(path: Path) -> float:
    """Largest connected patch of near-identical colour, as a share of the frame.
    Catches untextured land use, bare ground and sky."""
    im = Image.open(path).convert("RGB").filter(ImageFilter.MedianFilter(5)).resize((240, 150))
    px, (w, h) = im.load(), im.size
    seen, best = bytearray(w * h), 0
    for sy in range(h):
        for sx in range(w):
            if seen[sy * w + sx]:
                continue
            c0, q, n = px[sx, sy], deque([(sx, sy)]), 0
            seen[sy * w + sx] = 1
            while q:
                x, y = q.popleft()
                n += 1
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and _near(px[nx, ny], c0, 18):
                        seen[ny * w + nx] = 1
                        q.append((nx, ny))
            best = max(best, n)
    return best / (w * h)


def _motion(round_dir: Path) -> float | None:
    a, b = round_dir / "clip-0.png", round_dir / "clip-5.png"
    if not (a.exists() and b.exists()):
        return None
    ia, ib = Image.open(a).convert("L"), Image.open(b).convert("L")
    if ia.size != ib.size:
        return None
    d = ImageChops.difference(ia, ib)
    return d.point(lambda v: 255 if v > 12 else 0).histogram()[255] / (ia.width * ia.height)


def _tile(path: Path, label: str, width: int) -> Image.Image:
    im = Image.open(path).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)))
    canvas = Image.new("RGB", (width, im.height + 24), "white")
    canvas.paste(im, (0, 24))
    ImageDraw.Draw(canvas).text((6, 5), label, fill=(30, 30, 30))
    return canvas


def _grid(rows: list[list[Image.Image]], out: Path) -> None:
    tw = max(t.width for r in rows for t in r)
    th = max(t.height for r in rows for t in r)
    cols = max(len(r) for r in rows)
    img = Image.new("RGB", (cols * (tw + 6) - 6, len(rows) * (th + 6) - 6), (235, 235, 235))
    for ri, r in enumerate(rows):
        for ci, t in enumerate(r):
            img.paste(t, (ci * (tw + 6), ri * (th + 6)))
    img.save(out)


SHOTS = ("neighbourhood", "street", "overview")


def pack(round_dir: Path, exemplar: Path) -> int:
    for d in (round_dir, exemplar):
        missing = [s for s in SHOTS if not (d / f"{s}.png").exists()]
        if missing:
            print(f"{d}: missing {', '.join(missing)}.png", file=sys.stderr)
            return 2
    m = {"world": {}, "exemplar": {}}
    for key, d in (("world", round_dir), ("exemplar", exemplar)):
        m[key]["squint"] = {s: _bands(d / f"{s}.png") for s in SHOTS}
        m[key]["coverage_overview"] = _coverage(d / "overview.png")
        m[key]["sky_neighbourhood"] = _sky(d / "overview.png", d / "neighbourhood.png")
        m[key]["flat_neighbourhood"] = _flat(d / "neighbourhood.png")
        m[key]["flat_street"] = _flat(d / "street.png")
    m["world"]["motion_pixels"] = _motion(round_dir)
    w, e = m["world"], m["exemplar"]
    flags = []
    nb, enb = w["squint"]["neighbourhood"], e["squint"]["neighbourhood"]
    if nb["light"] < enb["light"] - 0.005:
        flags.append(f"value: neighbourhood light share {nb['light']:.0%} < exemplar {enb['light']:.0%}")
    if not 100 <= nb["mean"] <= 130:
        flags.append(f"value: neighbourhood squint mean {nb['mean']:.0f} outside 100-130")
    if nb["stddev"] < enb["stddev"] - 3:
        flags.append(f"value: neighbourhood contrast (stddev {nb['stddev']:.0f}) below exemplar {enb['stddev']:.0f}")
    if w["coverage_overview"] < 0.8 * e["coverage_overview"]:
        flags.append(f"framing: overview world covers {w['coverage_overview']:.0%} of frame, exemplar {e['coverage_overview']:.0%} (camera §3)")
    if w["sky_neighbourhood"] > 0.02:
        flags.append(f"framing: sky/void is {w['sky_neighbourhood']:.0%} of the neighbourhood shot (camera §3)")
    for s in ("neighbourhood", "street"):
        v, ev = w[f"flat_{s}"], e[f"flat_{s}"]
        if v > max(0.05, 1.5 * ev):
            flags.append(f"ground: a flat untextured patch covers {v:.0%} of {s} (exemplar {ev:.0%}); find it on the board (streets-and-ground, nature-and-water)")
    mo = w["motion_pixels"]
    if mo is not None and mo < 0.005:
        flags.append(f"life: only {mo:.2%} of street pixels change across the clip (life §2)")
    m["flags"] = flags
    (round_dir / "metrics.json").write_text(json.dumps(m, indent=2))
    _grid([[_tile(exemplar / f"{s}.png", f"exemplar - {s}", 640) for s in SHOTS],
           [_tile(round_dir / f"{s}.png", f"this world - {s}", 640) for s in SHOTS]], round_dir / "board.png")
    extras = [_tile(round_dir / f"{s}.png", s, 640) for s in ("lens", "street-90") if (round_dir / f"{s}.png").exists()]
    if extras:
        _grid([extras], round_dir / "extras.png")
    print(f"{'':16s}{'world':>10s}{'exemplar':>10s}")
    print(f"{'squint nb':16s}{nb['dark']:>4.0%}/{nb['mid']:.0%}/{nb['light']:.0%} mean {nb['mean']:.0f}   exemplar {enb['dark']:.0%}/{enb['mid']:.0%}/{enb['light']:.0%} mean {enb['mean']:.0f}")
    print(f"{'overview cover':16s}{w['coverage_overview']:>10.0%}{e['coverage_overview']:>10.0%}")
    print(f"{'nb sky':16s}{w['sky_neighbourhood']:>10.1%}{e['sky_neighbourhood']:>10.1%}")
    print(f"{'flat nb/street':16s}{w['flat_neighbourhood']:>5.0%}/{w['flat_street']:.0%}{e['flat_neighbourhood']:>6.0%}/{e['flat_street']:.0%}")
    print(f"{'clip motion':16s}{'n/a' if mo is None else f'{mo:.2%}':>10s}")
    for f in flags:
        print("FLAG", f)
    if not flags:
        print("no flags")
    print(round_dir / "board.png")
    if extras:
        print(round_dir / "extras.png")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("squint"); s.add_argument("image", type=Path); s.add_argument("--out", type=Path)
    c = sub.add_parser("sheet"); c.add_argument("out", type=Path); c.add_argument("images", type=Path, nargs="+")
    c.add_argument("--labels", default="")
    pk = sub.add_parser("pack"); pk.add_argument("round_dir", type=Path)
    pk.add_argument("--exemplar", type=Path, default=Path("reference/exemplars/real-nw-ashford"))
    d = sub.add_parser("diff"); d.add_argument("a", type=Path); d.add_argument("b", type=Path); d.add_argument("--out", type=Path)
    args = ap.parse_args()
    if args.cmd == "pack":
        return pack(args.round_dir, args.exemplar)
    if args.cmd == "squint":
        return squint(args.image, args.out)
    if args.cmd == "sheet":
        return sheet(args.out, args.images, [x for x in args.labels.split(",") if x])
    return diff(args.a, args.b, args.out)


if __name__ == "__main__":
    sys.exit(main())
