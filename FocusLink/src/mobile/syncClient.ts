import {
  normalizeDeviceSyncEndpoint,
  type DeviceSyncMutation,
  type DeviceSyncResponse,
} from '@shared/sync/deviceProtocol';
import { readDeviceSyncJsonResponse } from '@shared/sync/httpTransport';
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
  TASK_SNAPSHOT_PATH,
  TASK_SNAPSHOT_PROTOCOL_VERSION,
  validateTaskSnapshotPayload,
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

export async function exchangeDeviceSyncPairingCode(input: {
  endpoint: string;
  code: string;
  device: { platform: 'android' | 'web'; appVersion: string; displayName?: string };
  signal?: AbortSignal;
}): Promise<{ accessToken: string; deviceId: string }> {
  const endpoint = normalizeDeviceSyncEndpoint(input.endpoint);
  requireMobileCloudEndpoint(endpoint);
  const code = input.code.trim();
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(code)) {
    throw new Error('请输入有效的一次性配对码');
  }
  const response = await fetchWithTimeout(
    `${endpoint}/sync/v1/pair/exchange`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: code, device: input.device }),
    },
    input.signal,
    10_000,
  );
  const payload = await readDeviceSyncJsonResponse(response, 16 * 1024);
  if (!response.ok) {
    const detail = isRecord(payload) && typeof payload.message === 'string' ? payload.message : '';
    throw new Error(detail || `配对服务返回 HTTP ${response.status}`);
  }
  if (
    !isRecord(payload) ||
    typeof payload.accessToken !== 'string' ||
    payload.accessToken.length < 16 ||
    !isNonEmptyText(payload.deviceId, 200)
  ) {
    throw new Error('配对响应无效');
  }
  return { accessToken: payload.accessToken, deviceId: payload.deviceId };
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
  return parseLiveSnapshotResponse(await readDeviceSyncJsonResponse(response));
}

export async function fetchTaskSnapshot(
  input: LiveFocusConnectionInput,
): Promise<TaskSnapshotResponse> {
  const response = await liveFocusFetch(input, TASK_SNAPSHOT_PATH);
  const value = await readDeviceSyncJsonResponse(response);
  if (
    !isRecord(value) ||
    value.protocolVersion !== TASK_SNAPSHOT_PROTOCOL_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !(value.sourceDeviceId === null || isNonEmptyText(value.sourceDeviceId, 200)) ||
    !(value.snapshot === null || validateTaskSnapshotPayload(value.snapshot)) ||
    !isFiniteTimestamp(value.serverTime)
  ) {
    throw new Error('任务快照响应无效');
  }
  return value as unknown as TaskSnapshotResponse;
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
  const value = await readDeviceSyncJsonResponse(response);
  if (!isRecord(value) || typeof value.changed !== 'boolean') {
    throw new Error('实时等待响应缺少 changed');
  }
  return { ...parseLiveSnapshotResponse(value), changed: value.changed };
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
  const value = await readDeviceSyncJsonResponse(response);
  if (!isRecord(value)) throw new Error('实时命令响应必须是对象');
  return { ...parseLiveSnapshotResponse(value), ack: parseLiveFocusAck(value.ack) };
}

async function liveFocusFetch(
  input: LiveFocusConnectionInput,
  path: string,
  init: Pick<RequestInit, 'method' | 'body'> = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const endpoint = normalizeDeviceSyncEndpoint(input.endpoint);
  requireMobileCloudEndpoint(endpoint);
  const token = input.token.trim();
  if (!token) throw new Error('请填写访问令牌');

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${endpoint}${path}`,
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
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof RequestTimeoutError) throw new Error('实时同步请求超时，正在重连');
    throw new Error(
      navigator.onLine ? unreachableMobileServiceMessage('实时同步服务') : '当前离线',
    );
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    if (response.status === 401 || response.status === 403) {
      throw new Error(detail || '访问令牌无效或无权控制专注');
    }
    throw new Error(detail || `实时同步服务返回 HTTP ${response.status}`);
  }
  return response;
}

class RequestTimeoutError extends Error {}

function unreachableMobileServiceMessage(service: string): string {
  return `无法连接${service}，请检查 HTTPS 地址、CORS 或网络`;
}

function requireMobileCloudEndpoint(endpoint: string): void {
  if (new URL(endpoint).protocol !== 'https:') {
    throw new Error('移动端只允许连接 HTTPS 云端同步服务');
  }
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

async function readErrorDetail(response: Response): Promise<string> {
  return (await readErrorResponse(response)).message;
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
