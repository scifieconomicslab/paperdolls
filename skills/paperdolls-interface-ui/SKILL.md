---
name: paperdolls-interface-ui
description: How to build the paperdolls page interface with Mantine — the shell layout, the policy/analyst split, the controls sidebar, bottom dock (timeline, legend, outputs, impact), analyst drawer, and the polish rules that keep it refined and consistent.
---

# The interface (Mantine)

Load at Gate 7. Use **Mantine** (`@mantine/core`, `@mantine/hooks`) and
`@tabler/icons-react`. Use system fonts — never web fonts (offline rule).

## 1. Layout

```text
┌──────────────────────────────────────────────┬───────────────┐
│  canvas (fluid, keyboard + pointer)          │ right sidebar │
│  camera overlay: fit / rotate                │ 240–280 px    │
│                                              │ controls      │
│                                              │ scenarios     │
│                                              │ attribution   │
├──────────────────────────────────────────────┴───────────────┤
│  bottom dock: timeline · legend · outputs · impact          │
└──────────────────────────────────────────────────────────────┘
```

- The bottom dock is full width and owns the timeline, legend, declared outputs
  and the confirmed impact view. Nothing overlays the canvas.
- The sidebar carries only interactive controls, scenarios and attribution.
- One signature detail, used consistently (e.g. the step unit as a quiet
  caption).

## 2. Two layers

- **Policy view (default):** place, outputs, timeline, controls, plain-language
  assumptions, attribution. It says it is a model, not a forecast.
- **Analyst layer (`Drawer`):** parity, provenance, assumptions, model version,
  raw series, data export, recording, `?dev=1` frame check.
- Same run, different surfaces. Never show two competing pages.

## 3. Components and their data

| component | data |
|---|---|
| `Dashboard` | `Description`, params, interactive toggles, seed, restart, scenarios |
| `Timeline` | tick, horizon, unit label, play/speed/seek |
| `Legend` | look scales, top-colour ramp, treatment labels, "no data" swatch |
| `MainChart` | the one declared series that best tells the model's story (usually the top-colour variable's share or mean over time), the largest data object on the page; a second run as a dashed line when comparing (`reference/ui-rules` §6) |
| `Outputs` | the other declared series (Gate 1 selection), sparkline + latest value, missing state |
| `Impact` | the confirmed causal graph only; omit when unconfirmed |
| `Analyst` | description, params, frame, dev errors, export, recording |
| `CameraOverlay` | fit, rotate; tooltips and aria labels |

Every displayed quantity carries a unit, range and label. Charts read declared
data; no placeholder noise; no missing value drawn as zero. Provide a table or
text fallback and ARIA titles/descriptions.

## 4. Polish contract (enforced)

- **Spacing:** 4 px grid. Inside a group < between groups. Sidebar ~16, cards
  20–24, page edges 24–32.
- **Type:** one family (system-ui) plus a mono for figures (`ui-monospace`).
  Weights 400–600, sentence case, tabular numbers. Hierarchy by size and colour,
  not weight.
- **Copy:** plain and specific. No hype, greetings, exclamation marks or
  unverified claims. Short strings end without a period.
- **Icons:** one line set (`@tabler/icons-react`), one size/stroke, no emoji.
- **Details:** nested radii (inner = outer − padding, ≥ 4). Quiet hairlines,
  real hover and focus states.
- **Motion:** explain change only. No loops, shimmer, parallax or bouncy
  springs. Honour `prefers-reduced-motion`. Animate colour, opacity, transform —
  never width/height/top/left.
- **Accessibility:** visible focus ring, full keyboard operation, contrast
  ≥ 4.5:1.
- **Honesty:** decorative people/vehicles/trees and proposals are labelled;
  attribution present.

The full pass is `reference/ui-rules/SKILL.md`; the blocking gates are
`reference/ui-rules/paperdolls-gates/SKILL.md`. Run the gates first.

## 5. Camera controls

The full controls spec (including easing and the data-lens key `L`) is in
`skills/paperdolls-scene-craft/recipes/camera.md`; it wins on conflict.
The canvas is an instrument. Provide:

- drag to pan, wheel to zoom (anchored at the cursor), `A`/`D` to pan and
  `W`/`S` to zoom; `F` fit and `R` rotate;
- visible zoom-in, zoom-out, fit and rotate buttons with tooltips and aria
  labels; a `grab`/`grabbing` cursor; a focusable canvas;
- a shortcut list in the About drawer, and no page scroll while the pointer is
  over the canvas;
- keyboard handling that ignores inputs and Ctrl/Meta/Alt, and a way back to
  fit so the map can never be lost.

## 6. Theme

Build one Mantine theme from the art bible's palette table (background, surface, text, line,
accent, data colours, "no data"). Do not hard-code colours in components. The
same theme drives the canvas chrome and the panels, so the page reads as one
object in every look.

## 7. Reference shell

`reference/shell.tsx` and `reference/theme.ts` (in this skill's folder) are a
worked Mantine shell to copy and adapt. There is no panel library: write each
panel from the §3 table, and keep its data contracts. A world may add or drop
panels.

## 8. Before the user sees it

1. Run the blocking gates; any FAIL stops the line.
2. Derive the direction in five lines (product, character, world, moments,
   signature) from the world record and the chosen look.
3. Run the craft pass in order: spacing → type → copy → icons → layout → charts
   → details → motion.
4. Check the paperdolls-specific list: top ramp, treatments, impact, scenarios,
   units, policy/analyst split, recording, offline, accessibility.
5. Report the direction, what changed, what remains.
