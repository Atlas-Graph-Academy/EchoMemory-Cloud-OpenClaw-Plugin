import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Single-page app — inline everything for easy serving
    assetsInlineLimit: 100000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:17823',
    },
  },
});
