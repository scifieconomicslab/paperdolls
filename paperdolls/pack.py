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
CHANNELS = ["wall", "overlay", "segments", "outline", "halo", "groundtint"]
PLANNED_CHANNELS = ["height", "ground"]
AGGREGATES = ["mean", "sum", "min", "max"]
OVERLAYS = ["scaffold", "solar", "band", "marker", "insulation", "community"]
SEG_MAX = 12
REGIONS = ["left", "right", "bottom"]
CONTROLS = ["params", "presets", "compare", "timeline", "legend", "display"]
PLANNED_ITEMS = ["table"]
ITEM_KINDS = ["control", "chart", "kpis", "table"]
CHART_TYPES = ["line", "area", "bar"]
DISPLAY_IDS = ["people", "vehicles", "ink", "pixel", "fog"]
KPI_AT = ["now", "final", "max", "min"]
ITEM_KEYS = {"control": ["control", "groups", "items"], "chart": ["chart", "series", "y", "title", "unit", "x", "compare"], "kpis": ["kpis", "title"], "table": ["table", "series"]}
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
            if k not in ("entity", "field", "channel", "scale", "total", "max", "group", "aggregate", "opacity"):
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
        if mp["channel"] == "segments":  # k of n units: the field holds k, mp["total"] names the field that holds n
            if f.get("type") == "category":
                err(f"{at}.field", f"a segments channel needs a number or int field (units done), {mp['field']} is a category")
            if not _is_str(mp.get("total")):
                err(f"{at}.total", "required: the field that holds the number of units")
            else:
                tf = field_spec(mp["entity"], mp["total"])
                if not _obj(tf):
                    err(f"{at}.total", f"entity {mp['entity']} has no field {mp['total']}")
                elif tf.get("type") == "category":
                    err(f"{at}.total", f"must be a number or int field, {mp['total']} is a category")
            mx = mp.get("max")
            if "max" in mp and not (isinstance(mx, int) and not isinstance(mx, bool) and 2 <= mx <= SEG_MAX):
                err(f"{at}.max", f"must be a whole number from 2 to {SEG_MAX}")
            if not _obj(sc) or sc.get("type") != "segments":
                err(f"{at}.scale.type", "must be segments")
                continue
            if not (isinstance(sc.get("colour"), str) and HEX.match(sc["colour"])):
                err(f"{at}.scale.colour", "needs a #rrggbb colour")
            if "todo" in sc and not (isinstance(sc["todo"], str) and HEX.match(sc["todo"])):
                err(f"{at}.scale.todo", "must be a #rrggbb colour")
            if not _is_str(sc.get("label")):
                warn(f"{at}.scale.label", "missing: the legend will show the field name")
            continue
        if mp["channel"] == "groundtint":  # the ground under the buildings, tinted by an aggregate of the field over a neighbourhood
            if f.get("type") == "category":
                err(f"{at}.field", f"the groundtint channel needs a number, int or boolean field to aggregate, {mp['field']} is a category")
            gr = mp.get("group")
            if not _obj(gr):
                err(f"{at}.group", "required: {grid: metres} or {field: name, cell: metres}")
            else:
                for k in gr:
                    if k not in ("grid", "field", "cell"):
                        err(f"{at}.group.{k}", "unknown key")
                if ("grid" in gr) == ("field" in gr):
                    err(f"{at}.group", "give either grid or field")
                elif "grid" in gr:
                    if not (_is_num(gr["grid"]) and 10 <= gr["grid"] <= 2000):
                        err(f"{at}.group.grid", "must be a cell size in metres from 10 to 2000")
                    if "cell" in gr:
                        err(f"{at}.group.cell", "only with a field group")
                else:
                    gf = field_spec(mp["entity"], gr["field"]) if isinstance(gr.get("field"), str) else None
                    if not isinstance(gr.get("field"), str) or not _obj(gf):
                        err(f"{at}.group.field", f"entity {mp['entity']} has no field {gr.get('field')}")
                    if "cell" in gr and not (_is_num(gr["cell"]) and 10 <= gr["cell"] <= 500):
                        err(f"{at}.group.cell", "must be a cell size in metres from 10 to 500")
            if "aggregate" in mp and mp["aggregate"] not in AGGREGATES:
                err(f"{at}.aggregate", "must be one of " + ", ".join(AGGREGATES))
            if "opacity" in mp and not (_is_num(mp["opacity"]) and 0 < mp["opacity"] <= 1):
                err(f"{at}.opacity", "must be above 0 and at most 1")
            if not _obj(sc) or sc.get("type") != "sequential":
                err(f"{at}.scale.type", "the groundtint channel needs a sequential scale")
                continue
            dom = sc.get("domain")
            if not (isinstance(dom, list) and len(dom) == 2 and all(_is_num(d) for d in dom) and dom[0] < dom[1]):
                err(f"{at}.scale.domain", "must be [low, high] with low below high")
            cols = sc.get("colours")
            if not (isinstance(cols, list) and len(cols) >= 2 and all(isinstance(c, str) and HEX.match(c) for c in cols)):
                err(f"{at}.scale.colours", "must be at least two #rrggbb colours")
            if not _is_str(sc.get("label")):
                warn(f"{at}.scale.label", "missing: the legend will show the field name")
            continue
        if not _obj(sc) or sc.get("type") not in ("categorical", "sequential"):
            err(f"{at}.scale.type", "must be categorical or sequential")
            continue
        if sc["type"] == "sequential":
            if mp["channel"] != "wall":
                err(at, "a sequential scale colours walls; " + ("an overlay" if mp["channel"] == "overlay" else "the " + mp["channel"] + " channel") + " needs a categorical scale")
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
                k = "true" if k is True else "false" if k is False else k  # YAML 1.1 reads an unquoted true: or false: key as a boolean; the JSON the page gets already has "true" and "false"
                vat = f"{at}.scale.values.{k}"
                if isinstance(legal, list) and str(k) not in legal:
                    err(vat, f"not a value of {mp['entity']}.{mp['field']} ({', '.join(legal)})")
                if not _obj(v) or not _is_str(v.get("label")):
                    err(vat, "needs a label (the legend names it)")
                    continue
                if mp["channel"] == "wall" and not (isinstance(v.get("colour"), str) and HEX.match(v["colour"])):
                    err(f"{vat}.colour", "needs a #rrggbb colour")
                if mp["channel"] in ("outline", "halo") and v.get("colour") is not None and not (isinstance(v["colour"], str) and HEX.match(v["colour"])):
                    err(f"{vat}.colour", f"needs a #rrggbb colour, or null for no {mp['channel']}")
                if mp["channel"] == "overlay" and v.get("overlay") is not None and v["overlay"] not in OVERLAYS:
                    err(f"{vat}.overlay", "must be null or one of " + ", ".join(OVERLAYS))
            if f.get("type") == "category" and isinstance(f.get("values"), list):
                miss = [v for v in f["values"] if v not in {str(k) for k in vals}]
                if miss:
                    warn(f"{at}.scale.values", "no entry for " + ", ".join(miss) + ": " + ('drawn as "no data"' if mp["channel"] == "wall" else "drawn with no marking" if mp["channel"] == "overlay" else f"drawn with no {mp['channel']}"))
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
                    kind = [k for k in ITEM_KINDS if k in it]
                    if len(kind) != 1:
                        err(iat, "needs exactly one of control, chart, kpis, table")
                        continue
                    for k in it:
                        if k not in ITEM_KEYS[kind[0]]:
                            err(f"{iat}.{k}", f"unknown key for a {kind[0]} component")
                    if kind[0] == "chart":
                        if it["chart"] not in CHART_TYPES:
                            err(f"{iat}.chart", "must be one of " + ", ".join(CHART_TYPES))
                        sr = series.get(it["series"]) if _is_str(it.get("series")) else None
                        if not _is_str(it.get("series")):
                            err(f"{iat}.series", "required: the series to draw")
                        elif sr is None:
                            err(f"{iat}.series", f"unknown series {it['series']}")
                        if "y" in it:
                            y = it["y"]
                            if not isinstance(y, list) or not y or not all(_is_str(v) for v in y) or len(set(y)) != len(y):
                                err(f"{iat}.y", "must be a list of unique value names from the series")
                            elif _obj(sr) and isinstance(sr.get("y"), list):
                                for n in y:
                                    if n not in sr["y"]:
                                        err(f"{iat}.y", f"no value {n} in series {it['series']} ({', '.join(sr['y'])})")
                        for k in ("title", "unit", "x"):
                            if k in it and not _is_str(it[k]):
                                err(f"{iat}.{k}", "must be a non-empty string")
                        if "compare" in it and not isinstance(it["compare"], bool):
                            err(f"{iat}.compare", "must be true or false")
                        continue
                    if kind[0] == "kpis":
                        if "title" in it and not _is_str(it["title"]):
                            err(f"{iat}.title", "must be a non-empty string")
                        if not isinstance(it["kpis"], list) or not it["kpis"]:
                            err(f"{iat}.kpis", "must be a non-empty list of tiles")
                            continue
                        for j, k in enumerate(it["kpis"]):
                            kat = f"{iat}.kpis[{j}]"
                            if not _obj(k):
                                err(kat, "must be a mapping")
                                continue
                            for key in k:
                                if key not in ("label", "series", "y", "at", "unit", "decimals"):
                                    err(f"{kat}.{key}", "unknown key")
                            if not _is_str(k.get("label")):
                                err(f"{kat}.label", "required: the tile text")
                            sr = series.get(k["series"]) if _is_str(k.get("series")) else None
                            if not _is_str(k.get("series")):
                                err(f"{kat}.series", "required")
                            elif sr is None:
                                err(f"{kat}.series", f"unknown series {k['series']}")
                            if "y" in k and not _is_str(k["y"]):
                                err(f"{kat}.y", "must be a value name from the series")
                            elif _obj(sr) and isinstance(sr.get("y"), list):
                                if "y" not in k and len(sr["y"]) > 1:
                                    err(f"{kat}.y", f"required: series {k['series']} has several values ({', '.join(sr['y'])})")
                                elif "y" in k and k["y"] not in sr["y"]:
                                    err(f"{kat}.y", f"no value {k['y']} in series {k['series']} ({', '.join(sr['y'])})")
                            if "at" in k and k["at"] not in KPI_AT:
                                err(f"{kat}.at", "must be one of " + ", ".join(KPI_AT))
                            if "unit" in k and not _is_str(k["unit"]):
                                err(f"{kat}.unit", "must be a non-empty string")
                            if "decimals" in k and not (_is_int(k["decimals"]) and 0 <= k["decimals"] <= 6):
                                err(f"{kat}.decimals", "must be a whole number from 0 to 6")
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
                    if "items" in it:
                        if it["control"] != "display":
                            err(f"{iat}.items", "only the display control has items")
                        elif not isinstance(it["items"], list) or len({str(v) for v in it["items"]}) != len(it["items"]):
                            err(f"{iat}.items", "must be a list of unique switch names (" + ", ".join(DISPLAY_IDS) + ")")
                        else:
                            for n in it["items"]:
                                if n not in DISPLAY_IDS:
                                    err(f"{iat}.items", f"unknown switch {n} (" + ", ".join(DISPLAY_IDS) + ")")
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


