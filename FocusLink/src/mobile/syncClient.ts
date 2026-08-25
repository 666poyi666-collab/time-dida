import {
  normalizeDeviceSyncEndpoint,
  type DeviceSyncMutation,
  type DeviceSyncResponse,
} from '@shared/sync/deviceProtocol';
import {
  focusLinkSyncEndpointCandidates,
  isFocusLinkDeviceAccessToken,
  isAllowedFocusLinkDeviceConnection,
} from '@shared/sync/identityProtocol';
import {
  FOCUSLINK_PAIRING_CODE_PATTERN,
  normalizeFocusLinkPairingCode,
} from '@shared/sync/pairingProtocol';
import { readDeviceSyncJsonResponse } from '@shared/sync/httpTransport';
import type { DeviceSyncManagedDevice } from '@shared/ipc/api';
import {
  LIVE_FOCUS_COMMAND_PATH,
  LIVE_FOCUS_MAX_TITLE_LENGTH,
  LIVE_FOCUS_MAX_WAIT_MS,
  LIVE_FOCUS_PROTOCOL_VERSION,
  LIVE_FOCUS_SNAPSHOT_PATH,
  LIVE_FOCUS_WAIT_PATH,
  type LiveFocusCommand,
  type LiveFocusCommandAck,
  type LiveFocusCommandRequest,
  type LiveFocusCommandResponse,
  type LiveFocusSessionSnapshot,
  type LiveFocusSnapshot,
  type LiveFocusSnapshotResponse,
  type LiveFocusWaitResponse,
} from '@shared/sync/liveFocusProtocol';
import {
  TASK_SNAPSHOT_PROTOCOL_VERSION,
  TASK_SNAPSHOT_PATH,
  parseTaskSnapshotResponse,
  type TaskSnapshotPayload,
  type TaskSnapshotPublishRequest,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';

export interface PullPageInput {
  endpoint: string;
  token: string;
  deviceId: string;
  cursor: string | null;
  signal?: AbortSignal;
}

export interface PushPendingBundleInput {
  endpoint: string;
  token: string;
  deviceId: string;
  mutation: DeviceSyncMutation;
  signal?: AbortSignal;
}

export interface DeviceSyncPairingDevice {
  platform: 'android' | 'web';
  appVersion: string;
  displayName?: string;
  installationId?: string;
  deviceKind?: 'phone' | 'tablet' | 'watch' | 'desktop';
}

export class DeviceSyncPairingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'DeviceSyncPairingError';
  }
}

export async function createDeviceSyncPairingCode(input: {
  endpoint: string;
  token: string;
  signal?: AbortSignal;
}): Promise<{ code: string; expiresAt: number }> {
  const endpoint = normalizeDeviceSyncEndpoint(input.endpoint);
  requireMobileCloudEndpoint(endpoint, input.token);
  if (!isFocusLinkDeviceAccessToken(input.token)) {
    throw new DeviceSyncPairingError('authentication_failed', '当前设备尚未加入多端同步');
  }
  const response = await fetchWithTimeout(
    `${endpoint}/sync/v1/pair/offers`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        displayName: 'FocusLink 新设备',
        scopes: ['sync:read', 'sync:write', 'live:read', 'live:write'],
      }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    },
    input.signal,
    10_000,
  );
  const payload = await readDeviceSyncJsonResponse(response, 16 * 1024);
  if (!response.ok) {
    const code = pairingResponseErrorCode(payload);
    throw new DeviceSyncPairingError(code, pairingErrorMessage(code), response.status);
  }
  if (
    !isRecord(payload) ||
    typeof payload.code !== 'string' ||
    !FOCUSLINK_PAIRING_CODE_PATTERN.test(payload.code) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    Number(payload.expiresAt) <= Date.now() ||
    Number(payload.expiresAt) > Date.now() + 15 * 60_000
  ) {
    throw new DeviceSyncPairingError(
      'invalid_pairing_response',
      '配对服务响应无效',
      response.status,
    );
  }
  return { code: payload.code, expiresAt: Number(payload.expiresAt) };
}

