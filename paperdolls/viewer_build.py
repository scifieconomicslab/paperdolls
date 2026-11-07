"""Build the self-contained viewer and catalogue pages from the templates and libraries in viz/.

A page is one HTML file with every script inlined, so it opens by double-click and needs no server or network.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIZ = ROOT / "viz"
LIBS = {"ASSETLIB": "assetlib.js", "BUILDINGLIB": "buildinglib.js", "TREELIB": "treelib.js", "VIZLIB": "vizlib.js", "REPLAY": "replay.js", "ZOOMHOLD": "zoomhold.js", "REFOCUS": "refocus.js", "CAMERA": "camera.js", "CONTROLS": "controls.js",
        "PACKVALIDATE": "packvalidate.js", "PACKSTORE": "packstore.js", "PACKRUNTIME": "packruntime.js", "PACKHOST": "packhost.js", "PACKPICK": "packpick.js", "PACKWORKER": "packworker.js", "PACKCHARTS": "packcharts.js", "PACKDASH": "packdash.js"}


def _read(name):
    return (VIZ / name).read_text(encoding="utf-8")


def _json_for_script(obj):
    """JSON that is safe inside a <script> element: a literal </script> or <!-- cannot close or confuse it."""
    return json.dumps(obj, separators=(",", ":")).replace("</", "<\\/").replace("<!--", "<\\!--")


_PLACEHOLDER = re.compile(r"/\*__([A-Z0-9]+)__\*/")


def _fill(template, **extra):
    """Replace the /*__KEY__*/ markers of a template in ONE pass. What is put in (a library, the palettes, a manifest, a scene, a runtime) is never scanned
    again, so a marker that appears inside it (a banner mentioning /*__SCENE__*/, a library's own comment) stays text."""
    values = {key: None for key in LIBS}                     # libraries and palettes are read only when the template has their marker
    values["PALETTES"] = None
    values.update(extra)

    def sub(match):
        key = match.group(1)
        if key not in values:
            return match.group(0)
        v = values[key]
        if v is None:
            v = _json_for_script(json.loads((ROOT / "assets" / "palettes.json").read_text(encoding="utf-8"))) if key == "PALETTES" else _read(LIBS[key])
            values[key] = v
        return v
    return _PLACEHOLDER.sub(sub, template)


def build_viewer(scene=None, initial=None, title="Paperdolls viewer", replay=None):
    """The viewer page. With a scene, the page opens on it; without one it shows the synthetic placeholder.

    initial: optional {"region", "look", "reg", "drive"} to start with.
    replay: optional model replay payload (see replay_build.payload); the page then plays it through the scene."""
    esc = title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return _fill(_read("viewer.html"), TITLE=esc, INITIAL=_json_for_script(initial or {}), SCENE=_json_for_script(scene) if scene is not None else "null",
                 REPLAYDATA=_json_for_script(replay) if replay is not None else "null")


def build_catalogue():
    return _fill(_read("library_catalogue.html"))
