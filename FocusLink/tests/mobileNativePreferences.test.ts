import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUSLINK_CANONICAL_SYNC_ORIGIN } from '../shared/sync/identityProtocol';
import {
  loadConnectionPreferences,
  persistMobileAccountSessionBestEffort,
  saveConnectionPreferences,
} from '../src/mobile/preferences';

const capacitorHarness = vi.hoisted(() => ({ native: true }));
const DEVICE_TOKEN = `fl2_account1_mobile1_${'x'.repeat(32)}`;

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => capacitorHarness.native,
  },
}));

describe('native connection preference migration', () => {
  const localValues = new Map<string, string>();
  const sessionValues = new Map<string, string>();
  const localRemove = vi.fn((key: string) => localValues.delete(key));
  const sessionRemove = vi.fn((key: string) => sessionValues.delete(key));

  beforeEach(() => {
    capacitorHarness.native = true;
    localValues.clear();
    sessionValues.clear();
    localRemove.mockClear();
    sessionRemove.mockClear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => localValues.set(key, value),
      removeItem: localRemove,
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => sessionValues.get(key) ?? null,
      setItem: (key: string, value: string) => sessionValues.set(key, value),
      removeItem: sessionRemove,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the only legacy token copy until the Keystore migration is confirmed', () => {
    localValues.set('focuslink.mobile.endpoint', FOCUSLINK_CANONICAL_SYNC_ORIGIN);
    localValues.set('focuslink.mobile.remember-token', 'true');
    localValues.set('focuslink.mobile.token.local', DEVICE_TOKEN);

    expect(loadConnectionPreferences()).toMatchObject({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: DEVICE_TOKEN,
      rememberToken: true,
    });
    expect(localRemove).not.toHaveBeenCalledWith('focuslink.mobile.token.local');
  });

  it('purges browser token copies only at the post-Keystore commit point', () => {
    localValues.set('focuslink.mobile.token.local', 'legacy-local-token');
    sessionValues.set('focuslink.mobile.token.session', 'legacy-session-token');

    saveConnectionPreferences({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: DEVICE_TOKEN,
      rememberToken: true,
    });

    expect(localRemove).toHaveBeenCalledWith('focuslink.mobile.token.local');
    expect(sessionRemove).toHaveBeenCalledWith('focuslink.mobile.token.session');
    expect(localValues.has('focuslink.mobile.token.local')).toBe(false);
    expect(sessionValues.has('focuslink.mobile.token.session')).toBe(false);
  });

  it('keeps a legacy bearer for recovery but retires its arbitrary HTTPS target', () => {
    localValues.set('focuslink.mobile.endpoint', 'https://legacy.example.test');
    localValues.set('focuslink.mobile.remember-token', 'true');
    localValues.set('focuslink.mobile.token.local', 'legacy-token');

    expect(loadConnectionPreferences()).toEqual({
      endpoint: '',
      token: 'legacy-token',
      rememberToken: true,
    });
    expect(localValues.get('focuslink.mobile.endpoint')).toBe('');
    expect(localValues.get('focuslink.mobile.token.local')).toBe('legacy-token');
  });

  it('reports Web Storage failure after the Keystore commit without aborting in-memory login', () => {
    localValues.set('focuslink.mobile.token.local', 'old-browser-copy');
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === 'focuslink.mobile.endpoint') {
          throw new DOMException('read only', 'QuotaExceededError');
        }
        localValues.set(key, value);
      },
      removeItem: localRemove,
    });

    expect(
      persistMobileAccountSessionBestEffort(
        { endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN, token: DEVICE_TOKEN, rememberToken: true },
        'device-mobile1',
        { accountId: 'account1', accountLabel: 'Poyi' },
      ),
    ).toEqual(['connection']);
    expect(localValues.get('focuslink.mobile.token.local')).toBe('old-browser-copy');
    expect(localValues.get('focuslink.mobile.account-id')).toBe('account1');
    expect(localValues.get('focuslink.mobile.device-id')).toBe('device-mobile1');
  });
});
