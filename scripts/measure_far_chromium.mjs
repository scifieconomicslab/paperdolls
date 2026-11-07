#!/usr/bin/env node
/* Frame times of a built pack page's far ('Fit') view in headless Chromium: the first paint, and playback at 24 months a second.
 *   node scripts/measure_far_chromium.mjs page.html [--gpu] [--out shots/prefix] [--months 24] [--seconds 6] [--patch-from 20]
 * First paint: a requestAnimationFrame gap recorder is installed before the page's own scripts run; the gaps from the navigation until the picture is whole (no layer
 * left to paint, found by the renderer's own counters) are reported: the worst gap, how many were over 100 ms, how long until whole.
 * Playback: the pack's store is stepped one month every 1000/months ms for the given seconds, from month patch-from, with the same recorder running.
 * Env: CHROME (default: the playwright cache), W, H (default 1440 by 900), DPR (1). Without --gpu the page is rasterised in software (--disable-gpu).
 * With --gpu Chromium is asked for the NVIDIA GPU (ANGLE on Vulkan/EGL, GPU rasterisation, canvas acceleration); the script prints what chrome://gpu reports, so a run
 * that fell back to software says so. Prints one JSON object. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const args = process.argv.slice(2), flag = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; return args.splice(i, 2)[1]; }, has = n => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const gpu = has('--gpu'), out = flag('--out', null), months = +flag('--months', 24), seconds = +flag('--seconds', 6), from = +flag('--patch-from', 20), page = path.resolve(args[0]);
const W = +(process.env.W || 1440), H = +(process.env.H || 900), dpr = +(process.env.DPR || 1);
const chrome = process.env.CHROME || (() => { const b = path.join(os.homedir(), '.cache/ms-playwright'); const d = fs.readdirSync(b).filter(x => x.startsWith('chromium-')).sort().pop(); return path.join(b, d, 'chrome-linux64/chrome'); })();
const port = 9300 + Math.floor(Math.random() * 500);
const flags = gpu ? ['--headless=new', '--no-sandbox', ...(process.env.GPU_FLAGS ? process.env.GPU_FLAGS.split(' ') : ['--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan']), '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-accelerated-2d-canvas', '--disable-gpu-driver-bug-workarounds']
                   : ['--headless=new', '--no-sandbox', '--disable-gpu'];
const proc = spawn(chrome, [...flags, `--remote-debugging-port=${port}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'pdchrome-'))}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch (e) {} await sleep(200); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } });
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const R = { page: path.basename(page), gpu_requested: gpu, dpr, size: [W, H] };
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dpr, mobile: false });
  // the recorder runs from the first script of the page: every requestAnimationFrame gap with its time since navigation start
  // renderFrame itself is timed too (what the frame cost the main thread, apart from the display's own pacing): VizLib is wrapped when the page assigns it
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__rf = []; (() => { let v; Object.defineProperty(window, 'VizLib', { configurable: true, get() { return v; }, set(x) { v = x; if (x && x.renderFrame) { const o = x.renderFrame; x.renderFrame = function () { const t = performance.now(); try { return o.apply(this, arguments); } finally { window.__rf.push([+t.toFixed(1), +(performance.now() - t).toFixed(1)]); } }; } } }); })();` });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__gaps = []; (() => { let last = performance.now(); const f = n => { window.__gaps.push([+n.toFixed(1), +(n - last).toFixed(1)]); last = n; requestAnimationFrame(f); }; requestAnimationFrame(f); })();` });
  await send('Page.navigate', { url: 'file://' + page });
  let bound = null; for (let i = 0; i < 300; i++) { bound = await ev('window.labPack && labPack.store && labPack.store.frame() && typeof labViewer !== "undefined" && labViewer.camera ? performance.now() : null').catch(() => null); if (bound) break; await sleep(100); }
  R.bound_at_ms = bound && Math.round(bound);
  // whole = the renderer has nothing left to paint: no sliced layer, no patch, no rough layer, no sprite builds queued
  const wholeJs = `(() => { const s = labPack.sim, A = window.AssetLib; return !!s && !!s._far && !!s._ground && !s._farP && !s._groundP && !s._farPatch && !(s._far && s._far.rough) && !s._farC && !s._groundC && (!A || A.sprites.builds === 0); })()`;
  let wholeAt = null; for (let i = 0; i < 600; i++) { if (await ev(wholeJs).catch(() => false)) { await sleep(300); if (await ev(wholeJs).catch(() => false)) { wholeAt = await ev('performance.now()'); break; } } await sleep(100); }
  R.whole_at_ms = wholeAt && Math.round(wholeAt);
  const stats = g => { const d = g.map(x => x[1]).sort((a, b) => a - b); return d.length ? { frames: d.length, p50_ms: d[d.length >> 1], p95_ms: d[Math.floor(d.length * 0.95)], max_ms: d[d.length - 1], over_50: d.filter(x => x > 50).length, over_100: d.filter(x => x > 100).length } : null; };
  const gaps = await ev('window.__gaps'); const t0 = 0;
  // before the pack is bound the page is building its scene (createSim, the binding): that is setup, not painting, and is the same with or without the fix, so it is reported apart
  const setup = gaps.filter(g => g[0] <= (bound || 0)), paint = gaps.filter(g => g[0] > (bound || 0) && g[0] <= (wholeAt || 1e9));
  R.setup = { note: 'rAF gaps up to the moment the pack is bound (scene building)', max_ms: setup.length ? Math.max(...setup.map(g => g[1])) : null };
  R.first_paint = Object.assign({ note: 'rAF gaps from the bound pack until nothing is left to paint' }, stats(paint));
  { const rf = await ev('window.__rf'), a = rf.filter(g => g[0] > (bound || 0) - 50 && g[0] <= (wholeAt || 1e9)), d = a.map(g => g[1]).sort((x, y) => x - y); R.first_paint.renderFrame = d.length ? { calls: d.length, first_ms: a[0][1], max_ms: d[d.length - 1], p50_ms: d[d.length >> 1], over_100: d.filter(x => x > 100).length } : null; }
  R.first_paint.gaps_over_100 = paint.filter(g => g[1] > 100).map(g => [Math.round(g[0]), Math.round(g[1])]).slice(0, 12);
  await ev('labViewer.camera.fitAll()'); await sleep(1500);
  R.view = await ev('({ scale: labViewer.camera.scale, fit: labViewer.camera.fit })');
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(out + '_before_play.png', Buffer.from(r.data, 'base64')); }
  // playback
  await ev(`labPack.store.setTime(${from})`); await sleep(2500);
  await ev('window.__gaps.length = 0');
  const lag = await ev(`new Promise(res => { let t = ${from}, n = 0; const total = Math.round(${months} * ${seconds}), iv = setInterval(() => { labPack.store.setTime(++t); if (++n >= total) { clearInterval(iv); setTimeout(() => res(n), 500); } }, 1000 / ${months}); })`);
  const pg = await ev('window.__gaps'); R.playback = Object.assign({ months_per_s: months, seconds, patches: lag }, stats(pg));
  { const rf = await ev('window.__rf'), d = rf.slice(-pg.length).map(g => g[1]).sort((x, y) => x - y); R.playback.renderFrame = d.length ? { p50_ms: d[d.length >> 1], p95_ms: d[Math.floor(d.length * 0.95)], max_ms: d[d.length - 1], over_50: d.filter(x => x > 50).length } : null; }
  await sleep(3000);
  if (out) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(out + '_after_play.png', Buffer.from(r.data, 'base64')); }
  R.counters = await ev('({ layerRepaints: labPack.sim.layerRepaints, farPatches: labPack.sim.farPatches || 0, farRects: labPack.sim.farRectsPainted || 0, fallbacks: labPack.sim.farPatchFallbacks || 0, roughPaints: labPack.sim.layerRoughPaints || 0 })');
  if (gpu) { await send('Page.navigate', { url: 'chrome://gpu' }); await sleep(2500); R.chrome_gpu = (await ev(`document.body.innerText`).catch(() => '')).split('\\n').filter(l => /Canvas|Rasterization|GL_RENDERER|Compositing|WebGL:|Vulkan|ANGLE/i.test(l)).slice(0, 14); }
} finally { proc.kill(); }
console.log(JSON.stringify(R, null, 1));