# ---- the sources a page is built from ----

def runtime_files(path, include=()):
    """The files inlined as the pack's runtime, in order: --include files, the runtime.entry, then bind.js when it sits beside it.

    `bind.js` is a convention, not a manifest key: a pack that keeps its bindScene in a second file gets it loaded after the entry
    (it may use what the entry exposes). Returns a list of Paths (not checked for existence here)."""
    base = manifest_path(path).parent
    files = [Path(f) for f in include]
    m = load(path)
    rt = m.get("runtime") if _obj(m) else None
    if _obj(rt) and _is_str(rt.get("entry")):
        entry = base / rt["entry"]
        files.append(entry)
        bind = base / "bind.js"
        if bind.is_file() and bind.resolve() != entry.resolve():
            files.append(bind)
    return files


def watched_files(path, include=(), scene_path=None):
    """Everything whose change should rebuild the page: the manifest, the runtime sources and the scene."""
    files = [manifest_path(path), *runtime_files(path, include)]
    if scene_path:
        files.append(Path(scene_path))
    return files


def runtime_source(path, include=()):
    parts = []
    for f in runtime_files(path, include):
        if not f.is_file():
            raise PackError(f"runtime file {f} does not exist")
        src = f.read_text(encoding="utf-8")
        if "</script" in src.lower() or "<!--" in src:
            raise PackError(f"{f.name} contains </script> or <!--, which cannot be inlined in a page")
        parts.append(src)
    return "\n;\n".join(parts)


