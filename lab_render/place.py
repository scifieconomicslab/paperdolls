"""The place pipeline for a place_scene project: get an extract, ingest it, write scene.json and its report.

One call replaces five separate commands, so a model following the skill has one thing to run and one thing to read back.
"""
import json
import shutil
from pathlib import Path

import yaml

from .ingest import build, report
from .ingest.fetch import FetchError, fetch_overpass
from .ingest.query import overpass_query
from .intake import get_path


class PlaceError(RuntimeError):
    """Something the user has to act on. The message says what."""


def output_dir(spec_path, data):
    base = Path(spec_path).resolve().parent
    out = base / get_path(data, "output.dir", "lab-render-out")
    out.mkdir(parents=True, exist_ok=True)
    return out


def _resolve(spec_path, p):
    q = Path(p)
    return q if q.is_absolute() else Path(spec_path).resolve().parent / q


def run(spec_path, refetch=False, fetch=True):
    """Returns a summary dict. Raises PlaceError when the user has to do something (run a query by hand, fix a path)."""
    data = yaml.safe_load(Path(spec_path).read_text(encoding="utf-8"))
    place, out = data["place"], output_dir(spec_path, data)
    kind = place["kind"]
    scene_path = out / "scene.json"
    summary = {"kind": kind, "folder": str(out), "scene": None}
    if kind == "placeholder":
        return {**summary, "note": "The viewer opens on the synthetic placeholder scene. Nothing was ingested."}
    if kind == "scene_file":
        src = _resolve(spec_path, place["scene_path"])
        try:
            scene = json.loads(src.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise PlaceError(f"could not read the scene file {src}: {e}")
        if not all(isinstance(scene.get(k), list) for k in ("roads", "buildings", "landuse", "trees")):
            raise PlaceError(f"{src} is not a scene file: it needs roads, buildings, landuse and trees lists.")
        if src.resolve() != scene_path.resolve():
            shutil.copyfile(src, scene_path)
        return {**summary, "scene": str(scene_path), "buildings": len(scene["buildings"]), "note": "Used as given. The viewer checks it again when it loads."}

    relation, bbox = (place.get("relation") if kind == "osm_relation" else None), (tuple(place["bbox"]) if kind == "bbox" else None)
    if kind in ("osm_relation", "bbox"):
        extract = out / "extract.json"
        if refetch or not extract.exists():
            query_file = out / "query.ql"
            q = overpass_query(relation=relation, bbox=bbox)
            query_file.write_text(q, encoding="utf-8")
            if not fetch:
                raise PlaceError(f"no extract at {extract}. The query is saved in {query_file}.")
            try:
                fetch_overpass(q, extract)
            except FetchError as e:
                raise PlaceError(f"{e}\n\nThe query is saved in {query_file}. Ask the user to run it at overpass-turbo.eu "
                                 f"(Export, raw OSM data, JSON), save the file as {extract}, and run this command again.")
    else:
        extract = _resolve(spec_path, place["extract_path"])
    try:
        scene, rep = build.ingest(extract, boundary_relation=relation, bbox=bbox, name=data["name"], max_buildings=place.get("max_buildings"))
    except (build.IngestError, ValueError) as e:
        raise PlaceError(f"the ingest failed: {e}")
    scene_path.write_text(json.dumps(scene, separators=(",", ":")), encoding="utf-8")
    (out / "scene_report.md").write_text(report.report_markdown(scene, rep), encoding="utf-8")
    (out / "scene_report.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
    c = rep["counts"]
    return {**summary, "scene": str(scene_path), "report": str(out / "scene_report.md"), "buildings": c["buildings"], "roads": c["roads"], "trees": c["trees"],
            "rotation_deg": rep["frame"]["rotation_deg"], "asset_share_estimate": rep["estimated_asset_share"]["rotated"],
            "asset_share_unrotated": rep["estimated_asset_share"]["unrotated"], "warnings": rep["warnings"]}
