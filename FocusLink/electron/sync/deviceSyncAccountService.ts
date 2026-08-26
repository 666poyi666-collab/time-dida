import crypto from 'node:crypto';
import os from 'node:os';
import { shell } from 'electron';
import { APP_VERSION } from '@shared/version';
import {
  FOCUSLINK_CANONICAL_SYNC_ORIGIN,
  focusLinkSyncEndpointCandidates,
  FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
  FOCUSLINK_ENROLLED_DEVICE_SCOPES,
  isFocusLinkDeviceAccessToken,
  type FocusLinkDeviceRegistrationRequest,
} from '@shared/sync/identityProtocol';
import {
  FOCUSLINK_ACCOUNT_BOOTSTRAP_PATH,
  FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
  parseFocusLinkAccountBootstrapResponse,
  redactFocusLinkAccountBootstrapResponse,
  type FocusLinkAccountBootstrapPollRequest,
  type FocusLinkAccountBootstrapRequest,
  type FocusLinkAccountBootstrapResponse,
} from '@shared/sync/accountBootstrapProtocol';
import {
  FOCUSLINK_PAIRING_CODE_PATTERN,
  FOCUSLINK_PAIRING_REQUEST_TOKEN_PATTERN,
  normalizeFocusLinkPairingCode,
} from '@shared/sync/pairingProtocol';
import type {
  DeviceSyncAccountLoginResult,
  DeviceSyncManagedDevice,
  DeviceSyncNumericPairingOffer,
  DeviceSyncPairingApprovalResult,
  DeviceSyncPairingPollResult,
} from '@shared/ipc/api';
import { getMeta, setMeta } from '../db/index.js';
import { logger } from '../logger.js';
import { getSettings, updateSettings } from '../settingsStore.js';
import {
  getDeviceSyncStatus,
  invalidateDeviceSyncConnection,
  runDeviceSync,
} from './deviceSyncService.js';
import { getDeviceSyncToken, setDeviceSyncToken } from './deviceSyncCredentials.js';

export const OFFICIAL_FOCUSLINK_ENDPOINT = FOCUSLINK_CANONICAL_SYNC_ORIGIN;
export { FOCUSLINK_ACCOUNT_BOOTSTRAP_PATH };

const META_INSTALLATION_ID = 'deviceSync.ownerInstallationIdV1';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

let loginInFlight: Promise<DeviceSyncAccountLoginResult> | null = null;
let loginGeneration = 0;
let loginAbortController: AbortController | null = null;
let pendingLocalPairRequest: {
  requestToken: string;
  expiresAt: number;
} | null = null;
let pairingPollInFlight: Promise<DeviceSyncPairingPollResult> | null = null;

export function getDeviceSyncAccountIdentity(): {
  signedIn: boolean;
  accountId: string | null;
  accountLabel: string | null;
} {
  const token = getDeviceSyncToken();
  const match = isFocusLinkDeviceAccessToken(token ?? '')
    ? token?.match(/^fl2_([A-Za-z0-9-]{6,80})_/)
    : null;
  return {
    signedIn: Boolean(match),
    accountId: match?.[1] ?? null,
    // FocusLink currently has one owner account. Keep the public-id detail out of normal UI.
    accountLabel: match ? 'Poyi' : null,
  };
}

export function migrateLegacyLoopbackAccountConnection(): boolean {
  const settings = getSettings().deviceSync;
  const identity = getDeviceSyncAccountIdentity();
  let host = '';
  try {
    host = new URL(settings.endpoint).hostname;
  } catch {
    host = '';
  }
  if (identity.signedIn || !['localhost', '127.0.0.1', '::1'].includes(host)) return false;
  invalidateDeviceSyncConnection();
  setDeviceSyncToken(null);
  updateSettings({
    deviceSync: {
      enabled: false,
      endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
      autoSync: true,
      liveControlEnabled: false,
    },
  });
  logger.info('deviceSyncAccount', 'retired legacy loopback credential; account login required');
  return true;
}

