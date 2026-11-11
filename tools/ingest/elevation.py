"""Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
"""
"""Ground heights for the scene: read a local elevation file and sample it at buildings, road vertices and trees.

Three inputs, all read with numpy and Pillow only (no GDAL):

* GeoTIFF (``.tif``, ``.tiff``): one band of floats or integers, in a geographic CRS (EPSG:4326, 4258 or 4979, taken as lon/lat degrees) or in Web
  Mercator (EPSG:3857). A raster in any other CRS (Belgian Lambert 31370 or 3812, UTM, ...) is refused with the command that reprojects it:
  ``gdalwarp -t_srs EPSG:4326 -r bilinear in.tif out.tif``. Pillow does not read the GeoTIFF tags itself, so the three tags that place the raster
  (ModelPixelScale 33550, ModelTiepoint 33922, GeoKeyDirectory 34735) and the NoData tag (42113) are read here. A rotated raster (ModelTransformation
  33920) is refused.
* Esri ASCII grid (``.asc``): the plain-text header ``ncols nrows xllcorner yllcorner cellsize NODATA_value`` (``xllcenter`` also read) and then the rows, north
  first. Coordinates are lon/lat degrees. ``gdal_translate -of AAIGrid`` writes it.
* XYZ or CSV points (anything else, e.g. ``.xyz``, ``.csv``, ``.txt``): one ``lon lat z`` per line, separated by commas, semicolons, tabs or spaces. If the
  first line is a header naming the columns (x, lon, lng, longitude; y, lat, latitude; z, elev, elevation, height) the names decide the order, otherwise the
  order is lon, lat, z. Lines starting with ``#`` are skipped. Points may be a regular grid or scattered: a height is the inverse-distance mean of the
  nearest few points, and there is none (the element gets no z) farther than a few point spacings from any point.

Heights are metres. Positions are WGS84 degrees, which the frame turns into scene metres, so nothing here depends on the scene's rotation.
"""
import math
import re

import numpy as np

from .geo import R_EARTH

GEOGRAPHIC_OK = {4326, 4258, 4979}               # lon/lat degrees, WGS84 or ETRS89 (they differ by well under a metre in Europe)
WEB_MERCATOR = {3857, 900913, 3785}
MERC_R = 6378137.0


class ElevationError(ValueError):
    pass


class GridSource:
    """A regular grid in lon/lat: rows run north to south from the top-left corner (lon0, lat0), cell sizes in degrees."""

    kind = "grid"

    def __init__(self, z, lon0, lat0, dlon, dlat, nodata=None, desc=""):
        z = np.asarray(z, dtype=np.float64)
        if nodata is not None:
            z = np.where(np.isclose(z, nodata), np.nan, z)
        z = np.where(np.isfinite(z) & (np.abs(z) < 1e5), z, np.nan)
        self.z, self.lon0, self.lat0, self.dlon, self.dlat, self.desc = z, lon0, lat0, dlon, dlat, desc
        self.ny, self.nx = z.shape
        if self.nx < 2 or self.ny < 2:
            raise ElevationError("the elevation grid needs at least 2 x 2 cells")
        valid = z[np.isfinite(z)]
        if not valid.size:
            raise ElevationError("the elevation grid holds no data (every cell is NoData)")
        self.cells, self.valid = z.size, int(valid.size)
        self.lo, self.hi = float(valid.min()), float(valid.max())

    def sample(self, lat, lon):
        u, v = (lon - self.lon0) / self.dlon, (self.lat0 - lat) / self.dlat        # cell centres at integer positions
        if u < -0.5 or v < -0.5 or u > self.nx - 0.5 or v > self.ny - 0.5:
            return None
        u, v = min(max(u, 0.0), self.nx - 1.0), min(max(v, 0.0), self.ny - 1.0)
        i, j = min(int(u), self.nx - 2), min(int(v), self.ny - 2)
        fu, fv = u - i, v - j
        q = self.z[j:j + 2, i:i + 2]
        w = np.array([[(1 - fu) * (1 - fv), fu * (1 - fv)], [(1 - fu) * fv, fu * fv]])
        ok = np.isfinite(q)
        if not ok.any():
            return None
        tot = w[ok].sum()                                                          # NoData corners drop out; the rest are re-weighted
        return float((q[ok] * w[ok]).sum() / tot) if tot > 1e-12 else float(q[ok].mean())

    def sample_nearest(self, lat, lon):
        """Nearest cell centre, no interpolation — the right read for a classified (land-use) raster, where the
        value is a code and averaging codes is meaningless. Returns None outside the grid or on NoData."""
        u, v = (lon - self.lon0) / self.dlon, (self.lat0 - lat) / self.dlat        # cell centres at integer positions
        if u < -0.5 or v < -0.5 or u > self.nx - 0.5 or v > self.ny - 0.5:
            return None
        i, j = min(max(int(round(u)), 0), self.nx - 1), min(max(int(round(v)), 0), self.ny - 1)
        z = float(self.z[j, i])
        return z if math.isfinite(z) else None


