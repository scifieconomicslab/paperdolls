// Starting point for the world's page. Replace every TODO; keep the order.
// Scene craft: skills/paperdolls-scene-craft (build order §2). UI: skills/paperdolls-interface-ui.
import * as THREE from 'three';
import scene from '../../map-data/scene.json';
import SimWorker from './sim.worker.ts?worker&inline';
import { createStage, createCameraRig, buildPlinth, readSnapshot, applyShot, markReady, SimClient } from './stage/index.ts';

const S: any = scene;
const snap = readSnapshot();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block';
document.body.style.margin = '0';
document.body.prepend(canvas);

// 1. Pipeline + light: every value from the art bible (palette.ts), none hard-coded here.
const stage = createStage(canvas, {
  exposure: 1.3,
  key: { color: '#fff1dc', intensity: 2.6, azimuthDeg: 220, elevationDeg: 40 },     // TODO from the bible's moment
  fill: { sky: '#cfe0ff', ground: '#cfc8b8', intensity: 1.6 },                       // TODO
  sky: { top: '#a9c4de', horizon: '#e6e2d8' },                                       // TODO
  ink: '#2b2630',                                                                    // TODO
});
const boundary: number[][] = S.area.boundary;   // constructed worlds: their rectangle as four corners
stage.scene.add(buildPlinth(boundary, { soil: '#8a6b52', rock: '#a59a8c', lip: '#efe9dc' }));   // TODO palette

// 2-7. The world's own code: ground, masses + roofs, streets, facades, nature, life, data (scene-craft recipes).
// TODO

// 8. Camera: subject = the landmark or the bible's subject; streetSubject = the style-frame block.
const rig = createCameraRig(stage.camera, { boundary, subject: undefined /* TODO */, streetSubject: undefined /* TODO */, snapshot: snap.snapshot, reduced });
rig.onChange = () => stage.setView(rig.state.target, rig.state.width);
const size = () => { stage.resize(innerWidth, innerHeight); rig.setAspect(innerWidth / innerHeight); };
addEventListener('resize', size);
size();
if (snap.snapshot) applyShot(rig, snap); else rig.shot('neighbourhood');
rig.attach(canvas);

// The model, in its worker.
const sim = new SimClient(new SimWorker());
void sim; // TODO: await sim.init(world); const run = sim.start(params, seed); sim.onFrame(applyFrame); sim.run(run, snap.t ?? defaultT)

// Render loop. markReady() only once the frame is final: geometry built, data applied at tick t, 3 frames drawn.
let frames = 0;
const dataApplied = () => true;   // TODO: true once the frame for tick t has been applied
const loop = (now: number) => {
  requestAnimationFrame(loop);
  rig.update(now);
  stage.render();
  if (++frames >= 3 && dataApplied()) markReady();
};
requestAnimationFrame(loop);
void THREE;