export async function listDeviceSyncDevices(input: {
  endpoint: string;
  token: string;
  signal?: AbortSignal;
}): Promise<DeviceSyncManagedDevice[]> {
  const endpoint = normalizeDeviceSyncEndpoint(input.endpoint);
  requireMobileCloudEndpoint(endpoint, input.token);
  const response = await fetchWithTimeout(
    `${endpoint}/sync/v2/devices`,
    {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${input.token}` },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    },
    input.signal,
    10_000,
  );
  const payload = await readDeviceSyncJsonResponse(response, 64 * 1024);
  if (!response.ok)
    throw new DeviceSyncPairingError(
      'device_roster_unavailable',
      '设备列表暂不可用',
      response.status,
    );
  if (!isRecord(payload) || !Array.isArray(payload.devices)) {
    throw new DeviceSyncPairingError('invalid_device_roster', '设备列表响应无效', response.status);
  }
  return payload.devices.filter(isManagedDevice) as DeviceSyncManagedDevice[];
}

export async function revokeDeviceSyncDevice(input: {
  endpoint: string;
  token: string;
  deviceId: string;
  signal?: AbortSignal;
}): Promise<{ deviceId: string; revokedAt: number }> {
  const endpoint = normalizeDeviceSyncEndpoint(input.endpoint);
  requireMobileCloudEndpoint(endpoint, input.token);
  if (!/^device-[A-Za-z0-9-]{6,194}$/.test(input.deviceId)) {
    throw new DeviceSyncPairingError('invalid_device_id', '设备标识无效');
  }
  const response = await fetchWithTimeout(
    `${endpoint}/sync/v2/devices/${input.deviceId}/revoke`,
    {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${input.token}` },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    },
    input.signal,
    10_000,
  );
  const payload = await readDeviceSyncJsonResponse(response, 16 * 1024);
  if (
    !response.ok ||
    !isRecord(payload) ||
    payload.deviceId !== input.deviceId ||
    !Number.isSafeInteger(payload.revokedAt)
  ) {
    throw new DeviceSyncPairingError('device_revoke_failed', '设备删除失败', response.status);
  }
  return { deviceId: input.deviceId, revokedAt: Number(payload.revokedAt) };
}

export async function exchangeDeviceSyncPairingCode(input: {
  endpoint: string;
  code: string;
  device: DeviceSyncPairingDevice;
  signal?: AbortSignal;
}): Promise<{ accessToken: string; deviceId: string }> {
  const endpoint = normalizeDeviceSyncEndpoint(input.endpoint);
  requireMobileCloudEndpoint(endpoint);
  const code = normalizeFocusLinkPairingCode(input.code);
  const numeric = FOCUSLINK_PAIRING_CODE_PATTERN.test(code);
  const legacyNonce = /^[A-Za-z0-9_-]{32,160}$/.test(code);
  if (!numeric && !legacyNonce) {
    throw new DeviceSyncPairingError('invalid_pairing_code', '请输入 8 位数字配对码');
  }
  if (
    numeric &&
    (!input.device.installationId ||
      !/^[A-Za-z0-9._~-]{20,160}$/.test(input.device.installationId) ||
      !input.device.deviceKind ||
      !input.device.displayName)
  ) {
    throw new DeviceSyncPairingError('invalid_pairing_device', '当前设备资料不完整');
  }
  const body = numeric
    ? {
        code,
        device: {
          installationId: input.device.installationId,
          displayName: input.device.displayName,
          platform: input.device.platform,
          deviceKind: input.device.deviceKind,
          appVersion: input.device.appVersion,
        },
      }
    : {
        nonce: code,
        device: {
          platform: input.device.platform,
          appVersion: input.device.appVersion,
          ...(input.device.displayName ? { displayName: input.device.displayName } : {}),
        },
      };
  const response = await fetchWithTimeout(
    `${endpoint}/sync/v1/pair/exchange`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    input.signal,
    10_000,
  );
  const payload = await readDeviceSyncJsonResponse(response, 16 * 1024);
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
    const responseMessage =
      isRecord(error) && typeof error.message === 'string' ? error.message.toLowerCase() : '';
    const codeValue = pairingResponseErrorCode(payload);
    const stableCode =
      codeValue === 'pairing_failed' && /(expired|already used|过期|已使用)/i.test(responseMessage)
        ? 'pairing_expired'
        : codeValue;
    throw new DeviceSyncPairingError(
      stableCode,
      stableCode === 'pairing_expired' && legacyNonce
        ? 'pairing code expired or was already used'
        : pairingErrorMessage(stableCode),
      response.status,
    );
  }
  if (
    !isRecord(payload) ||
    typeof payload.accessToken !== 'string' ||
    payload.accessToken.length < 16 ||
    !isNonEmptyText(payload.deviceId, 200)
  ) {
    throw new DeviceSyncPairingError('invalid_pairing_response', '配对响应无效', response.status);
  }
  const tokenParts = /^fl2_[A-Za-z0-9-]{6,80}_([A-Za-z0-9-]{6,80})_/.exec(payload.accessToken);
  if (
    !isFocusLinkDeviceAccessToken(payload.accessToken) ||
    !tokenParts ||
    payload.deviceId !== `device-${tokenParts[1]}`
  ) {
    throw new DeviceSyncPairingError('invalid_pairing_response', '配对响应无效', response.status);
  }
  return { accessToken: payload.accessToken, deviceId: payload.deviceId };
}

