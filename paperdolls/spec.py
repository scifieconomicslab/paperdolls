"""render.yaml: the one file that records decisions. The intake writes it and the commands read it. Validation is deliberately strict.

Two kinds of project share the file, told apart by `goal`:
  model_replay   needs name, model.params (with n and run_time), and replay.weeks. Region and style come from `look`.
  place_scene    needs name, place and look.
A file with no `goal` is an older model-replay spec and is read that way.
"""
from pathlib import Path

import yaml

from .fsutil import YamlFileError, read_yaml_mapping
from .render import palettes

REGISTERS = {"colorfigures", "formal"}
GOALS = {"model_replay", "place_scene"}
PLACE_KINDS = {"osm_relation", "bbox", "extract_file", "scene_file", "placeholder"}


class SpecError(ValueError):
    pass


def goal_of(data):
    return (data or {}).get("goal", "model_replay")


def normalise(data):
    """Fill what follows from other answers: replay.palettes from look.region, replay.registers from look.register."""
    if not isinstance(data, dict) or goal_of(data) != "model_replay":
        return data
    look = data.get("look") or {}
    rep = data.setdefault("replay", {}) if (look or "replay" in data) else data.get("replay", {})
    if look.get("region") and not rep.get("palettes"):
        rep["palettes"] = [look["region"]]
    reg = look.get("register")
    if reg and not rep.get("registers"):
        rep["registers"] = ["colorfigures", "formal"] if reg == "both" else [reg]
    return data


def _read(path):
    try:
        return read_yaml_mapping(path)
    except YamlFileError as e:
        raise SpecError(str(e))


def load(path, goal=None):
    """Read and validate a project file. goal: the kind of project the calling command needs."""
    data = _read(path)
    normalise(data)
    validate(data)
    if goal and goal_of(data) != goal:
        want = {"model_replay": "a model replay", "place_scene": "a place scene"}
        raise SpecError(f"this project is {want[goal_of(data)]}, and this command needs {want[goal]}.")
    return data


def _finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def _validate_place(data):
    """What `place` indexes later, checked here so a hand-written file is a SpecError and not a KeyError or IndexError."""
    place, kind = data["place"], data["place"]["kind"]
    if kind == "osm_relation":
        r = place.get("relation")
        if isinstance(r, bool) or not isinstance(r, int) or r <= 0:
            raise SpecError("place.relation must be an OSM relation id (a positive whole number) for place.kind osm_relation")
    elif kind == "bbox":
        b = place.get("bbox")
        if not (isinstance(b, list) and len(b) == 4 and all(_finite(v) for v in b)):
            raise SpecError("place.bbox must be four numbers: south, west, north, east")
        if not (-90 <= b[0] < b[2] <= 90 and -180 <= b[1] < b[3] <= 180):
            raise SpecError("place.bbox must have south below north and west below east, within -90..90 and -180..180")
    elif kind in ("extract_file", "scene_file"):
        key = "extract_path" if kind == "extract_file" else "scene_path"
        if not isinstance(place.get(key), str) or not place[key].strip():
            raise SpecError(f"place.{key} must be the path of a file for place.kind {kind}")
    mb = place.get("max_buildings")
    if mb is not None and (isinstance(mb, bool) or not isinstance(mb, int) or mb <= 0):
        raise SpecError("place.max_buildings must be a positive whole number (leave it out for no limit)")
    out = (data.get("output") or {}).get("dir") if isinstance(data.get("output"), dict) else None
    if out is not None and not isinstance(out, str):
        raise SpecError("output.dir must be a folder name")


def _num(params, key):
    try:
        v = params[key]
        if isinstance(v, bool):
            raise TypeError
        return int(v)
    except (TypeError, ValueError, OverflowError):
        raise SpecError(f"model.params.{key} must be a whole number, not {params.get(key)!r}")


def _need(data, key, typ):
    if key not in data:
        raise SpecError(f"missing key: {key}")
    if not isinstance(data[key], typ):
        raise SpecError(f"{key} must be {typ.__name__}")


def validate(data):
    if not isinstance(data, dict):
        raise SpecError("render.yaml must be a mapping")
    goal = goal_of(data)
    if goal not in GOALS:
        raise SpecError(f"goal must be one of {sorted(GOALS)}")
    _need(data, "name", str)
    families = palettes.load_families()
    if goal == "place_scene":
        _need(data, "place", dict)
        _need(data, "look", dict)
        if data["place"].get("kind") not in PLACE_KINDS:
            raise SpecError(f"place.kind must be one of {sorted(PLACE_KINDS)}")
        if data["look"].get("region") not in families:
            raise SpecError(f"look.region must be one of {sorted(families)}")
        _validate_place(data)
        return True
    _need(data, "model", dict)
    _need(data, "replay", dict)
    params = data["model"].get("params", {})
    if not isinstance(params, dict) or "n" not in params or "run_time" not in params:
        raise SpecError("model.params must include n and run_time")
    n, run_time = _num(params, "n"), _num(params, "run_time")
    if n <= 0 or run_time <= 0:
        raise SpecError("n and run_time must be positive")
    rep = data["replay"]
    weeks = rep.get("weeks", [])
    if not isinstance(weeks, list) or not weeks or any((not isinstance(w, int)) or w < 0 or w >= run_time for w in weeks):
        raise SpecError(f"replay.weeks must be integers within 0..{run_time-1}")
    if rep.get("mapping") is not None:
        _validate_mapping(rep["mapping"])
    leg = rep.get("legend")
    if leg is not None:
        if not isinstance(leg, dict) or not leg or set(leg) - set(STATE_KEYS) - {"investor"} or any(not isinstance(v, str) or not v.strip() for v in leg.values()):
            raise SpecError("replay.legend must map some of to_do, queued, in_progress, finished and investor to a label")
    bad = set(rep.get("registers", [])) - REGISTERS
    if bad:
        raise SpecError(f"unknown registers: {sorted(bad)}")
    if not rep.get("palettes"):
        raise SpecError("replay.palettes must list at least one family id (the intake sets it from look.region)")
    unknown = [p for p in rep["palettes"] if p not in families]
    if unknown:
        raise SpecError(f"unknown palette families: {unknown}. Known: {sorted(families)}")
    return True


