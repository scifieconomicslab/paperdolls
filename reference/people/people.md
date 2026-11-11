# People — Paper Dolls

In a paperdolls simulation—whether representing a contemporary city, a historical setting, a fantasy realm, or a sci-fi colony—people are rendered as **paper dolls**: flat, faceless, and universal. A crowd within the simulation never encodes specific ethnicity, religion, or economic class.

---

## 1. Core Rules (Hard Constraints)

* **Neutral Tone:** A single neutral paper tone is used for all skin and limbs—never skin tones and never multiple tones. (An automated test in the source repository enforces this globally).
* **Decorative by Default:** Individuals and crowds are visual elements unless explicitly tracked as dynamic agents by the underlying economic model.
* **No Walking Animation:** Sprites do not use traditional walk cycles. Movement is handled purely through positional translation across the grid while the sprite remains static.
* **Coherent Movement & Behavior:**
* **Network Adherence:** Pedestrians must follow sidewalks, paths, trails, or designated walking routes, while vehicles and riders adhere to roads or transit tracks.
* **Collision Avoidance:** Entities maintain clear separation and must avoid walking into or through building footprints or impassable terrain obstacles.
* **Contextual Simulation Patterns:** Movement and crowding behaviors adapt dynamically to the world build (e.g., foot traffic flowing between residential quarters and markets, or patrols near civic structures).

---

## 2. The Nine Kinds

| ID | Label | Composition | Mix Weight / Notes |
| --- | --- | --- | --- |
| `man` | Man | Single adult | Weight: 22 |
| `woman` | Woman | Single adult | Weight: 22 |
| `boy` | Boy | Single child | Weight: 5 ($0.64\times$ scale) |
| `girl` | Girl | Single child | Weight: 5 ($0.66\times$ scale) |
| `couple` | Couple | Man + woman (hands touching) | Weight: 10 |
| `parent_child` | Parent and Child | Woman + girl holding hands | Weight: 8 |
| `family` | Family of Four | Girl, man, woman, boy | Weight: 3 |
| `wheelchair` | Wheelchair User | Man seated on a chair doll | Weight: 2 |
| `cyclist` | Rider | Man on a two-wheeler | Ride-only (`cycle` network) |

*Children are rendered at $0.64\times$ to $0.66\times$ adult height. Hands act as the anchor points for paired configurations (`hands: {R: [0.0, 1.0]}`).*

The machine-readable form of this table is `reference/render/catalogue/data/people.json`.

---

## 3. Selection

Selection runs in this order. Stop and ask the user only where the world description cannot decide the answer.

1. **Tracked or decorative?** If the model declares a people breed, those agents are rendered and their count is the model's. Everyone else is decoration. Say which is which on the page.
2. **Read the place from the world paragraph.** A residential quarter, a market square, a school run, a business district and a port have different mixes and flows. Use the description the user wrote; do not infer culture or identity from place names.
3. **Start from `PEOPLE_MIX`.** Base weights: Man (22), Woman (22), Boy (5), Girl (5), Couple (10), Parent & Child (8), Family (3), Wheelchair (2). `cyclist` appears only where a valid `cycle` network exists.
4. **Adjust group composition by context, as a proposal.** School run: more `parent_child` and `family`. Market/civic square: more clusters (`couple`, `parent_child`). Business/industrial: mostly individual adults. State the adjustment in the world record and let the user overrule it.
5. **Apply the region's climate flags.** `coat`, `scarf`, `umbrella`, `hat` and `bag` are rolled from the region's `climate` (cold, sun, rain). They change clothing, never demographic presence.
6. **Confirm density.** Density follows the built fabric and the model's population; the page's people slider is the user's final control. Decorative density is an assumption and is labelled as one.
7. **Never invent demography.** The mix is constant across regions. Regional variation changes clothing and architecture, never who is present.

---

## 4. Density and Behaviour

Decorative people should read as a living place without inventing a single economic fact.

* **Network.** People use the pavement graph built from road centrelines: offset pavements, clipped to building clearance and connected at intersections. They turn at nodes instead of bouncing along one road. Cyclists use the cycle network only. Nobody walks through a building footprint, a parcel or water.
* **Depth.** People are mounted in the renderer's depth bands, so a building in front hides a person behind it. A person on a pavement never draws through a nearer roof.
* **Translation, not animation.** A person moves by positional translation; the sprite stays static. Paired kinds (`couple`, `parent_child`, `family`) move as one unit.
* **Separation.** Keep a clear gap between people and between people and vehicles; avoid overlapping sprites at rest.
* **Contextual flow.** Foot traffic moves between residential quarters and markets, along shopping streets, and around civic buildings. Patrols and queues are proposals drawn from the world description, not invented facts.
* **Time of day.** Where the model has a clock, density and grouping can follow it (school run in the morning, market at midday, quiet at night). Where it does not, choose one plausible pattern and label it.
* **Decorative is not statues.** People move, avoid obstacles and gather; the page's About panel says the movement is decorative when the model does not track people.
* **No identity.** No skin tones, hair variation, faces, religious markers, uniforms implying ethnicity, or wealth coding. Garment colour is the `data` role and may show a declared variable; nothing else is personal.

---

## 5. Other World Types

The nine kinds are a contemporary default, not a universal anthropology. Historical, fantasy and science-fiction worlds add **kind presets**, not new rules:

* Keep the hard constraints: one neutral paper tone, faceless paper dolls, garment as the only `data` surface, no identity encoding.
* New silhouettes are allowed (a cloaked figure, a robed official, a maintenance worker, a robot or post-human) as long as they do not encode ethnicity, religion or class. Add the preset to `reference/render/catalogue/data/people.json` and the grammar in `catalogue/lib/assetlib.js`.
* A new world family may change clothing, props and group composition; it may not change `PEOPLE_MIX`'s role as a proposal or the "decorative unless tracked" rule.
* Every new kind must render in all three looks from the same role vocabulary (`paper`, `garment`, `data`). If it only works in one look, it is not a catalogue entry.
* Ask the user which world-specific roles matter (guards, pilgrims, workers, children) before adding them; do not populate a fantasy city with contemporary commuters by default.

---

## Sources

`viz/assetlib.js` @ `f9a1a59` (CC BY 4.0), transcribed: `DEFS.people`, `PEOPLE_MIX`, `makeOutfit`, `personColours`, `peopleDef`. Canonical copy: `reference/render/catalogue/lib/assetlib.js`; selection data: `reference/render/catalogue/data/people.json`.
