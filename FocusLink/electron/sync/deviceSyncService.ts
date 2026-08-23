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
import type { Project, Task } from '@shared/types';
import {
  TASK_SNAPSHOT_PATH,
  TASK_SNAPSHOT_PROTOCOL_VERSION,
  isTaskSnapshotPublishedAtWithinFutureSkew,
  parseTaskSnapshotResponse,
  toTaskSnapshotPayload,
  validateTaskSnapshotPayload,
  type TaskSnapshotPayload,
  type TaskSnapshotPublishRequest,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';
import { parseDeviceToken } from '@shared/sync/v2Protocol';
import { FOCUSLINK_CANONICAL_SYNC_ORIGIN } from '@shared/sync/identityProtocol';
import { classifySyncV2Error, SyncV2ClientError } from '@shared/sync/v2ClientError';
import { migrateStoredDeviceSyncError } from '@shared/sync/deviceSyncStatusCode';
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
import { runRemoteWritebacks } from './remoteWritebackCoordinator.js';
import { getNextRemoteWritebackRetryAt } from './remoteWritebackStore.js';
import { logger } from '../logger.js';
import {
  getDeviceSyncToken,
  hasDeviceSyncToken,
  setDeviceSyncToken,
} from './deviceSyncCredentials.js';
import {
  makeDeviceSyncConnectionScope,
  makeDeviceSyncProviderScope,
  packDeviceSyncMutations,
} from './deviceSyncPolicy.js';
import { readDesktopV2Status } from './v2OutboxStore.js';

const META_DEVICE_ID = 'deviceSync.deviceIdV1';
const META_CHECKPOINT_PREFIX = 'deviceSync.checkpointV2';
const META_LAST_SYNC_AT_PREFIX = 'deviceSync.lastSyncAtV2';
const META_LAST_ERROR_PREFIX = 'deviceSync.lastErrorV2';
const META_PENDING_TASK_SNAPSHOT_PREFIX = 'deviceSync.pendingTaskSnapshotV1';
const REQUEST_TIMEOUT_MS = 15_000;

let remoteWritebackWakeup: {
  connectionScope: string;
  retryAt: number;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

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
  providerScope: string;
}

export interface DeviceSyncRuntimeConnection {
  endpoint: string;
  accessToken: string;
  deviceId: string;
  scope: string;
  providerScope: string;
  generation: number;
}

let liveTelemetry: Pick<DeviceSyncStatus, 'liveConnected' | 'liveRevision' | 'liveState'> = {
  liveConnected: false,
  liveRevision: null,
  liveState: 'disconnected',
};
let connectionGeneration = 0;

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
const taskPublishInFlight = new Map<
  string,
  { connection: DeviceSyncRuntimeConnection; promise: Promise<boolean> }
>();

export function getDeviceSyncStatus(): DeviceSyncStatus {
  const settings = getSettings().deviceSync;
  const connection = resolveDeviceSyncConnection(settings.endpoint);
  const tokenConfigured = hasDeviceSyncToken();
  let deviceId = getOrCreateDeviceId();
  if (connection) {
    try {
      deviceId = makeRuntimeConnection(connection.endpoint, connection.accessToken).deviceId;
    } catch {
      // Keep the legacy local id visible while Settings reports the invalid credential.
    }
  }
  const checkpoint = connection ? readCanonicalCheckpoint(connection.scope) : null;
  let unresolvedConflicts = 0;
  try {
    unresolvedConflicts = connection ? readDesktopV2Status(connection.scope).conflicts : 0;
  } catch {
    // Database initialization owns the first status call during startup.  A
    // later refresh reports the persisted canonical v2 state.
  }
  const storedErrorKey = connection ? lastErrorMetaKey(connection.scope) : null;
  const rawStoredError = storedErrorKey ? getMeta(storedErrorKey) || null : null;
  const storedError = migrateStoredDeviceSyncError(rawStoredError, (normalized) => {
    if (storedErrorKey) setMeta(storedErrorKey, normalized);
  });
  const accountMatch = connection?.accessToken.match(
    /^fl2_([A-Za-z0-9-]{6,80})_[A-Za-z0-9-]{6,80}_/,
  );
  return {
    signedIn: Boolean(accountMatch),
    accountId: accountMatch?.[1] ?? null,
    accountLabel: accountMatch ? 'Poyi' : null,
    enabled: settings.enabled,
    endpoint: connection?.endpoint ?? FOCUSLINK_CANONICAL_SYNC_ORIGIN,
    autoSync: settings.autoSync,
    liveControlEnabled: settings.liveControlEnabled,
    ...liveTelemetry,
    configured: connection !== null,
    tokenConfigured,
    deviceId,
    cursor: checkpoint?.cursor ?? null,
    running: Boolean(connection && inFlight?.scope === connection.scope),
    lastSyncAt: connection
      ? parseOptionalNumber(getMeta(lastSyncAtMetaKey(connection.scope)))
      : null,
    lastError: storedError ?? (unresolvedConflicts > 0 ? 'conflict_present' : null),
    unresolvedConflicts,
  };
}

export function configureDeviceSync(input: DeviceSyncConfigureInput): DeviceSyncStatus {
  if (!input || typeof input.endpoint !== 'string') {
    throw new Error('跨设备同步配置无效');
  }
  const endpoint = normalizeDeviceSyncEndpoint(input.endpoint);
  invalidateDeviceSyncConnection();
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
  try {
    return makeRuntimeConnection(endpoint, accessToken);
  } catch (error) {
    logger.warn('liveFocus', 'live connection credential is not canonical', {
      error: error instanceof Error ? error : String(error),
    });
    return null;
  }
}

/** Invalidate responses captured under an old token/endpoint before rotating local credentials. */
export function invalidateDeviceSyncConnection(): void {
  connectionGeneration += 1;
}

export function isDeviceSyncConnectionCurrent(connection: DeviceSyncRuntimeConnection): boolean {
  if (connection.generation !== connectionGeneration) return false;
  const current = resolveDeviceSyncConnection(getSettings().deviceSync.endpoint);
  return Boolean(
    current &&
    current.scope === connection.scope &&
    current.endpoint === connection.endpoint &&
    current.accessToken === connection.accessToken,
  );
}

export function assertDeviceSyncConnectionCurrent(connection: DeviceSyncRuntimeConnection): void {
  if (!isDeviceSyncConnectionCurrent(connection)) {
    throw new SyncV2ClientError('aborted', '同步连接已变更，旧响应已丢弃');
  }
}

/** Main-process Sync v2 transport; unlike live control it only requires data sync to be enabled. */
export function getDeviceSyncDataConnection(): DeviceSyncRuntimeConnection | null {
  const settings = getSettings().deviceSync;
  if (!settings.enabled) return null;
  const endpoint = normalizeDeviceSyncEndpoint(settings.endpoint);
  const accessToken = getDeviceSyncToken();
  if (!accessToken) return null;
  return makeRuntimeConnection(endpoint, accessToken);
}

/**
 * Provider write-back is local durable work, but its records remain tied to the canonical
 * connection that imported them.  Do not let a later account/token switch replay an old queue
 * through the current dida or TomaToDo configuration.
 */
function scheduleRemoteWritebackRecovery(connectionScope: string): void {
  let retryAt: number | null;
  try {
    retryAt = getNextRemoteWritebackRetryAt(connectionScope);
  } catch (error) {
    logger.warn('remoteWriteback', 'failed to inspect durable retry queue', {
      connectionScope,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (retryAt === null) {
    if (remoteWritebackWakeup?.connectionScope === connectionScope) {
      clearTimeout(remoteWritebackWakeup.timer);
      remoteWritebackWakeup = null;
    }
    return;
  }
  // A queue carries the account/token scope that created it. A switched or removed credential must
  // leave the old durable row untouched instead of replaying it through a different account.
  if (
    resolveDeviceSyncConnection(getSettings().deviceSync.endpoint)?.providerScope !==
    connectionScope
  ) {
    return;
  }
  if (
    remoteWritebackWakeup?.connectionScope === connectionScope &&
    remoteWritebackWakeup.retryAt <= retryAt
  ) {
    return;
  }
  if (remoteWritebackWakeup) clearTimeout(remoteWritebackWakeup.timer);
  const delayMs = Math.max(1_000, retryAt - Date.now());
  const timer = setTimeout(() => {
    remoteWritebackWakeup = null;
    if (
      resolveDeviceSyncConnection(getSettings().deviceSync.endpoint)?.providerScope !==
      connectionScope
    ) {
      return;
    }
    void drainRemoteWritebacks(connectionScope, 'scheduled provider delivery');
  }, delayMs);
  timer.unref?.();
  remoteWritebackWakeup = { connectionScope, retryAt, timer };
}

async function drainRemoteWritebacks(
  connectionScope: string | null,
  reason: string,
): Promise<void> {
  if (!connectionScope) return;
  try {
    const writeback = await runRemoteWritebacks(connectionScope);
    if (writeback.processed > 0) {
      logger.info('remoteWriteback', reason, { connectionScope, ...writeback });
    }
  } catch (error) {
    // A third-party retry queue must never make the canonical ledger sync unavailable. The item
    // remains durable and the next startup/periodic pass will claim it again.
    logger.warn('remoteWriteback', 'provider delivery coordinator failed', {
      connectionScope,
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    scheduleRemoteWritebackRecovery(connectionScope);
  }
}

function makeRuntimeConnection(endpoint: string, accessToken: string): DeviceSyncRuntimeConnection {
  const routed = parseDeviceToken(accessToken);
  const effectiveEndpoint = routeDeviceSyncEndpoint(endpoint, accessToken);
  return {
    endpoint: effectiveEndpoint,
    accessToken,
    deviceId: routed ? `device-${routed.devicePublicId}` : getOrCreateDeviceId(),
    scope: makeDeviceSyncConnectionScope(effectiveEndpoint, accessToken),
    providerScope: makeDeviceSyncProviderScope(effectiveEndpoint, accessToken),
    generation: connectionGeneration,
  };
}

export function setDeviceSyncLiveTelemetry(
  telemetry: Pick<DeviceSyncStatus, 'liveConnected' | 'liveRevision' | 'liveState'>,
): void {
  liveTelemetry = telemetry;
}

export function runDeviceSync(): Promise<DeviceSyncRunResult> {
  const requestedConnection = resolveDeviceSyncConnection(getSettings().deviceSync.endpoint);
  const requestedScope = requestedConnection?.scope ?? null;
  const providerScope = requestedConnection?.providerScope ?? null;
  if (inFlight) {
    if (inFlight.scope === requestedScope) return inFlight.promise;
    return Promise.reject(new Error('同步连接已变更，请等待当前连接同步结束后重试'));
  }
  const operation = import('./deviceSyncV2Service.js')
    .then(async ({ runDesktopSyncV2 }) => {
      // Drain imports from a previous successful pull before doing network I/O. This keeps
      // provider recovery alive when the sync endpoint is temporarily unavailable (for example
      // an HTTP 503) and avoids coupling local retries to a fresh cloud exchange. It is
      // deliberately non-blocking: third-party provider latency must not hold the Sync v2 lease.
      void drainRemoteWritebacks(providerScope, 'pre-sync provider delivery');
      const result = await runDesktopSyncV2();
      if (!result) throw new Error('请先启用并配置 canonical Sync v2');
      // Newly materialized remote sessions are now committed, so their external side effects can
      // be consumed safely outside the SQLite projection transaction without delaying a successful
      // cloud exchange result.
      void drainRemoteWritebacks(providerScope, 'post-sync provider delivery');
      return result;
    })
    .catch((error) => {
      logger.warn('deviceSync', 'sync failed', { errorCode: classifySyncV2Error(error) });
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
  const connectionScope = resolveDeviceSyncConnection(settings.endpoint)?.providerScope ?? null;
  if (!settings.enabled || !settings.autoSync || !hasDeviceSyncToken()) {
    // A disabled automatic cloud pull must not strand a session that was already imported. Keep
    // retrying only while the same credential still identifies that connection scope.
    await drainRemoteWritebacks(connectionScope, 'automatic local provider recovery');
    return null;
  }
  const result = await runDeviceSync();
  await flushPendingTaskSnapshot();
  return result;
}

/** Publish the last task list successfully read by the PC. Task refresh remains usable offline. */
export async function publishDeviceTaskSnapshot(
  projects: readonly Project[],
  tasks: readonly Task[],
  refreshedAt: number,
): Promise<boolean> {
  const settings = getSettings().deviceSync;
  if (!settings?.enabled || !hasDeviceSyncToken()) return false;
  const connection = resolveTaskSnapshotConnection();
  if (!connection) return false;
  const snapshot = toTaskSnapshotPayload(projects, tasks, refreshedAt);
  setMeta(pendingTaskSnapshotMetaKey(connection.providerScope), JSON.stringify(snapshot));
  return flushPendingTaskSnapshot(connection);
}

async function flushPendingTaskSnapshot(
  requestedConnection?: DeviceSyncRuntimeConnection,
): Promise<boolean> {
  const connection = requestedConnection ?? resolveTaskSnapshotConnection();
  if (!connection || !isDeviceSyncConnectionCurrent(connection)) return false;

  const existing = taskPublishInFlight.get(connection.providerScope);
  if (existing) {
    if (
      existing.connection.scope === connection.scope &&
      existing.connection.generation === connection.generation
    ) {
      return existing.promise;
    }
    const retryWithCurrentConnection = async (): Promise<boolean> => {
      const current = resolveTaskSnapshotConnection();
      if (!current || current.providerScope !== connection.providerScope) return false;
      return flushPendingTaskSnapshot(current);
    };
    return existing.promise.then(retryWithCurrentConnection, retryWithCurrentConnection);
  }

  const operation = flushPendingTaskSnapshotInternal(connection).finally(() => {
    if (taskPublishInFlight.get(connection.providerScope)?.promise === operation) {
      taskPublishInFlight.delete(connection.providerScope);
    }
  });
  taskPublishInFlight.set(connection.providerScope, { connection, promise: operation });
  return operation;
}

/** Contract-test hook for retrying the current account's durable task snapshot. */
export function flushPendingTaskSnapshotForContractTest(): Promise<boolean> {
  return flushPendingTaskSnapshot();
}

async function flushPendingTaskSnapshotInternal(
  connection: DeviceSyncRuntimeConnection,
): Promise<boolean> {
  const metaKey = pendingTaskSnapshotMetaKey(connection.providerScope);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!isDeviceSyncConnectionCurrent(connection)) return false;
    const serialized = getMeta(metaKey);
    if (!serialized) return true;
    let snapshot: TaskSnapshotPayload;
    try {
      const parsed = JSON.parse(serialized) as unknown;
      if (!validateTaskSnapshotPayload(parsed)) throw new Error('invalid task snapshot');
      snapshot = parsed;
    } catch (error) {
      logger.warn('deviceSync', 'discarding invalid pending task snapshot', {
        providerScope: connection.providerScope,
        error: error instanceof Error ? error.message : String(error),
      });
      if (getMeta(metaKey) === serialized) setMeta(metaKey, '');
      return false;
    }
    const published = await postTaskSnapshot(connection, snapshot);
    if (!published) return false;
    if (!isDeviceSyncConnectionCurrent(connection)) return false;
    if (getMeta(metaKey) === serialized) {
      setMeta(metaKey, '');
      return true;
    }
  }
  return false;
}

function resolveTaskSnapshotConnection(): DeviceSyncRuntimeConnection | null {
  try {
    return getDeviceSyncDataConnection();
  } catch (error) {
    logger.warn('deviceSync', 'desktop task snapshot connection invalid', {
      error: error instanceof Error ? error : String(error),
    });
    return null;
  }
}

async function postTaskSnapshot(
  connection: DeviceSyncRuntimeConnection,
  snapshot: TaskSnapshotPayload,
  allowTimestampRecovery = true,
): Promise<boolean> {
  if (!isDeviceSyncConnectionCurrent(connection)) return false;
  const { endpoint, accessToken, deviceId } = connection;
  const request: TaskSnapshotPublishRequest = {
    protocolVersion: TASK_SNAPSHOT_PROTOCOL_VERSION,
    deviceId,
    snapshot,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${endpoint}${TASK_SNAPSHOT_PATH}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await readDeviceSyncHttpError(response);
      if (response.status === 409 && detail.code === 'stale_task_snapshot') {
        logger.info('deviceSync', 'discarded superseded desktop task snapshot', {
          providerScope: connection.providerScope,
          errorCode: detail.code,
        });
        return true;
      }
      if (response.status === 409 && detail.code === 'task_snapshot_conflict') {
        logger.warn('deviceSync', 'preserving conflicting desktop task snapshot', {
          providerScope: connection.providerScope,
          errorCode: detail.code,
        });
        return false;
      }
      if (
        response.status === 422 &&
        detail.code === 'task_snapshot_timestamp_too_far_ahead' &&
        allowTimestampRecovery
      ) {
        return recoverTaskSnapshotTimestamp(connection, snapshot);
      }
      throw new DeviceSyncHttpError(
        response.status,
        detail.code,
        `任务快照服务返回 ${response.status}${detail.message ? `：${detail.message}` : ''}`,
      );
    }
    const value = parseTaskSnapshotResponse(await readDeviceSyncJsonResponse(response));
    assertDeviceSyncConnectionCurrent(connection);
    if (!value) {
      throw new Error('任务快照服务返回了无效响应');
    }
    if (
      value.revision < 1 ||
      value.sourceDeviceId !== deviceId ||
      value.snapshot === null ||
      fingerprintDeviceSyncValue(value.snapshot) !== fingerprintDeviceSyncValue(snapshot)
    ) {
      throw new Error('任务快照服务未确认本次发布内容');
    }
    logger.info('deviceSync', 'desktop task snapshot published', {
      revision: value.revision,
      taskCount: request.snapshot.tasks.length,
    });
    return true;
  } catch (error) {
    logger.warn('deviceSync', 'desktop task snapshot publish failed', {
      error: isNetworkTransportError(error)
        ? `无法连接跨设备同步服务（${url}），请检查服务是否启动、地址或网络`
        : error instanceof Error
          ? error.message
          : String(error),
    });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function recoverTaskSnapshotTimestamp(
  connection: DeviceSyncRuntimeConnection,
  snapshot: TaskSnapshotPayload,
): Promise<boolean> {
  const cloudSnapshot = await readTrustedTaskSnapshot(connection);
  if (!cloudSnapshot) return false;
  const cloudPublishedAt = cloudSnapshot.snapshot?.publishedAt;
  const rebasedPublishedAt =
    cloudPublishedAt !== undefined &&
    isTaskSnapshotPublishedAtWithinFutureSkew(cloudPublishedAt, cloudSnapshot.serverTime)
      ? Math.max(cloudSnapshot.serverTime, cloudPublishedAt + 1)
      : cloudSnapshot.serverTime;
  if (
    !Number.isSafeInteger(rebasedPublishedAt) ||
    !isTaskSnapshotPublishedAtWithinFutureSkew(rebasedPublishedAt, cloudSnapshot.serverTime)
  ) {
    logger.warn('deviceSync', 'could not safely rebase desktop task snapshot timestamp', {
      providerScope: connection.providerScope,
      errorCode: 'task_snapshot_timestamp_too_far_ahead',
    });
    return false;
  }
  logger.info('deviceSync', 'rebasing desktop task snapshot timestamp from cloud server time', {
    providerScope: connection.providerScope,
    legacyCloudTimestamp:
      cloudPublishedAt !== undefined &&
      !isTaskSnapshotPublishedAtWithinFutureSkew(cloudPublishedAt, cloudSnapshot.serverTime),
  });
  return postTaskSnapshot(connection, { ...snapshot, publishedAt: rebasedPublishedAt }, false);
}

async function readTrustedTaskSnapshot(
  connection: DeviceSyncRuntimeConnection,
): Promise<TaskSnapshotResponse | null> {
  if (!isDeviceSyncConnectionCurrent(connection)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${connection.endpoint}${TASK_SNAPSHOT_PATH}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${connection.accessToken}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await readDeviceSyncHttpError(response);
      throw new DeviceSyncHttpError(
        response.status,
        detail.code,
        `任务快照服务返回 ${response.status}${detail.message ? `：${detail.message}` : ''}`,
      );
    }
    const value = parseTaskSnapshotResponse(await readDeviceSyncJsonResponse(response));
    assertDeviceSyncConnectionCurrent(connection);
    if (!value) throw new Error('任务快照服务返回了无效响应');
    return value;
  } catch (error) {
    logger.warn('deviceSync', 'could not read cloud task snapshot for timestamp recovery', {
      providerScope: connection.providerScope,
      error: isNetworkTransportError(error)
        ? `无法连接跨设备同步服务（${url}），请检查服务是否启动、地址或网络`
        : error instanceof Error
          ? error.message
          : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Read the current account task register for first-party task reconciliation. */
export async function readDeviceTaskSnapshot(): Promise<TaskSnapshotResponse | null> {
  const connection = resolveTaskSnapshotConnection();
  return connection ? readTrustedTaskSnapshot(connection) : null;
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
    providerScope: makeDeviceSyncProviderScope(endpoint, accessToken),
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
    setMeta(lastErrorMetaKey(connection.scope), classifySyncV2Error(error));
    throw error;
  }
}

/**
 * Explicit contract-test shim for the retired v1 bundle protocol.  Production
 * startup, manual sync and automatic sync never call this path; keeping the
 * parser briefly available lets migration fixtures prove old responses are
 * rejected without reintroducing a fallback.
 */
export const runLegacyDeviceSyncForContractTest = runDeviceSyncInternal;

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
    setMeta(lastErrorMetaKey(connection.scope), 'conflict_present');
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
    const segments = listSegments(session.id);
    const pauses = listPauses(session.id);
    const segmentIds = new Set(segments.map((segment) => segment.id));
    const orphanPauseCount = pauses.filter(
      (pause) => pause.segmentId !== null && !segmentIds.has(pause.segmentId),
    ).length;
    if (orphanPauseCount > 0) {
      logger.warn('deviceSync', 'repairing orphan pause references for transport', {
        sessionId: session.id,
        orphanPauseCount,
      });
    }
    const bundle = toDeviceSyncBundle(session, segments, pauses);
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
  const url = `${endpoint}/v1/sync`;
  try {
    const response = await fetch(url, {
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
    if (isNetworkTransportError(error)) {
      throw new Error(`无法连接跨设备同步服务（${url}），请检查服务是否启动、地址或网络`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isNetworkTransportError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return error instanceof Error && /fetch failed|network error|连接被拒绝/i.test(error.message);
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
    const endpoint = routeDeviceSyncEndpoint(rawEndpoint, accessToken);
    return {
      endpoint,
      accessToken,
      scope: makeDeviceSyncConnectionScope(endpoint, accessToken),
      providerScope: makeDeviceSyncProviderScope(endpoint, accessToken),
    };
  } catch {
    return null;
  }
}

function routeDeviceSyncEndpoint(rawEndpoint: string, accessToken: string): string {
  const endpoint = normalizeDeviceSyncEndpoint(rawEndpoint);
  if (parseDeviceToken(accessToken)) return FOCUSLINK_CANONICAL_SYNC_ORIGIN;
  const host = new URL(endpoint).hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return endpoint;
  throw new Error('canonical Sync v2 只接受通过账号登录签发的 fl2 凭据');
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

function pendingTaskSnapshotMetaKey(providerScope: string): string {
  // Never fall back to the old unscoped key: its originating account cannot be recovered safely.
  return `${META_PENDING_TASK_SNAPSHOT_PREFIX}.${providerScope}`;
}

function readCanonicalCheckpoint(scope: string): { cursor: string | null } | null {
  const raw = getMeta(`syncV2.desktop.checkpointV2.${scope}`);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return null;
    if (value.cursor === null) return { cursor: null };
    if (typeof value.cursor === 'string' && /^c[0-9a-z]+$/.test(value.cursor)) {
      return { cursor: value.cursor };
    }
  } catch {
    // The canonical client will rebuild a malformed scoped checkpoint from c0.
  }
  return null;
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
