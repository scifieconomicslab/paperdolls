"""Tests for the v1 pipeline. Run from the plugin root: python -m pytest tests -q"""
import json
from pathlib import Path
import numpy as np
import pytest
from paperdolls import spec, export, checks, model_loader
from paperdolls.render import palettes, facades, block
from conftest import needs_model

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "assets" / "demo_render.yaml"
SMALL = dict(n=60, n_co_ops=3, E=100000, tau=20, surplus=0.2, mean_time=12, time_var=4, week_cost=1000,
             run_time=120, seed=7, n_households=60, income_mean=45000, income_cv=0.35, wealth_pareto_alpha=1.5,
             aspiration_mean=50, aspiration_sd=15, search_length=5, n_neighbourhoods=4, enable_bargaining=True,
             max_bid_shade=0.2, seller_reservation_pct=0.8, n_banks=3, bank_ltv_mean=0.8, bank_ltv_sd=0.05,
             bank_spread_mean=0.02, enable_default=True, income_ar1_rho=0.95, income_shock_sd=0.1,
             unemployment_prob=0.001, enable_investors=True, investor_hurdle_mean=0.05, investor_hurdle_sd=0.01,
             enable_construction=True, build_cost=150000, construction_lag_weeks=52, depreciation_rate=0.01,
             enable_demographics=True, birth_rate=0.01, death_rate=0.01, enable_heterogeneous_expectations=True,
             extrapolator_share=0.5)

def test_demo_spec_validates():
    assert spec.load(DEMO)["name"]

def test_spec_rejects_bad_weeks():
    d = spec.load(DEMO)
    d["replay"]["weeks"] = [999]
    with pytest.raises(spec.SpecError):
        spec.validate(d)

def test_spec_rejects_unknown_register():
    d = spec.load(DEMO)
    d["replay"]["registers"] = ["neon"]
    with pytest.raises(spec.SpecError):
        spec.validate(d)

@needs_model
def test_export_round_trip(tmp_path):
    out = tmp_path / "t.npz"
    export.run_and_export(SMALL, out)
    t = export.load(out)
    assert len(t["weeks"]) == SMALL["run_time"]  # weeks recorded by the loop (0..run_time-1)
    ids, codes, inv = t["weeks"][0]
    assert len(ids) == SMALL["n"] and len(set(ids.tolist())) == SMALL["n"]
    assert set(codes.tolist()) <= {0, 1, 2, 3}
    assert set(inv.tolist()) <= {0, 1}

@needs_model
def test_hook_does_not_change_results():
    ok, _ = checks.hook_is_read_only(SMALL)
    assert ok

@needs_model
def test_determinism(tmp_path):
    ok, _ = checks.determinism(SMALL, tmp_path / "a.npz", tmp_path / "b.npz")
    assert ok

@needs_model
def test_completions_bounded(tmp_path):
    out = tmp_path / "t.npz"
    export.run_and_export(SMALL, out)
    t = export.load(out)
    res = model_loader.load().run_simulation(model_loader.load().Params(**SMALL))
    ok, msg = checks.completions_bounded(t, int(res.finished))
    assert ok, msg

def test_palettes_are_valid_hex():
    ok, msg = checks.palette_schema(palettes.load_families())
    assert ok, msg

def test_all_families_render_a_frame():
    fams = palettes.load_families()
    L = block.Layout(40)
    R = block.Renderer(L, seed=1)
    codes = np.array([i % 4 for i in range(40)], dtype=np.int8)
    inv = np.array([i % 3 == 0 for i in range(40)], dtype=np.int8)
    for fid, fam in fams.items():
        for reg in ("colorfigures", "formal"):
            img = R.frame(fam, reg, codes, "test", investor=inv)
            assert img.size == (R.W, R.H)

def test_facades_are_deterministic_and_valid():
    s1 = facades.generate(123, 5)
    s2 = facades.generate(123, 5)
    assert s1 == s2
    style, g = s1
    assert len(g) == 5 and all(len(r) == facades.COLS for r in g)
    assert g[-1].count("D") >= 1

def test_layout_fits_requested_buildings():
    for n in (10, 60, 120, 200):
        L = block.Layout(n)
        assert len(L.cells) == n
        assert len(set(L.cells)) == n
        assert not (set(L.cells) & L.square_cells)

@needs_model
def test_week_bounds_match_recorded_weeks():
    d = spec.load(DEMO)
    d["replay"]["weeks"] = [d["model"]["params"]["run_time"]]
    with pytest.raises(spec.SpecError):
        spec.validate(d)


# ---- the variable mapping contract (a model says which of its variables to show, and how) ----
TOY = Path(__file__).resolve().parent / "toy_model.py"


def _toy_spec(mapping=None):
    rep = {"weeks": [0, 5]}
    if mapping is not None:
        rep["mapping"] = mapping
    return {"goal": "model_replay", "name": "toy", "model": {"path": str(TOY), "params": {"n": 12, "run_time": 6}},
            "look": {"region": "nw", "register": "colorfigures"}, "replay": rep}


WEALTH = {"variable": "building.wealth", "channel": "wall",
          "scale": {"type": "sequential", "domain": [0, 10], "colours": ["#f4e9c8", "#c8452f"], "label": "Wealth"}}
SICK = {"variable": "building.state", "channel": "overlay",
        "scale": {"type": "categorical", "values": {"in_progress": {"overlay": "scaffold", "label": "Infectious"}, "to_do": {"overlay": None, "label": "Susceptible"}}}}


@pytest.mark.parametrize("bad, text", [
    ({**WEALTH, "channel": "height"}, "channel"),
    ({**WEALTH, "scale": {**WEALTH["scale"], "type": "log"}}, "scale"),
    ({**WEALTH, "variable": ""}, "variable"),
    ({**WEALTH, "channel": "overlay"}, "sequential"),
    ({**WEALTH, "scale": {**WEALTH["scale"], "domain": [5, 5]}}, "domain"),
    ({**WEALTH, "scale": {**WEALTH["scale"], "colours": ["#fff"]}}, "colours"),
    ({**SICK, "scale": {"type": "categorical", "values": {"x": {"overlay": "rocket", "label": "X"}}}}, "overlay"),
    ({**SICK, "scale": {"type": "categorical", "values": {}}}, "values"),
])
def test_mapping_rejects_bad_entries_with_a_readable_error(bad, text):
    with pytest.raises(spec.SpecError, match=text):
        spec.validate(spec.normalise(_toy_spec([bad])))


def test_mapping_accepts_good_entries_and_names_its_variables():
    d = spec.normalise(_toy_spec([WEALTH, SICK]))
    assert spec.validate(d)
    assert spec.mapping_variables(d) == ["building.wealth", "building.state"]
    assert spec.mapping_for(_toy_spec()) == []                       # no mapping: the four states, as before


def test_export_records_declared_variables_with_nan_where_a_model_does_not_set_them(tmp_path):
    out = tmp_path / "t.npz"
    export.run_and_export({"n": 12, "run_time": 6}, out, TOY, variables=["building.wealth", "owner.income", "building.nope"])
    t = export.load(out)
    w = t["vars"]["building.wealth"]
    assert len(w) == 6 and all(len(a) == 12 for a in w)
    assert w[0][2] == 2.0 and np.isnan(w[0][3])                        # even ids carry wealth; odd ids do not: NaN, not zero
    inc = t["vars"]["owner.income"]
    assert inc[0][1] == 1001.0 and np.isnan(inc[0][0])                 # building 0 has no owner
    assert np.isnan(t["vars"]["building.nope"][3]).all()
