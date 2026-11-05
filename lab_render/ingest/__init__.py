"""OpenStreetMap ingest: an OSM extract in, a scene file for the isometric renderer out.

    read (Overpass JSON, OSM XML, GeoJSON) -> classify -> project to local metres, rotate the frame
    -> scene.json + ingest_report.md

The ingest never invents a quiet default: every assumption (storeys from a building type, an archetype from a tag, a width
from a lane count, trees scattered into a park) is counted and listed in the report for the user to confirm.
"""
__version__ = "0.1.0"
