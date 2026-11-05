"""Single-file replay page. Keyframes are rendered in Python and embedded as PNG (works offline)."""
import base64, html as H
from io import BytesIO

LABELS = {"colorfigures": "Colorfigures register", "formal": "Formal register"}

def _png_b64(img):
    buf = BytesIO(); img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()

def build_page(sp, traj, fams, layout, renderer, codes_fn):
    from .. import spec as specmod
    legend = specmod.legend_for(sp)
    name = H.escape(sp["name"])
    note = H.escape(sp.get("notes", "Illustrative replay. Layout, people and vehicles invented. Palettes proposed, not sampled."))
    sections = []
    for pid in sp["replay"]["palettes"]:
        fam = fams[pid]
        rows = []
        for reg in sp["replay"]["registers"]:
            cells = []
            for w in sp["replay"]["weeks"]:
                img = renderer.frame(fam, reg, codes_fn(traj, w), f"Week {w}",
                                     investor=codes_fn(traj, w, "investor"), legend=legend)
                cells.append(f'<figure><img src="data:image/png;base64,{_png_b64(img)}" alt="{H.escape(fam["name"])}, {reg}, week {w}"><figcaption>Week {w}</figcaption></figure>')
            rows.append(f'<h3>{LABELS[reg]}</h3><div class="row">{"".join(cells)}</div>')
        swatches = "".join(f'<span class="sw" title="{k}" style="background:{fam[k]}"></span>' for k in ("wall","wall2","roof","ground","accent","shadow"))
        sections.append(f'<section id="{pid}"><h2>{H.escape(fam["name"])} <small>{H.escape(fam["places"])}</small></h2><div class="sws">{swatches}</div>{"".join(rows)}</section>')
    nav = "".join(f'<a href="#{pid}">{H.escape(fams[pid]["name"])}</a>' for pid in sp["replay"]["palettes"])
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{name}</title>
<style>
body{{margin:0;font:14px/1.45 system-ui,sans-serif;color:#231e16;background:#f4f1ea}}
header{{padding:20px 28px 8px}} h1{{font-size:22px;margin:0 0 6px}} .note{{color:#5d5950;max-width:960px}}
nav{{position:sticky;top:0;background:#fbfaf6;border-bottom:1px solid #d6d1c4;padding:10px 28px;display:flex;gap:12px;flex-wrap:wrap;z-index:5}}
nav a{{color:#231e16;font-size:13px}} main{{padding:14px 28px 60px}}
section{{margin:24px 0;border-top:1px solid #d6d1c4;padding-top:12px}} h2{{font-size:17px;margin:0 0 6px}} h2 small{{font-weight:400;color:#5d5950}}
h3{{font-size:14px;margin:12px 0 6px}} .sws{{display:flex;gap:6px;margin-bottom:8px}} .sw{{width:34px;height:22px;border:1px solid #231e16;border-radius:3px}}
.row{{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:10px}}
figure{{margin:0;background:#fff;border:1px solid #cfc8b8;border-radius:6px;padding:6px}} figure img{{width:100%;display:block}}
figcaption{{font-size:12px;color:#5d5950;padding-top:4px}}
</style></head><body>
<header><h1>{name}</h1><div class="note">{note}</div></header>
<nav>{nav}</nav><main>{"".join(sections)}</main></body></html>"""
