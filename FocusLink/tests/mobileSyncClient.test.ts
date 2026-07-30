import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exchangeDeviceSyncPairingCode,
  fetchLiveFocusSnapshot,
  fetchTaskSnapshot,
  pullDeviceSyncPage,
  pushPendingDeviceSyncBundle,
} from '../src/mobile/syncClient';
import {
  cloudOnlyMobileSyncEndpoint,
  configuredNativeEndpoint,
  loadConnectionPreferences,
} from '../src/mobile/preferences';

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
          accessToken: 'received-long-lived-token',
          deviceId: 'device-assigned-by-authority',
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
      accessToken: 'received-long-lived-token',
      deviceId: 'device-assigned-by-authority',
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
      endpoint: 'https://sync.example.test',
      token: 'test-token',
    });
    const assertion = expect(request).rejects.toThrow('实时同步请求超时，正在重连');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
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
      endpoint: 'https://sync.example.test',
      token: 'test-token',
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
      fetchTaskSnapshot({ endpoint: 'https://sync.example.test', token: 'test-token' }),
    ).resolves.toMatchObject({ revision: 37 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example.test/sync/v2/tasks',
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
        token: 'test-token',
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
});
