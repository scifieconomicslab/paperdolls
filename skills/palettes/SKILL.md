---
name: palettes
description: Choose and check regional palette families for the simulation renders. Use when the user asks which palette suits a place, wants to add or edit a palette, or needs to know what is proposed and what is measured.
---

# Palettes, looks and registers

Colour has three layers, and only the middle one is chosen from a palette.

- **Region** (twelve families in `assets/palettes.json`): fixes fleet, climate, building grammar, species mix and drive side. Choosing a region is the one place a place is chosen.
- **Look**: a colour scheme within the region, named by materials and light (for example "Red brick and slate", "Whitewash and terracotta", "Painted concrete, bright"). Three per region, 36 in all. Each sets walls, roofs, accents, ground, road, pavement, grass, foliage, bloom, water and the road surface (`asphalt`, `concrete`, `cobble`, `earth`).
- **Register**: `colorfigures` (the region's own colours, hand-inked) or `formal` (a Carbon-based technical drawing: neutral tokens, hairlines, colour reserved for data).

Rules:
- Every look is a proposal, authored by eye. Before policy use, replace it with colours sampled from real photographs of the place, and record the photographs and the method.
- Check the looks with local authors. Never assign a look from who lives in an area.
- Look names describe materials and light, never people.
- A region's building grammar, species mix and fleet are proposals too.
- Check that a look reads at small size and in greyscale before delivery.
- In the formal register the region still shows, as warm or cool and light or dark. Cool gray, warm gray and a few other Carbon tokens are from memory: check them against carbondesignsystem.com before formal material is published.

To add a look, add an entry to `families[].looks` in `assets/palettes.json` with a unique id, a `name` and `note`, four walls, two roofs, three accents, three canopies, `ground`, `road`, `pave`, `grass`, `water`, `shadow`, an optional `bloom` (or `null`) and a `surface`. Run `python -m pytest tests` to validate it. The first look of each family is repeated in the family's `wall`, `wall2`, `roof`, `ground`, `accent` and `shadow` for older code.

## Regional people, vehicles, buildings and trees

Each family also has a region entry in `viz/assetlib.js`, `viz/buildinglib.js` and `viz/treelib.js` (`REGIONS`): a weighted fleet, a climate (`cold`, `sun`, `rain`), a drive side, a building grammar (archetype mix, roof mix, shutters, awnings, balconies, air conditioning, window proportion) and a tree species mix. These are proposals like the colours. Clothing follows climate (coats, sun hats, umbrellas). Check the fleet, the drive side, the building grammar and the species mix with local authors, and never vary appearance by who lives in an area.
