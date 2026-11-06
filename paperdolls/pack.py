"""Model packs: load, validate and build the page for a pack (a folder with pack.yaml and a runtime).

The rules are the same as viz/packvalidate.js (both are tested against tests/pack_cases.json) and are written up in docs/pack-spec.md.
`paperdolls pack check` runs `check`; `paperdolls pack build` runs `build_page`.
"""
import json
import re
from pathlib import Path

import yaml

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
SLUG = re.compile(r"^[a-z][a-z0-9-]*$")
NAME = re.compile(r"^[a-z][a-z0-9_]*$")
RUNTIMES = ["js", "pyodide", "remote"]
PARAM_TYPES = ["number", "integer", "boolean", "enum"]
FIELD_TYPES = ["category", "number", "int", "boolean"]
CHANNELS = ["wall", "overlay"]
PLANNED_CHANNELS = ["segments", "height", "outline", "halo", "insulation", "ground"]
OVERLAYS = ["scaffold", "solar", "band", "marker"]
REGIONS = ["left", "right", "bottom"]
CONTROLS = ["params", "presets", "timeline", "legend", "display"]
PLANNED_ITEMS = ["chart", "kpis", "table"]
TOP = ["spec", "id", "title", "description", "runtime", "time", "params", "presets", "entities", "mappings", "series", "layout", "banner"]


class PackError(ValueError):
    pass


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


def _is_int(v):
    return _is_num(v) and float(v).is_integer()


def _is_str(v):
    return isinstance(v, str) and v.strip() != ""


def _n(v):
    """A number as JavaScript would print it, so both validators word a message the same way."""
    return str(int(v)) if _is_num(v) and float(v).is_integer() else str(v)


def _obj(v):
    return isinstance(v, dict)


def enum_values(spec):
    vs = spec.get("values") if isinstance(spec.get("values"), list) else []
    return [v.get("value") if _obj(v) else v for v in vs]


def check_value(p, v):
    """None when v is a legal value of the parameter p, else the reason."""
    t = p.get("type")
    if t == "boolean":
        return None if isinstance(v, bool) else "must be true or false"
    if t == "enum":
        return None if v in enum_values(p) and not isinstance(v, bool) else "must be one of " + ", ".join(map(str, enum_values(p)))
    if t in ("number", "integer"):
        if not _is_num(v):
            return "must be a number"
        if t == "integer" and not _is_int(v):
            return "must be a whole number"
        if _is_num(p.get("min")) and v < p["min"]:
            return f"{_n(v)} is below min {_n(p['min'])}"
        if _is_num(p.get("max")) and v > p["max"]:
            return f"{_n(v)} is above max {_n(p['max'])}"
        return None
    return "unknown parameter type"


