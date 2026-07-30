import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  meta: new Map<string, string>(),
  token: null as string | null,
  settingsPatches: [] as unknown[],
  openedUrls: [] as string[],
}));

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(async (url: string) => {
      harness.openedUrls.push(url);
    }),
  },
}));

vi.mock('../electron/db/index.js', () => ({
  getMeta: (key: string) => harness.meta.get(key) ?? null,
  setMeta: (key: string, value: string) => harness.meta.set(key, value),
}));

vi.mock('../electron/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../electron/settingsStore.js', () => ({
  updateSettings: (patch: unknown) => harness.settingsPatches.push(patch),
}));

vi.mock('../electron/sync/deviceSyncCredentials.js', () => ({
  getDeviceSyncToken: () => harness.token,
  setDeviceSyncToken: (token: string | null) => {
    harness.token = token;
  },
}));

vi.mock('../electron/sync/deviceSyncService.js', () => ({
  getDeviceSyncStatus: () => ({
    signedIn: Boolean(harness.token),
    accountId: harness.token ? 'account1' : null,
    accountLabel: harness.token ? 'Poyi' : null,
  }),
  runDeviceSync: vi.fn(async () => ({
    pushed: 0,
    pulled: 0,
    imported: 0,
    duplicates: 0,
    conflicts: 0,
    rejected: 0,
    cursor: '1',
    unresolvedConflicts: 0,
  })),
}));

import {
  loginDeviceSyncAccount,
  logoutDeviceSyncAccount,
  OFFICIAL_FOCUSLINK_ENDPOINT,
} from '../electron/sync/deviceSyncAccountService';

describe('desktop owner account enrollment', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    harness.meta.clear();
    harness.token = null;
    harness.settingsPatches = [];
    harness.openedUrls = [];
  });

  it('opens owner login once, then stores the issued device credential and enables sync', async () => {
    const token = `fl2_account1_desktop1_${'x'.repeat(32)}`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          status: 'login-required',
          loginUrl: 'https://identity.example/owner/sign-in?request=abc',
          retryAfterMs: 1,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          protocolVersion: 1,
          accountPublicId: 'account1',
          deviceId: 'device-desktop1',
          accessToken: token,
          tokenType: 'Bearer',
          scopes: ['sync:read', 'sync:write', 'live:read', 'live:write'],
          expiresAt: Date.now() + 60_000,
          serverTime: Date.now(),
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(loginDeviceSyncAccount()).resolves.toMatchObject({
      status: { signedIn: true, accountLabel: 'Poyi' },
      syncError: null,
    });

    expect(harness.openedUrls).toEqual(['https://identity.example/owner/sign-in?request=abc']);
    expect(harness.token).toBe(token);
    expect(harness.settingsPatches.at(-1)).toEqual({
      deviceSync: {
        enabled: true,
        endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
        autoSync: true,
        liveControlEnabled: true,
      },
    });
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({
      protocolVersion: 1,
      platform: 'windows',
      deviceKind: 'desktop',
    });
    expect(String(sent.installationId)).toMatch(/^windows-[A-Za-z0-9_-]{32}$/);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(fetchMock.mock.calls[0]?.[1]?.body);
  });

  it('does not reopen login when this installation already has a valid fl2 credential', async () => {
    harness.token = `fl2_account1_desktop1_${'y'.repeat(32)}`;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(loginDeviceSyncAccount()).resolves.toMatchObject({
      status: { signedIn: true },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.openedUrls).toEqual([]);
  });

  it('clears only the device credential on logout and leaves local data untouched', () => {
    harness.token = `fl2_account1_desktop1_${'z'.repeat(32)}`;

    logoutDeviceSyncAccount();

    expect(harness.token).toBeNull();
    expect(harness.settingsPatches.at(-1)).toEqual({
      deviceSync: {
        enabled: false,
        endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
        autoSync: true,
        liveControlEnabled: false,
      },
    });
  });
});
