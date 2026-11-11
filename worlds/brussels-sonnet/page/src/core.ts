// The glue between the simulation worker and the 3D world: runs, history, playback, seek, the baseline for comparison. No economic quantity is computed
// here (G4): everything shown is read from a model frame.
import { Sim, type FrameMsg, type BFrame } from './sim/client';
import type { World3D } from './scene/world';
import type { Description } from '../../../../tools/agents/library/index.ts';

export type Params = Record<string, string | number | boolean>;
export interface Hist { bstate: Uint8Array[]; adopted: Int16Array[]; shared: Uint8Array[] }
type Listener = () => void;
export class Core {
  sim: Sim; world: World3D; desc!: Description; params: Params = {}; defaults: Params = {}; seed = 0; runId = 0; head = -1; viewTick = 0; done = false; playing = false; speed = 6;
  series: Record<string, number[][]> = {}; hist: Hist = { bstate: [], adopted: [], shared: [] }; stat!: { units: Int16Array; btenure: Uint8Array; anchor: Int32Array }; error = '';
  compare = false; bRunId = 0; seriesB: Record<string, number[][]> = {}; headB = -1;
  private ls = new Set<Listener>(); private pend = false; private acc = 0; private last = performance.now(); private timer = 0; private restartT = 0;
  constructor(sim: Sim, world: World3D) {
    this.sim = sim; this.world = world;
    sim.onFrame((m, id) => this.onFrame(m, id)); sim.onError((m) => { this.error = m; this.pend = false; this.emit(); });
  }
  async init() { await this.sim.ready; this.desc = this.sim.description; for (const [k, v] of Object.entries(this.desc.params)) this.defaults[k] = v.default as any; this.params = { ...this.defaults }; }
  version = 0; on(l: Listener) { this.ls.add(l); } off(l: Listener) { this.ls.delete(l); } private emit() { this.version++; this.ls.forEach((l) => l()); }
  start(params?: Params, seed?: number) {
    if (params) this.params = { ...params }; if (seed !== undefined) this.seed = seed;
    if (this.runId) this.sim.drop(this.runId); if (this.bRunId) this.sim.drop(this.bRunId); this.bRunId = 0;
    this.series = {}; this.seriesB = {}; this.hist = { bstate: [], adopted: [], shared: [] }; this.head = -1; this.headB = -1; this.viewTick = 0; this.done = false; this.pend = true; this.error = '';
    this.world.data.reset(); this.runId = this.sim.start({ ...this.params }, this.seed); if (this.compare) this.startB(); this.emit();
  }
  private startB() { this.bRunId = this.sim.start({ ...this.defaults }, this.seed); }
  setCompare(on: boolean) { this.compare = on; if (on && !this.bRunId && this.runId) { this.startB(); } if (!on) { if (this.bRunId) this.sim.drop(this.bRunId); this.bRunId = 0; this.seriesB = {}; this.headB = -1; } this.emit(); }
  setParam(k: string, v: string | number | boolean, immediate = false) { this.params = { ...this.params, [k]: v }; this.emit(); clearTimeout(this.restartT); this.restartT = window.setTimeout(() => this.start(), immediate ? 0 : 450); }
  private onFrame(m: FrameMsg, id: number) {
    if (id === this.bRunId) { for (const [k, v] of Object.entries(m.series)) (this.seriesB[k] ??= [])[m.t] = v; this.headB = m.t; this.emit(); return; }
    if (id !== this.runId) return;
    for (const [k, v] of Object.entries(m.series)) (this.series[k] ??= [])[m.t] = v;
    this.hist.bstate[m.t] = m.b.bstate; this.hist.adopted[m.t] = m.b.adopted; this.hist.shared[m.t] = m.b.shared;
    if (m.t === 0) this.stat = { units: m.b.units, btenure: m.b.btenure, anchor: m.b.anchor };
    this.head = m.t; this.done = m.done; this.pend = false;
    if (this.viewTick >= m.t - 1 || m.t === 0) { this.viewTick = m.t; this.applyView(); }
    if (this.compare && this.bRunId && this.headB < m.t) this.sim.run(this.bRunId, m.t, true);
    this.emit();
  }
  applyView() { const t = this.viewTick; if (!this.stat || this.hist.bstate[t] === undefined) return; this.world.applyFrame({ bstate: this.hist.bstate[t], adopted: this.hist.adopted[t], units: this.stat.units, shared: this.hist.shared[t], anchor: this.stat.anchor } as BFrame & { anchor: Int32Array }); }
  seek(t: number) { this.playing = false; this.viewTick = Math.max(0, Math.min(this.head, t)); this.applyView(); this.emit(); }
  setPlaying(p: boolean) { this.playing = p; this.last = performance.now(); if (p) this.loop(); this.emit(); }
  private loop() { clearInterval(this.timer); this.timer = window.setInterval(() => { if (!this.playing) { clearInterval(this.timer); return; } const now = performance.now(); this.acc += ((now - this.last) / 1000) * this.speed; this.last = now; if (this.acc >= 1) { this.acc = Math.min(this.acc, 3); this.step(); this.acc -= 1; } }, 40); }
  private step() {
    if (this.viewTick < this.head) { this.viewTick++; this.applyView(); this.emit(); return; }
    if (this.done) { this.playing = false; this.emit(); return; }
    if (!this.pend) { this.pend = true; this.sim.run(this.runId, this.head + 1, true); }
  }
  /** run to tick t without playing (used by snapshot mode and "jump to end") */
  runTo(t: number) { if (!this.pend && !this.done) { this.pend = true; this.sim.run(this.runId, t, true); } }
  horizon() { return Number(this.params['horizon-months'] ?? 360); }
  get changed(): Set<string> { const s = new Set<string>(); for (const k of Object.keys(this.params)) if (this.params[k] !== this.defaults[k] && k !== 'seed' && k !== 'scene-seed') s.add(k); return s; }
}