# ---- the scene: embedded compactly, trimmed only when the page would be too big ----

DEFAULT_MAX_BYTES = 16 * 1024 * 1024
# Applied in this order, one at a time, only while the page is over budget (or when asked for by name). Each says what is lost.
# Never trimmed: id, footprint, levels, archetype, state, investor (the renderer), area, residential, levels_assumed (what bindScene rules use).
TRIM_STAGES = [
    ("precision", "coordinates rounded to 0.1 m (from 0.01 m) in footprints, roads, landuse and trees"),
    ("centroid", "building.centroid dropped (it can be recomputed from the footprint)"),
    ("osm", "building.osm tags dropped (building type and levels_source: a bindScene that reads them loses them)"),
    ("height", "building.height dropped (a pack that reads height falls back to levels)"),
    ("neighbours", "building.neighbours dropped (a pack that builds a contact network from them has none)"),
]
TRIM_NAMES = [n for n, _ in TRIM_STAGES]


def _round_coords(v, nd):
    if isinstance(v, float):
        return round(v, nd)
    if isinstance(v, list):
        return [_round_coords(x, nd) for x in v]
    return v


def _round_item(it):
    """A road, landuse area or tree with every list of coordinates rounded to 0.1 m (other values untouched)."""
    if isinstance(it, list):
        return _round_coords(it, 1)
    return {k: (_round_coords(v, 1) if isinstance(v, list) else v) for k, v in it.items()} if isinstance(it, dict) else it


