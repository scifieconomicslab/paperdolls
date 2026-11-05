"""The intake: a short, fixed interview that fills in render.yaml.

A model runs the loop; this module decides what to ask next and checks every answer.

    paperdolls intake init  render.yaml
    paperdolls intake next  render.yaml         # the next question, or "complete"
    paperdolls intake answer render.yaml ID VALUE
    paperdolls intake show  render.yaml         # the decision table; the user must say yes to it
    paperdolls intake status render.yaml

The questions live in assets/intake_questions.yaml. Nothing here invents an answer: a default is applied only when the bank says so, and
every default is listed in the decision table. Any change to an answer withdraws an earlier "yes", so the user always confirms what will
be built.
"""
import difflib
import hashlib
import json
from pathlib import Path

import yaml

from . import model_loader
from .render import palettes

ROOT = Path(__file__).resolve().parents[1]
BANK_PATH = ROOT / "assets" / "intake_questions.yaml"
DEMO_PATH = ROOT / "assets" / "demo_render.yaml"
RESERVED_PARAMS = {"n": "model.params.n", "n_households": "model.params.n_households", "run_time": "model.params.run_time", "seed": "model.params.seed"}


class IntakeError(ValueError):
    """An answer that cannot be accepted. The message is written for the user."""


def load_bank():
    return yaml.safe_load(BANK_PATH.read_text(encoding="utf-8"))


# ---------- dotted paths into the project file ----------
def get_path(data, dotted, default=None):
    cur = data
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


def set_path(data, dotted, value):
    parts = dotted.split(".")
    cur = data
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value


def del_path(data, dotted):
    parts = dotted.split(".")
    cur = data
    for part in parts[:-1]:
        cur = cur.get(part) if isinstance(cur, dict) else None
        if cur is None:
            return
    if isinstance(cur, dict):
        cur.pop(parts[-1], None)
    # an emptied parent section is removed, so the file stays tidy
    for i in range(len(parts) - 1, 0, -1):
        parent = get_path(data, ".".join(parts[:i]))
        if parent == {}:
            del_path(data, ".".join(parts[:i]))


def _matches(want, have):
    return have in want if isinstance(want, list) else have == want


