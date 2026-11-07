"""The place pipeline for a place_scene project: get an extract, ingest it, write scene.json and its report.

One call replaces five separate commands, so a model following the skill has one thing to run and one thing to read back.
"""
import hashlib
import json
from pathlib import Path

from .ingest import build, report
from .ingest.fetch import FetchError, fetch_overpass
from .fsutil import YamlFileError, read_yaml_mapping, write_atomic, write_atomic_group
from .ingest.query import QUERY_VERSION, overpass_query
from .intake import get_path


class PlaceError(RuntimeError):
    """Something the user has to act on. The message says what."""


def output_dir(spec_path, data):
    base = Path(spec_path).resolve().parent
    out = base / get_path(data, "output.dir", "paperdolls-out")
    out.mkdir(parents=True, exist_ok=True)
    return out


def _resolve(spec_path, p):
    q = Path(p)
    return q if q.is_absolute() else Path(spec_path).resolve().parent / q


EXTRACT_KEY_FILE = "extract.meta.json"


def extract_key(relation, bbox):
    """What an extract was fetched for: the area and the query text (a hash of it, so a change to the query itself also counts)."""
    q = overpass_query(relation=relation, bbox=bbox)
    return {"relation": relation, "bbox": list(bbox) if bbox else None, "query_version": QUERY_VERSION, "query_sha256": hashlib.sha256(q.encode("utf-8")).hexdigest()}


def _extract_state(out, key, query_text):
    """Is out/extract.json usable for `key`? Returns (ok, why). A file with no record of its area is accepted only when query.ql (written when the
    fetch was needed) is exactly this query: that is the hand-exported-from-overpass-turbo route the error message describes."""
    extract, meta = out / "extract.json", out / EXTRACT_KEY_FILE
    if not extract.exists():
        return False, "there is no extract yet"
    try:
        doc = json.loads(extract.read_text(encoding="utf-8"))
        if not isinstance(doc, dict) or not isinstance(doc.get("elements"), list):
            raise ValueError("not an Overpass result (no 'elements' list)")
    except (OSError, ValueError) as e:
        return False, f"{extract.name} cannot be read ({e})"
    try:
        have = json.loads(meta.read_text(encoding="utf-8"))
    except FileNotFoundError:
        ql = out / "query.ql"
        if ql.exists() and ql.read_text(encoding="utf-8") == query_text:
            write_atomic(meta, json.dumps(key, indent=1))
            return True, "adopted"
        return False, f"{extract.name} has no record of the area it was fetched for"
    except (OSError, ValueError):
        return False, f"{meta.name} cannot be read"
    if have != key:
        return False, f"{extract.name} was fetched for {_describe_key(have)}, not for {_describe_key(key)}"
    return True, "current"


def _describe_key(k):
    if not isinstance(k, dict):
        return "something else"
    parts = ([f"relation {k['relation']}"] if k.get("relation") else []) + ([f"bbox {k['bbox']}"] if k.get("bbox") else [])
    return " and ".join(parts) or "an unknown query"


def run(spec_path, refetch=False, fetch=True, endpoint=None):
    """Returns a summary dict. Raises PlaceError when the user has to do something (run a query by hand, fix a path)."""
    try:
        data = read_yaml_mapping(spec_path)
        place, out = data["place"], output_dir(spec_path, data)
        kind = place["kind"]
    except (YamlFileError, KeyError, TypeError, OSError) as e:
        raise PlaceError(f"cannot read the project file: {e}")
    scene_path = out / "scene.json"
    summary = {"kind": kind, "folder": str(out), "scene": None}
    warnings = []
    if kind == "placeholder":
        return {**summary, "note": "The viewer opens on the synthetic placeholder scene. Nothing was ingested."}
    try:
        return _run(spec_path, data, place, kind, out, scene_path, summary, warnings, refetch, fetch, endpoint)
    except (KeyError, IndexError, TypeError) as e:        # a hand-written place block that validation did not catch
        raise PlaceError(f"the place block of {spec_path} is not usable ({type(e).__name__}: {e})")


def _run(spec_path, data, place, kind, out, scene_path, summary, warnings, refetch, fetch, endpoint=None):
    if kind == "scene_file":
        src = _resolve(spec_path, place["scene_path"])
        try:
            scene = json.loads(src.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise PlaceError(f"could not read the scene file {src}: {e}")
        if not isinstance(scene, dict) or not all(isinstance(scene.get(k), list) for k in ("roads", "buildings", "landuse", "trees")):
            raise PlaceError(f"{src} is not a scene file: it needs roads, buildings, landuse and trees lists.")
        if src.resolve() != scene_path.resolve():
            write_atomic(scene_path, src.read_bytes())
        return {**summary, "scene": str(scene_path), "buildings": len(scene["buildings"]), "note": "Used as given. The viewer checks it again when it loads."}

    relation, bbox = (place.get("relation") if kind == "osm_relation" else None), (tuple(place["bbox"]) if kind == "bbox" else None)
    if kind in ("osm_relation", "bbox"):
        extract = out / "extract.json"
        q = overpass_query(relation=relation, bbox=bbox)
        key = extract_key(relation, bbox)
        ok, why = _extract_state(out, key, q)
        if refetch or not ok:
            query_file = out / "query.ql"
            write_atomic(query_file, q)
            if not fetch:
                raise PlaceError(f"no usable extract at {extract} ({why}). The query is saved in {query_file}. Run 'paperdolls place --refetch' (without --no-fetch) to fetch it, "
                                 f"or run the query yourself and save the result as {extract}.")
            if ok is False and extract.exists() and not refetch:
                warnings.append(f"fetched a new extract: {why}")
            try:
                fetch_overpass(q, extract, **({"endpoint": endpoint} if endpoint else {}))
            except FetchError as e:
                raise PlaceError(f"{e}\n\nThe query is saved in {query_file}. Ask the user to run it at overpass-turbo.eu "
                                 f"(Export, raw OSM data, JSON), save the file as {extract}, and run this command again.")
            write_atomic(out / EXTRACT_KEY_FILE, json.dumps(key, indent=1))
    else:
        extract = _resolve(spec_path, place["extract_path"])
    try:
        scene, rep = build.ingest(extract, boundary_relation=relation, bbox=bbox, name=data["name"], max_buildings=place.get("max_buildings"))
    except (build.IngestError, ValueError) as e:
        hint = f" If {extract.name} is stale or damaged, run 'paperdolls place --refetch' to fetch it again (or delete it)." if kind in ("osm_relation", "bbox") else ""
        raise PlaceError(f"the ingest failed: {e}.{hint}")
    rep["warnings"] = warnings + rep["warnings"]
    write_atomic_group([(out / "scene_report.md", report.report_markdown(scene, rep)), (out / "scene_report.json", json.dumps(rep, indent=1, allow_nan=False)),
                        (scene_path, json.dumps(scene, separators=(",", ":"), allow_nan=False))])
    c = rep["counts"]
    return {**summary, "scene": str(scene_path), "report": str(out / "scene_report.md"), "buildings": c["buildings"], "roads": c["roads"], "trees": c["trees"],
            "rotation_deg": rep["frame"]["rotation_deg"], "asset_share_estimate": rep["estimated_asset_share"]["rotated"],
            "asset_share_unrotated": rep["estimated_asset_share"]["unrotated"], "warnings": rep["warnings"]}
