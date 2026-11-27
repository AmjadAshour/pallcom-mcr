import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // Frontend configuration uses same-origin routes.
  envPrefix: [],
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://127.0.0.1:4000',
        ws: true
      },
      '/agent-ws': {
        target: 'http://127.0.0.1:4000',
        ws: true
      }
    }
  }
});
