"""End-to-end tests of the command line: intake, place, viewer, doctor and looks.

These run bin/paperdolls as a subprocess, the way the skills do, so they also cover the launcher.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "bin" / "paperdolls"
FIXTURE = ROOT / "samples" / "osm_fixture_extract.json"

PLACE_ANSWERS = {"goal": "place_scene", "name": "Fixture block", "audience": "researchers", "place.kind": "extract_file",
                 "place.extract_path": "fixture.json", "look.region": "nw", "look.look": "brick", "look.register": "colorfigures"}


def lr(*args, cwd=None, check=True):
    p = subprocess.run([sys.executable, str(LAUNCHER), *map(str, args)], capture_output=True, text=True, cwd=cwd)
    if check and p.returncode != 0:
        raise AssertionError(f"paperdolls {' '.join(map(str, args))} exited {p.returncode}\n{p.stdout}\n{p.stderr}")
    return p


def run_intake(path, answers, cwd):
    """Answer every question the intake asks, then say yes to the decision table."""
    for _ in range(60):
        d = json.loads(lr("intake", "next", path, "--json", cwd=cwd).stdout)
        if d["status"] == "complete":
            return
        if d["status"] == "confirm":
            lr("intake", "show", path, cwd=cwd)
            lr("intake", "answer", path, "confirmed", "yes", cwd=cwd)
            continue
        qid = d["question"]["id"]
        assert qid in answers, f"the intake asked an unexpected question: {qid}"
        lr("intake", "answer", path, qid, answers[qid], cwd=cwd)
    raise AssertionError("the intake did not finish")


@pytest.fixture
def work(tmp_path):
    shutil.copyfile(FIXTURE, tmp_path / "fixture.json")
    return tmp_path


def test_launcher_is_executable():
    assert os.access(LAUNCHER, os.X_OK), "run: chmod +x bin/paperdolls"


def test_doctor_reports_ready(work):
    p = lr("doctor", "--json", cwd=work)
    d = json.loads(p.stdout)
    assert d["ok"] and {c["check"] for c in d["checks"]} >= {"Python packages", "Palettes", "Viewer templates"}


def test_looks_lists_three_per_region(work):
    rows = json.loads(lr("looks", "--json", cwd=work).stdout)
    assert len(rows) == 12 and all(len(r["looks"]) == 3 for r in rows)
    assert lr("looks", "--region", "nowhere", cwd=work, check=False).returncode != 0
    assert "brick" in lr("looks", "--region", "nw", cwd=work).stdout


def test_intake_rejects_bad_answers(work):
    lr("intake", "init", "r.yaml", cwd=work)
    lr("intake", "answer", "r.yaml", "goal", "place_scene", cwd=work)
    bad = lr("intake", "answer", "r.yaml", "goal", "banana", cwd=work, check=False)
    assert bad.returncode == 3 and "REJECTED" in bad.stderr
    lr("intake", "answer", "r.yaml", "name", "Fixture block", cwd=work)
    again = lr("intake", "init", "r.yaml", cwd=work, check=False)
    assert again.returncode == 3, "init must not overwrite an existing project without --force"


def test_intake_withdraws_confirmation_when_an_answer_changes(work):
    lr("intake", "init", "p.yaml", cwd=work)
    run_intake("p.yaml", PLACE_ANSWERS, work)
    assert yaml.safe_load((work / "p.yaml").read_text())["intake"]["confirmed"] is True
    lr("intake", "answer", "p.yaml", "look.look", "render", cwd=work)
    assert json.loads(lr("intake", "next", "p.yaml", "--json", cwd=work).stdout)["status"] == "confirm"
    blocked = lr("place", "p.yaml", cwd=work, check=False)
    assert blocked.returncode != 0 and "not confirmed" in (blocked.stdout + blocked.stderr)


def test_place_and_viewer_on_the_osm_fixture(work):
    lr("intake", "init", "p.yaml", cwd=work)
    run_intake("p.yaml", PLACE_ANSWERS, work)
    out = lr("place", "p.yaml", cwd=work).stdout
    assert "buildings: 135" in out
    folder = work / "paperdolls-out"
    scene = json.loads((folder / "scene.json").read_text())
    assert len(scene["buildings"]) == 135 and (folder / "scene_report.md").exists()
    lr("viewer", "p.yaml", cwd=work)
    page = (folder / "fixture-block-viewer.html").read_text(encoding="utf-8")
    assert "<script" in page and "__SCENE__" not in page and "__ASSETLIB__" not in page and "OpenStreetMap" in page


def test_viewer_needs_the_scene_first(work):
    lr("intake", "init", "p.yaml", cwd=work)
    run_intake("p.yaml", PLACE_ANSWERS, work)
    p = lr("viewer", "p.yaml", cwd=work, check=False)
    assert p.returncode != 0 and "paperdolls place" in (p.stdout + p.stderr)


def test_intake_rejects_a_path_that_does_not_exist(work):
    lr("intake", "init", "p.yaml", cwd=work)
    for qid in ("goal", "name", "audience", "place.kind"):
        lr("intake", "answer", "p.yaml", qid, PLACE_ANSWERS[qid], cwd=work)
    p = lr("intake", "answer", "p.yaml", "place.extract_path", "missing.json", cwd=work, check=False)
    assert p.returncode == 3 and "No file at" in p.stderr


def test_placeholder_viewer_needs_no_scene(work):
    answers = {"goal": "place_scene", "name": "Placeholder", "audience": "public", "place.kind": "placeholder", "look.region": "se",
               "look.look": None, "look.register": "formal", "look.drive": "left"}
    lr("intake", "init", "p.yaml", cwd=work)
    for _ in range(60):
        d = json.loads(lr("intake", "next", "p.yaml", "--json", cwd=work).stdout)
        if d["status"] == "complete":
            break
        if d["status"] == "confirm":
            lr("intake", "show", "p.yaml", cwd=work)
            lr("intake", "answer", "p.yaml", "confirmed", "yes", cwd=work)
            continue
        qid = d["question"]["id"]
        value = answers.get(qid)
        if qid == "look.look":
            value = d["question"]["options"][0]["value"]
        lr("intake", "answer", "p.yaml", qid, value, cwd=work)
    lr("place", "p.yaml", cwd=work)
    lr("viewer", "p.yaml", cwd=work)
    assert (work / "paperdolls-out" / "placeholder-viewer.html").stat().st_size > 50_000


def test_doctor_runs_and_names_the_fix_when_packages_are_missing():
    """doctor is the check that finds missing packages, so it must not crash on them."""
    code = ("import sys; [sys.modules.__setitem__(m, None) for m in ('numpy', 'PIL', 'yaml')]\n"
            f"sys.path.insert(0, {str(ROOT)!r}); from paperdolls.cli import main; main(['doctor'])")
    p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert p.returncode == 1 and "Traceback" not in p.stderr, p.stderr
    assert "FAIL  Python packages: missing: numpy, pillow, pyyaml" in p.stdout and "pip install" in p.stdout


def _replay_spec(tmp_path, model_path=None, legend=None):
    sp = {"goal": "model_replay", "name": "t", "model": {"params": {"n": 10, "run_time": 5}}, "look": {"region": "nw", "register": "colorfigures"},
          "replay": {"weeks": [0, 4]}}
    if model_path:
        sp["model"]["path"] = model_path
    if legend:
        sp["replay"]["legend"] = legend
    f = tmp_path / "render.yaml"
    f.write_text(yaml.safe_dump(sp), encoding="utf-8")
    return f


def test_legend_never_describes_a_model_that_is_not_the_one_drawn(tmp_path):
    from paperdolls import spec
    vendored = spec.load(_replay_spec(tmp_path))
    assert [k for _, k in spec.legend_for(vendored)][-1] == "investor"                       # Great Retrofit: its own labels
    other = spec.load(_replay_spec(tmp_path, model_path="m.py"))
    labels = [l for l, _ in spec.legend_for(other)]
    assert labels == ["State 1", "State 2", "State 3", "State 4"]                            # another model: neutral, no retrofit words
    named = spec.load(_replay_spec(tmp_path, model_path="m.py", legend={"to_do": "Susceptible", "in_progress": "Infectious", "finished": "Recovered"}))
    assert spec.legend_for(named) == [("Susceptible", "to_do"), ("Infectious", "in_progress"), ("Recovered", "finished")]


def test_legend_must_use_known_states(tmp_path):
    from paperdolls import spec
    with pytest.raises(spec.SpecError, match="replay.legend"):
        spec.load(_replay_spec(tmp_path, legend={"sick": "Sick"}))
