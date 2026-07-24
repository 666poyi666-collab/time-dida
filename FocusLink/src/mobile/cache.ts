import type { DeviceSyncChange, DeviceSyncSessionBundle } from '@shared/sync/deviceProtocol';
import { makeDeviceSyncOperationId, validateDeviceSyncBundle } from '@shared/sync/deviceProtocol';
import { isOfflineFocusRuntime, type OfflineFocusRuntime } from './offlineFocusRuntime';
import type { LiveFocusSnapshotLike } from './runtimeModel';
import {
  TASK_SNAPSHOT_PROTOCOL_VERSION,
  validateTaskSnapshotPayload,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';

const DATABASE_NAME = 'focuslink-mobile-preview';
const DATABASE_VERSION = 2;
const BUNDLE_STORE = 'bundles';
const META_STORE = 'meta';
const PENDING_STORE = 'pendingBundles';

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

export interface PendingDeviceSyncBundle {
  opId: string;
  entityId: string;
  bundle: DeviceSyncSessionBundle;
  createdAt: number;
}

interface MetaRecord {
  key: string;
  value: unknown;
}

interface CachedLiveFocusRecord {
  snapshot: LiveFocusSnapshotLike;
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
  const records = await requestValue<PendingDeviceSyncBundle[]>(
    transaction.objectStore(PENDING_STORE).getAll(),
  );
  await transactionDone(transaction);
  database.close();
  return records.sort((left, right) => left.createdAt - right.createdAt);
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
    createdAt: Date.now(),
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
  const record: PendingDeviceSyncBundle = {
    opId: makeDeviceSyncOperationId(bundle.session.id, 'put', 0, bundle),
    entityId: bundle.session.id,
    bundle,
    createdAt: Date.now(),
  };
  const database = await openDatabase();
  const transaction = database.transaction([PENDING_STORE, META_STORE], 'readwrite');
  transaction.objectStore(PENDING_STORE).put(record);
  transaction.objectStore(META_STORE).delete(OFFLINE_FOCUS_KEY);
  await transactionDone(transaction);
  database.close();
  return record;
}

export async function removePendingDeviceSyncBundle(opId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(PENDING_STORE, 'readwrite');
  transaction.objectStore(PENDING_STORE).delete(opId);
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

export async function readCachedLiveFocusSnapshot(): Promise<LiveFocusSnapshotLike | null> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readonly');
  const record = await requestValue<MetaRecord | undefined>(
    transaction.objectStore(META_STORE).get(LIVE_FOCUS_KEY),
  );
  await transactionDone(transaction);
  database.close();
  if (!isCachedLiveFocusRecord(record?.value)) return null;
  const snapshot = record.value.snapshot;
  return {
    ...snapshot,
    startedAt: typeof snapshot.startedAt === 'number' ? snapshot.startedAt : null,
    segments: Array.isArray(snapshot.segments) ? snapshot.segments : [],
    pauses: Array.isArray(snapshot.pauses) ? snapshot.pauses : [],
  };
}

export async function writeCachedLiveFocusSnapshot(snapshot: LiveFocusSnapshotLike): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).put({
    key: LIVE_FOCUS_KEY,
    value: { snapshot, cachedAt: Date.now() } satisfies CachedLiveFocusRecord,
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

export async function readCachedTaskSnapshot(): Promise<TaskSnapshotResponse | null> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readonly');
  const record = await requestValue<MetaRecord | undefined>(
    transaction.objectStore(META_STORE).get(TASK_SNAPSHOT_KEY),
  );
  await transactionDone(transaction);
  database.close();
  return isCachedTaskSnapshot(record?.value) ? record.value : null;
}

export async function writeCachedTaskSnapshot(snapshot: TaskSnapshotResponse): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).put({
    key: TASK_SNAPSHOT_KEY,
    value: snapshot,
  } satisfies MetaRecord);
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
    request.onupgradeneeded = () => {
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地缓存'));
    request.onblocked = () => reject(new Error('本地缓存正在被另一个页面占用'));
  });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
