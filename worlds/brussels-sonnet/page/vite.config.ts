import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: '../visual',
    emptyOutDir: false, // beauty-review captures live in ../visual/review/
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000,
  },
});
