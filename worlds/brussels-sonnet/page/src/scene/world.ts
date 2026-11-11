import * as THREE from 'three';
import { createPipeline } from './pipeline';
import { buildGround, buildMarkings, buildLamps, buildParked, buildCrossings, type GroundData } from './ground';
import { buildBuildings, type SceneBuilding, type Bd } from './buildings';
import { buildTrees } from './nature';
import { buildLife } from './life';
import { buildData, type DataHandle } from './data';
import { CameraRig, attachControls } from './camera';
import { P, hex } from './palette';
import type { BFrame } from '../sim/client';

export interface World3D {
  pipe: ReturnType<typeof createPipeline>; rig: CameraRig; bds: Bd[]; data: DataHandle; landmark: Bd; boundCount: number;
  applyFrame(b: BFrame): void; setLens(on: boolean): void; fit(): void; rotate(d: number): void; zoom(f: number): void; select(bi: number | null, frame?: boolean): void;
  onHover(cb: (bi: number | null, x: number, y: number) => void): void; onSelect(cb: (bi: number | null) => void): void; stats(): Record<string, number | string>; lifeCounts: Record<string, number>;
  setClockSpeed(s: number): void; markReady(): void; whenReady(): Promise<void>; renderOnce(): void; reduced: boolean;
}

