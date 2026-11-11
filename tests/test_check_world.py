"""The world-record validator must fail the template and any incomplete record,
and pass a complete one. It is the gate that was too weak to notice missing
Gate 5 sections.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "check-world.py"


def run(tmp_path, text):
    path = tmp_path / "world.md"
    path.write_text(text)
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
    )
    return result.returncode, result.stdout + result.stderr


def complete_record(**overrides):
    sections = {
        "Description": "A synthetic test world with a description long enough to validate.",
        "Step count type": "weeks",
        "Agents and structure mapping": "| breed | meaning | rendered as | count |\n|---|---|---|---|\n| building | test | block | 1 |",
        "Interactive parameters": "| parameter | default | range | live |\n|---|---|---|---|\n| x | 1 | 0-2 | yes |",
        "Dashboard outputs": "| output | source | shown |\n|---|---|---|\n| mean | plot | yes |",
        "Top colour": "- variable: score\n- range: 0-100",
        "Structural modifications": "None.",
        "Causal graph": "None confirmed.",
        "Scenarios and interventions": "None.",
        "Map": "- source: constructed\n- family: real\n- palette: nw\n- stored: `map-data/scene.json` (sha256: abc)\n- frame rotation: 0; structures fitting an asset: 0%\n- report: `map-data/scene_report.md`",
        "Decisions log": "\n".join(f"- 2026-11-10 — Gate {n}: recorded" for n in [1, 2, "2b", 3, 4, 5, 6, 7]),
        "Snapshot": "- version: v1\n- date: 2026-11-10",
        "Attribution": "- paperdolls: CC BY 4.0, Sci-Fi Economics Lab",
    }
    sections.update(overrides)
    body = "\n\n".join(f"## {name}\n\n{content}" for name, content in sections.items())
    return "# Test world\n\n" + body + "\n"


def test_complete_record_passes(tmp_path):
    code, output = run(tmp_path, complete_record())
    assert code == 0, output


def test_template_fails(tmp_path):
    code, output = run(tmp_path, (ROOT / "reference" / "templates" / "world.md").read_text())
    assert code == 1
    assert "FAIL" in output


def test_conformance_record_passes(tmp_path):
    record = ROOT / "worlds" / "conformance" / "conformance.md"
    if not record.exists():
        pytest.skip("conformance world not built yet")
    code, output = run(tmp_path, record.read_text())
    assert code == 0, output


def test_each_gate5_section_is_required(tmp_path):
    for heading in (
        "Top colour", "Structural modifications", "Causal graph",
        "Scenarios and interventions", "Snapshot",
    ):
        text = complete_record()
        # Remove the heading and its content up to the next heading.
        start = text.index(f"## {heading}")
        end = text.find("## ", start + 4)
        broken = text[:start] + (text[end:] if end != -1 else "")
        code, output = run(tmp_path, broken)
        assert code == 1, f"{heading} should be required: {output}"
        assert heading in output


def test_binding_cross_check_catches_family_and_top_colour_drift(tmp_path):
    (tmp_path / "sim-code").mkdir()
    binding = {
        "family": "historical", "region": "roman", "look": "roman",
        "register": "colorfigures", "dashboard": {"outputs": ["mean"]},
        "bindings": [{"entity": "building", "top_color": {"field": "other_field"}}],
    }
    (tmp_path / "sim-code" / "model-binding.json").write_text(json.dumps(binding))
    code, output = run(tmp_path, complete_record())
    assert code == 1
    assert "does not match Map family" in output
    assert "top-colour field 'other_field'" in output


def test_sections_must_be_in_order(tmp_path):
    text = complete_record()
    snapshot = text[text.index("## Snapshot"):text.index("## Attribution")]
    text = text.replace(snapshot, "")
    text = text.replace("## Decisions log", snapshot + "## Decisions log")
    code, output = run(tmp_path, text)
    assert code == 1
    assert "out of order" in output
