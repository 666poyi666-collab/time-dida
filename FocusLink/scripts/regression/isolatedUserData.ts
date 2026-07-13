import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/** Route Electron regression data into the ignored workspace test-data tree. */
export function configureIsolatedUserData(name: string, reset: boolean): string {
  const base = path.resolve(process.cwd(), 'test-data');
  const target = path.resolve(base, name);
  if (!target.startsWith(base + path.sep)) {
    throw new Error(`Refusing to use regression data path outside ${base}`);
  }
  if (reset && fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(target, { recursive: true });
  app.setPath('userData', target);
  return target;
}
