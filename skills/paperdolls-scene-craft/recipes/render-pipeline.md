# Recipe — render pipeline

> **Implemented in `tools/stage/src/pipeline.ts`.** A world does not write
> this; it fills `StageLook` from the art bible. Read this recipe to
> understand what each value does and to tune it. §7 (world edge) is
> `buildPlinth`; §8 (ground) is still the world's own code.

Goal: before any structure exists, an empty diorama is already lit, graded,
inked, and has a designed edge. Most of the "toy vs. beautiful" difference
lives here.

## 1. Renderer

```ts
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;       // or ACESFilmicToneMapping
renderer.toneMappingExposure = 1.3;                 // 1.2–1.4 with the toon ramp + AO; tune against the squint baseline
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
```

`antialias: false` because the composer renders to its own targets. Antialias
at the end with `SMAAPass` (or `FXAAShader` if SMAA is too heavy).

## 2. Composer

```ts
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const composer = new EffectComposer(renderer);   // HalfFloat targets by default
composer.addPass(new RenderPass(scene, camera));

const ao = new GTAOPass(scene, camera, w, h);
// Share the normal/depth target from §3 instead of letting GTAO render the scene again.
// three r180: setGBuffer() still reads this.normalRenderTarget, so give it a stand-in first.
(ao as any).normalRenderTarget.dispose();
(ao as any).normalRenderTarget = { depthTexture: normalTarget.depthTexture, setSize() {}, dispose() {} };
ao.setGBuffer(normalTarget.depthTexture, normalTarget.texture);
ao.blendIntensity = 0.65;
ao.updateGtaoMaterial({ radius: 2.0, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 16 });
composer.addPass(ao);

const ink = new ShaderPass(InkShader);            // §4
composer.addPass(ink);
composer.addPass(new SMAAPass());                // r180: no constructor arguments
composer.addPass(new OutputPass());              // applies tone mapping + sRGB
// resize: composer.setSize(w, h); normalTarget.setSize(w*dpr, h*dpr); ao.setSize(w*dpr/2, h*dpr/2)
```

Use an `UnsignedIntType` depth texture on the normal target
(`normalTarget.depthTexture.type = THREE.UnsignedIntType`). If the G-buffer
work-around breaks on a newer three.js, drop the four sharing lines and let
GTAO render its own normals (one extra scene pass).

Order matters: AO and ink operate in linear HDR, and `OutputPass` comes last.
After a three.js upgrade, check the `GTAOPass` parameter names against
`three/addons`. Check AO visually at street zoom: walls must darken where they
meet the ground. If GTAO misbehaves with the orthographic camera on your
three.js version, use `SAOPass` instead and record the swap.

## 3. Normals + depth target (shared by ink)

```ts
const normalTarget = new THREE.WebGLRenderTarget(w * dpr, h * dpr, { type: THREE.HalfFloatType });
normalTarget.depthTexture = new THREE.DepthTexture(w * dpr, h * dpr);
const normalMat = new THREE.MeshNormalMaterial();
const NO_INK = 2; // layer for things that must not be inked (sky dome, fog cards, smoke, water surface)

function renderNormals() {
  const bg = scene.background, fog = scene.fog;
  scene.background = null; scene.fog = null; scene.overrideMaterial = normalMat;
  camera.layers.disable(NO_INK);
  renderer.setRenderTarget(normalTarget);
  renderer.setClearColor(0x8080ff, 1); renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  camera.layers.enable(NO_INK);
  scene.overrideMaterial = null; scene.background = bg; scene.fog = fog;
}
// per frame: renderNormals(); composer.render();
```

Resize `normalTarget` alongside the composer.

## 4. Ink shader

The ink pass draws an outline only on the **nearer** side of a depth jump, and
on creases where the normals turn. Ink is a dark version of the local colour,
pulled toward the bible's ink hue. This reads as hand-inked, not as a black
wireframe.

