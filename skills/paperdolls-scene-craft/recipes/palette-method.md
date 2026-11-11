# Recipe — palette method

Goal: a palette that is harmonious by construction, has a clear value
structure, keeps data visibly apart from decoration, and is written in the art
bible. Build it in **OKLCH**, which is perceptually even, so equal steps look
equal.

`reference/render/palettes.json` holds regional starting hues. Read it for
hue hints only. The values it gives are proposals chosen by eye.

## 1. Value bands first, hue second

Assign each role an OKLCH lightness band **before** choosing hues:

| role | L | C | notes |
|---|---|---|---|
| sky top | 0.80–0.90 | 0.03–0.07 | |
| horizon / fog | 0.90–0.96 | 0.01–0.03 | lighter than sky top |
| ground (plots, pavement) | 0.90–0.96 (≥ 0.94 when key elevation < 35°) | 0.01–0.035 | the lightest world surface, as rendered, not only as authored |
| sidewalk | 0.82–0.90 | ≤ 0.02 | slightly darker than ground or lighter, consistently |
| road | 0.42–0.58 | ≤ 0.015 | wet roads: 0.35–0.45 |
| walls | 0.60–0.82 | 0.02–0.08 | 3–4 values spread across ≥ 0.12 L |
| roofs | 0.30–0.48 | 0.02–0.08 | **≥ 0.15 L below the wall mean**, so roofs and walls land in different squint bands (the exemplar's weakness was roofs at 0.40–0.43 against walls at 0.58–0.82: too close); hue distinct from walls by ≥ 30° or clearly darker |
| trim / frames | 0.88–0.95 or 0.25–0.35 | ≤ 0.03 | light trim on dark walls, or the reverse |
| glass | 0.45–0.60 | 0.02–0.05 | hue toward the sky; reads darker than the wall |
| vegetation | 0.50–0.70 | 0.06–0.11 | 3 tones spread ≥ 0.10 L; hue 115–150 (dry: 95–115) |
| water | 0.55–0.72 | 0.05–0.09 | hue 200–235 |
| accent family | 0.55–0.75 | 0.10–0.16 | **the only saturated colours**: awnings, doors, signs, flowers |
| ink | 0.18–0.28 | 0.01–0.03 | hue = shadow hue |

The value order (ground > walls > roofs > ink) is what makes the city read at
a squint.

## 2. Choosing hues

1. Take the bible's three material nouns and assign a hue to each from the
   real material: brick ≈ 35–45°, terracotta ≈ 45–55°, sandstone ≈ 70–85°,
   slate ≈ 250–265° (very low C), concrete ≈ 80–100° (C ≤ 0.015), timber
   ≈ 60–70°, whitewash ≈ 90° (C ≤ 0.01).
2. Walls take 1–2 of those hues. Roofs take the third, or a darker shade of a
   wall hue.
3. The accent family is one hue, or two neighbouring hues within 40°,
   chosen to sit **opposite** the dominant wall hue (± 30° of 180° away).
4. Vegetation and water take their natural ranges, nudged 5–10° toward the
   key light's warmth for warm moments, or toward blue for cold ones.
5. **Colours declared in the binding** (treatment colours, a flag colour) are
   fixed inputs. Choose the accent family and the data ramp to keep ≥ 30° of
   hue away from them, and list them in the bible's palette table marked
   "from binding".

## 3. Data ramps (kept apart)

- **Sequential:** L from 0.93 to 0.38 over the domain, chroma rising
  0.04 → 0.14 and back down slightly at the dark end, and hue drifting
  monotonically by 40–70°. Example "ember": h 85 → 30. "Tide": h 200 → 255.
  Pick a ramp whose hues are **not** the accent family's.
- **Diverging:** two sequential arms meeting at a light neutral (L 0.92,
  C ≤ 0.02) at the declared midpoint. Arms are blue ↔ orange or teal ↔
  magenta. **Never red ↔ green.**
- **Categorical:** up to 7 colours, all at L 0.62–0.72 and C 0.10–0.14,
  hues spaced ≥ 45°. Pair each with a pattern or shape (data-in-the-world).
- **No data:** a neutral at the ramp's middle lightness with C ≤ 0.01, always
  drawn with a 45° hatch. It never looks like a value.
- **Choosing the sequential ramp's hue.** Choose it last, in the largest free
  gap on the hue wheel: ≥ 60° from the wall hues, the accent family and the
  sky, and outside vegetation (h 105–150) so data never reads as grass. In a
  warm brick world (walls h 25–50, accent opposite at h 205–235, sky blue)
  the only gap left is purple–magenta (h 280–340), which is why brick worlds
  keep landing on a plum ramp ("heather": 0.93/0.03/285 → 0.66/0.10/307 →
  0.38/0.12/330). That is the rule working, not a default. To get another
  ramp, free its hues first: for example, move the accent to ochre or teal
  (h 85 or 175) and the data can take "tide" (h 200 → 255). Offer that choice
  at Gate 2b when the user wants something other than purple.
- **Old records:** a world record or binding from before G3 may still say
  `direction: red→green`. Replace it at Gate 2b with the bible's ramp, write
  `top_color.ramp` in `model-binding.json`, and log it ("Gate 2b: red→green
  replaced by <ramp> (G3)").

## 4. OKLCH → sRGB hex

Write this once into the world's code (`palette.ts`) and author every bible
colour as `[L, C, h]`:

```ts
export function oklch(L: number, C: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  const enc = (x: number) => {
    x = Math.min(1, Math.max(0, x));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return '#' + lin.map((x) => Math.round(enc(x) * 255).toString(16).padStart(2, '0')).join('');
}
// sequential ramp sampler
export const ramp = (t: number, [L0, C0, h0]: number[], [L1, C1, h1]: number[]) =>
  oklch(L0 + (L1 - L0) * t, C0 + (C1 - C0) * t, h0 + (h1 - h0) * t);
```

Clamping out-of-gamut colours shifts their hue. If a colour clips, lower C
instead.

## 5. Per-structure variation

From each structure's seed: wall = one of the 3–4 wall colours, then L ± 0.03
and h ± 4°. Roof = one of 2–3 roof colours, then L ± 0.02. Check left and
right neighbours along the street, and if a neighbour has the same base
colour, take the next one. The signature motif may use the accent family.

## 6. Write it down

Put the final table, with OKLCH triples **and** hex, in the art bible's
palette section. The page's theme (UI) takes its surface, text and accent
from the same table, so the chrome and the world read as one object.
