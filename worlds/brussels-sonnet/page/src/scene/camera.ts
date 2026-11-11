import * as THREE from 'three';
import type { Pipeline } from './pipeline';

export interface Shot { target: THREE.Vector3; viewW: number }
export class CameraRig {
  target = new THREE.Vector3(); viewW = 240; azDeg = -45; elDeg = 30; DIST = 2000;
  centre = new THREE.Vector3();
  hull: number[][] | null = null;
  bounds = { x0: -1700, x1: 1700, y0: -1700, y1: 1700 };
  constructor(public pipe: Pipeline, public onView: (target: THREE.Vector3, viewW: number) => void) {}
  get aspect() { return (this.pipe.camera.userData.aspect as number) || window.innerWidth / window.innerHeight; }
  place() {
    const cam = this.pipe.camera, el = THREE.MathUtils.degToRad(this.elDeg), az = THREE.MathUtils.degToRad(this.azDeg);
    const t = this.target;
    cam.position.set(t.x + this.DIST * Math.cos(el) * Math.cos(az), t.y + this.DIST * Math.cos(el) * Math.sin(az), t.z + this.DIST * Math.sin(el));
    cam.up.set(0, 0, 1); if (this.elDeg >= 89.5) cam.up.set(0, 1, 0);
    cam.lookAt(t);
    const hw = this.viewW / 2, a = this.aspect; cam.left = -hw; cam.right = hw; cam.top = hw / a; cam.bottom = -hw / a; cam.near = 1; cam.far = this.DIST * 2.4; cam.updateProjectionMatrix();
    this.pipe.setZoom(this.viewW); if (this.elDeg >= 89) (this.pipe.ink.uniforms as any).hazeAmt.value = 0; this.pipe.fitShadow(t, this.viewW * Math.max(1, 1 / a)); this.onView(t, this.viewW);
  }
  /** view width that fits the whole world at the current azimuth/elevation */
  fitWidth(): number {
    const pts = this.hull ?? [[this.bounds.x0, this.bounds.y0], [this.bounds.x1, this.bounds.y0], [this.bounds.x0, this.bounds.y1], [this.bounds.x1, this.bounds.y1]]; const az = THREE.MathUtils.degToRad(this.azDeg), el = THREE.MathUtils.degToRad(this.elDeg);
    const right = new THREE.Vector3(-Math.sin(az), Math.cos(az), 0); const up = new THREE.Vector3(-Math.cos(az) * Math.sin(el), -Math.sin(az) * Math.sin(el), Math.cos(el));
    let rmin = 1e9, rmax = -1e9, umin = 1e9, umax = -1e9;
    for (const [x, y] of pts) { const r = x * right.x + y * right.y, u = x * up.x + y * up.y; rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); umin = Math.min(umin, u); umax = Math.max(umax, u); }
    const a = this.aspect; { const rc = (rmin + rmax) / 2, uc = (umin + umax) / 2, f = new THREE.Vector3(-Math.cos(az), -Math.sin(az), 0), sn = Math.max(0.05, Math.sin(el)); this.centre.set(right.x * rc + f.x * (uc / sn), right.y * rc + f.y * (uc / sn), 0); }
    return Math.max((rmax - rmin) * 1.06, (umax - umin) * 1.06 * a);
  }
  set(shot: Shot, azDeg?: number, elDeg?: number) { this.target.copy(shot.target); this.viewW = shot.viewW; if (azDeg !== undefined) this.azDeg = azDeg; if (elDeg !== undefined) this.elDeg = elDeg; this.place(); }
}

/** pointer + keyboard controls (camera recipe §4); instant moves, no easing needed for the controls themselves */
export function attachControls(canvas: HTMLCanvasElement, rig: CameraRig, fit: () => void) {
  let drag: { x: number; y: number } | null = null;
  const pan = (dxPx: number, dyPx: number) => {
    const mPerPx = rig.viewW / canvas.clientWidth; const az = THREE.MathUtils.degToRad(rig.azDeg);
    const right = new THREE.Vector3(-Math.sin(az), Math.cos(az), 0); const fwd = new THREE.Vector3(-Math.cos(az), -Math.sin(az), 0);
    const k = mPerPx / Math.sin(THREE.MathUtils.degToRad(rig.elDeg)) * 1;
    rig.target.addScaledVector(right, -dxPx * mPerPx).addScaledVector(fwd, dyPx * k); clampT(); rig.place();
  };
  const clampT = () => { const b = rig.bounds; rig.target.x = Math.min(b.x1 + 300, Math.max(b.x0 - 300, rig.target.x)); rig.target.y = Math.min(b.y1 + 300, Math.max(b.y0 - 300, rig.target.y)); };
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointerup', () => { drag = null; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; pan(e.clientX - drag.x, e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const f = Math.exp(e.deltaY * 0.0012); rig.viewW = Math.min(rig.fitWidth() * 1.2, Math.max(40, rig.viewW * f)); rig.place(); }, { passive: false });
  canvas.style.cursor = 'grab';
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase(); const st = rig.viewW * 0.05;
    if (k === 'f') { fit(); } else if (k === 'q') { rig.azDeg -= 90; rig.place(); } else if (k === 'e' || k === 'r') { rig.azDeg += 90; rig.place(); }
    else if (k === 'w') { rig.viewW = Math.max(40, rig.viewW * 0.9); rig.place(); } else if (k === 's') { rig.viewW = Math.min(rig.fitWidth() * 1.2, rig.viewW * 1.1); rig.place(); }
    else if (k === 'arrowleft' || k === 'a') pan(st / (rig.viewW / canvas.clientWidth), 0); else if (k === 'arrowright' || k === 'd') pan(-st / (rig.viewW / canvas.clientWidth), 0);
    else if (k === 'arrowup') pan(0, st / (rig.viewW / canvas.clientWidth)); else if (k === 'arrowdown') pan(0, -st / (rig.viewW / canvas.clientWidth));
  });
}