export function loginDeviceSyncAccount(): Promise<DeviceSyncAccountLoginResult> {
  if (loginInFlight) return loginInFlight;
  const generation = ++loginGeneration;
  const controller = new AbortController();
  loginAbortController = controller;
  const operation = loginDeviceSyncAccountInternal(generation, controller.signal).finally(() => {
    if (loginInFlight === operation) loginInFlight = null;
    if (loginAbortController === controller) loginAbortController = null;
  });
  loginInFlight = operation;
  return operation;
}

export async function createDeviceSyncPairingCode(): Promise<DeviceSyncNumericPairingOffer> {
  const token = getDeviceSyncToken();
  const signedIn = isFocusLinkDeviceAccessToken(token ?? '');
  const registration = pairingDeviceRequest();
  const response = signedIn
    ? await requestPairing('/sync/v1/pair/offers', {
        headers: { authorization: `Bearer ${token}` },
        body: {
          displayName: 'FocusLink 新设备',
          scopes: [...FOCUSLINK_ENROLLED_DEVICE_SCOPES],
        },
      })
    : await requestPairing('/sync/v1/pair/requests', {
        body: { device: registration },
      });
  if (signedIn && getDeviceSyncToken() !== token) {
    throw new Error('账号连接已变化，请重新生成配对码');
  }
  if (
    !isRecord(response) ||
    typeof response.code !== 'string' ||
    !FOCUSLINK_PAIRING_CODE_PATTERN.test(response.code) ||
    !Number.isSafeInteger(response.expiresAt) ||
    Number(response.expiresAt) <= Date.now() ||
    Number(response.expiresAt) > Date.now() + 15 * 60_000
  ) {
    throw new Error('配对服务响应无效');
  }
  if (!signedIn) {
    if (
      typeof response.requestToken !== 'string' ||
      !FOCUSLINK_PAIRING_REQUEST_TOKEN_PATTERN.test(response.requestToken)
    ) {
      throw new Error('配对服务响应无效');
    }
    pendingLocalPairRequest = {
      requestToken: response.requestToken,
      expiresAt: Number(response.expiresAt),
    };
  }
  logger.info(
    'deviceSyncAccount',
    signedIn ? 'trusted device pairing code created' : 'local device pairing request created',
    {
      expiresAt: Number(response.expiresAt),
    },
  );
  return { code: response.code, expiresAt: Number(response.expiresAt) };
}

export function pollDeviceSyncPairingCode(): Promise<DeviceSyncPairingPollResult> {
  if (pairingPollInFlight) return pairingPollInFlight;
  const operation = pollDeviceSyncPairingCodeInternal().finally(() => {
    if (pairingPollInFlight === operation) pairingPollInFlight = null;
  });
  pairingPollInFlight = operation;
  return operation;
}

async function pollDeviceSyncPairingCodeInternal(): Promise<DeviceSyncPairingPollResult> {
  if (getDeviceSyncAccountIdentity().signedIn) {
    return {
      status: 'authenticated',
      result: { status: getDeviceSyncStatus(), sync: null, syncError: null },
    };
  }
  const pending = pendingLocalPairRequest;
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingLocalPairRequest = null;
    throw new Error('本机配对码已过期，请重新生成');
  }
  const registration = pairingDeviceRequest();
  const response = await requestPairing('/sync/v1/pair/claim', {
    body: { requestToken: pending.requestToken, device: registration },
  });
  if (
    isRecord(response) &&
    response.status === 'pending' &&
    Number.isSafeInteger(response.expiresAt) &&
    Number.isSafeInteger(response.retryAfterMs)
  ) {
    return {
      status: 'pending',
      expiresAt: Number(response.expiresAt),
      retryAfterMs: Number(response.retryAfterMs),
    };
  }
  if (
    !isRecord(response) ||
    response.status !== 'authenticated' ||
    typeof response.accessToken !== 'string' ||
    !isFocusLinkDeviceAccessToken(response.accessToken) ||
    typeof response.deviceId !== 'string' ||
    response.deviceId !== deviceIdFromToken(response.accessToken)
  ) {
    throw new Error('配对领取响应无效');
  }
  const generation = ++loginGeneration;
  const controller = new AbortController();
  loginAbortController?.abort();
  loginAbortController = controller;
  invalidateDeviceSyncConnection();
  setDeviceSyncToken(response.accessToken);
  enableOfficialSync();
  pendingLocalPairRequest = null;
  try {
    return {
      status: 'authenticated',
      result: await finishLogin(generation, controller.signal),
    };
  } finally {
    if (loginAbortController === controller) loginAbortController = null;
  }
}

