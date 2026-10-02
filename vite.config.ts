import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // The LibreDWG bundle ships a large Emscripten module that confuses esbuild's
    // dependency pre-bundling; let Vite handle it as a normal source dependency.
    exclude: ['@mlightcad/libredwg-web'],
  },
  build: {
    target: 'es2022',
    // The LibreDWG bundle is large by nature; raise the warning ceiling so the
    // build output stays readable.
    chunkSizeWarningLimit: 2048,
  },
});
