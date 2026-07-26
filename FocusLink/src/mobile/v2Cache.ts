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
import { openMobileDatabase } from './cache';

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
  updatedAt: number;
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