export async function approveDeviceSyncPairingCode(
  codeInput: string,
): Promise<DeviceSyncPairingApprovalResult> {
  const token = getDeviceSyncToken();
  if (!token || !isFocusLinkDeviceAccessToken(token)) {
    throw new Error('只有已授权设备可以批准另一台设备');
  }
  const code = normalizeFocusLinkPairingCode(codeInput);
  if (!FOCUSLINK_PAIRING_CODE_PATTERN.test(code)) throw new Error('请输入 8 位数字配对码');
  const response = await requestPairing('/sync/v1/pair/approve', {
    headers: { authorization: `Bearer ${token}` },
    body: { code },
  });
  if (
    !isRecord(response) ||
    response.status !== 'approved' ||
    typeof response.displayName !== 'string' ||
    !Number.isSafeInteger(response.expiresAt)
  ) {
    throw new Error('配对批准响应无效');
  }
  return {
    status: 'approved',
    displayName: response.displayName,
    expiresAt: Number(response.expiresAt),
  };
}

export async function listDeviceSyncDevices(): Promise<DeviceSyncManagedDevice[]> {
  const token = getDeviceSyncToken();
  if (!token || !isFocusLinkDeviceAccessToken(token)) throw new Error('请先在这台设备完成授权');
  const response = await requestDeviceRoster('/sync/v2/devices', token, 'GET');
  if (!isRecord(response) || !Array.isArray(response.devices)) throw new Error('设备列表响应无效');
  return response.devices.filter(isManagedDevice) as DeviceSyncManagedDevice[];
}

export async function revokeDeviceSyncDevice(
  deviceId: string,
): Promise<{ deviceId: string; revokedAt: number }> {
  const token = getDeviceSyncToken();
  if (!token || !isFocusLinkDeviceAccessToken(token)) throw new Error('请先在这台设备完成授权');
  if (!/^device-[A-Za-z0-9-]{6,194}$/.test(deviceId)) throw new Error('设备标识无效');
  const response = await requestDeviceRoster(`/sync/v2/devices/${deviceId}/revoke`, token, 'POST');
  if (
    !isRecord(response) ||
    response.deviceId !== deviceId ||
    !Number.isSafeInteger(response.revokedAt)
  )
    throw new Error('设备撤销响应无效');
  return { deviceId, revokedAt: Number(response.revokedAt) };
}

export function redeemDeviceSyncPairingCode(
  codeInput: string,
): Promise<DeviceSyncAccountLoginResult> {
  if (loginInFlight) return loginInFlight;
  const generation = ++loginGeneration;
  const controller = new AbortController();
  loginAbortController = controller;
  const operation = redeemDeviceSyncPairingCodeInternal(
    codeInput,
    generation,
    controller.signal,
  ).finally(() => {
    if (loginInFlight === operation) loginInFlight = null;
    if (loginAbortController === controller) loginAbortController = null;
  });
  loginInFlight = operation;
  return operation;
}

export function logoutDeviceSyncAccount(): void {
  loginGeneration += 1;
  loginAbortController?.abort();
  loginAbortController = null;
  loginInFlight = null;
  pairingPollInFlight = null;
  pendingLocalPairRequest = null;
  invalidateDeviceSyncConnection();
  setDeviceSyncToken(null);
  updateSettings({
    deviceSync: {
      enabled: false,
      endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
      autoSync: true,
      liveControlEnabled: false,
    },
  });
  logger.info('deviceSyncAccount', 'owner account signed out on this device');
}

