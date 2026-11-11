"""Command line for the OSM ingest: python -m ingest <command> ...

    python -m ingest osm-query --relation 58258 [--out query.ql]
    python -m ingest osm-fetch --relation 58258 --out map-data/extract.json [--endpoint URL]
    python -m ingest ingest path/to/extract.json --out scene.json [--name NAME] [--bbox S,W,N,E]
                                                [--boundary-relation ID] [--max-buildings N] [--no-scatter]
                                                [--seed 7] [--rotation auto|none|deg] [--elevation FILE] [--terrain-cell 25.0]
                                                [--landuse-raster FILE] [--landuse-mapping FILE]
    python -m ingest landuse-classes --raster FILE [--emit-mapping OUT.json]   # what the raster carries; writes the mapping template

Exits 0 on success, 2 on a handled failure (message on stderr). Runs no
network access except osm-fetch. Everything else operates on local files.
"""
import argparse
import json
import sys
from pathlib import Path

from . import __version__, build, report as rpt
from ._io import write_atomic, write_atomic_group


def _bbox(text):
    return tuple(float(x) for x in text.split(","))


def cmd_osm_query(a):
    from .query import overpass_query
    bbox = _bbox(a.bbox) if a.bbox else None
    q = overpass_query(relation=a.relation, bbox=bbox)
    if a.out:
        write_atomic(a.out, q)
        print(f"wrote {a.out}. Run it at https://overpass-turbo.eu (Export, raw OSM data, JSON) or: curl -d @{a.out} https://overpass-api.de/api/interpreter -o extract.json")
    else:
        print(q)
    return 0


def cmd_osm_fetch(a):
    from .fetch import DEFAULT_ENDPOINT, FetchError, fetch_overpass
    from .query import overpass_query
    bbox = _bbox(a.bbox) if a.bbox else None
    try:
        n = fetch_overpass(overpass_query(relation=a.relation, bbox=bbox), a.out, endpoint=a.endpoint or DEFAULT_ENDPOINT)
    except (FetchError, ValueError) as e:
        raise SystemExit(f"fetch failed: {e}")
    print(f"wrote {a.out} ({n} elements). Next: python -m ingest ingest {a.out}" + (f" --boundary-relation {a.relation}" if a.relation else ""))
    return 0


def cmd_ingest(a):
    try:
        bbox = build.check_bbox(_bbox(a.bbox)) if a.bbox else None
    except (ValueError, build.IngestError) as e:
        raise SystemExit(f"--bbox needs south,west,north,east as numbers ({e})")
    rot = a.rotation if a.rotation in ("auto", "none") else float(a.rotation)
    try:
        scene, rep = build.ingest(a.input, rotation=rot, bbox=bbox, boundary_relation=a.boundary_relation, name=a.name,
                                  max_buildings=a.max_buildings, scatter=not a.no_scatter, seed=a.seed,
                                  elevation_file=a.elevation, terrain_cell=a.terrain_cell,
                                  landuse_raster_file=a.landuse_raster, landuse_mapping_file=a.landuse_mapping,
                                  family=a.family, palette=a.palette)
    except (build.IngestError, ValueError) as e:
        raise SystemExit(f"ingest failed: {e}")
    out = Path(a.out)
    md = out.with_name(out.stem + "_report.md")
    # reports first, the scene last: whoever finds the new scene finds the reports that describe it; nothing is replaced unless every file could be staged
    write_atomic_group([(md, rpt.report_markdown(scene, rep)), (out.with_name(out.stem + "_report.json"), json.dumps(rep, indent=1, allow_nan=False)),
                        (out, json.dumps(scene, separators=(",", ":"), allow_nan=False))])
    c = rep["counts"]
    print(f"wrote {out} ({out.stat().st_size // 1024} KB): {c['buildings']} buildings, {c.get('structures', c['buildings'])} structures, {c['roads']} roads, {c['landuse']} landuse, {c['trees']} trees")
    print(f"frame rotated {rep['frame']['rotation_deg']} degrees; estimated asset share {round(rep['estimated_asset_share']['rotated'] * 100)}% (unrotated {round(rep['estimated_asset_share']['unrotated'] * 100)}%)")
    print(f"report: {md}")
    fb = rep.get("economic_class_fallback_share", 0)
    print(f"economic classes: {sum(rep.get('economic_classes', {}).values())} classed; {round(fb * 100)}% by fallback (seeded guess)")
    le = rep.get("landuse_enrichment")
    if le:
        print(f"land-use enrichment: {le['sampled']} fallback building(s) sampled against {le['file']}; "
              f"{sum(le['mapped'].values())} re-classed, {sum(le['unmapped'].values())} kept as fallback (codes unmapped), {le['uncovered']} outside the raster")
    for w in rep["warnings"]:
        print("WARNING:", w)
    return 0


