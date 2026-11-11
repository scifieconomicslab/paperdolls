# Recipe — camera

> **Implemented in `tools/stage/src/camera.ts` and `snapshot.ts`.** A world
> does not write the rig, controls, easing or snapshot handling. Its part is
> §3: choosing the subject and street subject, and LOD by view width. The
> overview fits `scene.area.boundary` as projected on screen, so the city fills
> the frame at every angle.

Goal: the camera is an instrument that also composes. It opens on a good
picture, moves smoothly, never loses the map, and drives LOD, ink, fog and
shadows from one number: the **view width** in metres.

## 1. Projection

Orthographic, dimetric, z-up:

```ts
const EL = THREE.MathUtils.degToRad(30);
let az = THREE.MathUtils.degToRad(45);           // + n·90° on rotate
const DIST = 1500;                                // far enough to never clip
function place(target: THREE.Vector3, viewWidth: number, aspect: number) {
  camera.position.set(
    target.x + DIST * Math.cos(EL) * Math.cos(az),
    target.y + DIST * Math.cos(EL) * Math.sin(az),
    target.z + DIST * Math.sin(EL));
  camera.up.set(0, 0, 1);
  camera.lookAt(target);
  const hw = viewWidth / 2;
  camera.left = -hw; camera.right = hw; camera.top = hw / aspect; camera.bottom = -hw / aspect;
  camera.near = 1; camera.far = DIST * 2;
  camera.updateProjectionMatrix();
  onViewChange(viewWidth);   // LOD, ink width, fog, shadow fit
}
```

## 2. Zoom levels

| name | view width | ink width | LOD (buildings.md §8) |
|---|---|---|---|
| street | 50–70 m (min 40) | 1.5 px | everything |
| neighbourhood | 180–260 m | 1.0 px | windows, fascias, roof furniture, traffic |
| overview | extent + 10 % (max 1.6 × extent) | 0 | masses and roofs |

Interpolate ink width and fog with view width between these anchors.

## 3. Opening shot

The page opens at **neighbourhood** zoom, framed on:

1. the landmark, if there is one; else
2. the densest 200 m cell (most structures × mean height); else
3. the extent centre.

Place the subject on a thirds point, not dead centre: offset the target
toward the lower-right third by 15 % of the view width, so the landmark
sits upper-left with the city extending behind it. The screen-space haze
(render-pipeline §6) then softens the upper third, which supplies the depth
into the distance. Without it the opening shot reads flat (criterion 9).
Then, unless reduced motion is set, ease in once over 1.2 s from 1.3× the
opening width. That is the only automatic camera move, and it never repeats.

The **street shot** target is the bible's most characteristic block next to
an avenue or the square, so that traffic, shopfronts and the motif are all in
frame.

## 4. Controls

| input | action |
|---|---|
| wheel over the canvas | zoom anchored at the cursor (the world point under the cursor stays put) |
| drag (primary button) | pan, 1:1 with the cursor on the ground plane |
| `W` / `S` held | zoom in / out |
| `A` / `D` held (and arrows) | pan |
| `Q` / `E` or `R` | rotate −90° / +90° |
| `F` | fit to overview |
| `L` | toggle data lens |
| `Space` | play / pause |
| double-click a structure | select and frame it |

- Ignore keys while typing in inputs, and ignore Ctrl/Meta/Alt shortcuts.
- Wheel listeners use `{ passive: false }` on the canvas only. The canvas
  sets `touch-action: none` and supports pinch zoom via pointer events.
- Clamp the view width between street-min and overview-max. Clamp pan so the
  target stays within the extent + 20 %. `F` always recovers.
- Provide visible buttons for zoom ±, fit, rotate and lens, with tooltips and
  aria labels, plus a `grab`/`grabbing` cursor, a focusable canvas, and a
  shortcut list in the About panel.

## 5. Easing

All programmatic moves (fit, rotate, select-to-frame, the opening shot) ease
over 250–400 ms with an ease-out cubic, interpolating target, view width and
azimuth (rotate goes the short way). User drags and wheel are immediate, with
wheel zoom optionally smoothed over 120 ms. Under `prefers-reduced-motion`,
and in snapshot mode, every move is instant.

## 6. Snapshot mode

Implements the contract in `../SKILL.md` §6: `shot=` sets the zoom level and
the opening-shot target, `angle=` adds to the azimuth, `view=top` sets
elevation 90° (the map check), and `lens=1` enables the lens. Set
`window.__paperdollsReady = true` once the frame is rendered after all
assets are built.

## Common mistakes

- Opening at fit: everything is tiny, and the first impression is a
  spreadsheet of boxes.
- A camera that clips or loses the map after a rotate: clamp and test all
  four azimuths.
- Perspective camera: it breaks the diorama read and the pixel-consistent ink.
