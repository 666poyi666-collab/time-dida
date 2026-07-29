import { Capacitor } from '@capacitor/core';

const ENDPOINT_KEY = 'focuslink.mobile.endpoint';
const TOKEN_SESSION_KEY = 'focuslink.mobile.token.session';
const TOKEN_LOCAL_KEY = 'focuslink.mobile.token.local';
const REMEMBER_TOKEN_KEY = 'focuslink.mobile.remember-token';
const DEVICE_ID_KEY = 'focuslink.mobile.device-id';

export function configuredNativeEndpoint(endpoint: string | undefined): string {
  return cloudOnlyMobileSyncEndpoint(endpoint ?? '');
}

export interface MobileConnectionPreferences {
  endpoint: string;
  token: string;
  rememberToken: boolean;
}

export function loadConnectionPreferences(): MobileConnectionPreferences {
  const rememberToken = localStorage.getItem(REMEMBER_TOKEN_KEY) === 'true';
  const storedEndpoint = localStorage.getItem(ENDPOINT_KEY);
  const endpointBeforeRetirement =
    storedEndpoint ??
    (Capacitor.isNativePlatform()
      ? configuredNativeEndpoint(import.meta.env.VITE_FOCUSLINK_ENDPOINT)
      : '');
  const endpoint = cloudOnlyMobileSyncEndpoint(endpointBeforeRetirement);
  if (storedEndpoint !== null && endpoint !== storedEndpoint) {
    // Old Android installs may retain a localhost/ADB or LAN HTTP endpoint. Do
    // not silently reconnect it: PC-off mobile mode is HTTPS authority-only.
    try {
      localStorage.setItem(ENDPOINT_KEY, endpoint);
    } catch {
      // Keep the fail-closed in-memory value and retry retirement next launch.
    }
  }
  return {
    endpoint,
    // Native v0.12.x builds may still have the only credential copy in Web
    // Storage. Keep that value available until the caller has durably migrated
    // it into Android Keystore. saveConnectionPreferences removes both browser
    // copies only after that native write succeeds.
    token: rememberToken
      ? (localStorage.getItem(TOKEN_LOCAL_KEY) ?? '')
      : (sessionStorage.getItem(TOKEN_SESSION_KEY) ?? ''),
    rememberToken,
  };
}

/** Mobile data-plane endpoints are cloud HTTPS only; loopback/LAN HTTP has no fallback role. */
export function cloudOnlyMobileSyncEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return '';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function saveConnectionPreferences(value: MobileConnectionPreferences): void {
  localStorage.setItem(ENDPOINT_KEY, value.endpoint);
  if (Capacitor.isNativePlatform()) {
    // Native callers must persist the credential through FocusRuntime before
    // invoking this function. This is the commit point that removes the legacy
    // plaintext copies after the Keystore write has been confirmed.
    localStorage.setItem(REMEMBER_TOKEN_KEY, 'true');
    sessionStorage.removeItem(TOKEN_SESSION_KEY);
    localStorage.removeItem(TOKEN_LOCAL_KEY);
    return;
  }
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

/** The authority, never the renderer, assigns a paired device identity. */
export function rememberAssignedDeviceId(deviceId: string): void {
  if (!/^device-[A-Za-z0-9._:-]{1,190}$/.test(deviceId)) {
    throw new Error('同步服务返回的设备标识无效');
  }
  localStorage.setItem(DEVICE_ID_KEY, deviceId);
}
