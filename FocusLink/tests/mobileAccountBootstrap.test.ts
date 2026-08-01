import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  invalidateOwnerAccountBootstrap,
  isOwnerAccountCallback,
  OFFICIAL_FOCUSLINK_ENDPOINT,
  openOwnerLogin,
  ownerAccountBootstrapApi,
  setOwnerAccountBootstrapApi,
  type OwnerAccountBootstrapApi,
} from '../src/mobile/accountBootstrap';

afterEach(() => {
  setOwnerAccountBootstrapApi(null);
  vi.unstubAllGlobals();
});

describe('mobile owner account bootstrap', () => {
  it('accepts only the private app account callback', () => {
    expect(isOwnerAccountCallback('focuslink://auth?code=once')).toBe(true);
    expect(isOwnerAccountCallback('focuslink://pair?nonce=legacy')).toBe(false);
    expect(isOwnerAccountCallback('https://example.test/auth')).toBe(false);
    expect(isOwnerAccountCallback('not a url')).toBe(false);
  });

  it('allows native and test transports to inject account bootstrap without exposing credentials in UI', async () => {
    const bootstrap = vi.fn<OwnerAccountBootstrapApi['bootstrap']>().mockResolvedValue({
      status: 'authenticated',
      session: {
        accountId: 'owner-primary',
        accountLabel: 'Owner',
        endpoint: 'https://sync.example.test',
        accessToken: 'secret-device-credential',
        deviceId: 'device-mobile-1',
      },
    });
    setOwnerAccountBootstrapApi({ bootstrap });

    const result = await ownerAccountBootstrapApi().bootstrap({
      installationId: 'web-provisional-installation-1',
      deviceKind: 'phone',
      displayName: 'FocusLink Android',
    });

    expect(result.status).toBe('authenticated');
    expect(bootstrap).toHaveBeenCalledOnce();
  });

  it('uses the strict start/poll contract before accepting a canonical device credential', async () => {
    const accessToken = `fl2_account1_mobile1_${'x'.repeat(32)}`;
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
          retryAfterMs: 1_500,
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
            deviceId: 'device-mobile1',
            accessToken,
            tokenType: 'Bearer',
            scopes: ['sync:read', 'sync:write', 'live:read', 'live:write'],
            expiresAt: now + 60_000,
            serverTime: now,
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      ownerAccountBootstrapApi().bootstrap({
        installationId: 'android-0123456789abcdefghijklmnop',
        deviceKind: 'phone',
        displayName: 'FocusLink Android',
      }),
    ).resolves.toMatchObject({
      status: 'login-required',
    });
    await expect(
      ownerAccountBootstrapApi().bootstrap({
        installationId: 'android-0123456789abcdefghijklmnop',
        deviceKind: 'phone',
        displayName: 'FocusLink Android',
        callbackUrl: 'focuslink://auth?completed=1',
      }),
    ).resolves.toMatchObject({
      status: 'authenticated',
      session: {
        accountLabel: 'Poyi',
        endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
        accessToken,
        deviceId: 'device-mobile1',
      },
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      protocolVersion: 1,
      action: 'start',
      registration: {
        protocolVersion: 1,
        installationId: 'android-0123456789abcdefghijklmnop',
        displayName: 'FocusLink Android',
        platform: 'web',
        deviceKind: 'phone',
        appVersion: '0.12.74',
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      protocolVersion: 1,
      action: 'poll',
      flowId,
      pollToken,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit' });
  });

  it('rejects a credential returned before owner authorization and legacy session envelopes', async () => {
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
            deviceId: 'device-mobile1',
            accessToken: `fl2_account1_mobile1_${'x'.repeat(32)}`,
            tokenType: 'Bearer',
            scopes: ['sync:read', 'sync:write', 'live:read', 'live:write'],
            expiresAt: now + 60_000,
            serverTime: now,
          },
        }),
      ),
    );

    await expect(
      ownerAccountBootstrapApi().bootstrap({
        installationId: 'android-0123456789abcdefghijklmnop',
        deviceKind: 'phone',
        displayName: 'FocusLink Android',
      }),
    ).rejects.toThrow('未完成管理员授权');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          status: 'authenticated',
          session: {
            accountId: 'account1',
            endpoint: 'https://evil.example',
            accessToken: 'secret',
            deviceId: 'device-mobile1',
          },
        }),
      ),
    );
    await expect(
      ownerAccountBootstrapApi().bootstrap({
        installationId: 'android-0123456789abcdefghijklmnop',
        deviceKind: 'phone',
        displayName: 'FocusLink Android',
      }),
    ).rejects.toThrow('响应无效');
  });

  it('locks browser navigation to the canonical owner origin', async () => {
    await expect(openOwnerLogin('https://evil.example/owner/focuslink-device')).rejects.toThrow(
      '登录地址无效',
    );
    await expect(
      openOwnerLogin(
        'https://poyi-oauth-as.focuslink-poyi-6465e9.workers.dev.evil.example/owner/login',
      ),
    ).rejects.toThrow('登录地址无效');
  });

  it('redacts bootstrap credentials from server errors', async () => {
    const pollToken = `flb_${'p'.repeat(48)}`;
    const deviceToken = `fl2_account1_mobile1_${'x'.repeat(32)}`;
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
      await ownerAccountBootstrapApi().bootstrap({
        installationId: 'android-0123456789abcdefghijklmnop',
        deviceKind: 'phone',
        displayName: 'FocusLink Android',
      });
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }
    expect(thrown).toContain('[poll-credential-redacted]');
    expect(thrown).toContain('[device-credential-redacted]');
    expect(thrown).not.toContain('flb_');
    expect(thrown).not.toContain('fl2_');
  });

  it('aborts an invalidated bootstrap generation and cannot reuse its stale response', async () => {
    let resolveFirst!: (response: Response) => void;
    let firstSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        firstSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      })
      .mockResolvedValueOnce(Response.json({ error: 'not deployed' }, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const stale = ownerAccountBootstrapApi().bootstrap({
      installationId: 'android-0123456789abcdefghijklmnop',
      deviceKind: 'phone',
      displayName: 'FocusLink Android',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    invalidateOwnerAccountBootstrap();
    expect(firstSignal?.aborted).toBe(true);
    resolveFirst(
      Response.json({
        protocolVersion: 1,
        status: 'login-required',
        flowId: `flow_${'f'.repeat(40)}`,
        pollToken: `flb_${'p'.repeat(48)}`,
        loginUrl: 'https://poyi-oauth-as.focuslink-poyi-6465e9.workers.dev/owner/focuslink-device',
        retryAfterMs: 1_500,
        expiresAt: Date.now() + 60_000,
        serverTime: Date.now(),
      }),
    );
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });

    await expect(
      ownerAccountBootstrapApi().bootstrap({
        installationId: 'android-0123456789abcdefghijklmnop',
        deviceKind: 'phone',
        displayName: 'FocusLink Android',
      }),
    ).rejects.toThrow('账号登录网关尚未部署');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
