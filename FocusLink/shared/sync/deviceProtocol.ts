import type { FocusSegment, FocusSession, PauseEvent } from '../types';

export const DEVICE_SYNC_PROTOCOL_VERSION = 1 as const;
export const DEVICE_SYNC_ENTITY = 'focus_session_bundle' as const;
export const DEVICE_SYNC_MAX_PUSH = 200;
export const DEVICE_SYNC_MAX_PULL = 500;
export const DEVICE_SYNC_MAX_BODY_BYTES = 1024 * 1024;
export const DEVICE_SYNC_MAX_BUNDLE_BYTES = 512 * 1024;
export const DEVICE_SYNC_MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
const DEVICE_SYNC_MAX_CHILDREN = 5_000;
const DEVICE_SYNC_MAX_TITLE_LENGTH = 1_000;
const DEVICE_SYNC_MAX_NOTE_LENGTH = 20_000;
const BUNDLE_KEYS = new Set(['session', 'segments', 'pauses']);
const SESSION_KEYS = new Set([
  'id',
  'title',
  'status',
  'startedAt',
  'endedAt',
  'activeElapsedMs',
  'pauseElapsedMs',
  'wallElapsedMs',
  'defaultTaskId',
  'defaultTaskSource',
  'defaultTaskTitle',
  'note',
  'createdAt',
  'updatedAt',
]);
const SEGMENT_KEYS = new Set([
  'id',
  'sessionId',
  'taskId',
  'taskSource',
  'title',
  'startedAt',
  'endedAt',
  'activeElapsedMs',
  'note',
  'tomatodoSubject',
  'createdAt',
  'updatedAt',
]);
const PAUSE_KEYS = new Set([
  'id',
  'sessionId',
  'segmentId',
  'pauseStartedAt',
  'pauseEndedAt',
  'durationMs',
  'reason',
  'createdAt',
  'updatedAt',
]);

export interface DeviceSyncSessionBundle {
  session: FocusSession;
  /** Provider-local cloud ids are deliberately excluded from cross-device data. */
  segments: Array<Omit<FocusSegment, 'cloudFocusId'>>;
  pauses: PauseEvent[];
}

export interface DeviceSyncMutation {
  opId: string;
  entity: typeof DEVICE_SYNC_ENTITY;
  entityId: string;
  kind: 'put' | 'delete';
  baseRevision: number;
  payload: DeviceSyncSessionBundle | null;
}

export interface DeviceSyncRequest {
  protocolVersion: typeof DEVICE_SYNC_PROTOCOL_VERSION;
  deviceId: string;
  cursor: string | null;
  mutations: DeviceSyncMutation[];
  pullLimit: number;
}

export type DeviceSyncAckStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface DeviceSyncAck {
  opId: string;
  entityId: string;
  status: DeviceSyncAckStatus;
  revision: number | null;
  errorCode: string | null;
}

export interface DeviceSyncChange {
  changeSeq: number;
  deviceId: string;
  entity: typeof DEVICE_SYNC_ENTITY;
  entityId: string;
  revision: number;
  deleted: boolean;
  payload: DeviceSyncSessionBundle | null;
}

export interface DeviceSyncResponse {
  protocolVersion: typeof DEVICE_SYNC_PROTOCOL_VERSION;
  acks: DeviceSyncAck[];
  changes: DeviceSyncChange[];
  nextCursor: string;
  hasMore: boolean;
  serverTime: number;
}

export interface DeviceSyncValidationResult {
  ok: boolean;
  error?: string;
}

export function toDeviceSyncBundle(
  session: FocusSession,
  segments: readonly FocusSegment[],
  pauses: readonly PauseEvent[],
): DeviceSyncSessionBundle {
  const portableSession: FocusSession = { ...session };
  delete portableSession.segmentCount;
  delete portableSession.linkedSegmentCount;
  delete portableSession.ticktickLinkedSegmentCount;
  return {
    session: portableSession,
    segments: segments.map(({ cloudFocusId: _providerLocalId, ...segment }) => segment),
    pauses: pauses.map((pause) => ({ ...pause })),
  };
}

