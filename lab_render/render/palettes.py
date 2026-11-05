"""Palette families and register styling. Values are proposed starting points (see assets/palettes.json)."""
import json
from pathlib import Path

REGISTERS = {
    "colorfigures": dict(bg=(242,239,231), ink=(35,30,22), lw=2, tones=(1.14,1.0,0.76),
                         inprog=(244,184,41), queued=(111,150,200), finished=(147,211,176),
                         investor=(142,128,172), coop=(147,211,176), tram=(200,69,47),
                         figure=[(252,250,243),(244,162,140),(120,170,200),(230,200,90)],
                         label="Colorfigures register"),
    "formal": dict(bg=(246,245,241), ink=(58,58,60), lw=1, tones=(1.06,1.0,0.86),
                   inprog=(201,168,90), queued=(127,152,178), finished=(110,165,138),
                   investor=(138,134,160), coop=(60,140,140), tram=(122,74,64),
                   figure=[(150,153,158),(120,120,126),(170,160,150),(105,118,132)],
                   label="Formal register"),
}

def _hex(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def load_families(path=None):
    p = Path(path) if path else Path(__file__).resolve().parents[2] / "assets" / "palettes.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    return {f["id"]: f for f in data["families"]}

def family_palette(fam):
    """Convert a family record to RGB tuples used by the renderer."""
    g = _hex(fam["ground"])
    return dict(
        wall=_hex(fam["wall"]), wall2=_hex(fam["wall2"]), roof=_hex(fam["roof"]),
        ground=g, accent=_hex(fam["accent"]), shadow=_hex(fam["shadow"]),
        road=tuple(int(v*0.9) for v in g),
        pave=tuple(min(255, int(v + (255-v)*0.35)) for v in g),
    )
