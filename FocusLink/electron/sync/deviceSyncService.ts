import crypto from 'node:crypto';
import {
  fingerprintDeviceSyncValue,
  makeDeviceSyncOperationId,
  normalizeDeviceSyncEndpoint,
  toDeviceSyncBundle,
  validateDeviceSyncBundle,
  DEVICE_SYNC_ENTITY,
  DEVICE_SYNC_MAX_PULL,
  DEVICE_SYNC_MAX_PUSH,
  DEVICE_SYNC_MAX_TIMESTAMP_MS,
  DEVICE_SYNC_PROTOCOL_VERSION,
  type DeviceSyncChange,
  type DeviceSyncMutation,
  type DeviceSyncRequest,
  type DeviceSyncResponse,
  type DeviceSyncSessionBundle,
} from '@shared/sync/deviceProtocol';
import { readDeviceSyncJsonResponse, readDeviceSyncResponseText } from '@shared/sync/httpTransport';
import type {
  DeviceSyncConfigureInput,
  DeviceSyncRunResult,
  DeviceSyncStatus,
} from '@shared/ipc/api';
import {
  getSession,
  getMeta,
  insertDeviceSyncBundleIfMissing,
  listFinishedSessionsForDeviceSync,
  listPauses,
  listSegments,
  setMeta,
} from '../db/index.js';
import { getSettings, updateSettings } from '../settingsStore.js';
import { logger } from '../logger.js';
import {
  getDeviceSyncToken,
  hasDeviceSyncToken,
  setDeviceSyncToken,
} from './deviceSyncCredentials.js';
import { makeDeviceSyncConnectionScope, packDeviceSyncMutations } from './deviceSyncPolicy.js';

const META_DEVICE_ID = 'deviceSync.deviceIdV1';
const META_CHECKPOINT_PREFIX = 'deviceSync.checkpointV2';
const META_LAST_SYNC_AT_PREFIX = 'deviceSync.lastSyncAtV2';
const META_LAST_ERROR_PREFIX = 'deviceSync.lastErrorV2';
const REQUEST_TIMEOUT_MS = 15_000;

interface LocalEntityState {
  revision: number;
  fingerprint: string;
}

type LocalEntityStateMap = Record<string, LocalEntityState>;

type LocalConflictKind =
  | 'revision_conflict'
  | 'rejected'
  | 'remote_change'
  | 'remote_delete'
  | 'invalid_local'
  | 'invalid_remote';

interface LocalConflictState {
  kind: LocalConflictKind;
  localFingerprint: string | null;
  remoteRevision: number | null;
  remoteFingerprint: string | null;
  errorCode: string | null;
  detectedAt: number;
}

type LocalConflictStateMap = Record<string, LocalConflictState>;

interface DeviceSyncCheckpoint {
  version: 2;
  cursor: string | null;
  entities: LocalEntityStateMap;
  conflicts: LocalConflictStateMap;
}

interface PendingMutation {
  mutation: DeviceSyncMutation;
  bundle: DeviceSyncSessionBundle;
  fingerprint: string;
}

interface PendingCollection {
  pending: PendingMutation[];
  invalidLocal: number;
}

interface DeviceSyncConnection {
  endpoint: string;
  accessToken: string;
  scope: string;
}

export interface DeviceSyncRuntimeConnection {
  endpoint: string;
  accessToken: string;
  deviceId: string;
}

let liveTelemetry: Pick<DeviceSyncStatus, 'liveConnected' | 'liveRevision' | 'liveState'> = {
  liveConnected: false,
  liveRevision: null,
  liveState: 'disconnected',
};

class DeviceSyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceSyncHttpError';
  }
}

let inFlight: { scope: string | null; promise: Promise<DeviceSyncRunResult> } | null = null;