def trim_scene(scene, stage):
    """A copy of the scene with one trim stage applied (see TRIM_STAGES)."""
    out = dict(scene)
    if stage == "precision":
        for k in ("roads", "landuse", "trees"):
            if isinstance(out.get(k), list):
                out[k] = [_round_item(it) for it in out[k]]
        out["buildings"] = [dict(b, footprint=_round_coords(b["footprint"], 1)) if "footprint" in b else b for b in scene.get("buildings", [])]
    else:
        key = {"centroid": ["centroid"], "osm": ["osm"], "height": ["height"], "neighbours": ["neighbours"]}[stage]
        out["buildings"] = [{k: v for k, v in b.items() if k not in key} for b in scene.get("buildings", [])]
    return out


def load_scene(path):
    try:
        scene = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as e:
        raise PackError(f"cannot read the scene {path}: {e}") from e
    except json.JSONDecodeError as e:
        raise PackError(f"{path} is not valid JSON: {e}") from e
    if not isinstance(scene, dict) or not isinstance(scene.get("buildings"), list):
        raise PackError(f"{path} is not a scene file: expected an object with a buildings list")
    return scene


def build(path, scene=None, include=(), max_bytes=DEFAULT_MAX_BYTES, trim=()):
    """The pack page, and what went into it. Returns (html, info) where info has bytes, scene_bytes, buildings, trimmed (list of the stages applied
    and what each lost) and over_budget. `trim` names stages to apply regardless of size; otherwise stages are applied in order while the page is over max_bytes.
    Raises PackError when the page is still over budget after every stage."""
    from .viewer_build import _fill, _read
    errors, _ = check(path)
    if errors:
        raise PackError("the pack does not validate: " + errors[0] + (f" (and {len(errors) - 1} more)" if len(errors) > 1 else ""))
    for t in trim:
        if t not in TRIM_NAMES:
            raise PackError(f"unknown trim stage {t} (known: {', '.join(TRIM_NAMES)})")
    m = load(path)
    src = runtime_source(path, include)
    title = m["title"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    page = _read("packhost.html").replace("/*__PACKRUNTIMESRC__*/", src)
    manifest_js = _json_for_script(m)
    trimmed, cur = [], scene

    def render(sc):
        sj = _json_for_script(sc) if sc is not None else "null"
        return _fill(page, TITLE=title, PACK=manifest_js, SCENE=sj), len(sj.encode("utf-8"))

    for t in trim:
        cur = trim_scene(cur, t); trimmed.append({"stage": t, "lost": dict(TRIM_STAGES)[t]})
    html, sbytes = render(cur)
    if cur is not None:
        for name, lost in TRIM_STAGES:
            if len(html.encode("utf-8")) <= max_bytes:
                break
            if any(x["stage"] == name for x in trimmed):
                continue
            cur = trim_scene(cur, name); trimmed.append({"stage": name, "lost": lost})
            html, sbytes = render(cur)
    size = len(html.encode("utf-8"))
    if size > max_bytes:
        raise PackError(f"the page is {size / 1048576:.1f} MB, over the {max_bytes / 1048576:.0f} MB limit" + (" even after trimming the scene" if trimmed else "") + ". Use a smaller scene (ingest --max-buildings or --bbox)")
    info = {"bytes": size, "scene_bytes": sbytes if cur is not None else 0, "buildings": len(cur["buildings"]) if cur is not None else 0,
            "trimmed": trimmed, "sources": [str(f) for f in runtime_files(path, include)]}
    return html, info


def build_page(path, scene=None, include=()):
    """One self-contained page: the pack host, the renderer, the manifest and the runtime source."""
    return build(path, scene, include)[0]
