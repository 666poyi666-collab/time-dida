export const FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION = 1 as const;

/** The single public FocusLink cloud origin used by production account clients. */
export const FOCUSLINK_CANONICAL_SYNC_ORIGIN =
  'https://foxlink-mcp.focuslink-poyi-6465e9.workers.dev' as const;

const FOCUSLINK_DEVICE_ACCESS_TOKEN_PATTERN =
  /^fl2_[A-Za-z0-9-]{6,80}_[A-Za-z0-9-]{6,80}_[A-Za-z0-9_-]{32,160}$/;

export function isFocusLinkDeviceAccessToken(value: string): boolean {
  return FOCUSLINK_DEVICE_ACCESS_TOKEN_PATTERN.test(value);
}

export function isCanonicalFocusLinkSyncEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.toString().replace(/\/$/, '') === FOCUSLINK_CANONICAL_SYNC_ORIGIN
    );
  } catch {
    return false;
  }
}

/** Production account connections always pair one valid fl2 credential with the canonical origin. */
export function isCanonicalFocusLinkDeviceConnection(
  endpoint: string,
  accessToken: string,
): boolean {
  return (
    isCanonicalFocusLinkSyncEndpoint(endpoint) && isFocusLinkDeviceAccessToken(accessToken.trim())
  );
}

export const FOCUSLINK_ENROLLED_DEVICE_SCOPES = [
  'sync:read',
  'sync:write',
  'live:read',
  'live:write',
] as const;

export type FocusLinkDevicePlatform = 'windows' | 'android' | 'web';
export type FocusLinkDeviceKind = 'desktop' | 'phone' | 'tablet' | 'watch';

export interface FocusLinkDeviceRegistrationRequest {
  protocolVersion: typeof FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION;
  /** Stable, high-entropy identifier generated once per local app installation. */
  installationId: string;
  displayName: string;
  platform: FocusLinkDevicePlatform;
  deviceKind: FocusLinkDeviceKind;
  appVersion?: string;
}

export interface FocusLinkDeviceRegistrationResponse {
  protocolVersion: typeof FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION;
  accountPublicId: string;
  deviceId: string;
  accessToken: string;
  tokenType: 'Bearer';
  scopes: string[];
  expiresAt: number;
  serverTime: number;
}

const PLATFORMS = new Set<FocusLinkDevicePlatform>(['windows', 'android', 'web']);
const DEVICE_KINDS = new Set<FocusLinkDeviceKind>(['desktop', 'phone', 'tablet', 'watch']);

export function parseFocusLinkDeviceRegistrationRequest(
  value: unknown,
): FocusLinkDeviceRegistrationRequest | null {
  if (!isRecord(value)) return null;
  if (
    value.protocolVersion !== FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION ||
    typeof value.installationId !== 'string' ||
    !/^[A-Za-z0-9._~-]{20,160}$/.test(value.installationId) ||
    typeof value.displayName !== 'string' ||
    typeof value.platform !== 'string' ||
    !PLATFORMS.has(value.platform as FocusLinkDevicePlatform) ||
    typeof value.deviceKind !== 'string' ||
    !DEVICE_KINDS.has(value.deviceKind as FocusLinkDeviceKind) ||
    (value.appVersion !== undefined &&
      (typeof value.appVersion !== 'string' || !/^[0-9A-Za-z.+-]{1,32}$/.test(value.appVersion)))
  ) {
    return null;
  }
  const displayName = value.displayName.trim();
  if (!displayName || displayName.length > 100) return null;
  const expectedKeys = new Set([
    'protocolVersion',
    'installationId',
    'displayName',
    'platform',
    'deviceKind',
    'appVersion',
  ]);
  if (Object.keys(value).some((key) => !expectedKeys.has(key))) return null;
  return {
    protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
    installationId: value.installationId,
    displayName,
    platform: value.platform as FocusLinkDevicePlatform,
    deviceKind: value.deviceKind as FocusLinkDeviceKind,
    ...(typeof value.appVersion === 'string' ? { appVersion: value.appVersion } : {}),
  };
}

export function validateFocusLinkDeviceRegistrationResponse(
  value: unknown,
): value is FocusLinkDeviceRegistrationResponse {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'protocolVersion',
      'accountPublicId',
      'deviceId',
      'accessToken',
      'tokenType',
      'scopes',
      'expiresAt',
      'serverTime',
    ]) &&
    value.protocolVersion === FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION &&
    typeof value.accountPublicId === 'string' &&
    /^[A-Za-z0-9-]{6,80}$/.test(value.accountPublicId) &&
    typeof value.deviceId === 'string' &&
    /^device-[A-Za-z0-9-]{6,194}$/.test(value.deviceId) &&
    typeof value.accessToken === 'string' &&
    isFocusLinkDeviceAccessToken(value.accessToken) &&
    value.tokenType === 'Bearer' &&
    hasExactEnrolledScopes(value.scopes) &&
    Number.isSafeInteger(value.expiresAt) &&
    Number.isSafeInteger(value.serverTime)
  );
}

function hasExactEnrolledScopes(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length === FOCUSLINK_ENROLLED_DEVICE_SCOPES.length &&
    new Set(value).size === FOCUSLINK_ENROLLED_DEVICE_SCOPES.length &&
    FOCUSLINK_ENROLLED_DEVICE_SCOPES.every((scope) => value.includes(scope))
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
