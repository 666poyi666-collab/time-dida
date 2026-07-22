import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  directory: '',
  enabled: true,
  endpoint: 'http://127.0.0.1:18787',
  token: 'embedded-local-token-1234567890',
}));

vi.mock('electron', () => ({
  app: { getPath: () => harness.directory },
}));

vi.mock('../electron/settingsStore', () => ({
  getSettings: () => ({
    deviceSync: {
      enabled: harness.enabled,
      endpoint: harness.endpoint,
    },
  }),
}));

vi.mock('../electron/sync/deviceSyncCredentials', () => ({
  getDeviceSyncToken: () => harness.token,
}));

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('embedded loopback device sync service', () => {
  beforeEach(() => {
    process.env.FOCUSLINK_EMBEDDED_DEVICE_SYNC_PORT = '18789';
    harness.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-embedded-sync-'));
    harness.enabled = true;
    harness.endpoint = 'http://127.0.0.1:18789';
    harness.token = 'embedded-local-token-1234567890';
  });

  afterEach(async () => {
    const service = await import('../electron/sync/embeddedDeviceSyncServer');
    await service.closeEmbeddedDeviceSyncServer();
    fs.rmSync(harness.directory, { recursive: true, force: true });
    delete process.env.FOCUSLINK_EMBEDDED_DEVICE_SYNC_PORT;
    vi.resetModules();
  });

  it('starts for the default endpoint and closes when the feature is disabled', async () => {
    const service = await import('../electron/sync/embeddedDeviceSyncServer');
    await service.reconcileEmbeddedDeviceSyncServer();

    const health = await fetch(`${service.EMBEDDED_DEVICE_SYNC_ENDPOINT}/health`);
    await expect(health.json()).resolves.toMatchObject({ ok: true });

    harness.enabled = false;
    await service.reconcileEmbeddedDeviceSyncServer();
    await expect(fetch(`${service.EMBEDDED_DEVICE_SYNC_ENDPOINT}/health`)).rejects.toThrow();
  });
});
