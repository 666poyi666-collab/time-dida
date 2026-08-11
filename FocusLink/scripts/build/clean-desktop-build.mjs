import { rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd());
const target = path.resolve(root, 'dist-electron');

if (path.dirname(target) !== root || path.basename(target) !== 'dist-electron') {
  throw new Error(`Refusing to clean unexpected desktop build path: ${target}`);
}

await rm(target, { recursive: true, force: true });
console.log(`[clean-desktop-build] removed ${target}`);
