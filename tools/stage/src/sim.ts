// paperdolls stage: run the model in a Web Worker (technology skill §3). The main thread renders and owns the UI;
// it never steps the model. One protocol for every world:
//
//   worker file (page/src/sim.worker.ts):
//     import model from '../../sim-code/model.ts';
//     import { serveModel } from './stage/sim.ts';
//     serveModel(model);
//
//   main thread:
//     import SimWorker from './sim.worker.ts?worker&inline';     // inline: the page stays one file
//     const sim = new SimClient(new SimWorker());
//     await sim.init(world, data);
//     const id = sim.start(params, seed, scenario);
//     sim.onFrame((f, runId) => { ... });
//     sim.run(id, 120);                                           // step to tick 120, posting every frame
//
// Vendored into worlds/<name>/page/src/stage/ by tools/stage/vendor.mjs. Do not edit the copy.

type Column = Float64Array | Float32Array | Int32Array | Int16Array | Int8Array | Uint8Array;
export interface SimFrame {
  t: number;
  series: Record<string, number[]>;
  entities: Record<string, Record<string, Column>>;
  events?: unknown[];
  done: boolean;
}
interface RunLike { readonly frame: { t: number; series: Record<string, number[]>; entities: Record<string, Record<string, any>>; events?: unknown[] }; step(): unknown; readonly done: boolean }
interface ModelLike { describe(): any; start(input: { params: Record<string, unknown>; scenario: unknown[]; world: unknown; data: Record<string, unknown>; seed: number }): RunLike }

export interface ServeOptions {
  /** only these entity columns are sent each frame, per breed (default: all). Fewer columns, cheaper frames. */
  columns?: Record<string, string[]>;
}

/** Worker side. */
export function serveModel(model: ModelLike, opts: ServeOptions = {}) {
  let world: unknown = null, data: Record<string, unknown> = {};
  const runs = new Map<number, RunLike>();
  const post = (msg: unknown, transfer: Transferable[] = []) => (self as any).postMessage(msg, transfer);
  function send(id: number, run: RunLike) {
    const f = run.frame;
    const entities: Record<string, Record<string, Column>> = {};
    const transfer: Transferable[] = [];
    for (const [breed, cols] of Object.entries(f.entities ?? {})) {
      const keep = opts.columns?.[breed];
      if (opts.columns && !keep) continue;
      entities[breed] = {};
      for (const [name, col] of Object.entries(cols)) {
        if (keep && !keep.includes(name)) continue;
        if (!ArrayBuffer.isView(col)) continue;
        const c = (col as Column).slice();                        // a copy we can transfer; the run keeps its own
        entities[breed][name] = c;
        transfer.push(c.buffer as ArrayBuffer);
      }
    }
    post({ type: 'frame', id, t: f.t, series: f.series, entities, events: f.events, done: run.done }, transfer);
  }
  self.onmessage = (e: MessageEvent) => {
    const m = e.data;
    try {
      if (m.type === 'init') {
        world = m.world ?? null; data = m.data ?? {};
        post({ type: 'ready', description: model.describe() });
      } else if (m.type === 'start') {
        const run = model.start({ params: m.params, scenario: m.scenario ?? [], world, data, seed: m.seed });
        runs.set(m.id, run);
        send(m.id, run);
      } else if (m.type === 'run') {
        const run = runs.get(m.id);
        if (!run) return;
        let k = 0;
        while (!run.done && run.frame.t < m.to) {
          run.step(); k++;
          if (m.every || run.done || run.frame.t >= m.to) send(m.id, run);
        }
        if (k === 0) send(m.id, run);
      } else if (m.type === 'drop') {
        runs.delete(m.id);
      }
    } catch (err: any) {
      post({ type: 'error', id: m.id, message: String(err?.message ?? err) });
    }
  };
}

/** Main-thread side. */
export class SimClient {
  description: any = null;
  private next = 0;
  private frames: ((f: SimFrame, runId: number) => void)[] = [];
  private errors: ((message: string, runId?: number) => void)[] = [];
  private readyResolve: (() => void) | null = null;

  constructor(private worker: Worker) {
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'ready') { this.description = m.description; this.readyResolve?.(); }
      else if (m.type === 'frame') this.frames.forEach((l) => l(m as SimFrame, m.id));
      else if (m.type === 'error') this.errors.forEach((l) => l(m.message, m.id));
    };
    worker.onerror = (e) => this.errors.forEach((l) => l(e.message));
  }
  /** send the world (scene-derived entities) and data tables once; resolves with the model's description */
  init(world: unknown, data: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve) => {
      this.readyResolve = () => resolve(this.description);
      this.worker.postMessage({ type: 'init', world, data });
    });
  }
  /** a new run from t = 0; returns its id. Same params + seed = the same frames (G8). */
  start(params: Record<string, unknown>, seed: number, scenario: unknown[] = []): number {
    const id = ++this.next;
    this.worker.postMessage({ type: 'start', id, params, seed, scenario });
    return id;
  }
  /** step run `id` until tick `to`; every = post each tick (play) or only the last (jump) */
  run(id: number, to: number, every = true) { this.worker.postMessage({ type: 'run', id, to, every }); }
  drop(id: number) { this.worker.postMessage({ type: 'drop', id }); }
  onFrame(l: (f: SimFrame, runId: number) => void) { this.frames.push(l); }
  onError(l: (message: string, runId?: number) => void) { this.errors.push(l); }
  terminate() { this.worker.terminate(); }
}
