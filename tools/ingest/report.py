"""Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0). Adds the economic-class section.
"""
"""The ingest report: what was read, what was assumed, what to confirm. Written as Markdown next to the scene."""


def _table(rows, head):
    out = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def report_markdown(scene, rep):
    a, c, fr, est = scene["area"], rep["counts"], rep["frame"], rep["estimated_asset_share"]
    L = [f"# Ingest report: {a['name']}", "",
         f"Source: `{rep['input']['file']}` ({rep['input']['format']}). Attribution to carry with any published picture: **{a['attribution']}**.", "",
         "## What was drawn", "",
         _table([["buildings", c["buildings"]], ["roads (incl. tram tracks)", c["roads"]], ["landuse polygons", c["landuse"]],
                 ["trees", f"{c['trees']} ({c['trees_mapped']} mapped, {c['trees_in_rows']} in tree rows, {c['trees_scattered']} scattered)"],
                 ["extent", f"{rep['extent_m'][0]} x {rep['extent_m'][1]} m"]], ["item", "count"]), "",
         "## The frame", "",
         f"Origin {fr['origin']['lat']}, {fr['origin']['lon']}. x is east and y is south before rotation, so with no rotation north points up and to the right on the screen. "
         f"The frame was rotated by **{fr['rotation_deg']} degrees** ({fr['how']}). North now points **{fr['north_on_screen_deg']} degrees clockwise from the top of the screen**.", "",
         "Why rotate: the building assets need walls on the isometric axes. The rotation that makes most buildings fit was chosen from these candidates:", "",
         _table([[r["source"], r["rotation_deg"], r["strength"], f"{round(r['asset_share'] * 100)}%"] for r in fr["candidates"]], ["from", "rotation (deg)", "grid strength (0 to 1)", "buildings that fit an asset"]), "",
         f"Estimated share of buildings that will use an asset: **{round(est['rotated'] * 100)}%** after rotation, {round(est['unrotated'] * 100)}% without. "
         "The rest are drawn as generic extrusions (the renderer reports the exact count and the reasons). This is an estimate from each footprint's minimum bounding rectangle.", "",
         "## Assumptions to confirm", "",
         "Every default the ingest applied. Confirm, or supply better data.", "",
         _table([[cat, rule, n] for cat, rule, n in rep["assumptions"]], ["category", "rule", "how many"]) if rep["assumptions"] else "None.", ""]
    ls = rep["levels_sources"]
    tot = sum(ls.values()) or 1
    L += ["### Storeys", "",
          _table([[k, v, f"{round(v / tot * 100)}%"] for k, v in sorted(ls.items(), key=lambda kv: -kv[1])], ["source", "buildings", "share"]), "",
          "Storey counts decide building height and, through the region, which archetype a building gets. Where the share from `tag` is low, heights are mostly assumed.", ""]
    n_b = c["buildings"] or 1
    res, nb = rep.get("residential", {}), rep.get("neighbours", {})
    L += ["### Fields for the model binding", "",
          f"Each building also carries `area` (m2), `centroid`, `height` (m: the height tag, else storeys x 3.1 m), `levels_assumed` (storeys not read from the data: "
          f"**{rep.get('levels_assumed', 0)}** of {c['buildings']}, {round(rep.get('levels_assumed', 0) / n_b * 100)}%), `residential` and `neighbours`.", "",
          _table([[k, res.get(k, 0), f"{round(res.get(k, 0) / n_b * 100)}%"] for k in ("residential", "probable", "other")], ["residential class", "buildings", "share"]), "",
          "`residential`: a dwelling type (house, terrace, apartments, residential, ...). `probable`: a generic `building=yes` with no use tag and at least 30 m2: probably a dwelling, but a guess. "
          "`other`: a non-dwelling type, a use tag (shop, amenity, office, craft, industrial, tourism, healthcare, ...), a shed, or an outbuilding under 30 m2.", "",
          f"`neighbours`: buildings whose footprints touch or come within {nb.get('threshold_m', '?')} m: {nb.get('buildings_with_neighbours', 0)} buildings have at least one, "
          f"{nb.get('links', 0)} links, at most {nb.get('max_per_building', 0)} for one building.", "",
          "### Economic classes", ""]
    ec, es = rep.get("economic_classes", {}), rep.get("economic_class_sources", {})
    fb = rep.get("economic_class_fallback_share", 0)
    L += [_table([[k, v, f"{round(v / n_b * 100)}%"] for k, v in sorted(ec.items(), key=lambda kv: -kv[1])], ["class", "buildings", "share"]), "",
          "How each class was reached:", "",
          _table([[k, v] for k, v in sorted(es.items(), key=lambda kv: -kv[1])], ["source", "buildings"]), "",
          (f"**{round(fb * 100)}% of buildings were classed by the procedural fallback** (no resolvable use tag or specific type — mostly bare `building=yes`). "
           "These are seeded guesses from the local mix of tagged buildings, not data. Confirm them, or supply better tags, before binding a model to economic classes.") if fb else "No building needed the procedural fallback.", ""]
    le = rep.get("landuse_enrichment")
    if le:
        rows = [[code, n, "-> mapped"] for code, n in sorted(le["mapped"].items(), key=lambda kv: -kv[1])] if le.get("mapped") else []
        unm = le.get("unmapped", {})
        rows += [[code, n, "unmapped (kept the fallback guess)"] for code, n in sorted(unm.items(), key=lambda kv: -kv[1])]
        L += ["### Land-use enrichment", "",
              f"The fallback buildings were sampled against a classified land-use raster: `{le['file']}` ({le['source']})"
              + (f", mapped with `{le['mapping_file']}`" if le.get("mapping_file") else ", mapped with the built-in CORINE defaults") + ".", "",
              f"**{le['sampled']}** fallback building(s) fell inside the raster: {sum(le['mapped'].values())} re-classed from the raster, "
              f"{sum(unm.values())} on classes the mapping does not cover (they keep their seeded guess), {le.get('uncovered', 0)} outside the raster or on NoData.", "",
              _table(rows, ["class code", "buildings", "outcome"]) if rows else "No fallback building fell on a mapped class.", "",
              "The raster's class at a building's centroid is a land-use reading, not a use tag: confirm these classes in the table above before "
              "binding a model to economic classes. The mapping is a JSON file; `python -m ingest landuse-classes --raster ... --emit-mapping` "
              "writes the template for you to edit.", ""]
    el = rep.get("elevation")
    if el:
        L += ["### Elevation", "",
              f"Heights from `{el['file']}` ({el['source']}), written as `terrain` (a {el['cell_m']:g} m grid, {el['grid'][0]} x {el['grid'][1]} cells, range {el['range_m'][0]} to {el['range_m'][1]} m) "
              f"and as `z` on {el['buildings_with_z']} of {c['buildings']} buildings (the mean over footprint corners and centroid), on {el['roads_with_z']} of {el['roads_total']} roads (per point) and "
              f"on {el['trees_with_z']} trees. {round(el['grid_covered_share'] * 100)}% of the grid lay inside the file. A building's z is the ground, not its floor level, and the renderer stands it "
              "there as one rigid block: on a steep plot the downhill side floats and the uphill side sinks by half the height difference across the footprint. "
              "A DTM gives the ground under a bridge or viaduct, not the deck.", ""]
    L += ["## Left out", ""]
    L += [_table(sorted(rep["skipped"].items(), key=lambda kv: -kv[1]), ["what", "how many"])] if rep["skipped"] else ["Nothing was skipped."]
    L += ["", "## Warnings", ""]
    L += [f"- {w}" for w in rep["warnings"]] if rep["warnings"] else ["None."]
    L += ["", "## Not inferred, ask the user", "",
          "- **Drive side**: not read from the data. Set it from the region, or override it when the place differs from its region default.",
          "- **Retrofit states and ownership**: every building starts as `none` and not investor-owned. The model export supplies them.",
          "- **Building heights beyond the tags**: nothing was measured or looked up."]
    return "\n".join(L) + "\n"
