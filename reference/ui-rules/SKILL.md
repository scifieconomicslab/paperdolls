---
name: ui-rules
description: Design patterns for paperdolls output pages. Use at Gate 7 before the user sees the page, or when the user says the page looks off. Applies to the isometric canvas, the right-sidebar controls, the output dashboard, the timeline, the legend and the impact view.
---

# paperdolls design patterns

Design patterns for a paperdolls output page. The blocking correctness checks
are in [`paperdolls-gates/SKILL.md`](paperdolls-gates/SKILL.md). Run them
first. This file is the craft pass after the gates pass.

---

## What good looks like

- **A clear idea.** You can say in one sentence what the page shows, for whom,
  and why it belongs to this model.
- **Legible data.** The scene, the main chart, the legend and the labels answer
  the page's question at a glance. Units, ranges and "no data" are visible.
- **Real material.** The world looks like a place, not a placeholder. Data is
  plausible, labelled and traceable to the model.
- **The model is the truth.** Appearance encodes only model-declared or
  user-declared state. The page is a model, not a forecast.
- **Two layers.** The policy view is the default: scene, outputs, timeline,
  controls, plain-language assumptions. The analyst layer exposes parity,
  provenance, model version, raw series, export and `?dev=1`. Both are the same
  run; they differ in what is surfaced.

---

## Direction from the world

Before touching the page, write five short lines. Derive them from the world
record plus the chosen world family, palette and look. Never from a trend.

- **Product.** One plain sentence: what the simulation shows, for whom.
- **Character.** Two or three concrete words. Not clean, modern, sleek,
  minimal or premium.
- **World.** The place and material the model lives in. Brick and tidal
  terraces, dry markets, harbour chain, terraced hill farming, a neon arcology.
  This sets the scene's palette and material.
- **Moments.** The data moments: the scene, the roof/top spectrum, the accepted
  structural readings, the main chart. Spend the detail there.
- **Signature.** One small detail used consistently — the step unit as a quiet
  stencil caption, the legend as a printed card, a status line in the analyst
  layer.

If the world paragraph is too thin to derive these, ask **one** question and
stop. If the product already has a real brand, keep it and build the direction
around it.

---

## The patterns

### 1. Spacing rhythm

**Rule.** Everything sits on a 4 px grid. Equal things get equal sizes. Space
groups: inside a group is smaller than between groups. Icons, labels and
numbers align in columns. Compact panels and the sidebar use ~16; cards 20–24;
page edges 24–32. Remove one-off values that break the rhythm.

**Check.** Measure the sidebar, the control rows, the stat rows and the
dashboard gaps. Equal rows share height and gap; nothing is nudged off the
line.

### 2. Type hierarchy

**Rule.** One type family, plus at most one partner (a mono for figures, a
display face for large titles). A small scale, weights 400–600, sentence case.
Hierarchy comes from size and colour, not weight. Tabular numbers, one number
format. No negative tracking on small text; no italic for emphasis.

**Check.** Scan the page at arm's length: the title, the section labels, the
numbers and the captions each read as one rank. No uppercase tracked labels.

### 3. Copy

**Rule.** Plain, specific words. Say what the model shows and what changed. No
exclamation marks, greeting headlines, hype words or unverified claims. Short
strings end without a period. Mock data looks plausible and is labelled.

**Check.** Read every label aloud. If it could belong to any dashboard, make it
specific to this world. If a claim cannot be checked, remove it or ask.

### 4. Icons

**Rule.** One line-icon set, one size and stroke, no emoji. Icons take their
text role's colour and sit in one column. Drop icons that add nothing.

**Check.** No emoji left in labels, buttons or section headers; icon boxes and
label gaps line up.

### 5. Layout

**Rule.** Keep app proportions: a 240–280 px right sidebar, fluid canvas, a
bottom output dashboard against the timeline, the legend bottom-left, the
impact view bottom-right. No dead empty bands. The policy view is the default;
the analyst layer is an explicit surface, not a second competing page.

The camera is an instrument: drag or `A`/`D` to pan, wheel or `W`/`S` to zoom,
`F` fit, `R` rotate. Give it visible zoom/fit/rotate affordances, a
`grab`/`grabbing` cursor, a focusable canvas, and a way back to fit. Do not
hijack the wheel outside the canvas.

**Check.** The first screen reads as a working tool, not a landing page. The
scene, controls, outputs, timeline, legend and impact view do not overlap or
push each other off-screen.

### 6. Charts and data

**Rule.** A chart exists to answer one question. Choose the mark and channel
by perceptual accuracy — position and length first, then angle, then area,
then colour — and choose the chart by the question:

| Question | Chart |
|---|---|
| Compare values | Bar chart, zero baseline |
| Change over time | Line chart |
| Distribution | Histogram or box plot |
| Relationship | Scatter plot |
| Part-to-whole | Stacked bar or treemap; a pie only up to five slices |
| Flow or connection | Network or Sankey |
| Hierarchy | Tree, sunburst or treemap |
| Place | Map |

- **One main chart.** Make it the largest data object. Secondary data is a
  smaller, different form — a ranked list, a short table — not a second chart
  of the same size.
- **Do not distort.** No 3D charts, no dual axes with unrelated scales, no
  truncated axes without a clear mark, no non-zero baseline for bars.
- **Colour is a late channel, not a first one.** Use position, length and
  labels first. When colour carries categories, cap them at 7–10, use a
  colourblind-safe set, and never rely on colour alone — add labels, shape or
  pattern. No rainbow/jet ramps for ordered data; use a perceptually uniform
  sequential or diverging scale.