class PointSource:
    """Scattered or gridded points: a height is the inverse-distance mean of the nearest points, within a few point spacings."""

    kind = "points"
    K = 6

    def __init__(self, lon, lat, z, desc=""):
        lon, lat, z = (np.asarray(a, dtype=np.float64) for a in (lon, lat, z))
        ok = np.isfinite(lon) & np.isfinite(lat) & np.isfinite(z) & (np.abs(z) < 1e5)
        lon, lat, z = lon[ok], lat[ok], z[ok]
        if len(z) < 3:
            raise ElevationError("the elevation file needs at least 3 valid points")
        self.lon, self.lat, self.z, self.desc = lon, lat, z, desc
        self.cells, self.valid, self.lo, self.hi = len(z), len(z), float(z.min()), float(z.max())
        self.cy = math.cos(math.radians(float(lat.mean())))
        # work in metres east and north so distances are honest
        self.x, self.y = lon * math.radians(1) * R_EARTH * self.cy, lat * math.radians(1) * R_EARTH
        w, h = float(np.ptp(self.x)) or 1.0, float(np.ptp(self.y)) or 1.0
        self.cell = max(1.0, math.sqrt(w * h / max(1, len(z) / 3.0)))               # about 3 points a cell
        self.grid = {}
        for k, (a, b) in enumerate(zip(np.floor(self.x / self.cell).astype(int), np.floor(self.y / self.cell).astype(int))):
            self.grid.setdefault((int(a), int(b)), []).append(k)
        self.reach = 3                                                              # cells searched each way

    def sample(self, lat, lon):
        x, y = lon * math.radians(1) * R_EARTH * self.cy, lat * math.radians(1) * R_EARTH
        ci, cj = int(math.floor(x / self.cell)), int(math.floor(y / self.cell))
        idx = []
        for r in range(1, self.reach + 1):
            idx = [k for i in range(ci - r, ci + r + 1) for j in range(cj - r, cj + r + 1) for k in self.grid.get((i, j), ())]
            if len(idx) >= self.K:
                break
        if not idx:
            return None
        ids = np.array(idx)
        d = np.hypot(self.x[ids] - x, self.y[ids] - y)
        order = np.argsort(d)[:self.K]
        d, ids = d[order], ids[order]
        if d[0] > self.cell * self.reach:
            return None
        if d[0] < 1e-6:
            return float(self.z[ids[0]])
        w = 1.0 / np.maximum(d, 0.05) ** 2
        return float((self.z[ids] * w).sum() / w.sum())


