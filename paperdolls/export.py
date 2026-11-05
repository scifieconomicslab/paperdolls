"""Run the model with a read-only hook and write a trajectory file (.npz).

Each week stores two arrays per building: the retrofit state (codes 0-3) and a
separate investor-ownership flag (0 or 1). Keeping them apart means an investor-owned
building still shows its retrofit state.
Codes: 0 to_do, 1 queued, 2 in_progress, 3 finished.
"""
import json
import numpy as np
from . import model_loader

CODE = {"to_do": 0, "queued": 1, "in_progress": 2, "finished": 3}

def _read(building, households, path):
    """One declared variable of one building: 'building.x' is an attribute of the building, 'owner.x' of the household that owns it.
    Anything missing, or not a number, is NaN, so the picture can say "no data" instead of drawing zero."""
    who, _, attr = path.partition(".")
    obj = building if who == "building" else (households.get(building.owner_id) if building.owner_id is not None else None) if who == "owner" else None
    v = getattr(obj, attr, None) if obj is not None else None
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if attr == "state" and isinstance(v, str) and v in CODE:        # a state name is read as its code, the same one the exporter keeps for it
        return float(CODE[v])
    return float(v) if isinstance(v, (int, float, np.integer, np.floating)) else float("nan")


def _classify(building, households):
    """Return (retrofit state code, investor-owned flag)."""
    owner = households.get(building.owner_id) if building.owner_id is not None else None
    investor = 1 if (owner is not None and getattr(owner, "is_investor", False)) else 0
    return CODE.get(building.state, 0), investor

def run_and_export(params_dict, out_path, model_path=None, variables=()):
    mod = model_loader.load(model_path)
    try:
        params = mod.Params(**params_dict)
    except TypeError as err:
        raise ValueError(f"model.params does not match the model's Params: {err}") from err
    weeks_ids, weeks_codes, weeks_inv, offsets = [], [], [], [0]
    aggregates = {}
    var_weeks = {v: [] for v in variables}

    def hook(t, buildings, households, coops):
        for v in variables:
            var_weeks[v].append(np.array([_read(b, households, v) for b in buildings], dtype=np.float32))
        ids = np.array([b.id for b in buildings], dtype=np.int32)
        pairs = [_classify(b, households) for b in buildings]
        codes = np.array([p[0] for p in pairs], dtype=np.int8)
        inv = np.array([p[1] for p in pairs], dtype=np.int8)
        weeks_ids.append(ids); weeks_codes.append(codes); weeks_inv.append(inv)
        offsets.append(offsets[-1] + len(ids))

    result = mod.run_simulation(params, on_week=hook)
    series = ["weekly_to_do", "weekly_queued", "weekly_in_progress", "weekly_finished",
              "weekly_investor_purchases", "weekly_gini", "population_trajectory"]
    for s in series:
        val = getattr(result, s, None)
        if val is not None:
            aggregates[s] = np.asarray(val)
    meta = dict(params=params_dict, model_sha256=model_loader.file_sha256(model_path),
                weeks_recorded=len(weeks_ids), total_weeks=int(result.total_weeks))
    np.savez_compressed(
        out_path,
        ids=np.concatenate(weeks_ids) if weeks_ids else np.array([], np.int32),
        codes=np.concatenate(weeks_codes) if weeks_codes else np.array([], np.int8),
        investor=np.concatenate(weeks_inv) if weeks_inv else np.array([], np.int8),
        offsets=np.array(offsets, dtype=np.int64),
        meta=np.array(json.dumps(meta)),
        **{f"agg_{k}": v for k, v in aggregates.items()},
        **{f"var_{v}": (np.concatenate(a) if a else np.array([], np.float32)) for v, a in var_weeks.items()},
    )
    return out_path

def load(path):
    z = np.load(path, allow_pickle=False)
    meta = json.loads(str(z["meta"]))
    offsets = z["offsets"]
    ids, codes, inv = z["ids"], z["codes"], z["investor"]
    weeks = [(ids[offsets[t]:offsets[t+1]], codes[offsets[t]:offsets[t+1]], inv[offsets[t]:offsets[t+1]])
             for t in range(len(offsets)-1)]
    agg = {k[4:]: z[k] for k in z.files if k.startswith("agg_")}
    vars_ = {k[4:]: [z[k][offsets[t]:offsets[t+1]] for t in range(len(offsets)-1)] for k in z.files if k.startswith("var_")}
    return dict(weeks=weeks, meta=meta, agg=agg, vars=vars_)

def codes_for_week(traj, week, which="codes"):
    """Dense array indexed by building id for one week (missing ids = -1). which: 'codes' or 'investor'."""
    ids, codes, inv = traj["weeks"][week]
    values = codes if which == "codes" else inv
    size = int(ids.max()) + 1 if len(ids) else 0
    dense = np.full(size, -1, dtype=np.int8)
    dense[ids] = values
    return dense
