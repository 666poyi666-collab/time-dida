// 用 esbuild 把 selftest.ts / crash-recovery.ts bundle 成 .cjs，处理 @shared 别名
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const alias = {
  '@shared': path.join(root, 'shared'),
  '@': path.join(root, 'src'),
};
const external = ['better-sqlite3', 'electron'];

for (const entry of [
  'selftest.ts',
  'crash-recovery.ts',
  'task-test.ts',
  'device-sync-db.ts',
  'dida-task-state-smoke.ts',
  'tomatodo-cloud-real-smoke.ts',
]) {
  await esbuild.build({
    entryPoints: [path.join(root, 'scripts', 'regression', entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(root, 'dist-selftest', entry.replace(/\.ts$/, '.cjs')),
    external,
    alias,
    logLevel: 'info',
  });
}

console.log('all scripts bundled to dist-selftest/');
