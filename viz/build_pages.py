"""Rebuild the two static pages in this folder: viewer_built.html and library_catalogue_built.html.
Run from anywhere: python viz/build_pages.py"""
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
sys.path.insert(0, str(here.parent))
from lab_render.viewer_build import build_catalogue, build_viewer

for name, html in (("viewer_built.html", build_viewer()), ("library_catalogue_built.html", build_catalogue())):
    (here / name).write_text(html, encoding="utf-8")
    print("wrote", name, len(html) // 1024, "KB")
