# World families and palette genres

A **world family** is a package: a set of palette families (each with three
looks), a structure grammar, vehicle classes, people and tree mixes, and
treatment presets. The `real` world family is the 12 contemporary regions
already in `palettes.json`. The menus below are the proposed `historical`,
`fantasy` and `scifi` world families.

Everything here is a **proposal** — a visual direction to author against, not
a historical, cultural or scientific claim. Palette cues are guidance for the
colours to author, not final hex values. Every entry must render in all three
looks (`colorfigures`, `formal`, `voxel`).

Three genres now carry authored palette proposals and machine-readable packs:
`roman` (historical), `high-pastoral` (fantasy) and `cyberpunk` (scifi). Their
palettes are in `palettes.json`; their structure/fleet/mix/treatment packs are
in `family-packs.json`. Their fleets are not authored yet, so they render no
vehicles until someone adds the classes. Every other genre is still a menu
entry without a palette; choosing one must not silently borrow another.

## Rules for adding a world family or genre

1. Supply a palette family with three looks, following `palettes.json`.
2. Supply a structure grammar: two to four archetypes with bay widths,
   storeys, roof/silhouette rules and material roles. Buildings are the common
   case; walls, habitats, ruins and infrastructure are valid structures.
3. Supply a vehicle set (two to five classes on `road`, `cycle`, `rail` or
   `pavement`) and a people/tree mix.
4. Supply treatment presets in the generic grammar (`mark`, `overlay`,
   `replacement`, `growth`, `state`, `extent`). The `real` family's retrofit
   vocabulary is its preset.
5. Keep the catalogue role vocabulary: no genre-specific look, no
   hard-coded palette in an asset.
6. Label the world family as a proposal on the page and in the world record.
   Ask the user when a genre choice would imply a real-world claim.

## `real`

The 12 contemporary regions in `reference/render/palettes.json`: `nw`, `uk`,
`ws`, `md`, `ce`, `sa`, `se`, `ea`, `me`, `sb`, `la`, `na`. Each has three
looks. This is the only family with authored palette values today.

## `historical` — empires and their visual signatures

Fourteen distinct starting points, chosen for visual separation, not for
coverage of every empire.

| id | reference | palette direction | structures / vehicles |
|---|---|---|---|
| `roman` | Roman Empire | travertine, terracotta, marble, cypress, ochre | insulae, domus, forums, aqueducts; carts |
| `byzantine` | Byzantine Empire | brick, gold, porphyry, deep blue, mosaic | domed churches, walls, cisterns; carts, litters |
| `ottoman` | Ottoman Empire | sandstone, turquoise tile, red tile, cypress | mosques, hans, bazaars, courtyard houses; carts, horses |
| `persian` | Persian empires | turquoise, lapis, ochre, rose, garden green | iwans, windcatchers, walled gardens, bazaars; carts, horses |
| `mughal` | Mughal Empire | red sandstone, white marble, jade, saffron | forts, tombs, gardens, havelis; carts, litters |
| `han` | Han / Tang China | timber, grey tile, vermilion, jade, ink | courtyard houses, city walls, pagodas, markets; carts, sedan chairs |
| `edo` | Edo Japan | wood, white plaster, dark tile, indigo, cherry | machiya, castles, temples, bridges; rickshaws, palanquins |
| `khmer` | Khmer Empire | laterite, sandstone, jungle green, ochre | temple complexes, barays, stilt houses; carts, boats |
| `mesoamerican` | Aztec / Maya | limestone, jade, obsidian, tropical green, red | pyramids, plazas, ball courts, chinampas; canoes, porters |
| `andean` | Inca | Andean stone, terraces, earth, gold | terraces, kallanka, storehouses, suspension bridges; llamas, porters |
| `egyptian` | Ancient Egypt | sandstone, limestone, Nile green, gold, lapis | temples, workers' quarters, granaries; carts, boats |
| `sahelian` | Mali / Songhai | mudbrick, earth, indigo, ochre, acacia | mosques, courtyard houses, markets; carts, camels |
| `norse` | Norse | timber, turf, slate, cold sea, iron | longhouses, walls, jetties; carts, boats |
| `srivijayan` | Srivijaya / Majapahit | timber, tile, tropical green, gold, sea | stilt houses, temples, harbours; boats, carts |

## `fantasy` — visually distinct genres

Fourteen genres chosen to look different from each other, not to form a
taxonomy of fantasy.

