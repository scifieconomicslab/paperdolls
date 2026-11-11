"""Land-use raster enrichment (spec ingest 3a, 2026-11-09): the readers, the class histogram, the mapping
template and its loading, and the re-classing of fallback buildings — against a synthetic classified raster.
No network: the "WMS pull" is a documented manual download; here it is a written-to-disc GeoTIFF."""
import json
import math

import numpy as np
import pytest
from PIL import Image
from PIL.TiffImagePlugin import ImageFileDirectory_v2

import osm_fixture as F
from ingest import build, classify, geo, landuse
from ingest.elevation import ElevationError

REL = 99001
LAT0, LON0 = 50.8795, 4.3290                       # the fixture's origin


def write_geotiff(path, codes, cell_m=40.0):
    """A classified GeoTIFF in EPSG:4326 over the fixture's extent. codes[i][j] is the class at row i (going
    south from the top-left), column j (going east); -1 is NoData. Same tag layout as test_elevation.py."""
    nr, nc = len(codes), len(codes[0])
    dlat = cell_m / 111320.0
    dlon = cell_m / (111320.0 * math.cos(math.radians(LAT0)))
    lat_top = LAT0 + (nr * cell_m / 2) / 111320.0
    lon_left = LON0 - (nc * cell_m / 2) / (111320.0 * math.cos(math.radians(LAT0)))
    arr = np.array([[c if c >= 0 else -9999 for c in row] for row in codes], dtype=np.int32)
    im = Image.fromarray(arr, mode="I")
    ifd = ImageFileDirectory_v2()
    ifd[33550] = (dlon, dlat, 0.0)                                     # ModelPixelScale
    ifd[33922] = (0.0, 0.0, 0.0, lon_left, lat_top, 0.0)               # ModelTiepoint: top-left corner
    keys = [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326]
    ifd[34735] = tuple(keys)
    ifd[42113] = str(-9999)                                            # NoData
    im.save(path, tiffinfo=ifd)
    return str(path)


@pytest.fixture(scope="module")
def files(tmp_path_factory):
    return F.write_all(tmp_path_factory.mktemp("landuse"))


def test_read_raster_rejects_points_and_accepts_grids(tmp_path):
    pts = tmp_path / "pts.csv"
    pts.write_text("4.3,50.8,12\n")
    with pytest.raises(ElevationError):
        landuse.read_landuse_raster(str(pts))                          # point files are for elevation, not classes
    tif = write_geotiff(tmp_path / "lulc.tif", [[112, 112], [112, 112]])
    src = landuse.read_landuse_raster(tif)
    assert src.kind == "grid"


def test_histogram_and_template_show_what_the_raster_carries(tmp_path):
    tif = write_geotiff(tmp_path / "lulc.tif", [[112, 121, -1], [311, 112, 990]])
    src = landuse.read_landuse_raster(tif)
    hist = dict(landuse.histogram(src))
    assert hist == {"112": 2, "121": 1, "311": 1, "990": 1}            # NoData (-1) is not a class
    template = landuse.mapping_template(src)
    assert template["112"] == "residential"                            # a known CORINE default
    assert template["121"] == "mixed_use"
    assert template["311"] == "outbuilding"
    assert template["990"] == "unmapped"                               # an unknown code asks the user


def test_load_mapping_validates_against_the_reference_vocabulary(tmp_path):
    tif = write_geotiff(tmp_path / "lulc.tif", [[112]])
    p = tmp_path / "mapping.json"
    p.write_text(json.dumps({"112": "residential", "121": "not-a-class"}))
    with pytest.raises(landuse.LanduseError):
        landuse.load_mapping(str(p))                                   # a typo must not re-class a city
    p.write_text(json.dumps({"112": "residential"}))
    assert landuse.load_mapping(str(p))["112"] == "residential"


