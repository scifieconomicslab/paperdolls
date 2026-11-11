"""Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0). Adds the economic-class cascade (reference/building-archetypes.md).
"""
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


# ---------- residential class ----------
# Rule (documented in docs/pack-spec.md, counted in the ingest report):
#   residential : building is a dwelling type (RESIDENTIAL_TYPES)
#   other       : building is a non-dwelling type (house of worship, school, industry, ...), or carries a non-residential use tag
#                 (shop, amenity, office, craft, industrial, tourism, healthcare, ...), or its archetype is 'shed'
#   probable    : building=yes (a generic value, GENERIC_TYPES) with no such evidence, and at least PROBABLE_MIN_M2 of footprint.
#                 This is the big class in Brussels: OSM often leaves dwellings as plain building=yes. It is a guess; the report counts it.
RESIDENTIAL_TYPES = {"house", "detached", "semidetached_house", "terrace", "row_house", "residential", "apartments", "bungalow", "villa", "cabin",
                     "dormitory", "duplex", "flats", "townhouse", "static_caravan", "houseboat"}
NON_RESIDENTIAL_TYPES = {"commercial", "retail", "supermarket", "kiosk", "office", "industrial", "warehouse", "garage", "garages", "carport", "shed", "barn",
                         "greenhouse", "hangar", "farm_auxiliary", "service", "stable", "cowshed", "storage_tank", "school", "kindergarten", "university", "college",
                         "hospital", "church", "chapel", "cathedral", "mosque", "temple", "synagogue", "religious", "public", "civic", "government", "train_station",
                         "transportation", "parking", "hotel", "sports_hall", "stadium", "fire_station", "toilets", "bridge", "silo", "tank"}
GENERIC_TYPES = {"yes", "unclassified", "building"}      # says nothing about use; any other value not in the dwelling list is some named non-dwelling type
USE_TAGS = ("shop", "amenity", "office", "craft", "industrial", "tourism", "healthcare", "leisure", "man_made", "public_transport", "railway", "power")
PROBABLE_MIN_M2 = 30.0
RESIDENTIAL_CLASSES = ("residential", "probable", "other")


def residential_class(tags, archetype, area, assume):
    """('residential' | 'probable' | 'other'), counted as an assumption with the reason."""
    b = tags.get("building", "yes")
    if b in RESIDENTIAL_TYPES:
        c, why = "residential", f"building={b}: a dwelling type"
    elif b in NON_RESIDENTIAL_TYPES:
        c, why = "other", f"building={b}: not a dwelling type"
    elif any(k in tags for k in USE_TAGS):
        c, why = "other", f"building={b} with a use tag ({next(k for k in USE_TAGS if k in tags)}=*)"
    elif b not in GENERIC_TYPES:
        c, why = "other", f"building={b}: a named type that is not a dwelling"
    elif archetype == "shed":
        c, why = "other", f"building={b} drawn as a shed"
    elif area < PROBABLE_MIN_M2:
        c, why = "other", f"building={b} under {PROBABLE_MIN_M2:.0f} m2 and no use tag: an outbuilding"
    else:
        c, why = "probable", f"building={b} with no use tag, {PROBABLE_MIN_M2:.0f} m2 or more: probably a dwelling (a guess)"
    assume.add("residential", f"{c}: {why}")
    return c


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
    if le in ("park", "playground", "pitch", "recreation_ground", "nature_reserve", "common", "dog_park", "golf_course") or \
       lu in ("grass", "meadow", "forest", "orchard", "cemetery", "recreation_ground", "village_green", "flowerbed") or \
       n in ("wood", "scrub", "grassland", "heath", "wetland"):
        return "park"
    if n in ("sand", "beach", "bare_rock") or lu in ("beach", "bare_ground"):
        return "square"        # bare ground reads as the neutral paved tone; the report records what it was
    if lu == "railway":
        return "rail"
    if lu in ("brownfield", "construction", "greenfield"):
        return "bare"
    return None


