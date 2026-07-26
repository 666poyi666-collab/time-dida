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
    // 手表的系统 WebView 停在 Chrome 83 且不会更新；es2022 会原样输出
    // 逻辑赋值等 83 解析不了的语法，整包在解析期就死。降到 chrome83，
    // 现代设备照跑，代价只是少量转译体积。
    target: 'chrome83',
  },
});
