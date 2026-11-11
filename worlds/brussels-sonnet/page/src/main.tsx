import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Sim } from './sim/client';
import { Core } from './core';
import { createWorld } from './scene/world';
import type { GroundData } from './scene/ground';
import scene from '../../map-data/scene.composed.json';
import groundJson from '../../map-data/ground.json';
import binding from '../../sim-code/model-binding.json';
import parity from '../../sim-code/parity.md?raw';

const q = new URLSearchParams(location.search); const snapshot = q.get('snapshot') === '1'; const dev = q.get('dev') === '1';
const canvas = document.createElement('canvas'); canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Isometric map of Jette. Drag to pan, wheel to zoom, F to fit.'); canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline-offset:-3px';
const host = document.getElementById('root')!;
if (!snapshot) { /* the canvas is mounted by App into its host element */ } else { host.style.cssText = 'position:fixed;inset:0'; host.appendChild(canvas); }
if (!window.WebGL2RenderingContext || !document.createElement('canvas').getContext('webgl2')) { host.innerHTML = '<p style="font:16px system-ui;padding:32px">This page needs WebGL2, which this browser does not provide.</p>'; throw new Error('no webgl2'); }

const world = createWorld(canvas, scene, groundJson as unknown as GroundData, { snapshot, q, holdReady: snapshot });
const b = (scene as any).buildings as any[];
const sim = new Sim(Float32Array.from(b.map((x) => x.area)), Int8Array.from(b.map((x) => x.lv)), Uint8Array.from(b.map((x) => (x.bound ? 1 : 0))));
const core = new Core(sim, world); (window as any).__core = core; (window as any).__world = world;
await core.init();
const horizon = Number(core.params['horizon-months']);
if (snapshot) {
  const t = Number(q.get('t') ?? Math.round(0.75 * horizon));
  if (q.get('lens') === '1') world.setLens(true);
  const scn = binding.scenarios.find((x: any) => x.id === q.get('scenario')); const sp: Record<string, any> = { ...core.defaults }; if (scn) for (const iv of scn.interventions) sp[iv.name] = iv.value;
  core.start(sp); core.on(() => { if (core.head === 0 && t > 0) core.runTo(t); if (core.head >= t || core.done) { core.viewTick = core.head; core.applyView(); world.markReady(); } });
} else {
  core.start(); createRoot(host).render(<App core={core} scene={scene} binding={binding} parity={parity} dev={dev} />);
}
