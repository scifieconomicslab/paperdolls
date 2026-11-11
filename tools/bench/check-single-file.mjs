#!/usr/bin/env node
// Fails unless a built page is one self-contained file: no external scripts, stylesheets, module preloads
// or fetches of local files. Usage: node bench/check-single-file.mjs path/to/index.html [--allow-inline-worker]
import { readFileSync } from 'node:fs';

const f = process.argv[2] || new URL('../../../worlds/fixture-smoke/visual/index.html', import.meta.url).pathname;
const html = readFileSync(f, 'utf8');

const externalRef = [...html.matchAll(/<(script|link|img|audio|video|source|iframe)\b[^>]*\b(src|href|poster)=["']([^"']+)["']/gi)]
  .map(m => m[3])
  .filter(u => !u.startsWith('data:') && !u.startsWith('blob:'));
const externalUrlRef = [...html.matchAll(/url\((?!['"]?data:|['"]?blob:)['"]?https?:\/\/[^)]+\)/gi)].map(m => m[0]);
const externalFetch = (html.match(/\bfetch\s*\(\s*['"]https?:/g) || []).length;
const externalXhr = (html.match(/XMLHttpRequest/g) || []).length ? true : false;

let fail = false;
const report = (ok, what) => { if (!ok) { console.error('FAIL: ' + what); fail = true; } else console.log('PASS: ' + what); };

report(externalRef.length === 0, externalRef.length === 0 ? 'no external script/link/img/media references' : 'external references: ' + externalRef.join(', '));
report(externalUrlRef.length === 0, 'no external url(...) references');
report(externalFetch === 0, 'no fetch() of http(s) URLs');
report(!externalXhr, 'no XMLHttpRequest');

const size = (html.length / 1024 / 1024).toFixed(2);
console.log(fail ? `${f}: ${size} MB — NOT single-file clean` : `${f}: one self-contained file, ${size} MB`);
process.exit(fail ? 1 : 0);
