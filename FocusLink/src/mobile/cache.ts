import type { DeviceSyncChange, DeviceSyncSessionBundle } from '@shared/sync/deviceProtocol';
import {
  fingerprintDeviceSyncValue,
  makeDeviceSyncOperationId,
  validateDeviceSyncBundle,
} from '@shared/sync/deviceProtocol';
import {
  splitBundleForSyncV2,
  type SyncV2EntityType,
  type SyncV2OutboxItem,
  type SyncV2Payload,
} from '@shared/sync/v2Protocol';
import { isOfflineFocusRuntime, type OfflineFocusRuntime } from './offlineFocusRuntime';
import type { LiveFocusSnapshotLike } from './runtimeModel';
import {
  TASK_SNAPSHOT_PROTOCOL_VERSION,
  validateTaskSnapshotPayload,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';

const DATABASE_NAME = 'focuslink-mobile-preview';
const DATABASE_VERSION = 5;
const BUNDLE_STORE = 'bundles';
const META_STORE = 'meta';
const PENDING_STORE = 'pendingBundles';
const SESSION_SYNC_META_STORE = 'sessionSyncMeta';
const V2_OUTBOX_STORE = 'syncOutbox';
const V2_ENTITY_STATE_STORE = 'syncEntityState';
const V2_CONFLICT_STORE = 'syncConflicts';
const V2_OPERATION_HISTORY_STORE = 'syncOperationHistory';
const V2_DEVICE_STORE = 'syncDevices';

const CURSOR_KEY = 'cursor';
const LAST_SYNC_KEY = 'lastSyncAt';
const SERVER_TIME_KEY = 'serverTime';
const LIVE_FOCUS_KEY = 'liveFocusSnapshot';
const TASK_SNAPSHOT_KEY = 'taskSnapshot';
const OFFLINE_FOCUS_KEY = 'offlineFocusRuntime';

export interface CachedBundle {
  entityId: string;
  revision: number;
  changeSeq: number;
  sourceDeviceId: string;
  bundle: DeviceSyncSessionBundle;
}

export interface MobileCacheSnapshot {
  bundles: CachedBundle[];
  cursor: string | null;
  lastSyncAt: number | null;
  serverTime: number | null;
}

export type MobileAuthorityMode = 'cloud-live' | 'local-offline' | 'reconnecting' | 'forked-local';

export interface LocalSessionSyncMeta {
  sessionId: string;
  authorityMode: 'local-offline' | 'forked-local';
  originDeviceId: string;
  baseCloudRevision: number | null;
  suspectedRemoteSessionId: string | null;
  detectedRemoteRevision: number | null;
  detectedAt: number | null;
}

export type PendingDeviceSyncState = 'pending' | 'uploading' | 'retry' | 'conflict' | 'rejected';

export interface PendingDeviceSyncBundle {
  opId: string;
  entityId: string;
  bundle: DeviceSyncSessionBundle;
  state: PendingDeviceSyncState;
  attemptCount: number;
  nextRetryAt: number;
  lastErrorCode: string | null;
  /** Canonical device credential that owns this operation, null for pre-v2 migration records. */
  syncDeviceId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface MetaRecord {
  key: string;
  value: unknown;
}

interface CachedLiveFocusRecord {
  accountId: string;
  snapshot: LiveFocusSnapshotLike;
  cachedAt: number;
}

interface CachedTaskSnapshotRecord {
  accountId: string;
  snapshot: TaskSnapshotResponse;
  cachedAt: number;
}

export async function readMobileCache(): Promise<MobileCacheSnapshot> {
  const database = await openDatabase();
  const transaction = database.transaction([BUNDLE_STORE, META_STORE], 'readonly');
  const bundlesRequest = transaction.objectStore(BUNDLE_STORE).getAll();
  const metaStore = transaction.objectStore(META_STORE);
  const cursorRequest = metaStore.get(CURSOR_KEY);
  const lastSyncRequest = metaStore.get(LAST_SYNC_KEY);
  const serverTimeRequest = metaStore.get(SERVER_TIME_KEY);

  const [bundles, cursor, lastSyncAt, serverTime] = await Promise.all([
    requestValue<CachedBundle[]>(bundlesRequest),
    requestValue<MetaRecord | undefined>(cursorRequest),
    requestValue<MetaRecord | undefined>(lastSyncRequest),
    requestValue<MetaRecord | undefined>(serverTimeRequest),
    transactionDone(transaction),
  ]);
  database.close();

  return {
    bundles: bundles.sort(
      (left, right) => right.bundle.session.startedAt - left.bundle.session.startedAt,
    ),
    cursor: typeof cursor?.value === 'string' ? cursor.value : null,
    lastSyncAt: typeof lastSyncAt?.value === 'number' ? lastSyncAt.value : null,
    serverTime: typeof serverTime?.value === 'number' ? serverTime.value : null,
  };
}

export async function applyDeviceSyncChanges(
  changes: readonly DeviceSyncChange[],
  nextCursor: string,
  serverTime: number,
): Promise<void> {
  validateChanges(changes);
  const database = await openDatabase();
  const readTransaction = database.transaction(BUNDLE_STORE, 'readonly');
  const existingBundles = await requestValue<CachedBundle[]>(
    readTransaction.objectStore(BUNDLE_STORE).getAll(),
  );
  await transactionDone(readTransaction);
  const existingById = new Map(existingBundles.map((bundle) => [bundle.entityId, bundle]));
  const transaction = database.transaction([BUNDLE_STORE, META_STORE], 'readwrite');
  const bundleStore = transaction.objectStore(BUNDLE_STORE);

  try {
    for (const change of changes) {
      const existing = existingById.get(change.entityId);
      if (existing && existing.revision > change.revision) continue;

      if (change.deleted) {
        bundleStore.delete(change.entityId);
      } else if (change.payload) {
        bundleStore.put({
          entityId: change.entityId,
          revision: change.revision,
          changeSeq: change.changeSeq,
          sourceDeviceId: change.deviceId,
          bundle: change.payload,
        } satisfies CachedBundle);
      }
    }

    const metaStore = transaction.objectStore(META_STORE);
    metaStore.put({ key: CURSOR_KEY, value: nextCursor } satisfies MetaRecord);
    metaStore.put({ key: LAST_SYNC_KEY, value: Date.now() } satisfies MetaRecord);
    metaStore.put({ key: SERVER_TIME_KEY, value: serverTime } satisfies MetaRecord);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function clearMobileCache(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([BUNDLE_STORE, META_STORE], 'readwrite');
  transaction.objectStore(BUNDLE_STORE).clear();
  const metaStore = transaction.objectStore(META_STORE);
  metaStore.delete(CURSOR_KEY);
  metaStore.delete(LAST_SYNC_KEY);
  metaStore.delete(SERVER_TIME_KEY);
  metaStore.delete(LIVE_FOCUS_KEY);
  metaStore.delete(TASK_SNAPSHOT_KEY);
  await transactionDone(transaction);
  database.close();
}

export async function readPendingDeviceSyncBundles(): Promise<PendingDeviceSyncBundle[]> {
  const database = await openDatabase();
  const transaction = database.transaction(PENDING_STORE, 'readonly');
  const stored = await requestValue<unknown[]>(transaction.objectStore(PENDING_STORE).getAll());
  await transactionDone(transaction);
  const now = Date.now();
  const records = stored.map((record) => normalizePendingRecord(record, now));
  if (records.some((record, index) => record !== stored[index])) {
    const migration = database.transaction(PENDING_STORE, 'readwrite');
    const store = migration.objectStore(PENDING_STORE);
    for (const record of records) store.put(record);
    await transactionDone(migration);
  }
  database.close();
  return records.sort((left, right) => left.createdAt - right.createdAt);
}

export async function claimPendingDeviceSyncBundle(
  opId: string,
  deviceId: string,
): Promise<PendingDeviceSyncBundle | null> {
  if (!opId || !deviceId) return null;
  const database = await openDatabase();
  const transaction = database.transaction(PENDING_STORE, 'readwrite');
  const completion = transactionDone(transaction);
  const store = transaction.objectStore(PENDING_STORE);
  try {
    const claimed = await new Promise<PendingDeviceSyncBundle | null>((resolve, reject) => {
      const request = store.get(opId) as IDBRequest<unknown>;
      request.onerror = () => reject(request.error ?? new Error('读取待上传会话失败'));
      request.onsuccess = () => {
        try {
          if (request.result === undefined) {
            resolve(null);
            return;
          }
          const record = normalizePendingRecord(request.result, Date.now());
          if (record.syncDeviceId !== null && record.syncDeviceId !== deviceId) {
            resolve(null);
            return;
          }
          if (record.syncDeviceId === null) {
            record.syncDeviceId = deviceId;
            record.updatedAt = Date.now();
            store.put(record);
          }
          resolve(record);
        } catch (error) {
          reject(error);
        }
      };
    });
    await completion;
    return claimed;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The request may already have aborted the transaction.
    }
    await completion.catch(() => undefined);
    throw error;
  } finally {
    database.close();
  }
}

export async function enqueuePendingDeviceSyncBundle(
  bundle: DeviceSyncSessionBundle,
): Promise<PendingDeviceSyncBundle> {
  const validation = validateDeviceSyncBundle(bundle);
  if (!validation.ok) throw new Error(`无法保存离线会话：${validation.error ?? '格式无效'}`);
  const record: PendingDeviceSyncBundle = {
    opId: makeDeviceSyncOperationId(bundle.session.id, 'put', 0, bundle),
    entityId: bundle.session.id,
    bundle,
    state: 'pending',
    attemptCount: 0,
    nextRetryAt: 0,
    lastErrorCode: null,
    syncDeviceId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const database = await openDatabase();
  const transaction = database.transaction(PENDING_STORE, 'readwrite');
  transaction.objectStore(PENDING_STORE).put(record);
  await transactionDone(transaction);
  database.close();
  return record;
}

export async function completeOfflineFocusRuntime(
  bundle: DeviceSyncSessionBundle,
): Promise<PendingDeviceSyncBundle> {
  const validation = validateDeviceSyncBundle(bundle);
  if (!validation.ok) throw new Error(`无法保存离线会话：${validation.error ?? '格式无效'}`);
  const now = Date.now();
  const record: PendingDeviceSyncBundle = {
    opId: makeDeviceSyncOperationId(bundle.session.id, 'put', 0, bundle),
    entityId: bundle.session.id,
    bundle,
    state: 'pending',
    attemptCount: 0,
    nextRetryAt: 0,
    lastErrorCode: null,
    syncDeviceId: null,
    createdAt: now,
    updatedAt: now,
  };
  const database = await openDatabase();
  const transaction = database.transaction(
    [PENDING_STORE, META_STORE, V2_OUTBOX_STORE, V2_ENTITY_STATE_STORE],
    'readwrite',
  );
  const completion = transactionDone(transaction);
  try {
    await completeOfflineBundleInTransaction(transaction, bundle, record, now);
    await completion;
    return record;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // A failed IndexedDB request may already have aborted the transaction.
    }
    await completion.catch(() => undefined);
    throw error;
  } finally {
    database.close();
  }
}

export async function removePendingDeviceSyncBundle(opId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([PENDING_STORE, SESSION_SYNC_META_STORE], 'readwrite');
  const pendingStore = transaction.objectStore(PENDING_STORE);
  const existing = await requestValue<PendingDeviceSyncBundle | undefined>(pendingStore.get(opId));
  pendingStore.delete(opId);
  if (existing?.entityId) {
    transaction.objectStore(SESSION_SYNC_META_STORE).delete(existing.entityId);
  }
  await transactionDone(transaction);
  database.close();
}

export async function markPendingDeviceSyncUploading(
  record: PendingDeviceSyncBundle,
): Promise<PendingDeviceSyncBundle> {
  return updatePendingDeviceSyncBundle(record.opId, {
    state: 'uploading',
    attemptCount: record.attemptCount + 1,
    lastErrorCode: null,
    updatedAt: Date.now(),
  });
}

export async function markPendingDeviceSyncFailure(
  opId: string,
  state: Extract<PendingDeviceSyncState, 'retry' | 'conflict' | 'rejected'>,
  lastErrorCode: string,
  nextRetryAt: number,
): Promise<PendingDeviceSyncBundle> {
  return updatePendingDeviceSyncBundle(opId, {
    state,
    lastErrorCode,
    nextRetryAt,
    updatedAt: Date.now(),
  });
}

export async function createOfflineFocusRuntime(
  runtime: OfflineFocusRuntime,
  syncMeta: LocalSessionSyncMeta,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([META_STORE, SESSION_SYNC_META_STORE], 'readwrite');
  transaction.objectStore(META_STORE).put({
    key: OFFLINE_FOCUS_KEY,
    value: runtime,
  } satisfies MetaRecord);
  transaction.objectStore(SESSION_SYNC_META_STORE).put(syncMeta);
  await transactionDone(transaction);
  database.close();
}

export async function readLocalSessionSyncMeta(
  sessionId: string,
): Promise<LocalSessionSyncMeta | null> {
  const database = await openDatabase();
  const transaction = database.transaction(SESSION_SYNC_META_STORE, 'readonly');
  const value = await requestValue<unknown>(
    transaction.objectStore(SESSION_SYNC_META_STORE).get(sessionId),
  );
  await transactionDone(transaction);
  database.close();
  return isLocalSessionSyncMeta(value) ? value : null;
}

export async function writeLocalSessionSyncMeta(meta: LocalSessionSyncMeta): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(SESSION_SYNC_META_STORE, 'readwrite');
  transaction.objectStore(SESSION_SYNC_META_STORE).put(meta);
  await transactionDone(transaction);
  database.close();
}

export async function readOfflineFocusRuntime(): Promise<OfflineFocusRuntime | null> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readonly');
  const record = await requestValue<MetaRecord | undefined>(
    transaction.objectStore(META_STORE).get(OFFLINE_FOCUS_KEY),
  );
  await transactionDone(transaction);
  database.close();
  return isOfflineFocusRuntime(record?.value) ? record.value : null;
}

export async function writeOfflineFocusRuntime(runtime: OfflineFocusRuntime): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).put({
    key: OFFLINE_FOCUS_KEY,
    value: runtime,
  } satisfies MetaRecord);
  await transactionDone(transaction);
  database.close();
}

