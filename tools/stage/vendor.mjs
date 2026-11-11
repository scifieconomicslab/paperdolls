#!/usr/bin/env node
// Copy the stage into a world's page project and record what was copied.
//
//   node tools/stage/vendor.mjs worlds/<name>            -> worlds/<name>/page/src/stage/*.ts + STAGE.json
//                                                          (and page/ from template/ when the world has none)
//   node tools/stage/vendor.mjs worlds/<name> --check    -> exit 1 if the copy was edited or is older than tools/stage
//
// The copy is part of the world (snapshots and the single-file build need it), but it is not the world's to edit:
// fix the stage here and re-vendor every world that wants the fix.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'src');
const version = readFileSync(join(here, 'VERSION'), 'utf8').trim();
const world = process.argv[2];
if (!world) { console.error('usage: node tools/stage/vendor.mjs worlds/<name> [--check]'); process.exit(2); }
const dest = resolve(world, 'page', 'src', 'stage');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const files = readdirSync(src).filter((f) => f.endsWith('.ts')).sort();

if (process.argv.includes('--check')) {
  const manifest = join(dest, 'STAGE.json');
  if (!existsSync(manifest)) { console.error(`FAIL - ${dest}: no stage (run vendor.mjs without --check)`); process.exit(1); }
  const m = JSON.parse(readFileSync(manifest, 'utf8'));
  let bad = 0;
  for (const [f, h] of Object.entries(m.files)) {
    const p = join(dest, f);
    if (!existsSync(p)) { console.error(`FAIL - stage/${f}: missing`); bad++; }
    else if (sha(p) !== h) { console.error(`FAIL - stage/${f}: edited in the world; fix tools/stage instead and re-vendor`); bad++; }
  }
  if (m.version !== version) console.error(`note - stage ${m.version} in the world, ${version} in tools/stage; re-vendor to update`);
  if (!bad) console.log(`PASS - stage ${m.version}, ${Object.keys(m.files).length} files unedited`);
  process.exit(bad ? 1 : 0);
}

// a world with no page project gets the template first (package.json pins, vite single-file config, worker, main.tsx)
const page = resolve(world, 'page');
if (!existsSync(join(page, 'package.json'))) {
  cpSync(join(here, 'template'), page, { recursive: true });
  console.log(`page project created from tools/stage/template -> ${page} (run npm install there)`);
}
mkdirSync(dest, { recursive: true });
const out = {};
for (const f of files) {
  const text = readFileSync(join(src, f), 'utf8');
  writeFileSync(join(dest, f), text);
  out[f] = sha(join(dest, f));
}
writeFileSync(join(dest, 'STAGE.json'), JSON.stringify({ version, files: out }, null, 2) + '\n');
console.log(`stage ${version} -> ${dest} (${files.length} files)`);