def landuse_cover(tags):
    """The finer surface under a land-use kind, so the renderer can give a wood, a pitch and a lawn
    different surfaces while the coarse kind stays stable. Open vocabulary; None when nothing finer is known."""
    n, lu, le = tags.get("natural"), tags.get("landuse"), tags.get("leisure")
    if n == "wood" or lu == "forest":
        return "wood"
    if n in ("scrub", "heath") or lu == "shrubs":
        return "scrub"
    if n == "wetland":
        return "wetland"
    if le in ("pitch", "golf_course"):
        return "pitch"
    if le in ("playground", "dog_park"):
        return "playground"
    for value in (lu, le, n):
        if value in ("meadow", "grassland", "orchard", "cemetery", "allotments", "flowerbed", "village_green", "grass",
                     "sand", "beach", "bare_rock", "brownfield", "construction", "greenfield", "railway", "plaza"):
            return {"grassland": "meadow", "village_green": "grass", "bare_rock": "rock"}.get(value, value)
    return None


# metres squared of ground per scattered tree, by what the polygon is. None: never scatter.
def scatter_area_per_tree(tags):
    if tags.get("natural") == "wood" or tags.get("landuse") == "forest":
        return 70.0
    if tags.get("landuse") == "orchard":
        return 40.0
    if tags.get("leisure") == "golf_course":
        return 700.0
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


# ---------- economic classes (reference/building-archetypes.md) ----------
# The normative research lives in /reference/building-archetypes.md (tag distribution 2026-11-08).
# The cascade, in order:
#   1. building=<known specific type>                          -> BUILDING_TO_CLASS
#   2. use tags (shop/amenity/office/craft/industrial/man_made/
#      healthcare/leisure/tourism/public_transport/power/railway) -> USE_TAG_TO_CLASS
#   3. building:use=<value> resolvable to a class              -> resolved like steps 1-2
#   4. landuse= farmyard|industrial|commercial|residential     -> LANDUSE_TO_CLASS
#   5. procedural fallback: seeded draw from the local mix of classes found in steps 1-4
#      (flagged economic_class_source="fallback"). building=yes lands here.
# Lifecycle keys fold per the reference: construction stays; abandoned/collapsed/damaged/demolished -> ruins.
# 'no', 'roof', 'proposed' are rejected, not classed.
ECONOMIC_CLASSES = (
    # housing
    "house", "residential", "detached", "apartments", "semidetached_house", "terrace", "bungalow",
    "hut", "static_caravan", "cabin",
    # production and agriculture
    "industrial", "manufacture", "factory", "farm", "farm_auxiliary", "barn", "greenhouse", "silo", "stable", "cowshed",
    # trade and services
    "retail", "warehouse", "kiosk", "supermarket", "office", "garage", "mixed_use",
    # public sector
    "school", "kindergarten", "university", "hospital", "clinic", "government", "fire_station", "civic",
    # energy and infrastructure
    "storage_tank", "digester", "transformer_tower", "service",
    # economic states
    "construction", "ruins", "allotment_house",
    # non-economic leftovers
    "outbuilding", "other",
)
ECONOMIC_CLASS_SOURCES = ("tag", "use-tag", "building:use", "landuse", "landuse-raster", "fallback", "generated")

BUILDING_TO_CLASS = {
    "house": "house", "residential": "residential", "detached": "detached", "apartments": "apartments",
    "flats": "apartments", "dormitory": "apartments", "semidetached_house": "semidetached_house",
    "terrace": "terrace", "row_house": "terrace", "townhouse": "terrace", "duplex": "house",
    "bungalow": "bungalow", "hut": "hut", "static_caravan": "static_caravan", "cabin": "cabin",
    "industrial": "industrial", "manufacture": "manufacture", "factory": "factory",
    "farm": "farm", "farm_auxiliary": "farm_auxiliary", "barn": "barn", "greenhouse": "greenhouse",
    "silo": "silo", "stable": "stable", "cowshed": "cowshed",
    "retail": "retail", "warehouse": "warehouse", "kiosk": "kiosk", "supermarket": "supermarket",
    "office": "office", "garage": "garage", "commercial;residential": "mixed_use", "hotel": "mixed_use",
    "school": "school", "kindergarten": "kindergarten", "university": "university", "college": "university",
    "hospital": "hospital", "clinic": "clinic", "government": "government", "public": "government",
    "train_station": "other", "transportation": "other", "parking": "garage",
    "fire_station": "fire_station", "civic": "civic", "church": "civic", "chapel": "civic",
    "cathedral": "civic", "mosque": "civic", "temple": "civic", "synagogue": "civic", "religious": "civic",
    "monastery": "civic", "mausoleum": "civic", "sports_hall": "civic", "stadium": "civic",
    "storage_tank": "storage_tank", "tank": "storage_tank", "digester": "digester",
    "transformer_tower": "transformer_tower", "service": "service",
    "construction": "construction", "ruins": "ruins", "abandoned": "ruins", "collapsed": "ruins",
    "damaged": "ruins", "demolished": "ruins", "allotment_house": "allotment_house",
    "shed": "outbuilding", "garages": "outbuilding", "carport": "outbuilding",
}
BUILDING_USE_FOLD = {"abandoned", "collapsed", "damaged", "demolished", "ruins"}