STATE_KEYS = ("to_do", "queued", "in_progress", "finished")
RETROFIT_LEGEND = [("To do", "to_do"), ("Queued", "queued"), ("In retrofit", "in_progress"),
                   ("Retrofitted (held)", "finished"), ("Investor-owned (purple roof)", "investor")]


def legend_for(data):
    """The legend a replay frame carries, as (label, key) pairs, so it never describes a model that is not the one drawn.

    replay.legend (a mapping from to_do, queued, in_progress, finished and optionally investor to a label) wins. Without it, the vendored
    Great Retrofit model gets its retrofit labels, and any other model file gets neutral ones ("State 1" to "State 4", no investor entry),
    because the four states are the exporter's codes and mean whatever that model says they mean."""
    legend = (data.get("replay") or {}).get("legend")
    if legend:
        out = [(str(legend[k]), k) for k in STATE_KEYS if k in legend]
        return out + ([(str(legend["investor"]), "investor")] if "investor" in legend else [])
    if (data.get("model") or {}).get("path"):
        return [(f"State {i + 1}", k) for i, k in enumerate(STATE_KEYS)]
    return RETROFIT_LEGEND


CHANNELS = {"wall", "overlay"}
OVERLAYS = {"scaffold", "solar", "band", "marker"}
_HEX = __import__("re").compile(r"^#[0-9a-fA-F]{6}$")


def mapping_for(data):
    """replay.mapping: which model variables to show, and how. An empty list means the four state codes, drawn as before."""
    return list((data.get("replay") or {}).get("mapping") or [])


def mapping_variables(data):
    """The variables the exporter has to record, in mapping order, once each."""
    seen = []
    for m in mapping_for(data):
        if m["variable"] not in seen:
            seen.append(m["variable"])
    return seen


def _validate_mapping(mapping):
    if not isinstance(mapping, list):
        raise SpecError("replay.mapping must be a list")
    for i, m in enumerate(mapping):
        at = f"replay.mapping[{i}]"
        if not isinstance(m, dict):
            raise SpecError(f"{at} must be a mapping")
        if not isinstance(m.get("variable"), str) or not m["variable"].strip():
            raise SpecError(f"{at}.variable must be a name such as building.wealth or owner.income")
        if m.get("channel") not in CHANNELS:
            raise SpecError(f"{at}.channel must be one of {sorted(CHANNELS)}")
        sc = m.get("scale")
        if not isinstance(sc, dict) or sc.get("type") not in ("categorical", "sequential"):
            raise SpecError(f"{at}.scale.type must be categorical or sequential")
        if sc["type"] == "sequential":
            if m["channel"] != "wall":
                raise SpecError(f"{at}: a sequential scale colours walls; an overlay needs a categorical scale")
            dom, cols = sc.get("domain"), sc.get("colours")
            if not (isinstance(dom, list) and len(dom) == 2 and all(isinstance(v, (int, float)) for v in dom) and dom[0] < dom[1]):
                raise SpecError(f"{at}.scale.domain must be [low, high] with low below high")
            if not (isinstance(cols, list) and len(cols) >= 2 and all(isinstance(c, str) and _HEX.match(c) for c in cols)):
                raise SpecError(f"{at}.scale.colours must be at least two #rrggbb colours")
        else:
            vals = sc.get("values")
            if not isinstance(vals, dict) or not vals:
                raise SpecError(f"{at}.scale.values must map each value to its colour or overlay and a label")
            for k, v in vals.items():
                if not isinstance(v, dict) or not isinstance(v.get("label"), str):
                    raise SpecError(f"{at}.scale.values[{k}] needs a label")
                if m["channel"] == "wall" and not (isinstance(v.get("colour"), str) and _HEX.match(v["colour"])):
                    raise SpecError(f"{at}.scale.values[{k}] needs a #rrggbb colour")
                if m["channel"] == "overlay" and v.get("overlay") is not None and v["overlay"] not in OVERLAYS:
                    raise SpecError(f"{at}.scale.values[{k}].overlay must be null or one of {sorted(OVERLAYS)}")


def retrofit_extras(data):
    """True when frames may draw things that belong to the Great Retrofit story (the co-op vans). Only the vendored model has them."""
    return not (data.get("model") or {}).get("path")


def require_confirmed(path):
    """A project made through the intake may be built only after the user said yes to the decision table they were shown.
    A project file written by hand, with no intake section, is not held to this."""
    data = _read(path)
    if "intake" not in data:
        return
    from .intake import Intake
    if not Intake(path).confirmed:
        raise SpecError("the user has not confirmed the decisions. Run 'paperdolls intake next' and follow it to the end: "
                        "show the table, get a yes, and record it.")