export async function clearOfflineFocusRuntime(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).delete(OFFLINE_FOCUS_KEY);
  await transactionDone(transaction);
  database.close();
}

export async function readCachedLiveFocusSnapshot(
  expectedAccountId: string | null,
): Promise<LiveFocusSnapshotLike | null> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readonly');
  const record = await requestValue<MetaRecord | undefined>(
    transaction.objectStore(META_STORE).get(LIVE_FOCUS_KEY),
  );
  await transactionDone(transaction);
  database.close();
  if (
    !expectedAccountId ||
    !isCachedLiveFocusRecord(record?.value) ||
    record.value.accountId !== expectedAccountId
  ) {
    return null;
  }
  const snapshot = record.value.snapshot;
  return {
    ...snapshot,
    startedAt: typeof snapshot.startedAt === 'number' ? snapshot.startedAt : null,
    segments: Array.isArray(snapshot.segments) ? snapshot.segments : [],
    pauses: Array.isArray(snapshot.pauses) ? snapshot.pauses : [],
  };
}

export async function writeCachedLiveFocusSnapshot(
  snapshot: LiveFocusSnapshotLike,
  accountId: string,
): Promise<void> {
  if (!isAccountId(accountId)) throw new Error('实时缓存缺少账号 owner');
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).put({
    key: LIVE_FOCUS_KEY,
    value: { accountId, snapshot, cachedAt: Date.now() } satisfies CachedLiveFocusRecord,
  } satisfies MetaRecord);
  await transactionDone(transaction);
  database.close();
}

