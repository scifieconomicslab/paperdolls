// Ported from github.com/scifieconomicslab/paperdolls @ f9a1a59 (CC BY 4.0).
// @paperdolls/agents: the model library (plan 3.1). A converted NetLogo model is one defineModel call on this NetLogo-shaped library, and the
// engine sees only the contract: describe() and start().
export * from './contract.ts';
export { createAgentWorld, AgentSet, Random, COLOR, sum, mean, max, min, median, variance, standardDeviation, subtractHeadings } from './core.ts';
export type { AgentWorld, Breed, LinkBreed, Schema, VarType, WorldOptions, AnyAgent, Kind } from './core.ts';
export { defineModel } from './model.ts';
export type { ModelSpec, BreedSpec, Ctx } from './model.ts';