async function loginDeviceSyncAccountInternal(
  generation: number,
  signal: AbortSignal,
): Promise<DeviceSyncAccountLoginResult> {
  assertCurrentLogin(generation, signal);
  const existing = getDeviceSyncAccountIdentity();
  if (existing.signedIn) {
    assertCurrentLogin(generation, signal);
    enableOfficialSync();
    return finishLogin(generation, signal);
  }

  const registration = registrationRequest();
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let request: FocusLinkAccountBootstrapRequest = {
    protocolVersion: FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
    action: 'start',
    registration,
  };
  let poll: FocusLinkAccountBootstrapPollRequest | null = null;
  let openedLogin = false;
  while (Date.now() < deadline) {
    const response = await requestBootstrap(request, signal);
    assertCurrentLogin(generation, signal);
    logger.debug(
      'deviceSyncAccount',
      'owner bootstrap response received',
      redactFocusLinkAccountBootstrapResponse(response),
    );
    if (response.status === 'authenticated') {
      if (!openedLogin || !poll) {
        throw new Error('登录服务未完成管理员授权，已拒绝设备凭据');
      }
      assertCurrentLogin(generation, signal);
      invalidateDeviceSyncConnection();
      setDeviceSyncToken(response.device.accessToken);
      enableOfficialSync();
      logger.info('deviceSyncAccount', 'owner device credential enrolled', {
        accountPublicId: response.device.accountPublicId,
        deviceId: response.device.deviceId,
        expiresAt: response.device.expiresAt,
      });
      return finishLogin(generation, signal);
    }
    if (response.status === 'login-required') {
      if (poll && (poll.flowId !== response.flowId || poll.pollToken !== response.pollToken)) {
        throw new Error('登录服务在轮询中更换了授权流程');
      }
      poll = {
        protocolVersion: FOCUSLINK_ACCOUNT_BOOTSTRAP_PROTOCOL_VERSION,
        action: 'poll',
        flowId: response.flowId,
        pollToken: response.pollToken,
      };
      request = poll;
      if (!openedLogin) {
        await shell.openExternal(response.loginUrl);
        assertCurrentLogin(generation, signal);
        openedLogin = true;
        logger.info('deviceSyncAccount', 'owner sign-in opened in system browser', {
          loginOrigin: new URL(response.loginUrl).origin,
          flowId: response.flowId,
        });
      }
    } else {
      if (!poll || response.flowId !== poll.flowId) {
        throw new Error('登录服务返回了不匹配的授权流程');
      }
      request = poll;
    }
    await wait(response.retryAfterMs, signal);
    assertCurrentLogin(generation, signal);
  }
  throw new Error('登录等待超时，请重新点击登录');
}

async function redeemDeviceSyncPairingCodeInternal(
  codeInput: string,
  generation: number,
  signal: AbortSignal,
): Promise<DeviceSyncAccountLoginResult> {
  assertCurrentLogin(generation, signal);
  if (getDeviceSyncAccountIdentity().signedIn) {
    throw new Error('这台设备已经加入多端同步');
  }
  const code = normalizeFocusLinkPairingCode(codeInput);
  if (!FOCUSLINK_PAIRING_CODE_PATTERN.test(code)) {
    throw new Error('请输入 8 位数字配对码');
  }
  const registration = registrationRequest();
  const response = await requestPairing(
    '/sync/v1/pair/exchange',
    {
      body: {
        code,
        device: {
          installationId: registration.installationId,
          displayName: registration.displayName,
          platform: registration.platform,
          deviceKind: registration.deviceKind,
          appVersion: registration.appVersion,
        },
      },
    },
    signal,
  );
  assertCurrentLogin(generation, signal);
  if (
    !isRecord(response) ||
    typeof response.accessToken !== 'string' ||
    !isFocusLinkDeviceAccessToken(response.accessToken) ||
    typeof response.deviceId !== 'string' ||
    response.deviceId !== deviceIdFromToken(response.accessToken)
  ) {
    throw new Error('配对响应无效');
  }
  invalidateDeviceSyncConnection();
  setDeviceSyncToken(response.accessToken);
  enableOfficialSync();
  logger.info('deviceSyncAccount', 'device enrolled with trusted pairing code', {
    deviceId: response.deviceId,
  });
  return finishLogin(generation, signal);
}

