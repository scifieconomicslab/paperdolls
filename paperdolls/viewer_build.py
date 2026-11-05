"""Build the self-contained viewer and catalogue pages from the templates and libraries in viz/.

A page is one HTML file with every script inlined, so it opens by double-click and needs no server or network.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIZ = ROOT / "viz"
LIBS = {"ASSETLIB": "assetlib.js", "BUILDINGLIB": "buildinglib.js", "TREELIB": "treelib.js", "VIZLIB": "vizlib.js", "CAMERA": "camera.js", "CONTROLS": "controls.js"}


def _read(name):
    return (VIZ / name).read_text(encoding="utf-8")


def _json_for_script(obj):
    """JSON that is safe inside a <script> element: a literal </script> or <!-- cannot close or confuse it."""
    return json.dumps(obj, separators=(",", ":")).replace("</", "<\\/").replace("<!--", "<\\!--")


def _fill(template, **extra):
    out = template
    for key, filename in LIBS.items():
        out = out.replace(f"/*__{key}__*/", _read(filename))
    out = out.replace("/*__PALETTES__*/", _json_for_script(json.loads((ROOT / "assets" / "palettes.json").read_text(encoding="utf-8"))))
    for key, value in extra.items():
        out = out.replace(f"/*__{key}__*/", value)
    return out


def build_viewer(scene=None, initial=None, title="Paperdolls viewer"):
    """The viewer page. With a scene, the page opens on it; without one it shows the synthetic placeholder.

    initial: optional {"region", "look", "reg", "drive"} to start with."""
    esc = title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return _fill(_read("viewer.html"), TITLE=esc, INITIAL=_json_for_script(initial or {}), SCENE=_json_for_script(scene) if scene is not None else "null")


def build_catalogue():
    return _fill(_read("library_catalogue.html"))
