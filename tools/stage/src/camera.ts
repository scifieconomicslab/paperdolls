// paperdolls stage: the dimetric orthographic camera rig (scene-craft recipes/camera.md).
// 30° elevation, 45° azimuth, z-up; three named shots; pan, zoom, 90° rotation, fit; easing; snapshot shots.
// The overview fits the world's boundary as projected on screen, so the city fills the frame at any angle.
// Vendored into worlds/<name>/page/src/stage/ by tools/stage/vendor.mjs. Do not edit the copy.
import * as THREE from 'three';

export const ZOOM = { streetMin: 40, street: 62, neighbourhood: 220 } as const;
export const DIST = 1500;
const EL = THREE.MathUtils.degToRad(30), AZ = THREE.MathUtils.degToRad(45);

export type ShotName = 'overview' | 'neighbourhood' | 'street';
export interface CamState { target: THREE.Vector3; width: number; az: number; el: number }
export interface RigOptions {
  /** scene.area.boundary, or the world's rectangle as four corners */
  boundary: number[][];
  /** what the opening (neighbourhood) shot frames: the landmark or the art bible's subject */
  subject?: THREE.Vector3;
  /** what the street shot frames: the most characteristic block (the style frame) */
  streetSubject?: THREE.Vector3;
  reduced?: boolean;       // prefers-reduced-motion
  snapshot?: boolean;      // no easing, no input
}
export interface CameraRig {
  state: CamState;
  place(): void;
  easeTo(to: Partial<CamState>, ms?: number): void;
  /** advance easing; true while moving */
  update(nowMs: number): boolean;
  shot(name: ShotName, angleDeg?: number, instant?: boolean): void;
  top(): void;
  fit(): void;
  rotate(dir: 1 | -1): void;
  zoomBy(k: number, anchor?: { x: number; y: number }): void;
  attach(el: HTMLElement): () => void;
  setAspect(a: number): void;
  /** called after every camera move: wire stage.setView(state.target, state.width) here */
  onChange: (() => void) | null;
}

/** ground vectors for an azimuth: screen-right and screen-up, both on z = 0 */
function axes(az: number) {
  const up = new THREE.Vector2(-Math.cos(az), -Math.sin(az));
  return { right: new THREE.Vector2(up.y, -up.x), up };
}

/** camera.md §3: put the subject on a thirds point, the city extending behind it */
export function thirdsTarget(subject: THREE.Vector3, width: number, az: number) {
  const { right, up } = axes(az);
  const k = width * 0.15 * 0.7;
  return new THREE.Vector3(subject.x + (right.x - up.x) * k, subject.y + (right.y - up.y) * k, 0);
}

