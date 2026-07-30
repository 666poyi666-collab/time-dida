import {
  FOCUSLINK_CANONICAL_SYNC_ORIGIN,
  type FocusLinkDeviceRegistrationRequest,
  type FocusLinkDeviceRegistrationResponse,
  parseFocusLinkDeviceRegistrationRequest,
  validateFocusLinkDeviceRegistrationResponse,
} from './identityProtocol';

export const FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION = 1 as const;
export const FOCUSLINK_ACCOUNT_BOOTSTRAP_PATH = '/account/v1/device/bootstrap' as const;
export const FOCUSLINK_CANONICAL_IDENTITY_ORIGIN =
  'https://poyi-oauth-as.focuslink-poyi-6465e9.workers.dev' as const;

export interface FocusLinkAccountBootstrapStartRequest {
  protocolVersion: typeof FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION;
  action: 'start';
  registration: FocusLinkDeviceRegistrationRequest;
}

export interface FocusLinkAccountBootstrapPollRequest {
  protocolVersion: typeof FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION;
  action: 'poll';
  flowId: string;
  pollToken: string;
}

export type FocusLinkAccountBootstrapRequest =
  FocusLinkAccountBootstrapStartRequest | FocusLinkAccountBootstrapPollRequest;

export interface FocusLinkAccountBootstrapLoginRequired {
  protocolVersion: typeof FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION;
  status: 'login-required';
  flowId: string;
  pollToken: string;
  loginUrl: string;
  retryAfterMs: number;
  expiresAt: number;
  serverTime: number;
}

export interface FocusLinkAccountBootstrapPending {
  protocolVersion: typeof FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION;
  status: 'pending';
  flowId: string;
  retryAfterMs: number;
  expiresAt: number;
  serverTime: number;
}

export interface FocusLinkAccountBootstrapAuthenticated {
  protocolVersion: typeof FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION;
  status: 'authenticated';
  endpoint: typeof FOCUSLINK_CANONICAL_SYNC_ORIGIN;
  accountLabel: string;
  device: FocusLinkDeviceRegistrationResponse;
}

export type FocusLinkAccountBootstrapResponse =
  | FocusLinkAccountBootstrapLoginRequired
  | FocusLinkAccountBootstrapPending
  | FocusLinkAccountBootstrapAuthenticated;

const FLOW_ID = /^flow_[A-Za-z0-9_-]{32,160}$/;
const POLL_TOKEN = /^flb_[A-Za-z0-9_-]{43,160}$/;

export function parseFocusLinkAccountBootstrapRequest(
  value: unknown,
): FocusLinkAccountBootstrapRequest | null {
  if (!isRecord(value)) return null;
  if (value.protocolVersion !== FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION) return null;
  if (value.action === 'start') {
    if (!hasExactKeys(value, ['protocolVersion', 'action', 'registration'])) return null;
    const registration = parseFocusLinkDeviceRegistrationRequest(value.registration);
    return registration
      ? {
          protocolVersion: FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
          action: 'start',
          registration,
        }
      : null;
  }
  if (value.action === 'poll') {
    if (!hasExactKeys(value, ['protocolVersion', 'action', 'flowId', 'pollToken'])) return null;
    if (
      typeof value.flowId !== 'string' ||
      !FLOW_ID.test(value.flowId) ||
      typeof value.pollToken !== 'string' ||
      !POLL_TOKEN.test(value.pollToken)
    ) {
      return null;
    }
    return {
      protocolVersion: FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
      action: 'poll',
      flowId: value.flowId,
      pollToken: value.pollToken,
    };
  }
  return null;
}

