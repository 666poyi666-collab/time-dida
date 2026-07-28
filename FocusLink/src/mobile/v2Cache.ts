import type {
  SyncV2Ack,
  SyncV2BootstrapState,
  SyncV2Conflict,
  SyncV2Epoch,
  SyncV2Mutation,
  SyncV2OutboxItem,
  SyncV2Payload,
} from '@shared/sync/v2Protocol';
import { SYNC_V2_DEFAULT_LEASE_MS } from '@shared/sync/v2Protocol';
import {
  fingerprintDeviceSyncValue,
  validateDeviceSyncBundle,
  type DeviceSyncSessionBundle,
} from '@shared/sync/deviceProtocol';
import type { FocusLedgerV2, FocusMetadataV2, SyncV2Change } from '@shared/sync/v2Protocol';
import { openMobileDatabase, type CachedBundle } from './cache';

const OUTBOX = 'syncOutbox';
const ENTITY_STATE = 'syncEntityState';
const CONFLICTS = 'syncConflicts';
const HISTORY = 'syncOperationHistory';
const DEVICES = 'syncDevices';
const META = 'meta';
const BOOTSTRAP_KEY = 'syncV2.bootstrap';

export interface MobileV2BootstrapCheckpoint extends SyncV2Epoch {
  key: typeof BOOTSTRAP_KEY;
  state: SyncV2BootstrapState;
  bootstrapId: string | null;
  cursor: string | null;
  updatedAt: number;
}

export interface MobileV2EntityState extends SyncV2Epoch {
  entityType: SyncV2Mutation['entityType'];
  entityId: string;
  confirmedRevision: number;
  confirmedFingerprint: string;
  baseSnapshot: SyncV2Payload | null;
  deleted?: boolean;
  changeSeq?: number | null;
  sourceDeviceId?: string | null;
  updatedAt: number;
}

