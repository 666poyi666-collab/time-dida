import { Capacitor } from '@capacitor/core';

const ENDPOINT_KEY = 'focuslink.mobile.endpoint';
const TOKEN_SESSION_KEY = 'focuslink.mobile.token.session';
const TOKEN_LOCAL_KEY = 'focuslink.mobile.token.local';
const REMEMBER_TOKEN_KEY = 'focuslink.mobile.remember-token';
const DEVICE_ID_KEY = 'focuslink.mobile.device-id';
const LOOPBACK_MIGRATION_KEY = 'focuslink.mobile.migration.loopback-18787';
const CURRENT_LOOPBACK_ENDPOINT = 'http://127.0.0.1:18787';
const LEGACY_LOOPBACK_PORT = '8787';

export interface MobileConnectionPreferences {
  endpoint: string;
  token: string;
  rememberToken: boolean;
}

export function loadConnectionPreferences(): MobileConnectionPreferences {
  const rememberToken = localStorage.getItem(REMEMBER_TOKEN_KEY) === 'true';
  const storedEndpoint = localStorage.getItem(ENDPOINT_KEY);
  const migrationPending = localStorage.getItem(LOOPBACK_MIGRATION_KEY) !== 'true';
  const endpointBeforeMigration =
    storedEndpoint ?? (Capacitor.isNativePlatform() ? CURRENT_LOOPBACK_ENDPOINT : '');
  const endpoint = migrationPending
    ? migrateLegacyMobileSyncEndpoint(endpointBeforeMigration)
    : endpointBeforeMigration;
  if (migrationPending) {
    // Desktop moved its embedded service from 8787 to 18787 in v0.12.21. Android
    // localStorage survives an overwrite install, so migrate the matching old mobile
    // default too; otherwise the UI retries 8787 forever while adb reverse targets 18787.
    try {
      if (storedEndpoint !== null && endpoint !== storedEndpoint) {
        localStorage.setItem(ENDPOINT_KEY, endpoint);
      }
      localStorage.setItem(LOOPBACK_MIGRATION_KEY, 'true');
    } catch {
      // Storage can be readable but temporarily unwritable. Keep the in-memory migrated
      // endpoint for this launch and retry persistence on the next startup.
    }
  }
  return {
    endpoint,
    token: rememberToken
      ? (localStorage.getItem(TOKEN_LOCAL_KEY) ?? '')
      : (sessionStorage.getItem(TOKEN_SESSION_KEY) ?? ''),
    rememberToken,
  };
}

/** Only migrate the retired loopback default; HTTPS and user-owned endpoints stay untouched. */
export function migrateLegacyMobileSyncEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const isLegacyLoopback =
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.port === LEGACY_LOOPBACK_PORT &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password;
    if (!isLegacyLoopback) return endpoint;
    url.port = '18787';
    return url.toString().replace(/\/$/, '');
  } catch {
    return endpoint;
  }
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
