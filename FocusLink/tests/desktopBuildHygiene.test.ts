import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop build hygiene', () => {
  it('removes stale Electron chunks before every production build', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-desktop-build-'));
    const output = path.join(root, 'dist-electron');
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, 'main-stale.js'), 'stale');

    try {
      execFileSync(
        process.execPath,
        [path.join(process.cwd(), 'scripts', 'build', 'clean-desktop-build.mjs')],
        { cwd: root, stdio: 'pipe' },
      );
      expect(fs.existsSync(output)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs the cleaner after version generation and before Vite', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.['clean:desktop-build']).toBe(
      'node scripts/build/clean-desktop-build.mjs',
    );
    expect(packageJson.scripts?.build).toBe(
      'npm run gen-version && npm run clean:desktop-build && tsc --noEmit && npm run typecheck:cloudflare && vite build',
    );
  });
});