export async function clearCachedLiveFocusSnapshot(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).delete(LIVE_FOCUS_KEY);
  await transactionDone(transaction);
  database.close();
}

export async function readCachedTaskSnapshot(
  expectedAccountId: string | null,
): Promise<TaskSnapshotResponse | null> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readonly');
  const record = await requestValue<MetaRecord | undefined>(
    transaction.objectStore(META_STORE).get(TASK_SNAPSHOT_KEY),
  );
  await transactionDone(transaction);
  database.close();
  return expectedAccountId &&
    isCachedTaskSnapshotRecord(record?.value) &&
    record.value.accountId === expectedAccountId
    ? record.value.snapshot
    : null;
}

export async function writeCachedTaskSnapshot(
  snapshot: TaskSnapshotResponse,
  accountId: string,
): Promise<void> {
  if (!isAccountId(accountId)) throw new Error('任务缓存缺少账号 owner');
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).put({
    key: TASK_SNAPSHOT_KEY,
    value: { accountId, snapshot, cachedAt: Date.now() } satisfies CachedTaskSnapshotRecord,
  } satisfies MetaRecord);
  await transactionDone(transaction);
  database.close();
}

export async function clearCachedTaskSnapshot(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).delete(TASK_SNAPSHOT_KEY);
  await transactionDone(transaction);
  database.close();
}

