# Asset pipeline: image-model art for paperdolls asset packs

Status: process proposal, 2026-11-07, part of the rework (paperdolls#23); it is the inside of the `art` module ([rework plan](2026-11-07-paperdolls-rework.md), section 3.3). The runtime renderer is PixiJS v8. Control renders are made offline by the art tool with three.js in headless Chromium, which gives colour, depth, role and id passes at any angle. It is written so that an LLM agent can follow it step by step. A developer supplies an image-model API. Every number marked *(initial)* is a starting value to be fixed after the Phase 0 graphics work, and the asset-pack format (section 9) is fixed then too.

The target look is the one in Yadong Xie's [How Pixel Singapore was made](https://www.yadongxie.com/blog/how-pixel-singapore-was-made): an image model redraws exact geometry renders as detailed isometric pixel art. Two lessons carry over directly:

- The model is **conditioned on a render**, not asked to invent geometry. Pixel Singapore rendered Google 3D Tiles through one orthographic camera and gave the image model a one-line prompt ("Redraw this aerial view as detailed isometric pixel art.") plus a style LoRA. Geometry comes from data. The model only supplies style.
- **What moves is not painted by the model.** Pixel Singapore's cars are box-built 3D models rendered at 32 headings and turned into sprites. Their occlusion comes from a height pass rendered alongside the map. Image models are poor at a small object that must stay identical across headings and animation frames.

paperdolls differs from Pixel Singapore in one way that shapes everything below: **the picture must change with the model.** A building's state changes its colour, adds scaffolding, insulates it. Painted pixels therefore have to stay recolourable and addressable per entity, which is what the masks, data ramps and gates are for.

---

## 0. Two products

| Product | What it is | When to use it |
|---|---|---|
| **A. Sprite kit** (invented worlds) | One painted sprite per (archetype, variant, heading), with role masks, plus overlay sprites (scaffold, solar, insulation, flags, banners). States are made at runtime by palette swap and overlays, **never by generating a sprite per state**. | Invented worlds (grid, hex, graph, procedural), any model whose geometry changes (buildings built, destroyed, upgraded), and the overlays used on painted maps. |
| **B. Painted base map** (real places) | A Pixel Singapore-style painting of a whole real place, with an aligned entity-id pass and height pass. State is shown by id-masked tints and overlay sprites. | Real places where the model never changes geometry (the Great Retrofit on Jette). A painted ground layer under a sprite kit is also allowed. |

Agents (people, vehicles, carts, ships) are **always** rendered from part lists by the engine (section 11), optionally polished by the model at large size and then reduced. They are never generated per frame or per heading by the image model.

---

## 1. Rules for the agent running this process

1. Follow the steps in order. Each step has inputs, a command, outputs, a gate and a failure rule. Do not start a step whose inputs are missing.
2. **Never change a gate threshold, the art bible, or the prompt template.** If a gate cannot be met, stop and report to the human with the evidence. Thresholds and bible changes are human decisions, recorded in `art/decisions.md` with a date and a name.
3. **Never hand-edit a pixel** in a generated sprite. A fix is either a regeneration (new seed or a recorded prompt delta from the allowed list in the bible) or a deterministic post-process script that is committed.
4. Regenerate a failed item at most **3 times** *(initial)*, then mark it `escalated` and move on. Never loop.
5. Stay inside the **budget** in `art/job.yaml` (images and money). Before each batch, write the projected spend to the job log. Stop when the next batch would exceed the budget.
6. The API key lives only in the environment variable named in `art/api.yaml`. Never write it to a file, a log, a manifest, a prompt or a commit.
7. Record provenance for every image the API returns, kept or not (section 8).
8. Stop for a human at the points marked **HUMAN** and do nothing that depends on their answer until they reply.

---

## 2. Inputs the developer supplies

`art/api.yaml` (committed, no secrets):

```yaml
endpoint: https://...            # the image API base URL
model: <model id>                # exact model id and version
key_env: PAPERDOLLS_IMAGE_KEY    # name of the env var holding the key
licence: <terms URL>             # the output licence; checked by a human before any pack ships
cost_per_image: 0.04             # currency units, for the budget
```

`art/job.yaml`: pack id, which archetypes and variants to make, `budget: {images: 2000, money: 80}`, and the target engine scale.

---

## 3. Step 1: probe the API (no art yet)

**Command:** `paperdolls art probe`. It sends a fixed test set: a 1024 px control render of a cube house, a mask, and a reference image.

**Output:** `art/capabilities.yaml`, recording each capability as `yes`, `no` or `degraded`, with the evidence image path:

| Capability | Test | Why it matters |
|---|---|---|
| `img2img` with a strength setting | output keeps the cube's silhouette (IoU ≥ 0.9 against the control) | Without it, geometry is not preserved and **product A cannot run**: stop. |
| `structure_control` (depth, edge or normal conditioning) | silhouette IoU ≥ 0.95 at a high style strength | Lets style strength go up without geometry drift. |
| `mask_inpaint` | pixels outside the mask unchanged (mean ΔE < 1) | Needed for product B seams and for repairing a region. |
| `style_reference` (one or more reference images) | style metric (section 6, gate G4) closer to the reference than without it | Keeps a pack consistent without a LoRA. |
| `seed` | the same request twice gives the same image | If not, provenance is the only way to reproduce a sprite: keep every kept output. |
| `transparent_output` | alpha channel present | If not, alpha comes from the control silhouette (step 5). |
| `max_size`, `aspect_ratios` | the largest accepted size | Sets the tile size for product B and the sprite canvas size. |
| `lora` or `fine_tune` | the API accepts a LoRA or style id | The best consistency. Pixel Singapore used a style LoRA. |
| `sampler_access` | the API exposes latents or a custom sampler | Needed for the MultiDiffusion and RePaint method of product B (section 10). With an API alone this is almost always `no`. |

**Gate:** `img2img` is `yes`. Otherwise stop and report: this API cannot be used for this process.

---

## 4. Step 2: the art bible (**HUMAN** approval)

`art/bible.yaml` is one per pack and fixes everything that must be identical across the pack:

```yaml
style: "detailed isometric pixel art, warm hand-inked palette, ..."   # one line, goes into every prompt
prompt_template: "Redraw this isometric {noun} as {style}. Keep the exact shape, edges and position."
allowed_prompt_deltas: ["fewer windows", "darker roof", "less clutter"]   # the only edits a regeneration may add
negative: ["text", "watermark", "people", "ground", "background", "perspective", "cast shadow beyond footprint"]
projection: {azimuth_deg: 45, elevation_deg: 30}       # must equal the engine's camera
light: {from: "top-left", baked_shadow: contact_only}  # contact shadows only; the engine draws cast shadows
pixel: {px_per_m: 4, outline: "1px dark, outer silhouette only"}   # (initial)
palette: art/palette.gpl          # indexed palette, at most 64 colours (initial)
data_ramps:                       # palette ramps reserved for the data surface; the runtime swaps them
  - {role: data, steps: 4}        # 4 shades from light to dark, swapped for the state colour's ramp
  - {role: data2, steps: 3}       # optional second data surface (e.g. roof) 
references: [art/refs/ref1.png, art/refs/ref2.png, art/refs/ref3.png]   # 3 to 5 approved sprites, the style anchor
```

**Bootstrapping the references:** generate 4 candidates each for 3 representative archetypes (steps 3 to 6 with `references: []`). The human picks the references, or rejects all of them and edits `style`. Repeat until approved. This is the only step where style is explored; after it, style is fixed.

**Gate:** the human has approved the bible in `art/decisions.md`.

---

## 5. Step 3: control renders (deterministic, no image model)

**Command:** `paperdolls art control <archetype> --variants N --headings 4`. The art tool renders each asset from its kit part list (`box`, `prism`, `roof`, ...) with the bible's projection, at **4× the target resolution** *(initial)* on a canvas with a margin.

**Outputs per (archetype, variant, heading):**

| Pass | Content |
|---|---|
| `colour.png` | flat role colours, tone banded by face orientation (today's colorfigures render) |
| `alpha.png` | exact silhouette |
| `roles.png` | one index per role: `data`, `data2`, `roof`, `glass`, `trim`, `frame`, ... |
| `depth.png` | height above ground per pixel, 16-bit |
| `anchor.json` | ground anchor pixel, footprint polygon in pixels, overlay attach points (roof centre, facade centre) |

**Gate G0:** every pass exists, the silhouette is non-empty, the anchor lies inside the footprint, and all four headings exist.

---

## 6. Step 4: generate

For each control render, send `colour.png` (and `depth.png` when `structure_control` is `yes`), the references, the prompt filled from the template (`{noun}` from the archetype's `noun` field), the negatives, a recorded seed, and **4 candidates** *(initial)*. Style strength starts at the bible's value.

**Order:** one heading of every archetype first. Then gate. Then the other three headings, sending the **accepted first heading as an extra reference**. That is what keeps a building looking like the same building from every side.

## 7. Step 5: post-process (deterministic, committed scripts)

For every candidate:

1. **Register** to the control canvas: same size, with a sub-pixel shift found by cross-correlation of edges. A shift over 4 px *(initial)* fails gate G1.
2. **Alpha** = model alpha (if any) ∩ control silhouette dilated by 1 px. Pixels outside are dropped, so the model cannot add ground, people or background.
3. **Reduce** to target resolution by a mode filter (the most common colour per 4×4 block), not by smoothing, so pixels stay crisp.
4. **Quantise** to the bible palette (nearest in CIELAB).
5. **Data surfaces:** inside the control's `data` role mask, map each pixel's luminance to a step of the `data` ramp. The runtime later swaps the ramp for the state colour's ramp (a palette-swap shader in Pixi). This is how a painted wall can turn "retrofitted green" without being regenerated, while keeping its painted texture.
6. **Outline** per the bible (outer silhouette only).
7. Write `sprite.png` (indexed) and `sprite.roles.png` (the control's role mask, aligned).

## 8. Step 6: automatic gates

All are scripts with recorded scores in `art/report/<asset>.json`. A candidate passes only if every gate passes.

| Gate | Test | Threshold *(initial)* |
|---|---|---|
| G1 registration | shift found in step 5.1 | ≤ 4 px at 4× |
| G2 silhouette | IoU of the model's non-background pixels with the control silhouette | ≥ 0.95 |
| G3 roles | share of the control's `data` mask that the model kept as a surface (not covered by invented clutter) | ≥ 0.90 |
| G4 style | mean ΔE from each pixel to its nearest palette colour *before* quantisation (a model that drifted off-style needs large corrections) | ≤ 8 |
| G5 headings | colour-histogram distance between the four headings of one asset, on non-data pixels | ≤ 0.15 |
| G6 neighbours | the same distance against the pack's references | ≤ 0.25 |
| G7 forbidden | no text (OCR finds nothing), no human figures, nothing below the ground line | none found |
| G8 ground | the bottom silhouette pixels lie on the footprint outline | ≥ 0.9 |
| G9 tiles (terrain only) | edge pixels of a tile match its own opposite edge (tileable) | mean ΔE ≤ 3 |

**Selection:** of the passing candidates, keep the one with the best G4 + G6. If none pass, regenerate (rule 4: new seed first, then one allowed prompt delta, then lower style strength by 0.1), at most 3 times.

## 9. Step 7: contact sheet (**HUMAN** review)

**Command:** `paperdolls art sheet`. One HTML page shows:

- every asset × heading at 1× and 4×;
- each asset in three runtime states (palette-swapped: default, a data colour, a second data colour) with its overlays;
- a street of mixed assets on ground at the engine's real zoom levels (fit, mid, street);
- every escalated item, with its candidates and gate scores.

The human marks each row `approve` or `reject: <reason>`. A rejected row goes back to step 4 with the reason recorded as a prompt delta, but only if the delta is on the bible's allowed list. Otherwise it goes to the bible (a human decision).

**Gate:** every row is approved, or deliberately left out of the pack.

## 10. Step 8: build the pack

**Command:** `paperdolls assets build`. It packs the approved sprites into atlases (free-tex-packer, power-of-two pages, 1 px extrusion), and writes:

- `assets.yaml`: the pack manifest. Per frame: archetype, variant, heading, anchor, footprint size range (which footprints it may stand on), role ramps, overlay attach points. Plus overlays, agent sheets, terrain tiles, palette and data ramps. **The exact format is fixed after Phase 0.**
- `provenance.jsonl`: one line per API image (kept or not): model, version, prompt, negatives, seed, references (by hash), control hashes, gate scores, cost, date, the kept/rejected decision and who made it.
- `LICENCE`, with the model's output terms checked by a human (**HUMAN**) before the pack is used in anything public.

**Gate:** `paperdolls assets check` passes (schema, every archetype the pack declares has 4 headings, every role ramp exists, atlas pages within the size limit), and the engine's smoke render of the contact street matches the contact sheet.

---

## 11. Agents (always engine-rendered)

People, vehicles, carts, ships and creatures are built as part lists in the pack (the same primitives as buildings) and rendered by the engine into sprite sheets at **8 headings** *(initial)*, with walk or move cycles from the part list's joints. Optionally:

1. generate one large (512 px) painted reference per agent type at one heading through steps 4 to 6, with human approval;
2. derive a **palette and texture mapping** from it: role → palette ramp, which the engine applies to the part-list render at every heading and frame.

This keeps 10,000 agents consistent across headings and frames, which an image model cannot do. Agent data colours use the same data ramps as buildings.

---

## 12. Product B: painted base map of a real place

Use only for a model that does not change geometry. Steps:

1. **Control render of the whole world** by the art tool (the `World`'s OSM footprints extruded in 3D at their real angles, terrain, roads, trees) through the bible camera at the bible `px_per_m` *(initial: 4, which is 0.25 m per pixel as in Pixel Singapore)*: colour, height (16-bit), **entity-id** (one id per scene building), and role passes, cut into a fixed grid of square shots that align to the pixel.
2. **Generate tiles.**
   - With `sampler_access: yes` (local weights, as Pixel Singapore had): MultiDiffusion over overlapping windows, with a shifted grid on alternate steps, and RePaint-style inpainting of each new block from finished neighbours.
   - With an API only (the usual case): generate tiles in a fixed spiral from the centre. Each new tile is sent as `mask_inpaint` with an overlap band (a quarter of a tile *(initial)*) filled with finished neighbour pixels and pinned, so seams are generated in context. If `mask_inpaint` is `no`, product B is not possible with this API: stop.
3. **Seam gate:** across each seam, the gradient discontinuity of the luminance must be within 1.5× the tile's interior average *(initial)*. Failing seams are regenerated with a wider band.
4. **Alignment gate:** pixels the model painted as building (non-ground, by colour classification) must lie inside the id pass's buildings, dilated by 2 px, for ≥ 0.97 of building pixels per tile. Pixel Singapore's model invented tree crowns over clear streets; here that would detach state colours from buildings, so such tiles are flagged and regenerated or masked.
5. **Runtime layers:** painted tiles in a deep-zoom pyramid of 512 px tiles (Pixel Singapore's layout), the id pass (lossless) for picking and for **id-masked state tints** (a shader multiplies or overlays the state colour on the pixels of an entity, at a strength set in the bible), the height pass for occluding agents (as Pixel Singapore does for its cars), and overlay sprites from the pack's kit attached to the building's roof anchor.
6. **Cost estimate:** Jette is about 5 km², which at 0.25 m per pixel is about 80 MP. Pixel Singapore's 520 MP took about 6.6 GPU hours on one RTX 5080, so local generation of Jette would be on the order of an hour. With an API, the cost is tiles × candidates × cost per image, written to the job log before starting.

---

## 13. What a new asset pack costs a team

| Step | Who | Effort *(initial guesses)* |
|---|---|---|
| Part lists for the pack's archetypes (from the model's "what exists in this world" answers, section 6 of the rework plan) | LLM agent, human review | a day for 20 archetypes |
| Art bible and references | human, with the agent generating options | 1 to 3 rounds |
| Generation, post-processing, gates | agent, unattended within budget | hours |
| Contact sheet review | human | an hour per 50 sprites |
| Build and check | agent | minutes |
