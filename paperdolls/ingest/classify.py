"""Tag semantics: what an OSM feature becomes in the scene, and a count of every assumption made on the way."""
import re
from collections import defaultdict


class Assumptions:
    """Counts of defaults and mappings, by category. The report prints them as a table for the user to confirm."""

    def __init__(self):
        self.rows = defaultdict(lambda: defaultdict(int))

    def add(self, category, rule, n=1):
        self.rows[category][rule] += n

    def table(self):
        return [(c, r, n) for c, d in self.rows.items() for r, n in sorted(d.items(), key=lambda kv: -kv[1])]

    def as_dict(self):
        return {c: dict(d) for c, d in self.rows.items()}


def parse_num(v):
    """First number in a tag value ('3', '3.5', '12 m', '3;4' -> 3, 3.5, 12, 3), else None."""
    if v is None:
        return None
    m = re.search(r"[-+]?\d+(?:[.,]\d+)?", str(v))
    return float(m.group(0).replace(",", ".")) if m else None


# ---------- buildings ----------
BUILDING_SKIP = {"no", "roof", "ruins", "collapsed", "demolished", "proposed", "construction"}
M_PER_LEVEL = 3.1
LEVELS_BY_TYPE = {
    "house": 2, "detached": 2, "semidetached_house": 2, "bungalow": 1, "villa": 2, "terrace": 3, "residential": 3, "apartments": 4,
    "dormitory": 4, "hotel": 4, "office": 4, "commercial": 3, "retail": 2, "supermarket": 1, "kiosk": 1, "industrial": 1,
    "warehouse": 1, "garage": 1, "garages": 1, "shed": 1, "barn": 1, "greenhouse": 1, "hangar": 1, "farm_auxiliary": 1, "service": 1,
    "school": 3, "hospital": 4, "church": 1, "chapel": 1, "cathedral": 1, "mosque": 1, "temple": 1, "public": 3, "civic": 3,
    "university": 4, "train_station": 1, "parking": 3,
}
GLOBAL_LEVELS = 2


def building_levels(tags, assume):
    """(storeys, source). Sources: tag, height, type-default, global-default. Defaults are counted as assumptions."""
    lv = parse_num(tags.get("building:levels"))
    if lv is not None and lv >= 1:
        return min(60, int(round(lv))), "tag"
    h = parse_num(tags.get("height"))
    if h is not None and h > 0:
        assume.add("storeys", f"from height tag at {M_PER_LEVEL} m per storey")
        return max(1, min(60, int(round(h / M_PER_LEVEL)))), "height"
    b = tags.get("building")
    if b in LEVELS_BY_TYPE:
        assume.add("storeys", f"building={b} with no levels or height: assumed {LEVELS_BY_TYPE[b]}")
        return LEVELS_BY_TYPE[b], "type-default"
    assume.add("storeys", f"building={b} with no levels or height: assumed {GLOBAL_LEVELS}")
    return GLOBAL_LEVELS, "global-default"


_HOUSES = {"house", "detached", "bungalow", "villa", "cabin"}
_TERRACES = {"terrace", "semidetached_house", "row_house"}
_SHEDS = {"industrial", "warehouse", "garage", "garages", "shed", "barn", "greenhouse", "hangar", "farm_auxiliary", "service", "storage_tank", "stable", "cowshed"}
_SHOPS = {"retail", "supermarket", "kiosk", "shop"}
_BLOCKS = {"apartments", "dormitory", "hotel", "office"}


def building_archetype(tags, levels, assume):
    """Scene archetype, or 'auto' to let the region's building mix decide at render time."""
    b = tags.get("building", "yes")
    if b in _SHEDS:
        a = "shed"
    elif levels >= 10:
        a = "tower"
    elif b in _TERRACES:
        a = "terrace"
    elif b in _HOUSES:
        a = "villa"
    elif b in _SHOPS or ("shop" in tags and levels <= 4):
        a = "shophouse"
    elif b in _BLOCKS or (b == "commercial" and levels > 3) or (b == "residential" and levels >= 4):
        a = "block"
    else:
        a = "auto"
    assume.add("archetype", f"building={b}" + (f" with {levels} storeys" if a in ("tower",) else "") + f" -> {a}" + (" (the region decides)" if a == "auto" else ""))
    return a


