import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  meta: new Map<string, string>(),
  token: null as string | null,
  settingsPatches: [] as unknown[],
  openedUrls: [] as string[],
  logs: [] as unknown[][],
  invalidations: 0,
  syncBlocked: false,
  syncRelease: null as (() => void) | null,
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
  invalidateDeviceSyncConnection: () => {
    harness.invalidations += 1;
  },
  getDeviceSyncStatus: () => ({
    signedIn: Boolean(harness.token),
    accountId: harness.token ? 'account1' : null,
    accountLabel: harness.token ? 'Poyi' : null,
  }),
  runDeviceSync: vi.fn(async () => {
    if (harness.syncBlocked) {
      await new Promise<void>((resolve) => {
        harness.syncRelease = resolve;
      });
    }
    return {
      pushed: 0,
      pulled: 0,
      imported: 0,
      duplicates: 0,
      conflicts: 0,
      rejected: 0,
      cursor: '1',
      unresolvedConflicts: 0,
    };
  }),
}));

import {
  createDeviceSyncPairingCode,
  loginDeviceSyncAccount,
  logoutDeviceSyncAccount,
  OFFICIAL_FOCUSLINK_ENDPOINT,
  redeemDeviceSyncPairingCode,
} from '../electron/sync/deviceSyncAccountService';
import { FOCUSLINK_SYNC_FAILOVER_ORIGIN } from '../shared/sync/identityProtocol';

