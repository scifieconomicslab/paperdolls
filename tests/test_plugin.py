"""Checks that the plugin is packaged correctly: manifest, marketplace entry, skills, commands, agents, docs and licences."""
import json
import re
from pathlib import Path

import pytest
import yaml

from lab_render import __version__
from lab_render.intake import render_docs

ROOT = Path(__file__).resolve().parents[1]
NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def frontmatter(path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    assert m, f"{path.relative_to(ROOT)} has no frontmatter"
    return yaml.safe_load(m.group(1)), text[m.end():]


def test_manifest():
    m = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text())
    assert NAME.match(m["name"]) and m["name"] == "lab-render"
    assert m["version"] == __version__ == "0.6.1"
    assert m["license"] == "CC-BY-4.0" and m["description"] and m["author"]["name"]
    assert "UNLICENSED" not in json.dumps(m)


def test_marketplace_lists_this_plugin():
    mk = json.loads((ROOT / ".claude-plugin" / "marketplace.json").read_text())
    manifest = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text())
    assert NAME.match(mk["name"]) and mk["owner"]["name"]
    (entry,) = mk["plugins"]
    assert entry["name"] == manifest["name"] and entry["version"] == manifest["version"]
    assert (ROOT / entry["source"]).resolve() == ROOT


@pytest.mark.parametrize("skill", sorted(p.name for p in (ROOT / "skills").iterdir()))
def test_skills(skill):
    fm, body = frontmatter(ROOT / "skills" / skill / "SKILL.md")
    assert fm["name"] == skill and NAME.match(skill)
    assert 40 < len(fm["description"]) <= 1024 and body.strip()


@pytest.mark.parametrize("cmd", sorted((ROOT / "commands").glob("*.md")), ids=lambda p: p.stem)
def test_commands(cmd):
    fm, body = frontmatter(cmd)
    assert fm["description"] and body.strip()


@pytest.mark.parametrize("agent", sorted((ROOT / "agents").glob("*.md")), ids=lambda p: p.stem)
def test_agents(agent):
    fm, _ = frontmatter(agent)
    assert fm["name"] == agent.stem and fm["description"]


def test_no_stale_names_in_plugin_files():
    """The old command flow (sim.yaml, python -m) and old names must not survive in what Claude reads."""
    files = list((ROOT / "skills").rglob("*.md")) + list((ROOT / "commands").glob("*.md")) + list((ROOT / "agents").glob("*.md")) + [ROOT / "README.md"]
    for f in files:
        text = f.read_text(encoding="utf-8")
        for stale in ("sim.yaml", "python -m lab_render", "retrofit-sim", "UNLICENSED"):
            assert stale not in text, f"{f.relative_to(ROOT)} mentions {stale}"


def test_every_lab_render_command_in_the_docs_exists():
    text = "\n".join(p.read_text(encoding="utf-8") for p in [*(ROOT / "skills").rglob("*.md"), *(ROOT / "commands").glob("*.md"), ROOT / "README.md"])
    known = {"validate", "export", "check", "frames", "build", "ingest", "osm-query", "osm-fetch", "doctor", "looks", "intake", "place", "viewer"}
    used = set(re.findall(r"(?:^|`)lab-render ([a-z][a-z-]+)", text, re.M))
    assert used <= known, f"documented commands that do not exist: {used - known}"


def test_launcher_and_icon_exist():
    assert (ROOT / "bin" / "lab-render").read_text().startswith("#!/usr/bin/env python3")
    assert "<svg" in (ROOT / "assets" / "icon.svg").read_text()


def test_licences_ship():
    assert "Attribution 4.0 International" in (ROOT / "LICENSE").read_text()
    mit = (ROOT / "vendor" / "greatretrofit_v2" / "LICENSE").read_text()
    assert mit.startswith("MIT License") and "Copyright (c)" in mit


def test_intake_docs_match_the_question_bank():
    assert (ROOT / "docs" / "intake-questions.md").read_text(encoding="utf-8").strip() == render_docs().strip()


def test_documents_the_model_interface():
    assert (ROOT / "docs" / "model-interface.md").exists() and (ROOT / "docs" / "known-issues.md").exists()
