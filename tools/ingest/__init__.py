"""OpenStreetMap ingest: an OSM extract in, a scene file for the isometric renderer out.

    read (Overpass JSON, OSM XML, GeoJSON) -> classify -> project to local metres, rotate the frame
    -> scene.json + scene_report.md

The ingest never invents a quiet default: every assumption (storeys from a building type, an economic class from a tag or a
local mix fallback, a width from a lane count, trees scattered into a park) is counted and listed in the report for the user
to confirm. Attribution to carry with any published picture: (c) OpenStreetMap contributors (ODbL).
"""
__version__ = "1.0.0"