# ---------- readers ----------
def _geotiff(path):
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    try:
        im = Image.open(path)
    except Exception as e:                                                          # a corrupt or unsupported file
        raise ElevationError(f"cannot open {path} as an image: {e}")
    tags = getattr(im, "tag_v2", None)
    if tags is None or 33550 not in tags or 33922 not in tags:
        raise ElevationError(f"{path} is a TIFF but not a GeoTIFF (no ModelPixelScale/ModelTiepoint tags). Georeference it, or give an XYZ/CSV or ASCII grid file.")
    if 33920 in tags:
        raise ElevationError(f"{path} has a ModelTransformation (a rotated or sheared raster): reproject it with gdalwarp first.")
    keys, geo = {}, tags.get(34735)
    if geo:
        geo = list(geo)
        for k in range(int(geo[3])):
            kid, loc, cnt, val = geo[4 + 4 * k: 8 + 4 * k]
            if loc == 0:
                keys[kid] = val
    epsg = keys.get(3072) if keys.get(1024) == 1 else keys.get(2048)
    if keys.get(1024) == 3 or epsg is None:
        raise ElevationError(f"{path}: cannot tell the coordinate system from the GeoTIFF keys. Reproject it to EPSG:4326 with gdalwarp.")
    if epsg not in GEOGRAPHIC_OK and epsg not in WEB_MERCATOR:
        raise ElevationError(f"{path} is in EPSG:{epsg}, which this reader does not convert. Reproject it first: gdalwarp -t_srs EPSG:4326 -r bilinear in.tif out.tif "
                             f"(or supply points as lon,lat,z text).")
    sx, sy = tags[33550][0], tags[33550][1]
    i0, j0, _, x0, y0 = tags[33922][:5]
    z = np.asarray(im, dtype=np.float64)
    if z.ndim != 2:
        raise ElevationError(f"{path} has {z.shape[-1]} bands; give a single-band elevation raster.")
    nodata = None
    nd = tags.get(42113)
    if nd:
        try:
            nodata = float(str(nd).strip("\x00 "))
        except ValueError:
            pass
    # the centre of pixel (0, 0): the tiepoint is a pixel corner (PixelIsArea, the usual case) or a pixel centre (PixelIsPoint)
    cx, cy = x0 - sx * i0, y0 + sy * j0
    if keys.get(1025) != 2:
        cx, cy = cx + sx / 2, cy - sy / 2
    desc = f"GeoTIFF EPSG:{epsg}, {z.shape[1]} x {z.shape[0]} cells"
    if epsg in WEB_MERCATOR:
        # Web Mercator metres to degrees, per axis: the grid stays regular in x but not in latitude, so resample the latitude axis to degrees
        cx, cy = cx - sx / 2, cy + sy / 2                                           # back to the top-left corner
        lon0, dlon = math.degrees(cx / MERC_R), math.degrees(sx / MERC_R)
        lat_of = lambda Y: math.degrees(2 * math.atan(math.exp(Y / MERC_R)) - math.pi / 2)
        top, bot = lat_of(cy), lat_of(cy - sy * z.shape[0])
        dlat = (top - bot) / z.shape[0]
        rows = np.empty_like(z)
        for r in range(z.shape[0]):                                                 # row r of the degree grid takes the nearest source row
            lat = top - (r + 0.5) * dlat
            Y = MERC_R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
            rows[r] = z[min(z.shape[0] - 1, max(0, int((cy - Y) / sy)))]
        return GridSource(rows, lon0 + dlon / 2, top - dlat / 2, dlon, dlat, nodata, desc)
    return GridSource(z, cx, cy, sx, sy, nodata, desc)


def _ascii_grid(path):
    head, rows = {}, []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = line.split()
            if not parts:
                continue
            if parts[0].lower() in ("ncols", "nrows", "xllcorner", "yllcorner", "xllcenter", "yllcenter", "cellsize", "nodata_value", "dx", "dy"):
                head[parts[0].lower()] = float(parts[1])
            else:
                rows.append([float(v) for v in parts])
    for need in ("ncols", "nrows", "cellsize"):
        if need not in head:
            raise ElevationError(f"{path}: the ASCII grid header has no {need}")
    if "xllcorner" not in head and "xllcenter" not in head or "yllcorner" not in head and "yllcenter" not in head:
        raise ElevationError(f"{path}: the ASCII grid header needs xllcorner and yllcorner (or the ...center forms)")
    z = np.array(rows, dtype=np.float64)
    nc, nr, cs = int(head["ncols"]), int(head["nrows"]), head["cellsize"]
    if z.shape != (nr, nc):
        raise ElevationError(f"{path}: the header says {nc} x {nr} cells but the file holds {z.shape[1]} x {z.shape[0]}")
    xl = head["xllcorner"] + cs / 2 if "xllcorner" in head else head["xllcenter"]
    yl = head["yllcorner"] + cs / 2 if "yllcorner" in head else head["yllcenter"]
    return GridSource(z, xl, yl + (nr - 1) * cs, cs, cs, head.get("nodata_value"), f"ASCII grid, {nc} x {nr} cells")