function validateChanges(changes: readonly DeviceSyncChange[]): void {
  let previousSequence = -1;
  for (const change of changes) {
    if (!Number.isSafeInteger(change.changeSeq) || change.changeSeq < 0) {
      throw new Error('服务返回了无效的变更序号');
    }
    if (change.changeSeq <= previousSequence) {
      throw new Error('服务返回的变更顺序无效');
    }
    previousSequence = change.changeSeq;

    if (!change.entityId || !Number.isSafeInteger(change.revision) || change.revision < 0) {
      throw new Error('服务返回了无效的会话版本');
    }
    if (change.deleted) {
      if (change.payload !== null) throw new Error('删除变更不应携带会话数据');
      continue;
    }
    const validation = validateDeviceSyncBundle(change.payload);
    if (!validation.ok) {
      throw new Error(`服务返回的会话数据无效：${validation.error ?? '未知格式错误'}`);
    }
    if (change.payload?.session.id !== change.entityId) {
      throw new Error('服务返回的会话 ID 与变更 ID 不一致');
    }
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BUNDLE_STORE)) {
        database.createObjectStore(BUNDLE_STORE, { keyPath: 'entityId' });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains(PENDING_STORE)) {
        database.createObjectStore(PENDING_STORE, { keyPath: 'opId' });
      }
      if (!database.objectStoreNames.contains(SESSION_SYNC_META_STORE)) {
        database.createObjectStore(SESSION_SYNC_META_STORE, { keyPath: 'sessionId' });
      }
      if (!database.objectStoreNames.contains(V2_OUTBOX_STORE)) {
        const store = database.createObjectStore(V2_OUTBOX_STORE, { keyPath: 'opId' });
        store.createIndex('ready', ['state', 'nextRetryAt', 'createdAt']);
        store.createIndex('leaseExpiresAt', 'leaseExpiresAt');
      }
      if (!database.objectStoreNames.contains(V2_ENTITY_STATE_STORE)) {
        database.createObjectStore(V2_ENTITY_STATE_STORE, { keyPath: ['entityType', 'entityId'] });
      }
      if (!database.objectStoreNames.contains(V2_CONFLICT_STORE)) {
        const store = database.createObjectStore(V2_CONFLICT_STORE, { keyPath: 'conflictId' });
        store.createIndex('status', ['status', 'createdAt']);
      }
      if (!database.objectStoreNames.contains(V2_OPERATION_HISTORY_STORE)) {
        const store = database.createObjectStore(V2_OPERATION_HISTORY_STORE, { keyPath: 'opId' });
        store.createIndex('completedAt', 'completedAt');
      }
      if (!database.objectStoreNames.contains(V2_DEVICE_STORE)) {
        database.createObjectStore(V2_DEVICE_STORE, { keyPath: 'deviceId' });
      }
      if (event.oldVersion < 5 && request.transaction) {
        // A provisional v2 build accepted a `token` property in this ordinary
        // IndexedDB store. Rewrite every surviving identity as an allowlisted
        // public record during the schema upgrade; credentials remain solely
        // in the Android Keystore/native connection store.
        const deviceStore = request.transaction.objectStore(V2_DEVICE_STORE);
        const cursorRequest = deviceStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const sanitized = sanitizeStoredMobileDeviceIdentity(cursor.value);
          if (sanitized === null) cursor.delete();
          else cursor.update(sanitized);
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地缓存'));
    request.onblocked = () => reject(new Error('本地缓存正在被另一个页面占用'));
  });
}