async function finishLogin(
  generation: number,
  signal: AbortSignal,
): Promise<DeviceSyncAccountLoginResult> {
  assertCurrentLogin(generation, signal);
  let sync: Awaited<ReturnType<typeof runDeviceSync>> | null = null;
  let syncError: string | null = null;
  try {
    sync = await runDeviceSync();
  } catch (error) {
    assertCurrentLogin(generation, signal);
    syncError = error instanceof Error ? error.message : String(error);
    logger.warn('deviceSyncAccount', 'initial sync remains pending after sign-in', {
      error: syncError,
    });
  }
  assertCurrentLogin(generation, signal);
  return { status: getDeviceSyncStatus(), sync, syncError };
}

function enableOfficialSync(): void {
  updateSettings({
    deviceSync: {
      enabled: true,
      endpoint: OFFICIAL_FOCUSLINK_ENDPOINT,
      autoSync: true,
      liveControlEnabled: true,
    },
  });
}

function registrationRequest(): FocusLinkDeviceRegistrationRequest {
  return {
    protocolVersion: FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
    installationId: getOrCreateInstallationId(),
    displayName: `FocusLink · ${cleanDeviceName(os.hostname())}`,
    platform: 'windows',
    deviceKind: 'desktop',
    appVersion: APP_VERSION,
  };
}

function pairingDeviceRequest(): Omit<FocusLinkDeviceRegistrationRequest, 'protocolVersion'> {
  const registration = registrationRequest();
  return {
    installationId: registration.installationId,
    displayName: registration.displayName,
    platform: registration.platform,
    deviceKind: registration.deviceKind,
    appVersion: registration.appVersion,
  };
}

function getOrCreateInstallationId(): string {
  const existing = getMeta(META_INSTALLATION_ID)?.trim();
  if (existing && /^[A-Za-z0-9._~-]{20,160}$/.test(existing)) return existing;
  const created = `windows-${crypto.randomBytes(24).toString('base64url')}`;
  setMeta(META_INSTALLATION_ID, created);
  return created;
}

function cleanDeviceName(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 70);
  return cleaned || 'Windows 电脑';
}

async function requestPairing(
  path:
    | '/sync/v1/pair/offers'
    | '/sync/v1/pair/exchange'
    | '/sync/v1/pair/requests'
    | '/sync/v1/pair/approve'
    | '/sync/v1/pair/claim',
  input: { headers?: Record<string, string>; body: Record<string, unknown> },
  parentSignal?: AbortSignal,
): Promise<unknown> {
  const candidates = focusLinkSyncEndpointCandidates(OFFICIAL_FOCUSLINK_ENDPOINT);
  let lastError: unknown = null;
  for (const [index, endpoint] of candidates.entries()) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${endpoint}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...input.headers,
        },
        body: JSON.stringify(input.body),
        redirect: 'error',
        signal: controller.signal,
      });
      const value = (await response.json().catch(() => null)) as unknown;
      if (response.status >= 500 && index < candidates.length - 1) continue;
      if (!response.ok) throw new Error(pairingErrorMessage(value, response.status));
      return value;
    } catch (error) {
      lastError = error;
      if (parentSignal?.aborted || index === candidates.length - 1) {
        if (error instanceof Error && error.name === 'AbortError') {
          if (parentSignal?.aborted) throw new Error('配对已取消');
          throw new Error('配对服务请求超时');
        }
        throw error;
      }
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('配对服务请求失败');
}

