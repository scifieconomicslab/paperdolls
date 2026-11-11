---
name: paperdolls-beauty-review
description: The blocking visual-quality gate for a paperdolls page. Capture the world, let review.py measure it against an exemplar and build one comparison board, have a separate reviewer score the board pairwise against the exemplar, and iterate with the scene-craft recipes until it passes. Use at Gate 4 (style frame) and Gate 7 (sign-off), and whenever the user says the world looks ugly, flat, empty, toy-like or generic.
---

# Beauty review

The correctness gates (`reference/ui-rules/paperdolls-gates/`) make the page
honest. This gate makes it worth looking at. Both must pass. Correctness gates
run first; a FAIL there stops the line before you spend effort on beauty.

You review **images, not code**. A recipe you believe you implemented does
not count until it is visible in a capture.

## 1. Capture and measure

```bash
node tools/bench/screenshots.mjs --world worlds/<name> --beauty --round <n>
.venv/bin/python tools/bench/review.py pack worlds/<name>/visual/review/round-<n> \
    --exemplar reference/exemplars/<closest>
```

The first command writes the raw captures to `visual/review/round-<n>/`
(overview, neighbourhood, street, lens, street-90, clip-0..5). The page must
implement the snapshot URL contract (`paperdolls-scene-craft` §6), and the
page build must not empty `visual/` (`emptyOutDir: false`).

`pack` does all the measuring, so nobody has to judge it by eye: value bands,
contrast, overview framing, sky in the neighbourhood shot, the largest flat
untextured patch, and motion across the clip. Each is compared with the
exemplar, and a line starting with `FLAG` is printed for every check that
falls short. It also builds the **only images anyone opens**:

- `board.png`: the exemplar's neighbourhood, street and overview above this
  world's (one image, about 1,900 × 850);
- `extras.png`: this world's lens and street-90.

**Cost rule.** One round is one `board.png` plus, at Gate 7, one
`extras.png`. Do not open the individual captures, the clip frames or the
exemplar folder; motion and value are numbers in the `pack` output. Open a
single full-size capture only to locate a defect the board already shows.

## 2. Score: a separate reviewer, not the builder

The model that built the scene grades it too kindly; both cheaper models in the
first Jette test scored themselves 4 on every criterion while their pictures
were visibly below the exemplar. So scoring is done **by a fresh reviewer**:

- **If the harness can start a subagent or worker** (Claude Code's Agent tool,
  an OpenCode subagent, a second session), start one for each round. A
  cheaper or faster model is fine. Give it only: `board.png`, `extras.png`
  at Gate 7, the `pack` output, the rubric below, and the art bible's
  **moment**, **motif** and **not this** lines. Never pass the build history
  or the code. Use the reviewer brief in §2.1.
- **If it cannot**, score it yourself, but in this order: first write down
  every defect you can see on the board, then score. Do not change scores
  after reading your own defect list.

Scoring is **pairwise**. For each criterion the reviewer says whether this
world is **worse**, **same** or **better** than the exemplar on the board.
Same takes the exemplar's score; worse is that score minus one (minus two if
glaring); better is plus one and needs a reason that points at the board.
Every `FLAG` line from `pack` caps its criterion at **worse**: the reviewer may
explain a flag but may not overrule it.

| # | criterion | where on the board | the exemplar looks like | worse looks like |
|---|---|---|---|---|
| 1 | **Value structure** | neighbourhood + `pack` squint | three value bands; buildings read as shapes against pale ground | one muddy band; the city dissolves |
| 2 | **Palette harmony** | neighbourhood | low-chroma related surfaces, one accent family | competing saturated hues, or one hue everywhere |
| 3 | **Data restraint** | neighbourhood vs lens (extras) | data as accents (≤ ~15 % of building pixels); the lens reads at a glance | data repaints the world, or is invisible in both |
| 4 | **Silhouette and skyline** | overview, neighbourhood | rooflines vary; a landmark you find in one second | a uniform carpet of boxes |
| 5 | **Facade detail** | street | framed openings, distinct ground floors, roof furniture, the motif | blank boxes |
| 6 | **Street and ground** | street, neighbourhood | kerbs, markings, plots with surfaces, greenery with volume | flat polygons, bare patches |
| 7 | **Life** | street + `pack` motion | vehicles and people on the streets; motion ≥ 0.5 % | empty streets; nothing moves |
| 8 | **Light and depth** | neighbourhood, street | warm/cool split, crisp shadows, contact AO, clean ink | flat even light |
| 9 | **Edge and framing** | overview, neighbourhood | a designed edge; the city fills the frame; a composed opening shot | small shape in a void; sky in the shot |
| 10 | **Bible fidelity** | all | the moment, motif and "not this" are visible | could be any world |