export function createWorld(canvas: HTMLCanvasElement, scene: any, G: GroundData, opts: { snapshot: boolean; q: URLSearchParams; holdReady?: boolean }): World3D {
  const { snapshot, q } = opts;
  const pipe = createPipeline(canvas);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const g = buildGround(pipe, G, scene.landuse); pipe.scene.add(g.group);
  pipe.scene.add(buildMarkings(G.avenues)); pipe.scene.add(buildLamps(G.lines)); pipe.scene.add(buildCrossings(G.lines, G.avenues)); pipe.scene.add(buildParked(pipe, G.lines).group);
  const B = buildBuildings(pipe, scene.buildings as SceneBuilding[], G.lines); pipe.scene.add(B.group);
  pipe.scene.add(buildTrees(pipe, scene.trees));
  const bound = Uint8Array.from(B.bds.map((b) => (b.bound ? 1 : 0)));
  const data = buildData(pipe, B, bound); pipe.scene.add(data.group);

  const rig = new CameraRig(pipe, (t, w) => { B.setView(t, w); data.setView(w); life?.setView?.(w); });
  const xs = g.bounds.map((p) => p.x), ys = g.bounds.map((p) => p.y);
  rig.bounds = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; rig.hull = g.bounds.map((p) => [p.x, p.y]);
  const bds = B.bds; const landmark = bds.find((b) => b.landmark) ?? bds.reduce((a, b) => (b.area > a.area ? b : a));

  function characteristicBlock(): THREE.Vector3 {
    let best = -1; let at = new THREE.Vector3(landmark.cx, landmark.cy, 0); const cell = new Map<string, number>();
    for (const b of bds) if (b.bound && b.area < 250 && b.lv >= 2 && (b.roof === 'gable' || b.roof === 'hip') && B.roadDist(b.cx, b.cy) < 22) { const k = Math.floor(b.cx / 60) + ',' + Math.floor(b.cy / 60); cell.set(k, (cell.get(k) ?? 0) + 1); }
    for (const [k, n] of cell) { const [gx, gy] = k.split(',').map(Number); const cx = gx * 60 + 30, cy = gy * 60 + 30; const sc = n - Math.hypot(cx - landmark.cx, cy - landmark.cy) / 150; if (sc > best) { best = sc; at = new THREE.Vector3(cx, cy, 0); } }
    return at;
  }
  const streetT = characteristicBlock();
  const life = buildLife(pipe, G.lines, G.avenues, G.tram, [streetT]) as ReturnType<typeof buildLife> & { setView?: (w: number) => void }; pipe.scene.add(life.group);
  const shots: Record<string, { target: THREE.Vector3; viewW: number }> = { neighbourhood: { target: new THREE.Vector3(landmark.cx, landmark.cy, 0), viewW: 230 }, street: { target: streetT, viewW: 60 } };

  // ---- picking, hover and selection outlines (accent line boxes)
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5));
  const mkOutline = (col: string) => { const l = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true })); l.visible = false; l.renderOrder = 10; l.layers.set(2); pipe.scene.add(l); return l; };
  const hoverL = mkOutline(hex(P.accent[0])), selL = mkOutline(hex([0.42, 0.11, 235]));
  const place = (l: THREE.LineSegments, bi: number | null) => { if (bi === null || bi < 0) { l.visible = false; return; } const b = bds[bi]; const rise = b.roof === 'gable' || b.roof === 'hip' ? 3 : 0.5; l.position.set(b.rect.cx, b.rect.cy, 0); l.rotation.set(0, 0, b.rect.ang); l.scale.set(b.rect.L + 0.8, b.rect.W + 0.8, b.Hb + rise); l.visible = true; };
  let hoverCb: (bi: number | null, x: number, y: number) => void = () => {}, selCb: (bi: number | null) => void = () => {}; let selected: number | null = null; let hovered: number | null = null;
  function pick(clientX: number, clientY: number): number | null {
    const r = canvas.getBoundingClientRect(); ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, pipe.camera);
    const hits = ray.intersectObjects(B.pickables(), false); for (const h of hits) { const bi = B.ownerOf(h); if (bi >= 0) return bi; } return null;
  }
  let pending: { x: number; y: number } | null = null; let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointermove', (e) => { pending = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) api.select(pick(e.clientX, e.clientY)); down = null; });
  canvas.addEventListener('dblclick', (e) => { const bi = pick(e.clientX, e.clientY); if (bi !== null) api.select(bi, true); });
  canvas.addEventListener('pointerleave', () => { pending = null; hovered = null; place(hoverL, null); hoverCb(null, 0, 0); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.select(null); });

  // ---- camera shots (snapshot contract) and the opening shot
  const angle = Number(q.get('angle') ?? 0); const view = q.get('view'); const shot = q.get('shot');
  const fitAll = () => { rig.elDeg = 30; rig.azDeg = -45 + (rig.azDeg + 45 > 1 ? 0 : 0); rig.viewW = rig.fitWidth(); rig.target.copy(rig.centre); rig.place(); };
  function applyShot() {
    if (view === 'top') { rig.azDeg = -90; rig.elDeg = 90; rig.viewW = rig.fitWidth(); rig.target.copy(rig.centre); rig.place(); return; }
    rig.azDeg = -45 + angle; rig.elDeg = 30;
    if (view === 'iso' || shot === 'overview') { rig.viewW = rig.fitWidth(); rig.target.copy(rig.centre); rig.place(); return; }
    const s = shots[shot ?? 'neighbourhood'] ?? shots.neighbourhood; const az = THREE.MathUtils.degToRad(rig.azDeg);
    const right = new THREE.Vector3(-Math.sin(az), Math.cos(az), 0), fwd = new THREE.Vector3(-Math.cos(az), -Math.sin(az), 0); const k = shot === 'street' ? 0 : 1;
    rig.set({ target: s.target.clone().addScaledVector(right, -s.viewW * 0.12 * k).addScaledVector(fwd, -s.viewW * 0.10 * k), viewW: s.viewW });
  }
  applyShot();
  // eased moves (250-400 ms); instant under reduced motion and in snapshot mode
  let anim: { t0: number; dur: number; from: { t: THREE.Vector3; w: number; az: number }; to: { t: THREE.Vector3; w: number; az: number } } | null = null;
  const easeTo = (target: THREE.Vector3, w: number, az: number, dur = 320) => {
    if (reduced || snapshot) { rig.target.copy(target); rig.viewW = w; rig.azDeg = az; rig.place(); return; }
    anim = { t0: performance.now(), dur, from: { t: rig.target.clone(), w: rig.viewW, az: rig.azDeg }, to: { t: target.clone(), w, az } };
  };
  if (!snapshot && !reduced && !view && !shot) { const target = rig.target.clone(), w = rig.viewW; rig.viewW = w * 1.3; rig.place(); easeTo(target, w, rig.azDeg, 1200); }

  let speedScale = 1; let readyAfter = opts.holdReady ? Infinity : 3; let readyFlag = false; const readyWaiters: (() => void)[] = []; let frames = 0; let t0 = performance.now(); let clock = Number(q.get('clock') ?? 0);
  (pipe as any).onResize = () => rig.place();
  function loop() {
    const now = performance.now();
    if (anim) { const k = Math.min(1, (now - anim.t0) / anim.dur), e = 1 - Math.pow(1 - k, 3); rig.target.lerpVectors(anim.from.t, anim.to.t, e); rig.viewW = anim.from.w + (anim.to.w - anim.from.w) * e; let da = anim.to.az - anim.from.az; da = ((da + 540) % 360) - 180; rig.azDeg = anim.from.az + da * e; rig.place(); if (k >= 1) anim = null; }
    if (pending && !down) { const bi = pick(pending.x, pending.y); if (bi !== hovered) { hovered = bi; place(hoverL, bi === selected ? null : bi); } hoverCb(bi, pending.x, pending.y); pending = null; }
    if (!snapshot) clock = (now - t0) / 1000 * speedScale;
    life.update(clock, rig.viewW, reduced);
    pipe.render(); frames++;
    if (frames >= readyAfter && !readyFlag) { readyFlag = true; (window as any).__paperdollsReady = true; readyWaiters.splice(0).forEach((f) => f()); }
    if (!snapshot) requestAnimationFrame(loop); else if (!readyFlag) requestAnimationFrame(loop);
  }
  const api: World3D = {
    pipe, rig, bds, data, landmark, boundCount: bound.reduce((a, b) => a + b, 0), lifeCounts: life.counts, reduced,
    applyFrame: (b) => data.setFrame(b), setLens: (on) => data.setLens(on), fit: () => { const w = rig.fitWidth(); easeTo(rig.centre.clone(), w, -45, 350); void fitAll; },
    rotate: (d) => easeTo(rig.target.clone(), rig.viewW, rig.azDeg + d, 350), zoom: (f) => { rig.viewW = Math.min(rig.fitWidth() * 1.2, Math.max(40, rig.viewW * f)); rig.place(); },
    select: (bi, frame) => { selected = bi; place(selL, bi); if (bi !== null && frame) { const b = bds[bi]; easeTo(new THREE.Vector3(b.cx, b.cy, 0), Math.min(rig.viewW, 80), rig.azDeg, 400); } selCb(bi); if (bi !== null) place(hoverL, null); },
    onHover: (cb) => { hoverCb = cb; }, onSelect: (cb) => { selCb = cb; },
    stats: () => ({ ...B.stats(), ...pipe.info(), buildings: bds.length, landmark: landmark.id, landmarkName: landmark.name ?? '' }), setClockSpeed: (s) => { speedScale = s; },
    markReady: () => { readyAfter = frames + 4; if (snapshot) requestAnimationFrame(loop); },
    whenReady: () => (readyFlag ? Promise.resolve() : new Promise((r) => readyWaiters.push(r))), renderOnce: () => pipe.render(),
  };
  // keep the view-dependent decorations in sync
  (life as any).setView = () => {};
  if (!snapshot) attachControls(canvas, rig, () => api.fit());
  loop();
  return api;
}
