import sys
from pathlib import Path

# Make the `ingest` package importable (tools/ is the package parent).
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
