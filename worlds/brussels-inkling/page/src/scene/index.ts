// The brussels-inkling world's scene: assembles the concerns in build order and exposes the small
// API the shell uses. Snapshot URL contract (scene-craft §6): snapshot, shot, lens, angle, view, t
// (handled by the shell), clock.
import * as THREE from 'three';
import { createPipeline, buildPlinth } from './pipeline.ts';
import { buildLayout } from './layout.ts';
import { buildBuildings } from './buildings.ts';
import { buildStreets } from './streets.ts';
import { buildNature } from './nature.ts';
import { buildLife } from './life.ts';
import { createDataLayer } from './data.ts';
import { createCameraRig, thirdsTarget, ZOOM, DIST } from './camera.ts';
import { U } from './util.ts';

export interface WorldOptions { binding: any; snapshot: boolean; reduced: boolean; query: URLSearchParams | null }
export interface World {
  update(frame: any | null): void;
  resize(w: number, h: number): void;
  fit(): void; rotate(dir?: 1 | -1): void; zoom(k: number): void;
  setLens(on: boolean): void; lens(): boolean;
  setPlaying(p: boolean): void;
  report: Record<string, any>;
  destroy(): void;
}

const SEED = 20261111;

export function createWorld(canvas: HTMLCanvasElement, sceneJson: any, o: WorldOptions): World {
  const t0 = performance.now();
  const pipe = createPipeline(canvas);
  const { scene, camera, renderer } = pipe;
  const lay = buildLayout(sceneJson);

  // 1. plinth + ground (the verge is the pale limestone plot tone, not grass)
  const waterPolys = lay.landuse.filter((l) => l.kind === 'water').map((l) => l.poly);
  scene.add(buildPlinth(lay.bounds, waterPolys, lay.boundary as [number, number][] | null));
  // 2 + 4. buildings (masses, roofs, facades) + cladding + pennants
  const bld = buildBuildings(lay);
  scene.add(bld.group);
  // 3. streets (roads, pavements, land use, tram rails, furniture)
  const st = buildStreets(lay, SEED + 1);
  scene.add(st.group);
  // 5. nature + water
  const nat = buildNature(lay, st.streetTrees, SEED + 2);
  scene.add(nat.group);
  // 6. life (decorative, labelled)
  const life = buildLife(lay, st.parking, bld.chimneys, SEED + 3) as ReturnType<typeof buildLife> & { camQ: THREE.Quaternion };
  scene.add(life.group);
  // 7. data
  const data = createDataLayer(bld, o.binding, lay.structs.length);
  data.apply(null);

  // 8. camera
  const rig = createCameraRig(camera, lay.bounds, { reduced: o.reduced, snapshot: o.snapshot });
  const q = o.query;
  const angle = q?.has('angle') ? THREE.MathUtils.degToRad(Number(q.get('angle')) || 0) : 0;
  const sq = lay.centre;                       // the largest place=square — Jette's market square
  const lm = lay.landmark >= 0 ? lay.structs[lay.landmark] : null;
  const subject = new THREE.Vector3(sq[0], sq[1], 0);
  const az0 = THREE.MathUtils.degToRad(45) + angle;
  const shots = {
    overview: { target: new THREE.Vector3((lay.bounds.x0 + lay.bounds.x1) / 2, (lay.bounds.y0 + lay.bounds.y1) / 2, 0), width: Math.hypot(lay.bounds.x1 - lay.bounds.x0, lay.bounds.y1 - lay.bounds.y0) * 0.82 },
    neighbourhood: { target: thirdsTarget(subject, ZOOM.neighbourhood, az0), width: ZOOM.neighbourhood },
    // the most characteristic spot: the market square with cafés and brick terraces
    street: { target: thirdsTarget(new THREE.Vector3(sq[0] + 8, sq[1] - 6, 0), ZOOM.street, az0), width: ZOOM.street },
  };
  const shot = (q?.get('shot') as keyof typeof shots) || 'neighbourhood';
  const view = q?.get('view');
  rig.state.az = az0;
  if (view === 'top') {
    Object.assign(rig.state, { ...shots.overview, el: THREE.MathUtils.degToRad(89.9) });
  } else {
    Object.assign(rig.state, shots[shot] ?? shots.neighbourhood);
  }
  if (!o.snapshot && !o.reduced && view !== 'top') {
    // opening shot: ease in once over 1.2 s from 1.3x the opening width (camera.md §3)
    const goal = rig.state.width; rig.state.width = goal * 1.3; rig.place(); rig.easeTo({ width: goal }, 1200);
  }

  let lensOn = q?.get('lens') === '1';
  let lensT = lensOn ? 1 : 0, lensFrom = lensT, lensAt = 0;
  U.uLens.value = lensT;
  let dirty = true;
  const camQ = new THREE.Quaternion();
  rig.onChange = () => {
    const w = rig.state.width;
    pipe.fitShadow(rig.state.target, w);
    const aspect = (camera.right - camera.left) / (camera.top - camera.bottom || 1);
    pipe.setView(w, DIST, w / aspect, U.uLens.value);
    for (const ob of bld.lod.mid) ob.visible = w < 600;
    for (const ob of bld.lod.near) ob.visible = w < 200;
    for (const ob of st.lod.mid) ob.visible = w < 600;
    for (const ob of st.lod.near) ob.visible = w < 200;
    life.setVisible(w);
    camera.getWorldQuaternion(camQ); life.camQ.copy(camQ);
    dirty = true;
  };
  rig.place();
  const detach = o.snapshot ? () => {} : rig.attach(canvas);

  // decorative life clock: snapshot -> fixed steps to `clock` seconds; live -> wall clock
  const animate = !o.snapshot && !o.reduced;
  U.uSway.value = animate ? 1 : 0;
  const clock = Number(q?.get('clock') ?? 0) || 0;
  {
    const steps = Math.round(clock * 30);
    life.step(0);
    for (let i = 0; i < steps; i++) life.step(1 / 30);
    U.uTime.value = clock;
    if (o.snapshot) U.uSway.value = 0;
  }
  let playing = true, lifeSpeed = 1;

  // hover tag (data-in-the-world §6): throttled raycast against structure bodies only
  const tag = document.createElement('div');
  tag.className = 'pd-hover-tag'; tag.setAttribute('role', 'status'); tag.style.display = 'none';
  canvas.parentElement?.appendChild(tag);
  let hoverAt: { x: number; y: number } | null = null, dragging = false;
  const ray = new THREE.Raycaster();
  const onMove = (e: PointerEvent) => { hoverAt = dragging ? null : { x: e.offsetX, y: e.offsetY }; };
  const onDown = () => { dragging = true; tag.style.display = 'none'; };
  const onUp = () => { dragging = false; };
  const onLeave = () => { hoverAt = null; tag.style.display = 'none'; };
  if (!o.snapshot) {
    canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp); canvas.addEventListener('pointerleave', onLeave);
  }
  const label = (s: number) => {
    const S = lay.structs[s]; const v = data.valueOf(s);
    const top = o.binding.bindings?.[0]?.top_color;
    const val = v.depth === null ? 'no data' : `${v.depth.toFixed(2)} ${top?.unit ?? ''}`;
    const cls = S.landmark ? 'UZ Brussel — landmark (real structure, from the map data)' : String(S.cls ?? 'building').replace(/_/g, ' ');
    return `<b>${S.id}</b> · ${cls}<br>${top?.label ?? 'value'}: ${val}${v.approved ? '<br>Shared-measure vote pending' : ''}`;
  };
  function doHover() {
    if (!hoverAt) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ray.setFromCamera(new THREE.Vector2((hoverAt.x / w) * 2 - 1, -(hoverAt.y / h) * 2 + 1), camera);
    const hits = ray.intersectObject(bld.pickMesh, false);
    const id = hits[0]?.instanceId;
    const s = id !== undefined ? (bld.pickMesh.userData.struct as Int32Array)[id] : -1;
    if (s >= 0) { tag.innerHTML = label(s); tag.style.display = 'block'; tag.style.left = `${hoverAt.x + 14}px`; tag.style.top = `${hoverAt.y + 14}px`; }
    else tag.style.display = 'none';
    hoverAt = null;
  }

  let raf = 0, last = performance.now(), frames = 0, readySet = false;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (rig.update(now)) dirty = true;
    if (lensAt) {
      const k = Math.min(1, (now - lensAt) / 300);
      U.uLens.value = lensFrom + (lensT - lensFrom) * k;
      if (k >= 1) lensAt = 0;
      rig.onChange?.();
    }
    if (animate) {
      lifeSpeed += ((playing ? 1 : 0.35) - lifeSpeed) * Math.min(1, dt * 2);
      life.step(dt * lifeSpeed);
      U.uTime.value += dt;
      if (nat.water.length) dirty = true;
      dirty = true;
    }
    doHover();
    if (!dirty) return;
    pipe.render();
    dirty = !!o.snapshot && frames < 3;
    frames++;
    if (!readySet && frames >= 3 && dataApplied) { readySet = true; (window as any).__paperdollsReady = true; }
  };
  let dataApplied = !o.snapshot;
  raf = requestAnimationFrame(loop);

  const report = {
    buildMs: 0, structures: lay.structs.length,
    buildings: bld.stats, streets: st.stats, nature: nat.stats, life: life.stats,
    waterBodies: nat.stats.waterBodies,
    roofs: bld.roofKind.reduce((m: Record<string, number>, k) => { m[k] = (m[k] ?? 0) + 1; return m; }, {}),
    landmark: lm ? { id: lm.id, c: lm.c, area: (lay.structs[lay.landmark] as any) } : null,
    centre: lay.centre,
  };
  report.buildMs = Math.round(performance.now() - t0);
  (window as any).__paperdollsReport = report;
  (window as any).__paperdollsInfo = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, width: rig.state.width });

  return {
    update(frame) { data.apply(frame); dataApplied = true; dirty = true; },
    resize(w, h) { pipe.resize(w, h); rig.setAspect(w / Math.max(1, h)); dirty = true; },
    fit() { rig.fit(); },
    rotate(dir = 1) { rig.rotate(dir); },
    zoom(k) { rig.zoomBy(k); },
    setLens(on) {
      lensOn = on; lensFrom = U.uLens.value; lensT = on ? 1 : 0;
      if (o.reduced || o.snapshot) { U.uLens.value = lensT; rig.onChange?.(); } else lensAt = performance.now();
      dirty = true;
    },
    lens: () => lensOn,
    setPlaying(p) { playing = p; },
    report,
    destroy() {
      cancelAnimationFrame(raf); detach(); tag.remove();
      canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointerleave', onLeave);
      pipe.dispose();
    },
  };
}