LON, LAT, Z = ("x", "lon", "lng", "long", "longitude"), ("y", "lat", "latitude"), ("z", "elev", "elevation", "height", "alt", "altitude")


def _points(path):
    cols, lon, lat, z = [0, 1, 2], [], [], []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for n, line in enumerate(f):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p for p in re.split(r"[,;\t ]+", line) if p != ""]
            try:
                vals = [float(p) for p in parts[:3]]
                if len(vals) < 3:
                    raise ValueError
            except ValueError:
                names = [p.strip('"').lower() for p in parts]
                if not lon and not lat:                                              # a header line, only before any data
                    try:
                        cols = [next(i for i, c in enumerate(names) if c in g) for g in (LON, LAT, Z)]
                        continue
                    except StopIteration:
                        pass
                raise ElevationError(f"{path}, line {n + 1}: expected 'lon lat z' numbers, got {line[:60]!r}")
            lon.append(vals[cols[0]] if max(cols) < 3 else float(parts[cols[0]]))
            lat.append(vals[cols[1]] if max(cols) < 3 else float(parts[cols[1]]))
            z.append(vals[cols[2]] if max(cols) < 3 else float(parts[cols[2]]))
    if lon and (max(map(abs, lon)) > 180 or max(map(abs, lat)) > 90):
        raise ElevationError(f"{path}: positions are not lon/lat degrees (values up to {max(map(abs, lon)):g}). Convert them to WGS84 lon,lat first.")
    return PointSource(lon, lat, z, f"point file, {len(z)} points")


def read_elevation(path):
    """Read an elevation file (GeoTIFF, Esri ASCII grid, or XYZ/CSV points) and return an object with sample(lat, lon) -> metres or None."""
    low = str(path).lower()
    try:
        if low.endswith((".tif", ".tiff")):
            return _geotiff(path)
        if low.endswith(".asc"):
            return _ascii_grid(path)
        return _points(path)
    except OSError as e:
        raise ElevationError(f"cannot read {path}: {e}")


def read_landuse_raster(path):
    """Read a classified land-use raster (GeoTIFF or Esri ASCII grid of class codes) for the land-use enrichment.

    A grid, and read with sample_nearest: a class code cannot be interpolated. Point files are for elevation."""
    src = read_elevation(path)
    if getattr(src, "kind", "") != "grid":
        raise ElevationError(f"{path}: a land-use raster needs a grid (a GeoTIFF or an Esri ASCII grid of class codes), not scattered points. "
                             "Sample the WMS download into a grid first.")
    return src


