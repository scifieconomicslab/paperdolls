import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { pagePlugin } from './src/world-plugin.ts';

export default defineConfig({
  plugins: [pagePlugin(), viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: process.env.PAPERDOLLS_OUT ? resolve(process.env.PAPERDOLLS_OUT) : resolve(import.meta.dirname, '../visual'),
    emptyOutDir: false,   // visual/review/ (beauty-review captures) lives inside the out dir; emptying it deleted them
    assetsInlineLimit: 64 * 1024 * 1024,
  },
});