export function validateDeviceSyncBundle(value: unknown): DeviceSyncValidationResult {
  if (!isRecord(value)) return invalid('bundle 必须是对象');
  if (!hasOnlyKeys(value, BUNDLE_KEYS)) return invalid('bundle 包含未授权字段');
  if (!isRecord(value.session)) return invalid('缺少 session');
  if (!Array.isArray(value.segments) || !Array.isArray(value.pauses)) {
    return invalid('segments/pauses 必须是数组');
  }
  if (
    value.segments.length > DEVICE_SYNC_MAX_CHILDREN ||
    value.pauses.length > DEVICE_SYNC_MAX_CHILDREN
  ) {
    return invalid('会话明细数量超出上限');
  }
  try {
    if (deviceSyncJsonByteLength(value) > DEVICE_SYNC_MAX_BUNDLE_BYTES) {
      return invalid('会话包大小超出上限');
    }
  } catch {
    return invalid('会话包无法序列化');
  }

  const session = value.session;
  if (!hasOnlyKeys(session, SESSION_KEYS)) return invalid('session 包含未授权字段');
  if (!isId(session.id)) return invalid('session.id 无效');
  if (session.status !== 'finished' && session.status !== 'aborted') {
    return invalid('只允许同步已结束会话');
  }
  if (!isTimestamp(session.startedAt) || !isTimestamp(session.endedAt)) {
    return invalid('session 时间无效');
  }
  if (session.endedAt < session.startedAt) return invalid('session 结束时间早于开始时间');
  if (!isNonNegative(session.activeElapsedMs)) return invalid('session 专注时长无效');
  if (!isNonNegative(session.pauseElapsedMs)) return invalid('session 暂停时长无效');
  if (!isNonNegative(session.wallElapsedMs)) return invalid('session 总时长无效');
  if (!isTimestamp(session.createdAt) || !isTimestamp(session.updatedAt)) {
    return invalid('session 元数据时间无效');
  }
  if (!isNullableText(session.title, DEVICE_SYNC_MAX_TITLE_LENGTH)) {
    return invalid('session.title 无效');
  }
  if (!isNullableText(session.note, DEVICE_SYNC_MAX_NOTE_LENGTH)) {
    return invalid('session.note 无效');
  }
  if (!isNullableId(session.defaultTaskId) || !isTaskSource(session.defaultTaskSource)) {
    return invalid('session 默认任务关联无效');
  }
  if (!isNullableText(session.defaultTaskTitle, DEVICE_SYNC_MAX_TITLE_LENGTH)) {
    return invalid('session 默认任务标题无效');
  }
  if ((session.defaultTaskId === null) !== (session.defaultTaskSource === null)) {
    return invalid('session 默认任务 id/source 必须同时存在或同时为空');
  }

  const segmentIds = new Set<string>();
  for (const item of value.segments) {
    if (!isRecord(item) || !isId(item.id)) return invalid('segment.id 无效');
    if (!hasOnlyKeys(item, SEGMENT_KEYS)) return invalid('segment 包含未授权字段');
    if (segmentIds.has(item.id)) return invalid('segment.id 重复');
    segmentIds.add(item.id);
    if (item.sessionId !== session.id) return invalid('segment 不属于当前 session');
    if (!isTimestamp(item.startedAt)) return invalid('segment 开始时间无效');
    if (!isTimestamp(item.endedAt)) return invalid('已结束会话不能包含未结束 segment');
    if (item.endedAt < item.startedAt) {
      return invalid('segment 结束时间早于开始时间');
    }
    if (item.startedAt < session.startedAt || item.endedAt > session.endedAt) {
      return invalid('segment 时间超出当前 session');
    }
    if (!isNonNegative(item.activeElapsedMs)) return invalid('segment 专注时长无效');
    if (!isTimestamp(item.createdAt) || !isTimestamp(item.updatedAt)) {
      return invalid('segment 元数据时间无效');
    }
    if (!isNullableId(item.taskId) || !isTaskSource(item.taskSource)) {
      return invalid('segment 任务关联无效');
    }
    if ((item.taskId === null) !== (item.taskSource === null)) {
      return invalid('segment task id/source 必须同时存在或同时为空');
    }
    if (!isNullableText(item.title, DEVICE_SYNC_MAX_TITLE_LENGTH)) {
      return invalid('segment.title 无效');
    }
    if (!isNullableText(item.note, DEVICE_SYNC_MAX_NOTE_LENGTH)) {
      return invalid('segment.note 无效');
    }
    if (!isTomatodoSubject(item.tomatodoSubject)) return invalid('segment 学科无效');
  }

  const pauseIds = new Set<string>();
  for (const item of value.pauses) {
    if (!isRecord(item) || !isId(item.id)) return invalid('pause.id 无效');
    if (!hasOnlyKeys(item, PAUSE_KEYS)) return invalid('pause 包含未授权字段');
    if (pauseIds.has(item.id)) return invalid('pause.id 重复');
    pauseIds.add(item.id);
    if (item.sessionId !== session.id) return invalid('pause 不属于当前 session');
    if (item.segmentId !== null && (!isId(item.segmentId) || !segmentIds.has(item.segmentId))) {
      return invalid('pause 引用了不存在的 segment');
    }
    if (!isTimestamp(item.pauseStartedAt)) return invalid('pause 开始时间无效');
    if (!isTimestamp(item.pauseEndedAt)) return invalid('已结束会话不能包含未结束 pause');
    if (item.pauseEndedAt < item.pauseStartedAt) {
      return invalid('pause 结束时间早于开始时间');
    }
    if (item.pauseStartedAt < session.startedAt || item.pauseEndedAt > session.endedAt) {
      return invalid('pause 时间超出当前 session');
    }
    if (!isNonNegative(item.durationMs)) return invalid('pause 时长无效');
    if (!isTimestamp(item.createdAt) || !isTimestamp(item.updatedAt)) {
      return invalid('pause 元数据时间无效');
    }
    if (!isNullableText(item.reason, DEVICE_SYNC_MAX_TITLE_LENGTH)) {
      return invalid('pause.reason 无效');
    }
  }

  return { ok: true };
}

