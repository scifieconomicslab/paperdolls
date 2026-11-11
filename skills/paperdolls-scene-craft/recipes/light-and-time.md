# Recipe — light and time

Goal: the world is lit at the bible's **moment**. Light is the cheapest way to
make a scene feel like a place.

## 1. The three lights

```ts
const sky = new THREE.HemisphereLight(fillColour, groundBounceColour, 1.7);   // sky = fill, ground = bounce
sky.up.set(0, 0, 1);                                                             // z-up world
const key = new THREE.DirectionalLight(keyColour, 2.6);                         // shadows: render-pipeline §5
const rim = new THREE.DirectionalLight(fillColour, 0.25);                       // opposite azimuth, low; separates silhouettes
scene.add(sky, key, key.target, rim);
```

- `groundBounceColour` = the ground colour × 0.6. It tints the undersides
  and shadow sides with the place's own colour.
- **Calibrated values** (AgX, exposure 1.3, toon ramp 150/210/255, GTAO 0.65,
  three r180; these produced the exemplar): key 2.4–2.8, hemisphere 1.5–1.8.
  Lower values look plausible in isolation but sink the scene once AO and the
  toon ramp darken it. The exemplar's first round had a mean luminance of 86/255.
- **Tune numerically:** adjust exposure until the neighbourhood squint mean
  is 105–125 (exemplar 112) and pavements render ≥ 200/255 in sunlit areas.
- **Low sun** (elevation < 35°): flat ground receives only `sin(elevation)` of
  the key and sits in long shadows, so it renders darker than sunlit walls.
  Keep hemisphere ≥ 0.6 × key and author ground at OKLCH L ≥ 0.94, or the
  "ground lightest" value order inverts.
- Key azimuth: light from the **upper left of the screen** by default (the
  camera looks from azimuth 45°, so put the key at azimuth 45° + 110–150°).
  This lights two visible faces differently: one bright, one mid. Never light
  both visible faces equally.

## 2. Colour temperature

Convert kelvin to sRGB with this table (interpolate between rows):

| K | hex | use |
|---|---|---|
| 2,700 | `#ffb46b` | lamps, lit windows |
| 3,500 | `#ffc88f` | golden hour key |
| 4,500 | `#ffdcb4` | late afternoon key |
| 5,500 | `#ffecd8` | midday key (warm-neutral) |
| 6,500 | `#fff9fb` | neutral |
| 7,500 | `#e9efff` | overcast fill |
| 9,000 | `#d6e1ff` | blue-sky fill |
| 12,000 | `#c4d4ff` | deep shadow / dusk fill |

Rule: |key K − fill K| ≥ 2,500 for sunny moments, ≥ 1,200 for overcast. For
cold worlds (arctic, night), invert: a cool key with a warm bounce from lamps.

## 3. Moments (starting points)

| moment | key elev. | key K | fill K | exposure | notes |
|---|---|---|---|---|---|
| clear morning | 25° | 4,800 | 9,000 | 1.0 | long shadows, crisp |
| midday | 55° | 5,500 | 8,000 | 0.95 | short shadows; rely on AO and ink for depth |
| late afternoon | 30° | 4,000 | 9,000 | 1.0 | the default; warm walls, blue shadows |
| golden hour | 15° | 3,300 | 10,000 | 1.05 | very long shadows; few window lights on |
| overcast / after rain | 45° | 6,000 | 7,500 | 0.9 | soft shadows (opacity 0.35), wet dark roads, saturated greens |
| dusk | 8° | 3,000 | 12,000 | 0.85 | windows and lamps on; sky gradient deep |
| night | — | moon 9,000 at 0.4 | 12,000 | 0.8 | emissive windows and lamps carry the scene |

## 4. Optional day cycle

Run a day cycle only if (a) the model's time unit is hours or days and the
user wants it, or (b) the bible asks for ambient time and it is labelled
decorative. Otherwise hold the bible's moment fixed. A fixed moment is calmer
and reads data better.

When it runs: interpolate the moment table rows by time of day, rotate the key
azimuth with the sun, and switch emissives (§5) on below 12° key elevation.
Keep the night exposure high enough that data stays readable. If the model
time is in days, map one tick to one full cycle only if that is slower than
20 s per tick; anything faster strobes.

## 5. Emissives: windows and lamps

- Windows carry an instanced attribute `aLit` (0–1). The glass material adds
  `emissive = warmLamp × aLit × nightFactor`. Choose the lit windows by seed
  (30–55 % of windows at dusk, 10–20 % at night, more in centres).
- Street lamps: a small emissive head plus, at street zoom only, a soft
  additive ground decal (a radial gradient on a quad, `NO_INK` layer,
  `depthWrite: false`).
- Emissive surfaces must not be tone-mapped into grey. Check that lit windows
  reach OKLCH L ≥ 0.85.

## Common mistakes

- Equal light on both visible faces: everything looks like cardboard.
- A white key with a white fill: no temperature contrast, no mood.
- Fixing a dark scene with ambient light instead of exposure: it flattens the
  shadows.
