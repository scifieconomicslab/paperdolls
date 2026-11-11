import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One offline file: everything inlined, the worker too (import it with ?worker&inline).
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: process.env.PAPERDOLLS_OUT ? resolve(process.env.PAPERDOLLS_OUT) : resolve(import.meta.dirname, '../visual'),
    emptyOutDir: false,   // visual/review/ holds the beauty rounds; emptying the out dir deletes them
    assetsInlineLimit: 64 * 1024 * 1024,
  },
  worker: { format: 'es' },
});
