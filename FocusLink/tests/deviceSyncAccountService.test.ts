import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  meta: new Map<string, string>(),
  token: null as string | null,
  settingsPatches: [] as unknown[],
  openedUrls: [] as string[],
  logs: [] as unknown[][],
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
  logger: {
    info: (...args: unknown[]) => harness.logs.push(args),
    warn: (...args: unknown[]) => harness.logs.push(args),
    error: (...args: unknown[]) => harness.logs.push(args),
    debug: (...args: unknown[]) => harness.logs.push(args),
  },
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
    harness.logs = [];
    vi.useRealTimers();
  });

  it('opens owner login once, then stores the issued device credential and enables sync', async () => {
    vi.useFakeTimers();
    const token = `fl2_account1_desktop1_${'x'.repeat(32)}`;
    const flowId = `flow_${'f'.repeat(40)}`;
    const pollToken = `flb_${'p'.repeat(48)}`;
    const now = Date.now();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          protocolVersion: 1,
          status: 'login-required',
          flowId,
          pollToken,
          loginUrl:
            'https://poyi-oauth-as.focuslink-poyi-6465e9.workers.dev/owner/focuslink-device?flow=public',
          retryAfterMs: 750,
          expiresAt: now + 300_000,
          serverTime: now,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          protocolVersion: 1,
          status: 'authenticated',
          endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
          accountLabel: 'Poyi',
          device: {
            protocolVersion: 1,
            accountPublicId: 'account1',
            deviceId: 'device-desktop1',
            accessToken: token,
            tokenType: 'Bearer',
            scopes: ['sync:read', 'sync:write', 'live:read', 'live:write'],
            expiresAt: now + 60_000,
            serverTime: now,
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const login = loginDeviceSyncAccount();
    await vi.advanceTimersByTimeAsync(750);
    await expect(login).resolves.toMatchObject({
      status: { signedIn: true, accountLabel: 'Poyi' },
      syncError: null,
    });

    expect(harness.openedUrls).toEqual([
      'https://poyi-oauth-as.focuslink-poyi-6465e9.workers.dev/owner/focuslink-device?flow=public',
    ]);
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
      action: 'start',
      registration: { platform: 'windows', deviceKind: 'desktop' },
    });
    expect(String((sent.registration as Record<string, unknown>).installationId)).toMatch(
      /^windows-[A-Za-z0-9_-]{32}$/,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      protocolVersion: 1,
      action: 'poll',
      flowId,
      pollToken,
    });
    expect(JSON.stringify(harness.logs)).not.toContain(token);
    expect(JSON.stringify(harness.logs)).not.toContain(pollToken);
  });

  it('rejects a credential issued before the owner login flow completes', async () => {
    const now = Date.now();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          protocolVersion: 1,
          status: 'authenticated',
          endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
          accountLabel: 'Poyi',
          device: {
            protocolVersion: 1,
            accountPublicId: 'account1',
            deviceId: 'device-desktop1',
            accessToken: `fl2_account1_desktop1_${'x'.repeat(32)}`,
            tokenType: 'Bearer',
            scopes: ['sync:read', 'sync:write', 'live:read', 'live:write'],
            expiresAt: now + 60_000,
            serverTime: now,
          },
        }),
      ),
    );

    await expect(loginDeviceSyncAccount()).rejects.toThrow('未完成管理员授权');
    expect(harness.token).toBeNull();
    expect(harness.openedUrls).toEqual([]);
  });

  it('reports an undeployed canonical gateway without exposing the response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { message: `secret flb_${'p'.repeat(48)}` } }, { status: 404 }),
        ),
    );

    await expect(loginDeviceSyncAccount()).rejects.toThrow('账号登录网关尚未部署');
    expect(JSON.stringify(harness.logs)).not.toContain('flb_');
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
