"""Load the vendored Great Retrofit model. The vendored file is the only model code the plugin runs."""
import hashlib
import importlib.util
from pathlib import Path

VENDOR = Path(__file__).resolve().parents[1] / "vendor" / "greatretrofit_v2" / "model.py"

def load(path=None):
    p = Path(path) if path else VENDOR
    spec = importlib.util.spec_from_file_location("greatretrofit_v2_model", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def file_sha256(path=None):
    p = Path(path) if path else VENDOR
    return hashlib.sha256(p.read_bytes()).hexdigest()
