import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  token: `fl2_account1_desktop1_${'x'.repeat(32)}`,
  settings: {
    deviceSync: {
      enabled: true,
      endpoint: 'https://sync.example.test',
      autoSync: true,
      liveControlEnabled: false,
    },
  },
  events: [] as string[],
  runDesktopSyncV2: vi.fn(),
  runRemoteWritebacks: vi.fn(),
  getNextRemoteWritebackRetryAt: vi.fn(),
}));

vi.mock('../electron/db/index.js', () => ({
  getMeta: vi.fn(() => null),
  setMeta: vi.fn(),
  getSession: vi.fn(() => null),
  insertDeviceSyncBundleIfMissing: vi.fn(),
  listFinishedSessionsForDeviceSync: vi.fn(() => []),
  listPauses: vi.fn(() => []),
  listSegments: vi.fn(() => []),
}));

vi.mock('../electron/settingsStore.js', () => ({
  getSettings: () => harness.settings,
  updateSettings: vi.fn(),
}));

vi.mock('../electron/sync/deviceSyncCredentials.js', () => ({
  getDeviceSyncToken: () => harness.token,
  hasDeviceSyncToken: () => Boolean(harness.token),
  setDeviceSyncToken: vi.fn(),
}));

vi.mock('../electron/sync/deviceSyncV2Service.js', () => ({
  runDesktopSyncV2: harness.runDesktopSyncV2,
}));

vi.mock('../electron/sync/remoteWritebackCoordinator.js', () => ({
  runRemoteWritebacks: harness.runRemoteWritebacks,
}));

vi.mock('../electron/sync/remoteWritebackStore.js', () => ({
  getNextRemoteWritebackRetryAt: harness.getNextRemoteWritebackRetryAt,
}));

vi.mock('../electron/sync/v2OutboxStore.js', () => ({
  readDesktopV2Status: vi.fn(() => ({ pending: 0, conflicts: 0, rejected: 0 })),
}));

vi.mock('../electron/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runAutomaticDeviceSync, runDeviceSync } from '../electron/sync/deviceSyncService';

const successfulSync = {
  pushed: 0,
  pulled: 1,
  imported: 1,
  duplicates: 0,
  conflicts: 0,
  rejected: 0,
  cursor: 'c1',
  unresolvedConflicts: 0,
};

describe('device-sync remote write-back integration', () => {
  beforeEach(() => {
    harness.token = `fl2_account1_desktop1_${'x'.repeat(32)}`;
    harness.settings.deviceSync.enabled = true;
    harness.settings.deviceSync.autoSync = true;
    harness.events = [];
    harness.runDesktopSyncV2.mockReset();
    harness.runRemoteWritebacks.mockReset();
    harness.getNextRemoteWritebackRetryAt.mockReset();
    harness.runRemoteWritebacks.mockImplementation(async () => {
      harness.events.push('writeback');
      return { processed: 0, completed: 0, deferred: 0 };
    });
    harness.getNextRemoteWritebackRetryAt.mockReturnValue(null);
    harness.runDesktopSyncV2.mockImplementation(async () => {
      harness.events.push('sync');
      return successfulSync;
    });
  });

  it('drains durable provider work both before and after a canonical Sync v2 exchange', async () => {
    await expect(runDeviceSync()).resolves.toEqual(successfulSync);

    expect(harness.events).toEqual(['writeback', 'sync', 'writeback']);
    expect(harness.runRemoteWritebacks).toHaveBeenCalledTimes(2);
    expect(harness.runRemoteWritebacks.mock.calls[0]?.[0]).toEqual(
      harness.runRemoteWritebacks.mock.calls[1]?.[0],
    );
  });

  it('still drains already-committed provider work when the cloud exchange returns 503', async () => {
    harness.runDesktopSyncV2.mockImplementation(async () => {
      harness.events.push('sync');
      throw new Error('HTTP 503 service unavailable');
    });

    await expect(runDeviceSync()).rejects.toThrow('HTTP 503 service unavailable');

    expect(harness.events).toEqual(['writeback', 'sync']);
    expect(harness.runRemoteWritebacks).toHaveBeenCalledTimes(1);
  });

  it('does not make a successful cloud exchange wait for a slow provider queue', async () => {
    let releaseProvider!: () => void;
    const providerDelivery = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    harness.runRemoteWritebacks.mockImplementation(async () => {
      harness.events.push('writeback');
      await providerDelivery;
      return { processed: 1, completed: 1, deferred: 0 };
    });

    await expect(runDeviceSync()).resolves.toEqual(successfulSync);
    expect(harness.events).toEqual(['writeback', 'sync', 'writeback']);

    releaseProvider();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('recovers only the matching durable scope when automatic cloud sync is disabled', async () => {
    harness.settings.deviceSync.enabled = false;

    await expect(runAutomaticDeviceSync()).resolves.toBeNull();

    expect(harness.runDesktopSyncV2).not.toHaveBeenCalled();
    expect(harness.runRemoteWritebacks).toHaveBeenCalledTimes(1);
    expect(typeof harness.runRemoteWritebacks.mock.calls[0]?.[0]).toBe('string');
  });
});
