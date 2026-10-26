import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    // Keep the browser's Host so the worker's same-origin check sees localhost:5173 (the string shorthand rewrites it).
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false, ws: true } },
  },
});
