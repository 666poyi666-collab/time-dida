import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from '@shared/version';
import {
  FOCUSLINK_ACCOUNT_BOOTSTRAP_PATH,
  FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
  FOCUSLINK_CANONICAL_IDENTITY_ORIGIN,
  parseFocusLinkAccountBootstrapResponse,
  type FocusLinkAccountBootstrapRequest,
} from '@shared/sync/accountBootstrapProtocol';
import {
  FOCUSLINK_CANONICAL_SYNC_ORIGIN,
  FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
  type FocusLinkDeviceKind,
  type FocusLinkDevicePlatform,
} from '@shared/sync/identityProtocol';
import { openNativeExternalUrl } from './nativeFocusRuntime';

export const OFFICIAL_FOCUSLINK_ENDPOINT = FOCUSLINK_CANONICAL_SYNC_ORIGIN;
export const OWNER_DEVICE_BOOTSTRAP_PATH = FOCUSLINK_ACCOUNT_BOOTSTRAP_PATH;

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
let pendingHttpFlow: {
  installationId: string;
  flowId: string;
  pollToken: string;
  expiresAt: number;
  nextPollAt: number;
} | null = null;
let httpRequestGeneration = 0;
let httpRequestController: AbortController | null = null;
let httpRequestInFlight: Promise<OwnerAccountBootstrapResult> | null = null;

/** Tests and native companion integrations may replace only the account bootstrap transport. */
export function setOwnerAccountBootstrapApi(api: OwnerAccountBootstrapApi | null): void {
  invalidateOwnerAccountBootstrap();
  injectedApi = api;
}

export function invalidateOwnerAccountBootstrap(): void {
  httpRequestGeneration += 1;
  httpRequestController?.abort();
  httpRequestController = null;
  httpRequestInFlight = null;
  pendingHttpFlow = null;
}

export function ownerAccountBootstrapApi(): OwnerAccountBootstrapApi {
  return injectedApi ?? HTTP_OWNER_ACCOUNT_BOOTSTRAP;
}

export function officialFocusLinkEndpoint(): string {
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
  if (
    parsed.origin !== FOCUSLINK_CANONICAL_IDENTITY_ORIGIN ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== '' ||
    !parsed.pathname.startsWith('/owner/')
  ) {
    throw new Error('登录地址无效');
  }
  if (Capacitor.isNativePlatform()) {
    if (!(await openNativeExternalUrl(parsed.toString()))) {
      throw new Error('无法打开系统登录页面');
    }
    return;
  }
  window.location.assign(parsed.toString());
}

const HTTP_OWNER_ACCOUNT_BOOTSTRAP: OwnerAccountBootstrapApi = {
  bootstrap(input) {
    if (httpRequestInFlight) return httpRequestInFlight;
    const generation = ++httpRequestGeneration;
    const controller = new AbortController();
    httpRequestController = controller;
    const operation = bootstrapOwnerAccountHttp(input, generation, controller.signal).finally(() => {
      if (httpRequestInFlight === operation) httpRequestInFlight = null;
      if (httpRequestController === controller) httpRequestController = null;
    });
    httpRequestInFlight = operation;
    return operation;
  },
};

