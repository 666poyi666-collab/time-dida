import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from '@shared/version';
import {
  FOCUSLINK_CANONICAL_SYNC_ORIGIN,
  FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
  validateFocusLinkDeviceRegistrationResponse,
  type FocusLinkDeviceKind,
  type FocusLinkDevicePlatform,
} from '@shared/sync/identityProtocol';
import { cloudOnlyMobileSyncEndpoint } from './preferences';
import { openNativeExternalUrl } from './nativeFocusRuntime';

export const OFFICIAL_FOCUSLINK_ENDPOINT = FOCUSLINK_CANONICAL_SYNC_ORIGIN;
export const OWNER_DEVICE_BOOTSTRAP_PATH = '/account/v1/device/bootstrap';

export type OwnerDeviceKind = 'phone' | 'tablet' | 'watch' | 'web';

export interface OwnerAccountSession {
  accountId: string;
  accountLabel: string;
  endpoint: string;
  accessToken: string;
  deviceId: string;
}

export type OwnerAccountBootstrapResult =
  | { status: 'authenticated'; session: OwnerAccountSession }
  | { status: 'login-required'; loginUrl: string }
  | { status: 'waiting-for-phone'; retryAfterMs: number };

export interface OwnerAccountBootstrapApi {
  bootstrap(input: {
    installationId: string;
    deviceKind: OwnerDeviceKind;
    displayName: string;
    callbackUrl?: string;
  }): Promise<OwnerAccountBootstrapResult>;
}

let injectedApi: OwnerAccountBootstrapApi | null = null;

/** Tests and native companion integrations may replace only the account bootstrap transport. */
export function setOwnerAccountBootstrapApi(api: OwnerAccountBootstrapApi | null): void {
  injectedApi = api;
}

export function ownerAccountBootstrapApi(): OwnerAccountBootstrapApi {
  return injectedApi ?? HTTP_OWNER_ACCOUNT_BOOTSTRAP;
}

export function officialFocusLinkEndpoint(): string {
  const configured = cloudOnlyMobileSyncEndpoint(import.meta.env.VITE_FOCUSLINK_ENDPOINT ?? '');
  if (configured) return configured;
  return OFFICIAL_FOCUSLINK_ENDPOINT;
}

export function isOwnerAccountCallback(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'focuslink:' && url.hostname === 'auth';
  } catch {
    return false;
  }
}

export async function openOwnerLogin(loginUrl: string): Promise<void> {
  const parsed = new URL(loginUrl);
  if (parsed.protocol !== 'https:') throw new Error('登录地址无效');
  if (Capacitor.isNativePlatform()) {
    if (!(await openNativeExternalUrl(parsed.toString()))) {
      throw new Error('无法打开系统登录页面');
    }
    return;
  }
  window.location.assign(parsed.toString());
}

const HTTP_OWNER_ACCOUNT_BOOTSTRAP: OwnerAccountBootstrapApi = {
  async bootstrap(input) {
    const endpoint = officialFocusLinkEndpoint();
    const platform: FocusLinkDevicePlatform = Capacitor.isNativePlatform() ? 'android' : 'web';
    const deviceKind: FocusLinkDeviceKind = input.deviceKind === 'web' ? 'phone' : input.deviceKind;
    const response = await fetch(`${endpoint}${OWNER_DEVICE_BOOTSTRAP_PATH}`, {
      method: 'POST',
      credentials: 'include',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      redirect: 'error',
      body: JSON.stringify({
        protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
        installationId: input.installationId,
        displayName: input.displayName,
        platform,
        deviceKind,
        appVersion: APP_VERSION,
        ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
      }),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const detail = readString(body, 'message') || readString(body, 'error');
      throw new Error(detail || `登录服务返回 HTTP ${response.status}`);
    }
    if (validateFocusLinkDeviceRegistrationResponse(body)) {
      return {
        status: 'authenticated',
        session: {
          accountId: body.accountPublicId,
          accountLabel: 'Poyi',
          endpoint,
          accessToken: body.accessToken,
          deviceId: body.deviceId,
        },
      };
    }
    if (!body || typeof body !== 'object') throw new Error('登录服务响应无效');
    const status = readString(body, 'status');
    if (status === 'login-required') {
      const loginUrl = readString(body, 'loginUrl');
      if (!loginUrl) throw new Error('登录服务未返回登录入口');
      return { status, loginUrl };
    }
    if (status === 'waiting-for-phone' || status === 'pending') {
      const retryAfterMs = readNumber(body, 'retryAfterMs');
      return {
        status: 'waiting-for-phone',
        retryAfterMs: Math.max(1_000, Math.min(retryAfterMs ?? 3_000, 30_000)),
      };
    }
    const sessionValue = (body as Record<string, unknown>).session;
    if (!sessionValue || typeof sessionValue !== 'object') throw new Error('登录服务响应无效');
    const session = sessionValue as Record<string, unknown>;
    const accountId = readString(session, 'accountId');
    const accountLabel = readString(session, 'accountLabel');
    const accessToken = readString(session, 'accessToken');
    const assignedDeviceId = readString(session, 'deviceId');
    const sessionEndpoint = cloudOnlyMobileSyncEndpoint(
      readString(session, 'endpoint') || endpoint,
    );
    if (!accountId || !accountLabel || !accessToken || !assignedDeviceId || !sessionEndpoint) {
      throw new Error('登录服务返回的账号凭据不完整');
    }
    return {
      status: 'authenticated',
      session: {
        accountId,
        accountLabel,
        endpoint: sessionEndpoint,
        accessToken,
        deviceId: assignedDeviceId,
      },
    };
  },
};

function readString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate.trim() : '';
}

function readNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}