# ---------- onto the scene ----------
def attach(scene, frame, src, cell=25.0):
    """Write heights onto the scene (metres, 0.1 m): ``terrain`` (a regular grid over the scene bounds), ``z`` on every building (mean over its footprint
    corners and centroid), ``z`` per road point, and a fifth element ``z`` on every tree. Anything the source does not cover gets no z of its own (the
    renderer then reads the grid). Returns a report dict."""
    pts = [p for r in scene["roads"] for p in r["pts"]] + [p for b in scene["buildings"] for p in b["footprint"]] + [[t[0], t[1]] for t in scene["trees"]]
    if not pts:
        raise ElevationError("nothing to attach heights to")
    x0, x1 = min(p[0] for p in pts) - 30.0, max(p[0] for p in pts) + 30.0
    y0, y1 = min(p[1] for p in pts) - 30.0, max(p[1] for p in pts) + 30.0
    cell = max(2.0, float(cell))
    while ((x1 - x0) / cell + 1) * ((y1 - y0) / cell + 1) > 400000:                  # keep the grid a sane size for a very large scene
        cell *= 1.5
    nx, ny = int(math.ceil((x1 - x0) / cell)) + 1, int(math.ceil((y1 - y0) / cell)) + 1
    r1 = lambda v: round(v * 10) / 10

    def at(x, y):
        lat, lon = frame.latlon(x, y)
        return src.sample(lat, lon)

    grid, missing = [], 0
    for j in range(ny):
        for i in range(nx):
            h = at(x0 + i * cell, y0 + j * cell)
            grid.append(h)
            missing += h is None
    covered = len(grid) - missing
    if covered == 0:
        raise ElevationError("the elevation file does not cover the scene at all (check that it is in lon/lat degrees and over the same place)")
    z = np.array([np.nan if h is None else h for h in grid]).reshape(ny, nx)
    if missing:                                                                      # holes take the nearest height: edge rows and columns first, repeated
        for _ in range(max(nx, ny)):
            bad = np.isnan(z)
            if not bad.any():
                break
            pad = np.pad(z, 1, constant_values=np.nan)
            stack = np.stack([pad[1:-1, :-2], pad[1:-1, 2:], pad[:-2, 1:-1], pad[2:, 1:-1]])
            with np.errstate(all="ignore"):
                fill = np.nanmean(stack, axis=0)
            z = np.where(bad & np.isfinite(fill), fill, z)
    scene["terrain"] = {"x0": round(x0, 2), "y0": round(y0, 2), "dx": round(cell, 3), "dy": round(cell, 3), "nx": nx, "ny": ny, "z": [r1(v) for v in z.ravel()]}
    nb = nbm = nr = nt = 0
    for b in scene["buildings"]:
        samples = [at(*p) for p in b["footprint"]] + [at(*b["centroid"])] if "centroid" in b else [at(*p) for p in b["footprint"]]
        samples = [s for s in samples if s is not None]
        if samples:
            b["z"] = r1(sum(samples) / len(samples))
            nb += 1
        else:
            nbm += 1
    for r in scene["roads"]:
        zs = [at(*p) for p in r["pts"]]
        if all(v is not None for v in zs):
            r["z"] = [r1(v) for v in zs]
            nr += 1
    for t in scene["trees"]:
        h = at(t[0], t[1])
        if h is not None:
            while len(t) < 4:
                t.append(None)
            if len(t) == 4:
                t.append(r1(h))
            else:
                t[4] = r1(h)
            nt += 1
    vals = [b["z"] for b in scene["buildings"] if "z" in b]
    return {"source": src.desc, "cell_m": round(cell, 2), "grid": [nx, ny], "grid_covered_share": round(covered / len(grid), 3), "buildings_with_z": nb,
            "buildings_without_z": nbm, "roads_with_z": nr, "roads_total": len(scene["roads"]), "trees_with_z": nt,
            "range_m": [round(float(z.min()), 1), round(float(z.max()), 1)], "building_range_m": [min(vals), max(vals)] if vals else None}


def synthetic_grid(lat0, lon0, size_m=4000.0, cell_m=30.0, relief=38.0, seed=3):
    """A synthetic hilly terrain (for tests): a GridSource in lon/lat centred on (lat0, lon0), a valley with a long rise on one side, about ``relief`` metres."""
    rng = np.random.default_rng(seed)
    n = int(size_m / cell_m) + 1
    dlat = cell_m / (R_EARTH * math.radians(1))
    dlon = dlat / math.cos(math.radians(lat0))
    u = np.linspace(-1, 1, n)[None, :]
    v = np.linspace(-1, 1, n)[:, None]
    across = (v - 0.2 * np.sin(u * 3.0 + 0.7) - 0.15 * u) * size_m / 2000.0          # km from the valley floor, north is up (row 0)
    smooth = lambda t: t * t * (3 - 2 * t)
    t = np.clip(np.where(across > 0, across / 1.5, -across / 1.0), 0, 1)
    z = np.where(across > 0, relief * smooth(t), relief * 0.45 * smooth(t))
    low = rng.normal(size=(n // 8 + 2, n // 8 + 2))
    wob = np.kron(low, np.ones((8, 8)))[:n, :n] * 0.8
    return GridSource(np.round(z + wob, 1), lon0 - dlon * (n - 1) / 2, lat0 + dlat * (n - 1) / 2, dlon, dlat, None, f"synthetic hills, {n} x {n} cells")
