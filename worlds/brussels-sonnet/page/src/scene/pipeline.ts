import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { P, LIGHT, hex } from './palette';

export const NO_INK = 2;

const InkShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null }, tNormal: { value: null as THREE.Texture | null }, tDepth: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1, 1) },
    width: { value: 1.5 }, depthRange: { value: 3000 }, depthThresh: { value: 0.6 }, normalThresh: { value: 0.35 },
    inkHue: { value: new THREE.Color(hex(P.ink)) }, inkAmount: { value: 0.85 },
    hazeCol: { value: new THREE.Color(hex(P.horizon)) }, hazeAmt: { value: 0.1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tNormal, tDepth;
    uniform vec2 texel; uniform float width, depthRange, depthThresh, normalThresh, inkAmount, hazeAmt;
    uniform vec3 inkHue, hazeCol; varying vec2 vUv;
    float D(vec2 o){ return texture2D(tDepth, vUv + o * texel * max(width,1.0)).r * depthRange; }
    vec3  N(vec2 o){ return texture2D(tNormal, vUv + o * texel * max(width,1.0)).rgb * 2.0 - 1.0; }
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
        vec3 inkCol = mix(col.rgb * 0.35, inkHue, 0.35);
        outCol = mix(col.rgb, inkCol, e * inkAmount);
      }
      float isGeo = step(texture2D(tDepth, vUv).r, 0.9999);
      float far = smoothstep(0.35, 1.0, vUv.y);
      outCol = mix(outCol, hazeCol, isGeo * far * far * hazeAmt);
      gl_FragColor = vec4(outCol, col.a);
    }`,
};

export function makeToonRamp(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([150, 210, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}

export interface Pipeline {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera;
  key: THREE.DirectionalLight; hemi: THREE.HemisphereLight; ao: GTAOPass; ink: ShaderPass;
  render(): void; resize(): void; fitShadow(target: THREE.Vector3, viewW: number): void; setZoom(viewW: number): void;
  toon: THREE.DataTexture; info(): { calls: number; tris: number };
}

export function createPipeline(canvas: HTMLCanvasElement): Pipeline {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = LIGHT.exposure;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);
  const W = () => canvas.clientWidth || window.innerWidth, H = () => canvas.clientHeight || window.innerHeight;
  renderer.setSize(W(), H(), false);

  const scene = new THREE.Scene();
  // sky gradient background (screen-mapped)
  const gc = document.createElement('canvas'); gc.width = 2; gc.height = 256; const gx = gc.getContext('2d')!;
  const gr = gx.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, hex(P.skyTop)); gr.addColorStop(1, hex(P.horizon));
  gx.fillStyle = gr; gx.fillRect(0, 0, 2, 256);
  const bg = new THREE.CanvasTexture(gc); bg.colorSpace = THREE.SRGBColorSpace; scene.background = bg;

  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 6000); camera.up.set(0, 0, 1);
  camera.layers.enable(NO_INK);

  // lights (bible: warm key from SW, cool sky fill)
  const hemi = new THREE.HemisphereLight(LIGHT.fillHex, new THREE.Color(hex(P.ground)).multiplyScalar(0.6), LIGHT.hemiI);
  hemi.position.set(0, 0, 1); (hemi as any).up?.set?.(0, 0, 1);
  const key = new THREE.DirectionalLight(LIGHT.keyHex, LIGHT.keyI);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.4;
  const rim = new THREE.DirectionalLight(LIGHT.fillHex, 0.25);
  const az = THREE.MathUtils.degToRad(LIGHT.keyAz), el = THREE.MathUtils.degToRad(LIGHT.keyEl);
  const keyOffset = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)).multiplyScalar(900);
  rim.position.set(-keyOffset.x * 0.5, -keyOffset.y * 0.5, 120);
  scene.add(hemi, key, key.target, rim);

  // normal + depth target shared by ink / AO
  const normalTarget = new THREE.WebGLRenderTarget(W() * dpr, H() * dpr, { type: THREE.HalfFloatType });
  normalTarget.depthTexture = new THREE.DepthTexture(W() * dpr, H() * dpr); normalTarget.depthTexture.type = THREE.UnsignedIntType;
  const normalMat = new THREE.MeshNormalMaterial();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, W(), H());
  (ao as any).normalRenderTarget.dispose();
  (ao as any).normalRenderTarget = { depthTexture: normalTarget.depthTexture, setSize() {}, dispose() {} };
  ao.setGBuffer(normalTarget.depthTexture, normalTarget.texture);
  ao.blendIntensity = 0.65;
  ao.updateGtaoMaterial({ radius: 2.0, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 16 });
  composer.addPass(ao);
  const ink = new ShaderPass(InkShader as any);
  composer.addPass(ink);
  composer.addPass(new SMAAPass());
  composer.addPass(new OutputPass());

  const u = (ink.uniforms as any);
  function resize() {
    const w = W(), h = H(); renderer.setSize(w, h, false); composer.setSize(w, h);
    normalTarget.setSize(w * dpr, h * dpr); ao.setSize(w, h);
    u.texel.value.set(1 / (w * dpr), 1 / (h * dpr));
    camera.userData.aspect = w / h;
  }
  resize();
  window.addEventListener('resize', () => { resize(); (pipe as any).onResize?.(); });

  function renderNormals() {
    const b = scene.background, f = scene.fog; scene.background = null; scene.fog = null; scene.overrideMaterial = normalMat;
    camera.layers.disable(NO_INK);
    renderer.setRenderTarget(normalTarget); renderer.setClearColor(0x8080ff, 1); renderer.clear(); renderer.render(scene, camera); renderer.setRenderTarget(null);
    camera.layers.enable(NO_INK); scene.overrideMaterial = null; scene.background = b; scene.fog = f;
  }
  function render() {
    u.tNormal.value = normalTarget.texture; u.tDepth.value = normalTarget.depthTexture; u.depthRange.value = camera.far - camera.near;
    renderNormals(); composer.render();
  }
  const keyOff = keyOffset.clone();
  function fitShadow(target: THREE.Vector3, viewW: number) {
    const half = viewW * 0.75 + 20; const cam = key.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 1; cam.far = 2400;
    const texel = (2 * half) / key.shadow.mapSize.x; const t = target.clone();
    t.x = Math.round(t.x / texel) * texel; t.y = Math.round(t.y / texel) * texel; t.z = 0;
    key.target.position.copy(t); key.position.copy(t).add(keyOff); cam.updateProjectionMatrix(); key.target.updateMatrixWorld();
  }
  // ink width / haze / AO radius from the one number: view width in metres
  function setZoom(w: number) {
    const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
    let ink = 0, haze = 0.26;
    if (w <= 60) { ink = 1.5; haze = 0.06; }
    else if (w <= 220) { const t = (w - 60) / 160; ink = lerp(1.5, 1.0, t); haze = lerp(0.06, 0.16, t); }
    else if (w <= 900) { const t = (w - 220) / 680; ink = lerp(1.0, 0.0, t); haze = lerp(0.16, 0.26, t); }
    u.width.value = ink; u.hazeAmt.value = haze;
    ao.updateGtaoMaterial({ radius: w <= 70 ? 1.6 : w <= 260 ? 2.2 : 3.0, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 16 });
  }
  const pipe: Pipeline & { onResize?: () => void } = {
    renderer, scene, camera, key, hemi, ao, ink, render, resize, fitShadow, setZoom, toon: makeToonRamp(),
    info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
  };
  return pipe;
}