def validate(m):
    """Returns (errors, warnings), lists of "where: what" strings. A pack is usable when there are no errors."""
    errors, warnings = [], []
    err = lambda at, msg: errors.append(f"{at}: {msg}")
    warn = lambda at, msg: warnings.append(f"{at}: {msg}")
    if not _obj(m):
        return ["manifest: must be a mapping"], warnings
    for k in m:
        if k not in TOP:
            err(str(k), "unknown top-level key (known: " + ", ".join(TOP) + ")")
    if "spec" in m and m["spec"] != 1:
        err("spec", "must be 1")
    if not _is_str(m.get("id")) or not SLUG.match(m["id"]):
        err("id", "required: lower-case letters, digits and hyphens, starting with a letter")
    if not _is_str(m.get("title")):
        err("title", "required: a non-empty string")
    if "description" in m and not isinstance(m["description"], str):
        err("description", "must be a string")

    # ---- runtime ----
    rt = m.get("runtime")
    if not _obj(rt):
        err("runtime", "required: {type: js, entry: runtime.js}")
    else:
        for k in rt:
            if k not in ("type", "entry", "seed", "on_params", "options"):
                err(f"runtime.{k}", "unknown key")
        if rt.get("type") not in RUNTIMES:
            err("runtime.type", "must be one of " + ", ".join(RUNTIMES))
        elif rt["type"] != "js":
            warn("runtime.type", rt["type"] + " runtimes are planned; only js runs today")
        if rt.get("type") == "js" and not _is_str(rt.get("entry")):
            err("runtime.entry", "required for a js runtime: the file that registers it")
        if "seed" in rt and not _is_int(rt["seed"]):
            err("runtime.seed", "must be a whole number")
        if "on_params" in rt and rt["on_params"] not in ("rerun", "continue"):
            err("runtime.on_params", "must be rerun or continue")
        if "options" in rt and not _obj(rt["options"]):
            err("runtime.options", "must be a mapping")

    # ---- time ----
    tm = m.get("time")
    if not _obj(tm):
        err("time", "required: {unit: day, steps: 100}")
    else:
        for k in tm:
            if k not in ("unit", "steps", "speeds", "speed"):
                err(f"time.{k}", "unknown key")
        if not _is_str(tm.get("unit")):
            err("time.unit", "required: the name of one step, such as day or week")
        if not _is_int(tm.get("steps")) or tm["steps"] < 1:
            err("time.steps", "required: the number of steps in the horizon, at least 1")
        if "speeds" in tm and not (isinstance(tm["speeds"], list) and tm["speeds"] and all(_is_num(s) and s > 0 for s in tm["speeds"])):
            err("time.speeds", "must be a list of positive numbers (steps per second)")
        if "speed" in tm and not (_is_num(tm["speed"]) and tm["speed"] > 0):
            err("time.speed", "must be a positive number")
        if isinstance(tm.get("speeds"), list) and _is_num(tm.get("speed")) and tm["speed"] not in tm["speeds"]:
            warn("time.speed", "is not in time.speeds")

    # ---- params ----
    if "params" not in m:
        err("params", "required (it may be empty: {})")
    elif not _obj(m["params"]):
        err("params", "must be a mapping of name to definition")
    params = m["params"] if _obj(m.get("params")) else {}
    groups = []
    for name, p in params.items():
        at = f"params.{name}"
        if not NAME.match(str(name)):
            err(at, "name must be lower-case letters, digits and underscores, starting with a letter")
        if not _obj(p):
            err(at, "must be a mapping")
            continue
        for k in p:
            if k not in ("type", "min", "max", "step", "default", "values", "unit", "label", "group", "help"):
                err(f"{at}.{k}", "unknown key")
        if p.get("type") not in PARAM_TYPES:
            err(f"{at}.type", "must be one of " + ", ".join(PARAM_TYPES))
            continue
        for k in ("unit", "label", "group", "help"):
            if k in p and not _is_str(p[k]):
                err(f"{at}.{k}", "must be a non-empty string")
        if p.get("group") and p["group"] not in groups:
            groups.append(p["group"])
        if "default" not in p:
            err(f"{at}.default", "required")
        if p["type"] in ("number", "integer"):
            if not _is_num(p.get("min")) or not _is_num(p.get("max")):
                err(at, f"a {p['type']} needs min and max (they set the slider)")
            elif not p["min"] < p["max"]:
                err(at, "min must be below max")
            if "step" in p and not (_is_num(p["step"]) and p["step"] > 0):
                err(f"{at}.step", "must be a positive number")
        else:
            for k in ("min", "max", "step"):
                if k in p:
                    err(f"{at}.{k}", f"only numbers have {k}")
        if p["type"] == "enum":
            vs = p.get("values") if isinstance(p.get("values"), list) else None
            if not vs:
                err(f"{at}.values", "an enum needs a non-empty list of values")
            else:
                names = enum_values(p)
                if not all(_is_str(n) for n in names):
                    err(f"{at}.values", "each value is a string or {value, label}")
                if len(set(map(str, names))) != len(names):
                    err(f"{at}.values", "values must be unique")
        elif "values" in p:
            err(f"{at}.values", "only an enum has values")
        if "default" in p and not (p["type"] == "enum" and not isinstance(p.get("values"), list)):
            why = check_value(p, p["default"])
            if why:
                err(f"{at}.default", why)
        if p["type"] == "integer" and "step" in p and not _is_int(p["step"]):
            err(f"{at}.step", "must be whole for an integer")

    # ---- presets ----
    if "presets" in m:
        if not isinstance(m["presets"], list):
            err("presets", "must be a list")
        else:
            seen = set()
            for i, pr in enumerate(m["presets"]):
                at = f"presets[{i}]"
                if not _obj(pr):
                    err(at, "must be a mapping")
                    continue
                for k in pr:
                    if k not in ("id", "label", "params", "help"):
                        err(f"{at}.{k}", "unknown key")
                if not _is_str(pr.get("id")) or not SLUG.match(pr["id"]):
                    err(f"{at}.id", "required: lower-case letters, digits and hyphens")
                elif pr["id"] in seen:
                    err(f"{at}.id", f"duplicate preset id {pr['id']}")
                else:
                    seen.add(pr["id"])
                if not _is_str(pr.get("label")):
                    err(f"{at}.label", "required: the button text")
                if not _obj(pr.get("params")):
                    err(f"{at}.params", "required: the parameter values this preset sets (it may be empty: {})")
                else:
                    for k, v in pr["params"].items():
                        if k not in params:
                            err(f"{at}.params.{k}", "unknown parameter")
                        elif _obj(params[k]) and params[k].get("type") in PARAM_TYPES:
                            why = check_value(params[k], v)
                            if why:
                                err(f"{at}.params.{k}", why)

    # ---- entities ----
    if "entities" in m and not _obj(m["entities"]):
        err("entities", "must be a mapping of name to definition")
    ents = m["entities"] if _obj(m.get("entities")) else {}
    for name, e in ents.items():
        at = f"entities.{name}"
        if not NAME.match(str(name)):
            err(at, "name must be lower-case letters, digits and underscores")
        if not _obj(e):
            err(at, "must be a mapping")
            continue
        for k in e:
            if k not in ("count", "from", "fields"):
                err(f"{at}.{k}", "unknown key")
        if "count" in e and not (_is_int(e["count"]) and e["count"] >= 1):
            err(f"{at}.count", "must be a whole number of at least 1")
        if "from" in e and e["from"] != "scene":
            err(f"{at}.from", 'must be "scene"')
        if "count" not in e and "from" not in e:
            err(at, "needs count (how many the model makes) or from: scene")
        if e.get("from") == "scene":
            warn(f"{at}.from", "binding to scene buildings by id is planned; for now entities are placed in a fixed order")
        if not _obj(e.get("fields")) or not e["fields"]:
            err(f"{at}.fields", "required: at least one field")
            continue
        for fn, f in e["fields"].items():
            fat = f"{at}.fields.{fn}"
            if not NAME.match(str(fn)):
                err(fat, "name must be lower-case letters, digits and underscores")
            spec = {"type": f} if isinstance(f, str) else f
            if not _obj(spec):
                err(fat, "must be a type name or a mapping")
                continue
            for k in spec:
                if k not in ("type", "values", "label"):
                    err(f"{fat}.{k}", "unknown key")
            if spec.get("type") not in FIELD_TYPES:
                err(f"{fat}.type", "must be one of " + ", ".join(FIELD_TYPES))
                continue
            if spec["type"] == "category":
                vs = spec.get("values")
                if not isinstance(vs, list) or not vs or not all(_is_str(v) for v in vs):
                    err(f"{fat}.values", "a category needs a non-empty list of names; the runtime sends the index into this list")
                elif len(set(vs)) != len(vs):
                    err(f"{fat}.values", "values must be unique")
            elif "values" in spec:
                err(f"{fat}.values", "only a category has values")

    def field_spec(en, fn):
        f = ents[en].get("fields", {}).get(fn) if _obj(ents.get(en)) and _obj(ents[en].get("fields")) else None
        return {"type": f} if isinstance(f, str) else f

    # ---- mappings ----
    if "mappings" in m and not isinstance(m["mappings"], list):
        err("mappings", "must be a list")
    maps = m["mappings"] if isinstance(m.get("mappings"), list) else []
    for i, mp in enumerate(maps):
        at = f"mappings[{i}]"
        if not _obj(mp):
            err(at, "must be a mapping")
            continue
        for k in mp:
            if k not in ("entity", "field", "channel", "scale"):
                err(f"{at}.{k}", "unknown key")
        if mp.get("channel") in PLANNED_CHANNELS:
            warn(f"{at}.channel", f"{mp['channel']} is a planned channel and is ignored for now")
            continue
        if mp.get("channel") not in CHANNELS:
            err(f"{at}.channel", "must be one of " + ", ".join(CHANNELS))
            continue
        f = field_spec(mp.get("entity"), mp.get("field")) if isinstance(mp.get("entity"), str) and isinstance(mp.get("field"), str) else None
        if not isinstance(mp.get("entity"), str) or not _obj(ents.get(mp["entity"])):
            err(f"{at}.entity", f"unknown entity {mp.get('entity')}")
            continue
        if not _obj(f):
            err(f"{at}.field", f"entity {mp['entity']} has no field {mp.get('field')}")
            continue
        sc = mp.get("scale")
        if not _obj(sc) or sc.get("type") not in ("categorical", "sequential"):
            err(f"{at}.scale.type", "must be categorical or sequential")
            continue
        if sc["type"] == "sequential":
            if mp["channel"] != "wall":
                err(at, "a sequential scale colours walls; an overlay needs a categorical scale")
            if f.get("type") == "category":
                err(at, f"a sequential scale needs a number field, {mp['field']} is a category")
            dom = sc.get("domain")
            if not (isinstance(dom, list) and len(dom) == 2 and all(_is_num(d) for d in dom) and dom[0] < dom[1]):
                err(f"{at}.scale.domain", "must be [low, high] with low below high")
            cols = sc.get("colours")
            if not (isinstance(cols, list) and len(cols) >= 2 and all(isinstance(c, str) and HEX.match(c) for c in cols)):
                err(f"{at}.scale.colours", "must be at least two #rrggbb colours")
            if not _is_str(sc.get("label")):
                warn(f"{at}.scale.label", "missing: the legend will show the field name")
        else:
            vals = sc.get("values")
            if not _obj(vals) or not vals:
                err(f"{at}.scale.values", "must map each value to its label and colour or overlay")
                continue
            legal = f.get("values") if f.get("type") == "category" else (["true", "false", "0", "1"] if f.get("type") == "boolean" else None)
            for k, v in vals.items():
                vat = f"{at}.scale.values.{k}"
                if isinstance(legal, list) and str(k) not in legal:
                    err(vat, f"not a value of {mp['entity']}.{mp['field']} ({', '.join(legal)})")
                if not _obj(v) or not _is_str(v.get("label")):
                    err(vat, "needs a label (the legend names it)")
                    continue
                if mp["channel"] == "wall" and not (isinstance(v.get("colour"), str) and HEX.match(v["colour"])):
                    err(f"{vat}.colour", "needs a #rrggbb colour")
                if mp["channel"] == "overlay" and v.get("overlay") is not None and v["overlay"] not in OVERLAYS:
                    err(f"{vat}.overlay", "must be null or one of " + ", ".join(OVERLAYS))
            if f.get("type") == "category" and isinstance(f.get("values"), list):
                miss = [v for v in f["values"] if v not in {str(k) for k in vals}]
                if miss:
                    warn(f"{at}.scale.values", "no entry for " + ", ".join(miss) + ": " + ('drawn as "no data"' if mp["channel"] == "wall" else "drawn with no marking"))
    if not maps and ents:
        warn("mappings", "none: nothing will be drawn on the map")

    # ---- series ----
    if "series" in m and not _obj(m["series"]):
        err("series", "must be a mapping of name to definition")
    series = m["series"] if _obj(m.get("series")) else {}
    for name, s in series.items():
        at = f"series.{name}"
        if not NAME.match(str(name)):
            err(at, "name must be lower-case letters, digits and underscores")
        if not _obj(s):
            err(at, "must be a mapping")
            continue
        for k in s:
            if k not in ("label", "unit", "x", "y"):
                err(f"{at}.{k}", "unknown key")
        y = s.get("y")
        if not isinstance(y, list) or not y or not all(_is_str(v) for v in y) or len(set(y)) != len(y):
            err(f"{at}.y", "required: a list of unique names, one per value in each point")
        for k in ("label", "unit", "x"):
            if k in s and not _is_str(s[k]):
                err(f"{at}.{k}", "must be a non-empty string")

    # ---- layout ----
    if "layout" in m:
        if not _obj(m["layout"]):
            err("layout", "must be a mapping of region to a list of components")
        else:
            for region, items in m["layout"].items():
                at = f"layout.{region}"
                if region == "inspector":
                    warn(at, "the inspector is planned and is ignored for now")
                    continue
                if region not in REGIONS:
                    err(at, "unknown region (left, right, bottom)")
                    continue
                if not isinstance(items, list):
                    err(at, "must be a list")
                    continue
                for i, it in enumerate(items):
                    iat = f"{at}[{i}]"
                    if not _obj(it):
                        err(iat, "must be a mapping")
                        continue
                    kind = [k for k in ["control", *PLANNED_ITEMS] if k in it]
                    if len(kind) != 1:
                        err(iat, "needs exactly one of control, chart, kpis, table")
                        continue
                    if kind[0] != "control":
                        warn(iat, kind[0] + " components are planned and are not drawn yet")
                        if "series" in it and it["series"] not in series:
                            err(f"{iat}.series", f"unknown series {it['series']}")
                        continue
                    if it["control"] not in CONTROLS:
                        err(f"{iat}.control", "must be one of " + ", ".join(CONTROLS))
                        continue
                    if "groups" in it:
                        if it["control"] != "params":
                            err(f"{iat}.groups", "only the params control has groups")
                        elif not isinstance(it["groups"], list):
                            err(f"{iat}.groups", "must be a list of group names")
                        else:
                            for g in it["groups"]:
                                if g not in groups:
                                    err(f"{iat}.groups", f"no parameter is in group {g} (groups: {', '.join(groups) or 'none'})")
    if "banner" in m and not isinstance(m["banner"], str):
        err("banner", "must be a string")
    if not m.get("banner"):
        warn("banner", "none: say where the geometry and the data come from")
    return errors, warnings


