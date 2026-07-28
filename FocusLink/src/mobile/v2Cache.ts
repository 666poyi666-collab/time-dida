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
const LAST_VERIFIED_KEY = 'syncV2.lastVerified';
const LAST_ERROR_KEY = 'syncV2.lastErrorCode';

export interface MobileV2BootstrapCheckpoint extends SyncV2Epoch {
  key: typeof BOOTSTRAP_KEY;
  state: SyncV2BootstrapState;
  bootstrapId: string | null;
  cursor: string | null;
  /** Device credential that owns this cursor and outbox view. */
  boundDeviceId: string;
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
  if (input.checkpoint.boundDeviceId !== input.deviceId) {
    throw new Error('Sync v2 checkpoint 与当前设备凭据不匹配');
  }
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
  const completion = done(transaction);
  try {
    const result = await readThreeInTransaction(
      entityStore.getAll(),
      outboxStore.getAll(),
      bundleStore.getAll(),
      (storedStates, pending, cached) => {
        const states = new Map(
          storedStates.map((state) => [`${state.entityType}\u0000${state.entityId}`, state]),
        );
        const pendingByEntity = new Map(
          pending.map((item) => [`${item.entityType}\u0000${item.entityId}`, item]),
        );
        const pendingByOpId = new Map(pending.map((item) => [item.opId, item]));
        const cachedById = new Map(cached.map((item) => [item.entityId, item]));
        const affected = new Set<string>();
        let conflicts = 0;

        for (const ack of input.acks ?? []) {
          if (!input.leaseId) throw new Error('Sync v2 ACK 缺少持久 lease');
          const item = pendingByOpId.get(ack.opId);
          if (
            !item ||
            item.leaseId !== input.leaseId ||
            item.deviceId !== input.deviceId ||
            item.accountGeneration !== input.checkpoint.accountGeneration ||
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
          const pendingItem = pendingByEntity.get(key);
          if (existing && change.revision < existing.confirmedRevision) {
            putRemoteConflict(
              conflictStore,
              historyStore,
              change,
              existing.baseSnapshot,
              pendingItem?.payload ?? existing.baseSnapshot,
              ['revision_rollback'],
            );
            conflicts += 1;
            continue;
          }
          if (existing && change.revision === existing.confirmedRevision) {
            if (change.fingerprint !== existing.confirmedFingerprint) {
              putRemoteConflict(
                conflictStore,
                historyStore,
                change,
                existing.baseSnapshot,
                pendingItem?.payload ?? existing.baseSnapshot,
                ['same_revision_fingerprint_mismatch'],
              );
              conflicts += 1;
              continue;
            }
            affected.add(change.entityId);
            continue;
          }
          const pendingFingerprint = pendingItem
            ? fingerprintDeviceSyncValue({
                deleted: pendingItem.payload === null,
                payload: pendingItem.payload,
              })
            : null;
          if (pendingFingerprint !== null && pendingFingerprint !== change.fingerprint) {
            putRemoteConflict(
              conflictStore,
              historyStore,
              change,
              existing?.baseSnapshot ?? null,
              pendingItem?.payload ?? null,
              [change.deleted ? 'deleted' : 'payload'],
            );
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
          if (!validation.ok)
            throw new Error(`远端 v2 会话无法物化：${validation.error ?? 'invalid'}`);
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
        const verifiedAt = Date.now();
        metaStore.put({ key: 'lastSyncAt', value: verifiedAt });
        metaStore.put({ key: 'serverTime', value: input.serverTime });
        metaStore.put({
          key: LAST_VERIFIED_KEY,
          value: { deviceId: input.deviceId, at: verifiedAt },
        });
        metaStore.put({ key: LAST_ERROR_KEY, value: { deviceId: input.deviceId, code: null } });
        return { imported, conflicts };
      },
    );
    await completion;
    return result;
  } catch (error) {
    // Any validation or materialization failure must keep the outbox item and
    // cursor together. IndexedDB otherwise commits already queued writes when
    // an async function throws before awaiting the transaction completion.
    try {
      transaction.abort();
    } catch {
      // The transaction may already have aborted because its request failed.
    }
    await completion.catch(() => undefined);
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
  const store = transaction.objectStore(OUTBOX);
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
  try {
    const existing = (await request(store.get(mutation.opId))) as SyncV2OutboxItem | undefined;
    if (existing) {
      if (!sameMutation(existing, mutation)) {
        throw new Error('同一 Sync v2 opId 对应了不同 payload');
      }
    } else {
      store.add(record);
    }
    await done(transaction);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // A request failure can abort the transaction before this catch runs.
    }
    throw error;
  } finally {
    database.close();
  }
}

export async function claimMobileV2Outbox(
  boundDeviceId: string,
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
        item.deviceId === boundDeviceId &&
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
  database.close();
  return { leaseId, items };
}

export async function settleMobileV2Ack(input: {
  leaseId: string;
  deviceId: string;
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
  if (
    !item ||
    item.leaseId !== input.leaseId ||
    item.deviceId !== input.deviceId ||
    item.accountGeneration !== input.epoch.accountGeneration ||
    item.entityType !== input.ack.entityType ||
    item.entityId !== input.ack.entityId
  ) {
    transaction.abort();
    database.close();
    return false;
  }
  if (input.ack.status === 'applied' || input.ack.status === 'duplicate') {
    if (input.ack.revision === null || input.ack.fingerprint === null) {
      transaction.abort();
      database.close();
      return false;
    }
    const state: MobileV2EntityState = {
      entityType: input.ack.entityType,
      entityId: input.ack.entityId,
      confirmedRevision: input.ack.revision,
      confirmedFingerprint: input.ack.fingerprint,
      baseSnapshot: input.payload,
      deleted: input.payload === null,
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
  database.close();
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
  database.close();
  return changed;
}

export async function writeMobileV2Conflict(conflict: SyncV2Conflict): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(CONFLICTS, 'readwrite');
  transaction.objectStore(CONFLICTS).put(conflict);
  await done(transaction);
  database.close();
}

export async function readMobileV2Conflicts(): Promise<SyncV2Conflict[]> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(CONFLICTS, 'readonly');
  const values = (await request(transaction.objectStore(CONFLICTS).getAll())) as SyncV2Conflict[];
  await done(transaction);
  database.close();
  return values;
}

export async function readMobileV2OperationHistory(): Promise<unknown[]> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(HISTORY, 'readonly');
  const values = (await request(transaction.objectStore(HISTORY).getAll())) as unknown[];
  await done(transaction);
  database.close();
  return values;
}

export async function readMobileV2EntityState(
  entityType: SyncV2Mutation['entityType'],
  entityId: string,
): Promise<MobileV2EntityState | null> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(ENTITY_STATE, 'readonly');
  const value = await request(transaction.objectStore(ENTITY_STATE).get([entityType, entityId]));
  await done(transaction);
  database.close();
  return (value as MobileV2EntityState | undefined) ?? null;
}

export async function writeMobileV2EntityState(value: MobileV2EntityState): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(ENTITY_STATE, 'readwrite');
  transaction.objectStore(ENTITY_STATE).put(value);
  await done(transaction);
  database.close();
}

export async function writeMobileV2Bootstrap(
  checkpoint: MobileV2BootstrapCheckpoint,
): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(META, 'readwrite');
  transaction.objectStore(META).put({ key: BOOTSTRAP_KEY, value: checkpoint });
  await done(transaction);
  database.close();
}

