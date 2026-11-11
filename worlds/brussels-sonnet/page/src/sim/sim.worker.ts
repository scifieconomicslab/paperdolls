// The simulation runs here, off the main thread (technology skill §3). model.ts is bundled into this worker by the build.
// Protocol: {type:'init', area, storeys, bound}  {type:'start', id, params, seed}  {type:'run', id, to, every}  {type:'households', id, building}  {type:'check', params}
import model from '../../../sim-code/model.ts';
import type { Run } from '../../../../../tools/agents/library/index.ts';

let world: any = null; const runs = new Map<number, Run>();
const bcols = (f: any) => { const b = f.entities.buildings; return { bstate: Uint8Array.from(b.bstate), adopted: Int16Array.from(b.adopted), units: Int16Array.from(b.units), shared: Uint8Array.from(b.shared), btenure: Uint8Array.from(b.btenure), anchor: Int32Array.from(b.anchor) }; };
function post(id: number, run: Run, withB: boolean) {
  const f = run.frame; const msg: any = { type: 'frame', id, t: f.t, series: f.series, done: run.done };
  const tr: Transferable[] = [];
  if (withB) { msg.b = bcols(f); tr.push(msg.b.bstate.buffer, msg.b.adopted.buffer, msg.b.units.buffer, msg.b.shared.buffer, msg.b.btenure.buffer, msg.b.anchor.buffer); }
  (self as any).postMessage(msg, tr);
}
self.onmessage = (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const feats = Array.from({ length: m.area.length }, (_, i) => ({ id: 'b' + i, geom: { type: 'Point', coords: [0, 0] }, attrs: { footprint_m2: m.area[i], storeys: m.storeys[i], bound: !!m.bound[i] } }));
      world = { spec: 1, frame: { units: 'm', extent: [0, 0, 0, 0], north_deg: 0 }, source: {}, layers: { buildings: feats }, networks: {}, regions: {} };
      (self as any).postMessage({ type: 'ready', description: model.describe() });
    } else if (m.type === 'start') {
      const run = model.start({ params: m.params, scenario: [], world, data: {}, seed: m.seed }); runs.set(m.id, run); post(m.id, run, true);
    } else if (m.type === 'run') {
      const run = runs.get(m.id); if (!run) return;
      const target = m.to as number; let k = 0;
      while (!run.done && run.frame.t < target) { run.step(); k++; if (m.every || run.frame.t >= target || run.done) post(m.id, run, true); }
      if (k === 0) post(m.id, run, true);
    } else if (m.type === 'households') {
      const run = runs.get(m.id); if (!run) return; const h = run.frame.entities.households; const rows: number[][] = [];
      for (let i = 0; i < h.id.length; i++) if (h.anchor[i] === m.building) rows.push([h.quintile[i], h.area[i], h.income[i], h.savings[i], h.horizon[i], h.hstate[i], h.tenure[i]]);
      (self as any).postMessage({ type: 'households', id: m.id, building: m.building, rows });
    } else if (m.type === 'drop') { runs.delete(m.id); }
    else if (m.type === 'check') {
      // dev frame check: checkFrame already runs on every frame inside defineModel (it throws); here: the same params and seed twice must give the same stream
      const stream = () => { const r = model.start({ params: m.params, scenario: [], world, data: {}, seed: m.seed }); const out: string[] = [JSON.stringify(r.frame.series)]; for (let t = 0; t < m.ticks && !r.done; t++) out.push(JSON.stringify(r.step().series)); return out; };
      const a = stream(), b = stream(); const same = a.length === b.length && a.every((x, i) => x === b[i]);
      (self as any).postMessage({ type: 'check', same, frames: a.length });
    }
  } catch (err: any) { (self as any).postMessage({ type: 'error', id: m.id, message: String(err?.message ?? err) }); }
};
