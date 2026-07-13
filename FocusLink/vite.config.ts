import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

const sharedResolve = {
  alias: {
    '@': path.resolve(__dirname, 'src'),
    '@shared': path.resolve(__dirname, 'shared'),
  },
};

export default defineConfig({
  resolve: sharedResolve,
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          resolve: sharedResolve,
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // 这两项都必须保留为运行时依赖。把 ws 内联会让 Rollup 将其可选的
              // bufferutil/utf-8-validate require 改造成硬失败，Electron 启动即崩溃。
              external: ['better-sqlite3', 'ws'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          resolve: sharedResolve,
          build: {
            outDir: 'dist-electron',
          },
        },
      },
      renderer: {},
    }),
  ],
  server: {
    port: 5174,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        mini: path.resolve(__dirname, 'mini.html'),
      },
    },
  },
});
