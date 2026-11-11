// Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0). Import path; stale spike-comparison test removed.
// defineModel: the contract a converted model gives the engine (task 1.2 and 1.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import wolfSheep from '../examples/wolf-sheep.ts';
import { checkFrame, resolveParams, type Frame, type RunInput } from '../library/index.ts';

const input = (o: Partial<RunInput> = {}): RunInput => ({ params: {}, scenario: [], world: null, data: {}, seed: 1001, ...o });
const run = (n: number, o?: Partial<RunInput>) => { const r = wolfSheep.start(input(o)), frames: Frame[] = [r.frame]; for (let k = 0; k < n && !r.done; k++) frames.push(r.step()); return frames; };

test('describe() says what the model is: params, entity kinds and fields, series, KPIs, interventions', () => {
  const d = wolfSheep.describe();
  assert.equal(d.title, 'Wolf Sheep Predation'); assert.deepEqual(d.time, { unit: 'tick', horizon: 500 });
  assert.deepEqual(Object.keys(d.entities), ['sheep', 'wolves']); assert.equal(d.entities.sheep.kind, 'mobile');
  assert.deepEqual(Object.keys(d.entities.sheep.fields), ['energy']);
  assert.deepEqual(d.series.populations.y, ['sheep', 'wolves', 'grass / 4']);
  assert.deepEqual(Object.keys(d.kpis), ['sheep', 'wolves']); assert.equal(d.kpis.sheep.series, 'monitor:sheep');
  assert.deepEqual(Object.keys(d.interventions), ['add-wolves']);
});

test('frames match the description at every tick, and the same seed gives the same run', () => {
  const a = run(60), b = run(60), d = wolfSheep.describe();
  a.forEach((f, t) => assert.deepEqual(checkFrame(d, f, t), [], `tick ${t}`));
  assert.deepEqual(a.map(f => f.series.populations), b.map(f => f.series.populations));
  assert.deepEqual(Array.from(a[60].entities.sheep.x), Array.from(b[60].entities.sheep.x));
  assert.notDeepEqual(run(60, { seed: 2002 }).map(f => f.series.populations), a.map(f => f.series.populations));
});


test('an intervention is applied at its tick, before the step from it', () => {
  const base = run(30), withIv = run(30, { scenario: [{ t: 20, name: 'add-wolves', args: { n: 40 } }] });
  assert.deepEqual(withIv.slice(0, 21).map(f => f.series.populations), base.slice(0, 21).map(f => f.series.populations));
  assert.ok(withIv[21].series.populations[1] > base[21].series.populations[1] + 20, 'forty more wolves after tick 20');
  assert.throws(() => wolfSheep.start(input({ scenario: [{ t: 1, name: 'no-such', args: {} }] })), /not an intervention/);
  assert.throws(() => wolfSheep.start(input({ scenario: [{ t: 1, name: 'add-wolves', args: { n: 999 } }] })), /scenario add-wolves/);
});

test('parameters: defaults filled in, bad values refused all or nothing, stop ends the run', () => {
  const d = wolfSheep.describe();
  const ok = resolveParams(d, { 'initial-number-sheep': 10 }); assert.ok(ok.ok); if (ok.ok) assert.equal(ok.params['wolf-reproduce'], 5);
  const bad = resolveParams(d, { 'initial-number-sheep': 10.5, 'model-version': 'cats', nope: 1 }); assert.ok(!bad.ok); if (!bad.ok) assert.equal(bad.errors.length, 3);
  assert.throws(() => wolfSheep.start(input({ params: { 'initial-number-wolves': 999 } })), /outside 0 to 250/);
  const r = wolfSheep.start(input({ params: { 'initial-number-sheep': 0, 'initial-number-wolves': 0 } }));
  const f = r.step(); assert.ok(r.done, 'no turtles: go stops at once'); assert.equal(f.t, 0); assert.equal(r.step(), f, 'a done run stays where it stopped');
});