/** Shared only by the mobile v2 persistence module; product data remains in one IndexedDB. */
export function openMobileDatabase(): Promise<IDBDatabase> {
  return openDatabase();
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('读取本地缓存失败'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('本地缓存事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('本地缓存事务已取消'));
  });
}

function isCachedLiveFocusRecord(value: unknown): value is CachedLiveFocusRecord {
  if (!isRecord(value) || !isRecord(value.snapshot)) return false;
  const snapshot = value.snapshot;
  return (
    isAccountId(value.accountId) &&
    typeof value.cachedAt === 'number' &&
    Number.isFinite(value.cachedAt) &&
    (snapshot.state === 'idle' || snapshot.state === 'running' || snapshot.state === 'paused') &&
    Number.isSafeInteger(snapshot.revision) &&
    (typeof snapshot.sessionId === 'string' || snapshot.sessionId === null) &&
    typeof snapshot.updatedAt === 'number' &&
    typeof snapshot.serverTime === 'number' &&
    typeof snapshot.observedAt === 'number' &&
    typeof snapshot.activeElapsedMs === 'number' &&
    typeof snapshot.pauseElapsedMs === 'number' &&
    typeof snapshot.wallElapsedMs === 'number' &&
    (typeof snapshot.currentStateStartedAt === 'number' ||
      snapshot.currentStateStartedAt === null) &&
    (snapshot.startedAt === undefined ||
      typeof snapshot.startedAt === 'number' ||
      snapshot.startedAt === null) &&
    (snapshot.segments === undefined || Array.isArray(snapshot.segments)) &&
    (snapshot.pauses === undefined || Array.isArray(snapshot.pauses)) &&
    (typeof snapshot.title === 'string' || snapshot.title === null) &&
    (typeof snapshot.ownerDeviceId === 'string' || snapshot.ownerDeviceId === null)
  );
}