# ---------- roads ----------
AVENUE = {"motorway", "trunk", "primary", "secondary", "tertiary"}
LOCAL = {"unclassified", "residential", "living_street", "road", "service", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
HIGHWAY_SKIP = {"footway", "path", "steps", "corridor", "bridleway", "track", "proposed", "construction", "raceway", "elevator", "platform", "bus_stop", "rest_area", "via_ferrata"}


def classify_road(tags, assume):
    """Returns (spec, None) or (None, reason). spec: class, width (m or None), cycle (bool)."""
    hw = tags.get("highway")
    if tags.get("tunnel") in ("yes", "building_passage", "culvert") or (parse_num(tags.get("layer")) or 0) < 0:
        return None, "road in a tunnel or below ground"
    if hw in HIGHWAY_SKIP:
        return None, f"highway={hw} (not drivable)"
    if hw == "service" and (tags.get("service") in ("driveway", "parking_aisle", "drive-through", "emergency_access") or tags.get("access") in ("private", "no")):
        return None, "service road: driveway, parking aisle or private"
    if hw in AVENUE:
        cls = "avenue"
    elif hw in LOCAL:
        cls = "local"
    elif hw == "pedestrian":
        cls = "pedestrian"
    elif hw == "cycleway":
        cls = "cycle"
    else:
        return None, f"highway={hw} (unknown)"
    cyc = cls == "cycle" or any(k.startswith("cycleway") and v in ("lane", "track", "shared_lane", "opposite_lane", "opposite_track") for k, v in tags.items())
    w = parse_num(tags.get("width"))
    src = "width tag"
    if w is None and parse_num(tags.get("lanes")):
        w, src = parse_num(tags.get("lanes")) * 3.1, "lanes tag at 3.1 m per lane"
    width = None
    if w is not None and cls in ("avenue", "local"):
        width = max(3.0, min(30.0, w))
        assume.add("road width", f"{src}: {cls} width set from the tag instead of the class default")
    assume.add("road class", f"highway={hw} -> {cls}")
    return {"class": cls, "width": width, "cycle": bool(cyc)}, None


# ---------- landuse ----------
def landuse_kind(tags):
    n, lu, le = tags.get("natural"), tags.get("landuse"), tags.get("leisure")
    if n == "water" or tags.get("waterway") in ("riverbank", "dock") or lu in ("reservoir", "basin"):
        return "water"
    if tags.get("place") == "square" or tags.get("amenity") == "marketplace" or lu == "plaza" or (tags.get("highway") == "pedestrian" and tags.get("area") == "yes"):
        return "square"
    if le in ("garden",) or lu == "allotments":
        return "garden"
    if le in ("park", "playground", "pitch", "recreation_ground", "nature_reserve", "common", "dog_park") or lu in ("grass", "meadow", "forest", "orchard", "cemetery", "recreation_ground", "village_green", "flowerbed") or n in ("wood", "scrub", "grassland", "heath"):
        return "park"
    return None


# metres squared of ground per scattered tree, by what the polygon is. None: never scatter.
def scatter_area_per_tree(tags):
    if tags.get("natural") == "wood" or tags.get("landuse") == "forest":
        return 70.0
    if tags.get("landuse") == "orchard":
        return 40.0
    if tags.get("leisure") in ("park", "nature_reserve", "common") or tags.get("landuse") in ("village_green",):
        return 400.0
    if tags.get("landuse") == "cemetery":
        return 300.0
    return None


# ---------- trees ----------
_PALM = ("phoenix", "cocos", "washingtonia", "trachycarpus", "roystonea", "areca", "arecaceae", "chamaerops", "livistona", "elaeis", "borassus", "palm")
_CONIFER = ("pinus", "picea", "abies", "cedrus", "larix", "thuja", "taxus", "juniperus", "sequoia", "pseudotsuga", "tsuga")
_BLOSSOM = ("prunus", "jacaranda", "magnolia", "delonix", "lagerstroemia", "cercis", "bauhinia", "malus", "cherry")
_COLUMNAR = ("populus", "cupressus", "italica", "fastigiata", "fastigiate")
_UMBRELLA = ("acacia", "samanea", "albizia", "vachellia", "pinus pinea", "ficus benghalensis")


def tree_kind(tags, assume=None):
    """(kind or None, scale). None means the region's species mix decides. Mapping is by genus or species, then leaf type."""
    sp = " ".join(str(tags.get(k, "")).lower() for k in ("species", "genus", "species:en", "taxon", "cultivar"))
    kind = None
    if any(t in sp for t in _UMBRELLA):
        kind = "umbrella"
    elif any(t in sp for t in _PALM):
        kind = "palm"
    elif "platanus" in sp or "plane" in sp:
        kind = "plane"
    elif any(t in sp for t in _COLUMNAR):
        kind = "columnar"
    elif "quercus" in sp or "oak" in sp:
        kind = "oak"
    elif any(t in sp for t in _BLOSSOM):
        kind = "blossom"
    elif any(t in sp for t in _CONIFER) or tags.get("leaf_type") == "needleleaved":
        kind = "conifer"
    h = parse_num(tags.get("height"))
    scale = 1.0 if h is None else min((0.8, 1.0, 1.2), key=lambda s: abs(h / 8.0 - s))
    if assume is not None:
        assume.add("tree kind", f"{kind} from species or leaf type" if kind else "no species: the region's species mix decides")
    return kind, scale