function pairingResponseErrorCode(payload: unknown): string {
  if (!isRecord(payload)) return 'pairing_failed';
  if (typeof payload.error === 'string') return payload.error;
  if (typeof payload.code === 'string') return payload.code;
  return isRecord(payload.error) && typeof payload.error.code === 'string'
    ? payload.error.code
    : 'pairing_failed';
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

function pairingErrorMessage(code: string): string {
  switch (code) {
    case 'pairing_expired':
      return '配对码已过期或已使用';
    case 'pairing_binding_mismatch':
      return '配对码与当前设备不匹配';
    case 'pair_rate_limited':
      return '尝试次数过多，请稍后再试';
    case 'pairing_disabled_pending_e2e':
      return '配对服务暂不可用，请稍后再试';
    default:
      return '配对失败，请检查配对码后重试';
  }
}

export interface LiveFocusConnectionInput {
  endpoint: string;
  token: string;
  signal?: AbortSignal;
}

export interface WaitForLiveFocusInput extends LiveFocusConnectionInput {
  afterRevision: number;
  waitMs?: number;
}

export interface SendLiveFocusCommandInput extends LiveFocusConnectionInput {
  deviceId: string;
  command: LiveFocusCommand;
}

export class DeviceSyncRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'DeviceSyncRequestError';
  }
}

export type MobileLiveRequestErrorCode =
  | 'network_error'
  | 'timeout'
  | 'authentication_failed'
  | 'authorization_failed'
  | 'revision_mismatch'
  | 'service_unavailable'
  | 'request_rejected'
  | 'configuration_error'
  | 'contract_error';

/** A safe, structured failure boundary for the mobile live-control loop. */
export class MobileLiveRequestError extends Error {
  constructor(
    readonly code: MobileLiveRequestErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'MobileLiveRequestError';
  }
}

export interface MobileLiveRequestFailure {
  code: MobileLiveRequestErrorCode;
  message: string;
  retryable: boolean;
  status: number | null;
}

export function classifyMobileLiveRequestError(error: unknown): MobileLiveRequestFailure {
  if (error instanceof MobileLiveRequestError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      status: error.status,
    };
  }
  return {
    code: 'contract_error',
    message: '实时状态响应异常，请手动刷新后重试',
    retryable: false,
    status: null,
  };
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export async function pullDeviceSyncPage(input: PullPageInput): Promise<DeviceSyncResponse> {
  void input;
  throw new DeviceSyncRequestError('legacy Sync v1 数据入口已退休', 'legacy_route_retired', 410);
}

export async function pushPendingDeviceSyncBundle(
  input: PushPendingBundleInput,
): Promise<DeviceSyncResponse> {
  void input;
  throw new DeviceSyncRequestError('legacy Sync v1 数据入口已退休', 'legacy_route_retired', 410);
}

export async function fetchLiveFocusSnapshot(
  input: LiveFocusConnectionInput,
): Promise<LiveFocusSnapshotResponse> {
  const response = await liveFocusFetch(input, LIVE_FOCUS_SNAPSHOT_PATH);
  try {
    return parseLiveSnapshotResponse(await readDeviceSyncJsonResponse(response));
  } catch (error) {
    throwLiveContractError(error);
  }
}

export async function fetchTaskSnapshot(
  input: LiveFocusConnectionInput,
): Promise<TaskSnapshotResponse> {
  const response = await liveFocusFetch(input, TASK_SNAPSHOT_PATH);
  const value = parseTaskSnapshotResponse(await readDeviceSyncJsonResponse(response));
  if (!value) throw new Error('任务快照响应无效');
  return value;
}

