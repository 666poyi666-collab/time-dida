import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  ensureTomatodoBridge,
  getTomatodoBridgeStatus,
  type TomatodoBridgeLifecycleDependencies,
} from '../electron/integrations/tomatodo/bridgeLifecycle';

function installedPath(): string {
  return path.join('C:\\Program Files', 'TomaToDo', 'TomaToDo.exe');
}

function dependencies(
  overrides: Partial<TomatodoBridgeLifecycleDependencies> = {},
): TomatodoBridgeLifecycleDependencies {
  return {
    env: {
      ProgramFiles: 'C:\\Program Files',
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    },
    homedir: 'C:\\Users\\test',
    platform: 'win32',
    fileExists: (candidate) => candidate === installedPath(),
    probeBridge: async () => ({
      connected: false,
      pageDiscovered: false,
      error: 'tomatodo_bridge_unavailable',
    }),
    isRunning: async () => false,
    delay: async () => undefined,
    ...overrides,
  };
}

describe('TomaToDo bridge lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports an already connected verified bridge without launching', async () => {
    const spawnProcess = vi.fn();
    const status = await ensureTomatodoBridge({
      dependencies: dependencies({
        probeBridge: async () => ({ connected: true, pageDiscovered: true }),
        spawnProcess,
      }),
    });

    expect(status).toMatchObject({
      state: 'connected',
      connected: true,
      running: true,
      installed: true,
      launched: false,
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('reports a standard installation as stopped during a read-only status check', async () => {
    const status = await getTomatodoBridgeStatus(dependencies());

    expect(status).toEqual({
      state: 'stopped',
      connected: false,
      running: false,
      installed: true,
      launched: false,
      executablePath: installedPath(),
    });
  });

  it('launches a stopped standard installation with argument arrays and waits for identity', async () => {
    const probeBridge = vi
      .fn()
      .mockResolvedValueOnce({
        connected: false,
        pageDiscovered: false,
        error: 'tomatodo_bridge_unavailable',
      })
      .mockResolvedValue({ connected: true, pageDiscovered: true });
    const child = { once: vi.fn(), unref: vi.fn() };
    const spawnProcess = vi.fn(() => child);

    const status = await ensureTomatodoBridge({
      timeoutMs: 1_000,
      pollIntervalMs: 50,
      dependencies: dependencies({ probeBridge, spawnProcess }),
    });

    expect(status).toMatchObject({ state: 'connected', connected: true, launched: true });
    expect(spawnProcess).toHaveBeenCalledWith(
      installedPath(),
      ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it('requires a user-controlled restart when TomaToDo is already running without a bridge', async () => {
    const spawnProcess = vi.fn();
    const status = await ensureTomatodoBridge({
      dependencies: dependencies({ isRunning: async () => true, spawnProcess }),
    });

    expect(status).toMatchObject({
      state: 'restart-required',
      connected: false,
      running: true,
      launched: false,
    });
    expect(status.error).toContain('不会强制关闭');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('reports not-installed without attempting a launch', async () => {
    const spawnProcess = vi.fn();
    const status = await ensureTomatodoBridge({
      dependencies: dependencies({ fileExists: () => false, spawnProcess }),
    });

    expect(status).toMatchObject({
      state: 'not-installed',
      connected: false,
      running: false,
      installed: false,
      launched: false,
    });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('reports launch-failed when the executable cannot be started', async () => {
    const status = await ensureTomatodoBridge({
      dependencies: dependencies({
        spawnProcess: () => {
          throw new Error('access denied');
        },
      }),
    });

    expect(status).toMatchObject({
      state: 'launch-failed',
      connected: false,
      running: false,
      launched: false,
    });
    expect(status.error).toContain('access denied');
  });

  it('reports launch-timeout without terminating the process', async () => {
    const child = { once: vi.fn(), unref: vi.fn() };
    const isRunning = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const status = await ensureTomatodoBridge({
      timeoutMs: 1_000,
      pollIntervalMs: 1_000,
      dependencies: dependencies({
        isRunning,
        spawnProcess: () => child,
      }),
    });

    expect(status).toMatchObject({
      state: 'launch-timeout',
      connected: false,
      running: true,
      launched: true,
    });
    expect(child.unref).toHaveBeenCalledTimes(1);
  });
});
