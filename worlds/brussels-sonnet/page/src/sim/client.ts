import SimWorker from './sim.worker.ts?worker&inline';
import type { Description } from '../../../../../tools/agents/library/index.ts';

export interface BFrame { bstate: Uint8Array; adopted: Int16Array; units: Int16Array; shared: Uint8Array; btenure: Uint8Array; anchor: Int32Array }
export interface FrameMsg { t: number; series: Record<string, number[]>; b: BFrame; done: boolean }
export class Sim {
  private w = new SimWorker(); private id = 0; private listeners: ((f: FrameMsg, runId: number) => void)[] = []; private errs: ((m: string) => void)[] = [];
  description!: Description; ready: Promise<void>; private resolveReady!: () => void;
  private hhWaiters = new Map<string, (rows: number[][]) => void>(); private checkWaiter: ((r: { same: boolean; frames: number }) => void) | null = null;
  constructor(area: Float32Array, storeys: Int8Array, bound: Uint8Array) {
    this.ready = new Promise((r) => { this.resolveReady = r; });
    this.w.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'ready') { this.description = m.description; this.resolveReady(); }
      else if (m.type === 'frame') this.listeners.forEach((l) => l(m, m.id));
      else if (m.type === 'households') this.hhWaiters.get(m.id + ':' + m.building)?.(m.rows);
      else if (m.type === 'check') this.checkWaiter?.(m);
      else if (m.type === 'error') this.errs.forEach((l) => l(m.message));
    };
    this.w.postMessage({ type: 'init', area, storeys, bound });
  }
  onFrame(l: (f: FrameMsg, runId: number) => void) { this.listeners.push(l); } onError(l: (m: string) => void) { this.errs.push(l); }
  start(params: Record<string, unknown>, seed: number): number { const id = ++this.id; this.w.postMessage({ type: 'start', id, params, seed }); return id; }
  run(id: number, to: number, every = true) { this.w.postMessage({ type: 'run', id, to, every }); }
  drop(id: number) { this.w.postMessage({ type: 'drop', id }); }
  households(id: number, building: number): Promise<number[][]> { return new Promise((r) => { this.hhWaiters.set(id + ':' + building, r); this.w.postMessage({ type: 'households', id, building }); }); }
  check(params: Record<string, unknown>, seed: number, ticks: number) { return new Promise<{ same: boolean; frames: number }>((r) => { this.checkWaiter = r; this.w.postMessage({ type: 'check', params, seed, ticks }); }); }
}