export function parseFocusLinkAccountBootstrapResponse(
  value: unknown,
): FocusLinkAccountBootstrapResponse | null {
  if (!isRecord(value)) return null;
  if (value.protocolVersion !== FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION) return null;
  if (value.status === 'authenticated') {
    if (!hasExactKeys(value, ['protocolVersion', 'status', 'endpoint', 'accountLabel', 'device'])) {
      return null;
    }
    const accountLabel = typeof value.accountLabel === 'string' ? value.accountLabel.trim() : '';
    if (
      value.endpoint !== FOCUSLINK_CANONICAL_SYNC_ORIGIN ||
      !accountLabel ||
      accountLabel.length > 100 ||
      !validateFocusLinkDeviceRegistrationResponse(value.device) ||
      !deviceCredentialMatchesIdentity(value.device) ||
      value.device.expiresAt <= value.device.serverTime
    ) {
      return null;
    }
    return {
      protocolVersion: FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
      status: 'authenticated',
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      accountLabel,
      device: value.device,
    };
  }
  if (value.status === 'login-required') {
    if (
      !hasExactKeys(value, [
        'protocolVersion',
        'status',
        'flowId',
        'pollToken',
        'loginUrl',
        'retryAfterMs',
        'expiresAt',
        'serverTime',
      ]) ||
      typeof value.flowId !== 'string' ||
      !FLOW_ID.test(value.flowId) ||
      typeof value.pollToken !== 'string' ||
      !POLL_TOKEN.test(value.pollToken) ||
      typeof value.loginUrl !== 'string' ||
      !validOwnerLoginUrl(value.loginUrl) ||
      !validTiming(value)
    ) {
      return null;
    }
    return value as unknown as FocusLinkAccountBootstrapLoginRequired;
  }
  if (value.status === 'pending') {
    if (
      !hasExactKeys(value, [
        'protocolVersion',
        'status',
        'flowId',
        'retryAfterMs',
        'expiresAt',
        'serverTime',
      ]) ||
      typeof value.flowId !== 'string' ||
      !FLOW_ID.test(value.flowId) ||
      !validTiming(value)
    ) {
      return null;
    }
    return value as unknown as FocusLinkAccountBootstrapPending;
  }
  return null;
}

export function redactFocusLinkAccountBootstrapResponse(value: unknown): Record<string, unknown> {
  const parsed = parseFocusLinkAccountBootstrapResponse(value);
  if (!parsed) return { valid: false };
  if (parsed.status === 'authenticated') {
    return {
      valid: true,
      status: parsed.status,
      endpoint: parsed.endpoint,
      accountPublicId: parsed.device.accountPublicId,
      deviceId: parsed.device.deviceId,
      expiresAt: parsed.device.expiresAt,
      credentialReturned: true,
    };
  }
  return {
    valid: true,
    status: parsed.status,
    flowId: parsed.flowId,
    retryAfterMs: parsed.retryAfterMs,
    expiresAt: parsed.expiresAt,
    ...(parsed.status === 'login-required'
      ? { loginOrigin: new URL(parsed.loginUrl).origin, pollCredentialReturned: true }
      : {}),
  };
}

function validOwnerLoginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === FOCUSLINK_CANONICAL_IDENTITY_ORIGIN &&
      url.username === '' &&
      url.password === '' &&
      url.hash === '' &&
      url.pathname.startsWith('/owner/')
    );
  } catch {
    return false;
  }
}

function validTiming(value: Record<string, unknown>): boolean {
  return (
    Number.isSafeInteger(value.retryAfterMs) &&
    Number(value.retryAfterMs) >= 750 &&
    Number(value.retryAfterMs) <= 10_000 &&
    Number.isSafeInteger(value.expiresAt) &&
    Number.isSafeInteger(value.serverTime) &&
    Number(value.expiresAt) > Number(value.serverTime) &&
    Number(value.expiresAt) - Number(value.serverTime) <= 10 * 60_000
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

function deviceCredentialMatchesIdentity(value: FocusLinkDeviceRegistrationResponse): boolean {
  const match = value.accessToken.match(
    /^fl2_([A-Za-z0-9-]{6,80})_([A-Za-z0-9-]{6,80})_[A-Za-z0-9_-]{32,160}$/,
  );
  return Boolean(
    match && match[1] === value.accountPublicId && value.deviceId === `device-${match[2]}`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