class Intake:
    def __init__(self, path):
        self.path = Path(path)
        self.base = self.path.resolve().parent
        self.bank = load_bank()
        self.questions = self.bank["questions"]
        self.by_id = {q["id"]: q for q in self.questions}
        self.data = yaml.safe_load(self.path.read_text(encoding="utf-8")) if self.path.exists() else None
        self.data = self.data or {}
        self.families = palettes.load_families()

    # ---------- file ----------
    @classmethod
    def init(cls, path, force=False):
        p = Path(path)
        if p.exists() and not force:
            raise IntakeError(f"{p} already exists. Use --force to start over, or continue with 'intake next'.")
        p.write_text(yaml.safe_dump({"intake": {"version": 1}}, sort_keys=False), encoding="utf-8")
        return cls(p)

    def save(self):
        d = {k: v for k, v in self.data.items() if k != "intake"}
        d["intake"] = self.data.get("intake", {"version": 1})
        self.path.write_text(yaml.safe_dump(d, sort_keys=False, allow_unicode=True, width=100), encoding="utf-8")

    @property
    def meta(self):
        return self.data.setdefault("intake", {"version": 1})

    def value(self, qid):
        return get_path(self.data, qid)

    # ---------- which questions apply ----------
    def conditions_hold(self, cond):
        return all(_matches(want, self.value(k)) for k, want in (cond or {}).items())

    def applicable(self, q):
        return self.conditions_hold(q.get("when"))

    def always_ask(self, q):
        return bool(q.get("always_ask")) or (q.get("always_ask_when") is not None and self.conditions_hold(q["always_ask_when"]))

    # ---------- options, suggestions and defaults ----------
    def options(self, q):
        src = q.get("options_from")
        if src == "regions":
            return [{"value": f["id"], "label": f["name"], "detail": f["places"]} for f in self.families.values()]
        if src == "looks":
            fam = self.families.get(self.value("look.region"))
            if not fam:
                raise IntakeError("Choose the region first: the looks depend on it.")
            return [{"value": k["id"], "label": k["name"], "detail": f'{k["note"]} Roads: {k.get("surface", "asphalt")}.'} for k in fam["looks"]]
        if src == "registers":
            opts = [{"value": "colorfigures", "label": "Colorfigures", "detail": "The region's own colours, hand-inked lines."},
                    {"value": "formal", "label": "Formal", "detail": "Grey technical drawing, colour only for data."}]
            if self.value("goal") == "model_replay":
                opts.append({"value": "both", "label": "Both", "detail": "One set of frames in each style."})
            return opts
        return q.get("options")

    def suggestion(self, q):
        qid = q["id"]
        if qid == "look.register":
            aud, goal = self.value("audience"), self.value("goal")
            return {"policymakers": "formal", "public": "colorfigures"}.get(aud, "both" if goal == "model_replay" else "formal")
        if qid == "replay.weeks":
            run = self.value("model.params.run_time")
            if isinstance(run, int) and run >= 2:
                return sorted({0, run // 10, run // 3, run - 1})
        return None

    def default(self, q):
        if "default_from" in q:
            return self.value(f"model.params.{q['default_from']}")
        return q.get("default")

    # ---------- parsing and validating one answer ----------
    def parse(self, q, raw):
        """Turn what the user said into the value to store, or raise IntakeError with a plain message."""
        t, raw = q["type"], ("" if raw is None else str(raw).strip())
        if raw == "":
            raise IntakeError("The answer is empty.")
        if t == "choice":
            opts = self.options(q)
            values = [o["value"] for o in opts]
            low = raw.lower()
            if raw.isdigit() and 1 <= int(raw) <= len(opts) and low not in values:
                return values[int(raw) - 1]                       # the number from a numbered list
            for o in opts:
                if low in (str(o["value"]).lower(), str(o["label"]).lower()):
                    return o["value"]
            near = difflib.get_close_matches(low, [v.lower() for v in values], n=1)
            raise IntakeError(f"'{raw}' is not one of the options: {', '.join(values)}." + (f" Did you mean '{near[0]}'?" if near else ""))
        if t == "text":
            if "\n" in raw:
                raise IntakeError("Use one line.")
            lo, hi = q.get("min", 1), q.get("max", 200)
            if not lo <= len(raw) <= hi:
                raise IntakeError(f"Use between {lo} and {hi} characters.")
            return raw
        if t == "int":
            try:
                f = float(raw.replace(",", "").replace("_", ""))
            except ValueError:
                raise IntakeError(f"'{raw}' is not a whole number.")
            if f != int(f):
                raise IntakeError(f"'{raw}' is not a whole number.")
            v = int(f)
            lo, hi = q.get("min"), q.get("max")
            if (lo is not None and v < lo) or (hi is not None and v > hi):
                raise IntakeError(f"Use a whole number from {lo} to {hi}.")
            return v
        if t == "ints":
            parts = [p for p in raw.replace(";", ",").replace(" ", ",").split(",") if p != ""]
            try:
                vals = sorted({int(p) for p in parts})
            except ValueError:
                raise IntakeError("Give whole numbers separated by commas, for example 0, 26, 78, 259.")
            run = self.value("model.params.run_time")
            if run is None:
                raise IntakeError("Answer the number of weeks in the run first: keyframes have to fall inside it.")
            if any(v < 0 or v >= run for v in vals):
                raise IntakeError(f"Every week must be from 0 to {run - 1}.")
            lo, hi = q.get("min", 1), q.get("max", 99)
            if not lo <= len(vals) <= hi:
                raise IntakeError(f"Give between {lo} and {hi} different weeks.")
            return vals
        if t == "floats4":
            try:
                v = [float(p) for p in raw.replace(";", ",").replace(" ", ",").split(",") if p != ""]
            except ValueError:
                raise IntakeError("Give four numbers: south, west, north, east.")
            if len(v) != 4:
                raise IntakeError("Give four numbers: south, west, north, east.")
            s, w, n, e = v
            if not (-90 <= s < n <= 90 and -180 <= w < e <= 180):
                raise IntakeError("South must be below north, west below east, latitude within 90 and longitude within 180.")
            return [round(x, 6) for x in v]
        if t == "path":
            p = Path(raw)
            full = p if p.is_absolute() else self.base / p
            if not full.is_file():
                raise IntakeError(f"No file at {full}.")
            if q.get("suffix") and full.suffix.lower() != q["suffix"]:
                raise IntakeError(f"The file should end in {q['suffix']}.")
            return raw
        if t == "kv":
            return self.parse_overrides(raw)
        raise IntakeError(f"Unknown question type {t}.")

    def model_fields(self):
        """Parameter names the chosen model accepts, or None when the model cannot be loaded."""
        import dataclasses
        try:
            path = None
            if self.value("model.source") == "file":
                p = Path(self.value("model.path") or "")
                path = p if p.is_absolute() else self.base / p
            return {f.name for f in dataclasses.fields(model_loader.load(path).Params)}
        except Exception:
            return None

    def parse_overrides(self, raw):
        if raw.lower() in ("none", "no", "nothing", "-"):
            return {}
        out, fields = {}, self.model_fields()
        for chunk in raw.replace(";", ",").split(","):
            chunk = chunk.strip()
            if not chunk:
                continue
            if "=" not in chunk:
                raise IntakeError(f"'{chunk}' needs the form name=value.")
            name, val = (s.strip() for s in chunk.split("=", 1))
            if name in RESERVED_PARAMS:
                raise IntakeError(f"{name} has its own question. Answer {RESERVED_PARAMS[name]} instead.")
            if fields is not None and name not in fields:
                near = difflib.get_close_matches(name, sorted(fields), n=3)
                raise IntakeError(f"The model has no parameter '{name}'." + (f" Did you mean {', '.join(near)}?" if near else ""))
            out[name] = yaml.safe_load(val)
        return out

    # ---------- recording an answer ----------
    def answer(self, qid, raw):
        if qid == "confirmed":
            return self.confirm(raw)
        q = self.by_id.get(qid)
        if q is None:
            near = difflib.get_close_matches(qid, list(self.by_id), n=3)
            raise IntakeError(f"There is no question '{qid}'." + (f" Did you mean {', '.join(near)}?" if near else ""))
        if not self.applicable(q):
            raise IntakeError(f"'{qid}' does not apply to the answers so far (it needs {q['when']}).")
        value = self.parse(q, raw)
        self.record(q, value)
        self.after(q, value)
        self.withdraw_confirmation()
        self.save()
        return {"ok": True, "id": qid, "value": value}

    def record(self, q, value):
        qid = q["id"]
        if q["type"] == "kv":
            self.apply_overrides(value)
        else:
            set_path(self.data, qid, value)
        defaults = self.meta.setdefault("defaults", [])
        if qid in defaults:
            defaults.remove(qid)

    def apply_overrides(self, new):
        params = self.data.setdefault("model", {}).setdefault("params", {})
        preset = self.preset_params() if self.value("model.source") == "vendored" else {}
        for key in self.meta.get("override_keys", []):                    # undo the last set of overrides first
            if key in preset:
                params[key] = preset[key]
            else:
                params.pop(key, None)
        params.update(new)
        self.meta["override_keys"] = sorted(new)
        self.meta["overrides_answered"] = True

    def preset_params(self):
        return dict(get_path(yaml.safe_load(DEMO_PATH.read_text(encoding="utf-8")), "model.params") or {})

    def after(self, q, value):
        """Changes that follow from one answer."""
        qid = q["id"]
        if qid == "goal":
            # a different goal leaves the other branch's answers behind: drop them so the file matches the goal
            other = ["place", "look.look", "look.drive"] if value == "model_replay" else ["model", "replay"]
            for key in other:
                del_path(self.data, key)
        if qid == "model.source":
            keep = {k: get_path(self.data, f"model.params.{k}") for k in ("n", "run_time", "seed") if get_path(self.data, f"model.params.{k}") is not None}
            self.data.setdefault("model", {})["params"] = {}
            if value == "vendored":
                # the demo supplies the nine required parameters; the ones the user decides are asked, never pre-filled
                self.data["model"]["params"].update({k: v for k, v in self.preset_params().items() if k not in RESERVED_PARAMS})
                del_path(self.data, "model.path")
            else:
                del_path(self.data, "model.params.n_households")
                self.meta.pop("override_keys", None)
            self.data["model"]["params"].update(keep)
            self.data["model"]["source"] = value
        if qid == "look.region":
            fam = self.families[value]
            if self.value("look.look") not in [k["id"] for k in fam["looks"]]:
                del_path(self.data, "look.look")
        if qid == "model.params.n" and "model.params.n_households" in self.meta.get("defaults", []):
            set_path(self.data, "model.params.n_households", value)
        if qid == "model.params.run_time":
            weeks = self.value("replay.weeks") or []
            if any(w >= value for w in weeks):
                del_path(self.data, "replay.weeks")

    # ---------- confirmation ----------
    def answers_hash(self):
        body = {k: v for k, v in self.data.items() if k != "intake"}
        return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()[:16]

    def withdraw_confirmation(self):
        self.meta.pop("confirmed", None)
        self.meta.pop("shown", None)

    def confirm(self, raw):
        word = str(raw).strip().lower()
        if self.meta.get("shown") != self.answers_hash():
            raise IntakeError("The user has not been shown the current decision table. Run 'intake show', present it, and ask again.")
        if word in ("yes", "y", "true", "ok", "go", "confirmed"):
            self.meta["confirmed"] = True
            self.save()
            return {"ok": True, "id": "confirmed", "value": True}
        if word in ("no", "n", "false"):
            self.withdraw_confirmation()
            self.save()
            return {"ok": True, "id": "confirmed", "value": False}
        raise IntakeError("Answer yes or no.")

    @property
    def confirmed(self):
        return bool(self.meta.get("confirmed")) and self.meta.get("shown") == self.answers_hash()

    # ---------- the loop ----------
    def check_existing(self, q):
        """None when the stored answer is fine, or the reason it is not."""
        v = self.value(q["id"])
        try:
            if q["type"] == "kv":
                return None
            if q["type"] == "ints":
                self.parse(q, ",".join(str(x) for x in v))
            elif q["type"] == "floats4":
                self.parse(q, ",".join(str(x) for x in v))
            else:
                self.parse(q, v)
        except IntakeError as e:
            return str(e)
        return None

    def render_question(self, q):
        out = {"id": q["id"], "group": q["group"], "type": q["type"], "ask": q["ask"], "why": q.get("why", "")}
        if q.get("note"):
            out["note_for_model"] = q["note"]
        if q.get("example"):
            out["example"] = q["example"]
        if q["type"] == "choice":
            opts = self.options(q)
            out["options"] = opts
            out["present"] = "buttons" if 2 <= len(opts) <= 4 else "numbered list"
        else:
            out["present"] = "plain question"
        sug = self.suggestion(q)
        if sug is not None:
            out["suggested"] = sug
        elif self.default(q) is not None:
            out["suggested"] = self.default(q)
        return out

    def next(self):
        applicable = [q for q in self.questions if self.applicable(q)]
        answered = 0
        for q in applicable:
            have = self.value(q["id"]) is not None
            if q["type"] == "kv":
                have = bool(self.meta.get("overrides_answered")) or q["id"] in self.meta.get("defaults", [])
            if have:
                problem = self.check_existing(q)
                if problem:
                    return {"status": "fix", "problem": problem, "question": self.render_question(q), **self.progress(answered, applicable)}
                answered += 1
                continue
            if not self.always_ask(q) and self.default(q) is not None:
                self.apply_default(q)
                answered += 1
                continue
            return {"status": "ask", "question": self.render_question(q), **self.progress(answered, applicable)}
        self.save()
        if self.confirmed:
            return {"status": "complete", **self.progress(answered, applicable)}
        return {"status": "confirm", "instruction": "Run 'paperdolls intake show', present the table to the user, and ask whether it is right. Record the reply with 'intake answer ... confirmed yes' or 'no'.",
                **self.progress(answered, applicable)}

    def apply_default(self, q):
        val = self.default(q)
        if q["type"] == "kv":
            self.apply_overrides(self.parse_overrides(str(val)))
            self.meta.pop("overrides_answered", None)
        else:
            set_path(self.data, q["id"], val)
        d = self.meta.setdefault("defaults", [])
        if q["id"] not in d:
            d.append(q["id"])
        self.after(q, val)

    @staticmethod
    def progress(answered, applicable):
        return {"progress": {"answered": answered, "of": len(applicable)}}

    def status(self):
        rows = []
        for q in self.questions:
            if not self.applicable(q):
                continue
            v = self.value(q["id"])
            if q["type"] == "kv":
                state = "answered" if self.meta.get("overrides_answered") else ("default" if q["id"] in self.meta.get("defaults", []) else "missing")
            elif v is None:
                state = "missing"
            elif self.check_existing(q):
                state = "invalid"
            else:
                state = "default" if q["id"] in self.meta.get("defaults", []) else "answered"
            rows.append({"id": q["id"], "label": q["label"], "state": state, "value": v})
        return rows

    # ---------- the decision table ----------
    def show(self):
        rows = self.status()
        if any(r["state"] in ("missing", "invalid") for r in rows):
            todo = [r["id"] for r in rows if r["state"] in ("missing", "invalid")]
            raise IntakeError("Not every question is answered yet: " + ", ".join(todo) + ". Run 'intake next'.")
        lines = ["| Setting | Value | How it was set |", "|---|---|---|"]
        for r in rows:
            q = self.by_id[r["id"]]
            v = r["value"]
            if q["type"] == "choice":
                lab = next((o["label"] for o in self.options(q) if o["value"] == v), v)
                v = f"{lab} ({v})"
            elif q["type"] == "kv":
                ov = {k: get_path(self.data, f"model.params.{k}") for k in self.meta.get("override_keys", [])}
                v = ", ".join(f"{k}={val}" for k, val in ov.items()) or "none"
            elif isinstance(v, list):
                v = ", ".join(str(x) for x in v)
            how = {"answered": "you said", "default": "default, change it if you like"}[r["state"]]
            lines.append(f"| {r['label']} | {v} | {how} |")
        self.meta["shown"] = self.answers_hash()
        self.meta.pop("confirmed", None)
        self.save()
        return "\n".join(lines) + "\n\n" + "\n".join(f"- {n}" for n in self.notes())

    def notes(self):
        n = []
        goal, reg = self.value("goal"), self.value("look.register")
        if goal == "model_replay":
            n.append("Buildings sit on a generated grid in id order. People, vehicles and the layout are illustrative, not model output.")
            n.append("The frame renderer draws the first look of the region. Looks apply to place scenes.")
        else:
            n.append("The scene shows the place only. It does not show model output yet.")
            if self.value("place.kind") in ("osm_relation", "bbox", "extract_file"):
                n.append("OpenStreetMap data is ODbL. Carry the line '© OpenStreetMap contributors' with any picture or file you publish.")
        n.append("Colours, vehicles, trees and building styles for the region are proposals chosen by eye. People who know the place should check them.")
        if reg in ("formal", "both"):
            n.append("The formal style uses IBM Carbon grey tokens. Some of them are from memory and still to be checked against Carbon's documentation.")
        return n


def render_docs():
    """The question bank as Markdown, for docs/intake-questions.md. A test keeps the committed file in step with the bank."""
    bank = load_bank()
    out = ["# Intake questions", "",
           "Generated from `assets/intake_questions.yaml` by `paperdolls intake docs`. Edit the YAML and regenerate, not this file.", "",
           "The intake asks these questions in order. A question appears only when its `when` condition holds. Questions marked **always** are asked even when a default exists.", ""]
    for gid, title in bank["groups"].items():
        qs = [q for q in bank["questions"] if q["group"] == gid]
        if not qs:
            continue
        out += [f"## {title}", ""]
        for q in qs:
            out += [f"### `{q['id']}`: {q['label']}", "", f"Ask: \"{q['ask']}\"", "", f"Why: {q.get('why', '')}", ""]
            facts = [f"type: {q['type']}"]
            if q.get("when"):
                facts.append("only when " + ", ".join(f"`{k}` is {v if not isinstance(v, list) else ' or '.join(map(str, v))}" for k, v in q["when"].items()))
            if q.get("always_ask"):
                facts.append("**always** asked")
            elif q.get("always_ask_when"):
                facts.append("**always** asked when " + ", ".join(f"`{k}` is {' or '.join(map(str, v))}" for k, v in q["always_ask_when"].items()))
            if "default" in q:
                facts.append(f"default: `{q['default']}`")
            if "default_from" in q:
                facts.append(f"default: the answer to `model.params.{q['default_from']}`")
            if q.get("min") is not None or q.get("max") is not None:
                facts.append(f"range: {q.get('min', '')} to {q.get('max', '')}")
            out += ["- " + "; ".join(facts)]
            if q.get("options"):
                out += ["- options:"] + [f"  - `{o['value']}`: {o['label']}" + (f". {o['detail']}" if o.get("detail") else "") for o in q["options"]]
            elif q.get("options_from"):
                out += [f"- options: computed from {q['options_from']}"]
            if q.get("example"):
                out += [f"- example answer: `{q['example']}`"]
            if q.get("note"):
                out += [f"- note for the model: {q['note']}"]
            out += [""]
    return "\n".join(out)
