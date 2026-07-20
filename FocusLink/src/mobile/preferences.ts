const ENDPOINT_KEY = 'focuslink.mobile.endpoint';
const TOKEN_SESSION_KEY = 'focuslink.mobile.token.session';
const TOKEN_LOCAL_KEY = 'focuslink.mobile.token.local';
const REMEMBER_TOKEN_KEY = 'focuslink.mobile.remember-token';
const DEVICE_ID_KEY = 'focuslink.mobile.device-id';

export interface MobileConnectionPreferences {
  endpoint: string;
  token: string;
  rememberToken: boolean;
}

export function loadConnectionPreferences(): MobileConnectionPreferences {
  const rememberToken = localStorage.getItem(REMEMBER_TOKEN_KEY) === 'true';
  return {
    endpoint:
      localStorage.getItem(ENDPOINT_KEY) ??
      (Capacitor.isNativePlatform() ? 'http://127.0.0.1:8787' : ''),
    token: rememberToken
      ? (localStorage.getItem(TOKEN_LOCAL_KEY) ?? '')
      : (sessionStorage.getItem(TOKEN_SESSION_KEY) ?? ''),
    rememberToken,
  };
}

export function saveConnectionPreferences(value: MobileConnectionPreferences): void {
  localStorage.setItem(ENDPOINT_KEY, value.endpoint);
  localStorage.setItem(REMEMBER_TOKEN_KEY, String(value.rememberToken));

  if (value.rememberToken) {
    localStorage.setItem(TOKEN_LOCAL_KEY, value.token);
    sessionStorage.removeItem(TOKEN_SESSION_KEY);
  } else {
    sessionStorage.setItem(TOKEN_SESSION_KEY, value.token);
    localStorage.removeItem(TOKEN_LOCAL_KEY);
  }
}

export function clearSavedToken(): void {
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
  localStorage.removeItem(TOKEN_LOCAL_KEY);
  localStorage.setItem(REMEMBER_TOKEN_KEY, 'false');
}

export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY)?.trim();
  if (existing) return existing;
  const created = `web_${crypto.randomUUID()}`;
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}
import { Capacitor } from '@capacitor/core';
