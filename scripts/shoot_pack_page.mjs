#!/usr/bin/env node
/* Screenshots of a built pack page in headless Chromium (DevTools protocol, no playwright needed; Node 22+).
 *   node scripts/shoot_pack_page.mjs page.html outdir prefix [month] [--wall N] [--eval "js run before the shots"]
 * Takes three shots: <prefix>_far (fit), <prefix>_mid, <prefix>_near, plus <prefix>_inspector (a building selected, the map zoomed near).
 * Env: CHROME (default: the playwright cache), DPR (default 1), W, H. Software rendering: judge the picture, not the speed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const args = process.argv.slice(2), flag = n => { const i = args.indexOf(n); if (i < 0) return null; return args.splice(i, 2)[1]; };
const wallIdx = flag('--wall'), pre = flag('--eval');
const [pagePath, outDir, prefix, month = '90'] = args;
const page = path.resolve(pagePath); fs.mkdirSync(outDir, { recursive: true });
const W = +(process.env.W || 1440), H = +(process.env.H || 900), dpr = +(process.env.DPR || 1);
const chrome = process.env.CHROME || (() => { const b = path.join(os.homedir(), '.cache/ms-playwright'); const d = fs.readdirSync(b).filter(x => x.startsWith('chromium-')).sort().pop(); return path.join(b, d, 'chrome-linux64/chrome'); })();
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'pdchrome-'))}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch (e) {} await sleep(200); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map(), logs = [];
ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } else if (d.method === 'Runtime.exceptionThrown' || d.method === 'Runtime.consoleAPICalled') logs.push(JSON.stringify(d.params).slice(0, 300)); });
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.data, 'base64')); console.log('wrote', name + '.png'); };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dpr, mobile: false });
await send('Page.navigate', { url: 'file://' + page });
for (let i = 0; i < 100; i++) { if (await ev('!!(window.labPack && labPack.store.frame() && labViewer.camera)').catch(() => false)) break; await sleep(300); }
await sleep(1500);
if (wallIdx !== null) await ev(`labPack.controller.setWall(${+wallIdx})`);
if (pre) await ev(pre);
await ev(`labPack.store.setTime(${+month})`); await sleep(3000);
// a dense spot: the median centroid of the model's buildings
const spot = await ev(`(() => { const b = labPack.sim.buildings, xs = [], ys = []; for (const e of b) { if (e._si !== undefined && labPack.binding.modelOf[e._si] >= 0 && e.fit) { xs.push(e.fit.cx); ys.push(e.fit.cy); } } xs.sort((a, c) => a - c); ys.sort((a, c) => a - c); return [xs[xs.length >> 1], ys[ys.length >> 1], b.length, xs.length]; })()`);
console.log('spot', spot);
const look = async (scale, cx, cy) => { await ev(`(() => { const c = labViewer.camera; c.scale = ${scale} < 0 ? c.fit : ${scale}; c.cx = ${cx}; c.cy = ${cy}; c.zoomAt(1); })()`); await sleep(4500); };
await ev('labViewer.camera.fitAll()'); await sleep(4500); await shot(prefix + '_far');
if (process.env.EXTRA) { for (const s of process.env.EXTRA.split(',')) { await look(+s, spot[0], spot[1]); await shot(prefix + '_s' + s); } }
await look(1.0 * 0.9, spot[0], spot[1]); await shot(prefix + '_mid');                // about 0.9 px per metre: a few hundred buildings across
await look(6, spot[0], spot[1]); await shot(prefix + '_near');
// select a building near the middle of the near view
const px = await ev(`(() => { const v = labViewer.camera.view(), m = labPack.pick.hit; for (let r = 0; r < 300; r += 6) for (let a = 0; a < 6.28; a += 0.5) { const x = v.w / 2 + r * Math.cos(a), y = v.h / 2 + r * Math.sin(a), si = m(v, x, y); if (si >= 0 && labPack.binding.modelOf[si] >= 0) { labPack.store.select({ entity: 'building', id: labPack.binding.modelOf[si] }); return [x, y]; } } return null; })()`);
await sleep(2500); await shot(prefix + '_selected');
// the tooltip over a building, and the inspector's text
const hov = await ev(`(() => { const v = labViewer.camera.view(); for (let r = 40; r < 330; r += 7) for (let a = 0; a < 6.28; a += 0.4) { const x = v.w / 2 + r * Math.cos(a), y = v.h / 2 + r * Math.sin(a), si = labPack.pick.hit(v, x, y); if (si >= 0 && labPack.binding.modelOf[si] >= 0 && labPack.binding.modelOf[si] !== (labPack.store.selection() || {}).id) { const r0 = document.getElementById('stagebox').getBoundingClientRect(); return [x + r0.left, y + r0.top]; } } return null; })()`);
if (hov) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hov[0], y: hov[1], button: 'none', buttons: 0, pointerType: 'mouse' }); await sleep(600); await shot(prefix + '_tooltip'); }
const texts = await ev(`({ tip: labPack.tip && !labPack.tip.hidden ? labPack.tip.textContent : null, inspector: (document.querySelector('.pk-inspector') || {}).innerText, legend: (document.querySelector('.pk-legend') || {}).innerText })`);
console.log(JSON.stringify(texts, null, 1));
await ev(`document.querySelector('.pk-inspector') && document.querySelector('.pk-inspector').scrollIntoView({ block: 'center' })`); await sleep(500); await shot(prefix + '_inspector');
console.log(JSON.stringify({ selectedAt: px, logs: logs.slice(0, 5) }));
proc.kill(); ws.close(); process.exit(0);
