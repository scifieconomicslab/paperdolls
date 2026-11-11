import * as THREE from 'three';
/** the data lens: one shared uniform (0 = beauty view, 1 = lens). Materials that call lensify() desaturate toward their luminance as it rises. */
export const lensU = { value: 0 };
export function lensify<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLens = lensU;
    sh.fragmentShader = 'uniform float uLens;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))) * 1.04, uLens * 0.85);');
  };
  m.customProgramCacheKey = () => 'lens1';
  return m;
}
/** material for roofs and caps: carries data colour (never desaturated) and a per-instance hatch flag for "no data" (45 degree stripes, 0.6 m) */
export function dataMaterial(m: THREE.Material): THREE.Material {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aHatch;\nvarying float vHatch;\nvarying vec3 vWp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vHatch = aHatch;\n  #ifdef USE_INSTANCING\n  vWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n  #else\n  vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  #endif');
    sh.fragmentShader = 'varying float vHatch;\nvarying vec3 vWp;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  if (vHatch > 0.5) { float s = step(0.5, fract((vWp.x + vWp.y) / 0.6)); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, s); }');
  };
  m.customProgramCacheKey = () => 'data1';
  return m;
}
