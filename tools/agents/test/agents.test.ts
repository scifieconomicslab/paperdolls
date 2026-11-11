// Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
// Unit tests for the spike library: NetLogo semantics that converted models rely on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentWorld as createWorld, COLOR } from '../library/index.ts';

const small = (seed = 1) => createWorld({ minPxcor: -5, maxPxcor: 5, minPycor: -5, maxPycor: 5, seed });

test('fd follows NetLogo headings (0 = north, clockwise) and the world wraps', () => {
  const w = small(); const b = w.breed('a');
  w.createTurtles(b, 1, (t: any) => { t.heading = 90; t.fd(2); assert.ok(Math.abs(t.xcor - 2) < 1e-9 && Math.abs(t.ycor) < 1e-9); t.heading = 0; t.fd(4); t.fd(4); assert.ok(Math.abs(t.ycor - (-3)) < 1e-9, 'wrapped from 8 to -3'); });
});

test('ask visits a snapshot: newborns are not visited, the dead are skipped', () => {
  const w = small(); const b = w.breed('a'); w.turtlesOwn({ n: 'i32' });
  w.createTurtles(b, 10);
  let visits = 0;
  w.ask(b, (t: any) => { visits++; t.hatch(1); });
  assert.equal(visits, 10); assert.equal(w.countOf(b), 20);
  let visited = 0; const victims = new Set<number>();
  w.ask(b, (t: any) => { visited++; const other = w.oneOf(w.with(b, (u: any) => u.who !== t.who)); if (other) { victims.add(other.who); w.askOne(other, (o: any) => o.die()); } });
  assert.ok(visited < 20, 'killed turtles were skipped'); 
});

test('die ends the agent\'s commands, also from a nested procedure', () => {
  const w = small(); const b = w.breed('a'); w.turtlesOwn({ after: 'bool' });
  w.createTurtles(b, 5);
  const death = (t: any) => t.die();
  let after = 0;
  w.ask(b, (t: any) => { death(t); after++; });
  assert.equal(after, 0); assert.equal(w.countOf(b), 0);
});

test('hatch copies variables and position, and runs its block on the child', () => {
  const w = small(); const b = w.breed('a'); w.turtlesOwn({ energy: 'f64' });
  w.createTurtles(b, 1, (t: any) => { t.setxy(1, 1); t.energy = 7; t.hatch(1, (c: any) => { assert.equal(c.energy, 7); assert.equal(c.xcor, 1); c.energy = 3; }); assert.equal(t.energy, 7); });
  assert.equal(w.countOf(b), 2);
});

test('turtles-here follows movement, and slot reuse does not confuse a held agentset', () => {
  const w = small(); const a = w.breed('a'), z = w.breed('z');
  w.createTurtles(a, 3, (t: any) => t.setxy(2, 2)); w.createTurtles(z, 2, (t: any) => t.setxy(2.4, 1.6));
  w.createTurtles(a, 1, (t: any) => { assert.equal(w.countOf(t.turtlesHere(a)), 1); t.setxy(2, 2); assert.equal(w.countOf(t.turtlesHere(a)), 4); assert.equal(w.countOf(t.turtlesHere(z)), 2); });
  const held = w.turtles(a);
  w.ask(a, (t: any) => t.die());
  w.createTurtles(a, 4);                                   // reuses the freed slots
  assert.equal(w.countOf(held), 0, 'old snapshot does not see the new turtles in reused slots');
});

test('the same seed gives the same run; another seed does not', () => {
  const run = (seed: number) => { const w = small(seed); const b = w.breed('a'); w.createTurtles(b, 50, (t: any) => t.setxy(w.randomXcor(), w.randomYcor())); for (let k = 0; k < 20; k++) w.ask(b, (t: any) => { t.rt(w.random(50)); t.fd(1); }); const c = w.columns(); return Array.from(c.x.slice(0, c.high)).join(','); };
  assert.equal(run(3), run(3)); assert.notEqual(run(3), run(4));
});

test('random matches NetLogo ranges', () => {
  const w = small();
  for (let k = 0; k < 1000; k++) { const r = w.random(5); assert.ok(Number.isInteger(r) && r >= 0 && r < 5); const f = w.randomFloat(2); assert.ok(f >= 0 && f < 2); }
  assert.equal(w.random(0), 0);
  for (let k = 0; k < 200; k++) { const x = w.randomXcor(); assert.ok(x >= -5.5 && x < 5.5); }
});

test('patches: variables, with, and colours', () => {
  const w = small(); w.patchesOwn({ countdown: 'f64' });
  w.ask(w.patches, (p: any) => { p.pcolor = p.pxcor > 0 ? COLOR.green : COLOR.brown; p.countdown = p.pycor; });
  assert.equal(w.countOf(w.with(w.patches, (p: any) => p.pcolor === COLOR.green)), 5 * 11);
});
