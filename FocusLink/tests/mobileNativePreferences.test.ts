import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConnectionPreferences, saveConnectionPreferences } from '../src/mobile/preferences';

const capacitorHarness = vi.hoisted(() => ({ native: true }));

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
    localValues.set('focuslink.mobile.endpoint', 'https://sync.example.test');
    localValues.set('focuslink.mobile.remember-token', 'true');
    localValues.set('focuslink.mobile.token.local', 'legacy-token');

    expect(loadConnectionPreferences()).toMatchObject({
      endpoint: 'https://sync.example.test',
      token: 'legacy-token',
      rememberToken: true,
    });
    expect(localRemove).not.toHaveBeenCalledWith('focuslink.mobile.token.local');
  });

  it('purges browser token copies only at the post-Keystore commit point', () => {
    localValues.set('focuslink.mobile.token.local', 'legacy-local-token');
    sessionValues.set('focuslink.mobile.token.session', 'legacy-session-token');

    saveConnectionPreferences({
      endpoint: 'https://sync.example.test',
      token: 'keystore-token',
      rememberToken: true,
    });

    expect(localRemove).toHaveBeenCalledWith('focuslink.mobile.token.local');
    expect(sessionRemove).toHaveBeenCalledWith('focuslink.mobile.token.session');
    expect(localValues.has('focuslink.mobile.token.local')).toBe(false);
    expect(sessionValues.has('focuslink.mobile.token.session')).toBe(false);
  });
});