_USE_CLASS = (
    # (tag key, value -> class); unlisted values in a present tag use the tag's default_class
    (("shop",), {"supermarket": "supermarket", "kiosk": "kiosk"}, "retail"),
    (("amenity",), {"school": "school", "kindergarten": "kindergarten", "university": "university", "college": "university",
                    "hospital": "hospital", "clinic": "clinic", "doctors": "clinic", "dentist": "clinic", "veterinary": "clinic",
                    "fire_station": "fire_station", "townhall": "government", "courthouse": "government", "police": "government",
                    "place_of_worship": "civic", "marketplace": "retail",
                    "restaurant": "retail", "cafe": "retail", "bar": "retail", "pub": "retail", "fast_food": "retail"},
     "other"),
    (("office",), {}, "office"),
    (("craft",), {}, "manufacture"),
    (("industrial",), {}, "industrial"),
    (("man_made",), {"silo": "silo", "storage_tank": "storage_tank", "digester": "digester", "transformer_tower": "transformer_tower"},
     "other"),
    (("healthcare",), {"hospital": "hospital"}, "clinic"),
    (("leisure",), {"sports_centre": "civic", "fitness_centre": "civic", "stadium": "civic", "sports_hall": "civic"}, None),
    (("tourism",), {}, "civic"),
    (("public_transport",), {}, "other"),
    (("railway",), {}, "other"),
    (("power",), {"substation": "transformer_tower"}, "service"),
)
LANDUSE_TO_CLASS = {"farmyard": "farm", "industrial": "industrial", "commercial": "retail", "residential": "residential"}


def _class_for_value(v):
    """Try the building= table, then the use-tag tables, on a bare value (used for building= and building:use=)."""
    if not v:
        return None
    v = str(v).strip().lower()
    if v in BUILDING_TO_CLASS:
        return BUILDING_TO_CLASS[v]
    for keys, values, default in _USE_CLASS:
        for k, cls in values.items():
            if v == k:
                return cls
    return None


def economic_class(tags):
    """Cascade steps 1-4: (class, source) or (None, None). Step 5 is the caller's fallback draw.

    Multi-value tags ('commercial;residential') are matched verbatim first, then split.
    """
    b = tags.get("building")
    if b is not None:
        c = _class_for_value(b)
        if c:
            return c, "tag"
        for part in str(b).split(";"):
            c = _class_for_value(part.strip()) or ("outbuilding" if part.strip().lower() in {"shed", "garages", "carport"} else None)
            if c:
                return c, "tag"
    for keys, values, default in _USE_CLASS:
        k = keys[0]
        v = tags.get(k)
        if v is None:
            continue
        c = values.get(str(v).strip().lower(), default)
        if c:
            tag = f"{k}={v}"
            return c, "use-tag"
    bu = tags.get("building:use")
    if bu:
        c = _class_for_value(bu)
        if c:
            return c, "building:use"
        if str(bu).strip().lower() in ("yes", "residential"):
            return "residential", "building:use"
    lu = tags.get("landuse")
    if lu:
        c = LANDUSE_TO_CLASS.get(str(lu).strip().lower())
        if c:
            return c, "landuse"
    return None, None


def resolve_fallback_mix(counts):
    """Given Counter of classes seen in steps 1-4, return (classes, weights) for the seeded fallback draw, or None."""
    if not counts:
        return None
    total = sum(counts.values())
    classes = list(counts)
    weights = [counts[c] / total for c in classes]
    return classes, weights


def fallback_class(rng, mix):
    """Seeded draw from the local mix. Deterministic for a given rng and mix."""
    classes, weights = mix
    r = rng.random()
    acc = 0.0
    for c, w in zip(classes, weights):
        acc += w
        if r <= acc:
            return c
    return classes[-1]


# Rejected (not classed): 'no' is not a building, 'roof' is a roof, 'proposed'/'demolished' are lifecycle rejections.
BUILDING_SKIP = {"no", "roof", "proposed"}