export function getDeviceSyncStatus(): DeviceSyncStatus {
  const settings = getSettings().deviceSync;
  const connection = resolveDeviceSyncConnection(settings.endpoint);
  const tokenConfigured = hasDeviceSyncToken();
  const checkpoint = connection ? readCheckpoint(connection.scope) : emptyCheckpoint();
  const unresolvedConflicts = Object.keys(checkpoint.conflicts).length;
  const storedError = connection ? getMeta(lastErrorMetaKey(connection.scope)) || null : null;
  return {
    enabled: settings.enabled,
    endpoint: settings.endpoint,
    autoSync: settings.autoSync,
    liveControlEnabled: settings.liveControlEnabled,
    ...liveTelemetry,
    configured: connection !== null,
    tokenConfigured,
    deviceId: getOrCreateDeviceId(),
    cursor: checkpoint.cursor,
    running: Boolean(connection && inFlight?.scope === connection.scope),
    lastSyncAt: connection
      ? parseOptionalNumber(getMeta(lastSyncAtMetaKey(connection.scope)))
      : null,
    lastError:
      storedError ??
      (unresolvedConflicts > 0 ? `存在 ${unresolvedConflicts} 个未解决的跨设备冲突` : null),
    unresolvedConflicts,
  };
}

export function configureDeviceSync(input: DeviceSyncConfigureInput): DeviceSyncStatus {
  if (!input || typeof input.endpoint !== 'string') {
    throw new Error('跨设备同步配置无效');
  }
  const endpoint = normalizeDeviceSyncEndpoint(input.endpoint);
  if (input.accessToken !== undefined) {
    setDeviceSyncToken(input.accessToken?.trim() || null);
  }
  updateSettings({
    deviceSync: {
      enabled: Boolean(input.enabled),
      endpoint,
      autoSync: Boolean(input.autoSync),
      liveControlEnabled: Boolean(input.liveControlEnabled),
    },
  });
  return getDeviceSyncStatus();
}

/** Main-process only: credentials are never exposed over IPC. */
export function getDeviceSyncRuntimeConnection(): DeviceSyncRuntimeConnection | null {
  const settings = getSettings().deviceSync;
  if (!settings.enabled || !settings.liveControlEnabled) return null;
  const endpoint = normalizeDeviceSyncEndpoint(settings.endpoint);
  const accessToken = getDeviceSyncToken();
  if (!accessToken) return null;
  return { endpoint, accessToken, deviceId: getOrCreateDeviceId() };
}

export function setDeviceSyncLiveTelemetry(
  telemetry: Pick<DeviceSyncStatus, 'liveConnected' | 'liveRevision' | 'liveState'>,
): void {
  liveTelemetry = telemetry;
}

export function runDeviceSync(): Promise<DeviceSyncRunResult> {
  const requestedScope =
    resolveDeviceSyncConnection(getSettings().deviceSync.endpoint)?.scope ?? null;
  if (inFlight) {
    if (inFlight.scope === requestedScope) return inFlight.promise;
    return Promise.reject(new Error('同步连接已变更，请等待当前连接同步结束后重试'));
  }
  const operation = runDeviceSyncInternal()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('deviceSync', 'sync failed', { error: message });
      throw error;
    })
    .finally(() => {
      if (inFlight?.promise === operation) inFlight = null;
    });
  inFlight = { scope: requestedScope, promise: operation };
  return operation;
}

/** Used by startup/finish hooks without turning a disabled feature into an error. */
export async function runAutomaticDeviceSync(): Promise<DeviceSyncRunResult | null> {
  const settings = getSettings().deviceSync;
  if (!settings.enabled || !settings.autoSync || !hasDeviceSyncToken()) return null;
  return runDeviceSync();
}

