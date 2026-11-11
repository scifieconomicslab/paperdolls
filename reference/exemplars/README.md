# Exemplars

Golden captures that show the paperdolls visual bar. The beauty review
(`skills/paperdolls-beauty-review`) compares every world against the closest
one here: `review.py pack --exemplar reference/exemplars/<folder>` measures a
round against it and puts its overview, neighbourhood and street shots on the
board above the world's.

Each exemplar is a folder `<family>-<short-name>/` containing `overview.png`,
`neighbourhood.png`, `street.png`, `lens.png` and the world's `art-bible.md`.
They are images and words, not code, so they set the bar without capping it.

Only the user promotes a world to an exemplar (beauty-review §6).

## Index

| folder | family | density | moment | notes |
|---|---|---|---|---|
| [`real-nw-ashford`](real-nw-ashford/) | real · nw | mid-rise town, 473 structures | 4 pm, late October, after rain | the baseline: built from the skills alone; the user accepted it as the bar (2026-11-11) |

## Baselines (`real-nw-ashford`)

Its own review scores (round 4) define a passing world until a better
exemplar replaces it:

| # | criterion | score | known weakness |
|---|---|---|---|
| 1 | value structure | 3 | roofs and walls share one value band; little light ground visible at neighbourhood zoom |
| 2 | palette harmony | 4 | |
| 3 | data restraint | 4 | |
| 4 | silhouette and skyline | 4 | |
| 5 | facade detail | 4 | residential ground floors read like upper floors |
| 6 | street and ground | 4 | |
| 7 | life | 4 | |
| 8 | light and depth | 4 | |
| 9 | edge and framing | 3 | no haze or horizon at neighbourhood zoom; the overview still reads as a grid |
| 10 | bible fidelity | 4 | |

average 3.8. Squint baselines (`review.py pack` computes these for both sides):

| shot | dark | mid | light | mean |
|---|---|---|---|---|
| overview | 0 % | 33 % | 67 % | 177 |
| neighbourhood | 12 % | 86 % | 2 % | 112 |
| street | 18 % | 70 % | 12 % | 120 |

Calibrated values that produced it (AgX, three r180): exposure 1.3, key 2.6
at 4,000 K, hemisphere 1.7 at 9,000 K, toon ramp 150/210/255, GTAO blend
0.65 at half resolution, ink 1.5 → 1.0 → 0 px. These are now the stage's
defaults (`tools/stage/`). The scene code that produced it,
`worlds/conformance/page/src/scene/`, is a worked example to read, never a
page to copy: it assumes a grid, and new worlds start from the stage template.

## Wanted (to cover the space)

- `real-` Mediterranean harbour (whitewash, terracotta, strong sun, water)
- `real-` dense Asian street grid (mid-rise, signage, roof tanks, dusk)
- `scifi-` arcology or orbital (vertical, emissive, night)
- `historical-` walled town (stone, timber, market square)
- rural / farm model (fields, scattered buildings, terrain)
- non-urban agent model (e.g. wolf-sheep on terrain, model agents as the life)
