"""The replay page: the viewer, a scene, and a model's trajectory played through it with a legend made from the mapping.

Model building k (in id order) is drawn on scene building k. That placement is invented and the page says so.
"""
import numpy as np

from . import export, spec as specmod
from .viewer_build import build_viewer

NOTE = ("Placement invented: each model building is drawn on a scene building in a fixed order, so where it stands carries no meaning. "
        "Layout, people and vehicles are decoration. Colours and building styles are proposals.")


def _state_codes(mapping):
    """Categorical keys for a building.state or owner.state variable may be the state names; the exporter records the codes."""
    out = []
    for m in mapping:
        m = {**m, "scale": dict(m["scale"])}
        if m["variable"].endswith(".state") and m["scale"]["type"] == "categorical":
            m["scale"]["values"] = {str(export.CODE.get(k, k)): v for k, v in m["scale"]["values"].items()}
        else:
            if m["scale"]["type"] == "categorical":
                m["scale"]["values"] = {str(k): v for k, v in m["scale"]["values"].items()}
        out.append(m)
    return out


def _clean(a):
    return [None if not np.isfinite(v) else (int(v) if float(v).is_integer() else round(float(v), 6)) for v in a]


def payload(sp, traj):
    """The data the page embeds: one entry per recorded week, indexed by model building in id order."""
    mapping = _state_codes(specmod.mapping_for(sp))
    weeks = []
    for t, (ids, codes, inv) in enumerate(traj["weeks"]):
        order = np.argsort(ids, kind="stable")
        w = {"codes": codes[order].tolist(), "investor": inv[order].tolist()}
        if mapping:
            w["vars"] = {name: _clean(arr[t][order]) for name, arr in traj["vars"].items()}
        weeks.append(w)
    states = [{"key": k, "label": label} for label, k in specmod.legend_for(sp)]
    n = len(traj["weeks"][0][0]) if traj["weeks"] else 0
    return {"weeks": weeks, "mapping": mapping, "states": states, "n": n, "note": NOTE}


def build_page(sp, traj, scene=None):
    look = sp.get("look") or {}
    initial = {k: v for k, v in {"region": look.get("region"), "look": look.get("look"), "reg": look.get("register")}.items() if v}
    if initial.get("reg") == "both":
        initial["reg"] = "colorfigures"
    return build_viewer(scene, initial, title=sp["name"], replay=payload(sp, traj))
