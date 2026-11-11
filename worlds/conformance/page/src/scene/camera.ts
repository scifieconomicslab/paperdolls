// Step 8: the dimetric orthographic camera, zoom levels, the opening shot, controls and easing.
// Everything downstream (LOD, ink, fog, shadow fit) is driven by one number: view width. recipes: camera.md
import * as THREE from 'three';

export interface CamState { target: THREE.Vector3; width: number; az: number; el: number }
export interface CameraRig {
  state: CamState;
  place(): void;
  easeTo(to: Partial<CamState>, ms?: number): void;
  update(nowMs: number): boolean;            // returns true while easing
  attach(el: HTMLElement): () => void;
  zoomBy(k: number, anchor?: { x: number; y: number }): void;
  rotate(dir: 1 | -1): void;
  fit(): void;
  setAspect(a: number): void;
  onChange: (() => void) | null;
}

const DIST = 1500;
export const ZOOM = { streetMin: 40, street: 62, neighbourhood: 220 };

export function createCameraRig(camera: THREE.OrthographicCamera, extent: { x0: number; y0: number; x1: number; y1: number }, o: { reduced: boolean; snapshot: boolean }): CameraRig {
  const ext = extent;
  const overviewW = Math.hypot(ext.x1 - ext.x0, ext.y1 - ext.y0) * 1.0 * 1.1;
  const maxW = overviewW * 1.45;
  let aspect = 16 / 10;
  const state: CamState = { target: new THREE.Vector3((ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2, 0), width: overviewW, az: THREE.MathUtils.degToRad(45), el: THREE.MathUtils.degToRad(30) };
  let ease: { from: CamState; to: CamState; t0: number; ms: number } | null = null;
  const rig: CameraRig = { state, place, easeTo, update, attach, zoomBy, rotate, fit, setAspect: (a) => { aspect = a; place(); }, onChange: null };

  function clamp() {
    state.width = THREE.MathUtils.clamp(state.width, ZOOM.streetMin, maxW);
    const padX = (ext.x1 - ext.x0) * 0.2, padY = (ext.y1 - ext.y0) * 0.2;
    state.target.x = THREE.MathUtils.clamp(state.target.x, ext.x0 - padX, ext.x1 + padX);
    state.target.y = THREE.MathUtils.clamp(state.target.y, ext.y0 - padY, ext.y1 + padY);
  }
  function place() {
    clamp();
    const { target: t, az, el, width } = state;
    camera.position.set(t.x + DIST * Math.cos(el) * Math.cos(az), t.y + DIST * Math.cos(el) * Math.sin(az), t.z + DIST * Math.sin(el));
    if (el > 1.55) camera.up.set(-Math.cos(az), -Math.sin(az), 0); else camera.up.set(0, 0, 1);
    camera.lookAt(t);
    const hw = width / 2;
    camera.left = -hw; camera.right = hw; camera.top = hw / aspect; camera.bottom = -hw / aspect;
    camera.near = 1; camera.far = DIST * 2;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    rig.onChange?.();
  }
  const copy = (s: CamState): CamState => ({ target: s.target.clone(), width: s.width, az: s.az, el: s.el });
  function easeTo(to: Partial<CamState>, ms = 320) {
    const goal = { ...copy(state), ...to, target: (to.target ?? state.target).clone() } as CamState;
    if (o.reduced || o.snapshot || ms <= 0) { Object.assign(state, goal); place(); return; }
    // rotate the short way
    let d = goal.az - state.az; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; goal.az = state.az + d;
    ease = { from: copy(state), to: goal, t0: performance.now(), ms };
  }
  function update(now: number) {
    if (!ease) return false;
    const k = Math.min(1, (now - ease.t0) / ease.ms), e = 1 - Math.pow(1 - k, 3);
    state.target.lerpVectors(ease.from.target, ease.to.target, e);
    state.width = ease.from.width * Math.pow(ease.to.width / ease.from.width, e);
    state.az = ease.from.az + (ease.to.az - ease.from.az) * e;
    state.el = ease.from.el + (ease.to.el - ease.from.el) * e;
    place();
    if (k >= 1) ease = null;
    return true;
  }
  /** world point on z=0 under a canvas-relative pixel */
  function groundAt(px: number, py: number, w: number, h: number) {
    const ndc = new THREE.Vector3((px / w) * 2 - 1, -(py / h) * 2 + 1, 0);
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit) ? hit : null;
  }
  let el: HTMLElement | null = null;
  function zoomBy(k: number, anchor?: { x: number; y: number }) {
    if (!el || !anchor) { easeTo({ width: state.width / k }, 250); return; }
    const w = el.clientWidth, h = el.clientHeight;
    const before = groundAt(anchor.x, anchor.y, w, h);
    state.width /= k; place();
    const after = groundAt(anchor.x, anchor.y, w, h);
    if (before && after) { state.target.add(before.sub(after)); place(); }
  }
  function rotate(dir: 1 | -1) { easeTo({ az: state.az + dir * Math.PI / 2 }, 380); }
  function fit() { easeTo({ target: new THREE.Vector3((ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2, 0), width: overviewW, el: THREE.MathUtils.degToRad(30) }, 350); }

  function attach(element: HTMLElement) {
    el = element;
    element.style.touchAction = 'none';
    element.style.cursor = 'grab';
    const pointers = new Map<number, { x: number; y: number }>();
    let last: { x: number; y: number } | null = null, pinch0 = 0;
    const onDown = (e: PointerEvent) => {
      element.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      last = { x: e.offsetX, y: e.offsetY }; element.style.cursor = 'grabbing'; ease = null;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) zoomBy(d / pinch0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        pinch0 = d; return;
      }
      if (!last) return;
      const w = element.clientWidth, h = element.clientHeight;
      const g0 = groundAt(last.x, last.y, w, h), g1 = groundAt(e.offsetX, e.offsetY, w, h);
      if (g0 && g1) { state.target.add(g0.sub(g1)); place(); }
      last = { x: e.offsetX, y: e.offsetY };
    };
    const onUp = (e: PointerEvent) => { pointers.delete(e.pointerId); if (!pointers.size) { last = null; element.style.cursor = 'grab'; } pinch0 = 0; };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); ease = null; zoomBy(Math.exp(-e.deltaY * 0.0015), { x: e.offsetX, y: e.offsetY }); };
    const held = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.type === 'keyup') { held.delete(k); return; }
      if (['w', 's', 'a', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) { held.add(k); if (k.startsWith('arrow')) e.preventDefault(); }
      else if (k === 'q') rotate(-1);
      else if (k === 'e' || k === 'r') rotate(1);
      else if (k === 'f') fit();
    };
    let raf = 0, prev = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      if (!held.size) return;
      const sp = state.width * 0.8 * dt;
      const fx = -Math.cos(state.az), fy = -Math.sin(state.az);            // screen-up on the ground
      const rx = fy, ry = -fx;                                             // screen-right
      let moved = false;
      if (held.has('w')) { state.width /= Math.exp(1.2 * dt); moved = true; }
      if (held.has('s')) { state.width *= Math.exp(1.2 * dt); moved = true; }
      if (held.has('a') || held.has('arrowleft')) { state.target.x -= rx * sp; state.target.y -= ry * sp; moved = true; }
      if (held.has('d') || held.has('arrowright')) { state.target.x += rx * sp; state.target.y += ry * sp; moved = true; }
      if (held.has('arrowup')) { state.target.x += fx * sp; state.target.y += fy * sp; moved = true; }
      if (held.has('arrowdown')) { state.target.x -= fx * sp; state.target.y -= fy * sp; moved = true; }
      if (moved) place();
    };
    raf = requestAnimationFrame(tick);
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    element.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    const blur = () => held.clear();
    window.addEventListener('blur', blur);
    return () => {
      cancelAnimationFrame(raf);
      element.removeEventListener('pointerdown', onDown); element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp); element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', blur);
    };
  }
  return rig;
}

/** camera.md §3: subject on a thirds point — offset the target toward the lower-right third by 15 % of the view width,
 *  so the subject sits upper-left with the city extending behind it. */
export function thirdsTarget(subject: THREE.Vector3, width: number, az: number) {
  const fx = -Math.cos(az), fy = -Math.sin(az);   // screen-up on the ground
  const rx = fy, ry = -fx;                         // screen-right
  const k = width * 0.15;
  return new THREE.Vector3(subject.x + (rx - fx) * k * 0.7, subject.y + (ry - fy) * k * 0.7, 0);
}
export { DIST };
