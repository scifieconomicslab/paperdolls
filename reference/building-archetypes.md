
# OSM Building Archetypes for Economic Simulation

Research into which OpenStreetMap `building=*` types are most useful for economic simulations of incentives, and for explaining how economies function in a visual, public-facing manner (the "paperdolls" style).

**Scope:** this is the `real` world family's economic-class vocabulary for OSM-derived places. Other world families define their own structure kinds/classes; this taxonomy and the cascade below are normative for the `real` family only.

Data: [taginfo.openstreetmap.org](https://taginfo.openstreetmap.org/keys), global worldwide tag counts.

However, we must process OSM data carefully.

---

## 1. OSM has data classification issues

* `building=*` has **thousands of distinct values** (the wider figure includes tag combinations and sibling keys such as `building:use=*`).
* The distribution is extremely steep. The top ~40 values cover the vast majority of all tagged buildings globally. The remaining values form a long tail of regional dialects, spelling variants (e.g., `residental`, `dwelling_house`), and one-off noise.

### The `building=yes` problem

**A significant majority of world buildings are tagged only `building=yes**`—making them economically opaque. Any real-world pipeline needs an inference cascade:

```
building=<specific type>
  → shop=* / amenity=* / office=* / man_made=*
    → building:use=*
      → landuse=* (farmyard, residential, industrial, commercial ...)
        → procedural fallback: assign a plausible archetype from local mix ratios

```

Note that `building:use=*` rarely resolves the ambiguity on its own, as most tagged instances default back to generic residential labels. **Procedurally generating a plausible mix of archetypes is more robust than hoping OSM tells you everything.** For public-facing work, a generated district whose mix is statistically honest still beats an unmapped void.

---

## 2. Selection criteria

1. **Economic legibility** — the type must map cleanly to a commodity, flow, or ownership class (rent, labor, goods, tax).
2. **Incentive demonstrability** — it must be a substrate where a policy knob visibly moves something measurable (housing supply, development, disinvestment).
3. **Visual distinctiveness** — for the paperdoll style, its silhouette must be instantly readable in a legend.
4. **OSM coverage** — archetypes should exist densely in real data, so public-facing renders connect to real places.

---

## 3. The recommended archetype set

### 3.1 Housing

Rent, mortgages, affordability, density, zoning. The best substrate in all of economics: incentives are visible and well understood.

| OSM value | Economic read | Incentive it demonstrates |
| --- | --- | --- |
| `house` | Single-household dwelling | Affordability, first-buyer schemes |
| `residential` | General housing stock | Upzoning, densification |
| `detached` | Low-density single family | Sprawl vs density |
| `apartments` | Multi-tenant rental stock | Rent control, landlord returns |
| `semidetached_house` | Shared-wall housing | Housing-ladder segmentation |
| `terrace` | Row housing | Walkable district mixing |
| `bungalow` | Single-storey house | Aging-owner subdivisions |
| `hut` | Small crude shelter | Informal settlement economics |
| `static_caravan` | Semi-permanent mobile home | Precarious / informal housing |
| `cabin` | Rural secondary dwelling | Second homes, leisure property |

### 3.2 Production & agriculture

Labor, capital, and the start of supply chains.

| OSM value | Economic read | Incentive it demonstrates |
| --- | --- | --- |
| `industrial` | Manufacturing building | Labor, capital, industrial policy |
| `manufacture` | Light manufacturing | Catalogue of production types |
| `factory` | Explicit factory | Production-line storytelling |
| `farm` | Farmhouse | Subsistence vs commercial agriculture |
| `farm_auxiliary` | Non-dwelling farm building | Agri supply chain |
| `barn` | Storage / covered workplace | Harvest logistics |
| `greenhouse` | Controlled growing | Thermal efficiency, vertical farming |
| `silo` | Bulk grain storage | Buffer stocks, commodity cycles |
| `stable` | Horse housing | Niche luxury demand |
| `cowshed` | Livestock | Animal-capital economics |

### 3.3 Trade & services

Margins, competition, market density, the tertiary sector.

| OSM value | Economic read | Incentive it demonstrates |
| --- | --- | --- |
| `retail` | Goods-to-public building | Market density, competition |
| `warehouse` | Goods storage | Logistics, inventory, e-commerce |
| `kiosk` | Street-facing micro shop | Micro-entrepreneurship |
| `supermarket` | Large-form grocery | Food deserts, market power |
| `office` | Tertiary services | CBD economics, work-from-home |
| `garage` | Private storage | Asset hoarding, parking wars |
| `commercial;residential` | Mixed-use building | Agglomeration, mixed-use zones |

### 3.4 Public sector

Where taxes, state budgets and public incentives land.

| OSM value | Economic read | Incentive it demonstrates |
| --- | --- | --- |
| `school` | Education building | Human capital investment |
| `kindergarten` | Early education | Childcare burden / fertility |
| `university` | Higher education | Long-run human capital |
| `hospital` | Healthcare | Public health spending |
| `clinic` | Local healthcare | Primary care density |
| `government` | Admin offices | Taxation, public wage bill |
| `fire_station` | Emergency services | Public goods provision |
| `civic` | Community amenity | Local vertex services |

### 3.5 Energy & sci-fi infrastructure

Where speculative resource economics can layer onto real OSM shapes (vertical farms, bioreactors, grid credits) — the ScifiEconomicsLab tier.

| OSM value | Economic read | Incentive it demonstrates |
| --- | --- | --- |
| `storage_tank` | Bulk tank | Energy reserves, strategic stockpiles |
| `digester` | Bioreactor | Circular / bio-economy |
| `transformer_tower` | Power step-down | Grid economics, transmission |
| `service` | Small machinery building | Invisible infrastructure costs |
| `greenhouse` (reuse) | Vertical-farm proxy | Sci-fi food systems |

### 3.6 Economic states

The *state machine* nodes — buildings that visibly show boom and bust.

| OSM value | Economic read | Incentive it demonstrates |
| --- | --- | --- |
| `construction` | Building-in-progress | Investment, development cycles |
| `ruins` | Derelict structure | Disinvestment, rust belts |
| `allotment_house` | Garden outbuilding | Pocket self-provision |

---

## 4. What should be excluded

* **`building=yes`** — worth no archetype, but drives the entire fallback cascade (§1).
* **Storage clutter** — `shed`, `garages`, `outbuilding`, `carport`. Property accessories, not economic agents; render as generic outbuildings with no distinct behavior.
* **Cultural long tail** — `ger`, `trullo`, `hayrack`, `wayside_shrine`, `stilt_house`, `beach_hut`. Wonderful *flavor* types (informal economies, tourism, regional identity) but region-specific. Keep in a decorative tier with no simulation behavior so the public narrative stays universal.
* **Lifecycle rejection keys** — `abandoned`, `collapsed`, `damaged`, `proposed`, `no`. States, not archetypes; fold into `construction` / `ruins` behaviors.


