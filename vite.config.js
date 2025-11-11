import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Vite configuration specifying custom dev & preview ports.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // include commonly needed polyfills for apify-client
      include: [
        'buffer',
        'process',
        'events',
        'stream',
        'util'
      ],
      // exclude performance heavy modules if not needed
      exclude: [ 'path', 'fs', 'http', 'https', 'os', 'zlib' ]
    })
  ],
  server: {
    port: 4615,
    host: 'localhost'
  },
  preview: {
    port: 4615,
    host: 'localhost'
  },
  build: {
    target: 'esnext'
  },
  optimizeDeps: {
    include: ['events', 'util', 'process', 'buffer']
  },
  define: {
    'process.env': {}
  }
});
