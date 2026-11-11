# Trees — kinds and the `real` family's regional species mixes

Low-poly faceted trees: ellipsoids, cones and fronds coloured from the look
(`canopies`, `bloom`, `trunk`). The same tree reads differently under each
look because colours come from the palette, not from the species.

The nine kinds are the default. Other world families may add kinds and mixes
— alien flora, dead trees, tropical giants — in their family pack and the
catalogue; every kind must render in all three looks. The twelve mixes
below are the **`real` world family's** palette families; historical, fantasy
and science-fiction families define their own.

## The nine kinds

| kind | label | height (m) | silhouette |
|---|---|---|---|
| `broadleaf` | Broadleaf tree | 8 | trunk + one big faceted ellipsoid |
| `oak` | Large spreading tree | 10 | trunk + two overlapping ellipsoids |
| `plane` | Street plane tree | 9.5 | trunk + tall ellipsoid |
| `columnar` | Columnar tree (poplar, cypress) | 11 | narrow tall ellipsoid (scale z ≈ 5.4×) |
| `conifer` | Conifer | 9 | trunk + three stacked cones |
| `umbrella` | Umbrella tree (acacia, pine) | 8 | tall bare trunk + wide flat canopy |
| `palm` | Palm | 10 | slightly tapering trunk + 9 drooping fronds |
| `blossom` | Flowering tree | 7.5 | like broadleaf but with `bloom` faces |
| `shrub` | Shrub or hedge | 1.8 | small ground ellipsoid |

Scale factor `s ∈ {0.8, 1.0, 1.2}` (picked per-instance from the seed);
variant `v ∈ 0..5` jitters geometry.

Rules:

- **`data` role** = main foliage colour — a simulation may recolour canopy.
- **`leaf1`** = lighter canopy tone (sunlit faces), **`leaf2`** = darker
  (shaded faces). Conifers darken all three (0.88 / 0.78 / 0.58).
- **`bloom` faces** only exist on `blossom`, and a `blossom` without a
  palette `bloom` colour renders as plain `broadleaf`.
- **`trunk`** comes from `th.trunk` or `mix('#6b5a45', shadow, 0.2)`.
- Seeded placement: park/wood scattering is random with per-polygon cap
  (300) and global cap (4000); `tree_row` spacing default 9 m.

## The `real` family's twelve species mixes (proposals)

Weights; the picker draws weighted random per tree. `blossom` is filtered
out to `broadleaf` when the look has no `bloom`.

| palette family / region | mix |
|---|---|
| `nw` | broadleaf 4 · plane 3 · oak 1 · columnar 1 · conifer 0.5 · blossom 0.5 |
| `uk` | oak 3 · plane 3 · broadleaf 3 · conifer 0.5 · blossom 0.4 |
| `ws` | plane 5 · broadleaf 2 · columnar 1 · conifer 0.5 · blossom 0.4 |
| `md` | umbrella 3 · columnar 3 · broadleaf 3 · palm 1 · shrub 2 · blossom 1 |
| `ce` | broadleaf 4 · oak 2 · conifer 1.5 · columnar 1 · blossom 0.4 |
| `sa` | oak 3 · palm 3 · umbrella 2 · blossom 1.5 · broadleaf 1 |
| `se` | palm 3 · broadleaf 3 · umbrella 2 · blossom 1.5 · shrub 1 |
| `ea` | broadleaf 4 · blossom 2 · conifer 1.5 · columnar 1 · plane 1 |
| `me` | palm 4 · broadleaf 2 · umbrella 1 · shrub 1.5 · columnar 1 |
| `sb` | umbrella 3 · broadleaf 3 · palm 1.5 · blossom 1.5 · shrub 1 |
| `la` | broadleaf 3 · palm 2 · blossom 2 · umbrella 1 · oak 1 |
| `na` | oak 3 · broadleaf 3 · conifer 2 · plane 1 · columnar 0.5 |

**These are proposals, not verified ecology.** If a world is set in a real
place, the LLM asks the user which species actually line the streets there,
and records the answer in the world record; the mix above is the fallback.

## Sources

Species mixes and kind definitions transcribed from
`viz/treelib.js` @ `f9a1a59` (CC BY 4.0).