export async function applyMobileV2ChangesAndCheckpoint(input: {
  changes: readonly SyncV2Change[];
  checkpoint: MobileV2BootstrapCheckpoint;
  serverTime: number;
  deviceId: string;
  /** ACK settlement shares this transaction with entity materialization and cursor commit. */
  leaseId?: string;
  acks?: readonly SyncV2Ack[];
}): Promise<{ imported: number; conflicts: number }> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(
    [ENTITY_STATE, OUTBOX, CONFLICTS, HISTORY, 'bundles', META],
    'readwrite',
  );
  const entityStore = transaction.objectStore(ENTITY_STATE);
  const outboxStore = transaction.objectStore(OUTBOX);
  const conflictStore = transaction.objectStore(CONFLICTS);
  const historyStore = transaction.objectStore(HISTORY);
  const bundleStore = transaction.objectStore('bundles');
  const metaStore = transaction.objectStore(META);
  try {
    const [storedStates, pending, cached] = await Promise.all([
      request(entityStore.getAll()) as Promise<MobileV2EntityState[]>,
      request(outboxStore.getAll()) as Promise<SyncV2OutboxItem[]>,
      request(bundleStore.getAll()) as Promise<CachedBundle[]>,
    ]);
    const states = new Map(
      storedStates.map((state) => [`${state.entityType}\u0000${state.entityId}`, state]),
    );
    const pendingByEntity = new Map(
      pending.map((item) => [`${item.entityType}\u0000${item.entityId}`, item]),
    );
    const cachedById = new Map(cached.map((item) => [item.entityId, item]));
    const affected = new Set<string>();
    let conflicts = 0;

    for (const ack of input.acks ?? []) {
      if (!input.leaseId) throw new Error('Sync v2 ACK 缺少持久 lease');
      const item = (await request(outboxStore.get(ack.opId))) as SyncV2OutboxItem | undefined;
      if (
        !item ||
        item.leaseId !== input.leaseId ||
        item.entityType !== ack.entityType ||
        item.entityId !== ack.entityId
      ) {
        throw new Error('Sync v2 ACK 不属于当前持久 lease');
      }
      if (ack.status === 'applied' || ack.status === 'duplicate') {
        if (ack.revision === null || ack.fingerprint === null) {
          throw new Error('Sync v2 成功 ACK 缺少权威版本');
        }
        const state: MobileV2EntityState = {
          entityType: ack.entityType,
          entityId: ack.entityId,
          confirmedRevision: ack.revision,
          confirmedFingerprint: ack.fingerprint,
          baseSnapshot: item.payload,
          deleted: item.payload === null,
          sourceDeviceId: item.deviceId,
          syncEpoch: input.checkpoint.syncEpoch,
          cursorEpoch: input.checkpoint.cursorEpoch,
          accountGeneration: input.checkpoint.accountGeneration,
          updatedAt: Date.now(),
        };
        entityStore.put(state);
        states.set(`${state.entityType}\u0000${state.entityId}`, state);
        pendingByEntity.delete(`${state.entityType}\u0000${state.entityId}`);
        historyStore.put({
          opId: ack.opId,
          entityType: ack.entityType,
          entityId: ack.entityId,
          status: ack.status,
          revision: ack.revision,
          errorCode: null,
          completedAt: Date.now(),
        });
        outboxStore.delete(ack.opId);
        continue;
      }
      outboxStore.put({
        ...item,
        state: ack.status,
        errorCode: ack.errorCode,
        leaseId: null,
        leaseExpiresAt: null,
        claimedAt: null,
        updatedAt: Date.now(),
      });
    }

    for (const change of input.changes) {
      const key = `${change.entityType}\u0000${change.entityId}`;
      const existing = states.get(key);
      if (existing && change.revision <= existing.confirmedRevision) {
        affected.add(change.entityId);
        continue;
      }
      const pendingItem = pendingByEntity.get(key);
      const pendingFingerprint = pendingItem
        ? fingerprintDeviceSyncValue({
            deleted: pendingItem.payload === null,
            payload: pendingItem.payload,
          })
        : null;
      if (pendingFingerprint !== null && pendingFingerprint !== change.fingerprint) {
        conflictStore.put({
          conflictId: `remote-${change.changeSeq}-${change.entityType}-${change.entityId}`,
          entityType: change.entityType,
          entityId: change.entityId,
          base: existing?.baseSnapshot ?? null,
          local: pendingItem?.payload ?? null,
          remote: change.payload,
          fields: [change.deleted ? 'deleted' : 'payload'],
          sourceDeviceIds: [change.sourceDeviceId],
          status: 'open',
          createdAt: Date.now(),
          resolvedAt: null,
          resolutionOpId: null,
        } satisfies SyncV2Conflict);
        conflicts += 1;
        continue;
      }
      const state: MobileV2EntityState = {
        entityType: change.entityType,
        entityId: change.entityId,
        confirmedRevision: change.revision,
        confirmedFingerprint: change.fingerprint,
        baseSnapshot: change.payload,
        deleted: change.deleted,
        changeSeq: change.changeSeq,
        sourceDeviceId: change.sourceDeviceId,
        syncEpoch: input.checkpoint.syncEpoch,
        cursorEpoch: input.checkpoint.cursorEpoch,
        accountGeneration: input.checkpoint.accountGeneration,
        updatedAt: Date.now(),
      };
      states.set(key, state);
      entityStore.put(state);
      affected.add(change.entityId);
      historyStore.put({
        opId: `remote-${change.changeSeq}`,
        entityType: change.entityType,
        entityId: change.entityId,
        status: 'remote',
        revision: change.revision,
        errorCode: null,
        completedAt: Date.now(),
      });
    }

    let imported = 0;
    for (const entityId of affected) {
      const ledger = states.get(`focus_ledger_v2\u0000${entityId}`);
      const metadata = states.get(`focus_metadata_v2\u0000${entityId}`);
      if (ledger?.deleted) {
        bundleStore.delete(entityId);
        cachedById.delete(entityId);
        continue;
      }
      if (!ledger?.baseSnapshot || !metadata?.baseSnapshot || metadata.deleted) continue;
      const bundle = joinV2Bundle(
        ledger.baseSnapshot as FocusLedgerV2,
        metadata.baseSnapshot as FocusMetadataV2,
      );
      const validation = validateDeviceSyncBundle(bundle);
      if (!validation.ok) throw new Error(`远端 v2 会话无法物化：${validation.error ?? 'invalid'}`);
      const revision = Math.max(ledger.confirmedRevision, metadata.confirmedRevision);
      const changeSeq = Math.max(ledger.changeSeq ?? 0, metadata.changeSeq ?? 0);
      bundleStore.put({
        entityId,
        revision,
        changeSeq,
        sourceDeviceId: ledger.sourceDeviceId ?? metadata.sourceDeviceId ?? input.deviceId,
        bundle,
      } satisfies CachedBundle);
      if (!cachedById.has(entityId)) imported += 1;
    }

    metaStore.put({ key: BOOTSTRAP_KEY, value: input.checkpoint });
    metaStore.put({ key: 'cursor', value: input.checkpoint.cursor });
    metaStore.put({ key: 'lastSyncAt', value: Date.now() });
    metaStore.put({ key: 'serverTime', value: input.serverTime });
    await done(transaction);
    return { imported, conflicts };
  } catch (error) {
    // Any validation or materialization failure must keep the outbox item and
    // cursor together. IndexedDB otherwise commits already queued writes when
    // an async function throws before awaiting the transaction completion.
    const settled = done(transaction).catch(() => undefined);
    try {
      transaction.abort();
    } catch {
      // The transaction may already have aborted because its request failed.
    }
    await settled;
    throw error;
  } finally {
    database.close();
  }
}

