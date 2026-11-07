#!/usr/bin/env python
"""Differential fuzz: paperdolls/pack.py validate() vs viz/packvalidate.js vs schemas/pack.schema.json on mutated manifests.

Run:  /data/ScifiEconomicsLab/TheGreatRetrofit/.venv/bin/python docs/state-machines/repro/validator_diff.py [N] [SEED]
Takes the base manifest from tests/pack_cases.json, applies 1-3 random mutations (wrong types, empty values, NaN, huge numbers, deleted keys) and
compares: (1) Python verdict vs JS verdict (errors empty or not), (2) the exact message sets, (3) the JSON Schema verdict against both.
Prints counts and the first example of each kind of disagreement. No network. Deterministic for a given SEED.
"""
import copy
import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from paperdolls import pack  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 1
CASES = json.loads((ROOT / "tests" / "pack_cases.json").read_text(encoding="utf-8"))
BASE = CASES["base"]
JUNK = [None, "", " ", "x", "X", "a-b", "1", 0, -1, 1, 2, 1.5, 0.1, 10 ** 15, 2 ** 70, 1e308, float("nan"), float("inf"), float("-inf"), True, False, [], {}, [None], ["a", "a"], {"a": 1}, "#12345", "#GGGGGG", "#abcdef", "wall", "true", "../x.js", "/abs.js"]


def paths(o, prefix=()):
    yield prefix
    if isinstance(o, dict):
        for k, v in o.items():
            yield from paths(v, prefix + (k,))
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from paths(v, prefix + (i,))


def get_parent(m, path):
    cur = m
    for p in path[:-1]:
        cur = cur[p]
    return cur


def mutate(rng):
    m = copy.deepcopy(BASE)
    for _ in range(rng.randint(1, 3)):
        ps = [p for p in paths(m) if p]
        path = rng.choice(ps)
        par = get_parent(m, path)
        r = rng.random()
        if r < 0.2:
            if isinstance(par, dict):
                par.pop(path[-1], None)
            else:
                del par[path[-1]]
        elif r < 0.3 and isinstance(par, dict):
            par[rng.choice(["extra", "Id", "1", "true", ""])] = rng.choice(JUNK)
        else:
            par[path[-1]] = copy.deepcopy(rng.choice(JUNK))
    return m


def js_literal(o):
    return json.dumps(o, allow_nan=True)          # NaN / Infinity are valid JS literals, and are what the page's embedded manifest contains


def main():
    rng = random.Random(SEED)
    docs = {f"m{i}": mutate(rng) for i in range(N)}
    f = Path(tempfile.mkdtemp()) / "docs.js"
    f.write_text(js_literal(docs), encoding="utf-8")
    p = subprocess.run(["node", str(Path(__file__).with_name("validator_diff.js")), str(f)], capture_output=True, text=True, timeout=300)
    if p.returncode:
        print(p.stderr); return 2
    js = json.loads(p.stdout)
    import jsonschema
    schema = json.loads((ROOT / "schemas" / "pack.schema.json").read_text(encoding="utf-8"))
    v = jsonschema.Draft202012Validator(schema) if "2020" in schema.get("$schema", "") else jsonschema.Draft7Validator(schema)
    stat = dict(total=0, py_crash=0, js_crash=0, verdict_differs=0, message_set_differs=0, schema_accepts_but_both_reject=0, schema_rejects_but_both_accept=0, both_accept=0)
    first = {}
    for name, m in docs.items():
        stat["total"] += 1
        try:
            pe, pw = pack.validate(m)
        except Exception as e:
            stat["py_crash"] += 1; first.setdefault("py_crash", (name, m, f"{type(e).__name__}: {e}")); continue
        j = js[name]
        if "crash" in j:
            stat["js_crash"] += 1; first.setdefault("js_crash", (name, m, j["crash"])); continue
        pok, jok = not pe, not j["errors"]
        if pok != jok:
            stat["verdict_differs"] += 1; first.setdefault("verdict_differs", (name, m, f"py errors={pe[:2]} js errors={j['errors'][:2]}"))
        elif sorted(pe) != sorted(j["errors"]) or sorted(pw) != sorted(j["warnings"]):
            stat["message_set_differs"] += 1; first.setdefault("message_set_differs", (name, m, f"py={sorted(set(pe) ^ set(j['errors']))[:2]} only-in-one"))
        if pok and jok:
            stat["both_accept"] += 1
        try:
            sok = v.is_valid(json.loads(json.dumps(m)))              # a schema works on JSON, so NaN stays a float and ints stay ints
        except Exception as e:
            sok = None
        if sok is True and not pok and not jok is True and False:
            pass
        if sok and pe and j["errors"]:
            stat["schema_accepts_but_both_reject"] += 1; first.setdefault("schema_accepts_but_both_reject", (name, m, f"py={pe[:2]}"))
        if sok is False and not pe and not j["errors"]:
            stat["schema_rejects_but_both_accept"] += 1; first.setdefault("schema_rejects_but_both_accept", (name, m, next(iter(v.iter_errors(m))).message[:150]))
    print(json.dumps(stat))
    for k, (name, m, why) in first.items():
        print(f"\n== first {k}: {name}: {why}")
        base_flat = json.dumps(BASE, sort_keys=True)
        diff = {}
        for path in paths(m):
            pass
        print("   mutated paths:", [".".join(map(str, p)) for p in paths(m) if p and (lambda a, b: a != b)(_at(m, p), _at(BASE, p))][:4])
    return 0


def _at(o, path):
    cur = o
    for p in path:
        try:
            cur = cur[p]
        except (KeyError, IndexError, TypeError):
            return "<absent>"
    return json.dumps(cur, sort_keys=True, default=str) if isinstance(cur, (dict, list)) else cur


if __name__ == "__main__":
    sys.exit(main())
