"""`paperdolls pack check`: the manifest, the static rules that need two parts of it at once, the runtime run under node, and (optionally) parity
with a Python reference.

Exit code: 0 when there are no errors (and, with --strict, no warnings), 1 otherwise, 2 when the check itself could not run as asked.
The runtime part needs node (any version with `vm`, 14 or newer); without it the manifest checks still run and one warning says so.
"""
import importlib
import importlib.util
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from . import pack as packmod

ROOT = Path(__file__).resolve().parents[1]
NODE_SCRIPT = Path(__file__).with_name("packcheck.js")
FLOAT_TOL = 1e-9


class Result:
    """Ordered check results: each is {name, errors, warnings, info}."""

    def __init__(self, strict=False):
        self.items, self.strict, self.setup_failed = [], strict, False

    def add(self, name, errors=(), warnings=(), info=""):
        self.items.append({"name": name, "errors": list(errors), "warnings": list(warnings), "info": info})

    @property
    def errors(self):
        return [f"{i['name']}: {e}" if not e.startswith(i["name"]) else e for i in self.items for e in i["errors"]]

    @property
    def warnings(self):
        return [w for i in self.items for w in i["warnings"]]

    def ok(self):
        return not self.errors and not (self.strict and self.warnings)

    def exit_code(self):
        return 2 if self.setup_failed else (0 if self.ok() else 1)

    def as_dict(self):
        return {"ok": self.ok(), "errors": self.errors, "warnings": self.warnings, "checks": self.items}

    def render(self, path):
        lines = []
        for i in self.items:
            mark = "FAIL" if i["errors"] else ("WARN" if i["warnings"] else "PASS")
            lines.append(f"{mark}  {i['name']}" + (f" ({i['info']})" if i["info"] else ""))
            for e in i["errors"]:
                lines.append(f"      error: {e}")
            for w in i["warnings"]:
                lines.append(f"      warning: {w}")
        n_e, n_w = len(self.errors), len(self.warnings)
        verdict = "ok" if self.ok() else "FAILED"
        lines.append(f"{path}: {verdict}: {n_e} error(s), {n_w} warning(s)" + (" (warnings count: --strict)" if self.strict and n_w else ""))
        return "\n".join(lines)


# ---- static rules that need two parts of the manifest at once ----

def static_checks(m):
    """(errors, warnings) beyond the validator: every mapping (any channel, planned ones too) and every layout reference names a declared entity,
    field or series; every mapping has a legend heading; declared fields that nothing shows."""
    errors, warnings = [], []
    ents = m.get("entities") if isinstance(m.get("entities"), dict) else {}
    series = m.get("series") if isinstance(m.get("series"), dict) else {}
    used = set()
    for i, mp in enumerate(m.get("mappings") or []):
        if not isinstance(mp, dict):
            continue
        at = f"mappings[{i}]"
        e, f = mp.get("entity"), mp.get("field")
        if e not in ents:
            errors.append(f"{at}.entity: unknown entity {e}")
        elif not isinstance(ents[e].get("fields"), dict) or f not in ents[e]["fields"]:
            errors.append(f"{at}.field: entity {e} has no field {f}")
        else:
            used.add((e, f))
        sc = mp.get("scale")
        if isinstance(sc, dict) and not packmod._is_str(sc.get("label")) and sc.get("type") == "categorical":
            warnings.append(f"{at}.scale.label: missing: the legend heading will be the field name {f}")
    for region, items in (m.get("layout") or {}).items() if isinstance(m.get("layout"), dict) else []:
        for j, it in enumerate(items if isinstance(items, list) else []):
            if not isinstance(it, dict):
                continue
            at = f"layout.{region}[{j}]"
            refs = it.get("series")
            for s in ([refs] if isinstance(refs, str) else refs if isinstance(refs, list) else []):
                if s not in series:
                    errors.append(f"{at}.series: unknown series {s}")
            for key in ("field", "fields"):
                fv = it.get(key)
                en = it.get("entity")
                for fn in ([fv] if isinstance(fv, str) else fv if isinstance(fv, list) else []):
                    if en not in ents or fn not in (ents[en].get("fields") or {}):
                        errors.append(f"{at}.{key}: {en}.{fn} is not a declared field")
                    else:
                        used.add((en, fn))
    for e, spec in ents.items():
        for f in (spec.get("fields") or {}) if isinstance(spec, dict) else []:
            if (e, f) not in used and maps_exist(m):
                warnings.append(f"entities.{e}.fields.{f}: declared but no mapping or component shows it")
    return errors, warnings


def maps_exist(m):
    return bool(m.get("mappings"))


# ---- node ----

