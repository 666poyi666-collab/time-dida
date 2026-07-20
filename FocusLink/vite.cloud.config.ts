import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  build: {
    target: 'node20',
    outDir: 'dist-cloud',
    emptyOutDir: true,
    ssr: path.resolve(__dirname, 'cloud/server.ts'),
    rollupOptions: {
      output: {
        entryFileNames: 'server.mjs',
      },
    },
  },
});