async function requestDeviceRoster(
  path: string,
  token: string,
  method: 'GET' | 'POST',
): Promise<unknown> {
  let lastError: unknown = null;
  for (const [index, endpoint] of focusLinkSyncEndpointCandidates(
    OFFICIAL_FOCUSLINK_ENDPOINT,
  ).entries()) {
    try {
      const response = await fetch(`${endpoint}${path}`, {
        method,
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const value = (await response.json().catch(() => null)) as unknown;
      if (response.status >= 500 && index === 0) continue;
      if (!response.ok) throw new Error('设备列表服务暂不可用');
      return value;
    } catch (error) {
      lastError = error;
      if (index > 0) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('设备列表服务暂不可用');
}

function isManagedDevice(value: unknown): value is DeviceSyncManagedDevice {
  if (!isRecord(value)) return false;
  return (
    typeof value.deviceId === 'string' &&
    typeof value.devicePublicId === 'string' &&
    typeof value.displayName === 'string' &&
    (value.platform === null || typeof value.platform === 'string') &&
    (value.deviceKind === null || typeof value.deviceKind === 'string') &&
    (value.appVersion === null || typeof value.appVersion === 'string') &&
    (value.expiresAt === null || Number.isSafeInteger(value.expiresAt)) &&
    (value.revokedAt === null || Number.isSafeInteger(value.revokedAt)) &&
    (value.lastSeenAt === null || Number.isSafeInteger(value.lastSeenAt)) &&
    typeof value.stale === 'boolean' &&
    (value.registeredAt === null || Number.isSafeInteger(value.registeredAt))
  );
}

function pairingErrorMessage(value: unknown, status: number): string {
  const code = isRecord(value)
    ? typeof value.error === 'string'
      ? value.error
      : isRecord(value.error) && typeof value.error.code === 'string'
        ? value.error.code
        : typeof value.code === 'string'
          ? value.code
          : ''
    : '';
  if (code === 'pairing_expired') return '配对码已过期或已使用';
  if (code === 'pair_rate_limited') return '尝试次数过多，请稍后再试';
  if (code === 'scope_denied' || status === 401 || status === 403)
    return '当前设备没有生成配对码的权限';
  return `配对服务返回 HTTP ${status}`;
}

function deviceIdFromToken(token: string): string | null {
  const match = /^fl2_[A-Za-z0-9-]{6,80}_([A-Za-z0-9-]{6,80})_/.exec(token);
  return match ? `device-${match[1]}` : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestBootstrap(
  request: FocusLinkAccountBootstrapRequest,
  parentSignal: AbortSignal,
): Promise<FocusLinkAccountBootstrapResponse> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal.aborted) abortFromParent();
  else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${OFFICIAL_FOCUSLINK_ENDPOINT}${FOCUSLINK_ACCOUNT_BOOTSTRAP_PATH}`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
        redirect: 'error',
        signal: controller.signal,
      },
    );
    const value = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('账号登录网关尚未部署，请保留当前设备登录态并稍后重试');
      }
      throw new Error(readBootstrapError(value) || `登录服务返回 HTTP ${response.status}`);
    }
    const parsed = parseFocusLinkAccountBootstrapResponse(value);
    if (!parsed) throw new Error('登录服务响应无效');
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (parentSignal.aborted) throw new Error('登录已取消');
      throw new Error('登录服务请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener('abort', abortFromParent);
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('登录已取消'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('登录已取消'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function assertCurrentLogin(generation: number, signal: AbortSignal): void {
  if (signal.aborted || generation !== loginGeneration) throw new Error('登录已取消');
}

function readBootstrapError(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  if (typeof record.message === 'string') return redactBootstrapErrorMessage(record.message);
  if (typeof record.error === 'string') return redactBootstrapErrorMessage(record.error);
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
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 240);
}
