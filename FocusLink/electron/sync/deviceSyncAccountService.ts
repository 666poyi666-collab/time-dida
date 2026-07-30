import crypto from 'node:crypto';
import os from 'node:os';
import { shell } from 'electron';
import { APP_VERSION } from '@shared/version';
import {
  FOCUSLINK_CANONICAL_SYNC_ORIGIN,
  FOCUSLINK_DEVICE_REGISTRATION_PROTOCOL_VERSION,
  validateFocusLinkDeviceRegistrationResponse,
  type FocusLinkDeviceRegistrationRequest,
  type FocusLinkDeviceRegistrationResponse,
} from '@shared/sync/identityProtocol';
import type { DeviceSyncAccountLoginResult } from '@shared/ipc/api';
import { getMeta, setMeta } from '../db/index.js';
import { logger } from '../logger.js';
import { updateSettings } from '../settingsStore.js';
import { getDeviceSyncStatus, runDeviceSync } from './deviceSyncService.js';
import { getDeviceSyncToken, setDeviceSyncToken } from './deviceSyncCredentials.js';

export const OFFICIAL_FOCUSLINK_ENDPOINT = FOCUSLINK_CANONICAL_SYNC_ORIGIN;
export const FOCUSLINK_ACCOUNT_BOOTSTRAP_PATH = '/account/v1/device/bootstrap';

const META_INSTALLATION_ID = 'deviceSync.ownerInstallationIdV1';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

type BootstrapResponse =
  | FocusLinkDeviceRegistrationResponse
  | {
      status: 'login-required';
      loginUrl: string;
      retryAfterMs?: number;
    }
  | {
      status: 'pending' | 'waiting-for-phone';
      retryAfterMs?: number;
    }
  | {
      status: 'authenticated';
      session: {
        accountId: string;
        accountLabel: string;
        endpoint: string;
        accessToken: string;
        deviceId: string;
      };
    };

let loginInFlight: Promise<DeviceSyncAccountLoginResult> | null = null;

export function getDeviceSyncAccountIdentity(): {
  signedIn: boolean;
  accountId: string | null;
  accountLabel: string | null;
} {
  const token = getDeviceSyncToken();
  const match = token?.match(/^fl2_([A-Za-z0-9-]{6,80})_[A-Za-z0-9-]{6,80}_/);
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
  let openedLogin = false;
  while (Date.now() < deadline) {
    const response = await requestBootstrap(registration);
    const credential = extractCredential(response);
    if (credential) {
      setDeviceSyncToken(credential.accessToken);
      enableOfficialSync();
      logger.info('deviceSyncAccount', 'owner device credential enrolled', {
        accountPublicId: credential.accountPublicId,
        deviceId: credential.deviceId,
        expiresAt: credential.expiresAt,
      });
      return finishLogin();
    }
    if ('status' in response && response.status === 'login-required' && !openedLogin) {
      const loginUrl = validateLoginUrl(response.loginUrl);
      await shell.openExternal(loginUrl);
      openedLogin = true;
      logger.info('deviceSyncAccount', 'owner sign-in opened in system browser');
    }
    await wait(clampRetryAfter('retryAfterMs' in response ? response.retryAfterMs : undefined));
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
  registration: FocusLinkDeviceRegistrationRequest,
): Promise<BootstrapResponse> {
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
        body: JSON.stringify(registration),
        redirect: 'error',
        signal: controller.signal,
      },
    );
    const value = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new Error(readBootstrapError(value) || `登录服务返回 HTTP ${response.status}`);
    }
    if (validateFocusLinkDeviceRegistrationResponse(value)) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('登录服务响应无效');
    }
    const candidate = value as Record<string, unknown>;
    if (candidate.status === 'login-required' && typeof candidate.loginUrl === 'string') {
      return {
        status: 'login-required',
        loginUrl: candidate.loginUrl,
        ...(typeof candidate.retryAfterMs === 'number'
          ? { retryAfterMs: candidate.retryAfterMs }
          : {}),
      };
    }
    if (candidate.status === 'pending' || candidate.status === 'waiting-for-phone') {
      return {
        status: candidate.status,
        ...(typeof candidate.retryAfterMs === 'number'
          ? { retryAfterMs: candidate.retryAfterMs }
          : {}),
      };
    }
    if (
      candidate.status === 'authenticated' &&
      candidate.session &&
      typeof candidate.session === 'object' &&
      !Array.isArray(candidate.session)
    ) {
      return value as BootstrapResponse;
    }
    throw new Error('登录服务响应无效');
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('登录服务请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractCredential(value: BootstrapResponse):
  | (Pick<FocusLinkDeviceRegistrationResponse, 'accountPublicId' | 'deviceId' | 'accessToken'> & {
      expiresAt: number | null;
    })
  | null {
  if (validateFocusLinkDeviceRegistrationResponse(value)) return value;
  const session = (value as unknown as Record<string, unknown>).session;
  if (!session || typeof session !== 'object' || Array.isArray(session)) return null;
  const record = session as Record<string, unknown>;
  const accessToken = typeof record.accessToken === 'string' ? record.accessToken.trim() : '';
  const deviceId = typeof record.deviceId === 'string' ? record.deviceId.trim() : '';
  const tokenMatch = accessToken.match(
    /^fl2_([A-Za-z0-9-]{6,80})_([A-Za-z0-9-]{6,80})_[A-Za-z0-9_-]{32,160}$/,
  );
  if (!tokenMatch || deviceId !== `device-${tokenMatch[2]}`) return null;
  return {
    accountPublicId: tokenMatch[1],
    deviceId,
    accessToken,
    expiresAt: null,
  };
}

function validateLoginUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('登录服务返回了无效地址');
  return url.toString();
}

function clampRetryAfter(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1_500;
  return Math.max(750, Math.min(Math.floor(value!), 10_000));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBootstrapError(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string') return record.error;
  const nested = record.error;
  return nested &&
    typeof nested === 'object' &&
    typeof (nested as Record<string, unknown>).message === 'string'
    ? String((nested as Record<string, unknown>).message)
    : '';
}
