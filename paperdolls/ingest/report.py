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
    L += ["## Left out", ""]
    L += [_table(sorted(rep["skipped"].items(), key=lambda kv: -kv[1]), ["what", "how many"])] if rep["skipped"] else ["Nothing was skipped."]
    L += ["", "## Warnings", ""]
    L += [f"- {w}" for w in rep["warnings"]] if rep["warnings"] else ["None."]
    L += ["", "## Not inferred, ask the user", "",
          "- **Drive side**: not read from the data. Set it from the region, or override it when the place differs from its region default.",
          "- **Retrofit states and ownership**: every building starts as `none` and not investor-owned. The model export supplies them.",
          "- **Building heights beyond the tags**: nothing was measured or looked up."]
    return "\n".join(L) + "\n"
