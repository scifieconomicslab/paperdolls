// The world as a module: `import info from 'virtual:page'`.
// Reads the Jette scene, binding, world record and palette, and bundles
// the model with esbuild into a self-contained ESM string.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

const R_EARTH = 6371008.8, DEG = Math.PI / 180;
/** Project lat/lon to the same local metric frame the ingest used (rot = area.rotation_deg). */
function projectBoundary(lat0: number, lon0: number, rotDeg: number, lat: number, lon: number): [number, number] {
  const kx = R_EARTH * Math.cos(lat0 * DEG) * DEG, ky = R_EARTH * DEG;
  const x = (lon - lon0) * kx, y = -(lat - lat0) * ky;
  const a = rotDeg * DEG, c = Math.cos(a), s = Math.sin(a);
  return [x * c + y * s, -x * s + y * c];
}
/** Assemble the outer boundary ring of relation 58258 from its way members (greedy chain by endpoints). */
function communeBoundary(worldDir: string, area: any): [number, number][] | null {
  try {
    const b = JSON.parse(readFileSync(resolve(worldDir, 'map-data/boundary.json'), 'utf8'));
    const els: any[] = b.elements ?? [];
    // boundary.json holds the relation's outer ways (fetched with way(r)); all of them bound the commune
    const ways = els
      .filter((e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2)
      .map((w) => w.geometry.map((g: any) => projectBoundary(area.origin.lat, area.origin.lon, area.rotation_deg ?? 0, g.lat, g.lon)) as [number, number][]);
    if (!ways.length) return null;
    let ring = ways[0].slice();
    const remaining = ways.slice(1);
    const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05;
    while (remaining.length) {
      const end = ring[ring.length - 1];
      let found = -1, flip = false;
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i];
        if (near(w[0], end)) { found = i; flip = false; break; }
        if (near(w[w.length - 1], end)) { found = i; flip = true; break; }
      }
      if (found < 0) return null;
      const w = remaining.splice(found, 1)[0];
      const seq = flip ? w.slice().reverse() : w;
      for (let i = 1; i < seq.length; i++) ring.push(seq[i]);
    }
    return ring;
  } catch {
    return null;
  }
}
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import type { Plugin } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url)); // page/src
const PAGE = resolve(HERE, '..');
const WORLD = process.env.PAPERDOLLS_WORLD ? resolve(process.env.PAPERDOLLS_WORLD) : resolve(PAGE, '..');
const RECORD = resolve(WORLD, basename(WORLD) + '.md');
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
      const md = readFileSync(RECORD, 'utf8');
      const title = (md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(WORLD)).replace(/\s+—\s+the world record\s*$/i, '').trim();
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
      const boundary = communeBoundary(WORLD, scene.area);
      if (boundary) scene._boundary = boundary;
      const payload = { artBibleStatus: (artBible.match(/^status:\s*(.+)$/m)?.[1] ?? 'missing').trim(), scene, binding: { ...binding, look, palette_variant: paletteVariant }, title, description, palette, modelBundle };
      return `export default ${JSON.stringify(payload)};`;
    },
  };
}
