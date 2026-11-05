"""The replay page: the payload a model's trajectory becomes, and the built page driven headlessly (needs node, jsdom and canvas for the last)."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import yaml

from conftest import node_env
from paperdolls import export, replay_build, spec
from test_pipeline import TOY, WEALTH, SICK, _toy_spec

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


def _traj(tmp_path, mapping):
    sp = spec.normalise(_toy_spec(mapping))
    out = tmp_path / "t.npz"
    export.run_and_export({"n": 12, "run_time": 6}, out, TOY, variables=spec.mapping_variables(sp))
    return sp, export.load(out)


def test_payload_carries_missing_values_as_null_and_names_for_states_as_codes(tmp_path):
    sp, traj = _traj(tmp_path, [WEALTH, SICK])
    p = replay_build.payload(sp, traj)
    assert len(p["weeks"]) == 6 and p["n"] == 12
    w = p["weeks"][0]["vars"]["building.wealth"]
    assert w[2] == 2 and w[3] is None                                  # odd ids have no wealth: null, not 0
    assert set(p["mapping"][1]["scale"]["values"]) == {"2", "0"}       # in_progress and to_do, as the codes the exporter keeps
    assert p["weeks"][0]["vars"]["building.state"][0] == 2             # building 0 starts infectious
    assert [s["label"] for s in p["states"]] == ["State 1", "State 2", "State 3", "State 4"]
    json.dumps(p)                                                      # the page embeds it as JSON


def test_payload_without_a_mapping_is_just_the_state_codes(tmp_path):
    sp, traj = _traj(tmp_path, None)
    p = replay_build.payload(sp, traj)
    assert p["mapping"] == [] and "vars" not in p["weeks"][0] and len(p["weeks"][0]["codes"]) == 12


def _has(mod):
    return NODE and subprocess.run([NODE, "-e", f"require('{mod}')"], capture_output=True, env=node_env()).returncode == 0


@pytest.mark.skipif(not _has("jsdom"), reason="node and jsdom are needed (npm ci)")
@pytest.mark.parametrize("mapping, legend, forbid", [([WEALTH, SICK], "Wealth|Infectious|Susceptible|Placement invented", "retrofit"), (None, "State 1|State 4", "retrofit")])
def test_replay_page_plays_scrubs_and_labels_honestly(tmp_path, mapping, legend, forbid):
    sp = _toy_spec(mapping)
    sp["replay"]["weeks"] = [0, 5]
    (tmp_path / "render.yaml").write_text(yaml.safe_dump(sp), encoding="utf-8")
    env = {**os.environ, "PYTHONPATH": str(ROOT)}
    for args in (["export", "render.yaml", "--out", "t.npz"], ["replay", "render.yaml", "t.npz", "--out", "replay.html"]):
        r = subprocess.run([sys.executable, str(ROOT / "bin" / "paperdolls"), *args], cwd=tmp_path, capture_output=True, text=True, env=env)
        assert r.returncode == 0, r.stdout + r.stderr
    r = subprocess.run([NODE, str(ROOT / "viz" / "test_replay_page.js"), str(tmp_path / "replay.html")], capture_output=True, text=True,
                       env={**node_env(), "EXPECT_LEGEND": legend, "FORBID_WORD": forbid}, timeout=240)
    assert r.returncode == 0 and "PASS replay page" in r.stdout, r.stdout + r.stderr


def test_replay_refuses_a_scene_with_fewer_buildings_than_the_model_and_says_both_numbers(tmp_path):
    sp = _toy_spec([WEALTH])
    (tmp_path / "render.yaml").write_text(yaml.safe_dump(sp), encoding="utf-8")
    scene = {"area": {"name": "tiny"}, "roads": [], "landuse": [], "trees": [], "buildings": [{"id": i, "footprint": [[i * 20, 0], [i * 20 + 8, 0], [i * 20 + 8, 8], [i * 20, 8]], "levels": 2} for i in range(5)]}
    (tmp_path / "scene.json").write_text(json.dumps(scene), encoding="utf-8")
    env = {**os.environ, "PYTHONPATH": str(ROOT)}
    cli = [sys.executable, str(ROOT / "bin" / "paperdolls")]
    assert subprocess.run(cli + ["export", "render.yaml", "--out", "t.npz"], cwd=tmp_path, env=env, capture_output=True).returncode == 0
    r = subprocess.run(cli + ["replay", "render.yaml", "t.npz", "--scene", "scene.json", "--out", "r.html"], cwd=tmp_path, env=env, capture_output=True, text=True)
    assert r.returncode != 0 and "model has 12 buildings, scene has 5" in (r.stdout + r.stderr), r.stdout + r.stderr
    assert not (tmp_path / "r.html").exists()
