#!/usr/bin/env python3
"""Phase 0 preflight: everything the pipeline needs, checked before any run starts.

    python3 tools/check-env.py              # check everything
    python3 tools/check-env.py --quick      # only the hard requirements (no NetLogo/browser)

Prints PASS/FAIL per check with the exact remedy. Exit 0 = ready, 1 = something is missing.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NETLOGO_HOME = Path(os.environ.get("NETLOGO_HOME", Path(__file__).resolve().parents[1] / "tools" / "NetLogo"))
CHROMIUM = os.environ.get("CHROMIUM_PATH") or next((p for p in ("/opt/brave.com/brave/brave", shutil.which("brave-browser"), shutil.which("chromium"), shutil.which("google-chrome")) if p and Path(p).exists()), None)
QUICK = "--quick" in sys.argv

fails = []


def check(name, ok, remedy=None):
    print(("PASS" if ok else "FAIL"), "-", name)
    if not ok:
        fails.append(name)
        if remedy:
            print("     remedy:", remedy)


def cmd_out(cmd):
    try:
        return subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL, timeout=30).strip()
    except Exception:
        return ""


# Python
v = sys.version_info
check(f"python >= 3.10 (found {v.major}.{v.minor}.{v.micro})", v >= (3, 10), "install python 3.10+ (apt install python3)")
for pkg, import_name in (("numpy", "numpy"), ("pillow", "PIL"), ("pytest", "pytest"), ("jsonschema", "jsonschema")):
    try:
        __import__(import_name)
        check(f"python package: {pkg}", True)
    except ImportError:
        check(f"python package: {pkg}", False, f".venv/bin/pip install -r requirements.txt")

# git
check("git", bool(cmd_out(["git", "--version"])), "install git")

# Node
node = shutil.which("node")
node_version = cmd_out([node, "--version"]) if node else ""
check(f"node >= 20 (found {node_version or 'none'})", bool(node) and int(node_version.lstrip("v").split(".")[0] or 0) >= 20,
      "install Node 20+ (nvm install 20, or apt install nodejs)")
if cmd_out(["npm", "--version"]):
    check(f"npm (found {cmd_out(['npm', '--version'])})", True)

if not QUICK:
    # NetLogo (only needed for parity fixtures and the acceptance run, not for building pages)
    nl = NETLOGO_HOME / "netlogo-headless.sh"
    check(f"NetLogo 7.0.4 at {NETLOGO_HOME}", NETLOGO_HOME.exists() and nl.exists(),
          "install NetLogo 7.0.4, or set NETLOGO_HOME=/path/to/NetLogo\\ 7.0.4 (fixtures and the 10-seed parity run need it; page builds do not)")

    # A Chromium-family browser with GPU flags for the FPS check (SwiftShader is not a pass signal)
    check(f"chromium/brave for the frame-rate gate ({CHROMIUM or 'none found'})", CHROMIUM is not None,
          "install Brave or Chromium, or set CHROMIUM_PATH=/path/to/brave")

# The project layout
for d in (
    "reference/building-archetypes.md",
    "reference/templates/world.md",
    "reference/render/palettes.json",
    "reference/render/families.md",
    "reference/render/family-packs.json",
    "tools/ingest",
    "tools/agents",
    "tools/construct",
    "tools/stage",
    "tools/check-world.py",
    "tools/check-schemas.py",
    "tools/snapshot-world.py",
    "schemas/scene.json",
    "schemas/model-binding.json",
    "worlds",
):
    check(f"project file: {d}", (ROOT / d).exists(), "run from the repository root")

print()
if fails:
    print(f"{len(fails)} check(s) failed. Fix them before starting the pipeline.")
    sys.exit(1)
print("Environment is ready.")
sys.exit(0)