async function runDeviceSyncInternal(): Promise<DeviceSyncRunResult> {
  const settings = getSettings().deviceSync;
  if (!settings.enabled) throw new Error('请先启用 FocusLink 跨设备同步');
  const endpoint = normalizeDeviceSyncEndpoint(settings.endpoint);
  const accessToken = getDeviceSyncToken();
  if (!accessToken) throw new Error('请先配置跨设备同步访问令牌');

  const connection: DeviceSyncConnection = {
    endpoint,
    accessToken,
    scope: makeDeviceSyncConnectionScope(endpoint, accessToken),
  };
  try {
    try {
      return await runDeviceSyncAttempt(connection);
    } catch (error) {
      if (!(error instanceof DeviceSyncHttpError) || error.code !== 'invalid_cursor') throw error;
      logger.warn(
        'deviceSync',
        'server rejected checkpoint cursor; retrying from a clean checkpoint',
        {
          endpoint,
        },
      );
      clearCheckpoint(connection.scope);
      return await runDeviceSyncAttempt(connection);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setMeta(lastErrorMetaKey(connection.scope), message.slice(0, 1_000));
    throw error;
  }
}

async function runDeviceSyncAttempt(
  connection: DeviceSyncConnection,
): Promise<DeviceSyncRunResult> {
  const deviceId = getOrCreateDeviceId();
  const checkpoint = readCheckpoint(connection.scope);
  const entityState = checkpoint.entities;
  const conflictState = checkpoint.conflicts;
  let cursor = checkpoint.cursor;
  const collected = collectPendingMutations(entityState, conflictState);
  const pendingByOperation = new Map(collected.pending.map((item) => [item.mutation.opId, item]));
  const packed = packDeviceSyncMutations(
    deviceId,
    collected.pending.map((item) => item.mutation),
  );
  for (const mutation of packed.oversized) {
    const local = pendingByOperation.get(mutation.opId);
    conflictState[mutation.entityId] = makeConflict('invalid_local', {
      localFingerprint: local?.fingerprint ?? null,
      errorCode: 'request_body_too_large',
    });
    logger.warn('deviceSync', 'local session skipped because one mutation exceeds byte budget', {
      sessionId: mutation.entityId,
    });
  }
  if (collected.invalidLocal > 0 || packed.oversized.length > 0) {
    writeSyncCheckpoint(connection.scope, cursor, entityState, conflictState);
  }
  const batches = packed.batches;
  if (batches.length === 0) batches.push([]);

  const result: DeviceSyncRunResult = {
    pushed: 0,
    pulled: 0,
    imported: 0,
    duplicates: 0,
    conflicts: 0,
    rejected: collected.invalidLocal + packed.oversized.length,
    cursor: cursor ?? '0',
    unresolvedConflicts: 0,
  };

  for (const batch of batches) {
    let mutations = batch;
    let hasMore = true;
    let pullPages = 0;
    const latestPulledChanges = new Map<string, DeviceSyncChange>();
    while (hasMore) {
      pullPages += 1;
      if (pullPages > 100) throw new Error('同步服务分页数量异常');
      const requestCursor = cursor;
      const response = await postSync(connection.endpoint, connection.accessToken, {
        protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
        deviceId,
        cursor,
        mutations,
        pullLimit: DEVICE_SYNC_MAX_PULL,
      });
      mutations = [];
      result.pushed += response.acks.filter((ack) => ack.status === 'applied').length;
      result.duplicates += response.acks.filter((ack) => ack.status === 'duplicate').length;
      result.conflicts += response.acks.filter((ack) => ack.status === 'conflict').length;
      result.rejected += response.acks.filter((ack) => ack.status === 'rejected').length;

      for (const ack of response.acks) {
        const local = pendingByOperation.get(ack.opId);
        if (ack.status === 'conflict') {
          conflictState[ack.entityId] = makeConflict('revision_conflict', {
            localFingerprint: local?.fingerprint ?? null,
            remoteRevision: ack.revision,
            errorCode: ack.errorCode,
          });
          continue;
        }
        if (ack.status === 'rejected') {
          conflictState[ack.entityId] = makeConflict('rejected', {
            localFingerprint: local?.fingerprint ?? null,
            remoteRevision: ack.revision,
            errorCode: ack.errorCode,
          });
          continue;
        }
        if (ack.revision === null) continue;
        if (!local) continue;
        entityState[ack.entityId] = {
          revision: ack.revision,
          fingerprint: local.fingerprint,
        };
        delete conflictState[ack.entityId];
      }

      result.pulled += response.changes.length;
      for (const change of response.changes) latestPulledChanges.set(change.entityId, change);

      cursor = response.nextCursor;
      result.cursor = response.nextCursor;
      hasMore = response.hasMore;
      if (hasMore && response.nextCursor === requestCursor) {
        throw new Error('同步服务未推进分页游标');
      }
    }

    for (const change of coalesceLatestResponseChanges([...latestPulledChanges.values()])) {
      const applied = applyRemoteChange(change, entityState, conflictState);
      if (applied === 'imported') result.imported += 1;
      if (applied === 'conflict') result.conflicts += 1;
    }
    writeSyncCheckpoint(connection.scope, cursor, entityState, conflictState);
  }

  const now = Date.now();
  result.unresolvedConflicts = Object.keys(conflictState).length;
  setMeta(lastSyncAtMetaKey(connection.scope), String(now));
  if (result.unresolvedConflicts > 0) {
    setMeta(
      lastErrorMetaKey(connection.scope),
      `存在 ${result.unresolvedConflicts} 个未解决的跨设备冲突`,
    );
    logger.warn('deviceSync', 'sync completed with unresolved conflicts', result);
  } else {
    setMeta(lastErrorMetaKey(connection.scope), '');
    logger.info('deviceSync', 'sync completed', result);
  }
  return result;
}

function coalesceLatestResponseChanges(changes: readonly DeviceSyncChange[]): DeviceSyncChange[] {
  const latestByEntity = new Map<string, DeviceSyncChange>();
  for (const change of changes) latestByEntity.set(change.entityId, change);
  return [...latestByEntity.values()].sort((left, right) => left.changeSeq - right.changeSeq);
}

function collectPendingMutations(
  entityState: LocalEntityStateMap,
  conflictState: LocalConflictStateMap,
): PendingCollection {
  const pending: PendingMutation[] = [];
  let invalidLocal = 0;
  for (const session of listFinishedSessionsForDeviceSync()) {
    const bundle = toDeviceSyncBundle(session, listSegments(session.id), listPauses(session.id));
    const validation = validateDeviceSyncBundle(bundle);
    if (!validation.ok) {
      invalidLocal += 1;
      conflictState[session.id] = makeConflict('invalid_local', {
        localFingerprint: fingerprintDeviceSyncValue(bundle),
        errorCode: validation.error ?? 'invalid_bundle',
      });
      logger.warn('deviceSync', 'local session skipped because validation failed', {
        sessionId: session.id,
        error: validation.error,
      });
      continue;
    }
    const fingerprint = fingerprintDeviceSyncValue(bundle);
    if (conflictState[session.id]) continue;
    if (entityState[session.id]?.fingerprint === fingerprint) continue;
    const baseRevision = entityState[session.id]?.revision ?? 0;
    const mutation: DeviceSyncMutation = {
      opId: makeDeviceSyncOperationId(session.id, 'put', baseRevision, bundle),
      entity: DEVICE_SYNC_ENTITY,
      entityId: session.id,
      kind: 'put',
      baseRevision,
      payload: bundle,
    };
    pending.push({ mutation, bundle, fingerprint });
  }
  return { pending, invalidLocal };
}

function applyRemoteChange(
  change: DeviceSyncChange,
  entityState: LocalEntityStateMap,
  conflictState: LocalConflictStateMap,
): 'imported' | 'matched' | 'conflict' | 'ignored' {
  if (change.deleted || !change.payload) {
    // Deletion needs third-party cleanup semantics and is deliberately not part of the first slice.
    logger.warn('deviceSync', 'remote deletion requires a later explicit cleanup workflow', {
      sessionId: change.entityId,
      revision: change.revision,
    });
    const localSession = getSession(change.entityId);
    if (!localSession) {
      delete conflictState[change.entityId];
      return 'ignored';
    }
    const localFingerprint = fingerprintDeviceSyncValue(
      toDeviceSyncBundle(localSession, listSegments(localSession.id), listPauses(localSession.id)),
    );
    conflictState[change.entityId] = makeConflict('remote_delete', {
      localFingerprint,
      remoteRevision: change.revision,
    });
    return 'conflict';
  }
  const validation = validateDeviceSyncBundle(change.payload);
  if (!validation.ok) {
    conflictState[change.entityId] = makeConflict('invalid_remote', {
      remoteRevision: change.revision,
      errorCode: validation.error ?? 'invalid_bundle',
    });
    logger.warn('deviceSync', 'remote bundle rejected locally', {
      sessionId: change.entityId,
      error: validation.error,
    });
    return 'conflict';
  }
  const remoteFingerprint = fingerprintDeviceSyncValue(change.payload);
  const localSession = getSession(change.entityId);
  if (!localSession) {
    insertDeviceSyncBundleIfMissing(change.payload);
    entityState[change.entityId] = {
      revision: change.revision,
      fingerprint: remoteFingerprint,
    };
    delete conflictState[change.entityId];
    return 'imported';
  }

  const localBundle = toDeviceSyncBundle(
    localSession,
    listSegments(localSession.id),
    listPauses(localSession.id),
  );
  const localFingerprint = fingerprintDeviceSyncValue(localBundle);
  if (localFingerprint !== remoteFingerprint) {
    conflictState[change.entityId] = makeConflict('remote_change', {
      localFingerprint,
      remoteRevision: change.revision,
      remoteFingerprint,
    });
    logger.warn('deviceSync', 'local/remote session conflict left for explicit resolution', {
      sessionId: change.entityId,
      remoteRevision: change.revision,
    });
    return 'conflict';
  }
  entityState[change.entityId] = {
    revision: change.revision,
    fingerprint: remoteFingerprint,
  };
  delete conflictState[change.entityId];
  return 'matched';
}

async function postSync(
  endpoint: string,
  accessToken: string,
  request: DeviceSyncRequest,
): Promise<DeviceSyncResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint}/v1/sync`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await readDeviceSyncHttpError(response);
      throw new DeviceSyncHttpError(
        response.status,
        detail.code,
        `同步服务返回 ${response.status}${detail.message ? `：${detail.message}` : ''}`,
      );
    }
    const value = await readDeviceSyncJsonResponse(response);
    if (!isDeviceSyncResponse(value)) throw new Error('同步服务响应格式无效');
    if (!responseAcksMatchRequest(value, request)) {
      throw new Error('同步服务写入确认与本次请求不匹配');
    }
    return value;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('跨设备同步请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function responseAcksMatchRequest(
  response: DeviceSyncResponse,
  request: DeviceSyncRequest,
): boolean {
  if (response.acks.length !== request.mutations.length) return false;
  const expected = new Map(request.mutations.map((mutation) => [mutation.opId, mutation.entityId]));
  if (expected.size !== request.mutations.length) return false;
  const seen = new Set<string>();
  for (const ack of response.acks) {
    if (seen.has(ack.opId) || expected.get(ack.opId) !== ack.entityId) return false;
    seen.add(ack.opId);
  }
  return seen.size === expected.size;
}

async function readDeviceSyncHttpError(
  response: Response,
): Promise<{ code: string | null; message: string }> {
  const raw = (await readDeviceSyncResponseText(response, 16 * 1024)).slice(0, 500);
  if (!raw) return { code: null, message: '' };
  try {
    const value = JSON.parse(raw) as unknown;
    if (isRecord(value) && isRecord(value.error)) {
      return {
        code: typeof value.error.code === 'string' ? value.error.code.slice(0, 100) : null,
        message: typeof value.error.message === 'string' ? value.error.message.slice(0, 300) : '',
      };
    }
  } catch {
    // Fall back to a bounded plain-text diagnostic.
  }
  return { code: null, message: raw };
}

function isDeviceSyncResponse(value: unknown): value is DeviceSyncResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<DeviceSyncResponse>;
  if (!(
    response.protocolVersion === DEVICE_SYNC_PROTOCOL_VERSION &&
    Array.isArray(response.acks) &&
    response.acks.length <= DEVICE_SYNC_MAX_PUSH &&
    Array.isArray(response.changes) &&
    response.changes.length <= DEVICE_SYNC_MAX_PULL &&
    typeof response.nextCursor === 'string' &&
    response.nextCursor.length > 0 &&
    response.nextCursor.length <= 512 &&
    typeof response.hasMore === 'boolean' &&
    typeof response.serverTime === 'number' &&
    Number.isFinite(response.serverTime)
  )) {
    return false;
  }
  const validAcks = response.acks.every(
    (ack) =>
      ack &&
      typeof ack.opId === 'string' &&
      ack.opId.length > 0 &&
      ack.opId.length <= 200 &&
      typeof ack.entityId === 'string' &&
      ack.entityId.length > 0 &&
      ack.entityId.length <= 200 &&
      (ack.status === 'applied' ||
        ack.status === 'duplicate' ||
        ack.status === 'conflict' ||
        ack.status === 'rejected') &&
      (ack.revision === null || (Number.isSafeInteger(ack.revision) && ack.revision >= 0)) &&
      (ack.errorCode === null ||
        (typeof ack.errorCode === 'string' && ack.errorCode.length <= 1_000)),
  );
  if (!validAcks) return false;

  let previousSequence = -1;
  for (const change of response.changes) {
    if (
      !change ||
      change.entity !== DEVICE_SYNC_ENTITY ||
      typeof change.deviceId !== 'string' ||
      change.deviceId.length === 0 ||
      change.deviceId.length > 200 ||
      typeof change.entityId !== 'string' ||
      change.entityId.length === 0 ||
      change.entityId.length > 200 ||
      !Number.isSafeInteger(change.changeSeq) ||
      change.changeSeq <= previousSequence ||
      !Number.isSafeInteger(change.revision) ||
      change.revision < 1 ||
      typeof change.deleted !== 'boolean'
    ) {
      return false;
    }
    if (change.deleted ? change.payload !== null : !validateDeviceSyncBundle(change.payload).ok) {
      return false;
    }
    if (!change.deleted && change.payload?.session.id !== change.entityId) return false;
    previousSequence = change.changeSeq;
  }
  return true;
}

function getOrCreateDeviceId(): string {
  const existing = getMeta(META_DEVICE_ID);
  if (existing && isSyncId(existing)) return existing;
  const next = crypto.randomUUID();
  setMeta(META_DEVICE_ID, next);
  return next;
}

function resolveDeviceSyncConnection(rawEndpoint: string): DeviceSyncConnection | null {
  try {
    const accessToken = getDeviceSyncToken();
    if (!accessToken) return null;
    const endpoint = normalizeDeviceSyncEndpoint(rawEndpoint);
    return {
      endpoint,
      accessToken,
      scope: makeDeviceSyncConnectionScope(endpoint, accessToken),
    };
  } catch {
    return null;
  }
}

function checkpointMetaKey(scope: string): string {
  return `${META_CHECKPOINT_PREFIX}.${scope}`;
}

function lastSyncAtMetaKey(scope: string): string {
  return `${META_LAST_SYNC_AT_PREFIX}.${scope}`;
}

function lastErrorMetaKey(scope: string): string {
  return `${META_LAST_ERROR_PREFIX}.${scope}`;
}

function emptyCheckpoint(): DeviceSyncCheckpoint {
  return {
    version: 2,
    cursor: null,
    entities: Object.create(null) as LocalEntityStateMap,
    conflicts: Object.create(null) as LocalConflictStateMap,
  };
}

function readCheckpoint(scope: string): DeviceSyncCheckpoint {
  const raw = getMeta(checkpointMetaKey(scope));
  if (!raw) return emptyCheckpoint();
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== 2) throw new Error('unsupported version');
    if (
      value.cursor !== null &&
      (typeof value.cursor !== 'string' || value.cursor.length === 0 || value.cursor.length > 512)
    ) {
      throw new Error('invalid cursor');
    }
    if (!isRecord(value.entities) || !isRecord(value.conflicts)) {
      throw new Error('invalid checkpoint maps');
    }

    const checkpoint = emptyCheckpoint();
    checkpoint.cursor = value.cursor;
    for (const [entityId, state] of Object.entries(value.entities)) {
      if (
        !isSyncId(entityId) ||
        !isRecord(state) ||
        !Number.isSafeInteger(state.revision) ||
        Number(state.revision) < 0 ||
        typeof state.fingerprint !== 'string' ||
        state.fingerprint.length === 0 ||
        state.fingerprint.length > 200
      ) {
        throw new Error('invalid entity state');
      }
      checkpoint.entities[entityId] = {
        revision: Number(state.revision),
        fingerprint: state.fingerprint,
      };
    }
    for (const [entityId, state] of Object.entries(value.conflicts)) {
      if (!isSyncId(entityId) || !isStoredConflict(state)) {
        throw new Error('invalid conflict state');
      }
      checkpoint.conflicts[entityId] = { ...state };
    }
    return checkpoint;
  } catch (error) {
    logger.warn('deviceSync', 'connection checkpoint was invalid and has been reset', {
      error: error instanceof Error ? error.message : String(error),
    });
    return emptyCheckpoint();
  }
}

function writeSyncCheckpoint(
  scope: string,
  cursor: string | null,
  entities: LocalEntityStateMap,
  conflicts: LocalConflictStateMap,
): void {
  const checkpoint: DeviceSyncCheckpoint = { version: 2, cursor, entities, conflicts };
  // One app_meta value keeps cursor, revisions and the conflict inbox crash-atomic.
  setMeta(checkpointMetaKey(scope), JSON.stringify(checkpoint));
}

function clearCheckpoint(scope: string): void {
  setMeta(checkpointMetaKey(scope), JSON.stringify(emptyCheckpoint()));
  setMeta(lastSyncAtMetaKey(scope), '');
  setMeta(lastErrorMetaKey(scope), '');
}

function makeConflict(
  kind: LocalConflictKind,
  input: Partial<Omit<LocalConflictState, 'kind' | 'detectedAt'>> = {},
): LocalConflictState {
  return {
    kind,
    localFingerprint: input.localFingerprint ?? null,
    remoteRevision: input.remoteRevision ?? null,
    remoteFingerprint: input.remoteFingerprint ?? null,
    errorCode: input.errorCode ?? null,
    detectedAt: Date.now(),
  };
}

function isStoredConflict(value: unknown): value is LocalConflictState {
  if (!isRecord(value)) return false;
  const kinds: ReadonlySet<LocalConflictKind> = new Set([
    'revision_conflict',
    'rejected',
    'remote_change',
    'remote_delete',
    'invalid_local',
    'invalid_remote',
  ]);
  return (
    typeof value.kind === 'string' &&
    kinds.has(value.kind as LocalConflictKind) &&
    (value.localFingerprint === null ||
      (typeof value.localFingerprint === 'string' && value.localFingerprint.length <= 200)) &&
    (value.remoteRevision === null ||
      (Number.isSafeInteger(value.remoteRevision) && Number(value.remoteRevision) >= 0)) &&
    (value.remoteFingerprint === null ||
      (typeof value.remoteFingerprint === 'string' && value.remoteFingerprint.length <= 200)) &&
    (value.errorCode === null ||
      (typeof value.errorCode === 'string' && value.errorCode.length <= 1_000)) &&
    typeof value.detectedAt === 'number' &&
    Number.isFinite(value.detectedAt) &&
    value.detectedAt >= 0 &&
    value.detectedAt <= DEVICE_SYNC_MAX_TIMESTAMP_MS
  );
}

function isSyncId(value: string): boolean {
  return value.length > 0 && value.length <= 200;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOptionalNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
