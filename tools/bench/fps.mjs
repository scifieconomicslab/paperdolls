#!/usr/bin/env node
// Frame-rate gate for any built paperdolls page.
//
//   node tools/bench/fps.mjs <page.html|url> [--runs 3000] [--dpr 1 2]
//
// Pass = p50 <= 16.7 ms and p95 <= 33 ms. Uses a real GPU (ANGLE/GL); a
// software-only renderer is reported honestly, not accepted as a verdict.
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: node tools/bench/fps.mjs <page.html|url> [--runs 3000] [--dpr 1 2]');
  process.exit(2);
}
const runs = Number(argv.includes('--runs') ? argv[argv.indexOf('--runs') + 1] : 3000);
const dprs = argv.includes('--dpr')
  ? argv.slice(argv.indexOf('--dpr') + 1).filter((a) => !a.startsWith('--')).map(Number)
  : [1];

const url = /^(https?:|file:)/.test(target) ? target : pathToFileURL(resolve(target)).href;
if (/^file:/.test(url) && !existsSync(decodeURIComponent(new URL(url).pathname))) {
  console.error(`no such page: ${target}`);
  process.exit(2);
}

const browser = await launch();
let failed = false;
for (const dpr of dprs) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(4000);
  const deltas = await page.evaluate(async (duration) => {
    const out = [];
    let last = performance.now();
    const start = last;
    await new Promise((done) => {
      const frame = (now) => {
        out.push(now - last);
        last = now;
        if (now - start < duration) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
    return out;
  }, runs);
  const sorted = [...deltas].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const p50 = +p(0.5).toFixed(1);
  const p95 = +p(0.95).toFixed(1);
  const max = +Math.max(...deltas).toFixed(1);
  const pass = p50 <= 16.7 && p95 <= 33 && errors.length === 0;
  console.log(JSON.stringify({ url, dpr, frames: deltas.length, p50, p95, max, errors: errors.slice(0, 5), pass }));
  if (!pass) failed = true;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
