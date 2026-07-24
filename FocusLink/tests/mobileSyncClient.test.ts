import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exchangeDeviceSyncPairingCode,
  fetchLiveFocusSnapshot,
  isInvalidDeviceSyncCursorError,
  pullDeviceSyncPage,
} from '../src/mobile/syncClient';
import {
  loadConnectionPreferences,
  migrateLegacyMobileSyncEndpoint,
} from '../src/mobile/preferences';

describe('mobile sync client request recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('exchanges a one-time pairing code and sends no existing bearer credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: 1,
          accessToken: 'received-long-lived-token',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      exchangeDeviceSyncPairingCode({
        endpoint: 'http://127.0.0.1:18787',
        code: 'A1B2C3D4',
        deviceId: 'android-test-device',
      }),
    ).resolves.toBe('received-long-lived-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18787/v1/pair',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: 'A1B2C3D4', deviceId: 'android-test-device' }),
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
        code: 'A1B2C3D4',
        deviceId: 'android-test-device',
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

  it('preserves the invalid_cursor error code for one-shot account cache recovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'invalid_cursor', message: 'cursor is invalid for this account' },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const request = pullDeviceSyncPage({
      endpoint: 'https://sync.example.test',
      token: 'test-token',
      deviceId: 'tablet',
      cursor: 'old-account-cursor',
    });
    await expect(request).rejects.toSatisfy(isInvalidDeviceSyncCursorError);
  });

  it('explains that Android loopback needs adb reverse when the embedded service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    vi.stubGlobal('navigator', { onLine: true });

    await expect(
      fetchLiveFocusSnapshot({
        endpoint: 'http://127.0.0.1:18787',
        token: 'test-token',
      }),
    ).rejects.toThrow('ADB reverse tcp:18787 tcp:18787');
  });

  it.each([
    ['http://127.0.0.1:8787', 'http://127.0.0.1:18787'],
    ['http://127.0.0.1:8787/', 'http://127.0.0.1:18787'],
    ['http://localhost:8787', 'http://localhost:8787'],
  ])('migrates the retired Android loopback endpoint from %s to %s', (legacy, current) => {
    expect(migrateLegacyMobileSyncEndpoint(legacy)).toBe(current);
  });

  it.each([
    'https://sync.example.test',
    'http://127.0.0.1:18787',
    'http://127.0.0.1:8787/custom',
    'http://192.168.1.2:8787',
    'not a URL',
  ])('preserves the user-owned endpoint %s', (endpoint) => {
    expect(migrateLegacyMobileSyncEndpoint(endpoint)).toBe(endpoint);
  });

  it('persists the migrated endpoint while preserving the saved token preference', () => {
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
      endpoint: 'http://127.0.0.1:18787',
      token: 'saved-token',
      rememberToken: true,
    });
    expect(setItem).toHaveBeenCalledWith('focuslink.mobile.endpoint', 'http://127.0.0.1:18787');
    expect(setItem).toHaveBeenCalledWith('focuslink.mobile.migration.loopback-18787', 'true');
  });

  it('does not rewrite a loopback endpoint explicitly saved after the one-time migration', () => {
    const values = new Map([
      ['focuslink.mobile.endpoint', 'http://127.0.0.1:8787'],
      ['focuslink.mobile.migration.loopback-18787', 'true'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn(),
    });
    vi.stubGlobal('sessionStorage', { getItem: () => null });

    expect(loadConnectionPreferences().endpoint).toBe('http://127.0.0.1:8787');
  });

  it('uses the migrated endpoint for the current launch when storage is temporarily unwritable', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'focuslink.mobile.endpoint' ? 'http://127.0.0.1:8787' : null,
      setItem: () => {
        throw new DOMException('read only', 'QuotaExceededError');
      },
    });
    vi.stubGlobal('sessionStorage', { getItem: () => null });

    expect(loadConnectionPreferences().endpoint).toBe('http://127.0.0.1:18787');
  });
});
