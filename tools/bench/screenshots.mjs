#!/usr/bin/env node
// Snapshots for any built paperdolls page that implements the snapshot URL
// contract (skills/paperdolls-scene-craft/SKILL.md §6).
//
//   node tools/bench/screenshots.mjs --world worlds/<name> [--page <index.html>] [--out <dir>]
//       Gate-4 map check: top-down.png, iso-0.png, iso-90.png (default out: <world>/map-data/verify)
//
//   node tools/bench/screenshots.mjs --world worlds/<name> --beauty [--round <n>] [--out <dir>]
//       Beauty review: overview.png, neighbourhood.png, street.png, lens.png,
//       street-90.png and a six-frame street clip (clip-0..5.png)
//       (default out: <world>/visual/review/round-<n>)
//
// Waits for window.__paperdollsReady === true (falls back to a fixed wait).
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launch } from './browser.mjs';

const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const beauty = argv.includes('--beauty');
const round = arg('--round') ?? '1';
const world = resolve(arg('--world') ?? '.');
const pagePath = resolve(arg('--page') ?? join(world, 'visual', 'index.html'));
const outDir = resolve(arg('--out') ?? (beauty
  ? join(world, 'visual', 'review', `round-${round}`)
  : join(world, 'map-data', 'verify')));
if (!existsSync(pagePath)) {
  console.error(`no such page: ${pagePath}`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const mapViews = [
  { name: 'top-down', query: 'snapshot=1&view=top' },
  { name: 'iso-0', query: 'snapshot=1&view=iso&angle=0' },
  { name: 'iso-90', query: 'snapshot=1&view=iso&angle=90' },
];
const beautyViews = [
  { name: 'overview', query: 'snapshot=1&shot=overview' },
  { name: 'neighbourhood', query: 'snapshot=1&shot=neighbourhood' },
  { name: 'street', query: 'snapshot=1&shot=street' },
  { name: 'lens', query: 'snapshot=1&shot=neighbourhood&lens=1' },
  { name: 'street-90', query: 'snapshot=1&shot=street&angle=90' },
  ...[0, 1, 2, 3, 4, 5].map((i) => ({ name: `clip-${i}`, query: `snapshot=1&shot=street&clock=${(i * 0.5).toFixed(1)}` })),
];
const views = beauty ? beautyViews : mapViews;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
let readyMissing = false;
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const base = pathToFileURL(pagePath).href;
for (const view of views) {
  await page.goto(`${base}?${view.query}`);
  try {
    await page.waitForFunction(() => window.__paperdollsReady === true, null, { timeout: 15000 });
    await page.waitForTimeout(300);
  } catch {
    readyMissing = true;
    await page.waitForTimeout(2500);
  }
  const out = join(outDir, `${view.name}.png`);
  await page.screenshot({ path: out });
  console.log(out);
}
if (readyMissing) {
  console.error('warning: page never set window.__paperdollsReady; used a fixed 2.5 s wait');
}
if (errors.length) {
  console.error('errors:', errors.slice(0, 5));
  process.exitCode = 1;
}
await browser.close();