export async function resetMobileV2Epoch(checkpoint: MobileV2BootstrapCheckpoint): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(
    [OUTBOX, ENTITY_STATE, CONFLICTS, HISTORY, 'bundles', META],
    'readwrite',
  );
  const outbox = transaction.objectStore(OUTBOX);
  const records = (await request(outbox.getAll())) as SyncV2OutboxItem[];
  const history = transaction.objectStore(HISTORY);
  const now = Date.now();
  for (const item of records) {
    const deviceCredentialChanged = item.deviceId !== checkpoint.boundDeviceId;
    const accountGenerationChanged = item.accountGeneration !== checkpoint.accountGeneration;
    if (
      (deviceCredentialChanged || accountGenerationChanged) &&
      (item.state === 'pending' || item.state === 'uploading' || item.state === 'retry')
    ) {
      history.put({
        opId: item.opId,
        entityType: item.entityType,
        entityId: item.entityId,
        status: deviceCredentialChanged ? 'device-credential-changed' : 'generation-requeued',
        revision: null,
        errorCode: deviceCredentialChanged
          ? 'device_credential_changed'
          : 'account_generation_changed',
        completedAt: now,
      });
      outbox.delete(item.opId);
    }
  }
  transaction.objectStore(ENTITY_STATE).clear();
  transaction.objectStore(CONFLICTS).clear();
  transaction.objectStore('bundles').clear();
  transaction.objectStore(META).delete(LAST_VERIFIED_KEY);
  transaction.objectStore(META).delete(LAST_ERROR_KEY);
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

export async function readMobileV2Status(boundDeviceId: string): Promise<{
  pending: number;
  conflicts: number;
  rejected: number;
  lastVerifiedAt: number | null;
  lastErrorCode: string | null;
}> {
  const database = await openMobileDatabase();
  const transaction = database.transaction([OUTBOX, CONFLICTS, META], 'readonly');
  const [outbox, conflicts, lastVerified, lastError] = await Promise.all([
    request(transaction.objectStore(OUTBOX).getAll()) as Promise<SyncV2OutboxItem[]>,
    request(transaction.objectStore(CONFLICTS).getAll()) as Promise<SyncV2Conflict[]>,
    request(transaction.objectStore(META).get(LAST_VERIFIED_KEY)) as Promise<
      { value?: unknown } | undefined
    >,
    request(transaction.objectStore(META).get(LAST_ERROR_KEY)) as Promise<
      { value?: unknown } | undefined
    >,
  ]);
  await done(transaction);
  database.close();
  const currentOutbox = outbox.filter((item) => item.deviceId === boundDeviceId);
  const verified = scopedStatusValue(lastVerified?.value, boundDeviceId);
  const error = scopedStatusValue(lastError?.value, boundDeviceId);
  return {
    pending: currentOutbox.filter(
      (item) => item.state === 'pending' || item.state === 'uploading' || item.state === 'retry',
    ).length,
    conflicts:
      conflicts.filter((item) => item.status === 'open').length +
      currentOutbox.filter((item) => item.state === 'conflict').length,
    rejected: currentOutbox.filter((item) => item.state === 'rejected').length,
    lastVerifiedAt: typeof verified?.at === 'number' ? verified.at : null,
    lastErrorCode: typeof error?.code === 'string' ? error.code : null,
  };
}