```ts
const InkShader = {
  uniforms: {
    tDiffuse: { value: null }, tNormal: { value: null }, tDepth: { value: null },
    texel: { value: new THREE.Vector2(1 / (w * dpr), 1 / (h * dpr)) },
    width: { value: 1.5 },          // px; by zoom: street 1.5, neighbourhood 1.0, overview 0
    depthRange: { value: camera.far - camera.near },
    depthThresh: { value: 0.6 },    // metres
    normalThresh: { value: 0.35 },
    inkHue: { value: new THREE.Color('#2a2420') },  // bible ink, linear
    inkAmount: { value: 0.85 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tNormal, tDepth;
    uniform vec2 texel; uniform float width, depthRange, depthThresh, normalThresh, inkAmount;
    uniform vec3 inkHue; varying vec2 vUv;
    float D(vec2 o){ return texture2D(tDepth, vUv + o * texel * width).r * depthRange; }
    vec3  N(vec2 o){ return texture2D(tNormal, vUv + o * texel * width).rgb * 2.0 - 1.0; }
    void main(){
      vec4 col = texture2D(tDiffuse, vUv);
      if (width <= 0.0) { gl_FragColor = col; return; }
      float d0 = D(vec2(0.0));
      // only ink when a neighbour is further away -> outline sits on the near object
      float dE = max(max(D(vec2(1.,0.)) - d0, D(vec2(-1.,0.)) - d0), max(D(vec2(0.,1.)) - d0, D(vec2(0.,-1.)) - d0));
      vec3 n0 = N(vec2(0.0));
      float nE = max(max(1.0 - dot(n0, N(vec2(1.,0.))), 1.0 - dot(n0, N(vec2(-1.,0.)))),
                     max(1.0 - dot(n0, N(vec2(0.,1.))), 1.0 - dot(n0, N(vec2(0.,-1.)))));
      float e = max(smoothstep(depthThresh, depthThresh * 2.0, dE), smoothstep(normalThresh, normalThresh * 2.0, nE));
      vec3 inkCol = mix(col.rgb * 0.35, inkHue, 0.35);
      gl_FragColor = vec4(mix(col.rgb, inkCol, e * inkAmount), col.a);
    }`,
};
```

For an orthographic camera the depth buffer is linear, so `depth ×
depthRange` gives metres. Tune `depthThresh` until roof edges and building
silhouettes ink but kerbs (0.15 m) do not ink from depth. Kerbs pick up a
light crease from the normals, which is what you want.

## 5. Shadows fitted to the view

A shadow map stretched over the whole extent looks soft and blocky. Fit it to
what is visible:

```ts
const key = new THREE.DirectionalLight(keyColour, keyIntensity);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.4;
const keyOffset = new THREE.Vector3().setFromSphericalCoords(400, THREE.MathUtils.degToRad(90 - keyElevationDeg), THREE.MathUtils.degToRad(keyAzimuthDeg));
// setFromSphericalCoords is y-up; swap to z-up:
keyOffset.set(keyOffset.x, keyOffset.z, keyOffset.y);

function fitShadow(target: THREE.Vector3, viewWidthM: number) {
  const half = viewWidthM * 0.75 + 20;
  const cam = key.shadow.camera;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = 1; cam.far = 900;
  const texel = (2 * half) / key.shadow.mapSize.x;
  const t = target.clone();
  t.x = Math.round(t.x / texel) * texel; t.y = Math.round(t.y / texel) * texel; // stops shimmer while panning
  key.target.position.copy(t);
  key.position.copy(t).add(keyOffset);
  cam.updateProjectionMatrix();
}
```

Call `fitShadow` on every camera change. Tint shadows by setting the
hemisphere ground and sky colours (light-and-time). Never push shadows to
black.

## 6. Background and haze

- **Background:** a vertical gradient from sky top to horizon, as a
  `CanvasTexture` (2×256 px, `colorSpace = SRGBColorSpace`) assigned to
  `scene.background`. For ortho it maps to the screen, which is what you want.
- **Haze, not fog.** With an orthographic camera 1,500 m away, the depth range
  across a 220 m frame is tiny, so `scene.fog` makes no visible difference at
  neighbourhood zoom. (The conformance rebuild lost a criterion to this.) Add
  the depth cue in screen space instead, in the ink shader just before its
  output, so it applies to geometry but not to the background:

```glsl
uniform vec3 hazeCol; uniform float hazeAmt;      // hazeCol = horizon (linear); hazeAmt by zoom, below
// ...after computing the inked colour `outCol`:
float isGeo = step(texture2D(tDepth, vUv).r, 0.9999);          // 0 on background pixels
float far = smoothstep(0.35, 1.0, vUv.y);                       // the top of the screen is further away
outCol = mix(outCol, hazeCol, isGeo * far * far * hazeAmt);
```

  Use `hazeAmt` of about 0.10 at street zoom, 0.28 at neighbourhood and 0.40 at
  overview. The upper third of the frame should visibly soften toward the sky
  colour, and the eye reads that as distance. Keep `scene.fog` only for the
  far plinth and context ring at overview.

## 7. The world's edge

Pick one, record it in the bible, and build it in step 1:

- **Diorama plinth.** Extrude the extent outline (or a rounded rectangle 4 %
  larger than it) downward 6–12 m. The side material is a canvas texture with
  2–4 horizontal soil or rock strata in the ground palette, darkened 25–45 %.
  Use a thin lighter lip (0.3 m) at the top edge. Below it there is only
  background. This reads as a crafted model, which suits invented worlds.
- **Context ring.** Extend the ground 25–40 % beyond the extent with
  simplified surroundings: fields in 3–4 muted tones, scattered tree clumps,
  and roads continuing outward, all at chroma × 0.5. Fog swallows the outer
  edge. Label it decorative. This suits real places.
- **Coastline / wall / cliff.** When the world has one, use it as the edge.

## 8. Ground base

Never a flat single-colour plane. The ground material samples a world-anchored
noise texture (512², repeat every 40–80 m) that modulates lightness by ±3–4 %,
plus a second, larger noise (repeat ~300 m) of ±2 % hue shift. Generate it
once on a canvas with a seeded value-noise function. Keep it subtle enough to
be felt, not seen.

## Common mistakes

- Tone mapping set but colours authored to compensate: the palette goes
  muddy. Author in sRGB and let three convert.
- Ink at overview zoom: it turns the city to mush. Set width 0.
- Relying on `scene.fog` for depth with an orthographic camera: it is
  invisible. Use the screen-space haze.
- AO radius too large (> 4 m): it gives dirty halos around everything.
- Shadow map over the whole extent: blurry blobs. Fit it to the view.
