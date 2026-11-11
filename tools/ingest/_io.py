"""Inlined and simplified from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0), paperdolls/fsutil.py.
"""
"""Atomic file writes for the ingest outputs. Standard library only.

Every reader of these files must see the old file or the new one, never a
prefix. The group write exists so a scene never appears without its report:
the reports are written first, the scene last.
"""
import contextlib
import os
from pathlib import Path
from datetime import datetime, timezone


def _stage(path, data, encoding="utf-8"):
    if isinstance(data, bytes):
        blob = data
    else:
        blob = data.encode(encoding)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with open(tmp, "wb") as fh:
        fh.write(blob)
    return tmp


def _sync_dir(folder):
    with contextlib.suppress(OSError, AttributeError):
        fd = os.open(str(folder), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def write_atomic(path, data, encoding="utf-8"):
    """Replace `path` with `data` (str or bytes) atomically. Returns the path."""
    path = Path(path)
    tmp = _stage(path, data, encoding)
    try:
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    _sync_dir(path.parent)
    return path


def write_atomic_group(items, encoding="utf-8"):
    """Write several files as one unit; reports first, the scene last.

    Everything is staged and every target checked before the first replace,
    so a bad target changes nothing.
    """
    items = [(Path(p), d) for p, d in items]
    staged = []
    try:
        for p, d in items:
            if p.is_dir():
                raise IsADirectoryError(21, "is a directory, not a file", str(p))
            staged.append(_stage(p, d, encoding))
        for (p, _), tmp in zip(items, staged):
            os.replace(tmp, p)
        staged = []
    finally:
        for tmp in staged:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
    for folder in {p.parent for p, _ in items}:
        _sync_dir(folder)
    return [p for p, _ in items]


def utcnow_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
