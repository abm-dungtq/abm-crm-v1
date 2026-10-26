import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5174,
    strictPort: true,
    // Keep the browser's Host so the worker's same-origin check sees localhost:5174 (the string shorthand rewrites it).
    proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: false } },
  },
});