function isCachedTaskSnapshotRecord(value: unknown): value is CachedTaskSnapshotRecord {
  return (
    isRecord(value) &&
    isAccountId(value.accountId) &&
    typeof value.cachedAt === 'number' &&
    Number.isFinite(value.cachedAt) &&
    isCachedTaskSnapshot(value.snapshot)
  );
}

function isCachedTaskSnapshot(value: unknown): value is TaskSnapshotResponse {
  return (
    isRecord(value) &&
    value.protocolVersion === TASK_SNAPSHOT_PROTOCOL_VERSION &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    (value.sourceDeviceId === null || typeof value.sourceDeviceId === 'string') &&
    typeof value.serverTime === 'number' &&
    Number.isFinite(value.serverTime) &&
    (value.snapshot === null || validateTaskSnapshotPayload(value.snapshot))
  );
}

function isAccountId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePendingRecord(value: unknown, now: number): PendingDeviceSyncBundle {
  if (!isRecord(value) || typeof value.opId !== 'string' || typeof value.entityId !== 'string') {
    throw new Error('本机待上传会话记录无效');
  }
  const state =
    value.state === 'pending' ||
    value.state === 'retry' ||
    value.state === 'conflict' ||
    value.state === 'rejected'
      ? value.state
      : value.state === 'uploading'
        ? 'retry'
        : 'pending';
  const attemptCount = Number.isSafeInteger(value.attemptCount)
    ? Math.max(0, Number(value.attemptCount))
    : 0;
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : now;
  const normalized: PendingDeviceSyncBundle = {
    opId: value.opId,
    entityId: value.entityId,
    bundle: value.bundle as DeviceSyncSessionBundle,
    state,
    attemptCount,
    nextRetryAt: typeof value.nextRetryAt === 'number' ? Math.max(0, value.nextRetryAt) : 0,
    lastErrorCode: typeof value.lastErrorCode === 'string' ? value.lastErrorCode : null,
    syncDeviceId: typeof value.syncDeviceId === 'string' ? value.syncDeviceId : null,
    createdAt,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : createdAt,
  };
  const unchanged =
    value.state === normalized.state &&
    value.attemptCount === normalized.attemptCount &&
    value.nextRetryAt === normalized.nextRetryAt &&
    value.lastErrorCode === normalized.lastErrorCode &&
    value.syncDeviceId === normalized.syncDeviceId &&
    value.createdAt === normalized.createdAt &&
    value.updatedAt === normalized.updatedAt;
  return unchanged ? (value as unknown as PendingDeviceSyncBundle) : normalized;
}