export function createCameraRig(camera: THREE.OrthographicCamera, o: RigOptions): CameraRig {
  const pts = o.boundary;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const ext = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const centre = new THREE.Vector3((ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2, 0);
  const subject = o.subject ?? centre;
  const streetSubject = o.streetSubject ?? subject;
  let aspect = 16 / 10;

  /** the overview: target and width that fit the projected boundary with a 6 % margin */
  function overviewFor(az: number, el: number) {
    const { right, up } = axes(az);
    const s = Math.sin(el);
    let rx0 = Infinity, rx1 = -Infinity, uy0 = Infinity, uy1 = -Infinity;
    for (const [x, y] of pts) {
      const dx = x - centre.x, dy = y - centre.y;
      const rx = dx * right.x + dy * right.y, uy = (dx * up.x + dy * up.y) * s;   // ground depth foreshortens by sin(el)
      rx0 = Math.min(rx0, rx); rx1 = Math.max(rx1, rx); uy0 = Math.min(uy0, uy); uy1 = Math.max(uy1, uy);
    }
    const mx = (rx0 + rx1) / 2, my = (uy0 + uy1) / 2 / s;
    const target = new THREE.Vector3(centre.x + right.x * mx + up.x * my, centre.y + right.y * mx + up.y * my, 0);
    // leave room above for the plinth face and below for the dock: 6 % margin, slightly more vertically
    const width = Math.max(rx1 - rx0, (uy1 - uy0) * aspect * 1.04) * 1.06;
    return { target, width, az, el };
  }

  const state: CamState = { ...overviewFor(AZ, EL) };
  let ease: { from: CamState; to: CamState; t0: number; ms: number } | null = null;
  let element: HTMLElement | null = null;

  const rig: CameraRig = {
    state, place, easeTo, update, shot, top, fit, rotate, zoomBy, attach,
    setAspect(a) { aspect = a; place(); },
    onChange: null,
  };

  function clamp() {
    const maxW = overviewFor(state.az, EL).width * 1.45;
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
    const goal: CamState = { ...copy(state), ...to, target: (to.target ?? state.target).clone() };
    if (o.reduced || o.snapshot || ms <= 0) { Object.assign(state, goal); place(); return; }
    let d = goal.az - state.az;                                   // rotate the short way
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    goal.az = state.az + d;
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

  function shot(name: ShotName, angleDeg = 0, instant = false) {
    const az = AZ + THREE.MathUtils.degToRad(angleDeg);
    const goal: CamState = name === 'overview'
      ? overviewFor(az, EL)
      : name === 'neighbourhood'
        ? { target: thirdsTarget(subject, ZOOM.neighbourhood, az), width: ZOOM.neighbourhood, az, el: EL }
        : { target: streetSubject.clone().setZ(0), width: ZOOM.street, az, el: EL };
    easeTo(goal, instant ? 0 : 450);
  }

  function top() {
    const f = overviewFor(AZ, EL);
    Object.assign(state, { target: centre.clone(), width: Math.max(ext.x1 - ext.x0, (ext.y1 - ext.y0) * aspect) * 1.06, az: f.az, el: THREE.MathUtils.degToRad(89.9) });
    place();
  }

  function fit() { easeTo(overviewFor(state.az, EL), 350); }
  function rotate(dir: 1 | -1) { easeTo({ az: state.az + (dir * Math.PI) / 2 }, 380); }

  /** the ground point under a canvas pixel */
  function groundAt(px: number, py: number, w: number, h: number) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((px / w) * 2 - 1, -(py / h) * 2 + 1), camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit) ? hit : null;
  }

  function zoomBy(k: number, anchor?: { x: number; y: number }) {
    if (!element || !anchor) { easeTo({ width: state.width / k }, 250); return; }
    const w = element.clientWidth, h = element.clientHeight;
    const before = groundAt(anchor.x, anchor.y, w, h);
    state.width /= k; place();
    const after = groundAt(anchor.x, anchor.y, w, h);
    if (before && after) { state.target.add(before.sub(after)); place(); }
  }

  function attach(el: HTMLElement) {
    if (o.snapshot) return () => {};
    element = el;
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
    const pointers = new Map<number, { x: number; y: number }>();
    let last: { x: number; y: number } | null = null, pinch0 = 0;
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      last = { x: e.offsetX, y: e.offsetY }; el.style.cursor = 'grabbing'; ease = null;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) zoomBy(d / pinch0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        pinch0 = d; return;
      }
      if (!last) return;
      const g0 = groundAt(last.x, last.y, el.clientWidth, el.clientHeight), g1 = groundAt(e.offsetX, e.offsetY, el.clientWidth, el.clientHeight);
      if (g0 && g1) { state.target.add(g0.sub(g1)); place(); }
      last = { x: e.offsetX, y: e.offsetY };
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (!pointers.size) { last = null; el.style.cursor = 'grab'; }
      pinch0 = 0;
    };
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
      else if (k === 'e') rotate(1);
      else if (k === 'f') fit();
    };
    let raf = 0, prev = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      if (!held.size) return;
      const sp = state.width * 0.8 * dt;
      const { right, up } = axes(state.az);
      if (held.has('w')) state.width /= Math.exp(1.2 * dt);
      if (held.has('s')) state.width *= Math.exp(1.2 * dt);
      if (held.has('a') || held.has('arrowleft')) { state.target.x -= right.x * sp; state.target.y -= right.y * sp; }
      if (held.has('d') || held.has('arrowright')) { state.target.x += right.x * sp; state.target.y += right.y * sp; }
      if (held.has('arrowup')) { state.target.x += up.x * sp; state.target.y += up.y * sp; }
      if (held.has('arrowdown')) { state.target.x -= up.x * sp; state.target.y -= up.y * sp; }
      place();
    };
    raf = requestAnimationFrame(tick);
    const blur = () => held.clear();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', blur);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', blur);
    };
  }

  place();
  return rig;
}