# ---- files ----

def manifest_path(path):
    p = Path(path)
    return p / "pack.yaml" if p.is_dir() else p


def load(path):
    """Read pack.yaml (given the folder or the file). Returns the manifest dict."""
    p = manifest_path(path)
    if not p.exists():
        raise PackError(f"no pack.yaml at {p}")
    try:
        data = yaml.safe_load(p.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise PackError(f"{p} is not valid YAML: {e}") from e
    return data


def check(path):
    """Validate a pack on disk. Returns (errors, warnings): the manifest, and that the runtime file it names exists."""
    try:
        m = load(path)
    except PackError as e:
        return [str(e)], []
    errors, warnings = validate(m)
    rt = m.get("runtime") if _obj(m) else None
    if _obj(rt) and rt.get("type") == "js" and _is_str(rt.get("entry")):
        entry = manifest_path(path).parent / rt["entry"]
        if not entry.is_file():
            errors.append(f"runtime.entry: {rt['entry']} does not exist next to pack.yaml")
    return errors, warnings


def _json_for_script(obj):
    return json.dumps(obj, separators=(",", ":")).replace("</", "<\\/").replace("<!--", "<\\!--")


def build_page(path, scene=None):
    """One self-contained page: the pack host, the renderer, the manifest and the runtime source."""
    from .viewer_build import VIZ, ROOT, _fill, _read
    errors, _ = check(path)
    if errors:
        raise PackError("the pack does not validate: " + errors[0] + (f" (and {len(errors) - 1} more)" if len(errors) > 1 else ""))
    m = load(path)
    src = (manifest_path(path).parent / m["runtime"]["entry"]).read_text(encoding="utf-8")
    if "</script" in src.lower():
        raise PackError("runtime source contains </script>, which cannot be inlined in a page")
    title = m["title"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    page = _read("packhost.html").replace("/*__PACKRUNTIMESRC__*/", src)
    return _fill(page, TITLE=title, PACK=_json_for_script(m), SCENE=_json_for_script(scene) if scene is not None else "null")
