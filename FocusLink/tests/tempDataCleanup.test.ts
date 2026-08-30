import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempRoots: string[] = [];

async function loadCleaner() {
  return import('../scripts/maintenance/clean-temp-data.mjs');
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

describe('temporary fixture cleanup', () => {
  it('refuses to run from a directory that is not the FocusLink project', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'focuslink-wrong-root-'));
    tempRoots.push(root);
    const cleaner = await loadCleaner();

    await expect(cleaner.runCleanup({ focuslinkRoot: root, workspaceRoot: root })).rejects.toThrow(
      /outside a FocusLink project/,
    );
  });

  it('only accepts direct children and rejects links', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'focuslink-cleaner-'));
    tempRoots.push(root);
    const nested = path.join(root, 'nested');
    await fsp.mkdir(nested);
    const cleaner = await loadCleaner();

    expect(() => cleaner.assertSafeDirectChild(root, root)).toThrow(/non-direct child/);
    expect(() => cleaner.assertSafeDirectChild(nested, root)).not.toThrow();
    const link = path.join(root, 'link');
    try {
      await fsp.symlink(nested, link, 'junction');
    } catch (error) {
      if (
        process.platform === 'win32' &&
        error instanceof Error &&
        'code' in error &&
        (error.code === 'EPERM' || error.code === 'EACCES')
      ) {
        return;
      }
      throw error;
    }
    expect(() => cleaner.assertSafeDirectChild(link, root)).toThrow(/symbolic link/);
  });

  it('discovers stale fixtures but protects current APK evidence', async () => {
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'focuslink-workspace-'));
    const project = path.join(workspace, 'FocusLink');
    const external = path.join(workspace, 'external-temp');
    tempRoots.push(workspace);
    await fsp.mkdir(path.join(project, '.tmp'), { recursive: true });
    await fsp.mkdir(path.join(workspace, '.tmp'), { recursive: true });
    await fsp.mkdir(external, { recursive: true });
    await fsp.mkdir(path.join(project, '.tmp', 'android-apk-backups'));
    await fsp.mkdir(path.join(project, '.tmp', 'dry-run-focuslink'));
    await fsp.writeFile(path.join(project, '.tmp', 'production-task-smoke.cjs'), 'fixture');
    await fsp.mkdir(path.join(workspace, '.tmp', 'release-old'));
    await fsp.mkdir(path.join(external, 'focuslink-ui-smoke-old'));
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000);
    for (const file of [
      path.join(project, '.tmp', 'dry-run-focuslink', 'result.txt'),
      path.join(workspace, '.tmp', 'release-old', 'asset.bin'),
      path.join(external, 'focuslink-ui-smoke-old', 'state.json'),
      path.join(project, '.tmp', 'production-task-smoke.cjs'),
    ]) {
      await fsp.writeFile(file, 'fixture');
      await fsp.utimes(file, old, old);
    }
    for (const directory of [
      path.join(project, '.tmp', 'dry-run-focuslink'),
      path.join(workspace, '.tmp', 'release-old'),
      path.join(external, 'focuslink-ui-smoke-old'),
    ]) {
      await fsp.utimes(directory, old, old);
    }
    const cleaner = await loadCleaner();
    const plan = cleaner.buildCleanupPlan({
      focuslinkRoot: project,
      workspaceRoot: workspace,
      externalRoots: [external],
      now: Date.now(),
      maxAgeMs: 24 * 60 * 60 * 1_000,
    });
    const paths = plan.map((item) => item.path);
    expect(paths).toContain(path.resolve(project, '.tmp', 'dry-run-focuslink'));
    expect(paths).toContain(path.resolve(project, '.tmp', 'production-task-smoke.cjs'));
    expect(paths).toContain(path.resolve(workspace, '.tmp', 'release-old'));
    expect(paths).toContain(path.resolve(external, 'focuslink-ui-smoke-old'));
    expect(paths).not.toContain(path.resolve(project, '.tmp', 'android-apk-backups'));
  });

  it('removes readonly nested fixtures and verifies the postcondition', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'focuslink-cleaner-'));
    tempRoots.push(root);
    const target = path.join(root, 'fixture');
    const nested = path.join(target, 'nested');
    await fsp.mkdir(nested, { recursive: true });
    const file = path.join(nested, 'readonly.bin');
    await fsp.writeFile(file, 'fixture');
    await fsp.chmod(file, 0o400);
    const cleaner = await loadCleaner();

    await expect(cleaner.removePathWithRetry(target)).resolves.toMatchObject({ removed: true });
    expect(fs.existsSync(target)).toBe(false);
  });
});