export async function publishTaskSnapshot(
  input: LiveFocusConnectionInput & { deviceId: string; snapshot: TaskSnapshotPayload },
): Promise<TaskSnapshotResponse> {
  const request: TaskSnapshotPublishRequest = {
    protocolVersion: TASK_SNAPSHOT_PROTOCOL_VERSION,
    deviceId: input.deviceId,
    snapshot: input.snapshot,
  };
  const response = await liveFocusFetch(input, TASK_SNAPSHOT_PATH, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  const value = parseTaskSnapshotResponse(await readDeviceSyncJsonResponse(response));
  if (!value) throw new Error('任务快照写回响应无效');
  return value;
}

export async function waitForLiveFocusSnapshot(
  input: WaitForLiveFocusInput,
): Promise<LiveFocusWaitResponse> {
  if (!Number.isSafeInteger(input.afterRevision) || input.afterRevision < 0) {
    throw new Error('实时状态版本无效');
  }
  const waitMs = input.waitMs ?? LIVE_FOCUS_MAX_WAIT_MS;
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > LIVE_FOCUS_MAX_WAIT_MS) {
    throw new Error('实时等待时长无效');
  }
  const query = new URLSearchParams({
    afterRevision: String(input.afterRevision),
    waitMs: String(waitMs),
  });
  const response = await liveFocusFetch(
    input,
    `${LIVE_FOCUS_WAIT_PATH}?${query}`,
    {},
    waitMs + 10_000,
  );
  try {
    const value = await readDeviceSyncJsonResponse(response);
    if (!isRecord(value) || typeof value.changed !== 'boolean') {
      throw new Error('实时等待响应缺少 changed');
    }
    return { ...parseLiveSnapshotResponse(value), changed: value.changed };
  } catch (error) {
    throwLiveContractError(error);
  }
}

export async function sendLiveFocusCommand(
  input: SendLiveFocusCommandInput,
): Promise<LiveFocusCommandResponse> {
  const request: LiveFocusCommandRequest = {
    protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
    deviceId: input.deviceId,
    command: input.command,
  };
  const response = await liveFocusFetch(input, LIVE_FOCUS_COMMAND_PATH, {
    method: 'POST',
    body: JSON.stringify(request),
  });
  try {
    const value = await readDeviceSyncJsonResponse(response);
    if (!isRecord(value)) throw new Error('实时命令响应必须是对象');
    return { ...parseLiveSnapshotResponse(value), ack: parseLiveFocusAck(value.ack) };
  } catch (error) {
    throwLiveContractError(error);
  }
}