function joinV2Bundle(ledger: FocusLedgerV2, metadata: FocusMetadataV2): DeviceSyncSessionBundle {
  return {
    session: {
      id: ledger.sessionId,
      title: metadata.title,
      status: ledger.status,
      startedAt: ledger.startedAt,
      endedAt: ledger.endedAt,
      activeElapsedMs: ledger.activeElapsedMs,
      pauseElapsedMs: ledger.pausedElapsedMs,
      wallElapsedMs: ledger.wallElapsedMs,
      defaultTaskId: metadata.taskAssociation?.taskId ?? null,
      defaultTaskSource: metadata.taskAssociation?.source ?? null,
      defaultTaskTitle: metadata.taskAssociation?.title ?? null,
      note: metadata.note,
      createdAt: ledger.startedAt,
      updatedAt: Math.max(metadata.updatedAt, ledger.endedAt),
    },
    segments: ledger.segments,
    pauses: ledger.pauses,
  };
}

export async function enqueueMobileV2Mutation(
  mutation: SyncV2Mutation,
  now = Date.now(),
): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(OUTBOX, 'readwrite');
  const record: SyncV2OutboxItem = {
    ...mutation,
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
  transaction.objectStore(OUTBOX).add(record);
  await done(transaction);
}

export async function claimMobileV2Outbox(
  limit: number,
  now = Date.now(),
): Promise<{
  leaseId: string;
  items: SyncV2OutboxItem[];
}> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(OUTBOX, 'readwrite');
  const store = transaction.objectStore(OUTBOX);
  const records = (await request(store.getAll())) as SyncV2OutboxItem[];
  const leaseId = crypto.randomUUID();
  const items = records
    .filter(
      (item) =>
        (item.state === 'pending' ||
          item.state === 'retry' ||
          (item.state === 'uploading' && (item.leaseExpiresAt ?? 0) <= now)) &&
        item.nextRetryAt <= now,
    )
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(0, Math.max(0, limit))
    .map((item) => ({
      ...item,
      state: 'uploading' as const,
      leaseId,
      claimedAt: now,
      leaseExpiresAt: now + SYNC_V2_DEFAULT_LEASE_MS,
      updatedAt: now,
    }));
  for (const item of items) store.put(item);
  await done(transaction);
  return { leaseId, items };
}

export async function settleMobileV2Ack(input: {
  leaseId: string;
  ack: SyncV2Ack;
  payload: SyncV2Payload | null;
  epoch: SyncV2Epoch;
  now?: number;
}): Promise<boolean> {
  const now = input.now ?? Date.now();
  const database = await openMobileDatabase();
  const transaction = database.transaction([OUTBOX, ENTITY_STATE, HISTORY], 'readwrite');
  const outbox = transaction.objectStore(OUTBOX);
  const item = (await request(outbox.get(input.ack.opId))) as SyncV2OutboxItem | undefined;
  if (!item || item.leaseId !== input.leaseId) {
    transaction.abort();
    return false;
  }
  if (input.ack.status === 'applied' || input.ack.status === 'duplicate') {
    if (input.ack.revision === null || input.ack.fingerprint === null) {
      transaction.abort();
      return false;
    }
    const state: MobileV2EntityState = {
      entityType: input.ack.entityType,
      entityId: input.ack.entityId,
      confirmedRevision: input.ack.revision,
      confirmedFingerprint: input.ack.fingerprint,
      baseSnapshot: input.payload,
      ...input.epoch,
      updatedAt: now,
    };
    transaction.objectStore(ENTITY_STATE).put(state);
    transaction.objectStore(HISTORY).put({
      opId: input.ack.opId,
      entityType: input.ack.entityType,
      entityId: input.ack.entityId,
      status: input.ack.status,
      revision: input.ack.revision,
      errorCode: null,
      completedAt: now,
    });
    outbox.delete(input.ack.opId);
  } else {
    outbox.put({
      ...item,
      state: input.ack.status,
      errorCode: input.ack.errorCode,
      leaseId: null,
      leaseExpiresAt: null,
      claimedAt: null,
      updatedAt: now,
    });
  }
  await done(transaction);
  return true;
}