/** Deterministic JSON used for idempotency and local change detection. */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(',')}}`;
}

/** Stable non-cryptographic fingerprint. Authentication is handled separately by the transport. */
export function fingerprintDeviceSyncValue(value: unknown): string {
  const input = canonicalStringify(value);
  let first = 0xcbf29ce484222325n;
  let second = 0x84222325cbf29cen;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    const code = BigInt(input.charCodeAt(index));
    first = ((first ^ code) * prime) & mask;
    second = ((second ^ (code + BigInt(index & 0xff))) * prime) & mask;
  }
  return `${first.toString(16).padStart(16, '0')}${second.toString(16).padStart(16, '0')}`;
}

export function deviceSyncJsonByteLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('value is not JSON serializable');
  return new TextEncoder().encode(serialized).byteLength;
}

export function makeDeviceSyncOperationId(
  entityId: string,
  kind: DeviceSyncMutation['kind'],
  baseRevision: number,
  payload: DeviceSyncSessionBundle | null,
): string {
  return `op_${kind}_${fingerprintDeviceSyncValue({ baseRevision, entityId, payload })}`;
}

export function normalizeDeviceSyncEndpoint(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('请填写跨设备同步服务地址');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('跨设备同步服务地址无效');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('生产服务必须使用 HTTPS；HTTP 仅允许 localhost/127.0.0.1 测试');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function isNullableId(value: unknown): value is string | null {
  return value === null || isId(value);
}

function isNullableText(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maxLength);
}

function isTaskSource(value: unknown): value is 'local' | 'ticktick' | null {
  return value === null || value === 'local' || value === 'ticktick';
}

function isTomatodoSubject(value: unknown): boolean {
  return (
    value === null ||
    value === '语文' ||
    value === '数学' ||
    value === '英语' ||
    value === '物理' ||
    value === '化学' ||
    value === '生物' ||
    value === '学习'
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= DEVICE_SYNC_MAX_TIMESTAMP_MS
  );
}

function isNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function invalid(error: string): DeviceSyncValidationResult {
  return { ok: false, error };
}
