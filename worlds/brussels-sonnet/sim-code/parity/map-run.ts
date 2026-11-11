// Map mode smoke + timing: the model on the real Jette buildings (composed scene), headless.
//   node map-run.ts [--ticks 360]
import { readFileSync } from 'node:fs';
import model from '../model.ts';
const ti = process.argv.indexOf('--ticks'); const ticks = ti > 0 ? +process.argv[ti + 1] : 360;
const scene = JSON.parse(readFileSync(new URL('../../map-data/scene.composed.json', import.meta.url), 'utf8'));
const feats = scene.buildings.map((b: any, i: number) => ({ id: b.id, geom: { type: 'Polygon', coords: b.fp }, attrs: { footprint_m2: b.area, storeys: b.lv, bound: b.bound } }));
const world: any = { spec: 1, frame: { units: 'm', extent: [0, 0, 0, 0], north_deg: 0 }, source: {}, layers: { buildings: feats }, networks: {}, regions: {} };
const t0 = Date.now(); const run = model.start({ params: { 'horizon-months': ticks }, scenario: [], world, data: {}, seed: 0 });
console.log('start', Date.now() - t0, 'ms; households', run.frame.entities.households.id.length, 'buildings', run.frame.entities.buildings.id.length);
const t1 = Date.now(); let f = run.frame; let worst = 0; while (!run.done) { const a = Date.now(); f = run.step(); worst = Math.max(worst, Date.now() - a); }
console.log('steps', f.t, 'in', Date.now() - t1, 'ms; slowest step', worst, 'ms; mean', ((Date.now() - t1) / f.t).toFixed(1), 'ms');
console.log('adopted units', f.series['monitor:adopted units'][0], 'public cost', Math.round(f.series['monitor:public cost'][0]), 'building states', JSON.stringify(f.series['building states']), 'tenures', JSON.stringify(f.series['tenures']));