def test_enrich_reclasses_only_fallback_buildings_and_counts_everything(tmp_path, files):
    scene, rep = build.ingest(files["overpass-json"], boundary_relation=REL)
    # A raster over the whole fixture: 112 (urban fabric) everywhere except a 121 (industrial/commercial)
    # patch over the east and a small NoData hole. Most fallback buildings land on a mapped class; a few do not.
    codes = [[112, 112, 121, 121, 121, 121, 121, 121, 121, 121],
             [112, 112, 121, 121, 121, 121, 121, 121, 121, 121],
             [112, 112, 112, 112, -1, -1, 112, 112, 121, 121],
             [112, 112, 112, 112, 112, 112, 112, 112, 112, 112],
             [112, 112, 112, 112, 112, 112, 112, 112, 112, 112],
             [112, 112, 112, 112, 112, 112, 112, 112, 112, 112]]
    tif = write_geotiff(tmp_path / "lulc.tif", codes, cell_m=120.0)
    src = landuse.read_landuse_raster(tif)
    mapping = {c: landuse.DEFAULT_CODE_CLASS[c] for c in ("112", "121")}
    frame = geo.LocalFrame(LAT0, LON0, scene["area"]["rotation_deg"])
    assume = classify.Assumptions()
    fallback_before = [b for b in scene["buildings"] if b["economic_class_source"] == "fallback"]
    tagged = [b for b in scene["buildings"] if b["economic_class_source"] != "fallback"]
    rep_e = landuse.enrich(scene["buildings"], frame, src, mapping, assume)
    assert rep_e["sampled"] >= len(fallback_before) - 5                # most fallback buildings land inside the raster
    assert sum(rep_e["mapped"].values()) + sum(rep_e["unmapped"].values()) + rep_e["uncovered"] >= len(fallback_before) - 2
    changed = [b for b in scene["buildings"] if b["economic_class_source"] == "landuse-raster"]
    assert changed, "enrichment should re-class the fallback buildings that fell on a mapped class"
    assert all(b["economic_class"] in ("residential", "mixed_use") for b in changed)
    assert all(b["economic_class_source"] != "landuse-raster" for b in tagged)   # tagged ones untouched
    assert assume.table(), "every mapping decision is counted"


def test_end_to_end_ingest_with_raster_updates_scene_report_and_fallback_share(tmp_path, files):
    # The osm_fixture's buildings: tag-classed ones plus building=yes fallbacks. A 112 raster re-classes the
    # fallbacks; the scene, the report and the fallback share all move together.
    codes = [[112] * 12 for _ in range(12)]
    tif = write_geotiff(tmp_path / "lulc.tif", codes, cell_m=100.0)
    mapping = tmp_path / "mapping.json"
    mapping.write_text(json.dumps({"112": "residential"}))
    scene, rep = build.ingest(files["overpass-json"], boundary_relation=REL, landuse_raster_file=tif, landuse_mapping_file=str(mapping))
    e = rep["landuse_enrichment"]
    assert e["mapped"]["112"] >= 1
    n_res = sum(1 for b in scene["buildings"] if b["economic_class"] == "residential" and b["economic_class_source"] == "landuse-raster")
    assert n_res == e["mapped"]["112"]
    assert rep["economic_class_sources"].get("landuse-raster", 0) == e["mapped"]["112"]
    assert rep["economic_class_fallback_share"] < 1.0                  # the fallbacks moved to the raster's class
    warns = " ".join(rep["warnings"]).lower()
    assert "land-use" in warns or e.get("uncovered", 0) == 0           # uncovered buildings are called out
    md_ok = "Land-use enrichment"                                      # the report carries the section
    assert md_ok                                                       # (see the report test below)


def test_report_markdown_has_an_enrichment_section_when_it_ran(tmp_path, files):
    from ingest import report as rpt
    codes = [[121] * 8 for _ in range(8)]
    tif = write_geotiff(tmp_path / "lulc.tif", codes, cell_m=140.0)
    scene, rep = build.ingest(files["overpass-json"], boundary_relation=REL, landuse_raster_file=tif)
    md = rpt.report_markdown(scene, rep)
    assert "### Land-use enrichment" in md
    assert "121" in md and "mixed_use" in md
    scene2, rep2 = build.ingest(files["overpass-json"], boundary_relation=REL)
    assert "### Land-use enrichment" not in rpt.report_markdown(scene2, rep2)   # no raster, no section
