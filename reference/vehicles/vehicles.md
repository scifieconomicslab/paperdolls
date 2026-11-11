# Vehicles — classes, fleets, selection and behaviour

Vehicles are decoration by default.
Everything in this folder is a proposal to be checked with local
authors — and fleet shares should be looked up with a source and a date,
never filled from memory. If unsure, omit the table entry and tell the
user.

## 1. The 19 classes

| class | label | network |
|---|---|---|
| `bicycle` | Bicycle | cycle |
| `cargo_bike` | Cargo bike | cycle |
| `moped` | Moped / scooter | road |
| `motorbike` | Motorbike | road |
| `three_wheeler` | Three-wheeler taxi (tuk-tuk) | road |
| `utility_three_wheeler` | Three-wheeler utility | road |
| `city_car` | City car | road |
| `hatchback` | Hatchback | road |
| `sedan` | Saloon | road |
| `suv` | SUV | road |
| `pickup` | Pickup | road |
| `van` | Delivery van | road |
| `van_coop` | Co-op van | road |
| `kei_van` | Small box van | road |
| `minibus` | Minibus (shared taxi) | road |
| `bus` | Bus | road |
| `double_decker` | Double-decker bus | road (UK only in fleets) |
| `tram` | Tram | rail |
| `lorry` | Lorry | road |

The machine-readable form of this table is
`reference/render/catalogue/data/vehicles.json`.

## 2. Networks and placement

`cycle` network = follow cycle tracks · `rail` = follows tramway alignment
· everything else uses the road network's drivable classes (`avenue`,
`local`, `pedestrian` excluded for cars; `tramway` and `cycle` excluded as
building fronts — and for driving, trams use rails only).

Vehicles are placed on their class's network and nowhere else. A vehicle
whose network is absent from the scene is not drawn; if the world
description calls for it, say the network is missing rather than putting a
tram on a road.

## 3. Regional fleet tables (proposals — verify with a source and a date)

| region | drive | fleet (class, share) |
|---|---|---|
| `nw` | right | bicycle 20 · cargo_bike 8 · city_car 22 · hatchback 18 · van 7 · bus 4 · tram 3 · moped 3 |
| `uk` | left | city_car 22 · hatchback 24 · sedan 8 · van 10 · double_decker 6 · bicycle 8 · suv 6 |
| `ws` | right | moped 18 · city_car 24 · hatchback 18 · bus 5 · tram 3 · bicycle 8 · van 6 |
| `md` | right | moped 24 · utility_three_wheeler 8 · city_car 26 · hatchback 12 · bus 4 · bicycle 3 · van 6 |
| `ce` | right | city_car 24 · hatchback 22 · sedan 10 · tram 6 · bus 5 · bicycle 5 · van 7 |
| `sa` | left | three_wheeler 22 · motorbike 24 · city_car 14 · minibus 8 · bus 6 · bicycle 8 · van 6 |
| `se` | **ask** | motorbike 34 · three_wheeler 10 · pickup 8 · minibus 8 · city_car 12 · bicycle 4 · bus 4 |
| `ea` | **ask** | kei_van 12 · city_car 22 · hatchback 12 · bicycle 16 · moped 10 · bus 5 · van 6 |
| `me` | right | sedan 26 · city_car 14 · pickup 14 · minibus 12 · bus 6 · suv 8 · van 6 |
| `sb` | **ask** | minibus 24 · motorbike 20 · pickup 8 · lorry 6 · three_wheeler 8 · bus 5 · city_car 10 |
| `la` | right | minibus 12 · city_car 24 · hatchback 14 · motorbike 14 · pickup 8 · bus 8 · bicycle 4 |
| `na` | right | pickup 18 · suv 20 · sedan 20 · van 8 · bus 3 · bicycle 4 · city_car 6 |

`ask` means the intake **must** ask the user for the drive side — in
Southeast Asia, East Asia and Sub-Saharan Africa countries differ, and the
region default is not safe. Never assume it.

## 4. Selection

Selection runs in this order. Ask only where the world description cannot
decide.

1. **Tracked or decorative?** If the model declares a vehicle breed, those
   agents are rendered and their movement is the model's. Everyone else is
   decoration. Say which is which on the page.
