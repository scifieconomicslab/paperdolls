"""render.yaml: the one file that records decisions. The intake writes it and the commands read it. Validation is deliberately strict.

Two kinds of project share the file, told apart by `goal`:
  model_replay   needs name, model.params (with n and run_time), and replay.weeks. Region and style come from `look`.
  place_scene    needs name, place and look.
A file with no `goal` is an older model-replay spec and is read that way.
"""
from pathlib import Path

import yaml

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


def load(path, goal=None):
    """Read and validate a project file. goal: the kind of project the calling command needs."""
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    normalise(data)
    validate(data)
    if goal and goal_of(data) != goal:
        want = {"model_replay": "a model replay", "place_scene": "a place scene"}
        raise SpecError(f"this project is {want[goal_of(data)]}, and this command needs {want[goal]}.")
    return data


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
        return True
    _need(data, "model", dict)
    _need(data, "replay", dict)
    params = data["model"].get("params", {})
    if not isinstance(params, dict) or "n" not in params or "run_time" not in params:
        raise SpecError("model.params must include n and run_time")
    if int(params["n"]) <= 0 or int(params["run_time"]) <= 0:
        raise SpecError("n and run_time must be positive")
    rep = data["replay"]
    weeks = rep.get("weeks", [])
    if not weeks or any((not isinstance(w, int)) or w < 0 or w >= int(params["run_time"]) for w in weeks):
        raise SpecError(f"replay.weeks must be integers within 0..{int(params['run_time'])-1}")
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


def require_confirmed(path):
    """A project made through the intake may be built only after the user said yes to the decision table they were shown.
    A project file written by hand, with no intake section, is not held to this."""
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    if "intake" not in data:
        return
    from .intake import Intake
    if not Intake(path).confirmed:
        raise SpecError("the user has not confirmed the decisions. Run 'paperdolls intake next' and follow it to the end: "
                        "show the table, get a yes, and record it.")
