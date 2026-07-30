import crypto from 'node:crypto';
import os from 'node:os';
import { shell } from 'electron';
import { APP_VERSION } from '@shared/version';
import {
  FOCUSLINK_CANONICAL_SYNC_ORIGIN,
  FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
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
import type { DeviceSyncAccountLoginResult } from '@shared/ipc/api';
import { getMeta, setMeta } from '../db/index.js';
import { logger } from '../logger.js';
import { updateSettings } from '../settingsStore.js';
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

export function getDeviceSyncAccountIdentity(): {
  signedIn: boolean;
  accountId: string | null;
  accountLabel: string | null;
} {
  const token = getDeviceSyncToken();
  const match = token?.match(/^fl2_([A-Za-z0-9-]{6,80})_[A-Za-z0-9-]{6,80}_[A-Za-z0-9_-]{32,160}$/);
  return {
    signedIn: Boolean(match),
    accountId: match?.[1] ?? null,
    // FocusLink currently has one owner account. Keep the public-id detail out of normal UI.
    accountLabel: match ? 'Poyi' : null,
  };
}

export function loginDeviceSyncAccount(): Promise<DeviceSyncAccountLoginResult> {
  if (loginInFlight) return loginInFlight;
  const operation = loginDeviceSyncAccountInternal().finally(() => {
    if (loginInFlight === operation) loginInFlight = null;
  });
  loginInFlight = operation;
  return operation;
}

export function logoutDeviceSyncAccount(): void {
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

async function loginDeviceSyncAccountInternal(): Promise<DeviceSyncAccountLoginResult> {
  const existing = getDeviceSyncAccountIdentity();
  if (existing.signedIn) {
    enableOfficialSync();
    return finishLogin();
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
    const response = await requestBootstrap(request);
    logger.debug(
      'deviceSyncAccount',
      'owner bootstrap response received',
      redactFocusLinkAccountBootstrapResponse(response),
    );
    if (response.status === 'authenticated') {
      if (!openedLogin || !poll) {
        throw new Error('登录服务未完成管理员授权，已拒绝设备凭据');
      }
      invalidateDeviceSyncConnection();
      setDeviceSyncToken(response.device.accessToken);
      enableOfficialSync();
      logger.info('deviceSyncAccount', 'owner device credential enrolled', {
        accountPublicId: response.device.accountPublicId,
        deviceId: response.device.deviceId,
        expiresAt: response.device.expiresAt,
      });
      return finishLogin();
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
    await wait(response.retryAfterMs);
  }
  throw new Error('登录等待超时，请重新点击登录');
}

async function finishLogin(): Promise<DeviceSyncAccountLoginResult> {
  let sync: Awaited<ReturnType<typeof runDeviceSync>> | null = null;
  let syncError: string | null = null;
  try {
    sync = await runDeviceSync();
  } catch (error) {
    syncError = error instanceof Error ? error.message : String(error);
    logger.warn('deviceSyncAccount', 'initial sync remains pending after sign-in', {
      error: syncError,
    });
  }
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

async function requestBootstrap(
  request: FocusLinkAccountBootstrapRequest,
): Promise<FocusLinkAccountBootstrapResponse> {
  const controller = new AbortController();
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
      throw new Error('登录服务请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
