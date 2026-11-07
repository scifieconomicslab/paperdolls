"""Small file helpers shared by the commands: atomic writes, an advisory lock, a strict YAML mapping reader. Standard library only (yaml is imported on use).

Why: every output used to be one `Path.write_text` onto the target. A reader (a browser reload, a second command) could see a prefix, a kill
mid-write left a truncated file that was then trusted, and a failure on the second of three files left a new scene beside an old report.
"""
import contextlib
import os
import tempfile
from pathlib import Path


def _stage(path, data, encoding="utf-8"):
    """Write data to a hidden temp file in the target's folder and fsync it. Returns the temp path."""
    path = Path(path)
    raw = data if isinstance(data, (bytes, bytearray)) else data.encode(encoding)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        try:                                              # mkstemp makes 0600; give the file what a plain write would
            mode = path.stat().st_mode & 0o777 if path.exists() else 0o666 & ~_umask()
            os.chmod(tmp, mode)
        except OSError:
            pass
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    return tmp


def _umask():
    m = os.umask(0)
    os.umask(m)
    return m


def _sync_dir(folder):
    with contextlib.suppress(OSError, AttributeError):
        fd = os.open(str(folder), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def write_atomic(path, data, encoding="utf-8"):
    """Replace `path` with `data` (str or bytes) so a reader sees the old file or the new one, never a prefix. Returns the path."""
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
    """Write several files as one unit. `items` is a list of (path, data); files are replaced in the order given, so list the dependants (reports)
    first and the file a reader opens first (the scene) last: a reader that finds the new scene finds the new reports too.

    Everything is staged and every target checked before the first replace, so a bad target (a directory, an unwritable folder, a full disk)
    changes nothing."""
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


@contextlib.contextmanager
def file_lock(path):
    """An advisory exclusive lock on `.<name>.lock` beside `path`, held while the block runs; other processes block until it is free. The lock file is left in place
    (removing it would let two processes lock two different files)."""
    path = Path(path)
    lock = path.with_name(f".{path.name}.lock")
    with open(lock, "a+b") as fh:
        try:
            import fcntl
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
            release = lambda: fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        except ImportError:                               # Windows
            import msvcrt
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)
            release = lambda: (fh.seek(0), msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1))
        try:
            yield
        finally:
            release()


class YamlFileError(ValueError):
    """A project file that cannot be read as a mapping. The message names the file."""


def read_yaml_mapping(path, allow_missing=False):
    """Parse `path` as a YAML mapping. An unreadable, unparsable, empty or non-mapping file is a YamlFileError naming the file: a half-written
    file must never read as 'no answers yet'."""
    import yaml
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        if allow_missing:
            return {}
        raise YamlFileError(f"{path} does not exist")
    except (OSError, UnicodeDecodeError) as e:
        raise YamlFileError(f"cannot read {path}: {e}")
    if not text.strip():
        raise YamlFileError(f"{path} is empty (a write may have been cut short). Restore it from a backup, or start again with 'paperdolls intake init {path} --force'")
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        first = str(e).strip().splitlines()[0] if str(e).strip() else type(e).__name__
        raise YamlFileError(f"{path} is not valid YAML ({first}). Fix it by hand or restore it from a backup")
    if not isinstance(data, dict):
        raise YamlFileError(f"{path} must hold a mapping (key: value lines), not a {type(data).__name__}")
    return data