async function bootstrapOwnerAccountHttp(
  input: {
    installationId: string;
    deviceKind: OwnerDeviceKind;
    displayName: string;
    callbackUrl?: string;
  },
  generation: number,
  signal: AbortSignal,
): Promise<OwnerAccountBootstrapResult> {
    const endpoint = officialFocusLinkEndpoint();
    const platform: FocusLinkDevicePlatform = Capacitor.isNativePlatform() ? 'android' : 'web';
    const deviceKind: FocusLinkDeviceKind = input.deviceKind === 'web' ? 'phone' : input.deviceKind;

    if (
      pendingHttpFlow &&
      (pendingHttpFlow.installationId !== input.installationId ||
        pendingHttpFlow.expiresAt <= Date.now())
    ) {
      pendingHttpFlow = null;
    }
    if (pendingHttpFlow && !input.callbackUrl && pendingHttpFlow.nextPollAt > Date.now()) {
      return {
        status: 'waiting-for-phone',
        retryAfterMs: Math.max(1_000, pendingHttpFlow.nextPollAt - Date.now()),
      };
    }

    const activeFlow = pendingHttpFlow;
    const request: FocusLinkAccountBootstrapRequest = activeFlow
      ? {
          protocolVersion: FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
          action: 'poll',
          flowId: activeFlow.flowId,
          pollToken: activeFlow.pollToken,
        }
      : {
          protocolVersion: FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
          action: 'start',
          registration: {
            protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
            installationId: input.installationId,
            displayName: input.displayName,
            platform,
            deviceKind,
            appVersion: APP_VERSION,
          },
        };
    const result = await requestOwnerBootstrap(endpoint, request, signal);
    assertCurrentHttpRequest(generation, signal);

    if (result.status === 'authenticated') {
      if (!activeFlow) {
        pendingHttpFlow = null;
        throw new Error('登录服务未完成管理员授权，已拒绝设备凭据');
      }
      pendingHttpFlow = null;
      return {
        status: 'authenticated',
        session: {
          accountId: result.device.accountPublicId,
          accountLabel: result.accountLabel,
          endpoint: result.endpoint,
          accessToken: result.device.accessToken,
          deviceId: result.device.deviceId,
        },
      };
    }

    if (result.status === 'login-required') {
      if (
        activeFlow &&
        (activeFlow.flowId !== result.flowId || activeFlow.pollToken !== result.pollToken)
      ) {
        pendingHttpFlow = null;
        throw new Error('登录服务在轮询中更换了授权流程');
      }
      pendingHttpFlow = makePendingFlow(input.installationId, result);
      return { status: 'login-required', loginUrl: result.loginUrl };
    }

    if (!activeFlow || activeFlow.flowId !== result.flowId) {
      pendingHttpFlow = null;
      throw new Error('登录服务返回了不匹配的授权流程');
    }
    pendingHttpFlow = {
      ...activeFlow,
      expiresAt: localExpiry(result.serverTime, result.expiresAt),
      nextPollAt: Date.now() + result.retryAfterMs,
    };
    return {
      status: 'waiting-for-phone',
      retryAfterMs: result.retryAfterMs,
    };
}

async function requestOwnerBootstrap(
  endpoint: string,
  request: FocusLinkAccountBootstrapRequest,
  signal: AbortSignal,
) {
  const response = await fetch(`${endpoint}${OWNER_DEVICE_BOOTSTRAP_PATH}`, {
    method: 'POST',
    credentials: 'omit',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    redirect: 'error',
    body: JSON.stringify(request),
    signal,
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('账号登录网关尚未部署，请保留当前设备登录态并稍后重试');
    }
    throw new Error(readBootstrapError(body) || `登录服务返回 HTTP ${response.status}`);
  }
  const parsed = parseFocusLinkAccountBootstrapResponse(body);
  if (!parsed) throw new Error('登录服务响应无效');
  return parsed;
}

function assertCurrentHttpRequest(generation: number, signal: AbortSignal): void {
  if (signal.aborted || generation !== httpRequestGeneration) {
    throw new DOMException('account bootstrap invalidated', 'AbortError');
  }
}

function makePendingFlow(
  installationId: string,
  response: {
    flowId: string;
    pollToken: string;
    retryAfterMs: number;
    expiresAt: number;
    serverTime: number;
  },
) {
  return {
    installationId,
    flowId: response.flowId,
    pollToken: response.pollToken,
    expiresAt: localExpiry(response.serverTime, response.expiresAt),
    nextPollAt: Date.now() + response.retryAfterMs,
  };
}

function localExpiry(serverTime: number, expiresAt: number): number {
  return Date.now() + Math.max(0, expiresAt - serverTime);
}

function readBootstrapError(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  const direct = typeof record.message === 'string' ? record.message : record.error;
  if (typeof direct === 'string') return redactBootstrapErrorMessage(direct);
  const nested = record.error;
  return nested &&
    typeof nested === 'object' &&
    typeof (nested as Record<string, unknown>).message === 'string'
    ? redactBootstrapErrorMessage(String((nested as Record<string, unknown>).message))
    : '';
}

function redactBootstrapErrorMessage(value: string): string {
  return value
    .replace(/\bfl2_[A-Za-z0-9_-]+/g, '[device-credential-redacted]')
    .replace(/\bflb_[A-Za-z0-9_-]+/g, '[poll-credential-redacted]')
    .replace(/([?&](?:access_token|token|pollToken)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 240);
}
