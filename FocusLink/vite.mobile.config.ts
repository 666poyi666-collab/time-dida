import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const projectRoot = __dirname;
const mobileRoot = path.resolve(projectRoot, 'mobile');

export default defineConfig({
  root: mobileRoot,
  base: './',
  publicDir: path.resolve(mobileRoot, 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      '@mobile': path.resolve(projectRoot, 'src/mobile'),
      '@shared': path.resolve(projectRoot, 'shared'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    fs: {
      allow: [projectRoot],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(projectRoot, 'dist-mobile'),
    emptyOutDir: true,
    target: 'es2022',
  },
});