export async function writeMobileV2SyncFailure(deviceId: string, errorCode: string): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(META, 'readwrite');
  transaction.objectStore(META).put({
    key: LAST_ERROR_KEY,
    value: { deviceId, code: errorCode.slice(0, 80) },
  });
  await done(transaction);
  database.close();
}

export async function readMobileV2Bootstrap(): Promise<MobileV2BootstrapCheckpoint | null> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(META, 'readonly');
  const record = (await request(transaction.objectStore(META).get(BOOTSTRAP_KEY))) as
    { value?: MobileV2BootstrapCheckpoint } | undefined;
  await done(transaction);
  database.close();
  return record?.value ?? null;
}

export async function putMobileDeviceIdentity(value: {
  deviceId: string;
  devicePublicId: string;
  accountPublicId: string;
  displayName: string;
  scopes: string[];
  expiresAt: number;
}): Promise<void> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(DEVICES, 'readwrite');
  // Construct an explicit allowlisted object so a caller using `as any` cannot
  // smuggle token/cookie/Authorization fields into ordinary IndexedDB.
  transaction.objectStore(DEVICES).put({
    deviceId: value.deviceId,
    devicePublicId: value.devicePublicId,
    accountPublicId: value.accountPublicId,
    displayName: value.displayName,
    scopes: [...value.scopes],
    expiresAt: value.expiresAt,
  });
  await done(transaction);
  database.close();
}

export async function readMobileDeviceIdentity(deviceId: string): Promise<unknown> {
  const database = await openMobileDatabase();
  const transaction = database.transaction(DEVICES, 'readonly');
  const value = await request(transaction.objectStore(DEVICES).get(deviceId));
  await done(transaction);
  database.close();
  return value;
}

function putRemoteConflict(
  conflictStore: IDBObjectStore,
  historyStore: IDBObjectStore,
  change: SyncV2Change,
  base: SyncV2Payload | null,
  local: SyncV2Payload | null,
  fields: string[],
): void {
  const now = Date.now();
  conflictStore.put({
    conflictId: `remote-${change.changeSeq}-${change.entityType}-${change.entityId}`,
    entityType: change.entityType,
    entityId: change.entityId,
    base,
    local,
    remote: change.payload,
    fields,
    sourceDeviceIds: [change.sourceDeviceId],
    status: 'open',
    createdAt: now,
    resolvedAt: null,
    resolutionOpId: null,
  } satisfies SyncV2Conflict);
  historyStore.put({
    opId: `remote-${change.changeSeq}`,
    entityType: change.entityType,
    entityId: change.entityId,
    status: 'conflict',
    revision: change.revision,
    errorCode: fields[0] ?? 'remote_conflict',
    completedAt: now,
  });
}

function sameMutation(left: SyncV2Mutation, right: SyncV2Mutation): boolean {
  return (
    left.opId === right.opId &&
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

function scopedStatusValue(value: unknown, deviceId: string): Record<string, unknown> | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { deviceId?: unknown }).deviceId !== deviceId
  ) {
    return null;
  }
  return value as Record<string, unknown>;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('Sync v2 IndexedDB request failed'));
  });
}

/**
 * Runs the write phase from the last IndexedDB success callback. Older Android
 * WebViews may auto-commit a readwrite transaction before an awaited Promise
 * continuation can enqueue more requests.
 */
function readThreeInTransaction<A, B, C, R>(
  first: IDBRequest<A>,
  second: IDBRequest<B>,
  third: IDBRequest<C>,
  apply: (first: A, second: B, third: C) => R,
): Promise<R> {
  return new Promise((resolve, reject) => {
    let remaining = 3;
    let firstValue: A;
    let secondValue: B;
    let thirdValue: C;
    let settled = false;
    const fail = (error: DOMException | null) => {
      if (settled) return;
      settled = true;
      reject(error ?? new Error('Sync v2 IndexedDB request failed'));
    };
    const finish = () => {
      remaining -= 1;
      if (remaining !== 0 || settled) return;
      try {
        settled = true;
        resolve(apply(firstValue, secondValue, thirdValue));
      } catch (error) {
        settled = true;
        reject(error);
      }
    };
    first.onsuccess = () => {
      firstValue = first.result;
      finish();
    };
    second.onsuccess = () => {
      secondValue = second.result;
      finish();
    };
    third.onsuccess = () => {
      thirdValue = third.result;
      finish();
    };
    first.onerror = () => fail(first.error);
    second.onerror = () => fail(second.error);
    third.onerror = () => fail(third.error);
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