def cmd_landuse_classes(a):
    from .elevation import ElevationError
    from . import landuse
    try:
        src = landuse.read_landuse_raster(a.raster)
        found = landuse.histogram(src)
    except (ElevationError, landuse.LanduseError) as e:
        raise SystemExit(f"land-use raster: {e}")
    if not found:
        raise SystemExit("the raster carries no class codes (every cell is NoData?)")
    default = landuse.DEFAULT_CODE_CLASS
    print(f"classes in {a.raster} ({src.desc}):")
    for code, n in found:
        guess = default.get(code, "unmapped")
        print(f"  {code:>6}  {n:>9} cells  -> {guess}")
    print("Defaults are the built-in CORINE guesses; 'unmapped' keeps the building on the seeded fallback until you decide.")
    if a.emit_mapping:
        template = landuse.mapping_template(src)
        write_atomic(a.emit_mapping, json.dumps(template, indent=2) + "\n")
        print(f"wrote the mapping template {a.emit_mapping} — edit it, then pass it to `ingest --landuse-mapping {a.emit_mapping}`")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m ingest")
    ap.add_argument("--version", action="version", version=f"ingest {__version__}")
    sub = ap.add_subparsers(required=True)
    s = sub.add_parser("osm-query", help="print or save the Overpass query")
    s.add_argument("--relation", type=int); s.add_argument("--bbox", help="south,west,north,east"); s.add_argument("--out"); s.set_defaults(f=cmd_osm_query)
    s = sub.add_parser("osm-fetch", help="run the query and save the raw extract")
    s.add_argument("--relation", type=int); s.add_argument("--bbox", help="south,west,north,east"); s.add_argument("--out", required=True); s.add_argument("--endpoint")
    s.set_defaults(f=cmd_osm_fetch)
    s = sub.add_parser("ingest", help="OSM extract (Overpass JSON, OSM XML, GeoJSON) to a scene file and a report")
    s.add_argument("input"); s.add_argument("--out", default="scene.json"); s.add_argument("--rotation", default="auto", help="auto, none, or degrees")
    s.add_argument("--bbox", help="south,west,north,east"); s.add_argument("--boundary-relation", type=int, help="clip to this boundary relation (needs rel(ID) in the extract)")
    s.add_argument("--name"); s.add_argument("--max-buildings", type=int); s.add_argument("--no-scatter", action="store_true", help="do not scatter trees into parks and woods")
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("--family", default="real", choices=("real", "historical", "fantasy", "scifi"), help="the world family (default real)")
    s.add_argument("--palette", default="nw", help="the palette family id from reference/render/palettes.json (default nw)")
    s.add_argument("--elevation", metavar="FILE", help="a local elevation file (GeoTIFF in lon/lat, Esri ASCII grid, or lon,lat,z text points): adds a ground grid and z to buildings, roads and trees")
    s.add_argument("--terrain-cell", type=float, default=25.0, help="ground grid cell in metres (default 25)")
    s.add_argument("--landuse-raster", metavar="FILE", help="a classified land-use raster (GeoTIFF or Esri ASCII grid of class codes): re-classes the buildings the tag cascade could not classify")
    s.add_argument("--landuse-mapping", metavar="FILE", help="the class-code -> economic-class mapping (a landuse-classes --emit-mapping template, edited); without it the built-in CORINE defaults apply")
    s.set_defaults(f=cmd_ingest)
    s = sub.add_parser("landuse-classes", help="print the classes a land-use raster carries, and optionally write the mapping template")
    s.add_argument("--raster", required=True, metavar="FILE", help="a classified land-use raster (GeoTIFF or Esri ASCII grid)")
    s.add_argument("--emit-mapping", metavar="OUT.json", help="write the mapping template: every class -> default guess or unmapped, for the user to edit")
    s.set_defaults(f=cmd_landuse_classes)
    args = ap.parse_args(argv)
    return args.f(args)


if __name__ == "__main__":
    sys.exit(main())
