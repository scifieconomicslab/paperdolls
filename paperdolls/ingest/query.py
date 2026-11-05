"""Overpass QL for an extract the ingest can read. The sandbox this was built in cannot reach Overpass, so the query was
written from the Overpass QL documentation and has NOT been run against the live service: run it and report any error."""

LEISURE = "park|garden|playground|pitch|recreation_ground|nature_reserve|common|dog_park"
LANDUSE = "grass|meadow|forest|orchard|cemetery|recreation_ground|village_green|allotments|reservoir|basin|plaza|flowerbed"
NATURAL = "water|wood|scrub|grassland|heath|tree_row"


def overpass_query(relation=None, bbox=None, timeout=300):
    """relation: an OSM relation id (for example 58258 for Jette); bbox: (south, west, north, east). Either, or both."""
    if relation is None and bbox is None:
        raise ValueError("give a relation id, a bounding box, or both")
    if relation is not None:
        area, head = "(area.a)", f"rel({int(relation)});\nmap_to_area->.a;\n"
    else:
        area, head = "", ""
    box = "" if bbox is None else "({:.6f},{:.6f},{:.6f},{:.6f})".format(*bbox)
    flt = area if relation is not None else box
    st = []
    if relation is not None:
        st.append(f"  rel({int(relation)});                         // the boundary itself, so the ingest can clip to it")
    st += [f'  way["building"]{flt};', f'  rel["building"]{flt};',
           f'  way["highway"]{flt};',
           f'  way["railway"="tram"]{flt};',
           f'  way["leisure"~"^({LEISURE})$"]{flt};', f'  rel["leisure"~"^({LEISURE})$"]{flt};',
           f'  way["landuse"~"^({LANDUSE})$"]{flt};', f'  rel["landuse"~"^({LANDUSE})$"]{flt};',
           f'  way["natural"~"^({NATURAL})$"]{flt};', f'  rel["natural"~"^(water|wood)$"]{flt};',
           f'  way["waterway"="riverbank"]{flt};',
           f'  way["place"="square"]{flt};', f'  rel["place"="square"]{flt};',
           f'  node["natural"="tree"]{flt};']
    return f"[out:json][timeout:{timeout}];\n{head}(\n" + "\n".join(st) + "\n);\nout geom;\n"