- **Annotate the insight.** A title says what; a caption says the so-what;
  axes carry units and meaningful ticks; 1–3 callouts, not a wall of labels.
  Direct-label where possible.
- **Match the rendering to the data volume.** SVG under ~1,000 marks; Canvas
  for 1,000–10,000; WebGL above that. Aggregate or filter before animating.
  Never animate thousands of elements individually. Use established chart and
  layout libraries rather than hand-rolling graph layout.
- **Interaction follows the overview-first rule.** Show the whole, then let the
  user filter/zoom, then offer details on demand. Tooltips and brushing only
  where they answer a question.
- **The chart reads real declared data.** No placeholder noise, no invented
  series, no missing value drawn as zero. Provide a data table or text summary
  as the accessible fallback, with ARIA titles/descriptions for the chart.

**Check.** Remove the chart: does the page still answer the question? If not,
the chart is decoration. Check the zero baseline, the units, the colour-only
encoding, the legend/table fallback and the declared data source.

### 7. Details

**Rule.** Nested radii: inner = outer − padding, never below 4. Cards 12–16,
controls 8–10, panels 14–20; not everything is a pill. Quiet hairlines, real
hover and focus states, one signature detail. Use the Look's own channels
(tint, outline, halo, overlay, segments) before inventing a new decoration.

**Check.** Every corner adds up; every interactive element has a visible focus
ring; the signature detail appears once and consistently.

### 8. Motion

**Scope.** These rules govern the UI chrome (panels, controls, charts,
labels). Decorative life in the world (traffic, pedestrians, smoke, water,
wind) follows `skills/paperdolls-scene-craft/recipes/life.md`: it is
labelled, seeded, and off under `prefers-reduced-motion`.

**Rule.** Motion explains change. No looping pulses, breathing glows, shimmer,
floating elements or parallax. No `transition-all`, bouncy springs or hover
scaling. One easing curve and a few durations. Animate colour, opacity and
transform; never width, height, top or left. Respect `prefers-reduced-motion`.

**Check.** Freeze the page: nothing moves unless the model is playing or the
user is interacting. A number that changes tweens; a static label never
pulses.

### 9. Honesty and identity

**Rule.** No invented data, features, claims or populations. Decorative
people, vehicles, trees and placements are labelled. People are paper dolls:
one neutral tone, no skin, hair or identity encoding. Family palettes,
regional tables and structure grammars are proposals until checked. Missing
values are "no data", never zero.

**Check.** Every value on the page traces to the model, the map data, the world
record or a recorded user decision. The About/analyst layer says what is
assumed, decorative or proposed.

---

## Paperdolls-specific checks

Run these after the patterns:

- **Roof/top ramp.** One declared output variable drives the roofs/tops (as
  an accent in the beauty view, fully in the data lens). The legend swatches
  equal the drawn colours; "no data" is a distinct hatched state; no
  red↔green spectrum anywhere.
- **Structural modifications.** Each reading matches the binding's declared
  field, treatment, preset and scale. No pre-baked states; no treatment that
  implies a fact the model does not declare.
- **Impact view.** Draw it only from the user-confirmed causal graph. Edges
  match the binding. If no graph was confirmed, omit it.
- **Scenarios.** A two-run comparison matches the declared interventions and
  labels; no invented scenarios.
- **Units.** Every displayed quantity has a unit, range and label.
- **Policy/analyst split.** The policy view is the default; the analyst layer
  exposes parity, provenance, assumptions, model version, raw series, export
  and `?dev=1`.
- **Recorded trajectory.** If present, label it as a recording, not the live
  product.
- **Offline.** No network at view time; no fonts, CDNs or telemetry.
- **Accessibility.** Keyboard and focus, contrast, reduced motion and the
  gates' accessibility floor.

---

## Run it

1. **Look at the real page.** Open the built HTML in a browser. Judge what
   people see, not only the code.
2. **Run the gates first.** Any FAIL stops the line; fix and restart.
3. **Audit against the patterns.** List every miss with where it lives.
4. **Derive the direction.** Show it in the report.
5. **Fix in this order:** spacing → type → copy → icons → layout → charts and
   data → details → motion.
6. **Check the paperdolls-specific list** and re-run the gates.
7. **Report** the direction, what changed per pattern, what remains, and why.

Keep the run short: render at most three times. No story video, hero image or
landing-page work unless the user explicitly asks.

---

## Checklist

- [ ] The direction is written and every pattern follows it
- [ ] Spacing is on the 4 px scale; equal things are equal; columns align
- [ ] One type family plus at most one partner; weights 400–600; sentence case
- [ ] No emoji; one icon set, size and stroke
- [ ] Copy is plain, specific and free of unverified claims
- [ ] App proportions; no dead bands; policy view is the default
- [ ] One main chart, chosen for the question; zero baseline; units and
      meaningful ticks
- [ ] Colour is not the only encoding; categorical colours are capped and
      colourblind-safe; no rainbow ramps
- [ ] No 3D, dual unrelated axes, truncated axes or non-zero bar baselines
- [ ] A data table or text summary backs the chart; ARIA titles/descriptions
      are present
- [ ] Nested radii add up; focus states visible; one signature detail
- [ ] No looping or bouncy motion; reduced motion honoured
- [ ] The roof/top ramp, structural readings, impact view and scenarios match
      the binding and the confirmed decisions
- [ ] Units, labels, "no data", decorative/proposal labels and attribution are
      present
- [ ] No identity encoding; no invented data or claims
- [ ] The gates still PASS after the craft pass