| id | genre | palette direction | structures / vehicles |
|---|---|---|---|
| `high-pastoral` | high fantasy | meadow green, gold, stone, banner red/blue | castles, cottages, walls, markets; carts, horses |
| `dark-gothic` | dark fantasy | charcoal, blood red, bone, fog grey | cathedrals, ruins, crypts, spires; hearses, carriages |
| `desert-nights` | Arabian Nights | sand, turquoise, saffron, indigo, brass | domes, minarets, bazaars, oases; caravans, camels |
| `wuxia` | eastern fantasy | jade, vermilion, ink, gold, mist | temples, pavilions, walls, bamboo; sedan chairs, horses |
| `nordic-frost` | Nordic fantasy | ice blue, pine, iron, snow, aurora | longhouses, mead halls, runestones; sleds, longships |
| `elven-tropical` | tropical fantasy | emerald, orchid, gold, mist, teal | treehouses, bridges, terraces; boats, stags |
| `dwarven-volcanic` | volcanic fantasy | obsidian, ember, brass, ash, magma | halls, forges, gates, tunnels; mine carts, rams |
| `necropolis` | undead | bone, slate, sickly green, violet | tombs, mausoleums, walls, ruins; bone carts, hearses |
| `fae-bioluminescent` | fae | teal, magenta, moonstone, dark green, glow | mushroom houses, rings, bridges; moths, fireflies |
| `steampunk` | gaslamp / steampunk | brass, soot, copper, teal, glass | factories, stations, terraces, airships; steam carriages, dirigibles |
| `sunken` | flooded | aquamarine, coral, brine, pearl, algae | stilt houses, ruins, causeways; boats, submersibles |
| `arcane-crystal` | crystal / arcane | amethyst, cyan, silver, midnight | towers, crystal spires, portals; floating platforms, constructs |
| `sky-isles` | floating | sky blue, white, gold, storm grey | platforms, bridges, towers, windmills; airships, gliders |
| `wasteland` | barbarian | ochre, rust, bone, dust, blood | camps, walls, ruins, tents; carts, beasts |

## `scifi` — visually distinct genres

Fourteen genres chosen for visual separation; a world may combine two, but the
palette comes from one.

| id | genre | palette direction | structures / vehicles |
|---|---|---|---|
| `cyberpunk` | neon cyberpunk | magenta, cyan, black, chrome, sodium | megatowers, markets, transit, signage; hover cars, drones |
| `brutalist` | brutalist / industrial | concrete, rust, sodium, grey, hazard yellow | estates, plants, walls, silos; trucks, trams |
| `solarpunk` | solarpunk | solar yellow, leaf green, white, sky, terracotta | terraces, gardens, transit, turbines; bikes, trams |
| `desert-scifi` | desert colony | sand, burnt orange, bone, dusk blue | domes, condensers, walls, caravanserai; rovers, crawlers |
| `orbital` | orbital station | white, grey, blue, warm light, black | rings, modules, docks, corridors; shuttles, pods |
| `alien-bioluminescent` | alien biosphere | violet, teal, acid green, black, glow | organic towers, hives, membranes; living craft, drones |
| `post-apocalyptic` | post-apocalyptic | rust, ochre, ash, faded blue | ruins, scavenged walls, camps; buggies, trucks |
| `retro-futurist` | atompunk | cream, teal, chrome, red, mustard | towers, stations, suburbs, pylons; cars, rockets |
| `arctic` | ice world | blue-white, cyan, steel, dark | habitats, ice walls, drills, domes; snow crawlers, shuttles |
| `corporate` | corporate clean | white, glass blue, black, one accent | campuses, towers, plazas, transit; fleets, pods |
| `aquatic` | underwater | deep blue, teal, coral, pearl | domes, reefs, subsea tunnels, platforms; subs, drones |
| `megastructure` | megastructure | gold, black, white, orange, grey | shells, rings, towers, machines; trams, pods |
| `biopunk` | organic / biopunk | flesh, bone, green, amber, wet grey | grown towers, membranes, labs; living vehicles, drones |
| `space-western` | frontier | dust, rust, sun-bleached wood, blue | outposts, saloons, walls, docks; rovers, shuttles |

## Menu, not a fixed set

These lists are starting menus. Add, remove or merge genres as worlds demand,
but keep the family contract above: one palette, one structure grammar, one
fleet, one people/tree mix, one treatment preset set, and all three looks.

**Treatment presets.** The `real` family's retrofit vocabulary is the only
authored preset set today. Other families start from the generic grammar
(`mark`, `overlay`, `replacement`, `growth`, `state`, `extent`); add presets
with the family when its palette and structure grammar are authored.
