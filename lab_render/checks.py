"""Gates that a build must pass. Each returns (ok, message)."""
import numpy as np
from . import export, model_loader

def determinism(params_dict, tmp_a, tmp_b, model_path=None):
    export.run_and_export(params_dict, tmp_a, model_path)
    export.run_and_export(params_dict, tmp_b, model_path)
    a, b = export.load(tmp_a), export.load(tmp_b)
    same = len(a["weeks"]) == len(b["weeks"]) and all(
        np.array_equal(x[0], y[0]) and np.array_equal(x[1], y[1]) for x, y in zip(a["weeks"], b["weeks"]))
    return same, "two runs with the same seed give identical trajectories" if same else "DETERMINISM FAILED"

def hook_is_read_only(params_dict, model_path=None):
    mod = model_loader.load(model_path)
    p = mod.Params(**params_dict)
    plain = mod.run_simulation(p)
    hooked = mod.run_simulation(mod.Params(**params_dict), on_week=lambda *a: None)
    same = True
    for k, v in vars(plain).items():
        if isinstance(v, np.ndarray) and not np.array_equal(v, getattr(hooked, k)):
            same = False
            break
    return same, "the on_week hook leaves model results unchanged" if same else "HOOK CHANGES RESULTS"

def one_state_per_building(traj, n):
    """At least n buildings each week (new construction can add more), and no duplicate ids."""
    bad = []
    for t, (ids, codes, inv) in enumerate(traj["weeks"]):
        if len(ids) < n or len(set(ids.tolist())) != len(ids):
            bad.append(t)
    return (not bad), ("every building has exactly one state each week" if not bad
                       else f"{len(bad)} weeks with missing or duplicate buildings, first at week {bad[0]}")

def model_totals_reconcile(traj, n):
    """Compare the model's own weekly counts with the exporter's per-building counts.
    The model can count a resold building twice (investor_purchases counts transactions), so mismatches are reported, not hidden."""
    agg = traj["agg"]
    if not {"weekly_to_do", "weekly_queued", "weekly_in_progress", "weekly_finished", "weekly_investor_purchases"} <= set(agg):
        return True, "model aggregates not exported; reconciliation skipped"
    mismatch = []
    for t, (ids, codes, inv) in enumerate(traj["weeks"]):
        pipeline = int(agg["weekly_to_do"][t] + agg["weekly_queued"][t] + agg["weekly_in_progress"][t] + agg["weekly_finished"][t])
        model_total = pipeline + int(agg["weekly_investor_purchases"][t])
        if model_total != n:
            mismatch.append((t, model_total - n))
    if not mismatch:
        return True, "model aggregates reconcile with building count"
    worst = max(abs(m[1]) for m in mismatch)
    return False, (f"model aggregates do not reconcile with {n} buildings in {len(mismatch)} weeks (worst off by {worst}); "
                   "the exporter classifies each building once, so the render is unaffected")

def palette_schema(families):
    """Every colour in palettes.json is a hex string: the legacy keys on each family, and every look inside it."""
    import re
    hexre = re.compile(r"^#[0-9a-fA-F]{6}$")
    bad = []
    def check(label, v):
        if not (isinstance(v, str) and hexre.match(v)):
            bad.append(label)
    for fid, f in families.items():
        for k in ("wall", "wall2", "roof", "ground", "accent", "shadow"):
            check(f"{fid}.{k}", f.get(k, ""))
        for look in f.get("looks", []):
            lid = f"{fid}/{look.get('id', '?')}"
            for k in ("ground", "road", "pave", "grass", "water", "shadow"):
                check(f"{lid}.{k}", look.get(k, ""))
            for k, n in (("walls", 4), ("roofs", 2), ("accents", 3), ("canopies", 3)):
                vals = look.get(k, [])
                if len(vals) != n:
                    bad.append(f"{lid}.{k} needs {n} colours")
                for i, v in enumerate(vals):
                    check(f"{lid}.{k}[{i}]", v)
            if look.get("bloom") is not None:
                check(f"{lid}.bloom", look["bloom"])
            if look.get("surface") not in ("asphalt", "concrete", "cobble", "earth"):
                bad.append(f"{lid}.surface")
    return (not bad), ("all palette colours are hex strings" if not bad else f"bad colours: {bad}")


def completions_bounded(traj, completed_total):
    """Buildings in the finished state (any owner) cannot exceed the model's cumulative completions."""
    ids, codes, inv = traj["weeks"][-1]
    finished_now = int((codes == 3).sum())
    ok = finished_now <= completed_total
    return ok, (f"finished buildings at the end ({finished_now}) do not exceed cumulative completions ({completed_total})"
                if ok else f"FINISHED COUNT EXCEEDS COMPLETIONS: {finished_now} > {completed_total}")
