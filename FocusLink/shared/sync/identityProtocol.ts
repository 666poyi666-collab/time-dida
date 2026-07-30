export const FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION = 1 as const;

/** The single public FocusLink cloud origin used by production account clients. */
export const FOCUSLINK_CANONICAL_SYNC_ORIGIN =
  'https://foxlink-mcp.focuslink-poyi-6465e9.workers.dev' as const;

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
    value.protocolVersion === FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION &&
    typeof value.accountPublicId === 'string' &&
    /^[A-Za-z0-9-]{6,80}$/.test(value.accountPublicId) &&
    typeof value.deviceId === 'string' &&
    /^device-[A-Za-z0-9-]{6,194}$/.test(value.deviceId) &&
    typeof value.accessToken === 'string' &&
    /^fl2_[A-Za-z0-9-]{6,80}_[A-Za-z0-9-]{6,80}_[A-Za-z0-9_-]{32,160}$/.test(value.accessToken) &&
    value.tokenType === 'Bearer' &&
    Array.isArray(value.scopes) &&
    value.scopes.length > 0 &&
    value.scopes.every((scope) =>
      (FOCUSLINK_ENROLLED_DEVICE_SCOPES as readonly string[]).includes(scope),
    ) &&
    Number.isSafeInteger(value.expiresAt) &&
    Number.isSafeInteger(value.serverTime)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
