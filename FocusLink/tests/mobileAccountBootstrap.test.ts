import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isOwnerAccountCallback,
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

  it('registers the installation against the fixed owner gateway and accepts a device credential', async () => {
    const accessToken = `fl2_account1_mobile1_${'x'.repeat(32)}`;
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        protocolVersion: 1,
        accountPublicId: 'account1',
        deviceId: 'device-mobile1',
        accessToken,
        tokenType: 'Bearer',
        scopes: ['sync:read', 'sync:write', 'live:read', 'live:write'],
        expiresAt: Date.now() + 60_000,
        serverTime: Date.now(),
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
      status: 'authenticated',
      session: { accountLabel: 'Poyi', accessToken, deviceId: 'device-mobile1' },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      protocolVersion: 1,
      installationId: 'android-0123456789abcdefghijklmnop',
      platform: 'web',
      deviceKind: 'phone',
    });
    expect(body).not.toHaveProperty('accessToken');
  });
});
