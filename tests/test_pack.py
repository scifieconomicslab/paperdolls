"""Model packs: the manifest validator (Python and JavaScript agree), the `pack` commands, the JSON Schema, and the node suites for the store,
the runtime adapter, the toy epidemic and the built page."""
import copy
import json
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml
from conftest import node_env

from paperdolls import cli, pack

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads((ROOT / "tests" / "pack_cases.json").read_text(encoding="utf-8"))
TOY = ROOT / "packs" / "toy-epidemic"
node = shutil.which("node")
needs_node = pytest.mark.skipif(node is None, reason="node is not installed")


def patched(base, patch):
    """A copy of base with each dotted path set (or deleted, for "$delete"). A path part that is a digit indexes a list."""
    m = copy.deepcopy(base)
    for path, value in patch.items():
        parts, cur = path.split("."), m
        for p in parts[:-1]:
            cur = cur[int(p)] if isinstance(cur, list) else cur.setdefault(p, {})
        last = parts[-1]
        if value == "$delete":
            if isinstance(cur, list):
                del cur[int(last)]
            else:
                cur.pop(last, None)
        elif isinstance(cur, list):
            cur[int(last)] = value
        else:
            cur[last] = value
    return m


def case_manifests():
    return [(c["name"], patched(CASES["base"], c["patch"]), c) for c in CASES["cases"]]


@pytest.mark.parametrize("name,manifest,case", case_manifests(), ids=[c["name"] for c in CASES["cases"]])
def test_python_validator_cases(name, manifest, case):
    errors, warnings = pack.validate(manifest)
    for want in case["errors"]:
        assert any(want in e for e in errors), f"expected an error containing {want!r}, got {errors}"
    for want in case["warnings"]:
        assert any(want in w for w in warnings), f"expected a warning containing {want!r}, got {warnings}"
    if not case["errors"]:
        assert errors == [], errors


def test_toy_pack_validates_clean():
    errors, warnings = pack.check(TOY)
    assert errors == [] and warnings == []


@needs_node
def test_javascript_validator_agrees_with_python_on_every_case(tmp_path):
    """Both validators give the same errors and warnings (as sets of messages) for the base, every case and the toy pack."""
    docs = {"base": CASES["base"], "toy": pack.load(TOY)}
    docs.update({name: m for name, m, _ in case_manifests()})
    f = tmp_path / "docs.json"
    f.write_text(json.dumps(docs), encoding="utf-8")
    r = subprocess.run([node, str(ROOT / "viz" / "test_pack.js"), "--dump", str(f)], capture_output=True, text=True, env=node_env(), timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    got = json.loads(r.stdout)
    for name, m in docs.items():
        errors, warnings = pack.validate(m)
        assert sorted(got[name]["errors"]) == sorted(errors), f"{name}: errors differ\n js: {got[name]['errors']}\n py: {errors}"
        assert sorted(got[name]["warnings"]) == sorted(warnings), f"{name}: warnings differ\n js: {got[name]['warnings']}\n py: {warnings}"


# ---- JSON Schema ----

def test_schema_accepts_valid_and_rejects_structural_errors():
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((ROOT / "schemas" / "pack.schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    v = jsonschema.Draft202012Validator(schema)
    assert list(v.iter_errors(CASES["base"])) == []
    assert list(v.iter_errors(pack.load(TOY))) == []
    for name, manifest, case in case_manifests():
        bad = list(v.iter_errors(manifest))
        if case.get("schema") == "fail":
            assert bad, f"the schema should reject: {name}"
        elif not case["errors"]:
            assert not bad, f"the schema should accept: {name}: {bad[0].message}"


# ---- the commands ----

def test_pack_check_command_ok(capsys):
    with pytest.raises(SystemExit) as e:
        cli.main(["pack", "check", str(TOY)])
    assert e.value.code == 0
    assert "ok" in capsys.readouterr().out


def test_pack_check_command_reports_errors(tmp_path, capsys):
    m = pack.load(TOY)
    m["params"]["beta"]["default"] = 5
    m["mappings"][0]["field"] = "ghost"
    (tmp_path / "pack.yaml").write_text(yaml.safe_dump(m, sort_keys=False), encoding="utf-8")
    (tmp_path / "runtime.js").write_text("// none", encoding="utf-8")
    with pytest.raises(SystemExit) as e:
        cli.main(["pack", "check", str(tmp_path), "--json"])
    assert e.value.code == 1
    out = json.loads(capsys.readouterr().out)
    assert not out["ok"] and any("params.beta.default" in x for x in out["errors"]) and any("has no field ghost" in x for x in out["errors"])


def test_pack_check_notices_a_missing_runtime_file(tmp_path):
    (tmp_path / "pack.yaml").write_text((TOY / "pack.yaml").read_text(encoding="utf-8"), encoding="utf-8")
    errors, _ = pack.check(tmp_path)
    assert any("runtime.js does not exist" in e for e in errors)


def test_pack_check_on_a_folder_without_a_manifest(tmp_path):
    errors, _ = pack.check(tmp_path)
    assert errors and "no pack.yaml" in errors[0]


def test_pack_build_refuses_an_invalid_pack(tmp_path):
    m = pack.load(TOY)
    m["id"] = "Not Valid"
    (tmp_path / "pack.yaml").write_text(yaml.safe_dump(m), encoding="utf-8")
    (tmp_path / "runtime.js").write_text("// none", encoding="utf-8")
    with pytest.raises(pack.PackError):
        pack.build_page(tmp_path)


def test_pack_page_is_one_self_contained_file(tmp_path):
    html = pack.build_page(TOY)
    assert "<title>Toy epidemic</title>" in html
    assert 'registerRuntime(\'toy-epidemic\'' in html
    import re
    assert not re.findall(r"/\*__[A-Z]+__\*/", html), "an unfilled template marker"
    assert "http://" not in html.replace("http://www.w3.org", "") and "https://" not in html.replace("https://github.com/scifieconomicslab", ""), "the page must not load anything from the network"
    assert "<script src" not in html and "<link " not in html


def test_existing_viewer_page_still_builds_without_pack_code():
    from paperdolls.viewer_build import build_viewer
    html = build_viewer()
    assert "PackHost" not in html and "labViewer" in html


# ---- node suites ----

@needs_node
def test_js_pack_suite_passes():
    r = subprocess.run([node, str(ROOT / "viz" / "test_pack.js"), "--manifest-json", json.dumps(pack.load(TOY))], capture_output=True, text=True, env=node_env(), timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout and "all passed" in r.stdout and "SKIP toy" not in r.stdout, r.stdout


@needs_node
def test_built_pack_page_runs_in_jsdom(tmp_path):
    page = tmp_path / "toy.html"
    page.write_text(pack.build_page(TOY), encoding="utf-8")
    r = subprocess.run([node, str(ROOT / "viz" / "test_pack_page.js"), str(page)], capture_output=True, text=True, env=node_env(), timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "FAIL" not in r.stdout