def _run_node(job):
    node = shutil.which("node")
    with tempfile.TemporaryDirectory() as td:
        jf = Path(td) / "job.json"
        jf.write_text(json.dumps(job), encoding="utf-8")
        p = subprocess.run([node, str(NODE_SCRIPT), str(jf)], capture_output=True, text=True, timeout=600)
    if p.returncode != 0 or not p.stdout.strip():
        raise packmod.PackError("node could not run the runtime check: " + (p.stderr.strip().splitlines() or ["no output"])[-1])
    return json.loads(p.stdout)


# ---- parity with a Python reference ----

def load_reference(spec):
    """A Python module by dotted name or by .py file (its folder is put on sys.path so its own imports resolve)."""
    p = Path(spec)
    if spec.endswith(".py") or p.is_file():
        if not p.is_file():
            raise packmod.PackError(f"reference module {spec} does not exist")
        sys.path.insert(0, str(p.resolve().parent))
        s = importlib.util.spec_from_file_location(p.stem, p.resolve())
        mod = importlib.util.module_from_spec(s)
        s.loader.exec_module(mod)
        return mod
    try:
        return importlib.import_module(spec)
    except ImportError as e:
        raise packmod.PackError(f"cannot import reference module {spec}: {e}") from e


def reference_frames(mod, case):
    """The reference's frames for a case: `pack_frames(case)` -> list of frames (or {"frames": [...]}), else `run_simulation(case)` then
    `to_pack_frames(result)`."""
    if hasattr(mod, "pack_frames"):
        out = mod.pack_frames(case)
    elif hasattr(mod, "run_simulation") and hasattr(mod, "to_pack_frames"):
        out = mod.to_pack_frames(mod.run_simulation(case))
    else:
        raise packmod.PackError("the reference module must define pack_frames(case) (or run_simulation(case) and to_pack_frames(result))")
    return out["frames"] if isinstance(out, dict) else out


def normalise_frames(manifest, frames):
    """Reference frames in the runtime's own shape: {t, entities: {name: {field: [..]}}, series: {name: [..]}}.

    Accepted: that shape already; or rows, `entities.<name>` given as a list of {field: value} objects. Category values may be names (turned into
    the index into the field's declared values; None becomes -1); None in a number field becomes NaN; a bare number in a series becomes [number]."""
    ents = manifest.get("entities") or {}
    out = []
    for fr in frames:
        e_out = {}
        for name, spec in ents.items():
            src = (fr.get("entities") or {}).get(name)
            if src is None and isinstance(fr.get(name + "s"), list):
                src = fr[name + "s"]
            if src is None:
                continue
            cols = {}
            for fn, f in spec["fields"].items():
                f = {"type": f} if isinstance(f, str) else f
                raw = [row.get(fn) for row in src] if isinstance(src, list) else list(src.get(fn, []))
                cols[fn] = [_cell(f, v) for v in raw]
            e_out[name] = cols
        s_out = {}
        for sn, pt in (fr.get("series") or {}).items():
            if sn in (manifest.get("series") or {}):
                s_out[sn] = [_num(v) for v in (pt if isinstance(pt, list) else [pt])]
        out.append({"t": fr.get("t"), "entities": e_out, "series": s_out})
    return out


def _num(v):
    return float("nan") if v is None else v


def _cell(f, v):
    if f["type"] == "category":
        if v is None:
            return -1
        if isinstance(v, str):
            return f["values"].index(v) if v in f["values"] else v      # an unknown name stays a name, so it shows as a difference
        return int(v)
    if f["type"] == "boolean":
        return bool(v) if v is not None else v
    return _num(v)


def diff(a, b, path="", tol=FLOAT_TOL):
    """First difference between two JSON-like values: exact for integers, strings and booleans; a relative tolerance for floats; NaN equals NaN.
    None when equal."""
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None or isinstance(a, str) or isinstance(b, str):
        return None if (a == b and type(a) is type(b)) else f"{path}: {a!r} != {b!r}"
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if isinstance(a, int) and isinstance(b, int):
            return None if a == b else f"{path}: {a} != {b}"
        if math.isnan(a) or math.isnan(b):
            return None if math.isnan(a) and math.isnan(b) else f"{path}: {a!r} != {b!r}"
        if math.isinf(a) or math.isinf(b):
            return None if a == b else f"{path}: {a!r} != {b!r}"
        return None if abs(a - b) <= tol * max(1.0, abs(a), abs(b)) else f"{path}: {a!r} != {b!r}"
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = diff(x, y, f"{path}[{i}]", tol)
            if d:
                return d
        return None
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            return f"{path}: keys {sorted(set(a) ^ set(b))} differ"
        for k in a:
            d = diff(a[k], b[k], f"{path}.{k}", tol)
            if d:
                return d
        return None
    return f"{path}: type {type(a).__name__} != {type(b).__name__}"


def _frames_diff(want, got):
    """Where reference frames and runtime frames first differ, worded for a person: 'frame 12 entities.building.state[3]: 1 != 2'."""
    if len(want) != len(got):
        return f"the reference has {len(want)} frames, the runtime {len(got)}"
    for w, g in zip(want, got):
        d = diff(w, g, "")
        if d:
            return f"frame {w.get('t')} {d.lstrip('.')}"
    return None


