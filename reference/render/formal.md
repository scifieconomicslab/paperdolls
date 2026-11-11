# The formal look — IBM Carbon tokens, verified vs unverified

The `formal` look draws a scene as an IBM Carbon-style technical drawing:
flat fills, hairlines, neutral grounds, colour reserved for data. It is
look-agnostic across world families and structures: the snapping rules
below apply to any family's palette, and the `real` family's current formal
mapping is one instance. A family that needs a different Carbon mapping
documents it in its family pack. This file lists every Carbon token the
look uses and flags which ones were checked against Carbon documentation
and which were recalled from memory and remain **unverified**.

**Rule:** unverified values may be used for a mock; before any policy-facing
publication they must be checked at
https://carbondesignsystem.com/elements/color/tokens/ or replaced with
verified ones. When in doubt, drop the value and use a documented neighbour.

## Verified against Carbon documentation

| Token | Value used | Notes |
|---|---|---|
| blue 60 | `#0f62fe` | primary action accent |
| gray 10 | `#f4f4f4` | page background |
| gray 90 | `#262626` | ink |
| gray 100 | `#161616` | (unused) |
| white | `#ffffff` | pavements, paper |
| green 60 | `#198038` | foliage base |
| yellow 30 | `#f1c21b` | in-progress state (data) |
| blue 60 (states) | — | coop van / data accent |

## Written from memory — UNVERIFIED, check before policy use

| Token family | Values used | Used for |
|---|---|---|
| gray cool 10/20/40/70/90 | ramp `#f4f4f4 … #161616` family | backgrounds, roads, rails, kerbs |
| gray warm ramp | mixed into neutral walls | warm-region wall snapping |
| blue 20 | `#d0e2ff` | glass |
| blue 30 | `#a6c8ff` | accent swatch |
| blue 80 | `#002d9c` | solar panels |
| cyan 50 | `#1192e8` | queued state (data) |
| teal 50 | `#009d9a` | finished state (data) |
| green 60 (mixes) | foliage snappings | canopy neutrals |
| `grid: '#dcdcdc'` | not a Carbon token | faint ground grid; unverified value |

## Snapping rules (CIELAB nearest-token)

- **Walls:** `snapTo(mix(wall, toGray(wall), 0.5) mixed 28 % toward white,
  NEUTRAL_WALLS)` where `NEUTRAL_WALLS = gray 10..70 ∪ cool 10..70 ∪ warm
  10..70`.
- **Roofs:** `snapTo(mix(roof, toGray(roof), 0.85), NEUTRAL_ROOFS)` where
  `NEUTRAL_ROOFS = gray 60..90 ∪ cool 60..90 ∪ warm 60..90`.
- **Foliage:** canopy entries become `mix(green60, gray30|40|20, cr)` with
  `cr = 0.42 + 0.2 · foliage_lightness`.
- **Water:** `mix(gray20, blue60, 0.22)`.
- **Vehicles/people:** neutral grays 30–70 (cool/warm alternating); co-op van
  blue 60.
- **Bloom:** `mix(purple40, gray20, 0.3)` — only if the look has `bloom`.

Anything not listed here inherits the `colorfigures` value untouched —
there is no third source of truth.

## Provenance and licence

Values derived from IBM Carbon Design System (Apache-2.0) are fine to use
with attribution to IBM; "unverified" values here were recalled, not copied.
Keep the IBM attribution in `CREDITS.md` either way.