### 2.1 Reviewer brief (copy into the subagent prompt)

```text
You are reviewing one round of a city render against an exemplar. Open
<round>/board.png (top row: exemplar; bottom row: this world)<, and
<round>/extras.png>. Here is the pack output: <paste>. Art bible: moment
<…>; motif <…>; not this <…>.
1. List every visible defect in the bottom row, each with where it is.
2. For criteria 1-10 (table below), answer worse / same / better than the
   exemplar, with one sentence of evidence naming the tile. A FLAG line caps
   its criterion at worse.
3. Name the three changes that would most improve the bottom row.
Reply in under 300 words. Do not open other files.
<rubric table>
```

## 3. Pass

**The bar is the exemplar** (`reference/exemplars/README.md`): average 3.8;
value structure and edge-and-framing at 3, the rest at 4. A world passes
when no criterion is **worse**, the average is ≥ 3.8, and `pack` prints no
`FLAG`. Aim higher on the exemplar's own weak spots (1 and 9).

**Gate 4 (style frame):** one round. Criteria 1, 2, 5, 6, 8 and 10 must not
be worse; life, data and framing come later.

If no exemplar exists for the world's family, use the closest one and say so.

## 4. Iterate

Take the reviewer's three changes, every **worse** criterion and every `FLAG`,
apply **all** of their fixes in one batch from the table below, rebuild, and
run §1 again with `--round <n+1>`. Do not capture in between fixes. Change the
scene, not the rubric.

| symptom | first fix |
|---|---|
| muddy at squint | palette-method §1 value bands; widen ground ↔ wall ↔ roof L gaps |
| everything one colour | data-in-the-world §2: move data off whole roofs; palette-method §5 variation |
| flat lighting | light-and-time §1–2: key/fill temperature split; render-pipeline §2 AO |
| blank facades | buildings §4 (modules), §4.2 (surround, sill, lintel), §4.3 ground floors |
| toy roofs | buildings §2 gable/hip with overhang and gable infill |
| bare ground | streets-and-ground §2 kerbs, §5 plots; nature-and-water §1 placement |
| nothing moves | life §2–4 |
| tiny, lost city | camera §3 opening shot; composition §1 |
| floating rectangle | render-pipeline §7 world edge, §6 background and fog |
| no landmark or skyline | composition §1–2 |
| generic | art-direction §2 "How to fill it well"; strengthen the signature motif |
| roofs and walls in one band | palette-method §1: roofs ≥ 0.15 L below the wall mean |
| flat opening shot, no depth | render-pipeline §6 screen-space haze; camera §3 |
| residential ground floors look like upper floors | buildings §4.3 raised plinth, steps, door surround |
| data repaints every roof | data-in-the-world §2: ridge cap + tint ≤ 10 % |
| street clip shows no traffic | life §2 visibility floor |
| FLAG framing: overview covers too little | camera §3: fit the overview to the world's bounding box |
| FLAG framing: sky in the neighbourhood shot | camera §3: lower the target or tighten the zoom until no horizon shows |
| FLAG ground: flat untextured patch | streets-and-ground §5, nature-and-water: give that land use a surface |

Allow at most **three rounds** at Gate 7. After round three, stop and report
the remaining gaps honestly, with the scores, to the user. Never relabel a
worse as a same to finish.

## 5. Record

Append to `worlds/<name>/visual/review/review.md` per round:

```markdown
## Round <n> — YYYY-MM-DD
reviewer: <subagent model | self>
pack: <paste the table and FLAG lines>
| # | criterion | vs exemplar | score | evidence |
|---|---|---|---|---|
| 1 | value structure | same | 3 | neighbourhood tile: roofs separate from pale ground, as in the exemplar |
...
average: 3.9 — PASS | FAIL
three changes: 1) … 2) … 3) …
```

Add the final scores and the round count to the Gate 7 final report, next to
the FPS numbers. Show the user `board.png` from the passing round.

## 6. Promoting an exemplar

When a world passes **and** the user says it is as good as or better than
the current exemplars, offer to copy its `overview.png`, `neighbourhood.png`,
`street.png`, `street-90.png`, `lens.png` and `art-bible.md` into
`reference/exemplars/<family>-<palette>-<short-name>/`. Add a row to
`reference/exemplars/README.md` with its scores, squint baselines and the
calibrated light values. If it beats the current baseline in the same family,
it becomes the new baseline. Exemplars are the visual test suite: the bar
rises only when the user moves it.