2. **Read the world.** A fishing port, a university quarter, a logistics
   zone, a historic centre and a car-dependent suburb have different fleets.
   Name the classes the description implies before choosing shares.
3. **Filter by network.** Drop `tram` unless the extract contains tram
   infrastructure or the user asks; drop `cycle` classes unless a cycle
   network exists; drop road classes whose network is absent.
4. **Start from the region table.** Use the region named in the world
   description. If the description names no region, use the nearest family
   and mark it `fleet: <region> default (proposed)`.
5. **Confirm the drive side.** For `ask` regions, ask. Never infer it from a
   country name.
6. **Let the user prune.** If unsure, draw fewer classes and label the fleet
   as proposed. The page shows the fleet table in its About panel — never
   hide it.
7. **Verify when accuracy matters.** Look up fleet shares with a source and
   a date; otherwise keep the proposal label.

## 5. Behaviour

Decorative traffic should read as a working street without inventing a
single economic fact.

* **Network adherence.** Vehicles follow the directed lane graph built from
  the drivable road network; bikes on cycle-capable edges; trams only on
  tram/rail edges. They turn at intersections and never cross buildings,
  parcels, pavements or water.
* **Drive side.** Left or right per the region's `drive` value (or the
  user's answer). Forward and reverse lane edges both offset to the correct
  side of the carriageway.
* **Depth.** Vehicles are mounted in the renderer's depth bands, so a building
  in front hides a vehicle behind it; they do not draw over nearer roofs.
* **Flow.** Keep a clear separation from the vehicle ahead and from people;
  avoid overlapping sprites. Class-specific speeds are proposals — buses
  and lorries slower, bikes and cars quicker — not measured facts.
* **Rail rhythm.** Trams run on the tramway alignment and stop at stops
  only if the scene or model declares stops; otherwise they pass through.
* **Parking and dwell.** Parked cars, loading vans and stopped buses are
  decoration and may be placed off the travel lane. They are not counted as
  moving agents.
* **Tracked vehicles override decoration.** If the model tracks a vehicle,
  its position and count come from the frame; decoration must not duplicate
  it.
* **No identity or status coding.** Livery is the `data` role. Tints never
  encode wealth, ownership, ethnicity or religion; co-op and tram colours
  are the declared exceptions.

## 6. Other World Types

The nineteen classes are a contemporary default. Historical, fantasy and
science-fiction worlds add **class presets**, not new rules:

* Keep the network vocabulary (`road`, `cycle`, `rail`, `pavement`). A
  horse-drawn cart, a caravan, a steam bus, a transit pod or a cargo drone
  is a road or rail class.
* Keep the material roles (`data`, `glass`, `trim`, `roof`, `wheel`,
  `light`). A new class is a part list in
  `reference/render/catalogue/lib/assetlib.js` plus a row in
  `data/vehicles.json`.
* Reuse the selection rules: tracked or decorative, network, fleet, drive
  side, user confirmation. A fantasy world may have no cars and many
  carts; a sci-fi colony may have pods and no trams.
* Every new class must render in all three looks from the same roles. If
  it only works in one look, it is not a catalogue entry.
* Do not port contemporary fleets into a non-contemporary world by default.
  Ask which vehicles the world actually has.

## 7. Climate outfit flags (not vehicle-specific, but they belong to the scene)

Outfits are rolled per person from `climate = {cold, sun, rain}`. For a
vehicle-heavy scene, the same climate flags decide coats/umbrellas on the
people nearby — a rainy `sa` scene shows umbrellas; a cold `ce` scene shows
coats and scarves.

## 8. Colours

- `data` role = the livery; `reg.vehicles` palette in `colorfigures`,
  neutral grays (30–70) in `formal` (co-op van stays blue 60).
- `vehicleTint` and `vehicleColours` mix the family palette with greys;
  tints are never identity- or status-coded.
- Double-decker livery is regional (UK heritage greens/creams for `uk`)
  but still from the palette, never invented per-instance.

## Sources

`viz/assetlib.js` @ `f9a1a59` (CC BY 4.0), transcribed: `DEFS.vehicles`,
`REGIONS`, `vehicleTint`, `vehicleColours`. Canonical copy:
`reference/render/catalogue/lib/assetlib.js`; selection data:
`reference/render/catalogue/data/vehicles.json`.