export async function retryMobileV2Lease(
  leaseId: string,
  errorCode: string,
  nextRetryAt: number,
  now = Date.now(),
): Promise<number> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(OUTBOX, 'readwrite');
  const store = transaction.objectStore(OUTBOX);
  const records = (await request(store.getAll())) as SyncV2OutboxItem[];
  let changed = 0;
  for (const item of records)
    if (item.leaseId === leaseId && item.state === 'uploading') {
      store.put({
        ...item,
        state: 'retry',
        attemptCount: item.attemptCount + 1,
        nextRetryAt,
        errorCode,
        leaseId: null,
        leaseExpiresAt: null,
        claimedAt: null,
        updatedAt: now,
      });
      changed += 1;
    }
  await done(transaction);
  return changed;
}

export async function writeMobileV2Conflict(conflict: SyncV2Conflict): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(CONFLICTS, 'readwrite');
  transaction.objectStore(CONFLICTS).put(conflict);
  await done(transaction);
}

export async function readMobileV2EntityState(
  entityType: SyncV2Mutation['entityType'],
  entityId: string,
): Promise<MobileV2EntityState | null> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(ENTITY_STATE, 'readonly');
  const value = await request(transaction.objectStore(ENTITY_STATE).get([entityType, entityId]));
  await done(transaction);
  return (value as MobileV2EntityState | undefined) ?? null;
}

export async function writeMobileV2EntityState(value: MobileV2EntityState): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(ENTITY_STATE, 'readwrite');
  transaction.objectStore(ENTITY_STATE).put(value);
  await done(transaction);
}

export async function writeMobileV2Bootstrap(
  checkpoint: MobileV2BootstrapCheckpoint,
): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(META, 'readwrite');
  transaction.objectStore(META).put({ key: BOOTSTRAP_KEY, value: checkpoint });
  await done(transaction);
}

export async function resetMobileV2Epoch(checkpoint: MobileV2BootstrapCheckpoint): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction([OUTBOX, ENTITY_STATE, HISTORY, META], 'readwrite');
  const outbox = transaction.objectStore(OUTBOX);
  const records = (await request(outbox.getAll())) as SyncV2OutboxItem[];
  const history = transaction.objectStore(HISTORY);
  const now = Date.now();
  for (const item of records) {
    if (
      item.accountGeneration !== checkpoint.accountGeneration &&
      (item.state === 'pending' || item.state === 'uploading' || item.state === 'retry')
    ) {
      history.put({
        opId: item.opId,
        entityType: item.entityType,
        entityId: item.entityId,
        status: 'generation-requeued',
        revision: null,
        errorCode: 'account_generation_changed',
        completedAt: now,
      });
      outbox.delete(item.opId);
    }
  }
  transaction.objectStore(ENTITY_STATE).clear();
  transaction.objectStore(META).put({ key: BOOTSTRAP_KEY, value: checkpoint });
  await done(transaction);
  database.close();
}

export async function mobileV2EntityMatches(
  entityType: SyncV2Mutation['entityType'],
  entityId: string,
  fingerprint: string,
): Promise<boolean> {
  const state = await readMobileV2EntityState(entityType, entityId);
  return state?.confirmedFingerprint === fingerprint && state.deleted !== true;
}

export async function readMobileV2Status(): Promise<{
  pending: number;
  conflicts: number;
  rejected: number;
}> {
  const database = await openMobileDatabase();
  const transaction = database.transaction([OUTBOX, CONFLICTS], 'readonly');
  const [outbox, conflicts] = await Promise.all([
    request(transaction.objectStore(OUTBOX).getAll()) as Promise<SyncV2OutboxItem[]>,
    request(transaction.objectStore(CONFLICTS).getAll()) as Promise<SyncV2Conflict[]>,
  ]);
  await done(transaction);
  database.close();
  return {
    pending: outbox.filter(
      (item) => item.state === 'pending' || item.state === 'uploading' || item.state === 'retry',
    ).length,
    conflicts:
      conflicts.filter((item) => item.status === 'open').length +
      outbox.filter((item) => item.state === 'conflict').length,
    rejected: outbox.filter((item) => item.state === 'rejected').length,
  };
}

export async function readMobileV2Bootstrap(): Promise<MobileV2BootstrapCheckpoint | null> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(META, 'readonly');
  const record = (await request(transaction.objectStore(META).get(BOOTSTRAP_KEY))) as
    { value?: MobileV2BootstrapCheckpoint } | undefined;
  await done(transaction);
  return record?.value ?? null;
}

export async function putMobileDeviceIdentity(value: {
  deviceId: string;
  devicePublicId: string;
  accountPublicId: string;
  displayName: string;
  token: string;
  scopes: string[];
  expiresAt: number;
}): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(DEVICES, 'readwrite');
  transaction.objectStore(DEVICES).put(value);
  await done(transaction);
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('Sync v2 IndexedDB request failed'));
  });
}
function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Sync v2 IndexedDB transaction failed'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Sync v2 IndexedDB transaction aborted'));
  });
}