describe('desktop owner account enrollment', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    harness.meta.clear();
    harness.token = null;
    harness.settingsPatches = [];
    harness.openedUrls = [];
    harness.logs = [];
    harness.invalidations = 0;
    harness.syncBlocked = false;
    harness.syncRelease = null;
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
    expect(harness.invalidations).toBe(1);
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
    expect(harness.invalidations).toBe(0);
    expect(harness.openedUrls).toEqual([]);
  });

  it('rejects a changed poll credential after the owner flow starts', async () => {
    vi.useFakeTimers();
    const flowId = `flow_${'f'.repeat(40)}`;
    const pollToken = `flb_${'p'.repeat(48)}`;
    const now = Date.now();
    vi.stubGlobal(
      'fetch',
      vi
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
            status: 'login-required',
            flowId,
            pollToken: `flb_${'q'.repeat(48)}`,
            loginUrl:
              'https://poyi-oauth-as.focuslink-poyi-6465e9.workers.dev/owner/focuslink-device?flow=public',
            retryAfterMs: 750,
            expiresAt: now + 300_000,
            serverTime: now,
          }),
        ),
    );

    const login = loginDeviceSyncAccount();
    const loginError = login.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(750);
    const error = await loginError;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('轮询中更换了授权流程');
    expect(harness.token).toBeNull();
    expect(harness.openedUrls).toHaveLength(1);
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

  it('redacts bootstrap credentials from non-404 server errors', async () => {
    const pollToken = `flb_${'p'.repeat(48)}`;
    const deviceToken = `fl2_account1_desktop1_${'x'.repeat(32)}`;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: `rejected ${pollToken} and ${deviceToken}` } },
            { status: 400 },
          ),
        ),
    );

    let thrown = '';
    try {
      await loginDeviceSyncAccount();
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    expect(thrown).toContain('[poll-credential-redacted]');
    expect(thrown).toContain('[device-credential-redacted]');
    expect(thrown).not.toContain('flb_');
    expect(thrown).not.toContain('fl2_');
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

  it('does not treat a truncated legacy fl2 prefix as an installed credential', async () => {
    harness.token = 'fl2_account1_desktop1_';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'not deployed' }, { status: 404 })),
    );

    await expect(loginDeviceSyncAccount()).rejects.toThrow('账号登录网关尚未部署');
  });

  it('creates an 8-digit offer from an enrolled device without logging the code', async () => {
    harness.token = `fl2_account1_desktop1_${'z'.repeat(32)}`;
    const expiresAt = Date.now() + 10 * 60_000;
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: '24681357', expiresAt }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createDeviceSyncPairingCode()).resolves.toEqual({ code: '24681357', expiresAt });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${FOCUSLINK_SYNC_FAILOVER_ORIGIN}/sync/v1/pair/offers`,
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: `Bearer ${harness.token}`,
    });
    expect(JSON.stringify(harness.logs)).not.toContain('24681357');
  });

  it('redeems a numeric code, stores the device-bound credential, and starts initial sync', async () => {
    const token = `fl2_account1_desktop2_${'q'.repeat(32)}`;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ accessToken: token, deviceId: 'device-desktop2' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(redeemDeviceSyncPairingCode(' 1234 5678 ')).resolves.toMatchObject({
      status: { signedIn: true },
      syncError: null,
    });

    expect(harness.token).toBe(token);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      code: string;
      device: Record<string, unknown>;
    };
    expect(body.code).toBe('12345678');
    expect(body.device).toMatchObject({
      platform: 'windows',
      deviceKind: 'desktop',
      appVersion: expect.any(String),
      displayName: expect.stringContaining('FocusLink'),
    });
    expect(body.device.installationId).toMatch(/^windows-[A-Za-z0-9_-]{32}$/);
    expect(JSON.stringify(harness.logs)).not.toContain('12345678');
  });

  it('clears only the device credential on logout and leaves local data untouched', () => {
    harness.token = `fl2_account1_desktop1_${'z'.repeat(32)}`;

    logoutDeviceSyncAccount();

    expect(harness.token).toBeNull();
    expect(harness.invalidations).toBe(1);
    expect(harness.settingsPatches.at(-1)).toEqual({
      deviceSync: {
        enabled: false,
        endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
        autoSync: true,
        liveControlEnabled: false,
      },
    });
  });

  it('does not resolve a stale login after logout wins during the initial sync', async () => {
    harness.token = `fl2_account1_desktop1_${'z'.repeat(32)}`;
    harness.syncBlocked = true;

    const login = loginDeviceSyncAccount();
    await vi.waitFor(() => expect(harness.syncRelease).not.toBeNull());
    logoutDeviceSyncAccount();
    harness.syncRelease?.();

    await expect(login).rejects.toThrow('登录已取消');
    expect(harness.token).toBeNull();
    expect(harness.settingsPatches.at(-1)).toMatchObject({
      deviceSync: { enabled: false, liveControlEnabled: false },
    });
  });

  it('aborts a pending poll and ignores an authenticated response that arrives after logout', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const flowId = `flow_${'f'.repeat(40)}`;
    const pollToken = `flb_${'p'.repeat(48)}`;
    const deviceToken = `fl2_account1_desktop1_${'x'.repeat(32)}`;
    let pollSignal: AbortSignal | undefined;
    let resolvePoll!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          protocolVersion: 1,
          status: 'login-required',
          flowId,
          pollToken,
          loginUrl:
            'https://poyi-oauth-as.focuslink-poyi-6465e9.workers.dev/owner/focuslink-device',
          retryAfterMs: 750,
          expiresAt: now + 60_000,
          serverTime: now,
        }),
      )
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        pollSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          resolvePoll = resolve;
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    const login = loginDeviceSyncAccount();
    await vi.advanceTimersByTimeAsync(750);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    logoutDeviceSyncAccount();
    expect(pollSignal?.aborted).toBe(true);
    resolvePoll(
      Response.json({
        protocolVersion: 1,
        status: 'authenticated',
        endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
        accountLabel: 'Poyi',
        device: {
          protocolVersion: 1,
          accountPublicId: 'account1',
          deviceId: 'device-desktop1',
          accessToken: deviceToken,
          tokenType: 'Bearer',
          scopes: ['sync:read', 'sync:write', 'live:read', 'live:write'],
          expiresAt: now + 60_000,
          serverTime: now,
        },
      }),
    );

    await expect(login).rejects.toThrow('登录已取消');
    expect(harness.token).toBeNull();
  });
});
