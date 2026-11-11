// paperdolls stage: the snapshot URL contract (scene-craft SKILL §6) that tools/bench/screenshots.mjs relies on.
// Vendored into worlds/<name>/page/src/stage/ by tools/stage/vendor.mjs. Do not edit the copy.
import type { CameraRig, ShotName } from './camera.ts';

export interface SnapshotParams {
  snapshot: boolean;          // hide UI chrome, fix decorative randomness, no easing
  shot: ShotName;             // overview | neighbourhood | street (default neighbourhood, the opening shot)
  lens: boolean;              // data lens on
  angle: number;              // azimuth offset in degrees: 0, 90, 180, 270
  view: 'iso' | 'top';        // top = straight down, for the map check
  t: number | null;           // model tick to show; null = the page's default tick (defaultTick)
  clock: number;              // decorative-life seconds; the capture tool steps it for clip frames
}

export function readSnapshot(search: string = typeof location === 'undefined' ? '' : location.search): SnapshotParams {
  const q = new URLSearchParams(search);
  const shot = q.get('shot');
  const t = q.get('t');
  return {
    snapshot: q.get('snapshot') === '1',
    shot: shot === 'overview' || shot === 'street' ? shot : 'neighbourhood',
    lens: q.get('lens') === '1',
    angle: Number(q.get('angle') ?? 0) || 0,
    view: q.get('view') === 'top' ? 'top' : 'iso',
    t: t === null || t === '' || !Number.isFinite(Number(t)) ? null : Math.max(0, Math.round(Number(t))),
    clock: Math.max(0, Number(q.get('clock') ?? 0) || 0),
  };
}

/** Put the camera where the parameters say, instantly. Call once after the rig exists. */
export function applyShot(rig: CameraRig, p: SnapshotParams) {
  if (p.view === 'top') rig.top();
  else rig.shot(p.shot, p.angle, true);
}

/** Tell the capture tools the frame is final: geometry built, data applied at tick t, at least 3 frames drawn. */
export function markReady() {
  (globalThis as any).__paperdollsReady = true;
}

/**
 * The tick a snapshot shows when the URL gives none (scene-craft SKILL §6): the tick where the top-colour field is
 * most varied, so the lens has something to show.
 * - continuous fields: the largest interquartile range;
 * - categorical fields (a state such as none/partial/done): the largest Shannon entropy over the categories;
 * - when every sampled tick is uniform: 0.75 × horizon.
 * samples: the field's values at a few ticks (every 10th tick of one headless run is enough).
 */
export function defaultTick(samples: { t: number; values: ArrayLike<number> }[], kind: 'continuous' | 'categorical', horizon: number): number {
  let best = -1, bestT = Math.round(0.75 * horizon);
  for (const { t, values } of samples) {
    const v = Array.from(values).filter((x) => Number.isFinite(x));
    if (v.length < 2) continue;
    let score: number;
    if (kind === 'categorical') {
      const counts = new Map<number, number>();
      for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
      score = 0;
      for (const n of counts.values()) { const p = n / v.length; score -= p * Math.log(p); }
    } else {
      v.sort((a, b) => a - b);
      const q = (f: number) => v[Math.min(v.length - 1, Math.floor(f * (v.length - 1)))];
      score = q(0.75) - q(0.25);
    }
    if (score > best + 1e-12) { best = score; bestT = t; }
  }
  return best > 1e-12 ? bestT : Math.round(0.75 * horizon);
}
