// The world as a module: `import info from 'virtual:page'`.
// Reads the conformance scene, binding, world record and palette, and bundles
// the model with esbuild into a self-contained ESM string.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import type { Plugin } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url)); // page/src
const PAGE = resolve(HERE, '..');
const WORLD = process.env.PAPERDOLLS_WORLD ? resolve(process.env.PAPERDOLLS_WORLD) : resolve(PAGE, '..');
const REPO = resolve(WORLD, '../..');
const composedOr = (dir: string) => existsSync(resolve(dir, 'scene.composed.json')) ? resolve(dir, 'scene.composed.json') : resolve(dir, 'scene.json');
const ID = 'virtual:page';
const RESOLVED = '\0' + ID;

function paletteLook(family: string, region: string, lookId: string | undefined) {
  const pal = JSON.parse(readFileSync(resolve(REPO, 'reference/render/palettes.json'), 'utf8'));
  const fam = pal.families.find((f: { id: string }) => f.id === region) ?? pal.families[0];
  return fam.looks.find((l: { id: string }) => l.id === lookId) ?? fam.looks[0];
}

export function pagePlugin(): Plugin {
  return {
    name: 'paperdolls-page',
    resolveId(id) { return id === ID ? RESOLVED : null; },
    load(id) {
      if (id !== RESOLVED) return null;
      const scene = JSON.parse(readFileSync(composedOr(resolve(WORLD, 'map-data')), 'utf8'));
      const binding = JSON.parse(readFileSync(resolve(WORLD, 'sim-code/model-binding.json'), 'utf8'));
      const md = readFileSync(resolve(WORLD, 'conformance.md'), 'utf8');
      const title = (md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Conformance world').replace(/\s+—\s+the world record\s*$/i, '').trim();
      const description = (md.split(/\n\s*\n/).find((p) => p.trim() && !p.trim().startsWith('#') && !p.trim().startsWith('---')) ?? '').replace(/\s+/g, ' ').trim();
      const palette = paletteLook(binding.family, binding.region, binding.palette_look);
      const allowedLooks = ['house', 'colorfigures', 'formal', 'voxel'];
      const look = process.env.PAPERDOLLS_LOOK ?? binding.look;
      if (!allowedLooks.includes(look)) throw new Error(`paperdolls: unknown look "${look}"; use one of ${allowedLooks.join(', ')}`);
      const paletteVariant = process.env.PAPERDOLLS_PALETTE_VARIANT ?? binding.palette_variant;
      const modelBundle = buildSync({
        entryPoints: [resolve(WORLD, 'sim-code/model.ts')],
        bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
      }).outputFiles[0].text;
      const artBible = existsSync(resolve(WORLD, 'art-bible.md')) ? readFileSync(resolve(WORLD, 'art-bible.md'), 'utf8') : '';
      const payload = { artBibleStatus: (artBible.match(/^status:\s*(.+)$/m)?.[1] ?? 'missing').trim(), scene, binding: { ...binding, look, palette_variant: paletteVariant }, title, description, palette, modelBundle };
      return `export default ${JSON.stringify(payload)};`;
    },
  };
}
