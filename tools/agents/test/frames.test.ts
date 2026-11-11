// Exercise the frame contract for every entity kind, including anchored,
// unplaced and link entities that the model tests did not cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFrame, defineModel, type AnyAgent, type Frame } from '../library/index.ts';

const model = defineModel({
  title: 'Frame kinds',
  time: { unit: 'tick', horizon: 2 },
  params: {},
  world: { minPxcor: -10, maxPxcor: 10, minPycor: -10, maxPycor: 10 },
  breeds: {
    walker: { kind: 'mobile', own: { energy: 'f64' } },
    marker: { kind: 'unplaced', own: { value: 'f64' } },
    anchored: { kind: 'anchored', layer: 'buildings', own: { anchor: 'i32', weight: 'f64' } },
  },
  linkBreeds: { tie: { directed: false } },
  setup(m) {
    m.createTurtles(m.breeds.walker, 2, (t: AnyAgent) => { t.setxy(t.who + 1, t.who + 2); t.energy = 3 + t.who; });
    m.createTurtles(m.breeds.marker, 1, (t: AnyAgent) => { t.value = 7; });
    m.createTurtles(m.breeds.anchored, 1, (t: AnyAgent) => { t.anchor = 0; t.weight = 2.5; });
    const a = m.turtle(0), b = m.turtle(1);
    assert.ok(a && b);
    a!.createLinkWith(b!, m.linkBreeds.tie as never);
    m.resetTicks();
  },
  go(m) { m.tick(); },
});

test('frames carry every declared entity kind and pass checkFrame', () => {
  const d = model.describe();
  const run = model.start({ params: {}, scenario: [], world: null, data: {}, seed: 1 });
  const frames: Frame[] = [run.frame, run.step()];
  for (const f of frames) assert.deepEqual(checkFrame(d, f, f.t), []);
  assert.deepEqual(Object.keys(frames[0].entities), ['walker', 'marker', 'anchored', 'tie']);
  assert.deepEqual(Array.from(frames[0].entities.anchored.anchor), [0]);
  assert.deepEqual(Array.from(frames[0].entities.marker.value as Float64Array), [7]);
  assert.equal(frames[0].entities.tie.id.length, 1);
  assert.deepEqual(Array.from(frames[0].entities.walker.x), [1, 2]);
});

test('checkFrame reports a missing field and a wrong column length', () => {
  const d = model.describe();
  const run = model.start({ params: {}, scenario: [], world: null, data: {}, seed: 1 });
  const missing = structuredClone(run.frame) as Frame;
  delete (missing.entities.anchored as Record<string, unknown>).anchor;
  assert.ok(checkFrame(d, missing).some((e) => e.includes('anchor')));
  const wrong = structuredClone(run.frame) as Frame;
  (wrong.entities.walker.x as Float64Array) = new Float64Array(1);
  assert.ok(checkFrame(d, wrong).some((e) => e.includes('length')));
});
