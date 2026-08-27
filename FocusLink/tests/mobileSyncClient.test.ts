import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  approveDeviceSyncPairingCode,
  claimDeviceSyncPairingRequest,
  classifyMobileLiveRequestError,
  createDeviceSyncPairingCode,
  createDeviceSyncPairingRequest,
  exchangeDeviceSyncPairingCode,
  fetchLiveFocusSnapshot,
  fetchTaskSnapshot,
  pullDeviceSyncPage,
  pushPendingDeviceSyncBundle,
  waitForLiveFocusSnapshot,
} from '../src/mobile/syncClient';
import {
  cloudOnlyMobileSyncEndpoint,
  configuredNativeEndpoint,
  loadConnectionPreferences,
} from '../src/mobile/preferences';
import {
  FOCUSLINK_CANONICAL_SYNC_ORIGIN,
  FOCUSLINK_SYNC_FAILOVER_ORIGIN,
} from '../shared/sync/identityProtocol';

const DEVICE_TOKEN = `fl2_account1_mobile1_${'x'.repeat(32)}`;

describe('mobile sync client request recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses only an explicitly injected HTTPS candidate endpoint', () => {
    expect(configuredNativeEndpoint(undefined)).toBe('');
    expect(configuredNativeEndpoint('http://127.0.0.1:8787')).toBe('');
    expect(configuredNativeEndpoint('https://candidate.example.test/')).toBe(
      'https://candidate.example.test',
    );
  });

  it('exchanges a one-time pairing code and sends no existing bearer credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          accessToken: DEVICE_TOKEN,
          deviceId: 'device-mobile1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      exchangeDeviceSyncPairingCode({
        endpoint: 'https://sync.example.test',
        code: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6',
        device: { platform: 'android', appVersion: 'test', displayName: 'Test device' },
      }),
    ).resolves.toEqual({
      accessToken: DEVICE_TOKEN,
      deviceId: 'device-mobile1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example.test/sync/v1/pair/exchange',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6',
          device: { platform: 'android', appVersion: 'test', displayName: 'Test device' },
        }),
      }),
    );
  });

  it('normalizes an 8-digit code and sends the full pending installation binding', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ accessToken: DEVICE_TOKEN, deviceId: 'device-mobile1' }));
    vi.stubGlobal('fetch', fetchMock);

    await exchangeDeviceSyncPairingCode({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      code: ' 12 34\n56 78 ',
      device: {
        platform: 'android',
        deviceKind: 'tablet',
        appVersion: '0.12.97',
        displayName: 'FocusLink 平板',
        installationId: 'android-0123456789abcdefghijklmnop',
      },
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(request.body))).toEqual({
      code: '12345678',
      device: {
        platform: 'android',
        deviceKind: 'tablet',
        appVersion: '0.12.97',
        displayName: 'FocusLink 平板',
        installationId: 'android-0123456789abcdefghijklmnop',
      },
    });
  });

  it('retries pairing on the official failover after canonical timeout', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network timeout'))
      .mockResolvedValueOnce(
        Response.json({ accessToken: DEVICE_TOKEN, deviceId: 'device-mobile1' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      exchangeDeviceSyncPairingCode({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        code: '12345678',
        device: {
          platform: 'android',
          deviceKind: 'tablet',
          appVersion: '0.12.103',
          displayName: 'FocusLink 平板',
          installationId: 'android-0123456789abcdefghijklmnop',
        },
      }),
    ).resolves.toMatchObject({ deviceId: 'device-mobile1' });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `${FOCUSLINK_SYNC_FAILOVER_ORIGIN}/sync/v1/pair/exchange`,
      `${FOCUSLINK_CANONICAL_SYNC_ORIGIN}/sync/v1/pair/exchange`,
    ]);
  });

  it('lets an enrolled device create one short-lived numeric offer without exposing its token in the body', async () => {
    const expiresAt = Date.now() + 10 * 60_000;
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: '87654321', expiresAt }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createDeviceSyncPairingCode({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        token: DEVICE_TOKEN,
      }),
    ).resolves.toEqual({ code: '87654321', expiresAt });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toEqual({
      authorization: `Bearer ${DEVICE_TOKEN}`,
      'content-type': 'application/json',
    });
    expect(request).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(String(request.body)).not.toContain(DEVICE_TOKEN);
    expect(JSON.parse(String(request.body)).scopes).toEqual([
      'sync:read',
      'sync:write',
      'live:read',
      'live:write',
      'devices:manage',
    ]);
  });

  it('creates a code on a credential-free device, waits for approval, then claims its token', async () => {
    const expiresAt = Date.now() + 10 * 60_000;
    const requestToken = `flpr_${'r'.repeat(43)}`;
    const device = {
      platform: 'android' as const,
      deviceKind: 'tablet' as const,
      appVersion: '0.12.104',
      displayName: 'FocusLink Android 平板',
      installationId: 'android-0123456789abcdefghijklmnop',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ code: '13572468', requestToken, expiresAt }))
      .mockResolvedValueOnce(
        Response.json({ status: 'pending', expiresAt, retryAfterMs: 1_500 }, { status: 202 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: 'authenticated',
          accessToken: DEVICE_TOKEN,
          deviceId: 'device-mobile1',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createDeviceSyncPairingRequest({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        device,
      }),
    ).resolves.toEqual({ code: '13572468', requestToken, expiresAt });
    await expect(
      claimDeviceSyncPairingRequest({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        requestToken,
        device,
      }),
    ).resolves.toEqual({ status: 'pending', expiresAt, retryAfterMs: 1_500 });
    await expect(
      claimDeviceSyncPairingRequest({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        requestToken,
        device,
      }),
    ).resolves.toEqual({
      status: 'authenticated',
      accessToken: DEVICE_TOKEN,
      deviceId: 'device-mobile1',
    });
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).headers).not.toHaveProperty('authorization');
    }
  });

  it('lets an enrolled mobile device approve another device code', async () => {
    const expiresAt = Date.now() + 10 * 60_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ status: 'approved', displayName: 'FocusLink Windows', expiresAt }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      approveDeviceSyncPairingCode({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        token: DEVICE_TOKEN,
        code: ' 2468 1357 ',
      }),
    ).resolves.toEqual({
      status: 'approved',
      displayName: 'FocusLink Windows',
      expiresAt,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        authorization: `Bearer ${DEVICE_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ code: '24681357' }),
    });
  });

  it('never sends an enrolled device credential to an untrusted pairing origin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createDeviceSyncPairingCode({
        endpoint: 'https://evil.example',
        token: DEVICE_TOKEN,
      }),
    ).rejects.toThrow(/FocusLink|HTTPS/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when a numeric exchange returns a token bound to another device id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          accessToken: DEVICE_TOKEN,
          deviceId: 'device-someone-else',
        }),
      ),
    );
    await expect(
      exchangeDeviceSyncPairingCode({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        code: '12345678',
        device: {
          platform: 'android',
          deviceKind: 'phone',
          appVersion: '0.12.97',
          displayName: 'FocusLink phone',
          installationId: 'android-0123456789abcdefghijklmnop',
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_pairing_response' });
  });

  it('rejects an expired pairing response without retaining a credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'pairing code expired or was already used' }), {
          status: 410,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await expect(
      exchangeDeviceSyncPairingCode({
        endpoint: 'https://sync.example.test',
        code: 'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6',
        device: { platform: 'android', appVersion: 'test' },
      }),
    ).rejects.toThrow('pairing code expired');
  });

  it('times out a dead connection instead of leaving the live loop hung forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      }),
    );

    const request = fetchLiveFocusSnapshot({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: DEVICE_TOKEN,
    });
    const assertion = expect(request).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
      message: '实时同步请求超时',
    });
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('allows the preferred failover origin to complete a valid bounded long poll', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (!String(input).startsWith(FOCUSLINK_SYNC_FAILOVER_ORIGIN)) {
        return Promise.reject(new Error('canonical should not be reached'));
      }
      return new Promise<Response>((resolve) => {
        globalThis.setTimeout(
          () =>
            resolve(
              Response.json({
                protocolVersion: 1,
                snapshot: { revision: 4, state: 'idle', session: null },
                serverTime: 9_000,
                changed: false,
              }),
            ),
          9_000,
        );
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = waitForLiveFocusSnapshot({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: DEVICE_TOKEN,
      afterRevision: 4,
      waitMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(9_000);

    await expect(request).resolves.toMatchObject({
      changed: false,
      snapshot: { revision: 4, state: 'idle' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${FOCUSLINK_SYNC_FAILOVER_ORIGIN}/sync/v2/live/wait?afterRevision=4&waitMs=10000`,
    );
  });

  it('stops retrying a rejected credential instead of presenting it as transport loss', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'invalid_token', message: 'upstream credential detail' } },
            { status: 401 },
          ),
        ),
    );

    await expect(
      fetchLiveFocusSnapshot({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        token: DEVICE_TOKEN,
      }),
    ).rejects.toMatchObject({
      code: 'authentication_failed',
      retryable: false,
      status: 401,
      message: '设备凭据已失效，请重新配对',
    });
  });

  it('keeps the first authoritative availability response retryable without crossing origins', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: 'unavailable', message: 'internal origin detail' } },
          { status: 503 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchLiveFocusSnapshot({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        token: DEVICE_TOKEN,
      }),
    ).rejects.toMatchObject({
      code: 'service_unavailable',
      retryable: true,
      status: 503,
      message: '实时同步服务暂时不可用',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not replace an authoritative revision mismatch with another origin outcome', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 'invalid_live_revision', message: 'revision is ahead' } },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ protocolVersion: 1, snapshot: { revision: 1 }, serverTime: 1 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchLiveFocusSnapshot({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        token: DEVICE_TOKEN,
      }),
    ).rejects.toMatchObject({
      code: 'revision_mismatch',
      retryable: true,
      status: 409,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a malformed authoritative live response forever', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ protocolVersion: 1 })));

    const request = fetchLiveFocusSnapshot({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: DEVICE_TOKEN,
    });
    await expect(request).rejects.toMatchObject({
      code: 'contract_error',
      retryable: false,
      message: '实时状态响应异常，请手动刷新后重试',
    });
    expect(classifyMobileLiveRequestError(new Error('arbitrary upstream text'))).toEqual({
      code: 'contract_error',
      message: '实时状态响应异常，请手动刷新后重试',
      retryable: false,
      status: null,
    });
  });

  it('preserves an explicit caller abort so stale account requests stay silent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      }),
    );
    const controller = new AbortController();
    const request = fetchLiveFocusSnapshot({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: DEVICE_TOKEN,
      signal: controller.signal,
    });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('always bypasses HTTP caches when converging the task snapshot revision', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        protocolVersion: 1,
        revision: 37,
        sourceDeviceId: 'device-desktop',
        snapshot: { publishedAt: 37_000, projects: [], tasks: [] },
        serverTime: 38_000,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchTaskSnapshot({ endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN, token: DEVICE_TOKEN }),
    ).resolves.toMatchObject({ revision: 37 });
    expect(fetchMock).toHaveBeenCalledWith(
      `${FOCUSLINK_SYNC_FAILOVER_ORIGIN}/sync/v2/tasks`,
      expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
    );
  });

  it('retires the legacy ledger route locally and never sends a fallback request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      pullDeviceSyncPage({
        endpoint: 'https://sync.example.test',
        token: 'test-token',
        deviceId: 'tablet',
        cursor: 'old-account-cursor',
      }),
    ).rejects.toMatchObject({ code: 'legacy_route_retired', status: 410 });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      pushPendingDeviceSyncBundle({
        endpoint: 'https://sync.example.test',
        token: 'test-token',
        deviceId: 'tablet',
        mutation: {
          opId: 'legacy-op',
          entity: 'focus_session_bundle',
          entityId: 'session-1',
          kind: 'delete',
          baseRevision: 0,
          payload: null,
        },
      }),
    ).rejects.toMatchObject({ code: 'legacy_route_retired', status: 410 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects loopback before any mobile request can leave the renderer', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchLiveFocusSnapshot({
        endpoint: 'http://127.0.0.1:18787',
        token: DEVICE_TOKEN,
      }),
    ).rejects.toThrow('HTTPS 云端同步服务');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects any bearer connection that is not a canonical fl2 account binding', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchTaskSnapshot({ endpoint: 'https://evil.example.test', token: DEVICE_TOKEN }),
    ).rejects.toThrow('HTTPS 云端同步服务');
    await expect(
      fetchTaskSnapshot({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        token: 'legacy-or-malformed-bearer',
      }),
    ).rejects.toThrow('HTTPS 云端同步服务');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['http://127.0.0.1:8787', ''],
    ['http://127.0.0.1:18787', ''],
    ['http://localhost:18787', ''],
    ['http://192.168.1.2:8787', ''],
    ['not a URL', ''],
    ['https://sync.example.test/', 'https://sync.example.test'],
  ])('normalizes the cloud-only mobile endpoint %s to %s', (input, expected) => {
    expect(cloudOnlyMobileSyncEndpoint(input)).toBe(expected);
  });

  it('retires a stored loopback endpoint while preserving the credential for explicit repair', () => {
    const values = new Map([
      ['focuslink.mobile.endpoint', 'http://127.0.0.1:8787'],
      ['focuslink.mobile.remember-token', 'true'],
      ['focuslink.mobile.token.local', 'saved-token'],
    ]);
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem,
    });
    vi.stubGlobal('sessionStorage', { getItem: () => null });

    expect(loadConnectionPreferences()).toEqual({
      endpoint: '',
      token: 'saved-token',
      rememberToken: true,
    });
    expect(setItem).toHaveBeenCalledWith('focuslink.mobile.endpoint', '');
  });

  it('keeps loopback retired for the current launch when storage is temporarily unwritable', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'focuslink.mobile.endpoint' ? 'http://127.0.0.1:8787' : null,
      setItem: () => {
        throw new DOMException('read only', 'QuotaExceededError');
      },
    });
    vi.stubGlobal('sessionStorage', { getItem: () => null });

    expect(loadConnectionPreferences().endpoint).toBe('');
  });

  it('retires an arbitrary legacy HTTPS bearer target without deleting the only token copy', () => {
    const values = new Map([
      ['focuslink.mobile.endpoint', 'https://legacy.example.test'],
      ['focuslink.mobile.remember-token', 'true'],
      ['focuslink.mobile.token.local', 'legacy-token'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal('sessionStorage', { getItem: () => null });

    expect(loadConnectionPreferences()).toEqual({
      endpoint: '',
      token: 'legacy-token',
      rememberToken: true,
    });
    expect(values.get('focuslink.mobile.endpoint')).toBe('');
    expect(values.get('focuslink.mobile.token.local')).toBe('legacy-token');
  });
});
