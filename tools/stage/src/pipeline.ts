// paperdolls stage: the render pipeline (scene-craft recipes/render-pipeline.md).
// Renderer, lights, sky, GTAO + ink + screen-space haze + SMAA + output, shadows fitted to the view.
// It decides nothing visual: every colour and strength comes from the art bible through StageLook.
// Vendored into worlds/<name>/page/src/stage/ by tools/stage/vendor.mjs. Do not edit the copy.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ZOOM } from './camera.ts';

/** Objects on this layer get no ink and no AO normals (smoke, water sparkle, overlays). */
export const NO_INK = 1;

type C = THREE.ColorRepresentation;
export interface StageLook {
  exposure: number;                                                            // house style 1.3
  key: { color: C; intensity: number; azimuthDeg: number; elevationDeg: number };
  fill: { sky: C; ground: C; intensity: number };                              // hemisphere light
  rim?: number;                                                                // back light, default 0.25
  sky: { top: C; horizon: C };
  ink: C;
  ao?: number;                                                                 // GTAO blend, default 0.65
  haze?: { street: number; neighbourhood: number; overview: number };          // default 0.10 / 0.28 / 0.40
}

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  key: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  render(): void;
  resize(w: number, h: number): void;
  /** Call whenever the camera moves: refits shadows and sets ink width, AO radius and haze for the zoom. */
  setView(target: THREE.Vector3, viewWidth: number): void;
  setLook(look: StageLook): void;
  dispose(): void;
}

const InkShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tNormal: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1, 1) },
    width: { value: 1.0 },
    depthRange: { value: 3000 },
    depthThresh: { value: 0.6 },
    normalThresh: { value: 0.35 },
    inkHue: { value: new THREE.Color() },
    inkAmount: { value: 0.85 },
    hazeCol: { value: new THREE.Color() },
    hazeAmt: { value: 0.28 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse, tNormal, tDepth;
    uniform vec2 texel; uniform float width, depthRange, depthThresh, normalThresh, inkAmount, hazeAmt;
    uniform vec3 inkHue, hazeCol; varying vec2 vUv;
    float D(vec2 o){ return texture2D(tDepth, vUv + o * texel * width).r * depthRange; }
    vec3  N(vec2 o){ return texture2D(tNormal, vUv + o * texel * width).rgb * 2.0 - 1.0; }
    void main(){
      vec4 col = texture2D(tDiffuse, vUv);
      vec3 outCol = col.rgb;
      if (width > 0.0) {
        float d0 = D(vec2(0.0));
        float dE = max(max(D(vec2(1.,0.)) - d0, D(vec2(-1.,0.)) - d0), max(D(vec2(0.,1.)) - d0, D(vec2(0.,-1.)) - d0));
        vec3 n0 = N(vec2(0.0));
        float nE = max(max(1.0 - dot(n0, N(vec2(1.,0.))), 1.0 - dot(n0, N(vec2(-1.,0.)))),
                       max(1.0 - dot(n0, N(vec2(0.,1.))), 1.0 - dot(n0, N(vec2(0.,-1.)))));
        float e = max(smoothstep(depthThresh, depthThresh * 2.0, dE), smoothstep(normalThresh, normalThresh * 2.0, nE));
        outCol = mix(outCol, mix(col.rgb * 0.35, inkHue, 0.35), e * inkAmount);
      }
      float isGeo = step(texture2D(tDepth, vUv).r, 0.9999);         // 0 on sky pixels
      float far = smoothstep(0.35, 1.0, vUv.y);                      // the top of the frame is further away
      outCol = mix(outCol, hazeCol, isGeo * far * far * hazeAmt);
      gl_FragColor = vec4(outCol, col.a);
    }`,
};

function skyTexture(top: C, horizon: C) {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#' + new THREE.Color(top).getHexString());
  gr.addColorStop(0.75, '#' + new THREE.Color(horizon).getHexString());
  gr.addColorStop(1, '#' + new THREE.Color(horizon).getHexString());
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** log-space position of a view width between two zoom stops, clamped to 0..1 */
const between = (w: number, a: number, b: number) => THREE.MathUtils.clamp(Math.log(w / a) / Math.log(b / a), 0, 1);

export function createStage(canvas: HTMLCanvasElement, look: StageLook): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-100, 100, 60, -60, 1, 3000);
  camera.up.set(0, 0, 1);
  camera.layers.enable(NO_INK);

  const hemi = new THREE.HemisphereLight();
  hemi.up.set(0, 0, 1);
  const key = new THREE.DirectionalLight();
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.4;
  const rim = new THREE.DirectionalLight();
  scene.add(hemi, key, key.target, rim, rim.target);
  const keyOffset = new THREE.Vector3();

  let w = canvas.clientWidth || 1440, h = canvas.clientHeight || 900;
  const normalTarget = new THREE.WebGLRenderTarget(w * dpr, h * dpr, { type: THREE.HalfFloatType });
  normalTarget.depthTexture = new THREE.DepthTexture(w * dpr, h * dpr);
  normalTarget.depthTexture.type = THREE.UnsignedIntType;
  const normalMat = new THREE.MeshNormalMaterial();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, w, h);
  // Share our normal/depth G-buffer with GTAO. three r180's setGBuffer() still reads
  // this.normalRenderTarget, so give it a stand-in that never resizes ours (render-pipeline §2).
  (ao as any).normalRenderTarget.dispose();
  (ao as any).normalRenderTarget = { depthTexture: normalTarget.depthTexture, setSize() {}, dispose() {} };
  ao.setGBuffer(normalTarget.depthTexture, normalTarget.texture);
  ao.updateGtaoMaterial({ radius: 2.0, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 16 });
  composer.addPass(ao);
  const ink = new ShaderPass(InkShader);
  ink.uniforms.tNormal.value = normalTarget.texture;
  ink.uniforms.tDepth.value = normalTarget.depthTexture;
  composer.addPass(ink);
  composer.addPass(new SMAAPass());                 // r180: no constructor arguments
  composer.addPass(new OutputPass());

  let haze = { street: 0.10, neighbourhood: 0.28, overview: 0.40 };
  function setLook(l: StageLook) {
    renderer.toneMappingExposure = l.exposure;
    hemi.color.set(l.fill.sky); hemi.groundColor.set(l.fill.ground); hemi.intensity = l.fill.intensity;
    key.color.set(l.key.color); key.intensity = l.key.intensity;
    rim.color.set(l.fill.sky); rim.intensity = l.rim ?? 0.25;
    const az = THREE.MathUtils.degToRad(l.key.azimuthDeg), el = THREE.MathUtils.degToRad(l.key.elevationDeg);
    keyOffset.set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)).multiplyScalar(400);
    (scene.background as THREE.Texture | null)?.dispose?.();
    scene.background = skyTexture(l.sky.top, l.sky.horizon);
    ink.uniforms.inkHue.value.set(l.ink);
    ink.uniforms.hazeCol.value.set(l.sky.horizon);
    ao.blendIntensity = l.ao ?? 0.65;
    haze = l.haze ?? haze;
  }
  setLook(look);

  function renderNormals() {
    const bg = scene.background;
    scene.background = null; scene.overrideMaterial = normalMat;
    camera.layers.disable(NO_INK);
    renderer.setRenderTarget(normalTarget);
    renderer.setClearColor(0x8080ff, 1); renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    camera.layers.enable(NO_INK);
    scene.overrideMaterial = null; scene.background = bg;
  }

  function resize(nw: number, nh: number) {
    w = Math.max(1, nw); h = Math.max(1, nh);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    normalTarget.setSize(w * dpr, h * dpr);
    ao.setSize(Math.round((w * dpr) / 2), Math.round((h * dpr) / 2));   // AO at half resolution (performance.md)
    ink.uniforms.texel.value.set(1 / (w * dpr), 1 / (h * dpr));
  }
  resize(w, h);

  function setView(target: THREE.Vector3, viewWidth: number) {
    // shadows: a frustum fitted to the view, snapped to texels so edges do not crawl (render-pipeline §5)
    const half = viewWidth * 0.75 + 20;
    const sc = key.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 1200;
    const texel = (2 * half) / key.shadow.mapSize.x;
    const t = target.clone();
    t.x = Math.round(t.x / texel) * texel; t.y = Math.round(t.y / texel) * texel; t.z = 0;
    key.target.position.copy(t); key.position.copy(t).add(keyOffset);
    rim.target.position.copy(t); rim.position.set(t.x - keyOffset.x, t.y - keyOffset.y, 120);
    key.target.updateMatrixWorld(); rim.target.updateMatrixWorld(); sc.updateProjectionMatrix();
    // ink: full width at street, thinning to none past ~560 m (camera.md §2)
    const inkT = between(viewWidth, ZOOM.street, ZOOM.neighbourhood), inkFade = between(viewWidth, ZOOM.neighbourhood, 560);
    ink.uniforms.width.value = viewWidth > 560 ? 0 : THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.5, 1.0, inkT), 0, inkFade);
    ink.uniforms.depthRange.value = camera.far - camera.near;
    // haze: street -> neighbourhood -> overview (render-pipeline §6)
    ink.uniforms.hazeAmt.value = viewWidth <= ZOOM.neighbourhood
      ? THREE.MathUtils.lerp(haze.street, haze.neighbourhood, between(viewWidth, ZOOM.street, ZOOM.neighbourhood))
      : THREE.MathUtils.lerp(haze.neighbourhood, haze.overview, between(viewWidth, ZOOM.neighbourhood, ZOOM.neighbourhood * 4));
    ao.updateGtaoMaterial({ radius: THREE.MathUtils.lerp(1.6, 3.0, between(viewWidth, ZOOM.street, 560)) });
  }

  return {
    renderer, scene, camera, key, hemi,
    render() { renderNormals(); composer.render(); },
    resize, setView, setLook,
    dispose() { composer.dispose(); normalTarget.dispose(); renderer.dispose(); },
  };
}

export interface PlinthLook { soil: C; rock: C; lip: C; depth?: number }

/** The world's edge (render-pipeline §7): the area's boundary polygon extruded down into a plinth with a
 *  soil-to-rock face and a pale lip. Pass scene.area.boundary; a constructed world passes its rectangle. */
export function buildPlinth(boundary: number[][], look: PlinthLook): THREE.Group {
  const g = new THREE.Group();
  const depth = look.depth ?? 8;
  const shape = new THREE.Shape(boundary.map(([x, y]) => new THREE.Vector2(x, y)));
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#' + new THREE.Color(look.lip).getHexString());          // pale lip along the top edge
  grad.addColorStop(0.06, '#' + new THREE.Color(look.lip).getHexString());
  grad.addColorStop(0.065, '#' + new THREE.Color(look.soil).getHexString());
  grad.addColorStop(0.45, '#' + new THREE.Color(look.soil).getHexString());
  grad.addColorStop(0.55, '#' + new THREE.Color(look.rock).getHexString());
  grad.addColorStop(1, '#' + new THREE.Color(look.rock).multiplyScalar(0.8).getHexString());
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 4, 128);
  const strata = new THREE.CanvasTexture(c);
  strata.colorSpace = THREE.SRGBColorSpace;
  const body = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  // side faces: v follows height so the strata read as layers
  const pos = body.getAttribute('position'), uv = body.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0, 1 - pos.getZ(i) / depth);
  const side = new THREE.Mesh(body, new THREE.MeshLambertMaterial({ map: strata }));
  side.position.z = -depth - 0.02;
  side.receiveShadow = true;
  g.add(side);
  return g;
}
