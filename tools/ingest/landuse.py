"""Land-use raster enrichment (spec ingest 3a, 2026-11-09 revision).

When the OSM tags cannot say what a building is — the cascade lands on the seeded procedural
fallback — a land-use raster can: sample the class at the building's centroid and map it to an
economic class from /reference/building-archetypes.md. Sources, in the spec's order:

- a local GeoTIFF: the Schultz et al. 2025 (Scientific Data) EU+UK 10 m per-country land-use
  files on HeiData (DOI 10.11588/data/IUTCDN), or any land-use raster reprojected to EPSG:4326
  (``gdalwarp -t_srs EPSG:4326 in.tif out.tif``),
- an Esri ASCII grid of the same class codes,
- designed but not built here: the osmlanduse.org CORINE WebGIS and the WMS layer
  ``osmlanduse:osm_lulc``. A WMS pull needs a server round-trip the offline toolchain does not
  make; download the area once and pass the file.

The default mapping below is CORINE's 44-class nomenclature (the codes the HeiData files and
osmlanduse use). It is deliberately conservative: widely-agreed classes get a default, everything
ambiguous is "unmapped" and stays a counted fallback guess until the user maps it. The mapping is
a JSON file the user edits: ``python -m ingest landuse-classes --raster FILE --emit-mapping``
prints the classes the raster actually carries and writes the template, which is the spec's
"show the classes available, ask the user what each should map to" step as a command.
"""
import json
from collections import Counter

from . import classify
from .elevation import ElevationError, read_landuse_raster   # noqa: F401  (re-exported for build.py)
from pathlib import Path


class LanduseError(ValueError):
    pass


# CORINE class code -> economic class (the /reference/building-archetypes.md vocabulary).
# Codes that say nothing about a building's use are "unmapped": the user decides, or the
# building keeps its seeded fallback class. Keys are strings of the integer codes.
DEFAULT_CODE_CLASS = {
    "111": "residential",        # continuous urban fabric
    "112": "residential",        # discontinuous urban fabric
    "121": "mixed_use",          # industrial or commercial units — the code does not say which
    "122": "other",              # road and rail networks (a building on one is not a use)
    "123": "industrial",         # port areas
    "124": "other",              # airports
    "131": "industrial",         # mineral extraction sites
    "132": "other",              # dump sites
    "133": "construction",       # construction sites
    "141": "unmapped",           # green urban areas — buildings in them are rare and specific
    "142": "civic",              # sport and leisure facilities
    "211": "farm", "221": "farm", "222": "farm", "223": "farm", "231": "farm",
    "241": "farm", "242": "farm", "243": "farm", "244": "farm",
    "311": "outbuilding", "312": "outbuilding", "313": "outbuilding",   # forests: a building there is small
    "321": "outbuilding", "322": "outbuilding", "323": "outbuilding", "324": "outbuilding",
    "331": "unmapped", "332": "unmapped", "333": "unmapped", "334": "unmapped",
    "335": "unmapped", "336": "unmapped",                               # bare/sparsely vegetated
    "411": "unmapped", "412": "unmapped", "421": "unmapped", "422": "unmapped",   # wetlands
    "511": "unmapped", "512": "unmapped", "523": "unmapped",            # water
}


def histogram(src):
    """The classes the raster actually carries: [(code_string, cells)] largest first. The 'show the classes
    available' step of the spec."""
    values = src.z[src.z == src.z]                      # finite only (NoData is NaN)
    counts = Counter(int(v) for v in values)
    return sorted(((str(k), n) for k, n in counts.items()), key=lambda kv: -kv[1])


def mapping_template(src):
    """The mapping template for this raster: every class it carries, with the default guess or 'unmapped'."""
    return {code: DEFAULT_CODE_CLASS.get(code, "unmapped") for code, _n in histogram(src)}


def load_mapping(path):
    """Read the user's mapping: {class code: economic class | "unmapped"}. Unknown classes are refused by
    name, so a typo cannot silently re-class a city."""
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise LanduseError(f"cannot read the land-use mapping {path}: {e}")
    if not isinstance(raw, dict) or not raw:
        raise LanduseError(f"{path}: the mapping must be a JSON object of {{class code: economic class or \"unmapped\"}}")
    known = set(classify.ECONOMIC_CLASSES) | {"unmapped"}
    for k, v in raw.items():
        if str(v) not in known:
            raise LanduseError(f"{path}: code {k!r} maps to {v!r}, which is not an economic class "
                               f"(one of {', '.join(sorted(classify.ECONOMIC_CLASSES))}) or \"unmapped\"")
    return {str(k).strip(): str(v).strip() for k, v in raw.items()}


def enrich(buildings, frame, src, mapping, assume):
    """Re-class the fallback buildings from the raster, in place. Only buildings the tag cascade could not
    classify are touched. Returns the report dict; everything it decided is counted via `assume`."""
    mapped, unmapped, uncovered = {}, {}, 0
    for b in buildings:
        if b.get("economic_class_source") != "fallback":
            continue
        lat, lon = frame.latlon(b["centroid"][0], b["centroid"][1])
        code = src.sample_nearest(lat, lon)
        if code is None:
            uncovered += 1
            continue
        key = str(int(code))
        cls = mapping.get(key, "unmapped")
        if cls == "unmapped":
            unmapped[key] = unmapped.get(key, 0) + 1
            continue
        b["economic_class"] = cls
        b["economic_class_source"] = "landuse-raster"
        mapped[key] = mapped.get(key, 0) + 1
        assume.add("economic class", f"land-use raster: class code {key} mapped to {cls} at the building's centroid", 1)
    if mapped:
        assume.add("economic class", f"land-use raster enrichment re-classed {sum(mapped.values())} fallback building(s) from a classified land-use raster", sum(mapped.values()))
    return {"source": getattr(src, "desc", ""), "sampled": sum(mapped.values()) + sum(unmapped.values()),
            "mapped": dict(sorted(mapped.items())), "unmapped": dict(sorted(unmapped.items())), "uncovered": uncovered}


def enrichment_warnings(rep):
    """The warnings the enrichment report earns: say plainly what stayed a guess."""
    out, e = [], rep.get("landuse_enrichment")
    if not e:
        return out
    unmapped_n, mapped_n = sum(e["unmapped"].values()), sum(e["mapped"].values())
    if unmapped_n:
        codes = ", ".join(f"{k} ({v})" for k, v in sorted(e["unmapped"].items(), key=lambda kv: -kv[1])[:5])
        out.append(f"{unmapped_n} building(s) fell on land-use classes the mapping does not cover ({codes}): they keep their seeded "
                   "fallback class. Map the codes (python -m ingest landuse-classes --raster ... --emit-mapping, edit, pass "
                   "--landuse-mapping) and re-run.")
    if mapped_n and e["sampled"]:
        out.append(f"{mapped_n} of the fallback buildings were re-classed from the land-use raster ({e['source']}); the report counts every "
                   "class code used. Confirm the economic class assumptions before binding a model to them.")
    return out
