import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  root:    '.',
  publicDir: 'public',
  build: {
    outDir:    'dist/frontend',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    hmr: {
      host: '209.126.1.43',
      port: 5173,
    },
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  resolve: {
    alias: {
      'react':     'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
});