def parity_cases(path, cases_file=None):
    f = Path(cases_file) if cases_file else packmod.manifest_path(path).parent / "tests" / "parity_cases.json"
    if not f.is_file():
        raise packmod.PackError(f"no parity cases at {f}: pass --cases, or add tests/parity_cases.json to the pack (see docs/pack-authoring.md)")
    data = json.loads(f.read_text(encoding="utf-8"))
    cases = data["cases"] if isinstance(data, dict) else data
    for c in cases:
        if not isinstance(c, dict) or not isinstance(c.get("name"), str):
            raise packmod.PackError(f"{f}: each case needs a name")
    return cases


def check_parity(res, manifest, js_parity, mod, cases, golden_dir, update_golden):
    for c in cases:
        name = f"parity {c['name']}"
        got = js_parity.get(c["name"])
        if got is None or "error" in got:
            res.add(name, [f"the JS runtime failed: {(got or {}).get('error', 'no result')}"])
            continue
        errors, warnings = [], []
        try:
            ref = normalise_frames(manifest, reference_frames(mod, c))
        except packmod.PackError:
            raise
        except Exception as e:
            res.add(name, [f"the reference module failed: {type(e).__name__}: {e}"])
            continue
        gfile = Path(golden_dir) / f"{c['name']}.json" if golden_dir else None
        if gfile is not None:
            if update_golden or not gfile.exists():
                gfile.parent.mkdir(parents=True, exist_ok=True)
                gfile.write_text(json.dumps({"case": c["name"], "frames": ref}, separators=(",", ":")), encoding="utf-8")
                warnings.append(f"wrote golden {gfile.name}" + ("" if update_golden else " (it did not exist yet)"))
            else:
                try:
                    want = normalise_frames(manifest, json.loads(gfile.read_text(encoding="utf-8"))["frames"])
                except (ValueError, KeyError) as e:
                    errors.append(f"golden {gfile.name} is not readable: {e}")
                    want = None
                if want is not None:
                    d = _frames_diff(want, ref)
                    if d:
                        errors.append(f"the reference no longer reproduces golden {gfile.name}: {d} (regenerate with --update-golden if the model changed on purpose)")
                    ref = want                          # the committed trajectory is what the runtime must match
        d = _frames_diff(ref, got["frames"])
        if d:
            errors.append(f"the JS runtime differs from the reference: {d}")
        res.add(name, errors, warnings, info=f"{len(got['frames'])} frames")


# ---- the whole check ----

def run(path, scene_path=None, include=(), steps=48, strict=False, skip_runtime=False, parity=None, cases=None, golden=None, update_golden=False):
    res = Result(strict)
    errors, warnings = packmod.check(path)
    manifest = None
    try:
        manifest = packmod.load(path)
    except packmod.PackError:
        pass
    sE, sW = static_checks(manifest) if isinstance(manifest, dict) and not errors else ([], [])
    res.add("manifest", errors + sE, warnings + sW)
    if errors or sE:
        return res
    if skip_runtime:
        return res
    rt = manifest["runtime"]
    if rt.get("type") != "js":
        res.add("runtime", [], [f"a {rt.get('type')} runtime cannot be run yet (only js runs today)"])
        return res
    if not shutil.which("node"):
        res.add("runtime", [], ["node was not found, so the runtime was not run (install Node.js to check determinism and frames)"])
        if parity:
            res.add("parity", ["--runtime-parity needs node"])
            res.setup_failed = True
        return res
    try:
        sources = [f.read_text(encoding="utf-8") for f in packmod.runtime_files(path, include)]
    except OSError as e:
        res.add("runtime", [f"cannot read a runtime file: {e}"])
        return res
    mod = pcases = None
    if parity:
        try:
            mod, pcases = load_reference(parity), parity_cases(path, cases)
        except packmod.PackError as e:
            res.add("parity", [str(e)])
            res.setup_failed = True
            return res
    scene = None
    if scene_path:
        try:
            packmod.load_scene(scene_path)
            scene = str(Path(scene_path).resolve())
        except packmod.PackError as e:
            res.add("scene", [str(e)])
            res.setup_failed = True
            return res
    try:
        out = _run_node({"viz": str(ROOT / "viz"), "manifest": manifest, "sources": sources, "scene": scene, "steps": max(1, steps), "parity": pcases})
    except (packmod.PackError, subprocess.TimeoutExpired) as e:
        res.add("runtime", [str(e)])
        res.setup_failed = True
        return res
    for c in out["checks"]:
        res.add(c["name"], c["errors"], c["warnings"], info=c.get("info", ""))
    if parity:
        check_parity(res, manifest, out["parity"], mod, pcases, golden, update_golden)
    return res
