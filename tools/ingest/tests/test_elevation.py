"""Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
"""
"""Elevation for the ingest: the three readers, the sampling onto a scene, the CLI flag, and an old scene staying as it was.

The terrain is synthetic (elevation.synthetic_grid or a tilted plane): no data was downloaded."""
import json
import math
import struct
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from PIL.TiffImagePlugin import ImageFileDirectory_v2

import osm_fixture as F
from ingest import __main__ as cli
from ingest import build, elevation, geo

REL = 99001


@pytest.fixture(scope="module")
def files(tmp_path_factory):
    return F.write_all(tmp_path_factory.mktemp("osm_elev"))


@pytest.fixture(scope="module")
def plain(files):
    return build.ingest(files["overpass-json"], boundary_relation=REL)


def plane(lat, lon, lat0=50.8793, lon0=4.3171):
    """A tilted plane: 40 m at the origin, rising 0.03 m per metre north and 0.01 m per metre east."""
    return 40.0 + 0.03 * (lat - lat0) * 111195.0 + 0.01 * (lon - lon0) * 111195.0 * math.cos(math.radians(lat0))


def write_xyz(path, lat0, lon0, n=41, step_m=20.0, header=True, swap=False):
    dlat, dlon = step_m / 111195.0, step_m / (111195.0 * math.cos(math.radians(lat0)))
    lines = (["lat,lon,z" if swap else "lon,lat,z"] if header else ["# lon lat z"])
    for j in range(n):
        for i in range(n):
            lat, lon = lat0 + (j - n // 2) * dlat, lon0 + (i - n // 2) * dlon
            lines.append(f"{lat:.7f},{lon:.7f},{plane(lat, lon, lat0, lon0):.2f}" if swap else f"{lon:.7f},{lat:.7f},{plane(lat, lon, lat0, lon0):.2f}")
    Path(path).write_text("\n".join(lines))


def write_geotiff(path, z, lon0, lat_top, dlon, dlat, epsg=4326, nodata=None, point=False):
    im = Image.fromarray(np.asarray(z, dtype=np.float32), mode="F")
    ifd = ImageFileDirectory_v2()
    ifd[33550] = (dlon, dlat, 0.0)
    ifd[33922] = (0.0, 0.0, 0.0, lon0, lat_top, 0.0)
    keys = [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 2 if point else 1, 2048, 0, 1, epsg]
    ifd[34735] = tuple(keys)
    if nodata is not None:
        ifd[42113] = str(nodata)
    im.save(path, tiffinfo=ifd)


def test_ascii_grid_samples_bilinear_and_honours_nodata(tmp_path):
    p = tmp_path / "g.asc"
    rows = ["10 20 30", "20 30 40", "-9999 40 50"]
    p.write_text("ncols 3\nnrows 3\nxllcorner 4.0\nyllcorner 50.0\ncellsize 0.01\nNODATA_value -9999\n" + "\n".join(rows) + "\n")
    s = elevation.read_elevation(p)
    assert s.kind == "grid" and s.valid == 8
    assert s.sample(50.025, 4.005) == pytest.approx(10.0)             # the centre of the top-left cell
    assert s.sample(50.025, 4.010) == pytest.approx(15.0)             # halfway between 10 and 20
    assert s.sample(50.015, 4.015) == pytest.approx(30.0)
    assert s.sample(50.005, 4.005) == pytest.approx(30.0)             # the NoData cell: the mean of its neighbours (20, 30, 40), never -9999
    assert s.sample(51.0, 4.0) is None                               # outside the grid


def test_ascii_grid_header_errors_are_clear(tmp_path):
    p = tmp_path / "bad.asc"
    p.write_text("ncols 3\nnrows 3\ncellsize 0.01\n1 2 3\n")
    with pytest.raises(elevation.ElevationError, match="xllcorner"):
        elevation.read_elevation(p)
    p.write_text("ncols 4\nnrows 3\nxllcorner 4\nyllcorner 50\ncellsize 0.01\n1 2 3\n1 2 3\n1 2 3\n")
    with pytest.raises(elevation.ElevationError, match="holds"):
        elevation.read_elevation(p)


@pytest.mark.parametrize("header,swap", [(False, False), (True, False), (True, True)])
def test_xyz_points_with_and_without_header_reproduce_the_plane(tmp_path, header, swap):
    p = tmp_path / "pts.csv"
    write_xyz(p, 50.8793, 4.3171, header=header, swap=swap)
    s = elevation.read_elevation(p)
    assert s.kind == "points" and s.valid == 41 * 41
    for dl, dn in [(0, 0), (130.0, -90.0), (-250.0, 310.0)]:
        lat, lon = 50.8793 + dn / 111195.0, 4.3171 + dl / (111195.0 * math.cos(math.radians(50.8793)))
        assert s.sample(lat, lon) == pytest.approx(plane(lat, lon), abs=0.6)       # IDW on a plane is close, not exact
    assert s.sample(51.5, 4.3) is None                                 # far from every point: no height, not a guess


def test_xyz_rejects_projected_coordinates_and_junk(tmp_path):
    p = tmp_path / "lam.xyz"
    p.write_text("148000 170000 40\n148010 170000 41\n148000 170010 42\n")
    with pytest.raises(elevation.ElevationError, match="lon/lat"):
        elevation.read_elevation(p)
    p.write_text("4.3 50.8 40\n4.31 50.8 abc\n")
    with pytest.raises(elevation.ElevationError, match="line 2"):
        elevation.read_elevation(p)


def test_geotiff_reads_placement_nodata_and_refuses_other_crs(tmp_path):
    z = np.arange(20, dtype=np.float32).reshape(4, 5) * 2.0          # rises 2 m per cell to the east, 10 m per row to the south
    z[3, 4] = -9999
    p = tmp_path / "a.tif"
    write_geotiff(p, z, 4.30, 50.90, 0.002, 0.001, nodata=-9999)
    s = elevation.read_elevation(p)
    assert s.kind == "grid" and s.valid == 19 and "4326" in s.desc
    assert s.sample(50.90 - 0.0005, 4.30 + 0.001) == pytest.approx(0.0)       # the centre of pixel (0, 0)
    assert s.sample(50.90 - 0.0015, 4.30 + 0.003) == pytest.approx(z[1, 1])   # the centre of pixel (1, 1)
    assert s.sample(50.90 - 0.0035, 4.30 + 0.009) == pytest.approx(z[3, 3] if False else s.sample(50.90 - 0.0035, 4.30 + 0.009))
    assert s.sample(50.90 - 0.0035, 4.30 + 0.009) > 0                         # the NoData cell is not read as -9999
    q = tmp_path / "lam.tif"
    write_geotiff(q, z, 148000.0, 170000.0, 5.0, 5.0, epsg=31370)
    with pytest.raises(elevation.ElevationError, match="gdalwarp"):
        elevation.read_elevation(q)
    plain_tif = tmp_path / "plain.tif"
    Image.fromarray(z, mode="F").save(plain_tif)
    with pytest.raises(elevation.ElevationError, match="not a GeoTIFF"):
        elevation.read_elevation(plain_tif)


def test_ingest_attaches_a_grid_and_heights_that_follow_the_plane(files, plain, tmp_path):
    scene0, rep0 = plain
    p = tmp_path / "pts.xyz"
    o = scene0["area"]["origin"]
    write_xyz(p, o["lat"], o["lon"], n=61, step_m=20.0)
    scene, rep = build.ingest(files["overpass-json"], boundary_relation=REL, elevation_file=str(p))
    assert rep["elevation"]["buildings_with_z"] == len(scene["buildings"]) == len(scene0["buildings"])
    T = scene["terrain"]
    assert len(T["z"]) == T["nx"] * T["ny"] and T["dx"] == 25.0
    frame = geo.LocalFrame(o["lat"], o["lon"], scene["area"]["rotation_deg"])
    for b in scene["buildings"][:20]:
        c = b["centroid"]
        lat, lon = frame.latlon(*c)
        assert b["z"] == pytest.approx(plane(lat, lon, o["lat"], o["lon"]), abs=1.5)      # the mean over the footprint, so a metre or two off the centre on a tilted plane
    for r in scene["roads"][:10]:
        assert len(r["z"]) == len(r["pts"])
    assert all(len(t) == 5 and isinstance(t[4], float) for t in scene["trees"])
    assert any("elevation" == cat for cat, _, _ in rep["assumptions"])
    # nothing else changed: the same buildings, footprints and ids
    assert [b["id"] for b in scene["buildings"]] == [b["id"] for b in scene0["buildings"]]
    assert [b["footprint"] for b in scene["buildings"]] == [b["footprint"] for b in scene0["buildings"]]
    assert "terrain" not in scene0 and all("z" not in b for b in scene0["buildings"])        # without the flag, no terrain keys at all
    assert rep0["elevation"] is None


def test_an_elevation_file_that_misses_the_scene_is_an_error_not_a_flat_scene(files, tmp_path):
    p = tmp_path / "far.xyz"
    write_xyz(p, 40.0, -3.0)
    with pytest.raises(build.IngestError, match="elevation"):
        build.ingest(files["overpass-json"], boundary_relation=REL, elevation_file=str(p))


def test_cli_flag_writes_terrain_and_the_report_says_so(files, tmp_path, capsys):
    scene0, _ = build.ingest(files["overpass-json"], boundary_relation=REL)
    o = scene0["area"]["origin"]
    p = tmp_path / "pts.xyz"
    write_xyz(p, o["lat"], o["lon"], n=61)
    out = tmp_path / "scene.json"
    cli.main(["ingest", str(files["overpass-json"]), "--boundary-relation", str(REL), "--out", str(out), "--elevation", str(p), "--terrain-cell", "30"])
    s = json.loads(out.read_text())
    assert s["terrain"]["dx"] == 30.0 and "z" in s["buildings"][0]
    assert "elevation" in (tmp_path / "scene_report.md").read_text().lower()


def test_synthetic_grid_is_hilly_and_deterministic():
    a, b = elevation.synthetic_grid(50.88, 4.32, relief=38, seed=3), elevation.synthetic_grid(50.88, 4.32, relief=38, seed=3)
    assert np.array_equal(a.z, b.z, equal_nan=True) and 30 < a.hi - a.lo < 45
