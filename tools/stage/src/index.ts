// paperdolls stage: the shared plumbing every world page uses. It owns no look: buildings, streets, nature,
// life, data and palette stay in the world's own code, built from the scene-craft recipes.
export { createStage, buildPlinth, NO_INK } from './pipeline.ts';
export type { Stage, StageLook, PlinthLook } from './pipeline.ts';
export { createCameraRig, thirdsTarget, ZOOM, DIST } from './camera.ts';
export type { CameraRig, CamState, RigOptions, ShotName } from './camera.ts';
export { readSnapshot, applyShot, markReady, defaultTick } from './snapshot.ts';
export type { SnapshotParams } from './snapshot.ts';
export { serveModel, SimClient } from './sim.ts';
export type { SimFrame, ServeOptions } from './sim.ts';