async function liveFocusFetch(
  input: LiveFocusConnectionInput,
  path: string,
  init: Pick<RequestInit, 'method' | 'body'> = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const endpoint = normalizeDeviceSyncEndpoint(input.endpoint);
  try {
    requireMobileCloudEndpoint(endpoint, input.token);
  } catch {
    throw new MobileLiveRequestError(
      'configuration_error',
      '移动端只允许连接 HTTPS 云端同步服务，请重新登录',
      false,
    );
  }
  const token = input.token.trim();
  if (!token) {
    throw new MobileLiveRequestError('configuration_error', '请先登录 FocusLink 账号', false);
  }

  let lastTransportError: unknown = null;
  for (const candidate of focusLinkSyncEndpointCandidates(endpoint)) {
    try {
      const response = await fetchWithTimeout(
        `${candidate}${path}`,
        {
          method: init.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: init.body,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
        },
        input.signal,
        timeoutMs,
      );

      if (!response.ok) {
        const detail = await readErrorResponse(response);
        if (response.status === 401 || response.status === 403) {
          throw new MobileLiveRequestError(
            response.status === 401 ? 'authentication_failed' : 'authorization_failed',
            response.status === 401 ? '登录凭据已失效，请重新登录' : '当前设备没有实时控制权限',
            false,
            response.status,
          );
        }
        if (response.status === 409) {
          throw new MobileLiveRequestError(
            'revision_mismatch',
            '云端实时版本已变化，正在重新确认',
            true,
            response.status,
          );
        }
        if (
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500
        ) {
          throw new MobileLiveRequestError(
            'service_unavailable',
            '实时同步服务暂时不可用',
            true,
            response.status,
          );
        }
        throw new MobileLiveRequestError(
          'request_rejected',
          detail.code === 'invalid_scope' ? '当前设备没有实时控制权限' : '实时同步请求被拒绝',
          false,
          response.status,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof MobileLiveRequestError) {
        // `retryable` controls a later live-loop attempt. Origin failover is narrower:
        // every HTTP response is authoritative and must not be replaced by an outcome
        // from the other hostname, including retryable 408/429/5xx responses.
        throw error;
      }
      lastTransportError = error;
    }
  }

  if (lastTransportError instanceof MobileLiveRequestError) {
    throw lastTransportError;
  }
  if (lastTransportError instanceof RequestTimeoutError) {
    throw new MobileLiveRequestError('timeout', '实时同步请求超时', true);
  }
  throw new MobileLiveRequestError(
    'network_error',
    navigator.onLine ? '暂时无法连接实时同步服务' : '当前离线',
    true,
  );
}

class RequestTimeoutError extends Error {}

function requireMobileCloudEndpoint(endpoint: string, accessToken = ''): void {
  const token = accessToken.trim();
  if (
    new URL(endpoint).protocol !== 'https:' ||
    (token.length > 0 && !isAllowedFocusLinkDeviceConnection(endpoint, token))
  ) {
    throw new Error('移动端只允许连接 HTTPS 云端同步服务');
  }
}

function throwLiveContractError(error: unknown): never {
  if (error instanceof MobileLiveRequestError) throw error;
  if (error instanceof DOMException && error.name === 'AbortError') throw error;
  throw new MobileLiveRequestError('contract_error', '实时状态响应异常，请手动刷新后重试', false);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (parentSignal?.aborted) throw error;
    if (timedOut) throw new RequestTimeoutError('request timed out');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

function parseLiveSnapshotResponse(value: unknown): LiveFocusSnapshotResponse {
  if (!isRecord(value)) throw new Error('实时状态响应必须是对象');
  if (value.protocolVersion !== LIVE_FOCUS_PROTOCOL_VERSION) {
    throw new Error(`实时协议版本不兼容：需要 v${LIVE_FOCUS_PROTOCOL_VERSION}`);
  }
  if (!isFiniteTimestamp(value.serverTime)) throw new Error('实时状态缺少有效 serverTime');
  return {
    protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
    snapshot: parseLiveFocusSnapshot(value.snapshot),
    serverTime: value.serverTime,
  };
}

function parseLiveFocusSnapshot(value: unknown): LiveFocusSnapshot {
  if (!isRecord(value)) throw new Error('实时 snapshot 必须是对象');
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    throw new Error('实时状态版本无效');
  }
  if (value.state !== 'idle' && value.state !== 'running' && value.state !== 'paused') {
    throw new Error('实时状态值无效');
  }
  if (value.state === 'idle') {
    if (value.session !== null) throw new Error('空闲状态不应携带活动会话');
    return { revision: Number(value.revision), state: 'idle', session: null };
  }
  const session = parseLiveFocusSession(value.session);
  if (session.state !== value.state) throw new Error('实时会话状态与 snapshot 不一致');
  return { revision: Number(value.revision), state: value.state, session };
}

function parseLiveFocusSession(value: unknown): LiveFocusSessionSnapshot {
  if (!isRecord(value)) throw new Error('实时状态缺少活动会话');
  if (!isNonEmptyText(value.id, 200)) throw new Error('实时会话 ID 无效');
  if (value.title !== null && !isText(value.title, LIVE_FOCUS_MAX_TITLE_LENGTH)) {
    throw new Error('实时会话标题无效');
  }
  if (value.state !== 'running' && value.state !== 'paused') {
    throw new Error('活动会话状态无效');
  }
  if (
    !isFiniteTimestamp(value.startedAt) ||
    !isFiniteTimestamp(value.updatedAt) ||
    !isNonNegativeNumber(value.activeElapsedMs) ||
    !isNonNegativeNumber(value.pauseElapsedMs) ||
    !isNonNegativeNumber(value.wallElapsedMs) ||
    !isNonEmptyText(value.lastCommandDeviceId, 200)
  ) {
    throw new Error('实时会话计时或元数据无效');
  }
  if (value.currentPauseStartedAt !== null && !isFiniteTimestamp(value.currentPauseStartedAt)) {
    throw new Error('实时暂停开始时间无效');
  }
  if (value.state === 'paused' && value.currentPauseStartedAt === null) {
    throw new Error('暂停状态缺少暂停开始时间');
  }
  if (value.state === 'running' && value.currentPauseStartedAt !== null) {
    throw new Error('运行状态不应保留当前暂停');
  }
  if (!Array.isArray(value.segments) || !Array.isArray(value.pauses)) {
    throw new Error('实时状态缺少时间线');
  }
  const segments = value.segments.map((segment) => {
    if (
      !isRecord(segment) ||
      !isNonEmptyText(segment.id, 200) ||
      !isFiniteTimestamp(segment.startedAt) ||
      (segment.endedAt !== null && !isFiniteTimestamp(segment.endedAt))
    ) {
      throw new Error('实时专注片段无效');
    }
    return { id: segment.id, startedAt: segment.startedAt, endedAt: segment.endedAt };
  });
  const pauses = value.pauses.map((pause) => {
    if (
      !isRecord(pause) ||
      !isNonEmptyText(pause.id, 200) ||
      !isNonEmptyText(pause.segmentId, 200) ||
      !isFiniteTimestamp(pause.startedAt) ||
      (pause.endedAt !== null && !isFiniteTimestamp(pause.endedAt))
    ) {
      throw new Error('实时暂停片段无效');
    }
    return {
      id: pause.id,
      segmentId: pause.segmentId,
      startedAt: pause.startedAt,
      endedAt: pause.endedAt,
    };
  });
  const task = value.task === null ? null : parseLiveTask(value.task);

  return {
    id: value.id,
    title: value.title,
    state: value.state,
    startedAt: value.startedAt,
    activeElapsedMs: value.activeElapsedMs,
    pauseElapsedMs: value.pauseElapsedMs,
    wallElapsedMs: value.wallElapsedMs,
    currentPauseStartedAt: value.currentPauseStartedAt,
    segments,
    pauses,
    task,
    updatedAt: value.updatedAt,
    lastCommandDeviceId: value.lastCommandDeviceId,
  };
}

function parseLiveTask(value: unknown): LiveFocusSessionSnapshot['task'] {
  if (
    !isRecord(value) ||
    !isNonEmptyText(value.taskId, 200) ||
    (value.taskSource !== 'local' && value.taskSource !== 'ticktick') ||
    (value.taskTitle !== null && !isText(value.taskTitle, LIVE_FOCUS_MAX_TITLE_LENGTH))
  ) {
    throw new Error('实时任务上下文无效');
  }
  return { taskId: value.taskId, taskSource: value.taskSource, taskTitle: value.taskTitle };
}

function parseLiveFocusAck(value: unknown): LiveFocusCommandAck {
  if (!isRecord(value)) throw new Error('实时命令响应缺少 ack');
  if (!isNonEmptyText(value.commandId, 200)) throw new Error('实时命令确认 ID 无效');
  if (
    value.status !== 'applied' &&
    value.status !== 'duplicate' &&
    value.status !== 'conflict' &&
    value.status !== 'rejected'
  ) {
    throw new Error('实时命令确认状态无效');
  }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    throw new Error('实时命令确认版本无效');
  }
  if (value.errorCode !== null && !isText(value.errorCode, 200)) {
    throw new Error('实时命令错误码无效');
  }
  if (value.completedEntityId !== null && !isNonEmptyText(value.completedEntityId, 200)) {
    throw new Error('实时完成会话 ID 无效');
  }
  return {
    commandId: value.commandId,
    status: value.status,
    revision: Number(value.revision),
    errorCode: value.errorCode,
    completedEntityId: value.completedEntityId,
  };
}

async function readErrorResponse(response: Response): Promise<{
  code: string | null;
  message: string;
}> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return { code: null, message: '' };
  try {
    const value = await readDeviceSyncJsonResponse(response);
    if (isRecord(value) && typeof value.error === 'string') {
      return { code: null, message: value.error.slice(0, 240) };
    }
    if (isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string') {
      return {
        code: typeof value.error.code === 'string' ? value.error.code.slice(0, 80) : null,
        message: value.error.message.slice(0, 240),
      };
    }
    if (isRecord(value) && typeof value.message === 'string') {
      return { code: null, message: value.message.slice(0, 240) };
    }
  } catch {
    // Keep the status-based fallback when an error body is malformed.
  }
  return { code: null, message: '' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isNonEmptyText(value: unknown, maxLength: number): value is string {
  return isText(value, maxLength) && value.length > 0;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
