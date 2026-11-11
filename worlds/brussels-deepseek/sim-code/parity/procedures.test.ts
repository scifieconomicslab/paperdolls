// Procedure gates for the converted model's pure formulas. The repo's shared
// procedure harness (`tools/agents/test`) carries fixtures for the wolf-sheep sample;
// this world may not edit tools, so its gates live here and are run with
//   node --test sim-code/parity/procedures.test.ts
// Reference values were computed independently in Python from the formulas in the
// NetLogo source (not by calling this TypeScript).
import test from 'node:test';
import assert from 'node:assert/strict';
import { procs } from '../model.ts';

const near = (a: number, b: number, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test('monthly-rate: (1 + annual)^(1/12) - 1', () => { near(procs.monthlyRate(0.04), 0.0032737397821989145); });
test('loan-payment: level annuity', () => { near(procs.loanPayment(10000, 0.04, 120), 100.90561730960863, 1e-10); });
test('annuity-pv: flat 12 months', () => { near(procs.annuityPv(100, 0.0032737397821989145, 12, 0), 1174.8502025321354, 1e-10); });
test('annuity-pv: growing 120 months', () => { near(procs.annuityPv(100, 0.0032737397821989145, 120, 0.0024662697723036864), 11405.779420706585, 1e-10); });
test('npv-retrofit: savings + rebate - cash - loan', () => {
  near(procs.npvRetrofit(100, 120, 0.0032737397821989145, 0.0024662697723036864, 1000, 100.90561730960863, 120, 500, 12), 886.5486514758268, 1e-9);
});
test('plan-financing: savings first, loan within limit', () => {
  const p = procs.planFinancing(1000, 500, 600, 0.5);
  near(p.fromSavings, 250); near(p.loan, 750); assert.equal(p.feasible, false);
  const q = procs.planFinancing(1000, 500, 900, 0.5);
  assert.equal(q.feasible, true);
});
test('rebate-amount: non-refundable is capped by tax capacity; refundable is not', () => {
  near(procs.rebateAmount(1000, 0.3, 500, false), 300);
  near(procs.rebateAmount(1000, 0.3, 100, false), 100);
  near(procs.rebateAmount(1000, 0.3, 100, true), 300);
  near(procs.rebateAmount(1000, 0.3, 0, false), 0);
});
test('hash-uniform: byte-compatible with the NetLogo/Python port', () => {
  near(procs.hashUniform(0, 0, 0), 0.0, 0);
  near(procs.hashUniform(0, 0, 1), 0.7947153483983129);
  near(procs.hashUniform(7, 42, 13), 0.2784832587931305);
  near(procs.hashUniform(999, 16363, 359), 0.8285974813625216);
});