interface CanonicalMobileBinding {
  accountId: string;
  deviceId: string;
  accountGeneration: number;
}

function canonicalMobileBinding(value: unknown): CanonicalMobileBinding | null {
  if (!isRecord(value) || value.state !== 'v2-active') return null;
  if (
    typeof value.boundDeviceId !== 'string' ||
    value.boundDeviceId.length < 1 ||
    value.boundDeviceId.length > 200 ||
    typeof value.boundAccountId !== 'string' ||
    value.boundAccountId.length < 1 ||
    value.boundAccountId.length > 200 ||
    !Number.isSafeInteger(value.accountGeneration) ||
    Number(value.accountGeneration) < 1
  ) {
    return null;
  }
  return {
    accountId: value.boundAccountId,
    deviceId: value.boundDeviceId,
    accountGeneration: Number(value.accountGeneration),
  };
}

/**
 * Keeps every read/write transition inside IndexedDB request callbacks. Some
 * Android WebViews mark readwrite transactions inactive before an awaited
 * Promise continuation runs, even though modern desktop engines tolerate it.
 */
function completeOfflineBundleInTransaction(
  transaction: IDBTransaction,
  bundle: DeviceSyncSessionBundle,
  record: PendingDeviceSyncBundle,
  now: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const metaStore = transaction.objectStore(META_STORE);
    const pendingStore = transaction.objectStore(PENDING_STORE);
    const checkpointRequest = metaStore.get('syncV2.bootstrap') as IDBRequest<
      MetaRecord | undefined
    >;
    let settled = false;
    const fail = (error: DOMException | null) => {
      if (settled) return;
      settled = true;
      reject(error ?? new Error('读取本地缓存失败'));
    };
    const finish = () => {
      if (settled) return;
      pendingStore.put(record);
      metaStore.delete(OFFLINE_FOCUS_KEY);
      settled = true;
      resolve();
    };
    checkpointRequest.onerror = () => fail(checkpointRequest.error);
    checkpointRequest.onsuccess = () => {
      try {
        const binding = canonicalMobileBinding(checkpointRequest.result?.value);
        if (!binding) {
          finish();
          return;
        }
        record.syncDeviceId = binding.deviceId;
        const split = splitBundleForSyncV2(bundle, binding.deviceId);
        const entities: Array<{
          entityType: SyncV2EntityType;
          entityId: string;
          payload: SyncV2Payload;
        }> = [
          { entityType: 'focus_ledger_v2', entityId: bundle.session.id, payload: split.ledger },
          {
            entityType: 'focus_metadata_v2',
            entityId: bundle.session.id,
            payload: split.metadata,
          },
        ];
        const stateStore = transaction.objectStore(V2_ENTITY_STATE_STORE);
        const stateRequests = entities.map((entity) =>
          stateStore.get([entity.entityType, entity.entityId]),
        );
        const states: Array<
          { confirmedRevision?: unknown; confirmedFingerprint?: unknown } | undefined
        > = [];
        let statesRemaining = stateRequests.length;
        const afterStates = () => {
          statesRemaining -= 1;
          if (statesRemaining !== 0 || settled) return;
          try {
            const items = entities.map((entity, index): SyncV2OutboxItem => {
              const state = states[index];
              const baseRevision = Number.isSafeInteger(state?.confirmedRevision)
                ? Number(state?.confirmedRevision)
                : 0;
              const baseFingerprint =
                typeof state?.confirmedFingerprint === 'string' ? state.confirmedFingerprint : null;
              return {
                ...entity,
                opId: `v2-${fingerprintDeviceSyncValue({
                  entity,
                  baseRevision,
                  deviceId: binding.deviceId,
                })}`,
                kind: 'put',
                baseRevision,
                baseFingerprint,
                deviceId: binding.deviceId,
                accountGeneration: binding.accountGeneration,
                state: 'pending',
                attemptCount: 0,
                nextRetryAt: 0,
                leaseId: null,
                leaseExpiresAt: null,
                claimedAt: null,
                errorCode: null,
                createdAt: now,
                updatedAt: now,
              };
            });
            const outboxStore = transaction.objectStore(V2_OUTBOX_STORE);
            const existingRequests = items.map((item) => outboxStore.get(item.opId));
            const existingItems: Array<SyncV2OutboxItem | undefined> = [];
            let existingRemaining = existingRequests.length;
            const afterExisting = () => {
              existingRemaining -= 1;
              if (existingRemaining !== 0 || settled) return;
              try {
                items.forEach((item, index) => {
                  const existing = existingItems[index];
                  if (existing && !sameCanonicalOutboxMutation(existing, item)) {
                    throw new Error('同一 Sync v2 opId 对应了不同 payload');
                  }
                  if (!existing) outboxStore.add(item);
                });
                finish();
              } catch (error) {
                settled = true;
                reject(error);
              }
            };
            existingRequests.forEach((request, index) => {
              request.onsuccess = () => {
                existingItems[index] = request.result as SyncV2OutboxItem | undefined;
                afterExisting();
              };
              request.onerror = () => fail(request.error);
            });
          } catch (error) {
            settled = true;
            reject(error);
          }
        };
        stateRequests.forEach((request, index) => {
          request.onsuccess = () => {
            states[index] = request.result as
              { confirmedRevision?: unknown; confirmedFingerprint?: unknown } | undefined;
            afterStates();
          };
          request.onerror = () => fail(request.error);
        });
      } catch (error) {
        settled = true;
        reject(error);
      }
    };
  });
}

