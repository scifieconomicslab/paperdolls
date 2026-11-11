// Step 1 of the build order: renderer, composer (GTAO + ink + SMAA + output), lights,
// background gradient, fog, shadows fitted to the view, and the diorama plinth.
// recipes: render-pipeline.md, light-and-time.md
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { hex, P, LIGHT } from './palette.ts';
import { NO_INK, canvasTex, houseMat, valueNoise, col } from './util.ts';

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
      float dE = max(max(D(vec2(1.,0.)) - d0, D(vec2(-1.,0.)) - d0), max(D(vec2(0.,1.)) - d0, D(vec2(0.,-1.)) - d0));
      vec3 n0 = N(vec2(0.0));
      float nE = max(max(1.0 - dot(n0, N(vec2(1.,0.))), 1.0 - dot(n0, N(vec2(-1.,0.)))),
                     max(1.0 - dot(n0, N(vec2(0.,1.))), 1.0 - dot(n0, N(vec2(0.,-1.)))));
      float e = max(smoothstep(depthThresh, depthThresh * 2.0, dE), smoothstep(normalThresh, normalThresh * 2.0, nE));
      vec3 inkCol = mix(col.rgb * 0.35, inkHue, 0.35);
      gl_FragColor = vec4(mix(col.rgb, inkCol, e * inkAmount), col.a);
    }`,
};

export interface Pipeline {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  key: THREE.DirectionalLight;
  render(): void;
  resize(w: number, h: number): void;
  fitShadow(target: THREE.Vector3, viewWidth: number): void;
  setView(viewWidth: number, camDist: number, viewH: number, lens: number): void;
  dispose(): void;
}

export function createPipeline(canvas: HTMLCanvasElement): Pipeline {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = LIGHT.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-100, 100, 60, -60, 1, 3000);
  camera.up.set(0, 0, 1);
  camera.layers.enable(NO_INK);

  // background: vertical gradient sky top -> horizon (render-pipeline §6)
  scene.background = canvasTex(2, 256, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, hex(P.skyTop));
    gr.addColorStop(0.75, hex(P.horizon));
    gr.addColorStop(1, hex(P.horizon));
    g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  });
  const horizon = new THREE.Color(hex(P.horizon));
  scene.fog = new THREE.Fog(horizon, 1000, 4000);

  // lights (light-and-time §1)
  const ground = col(P.ground);
  const hemi = new THREE.HemisphereLight(LIGHT.fill, ground.clone().multiplyScalar(0.6), LIGHT.fillIntensity);
  hemi.up.set(0, 0, 1);
  const key = new THREE.DirectionalLight(LIGHT.key, LIGHT.keyIntensity);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.4;
  const rim = new THREE.DirectionalLight(LIGHT.fill, 0.25);
  const az = THREE.MathUtils.degToRad(LIGHT.keyAzimuthDeg), el = THREE.MathUtils.degToRad(LIGHT.keyElevationDeg);
  const keyOffset = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)).multiplyScalar(400);
  rim.position.set(-keyOffset.x, -keyOffset.y, 120);
  scene.add(hemi, key, key.target, rim);

  // composer
  let w = canvas.clientWidth || 1440, h = canvas.clientHeight || 900;
  const normalTarget = new THREE.WebGLRenderTarget(w * dpr, h * dpr, { type: THREE.HalfFloatType });
  normalTarget.depthTexture = new THREE.DepthTexture(w * dpr, h * dpr);
  normalTarget.depthTexture.type = THREE.UnsignedIntType;
  const normalMat = new THREE.MeshNormalMaterial();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, w, h);
  // share our normal/depth G-buffer with GTAO (saves a scene pass). three r180's setGBuffer() reads
  // this.normalRenderTarget even for an external buffer, so give it a stand-in that does not resize ours.
  (ao as any).normalRenderTarget.dispose();
  (ao as any).normalRenderTarget = { depthTexture: normalTarget.depthTexture, setSize() {}, dispose() {} };
  ao.setGBuffer(normalTarget.depthTexture, normalTarget.texture);
  ao.blendIntensity = 0.65;
  ao.updateGtaoMaterial({ radius: 2.0, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 16 });
  composer.addPass(ao);
  const ink = new ShaderPass(InkShader);
  ink.uniforms.tNormal.value = normalTarget.texture;
  ink.uniforms.tDepth.value = normalTarget.depthTexture;
  ink.uniforms.inkHue.value = new THREE.Color(hex(P.ink));
  composer.addPass(ink);
  const smaa = new SMAAPass();
  composer.addPass(smaa);
  composer.addPass(new OutputPass());

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

  function resize(nw: number, nh: number) {
    w = Math.max(1, nw); h = Math.max(1, nh);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    normalTarget.setSize(w * dpr, h * dpr);
    ao.setSize(Math.round(w * dpr / 2), Math.round(h * dpr / 2));  // performance.md: AO at half resolution
    ink.uniforms.texel.value.set(1 / (w * dpr), 1 / (h * dpr));
  }
  resize(w, h);

  function fitShadow(target: THREE.Vector3, viewWidthM: number) {
    const half = viewWidthM * 0.75 + 20;
    const cam = key.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.near = 1; cam.far = 1200;
    const texel = (2 * half) / key.shadow.mapSize.x;
    const t = target.clone();
    t.x = Math.round(t.x / texel) * texel; t.y = Math.round(t.y / texel) * texel;
    key.target.position.copy(t);
    key.position.copy(t).add(keyOffset);
    key.target.updateMatrixWorld();
    cam.updateProjectionMatrix();
    rim.target.position.copy(t); rim.position.set(t.x - keyOffset.x, t.y - keyOffset.y, 120); rim.target.updateMatrixWorld();
  }

  /** Per-zoom: ink width, AO radius, fog (camera.md §2, render-pipeline §6). */
  function setView(viewWidth: number, camDist: number, viewH: number, lens: number) {
    const t = THREE.MathUtils.clamp((viewWidth - 60) / (220 - 60), 0, 1);
    const t2 = THREE.MathUtils.clamp((viewWidth - 220) / (560 - 220), 0, 1);
    ink.uniforms.width.value = viewWidth > 560 ? 0 : THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.5, 1.0, t), 0.0, t2);
    ink.uniforms.inkAmount.value = 0.85 + 0.1 * lens;
    ink.uniforms.depthRange.value = camera.far - camera.near;
    const fog = scene.fog as THREE.Fog;
    const k = THREE.MathUtils.clamp((viewWidth - 100) / 600, 0, 1);
    fog.near = camDist + viewH * THREE.MathUtils.lerp(1.2, 0.2, k);
    fog.far = camDist + viewH * THREE.MathUtils.lerp(6, 2.2, k);
    ao.updateGtaoMaterial({ radius: THREE.MathUtils.lerp(1.6, 3.0, THREE.MathUtils.clamp((viewWidth - 60) / 500, 0, 1)) });
  }

  return {
    renderer, scene, camera, key,
    render() { renderNormals(); composer.render(); },
    resize, fitShadow, setView,
    dispose() { composer.dispose(); normalTarget.dispose(); renderer.dispose(); },
  };
}

/** The world edge: a diorama plinth 8 m deep with soil and rock strata and a pale stone lip (render-pipeline §7),
 *  plus a lawn verge between the outer roads and the lip. */
export function buildPlinth(bounds: { x0: number; y0: number; x1: number; y1: number }, holes: number[][][] = []) {
  const g = new THREE.Group();
  const { x0, y0, x1, y1 } = bounds;
  const W = x1 - x0, H = y1 - y0, depth = 8;
  const strata = canvasTex(8, 256, (c) => {
    const bands: [number, string][] = [[0, hex([P.soil[0] - 0.02, P.soil[1], P.soil[2]])], [0.2, hex(P.soil)], [0.42, hex([P.soil[0] - 0.08, P.soil[1], P.soil[2] + 4])],
      [0.62, hex(P.rock)], [0.83, hex([P.rock[0] - 0.06, P.rock[1], P.rock[2]])]];
    bands.forEach(([y, c2], i) => { c.fillStyle = c2; c.fillRect(0, y * 256, 8, ((bands[i + 1]?.[0] ?? 1) - y) * 256); });
    c.fillStyle = 'rgba(255,255,255,0.12)'; for (let i = 0; i < 40; i++) c.fillRect(0, 60 + i * 5, 8, 1);
  });
  const sideMat = houseMat({ map: strata, lensK: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, depth), sideMat);
  // box uv on side faces maps v to height: good for strata
  body.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.5 - depth / 2);
  body.receiveShadow = true;
  g.add(body);
  // lip (pale stone) and verge lawn
  // lip: a pale stone ring around the edge only (a full slab would cover the pond)
  const lipMat = houseMat({ color: hex([0.86, 0.012, 80]) });
  for (const [cx, cy, sx, sy] of [[(x0 + x1) / 2, y0, W + 0.6, 0.9], [(x0 + x1) / 2, y1, W + 0.6, 0.9], [x0, (y0 + y1) / 2, 0.9, H], [x1, (y0 + y1) / 2, 0.9, H]]) {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.36), lipMat);
    lip.position.set(cx, cy, -0.18 + 0.01); lip.receiveShadow = true;
    g.add(lip);
  }
  const noise = valueNoise(77);
  const lawnTex = canvasTex(256, 256, (c) => {
    const im = c.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const n = noise(x / 22, y / 22) * 0.6 + noise(x / 6, y / 6) * 0.4;
      const v = 232 + (n - 0.5) * 40; const i = (y * 256 + x) * 4;
      im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v; im.data[i + 3] = 255;
    }
    c.putImageData(im, 0, 0);
  }, true);
  lawnTex.repeat.set(W / 40, H / 40);
  const shape = new THREE.Shape([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]);
  for (const hp of holes) shape.holes.push(new THREE.Path(hp.map(([x, y]) => new THREE.Vector2(x, y))));
  const vg = new THREE.ShapeGeometry(shape);
  const uv = vg.getAttribute('uv'), pos = vg.getAttribute('position');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 40, pos.getY(i) / 40);
  lawnTex.repeat.set(1, 1);
  const verge = new THREE.Mesh(vg, houseMat({ color: hex(P.lawn), map: lawnTex, lambert: true, lensK: 0.6 }));
  verge.position.z = 0;
  verge.receiveShadow = true;
  g.add(verge);
  return g;
}