function sameCanonicalOutboxMutation(left: SyncV2OutboxItem, right: SyncV2OutboxItem): boolean {
  return (
    left.entityType === right.entityType &&
    left.entityId === right.entityId &&
    left.kind === right.kind &&
    left.baseRevision === right.baseRevision &&
    left.baseFingerprint === right.baseFingerprint &&
    left.deviceId === right.deviceId &&
    left.accountGeneration === right.accountGeneration &&
    fingerprintDeviceSyncValue(left.payload) === fingerprintDeviceSyncValue(right.payload)
  );
}

function sanitizeStoredMobileDeviceIdentity(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || typeof value.deviceId !== 'string' || value.deviceId.length < 1) {
    return null;
  }
  return {
    deviceId: value.deviceId,
    devicePublicId: typeof value.devicePublicId === 'string' ? value.devicePublicId : '',
    accountPublicId: typeof value.accountPublicId === 'string' ? value.accountPublicId : '',
    displayName: typeof value.displayName === 'string' ? value.displayName : '',
    scopes: Array.isArray(value.scopes)
      ? value.scopes.filter((scope): scope is string => typeof scope === 'string')
      : [],
    expiresAt:
      typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) ? value.expiresAt : 0,
  };
}

async function updatePendingDeviceSyncBundle(
  opId: string,
  patch: Partial<PendingDeviceSyncBundle>,
): Promise<PendingDeviceSyncBundle> {
  const database = await openDatabase();
  const transaction = database.transaction(PENDING_STORE, 'readwrite');
  const store = transaction.objectStore(PENDING_STORE);
  const existing = await requestValue<PendingDeviceSyncBundle | undefined>(store.get(opId));
  if (!existing) {
    transaction.abort();
    database.close();
    throw new Error('待上传会话不存在');
  }
  const next = { ...existing, ...patch };
  store.put(next);
  await transactionDone(transaction);
  database.close();
  return next;
}

function isLocalSessionSyncMeta(value: unknown): value is LocalSessionSyncMeta {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionId === 'string' &&
    (value.authorityMode === 'local-offline' || value.authorityMode === 'forked-local') &&
    typeof value.originDeviceId === 'string' &&
    (value.baseCloudRevision === null || Number.isSafeInteger(value.baseCloudRevision)) &&
    (value.suspectedRemoteSessionId === null ||
      typeof value.suspectedRemoteSessionId === 'string') &&
    (value.detectedRemoteRevision === null || Number.isSafeInteger(value.detectedRemoteRevision)) &&
    (value.detectedAt === null || typeof value.detectedAt === 'number')
  );
}
