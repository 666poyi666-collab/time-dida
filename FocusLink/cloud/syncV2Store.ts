import fs from 'node:fs';
import path from 'node:path';

import { fingerprintDeviceSyncValue } from '../shared/sync/deviceProtocol';
import {
  SYNC_V2_PROTOCOL_VERSION,
  type SyncV2Ack,
  type SyncV2BootstrapEntitiesRequest,
  type SyncV2BootstrapEntitiesResponse,
  type SyncV2BootstrapInventoryRequest,
  type SyncV2BootstrapInventoryResponse,
  type SyncV2Change,
  type SyncV2EntityType,
  type SyncV2Epoch,
  type SyncV2ManifestItem,
  type SyncV2Mutation,
  type SyncV2Payload,
  type SyncV2Request,
  type SyncV2Response,
} from '../shared/sync/v2Protocol';

interface StoredEntity {
  revision: number;
  fingerprint: string;
  deleted: boolean;
  payload: SyncV2Payload | null;
  deleteChangeSeq: number | null;
  deletedAt: number | null;
  purgeAfter: number | null;
}

interface StoredOperation {
  fingerprint: string;
  ack: SyncV2Ack;
}
interface StoredBootstrap {
  deviceId: string;
  state: string;
  manifest: SyncV2ManifestItem[];
}
interface V2Account {
  epoch: SyncV2Epoch;
  changeSeq: number;
  entities: Map<string, StoredEntity>;
  operations: Map<string, StoredOperation>;
  changes: SyncV2Change[];
  bootstraps: Map<string, StoredBootstrap>;
  devices: Map<string, { lastSeenAt: number; watermark: number; stale: boolean }>;
}

interface PersistedAccount extends Omit<
  V2Account,
  'entities' | 'operations' | 'bootstraps' | 'devices'
> {
  entities: Array<[string, StoredEntity]>;
  operations: Array<[string, StoredOperation]>;
  bootstraps: Array<[string, StoredBootstrap]>;
  devices: Array<[string, { lastSeenAt: number; watermark: number; stale: boolean }]>;
}

export class SyncV2StoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class SyncV2Store {
  private readonly persistencePath: string | undefined;
  private readonly now: () => number;
  private accounts = new Map<string, V2Account>();

  constructor(options: { persistencePath?: string; now?: () => number } = {}) {
    this.persistencePath = options.persistencePath
      ? path.resolve(options.persistencePath)
      : undefined;
    this.now = options.now ?? Date.now;
    if (this.persistencePath && fs.existsSync(this.persistencePath)) {
      const data = JSON.parse(fs.readFileSync(this.persistencePath, 'utf8')) as {
        format: string;
        accounts: Array<[string, PersistedAccount]>;
      };
      if (data.format !== 'focuslink-sync-v2-node-1')
        throw new SyncV2StoreError('store_corrupt', 'invalid v2 store format');
      this.accounts = new Map(data.accounts.map(([id, account]) => [id, hydrate(account)]));
    }
  }

  inventory(
    accountId: string,
    request: SyncV2BootstrapInventoryRequest,
  ): SyncV2BootstrapInventoryResponse {
    const account = cloneAccount(this.account(accountId));
    const manifest = request.inventory.map<SyncV2ManifestItem>((item) => {
      const remote = account.entities.get(key(item.entityType, item.entityId));
      return {
        ...item,
        disposition: !remote
          ? 'need-upload'
          : remote.fingerprint === item.fingerprint && remote.deleted === item.deleted
            ? 'already-known'
            : remote.deleted && !item.deleted
              ? 'need-download'
              : 'fingerprint-conflict',
        confirmedRevision: remote?.revision ?? null,
        confirmedFingerprint: remote?.fingerprint ?? null,
      };
    });
    account.bootstraps.set(request.bootstrapId, {
      deviceId: request.deviceId,
      state: 'manifest-received',
      manifest,
    });
    touchDevice(account, request.deviceId, this.now());
    this.commit(accountId, account);
    return {
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      bootstrapId: request.bootstrapId,
      state: 'manifest-received',
      manifest,
      ...account.epoch,
      cursor: encodeCursor(accountId, account.epoch, account.changeSeq),
    };
  }

  establish(
    accountId: string,
    request: SyncV2BootstrapEntitiesRequest,
  ): SyncV2BootstrapEntitiesResponse {
    const account = cloneAccount(this.account(accountId));
    const bootstrap = account.bootstraps.get(request.bootstrapId);
    if (!bootstrap || bootstrap.deviceId !== request.deviceId)
      throw new SyncV2StoreError('bootstrap_state_invalid', 'bootstrap manifest missing');
    const acks = request.entities.map((mutation) => applyMutation(account, mutation, this.now()));
    bootstrap.state = 'base-established';
    this.commit(accountId, account);
    return {
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      bootstrapId: request.bootstrapId,
      state: 'base-established',
      acks,
      ...account.epoch,
      cursor: encodeCursor(accountId, account.epoch, account.changeSeq),
    };
  }

  sync(accountId: string, request: SyncV2Request): SyncV2Response {
    const account = cloneAccount(this.account(accountId));
    assertEpoch(request, account.epoch);
    const cursor = decodeCursor(accountId, request.cursor, account.epoch, account.changeSeq);
    const acks = request.mutations.map((mutation) => applyMutation(account, mutation, this.now()));
    const available = account.changes.filter((change) => change.changeSeq > cursor);
    const changes = available.slice(0, request.pullLimit);
    const nextSeq = changes.at(-1)?.changeSeq ?? cursor;
    touchDevice(account, request.deviceId, this.now());
    const device = account.devices.get(request.deviceId)!;
    device.watermark = nextSeq;
    this.commit(accountId, account);
    return {
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      ...account.epoch,
      acks,
      changes: structuredClone(changes),
      nextCursor: encodeCursor(accountId, account.epoch, nextSeq),
      hasMore: available.length > changes.length,
      serverTime: this.now(),
    };
  }

  private account(accountId: string): V2Account {
    return this.accounts.get(accountId) ?? emptyAccount();
  }

  private commit(accountId: string, account: V2Account): void {
    const next = new Map(this.accounts);
    next.set(accountId, account);
    if (this.persistencePath) {
      fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true });
      const temp = `${this.persistencePath}.${process.pid}.tmp`;
      fs.writeFileSync(
        temp,
        JSON.stringify({
          format: 'focuslink-sync-v2-node-1',
          accounts: [...next].map(([id, value]) => [id, serialize(value)]),
        }),
      );
      fs.renameSync(temp, this.persistencePath);
    }
    this.accounts = next;
  }
}

function applyMutation(account: V2Account, mutation: SyncV2Mutation, now: number): SyncV2Ack {
  const opFingerprint = fingerprintDeviceSyncValue(mutation);
  const previous = account.operations.get(mutation.opId);
  if (previous)
    return previous.fingerprint === opFingerprint
      ? {
          ...previous.ack,
          status: previous.ack.status === 'applied' ? 'duplicate' : previous.ack.status,
        }
      : ack(mutation, 'rejected', null, null, 'op_id_reused');
  if (mutation.accountGeneration !== account.epoch.accountGeneration) {
    return storeAck(
      account,
      opFingerprint,
      mutation,
      'rejected',
      null,
      null,
      'account_generation_changed',
    );
  }
  const entityKey = key(mutation.entityType, mutation.entityId);
  const current = account.entities.get(entityKey);
  if (mutation.baseRevision !== (current?.revision ?? 0)) {
    return storeAck(
      account,
      opFingerprint,
      mutation,
      'conflict',
      current?.revision ?? null,
      current?.fingerprint ?? null,
      'revision_conflict',
    );
  }
  const deleted = mutation.kind === 'delete' || mutation.kind === 'purge';
  const payload = deleted ? null : structuredClone(mutation.payload);
  const fingerprint = fingerprintDeviceSyncValue({ deleted, payload });
  const revision = (current?.revision ?? 0) + 1;
  const changeSeq = ++account.changeSeq;
  account.entities.set(entityKey, {
    revision,
    fingerprint,
    deleted,
    payload,
    deleteChangeSeq: deleted ? changeSeq : null,
    deletedAt: deleted ? now : null,
    purgeAfter: deleted ? now + 180 * 24 * 60 * 60 * 1000 : null,
  });
  account.changes.push({
    changeSeq,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    revision,
    fingerprint,
    deleted,
    payload,
    sourceDeviceId: mutation.deviceId,
  });
  return storeAck(account, opFingerprint, mutation, 'applied', revision, fingerprint, null);
}

function storeAck(
  account: V2Account,
  fingerprint: string,
  mutation: SyncV2Mutation,
  status: SyncV2Ack['status'],
  revision: number | null,
  entityFingerprint: string | null,
  errorCode: string | null,
): SyncV2Ack {
  const value = ack(mutation, status, revision, entityFingerprint, errorCode);
  account.operations.set(mutation.opId, { fingerprint, ack: value });
  return value;
}

function ack(
  mutation: SyncV2Mutation,
  status: SyncV2Ack['status'],
  revision: number | null,
  fingerprint: string | null,
  errorCode: string | null,
): SyncV2Ack {
  return {
    opId: mutation.opId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    status,
    revision,
    fingerprint,
    errorCode,
  };
}

function touchDevice(account: V2Account, id: string, now: number): void {
  const current = account.devices.get(id);
  account.devices.set(id, { lastSeenAt: now, watermark: current?.watermark ?? 0, stale: false });
  for (const device of account.devices.values())
    if (now - device.lastSeenAt >= 90 * 24 * 60 * 60 * 1000) device.stale = true;
}

function emptyAccount(): V2Account {
  return {
    epoch: { syncEpoch: 'sync-1', cursorEpoch: 'cursor-1', accountGeneration: 1 },
    changeSeq: 0,
    entities: new Map(),
    operations: new Map(),
    changes: [],
    bootstraps: new Map(),
    devices: new Map(),
  };
}
function key(type: SyncV2EntityType, id: string): string {
  return `${type}\u0000${id}`;
}
function cloneAccount(value: V2Account): V2Account {
  return hydrate(serialize(value));
}
function serialize(value: V2Account): PersistedAccount {
  return {
    ...structuredClone({ epoch: value.epoch, changeSeq: value.changeSeq, changes: value.changes }),
    entities: [...value.entities],
    operations: [...value.operations],
    bootstraps: [...value.bootstraps],
    devices: [...value.devices],
  };
}
function hydrate(value: PersistedAccount): V2Account {
  return {
    epoch: value.epoch,
    changeSeq: value.changeSeq,
    changes: value.changes,
    entities: new Map(value.entities),
    operations: new Map(value.operations),
    bootstraps: new Map(value.bootstraps),
    devices: new Map(value.devices),
  };
}
function encodeCursor(accountId: string, epoch: SyncV2Epoch, sequence: number): string {
  return Buffer.from(JSON.stringify({ accountId, ...epoch, sequence }), 'utf8').toString(
    'base64url',
  );
}
function decodeCursor(
  accountId: string,
  cursor: string | null,
  epoch: SyncV2Epoch,
  max: number,
): number {
  if (cursor === null) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as SyncV2Epoch & {
      accountId: string;
      sequence: number;
    };
    if (value.accountId !== accountId || value.sequence < 0 || value.sequence > max)
      throw new Error();
    assertEpoch(value, epoch);
    return value.sequence;
  } catch (error) {
    if (error instanceof SyncV2StoreError) throw error;
    throw new SyncV2StoreError('invalid_cursor', 'invalid v2 cursor');
  }
}
function assertEpoch(actual: SyncV2Epoch, expected: SyncV2Epoch): void {
  if (actual.accountGeneration !== expected.accountGeneration)
    throw new SyncV2StoreError('account_generation_changed', 'account generation changed');
  if (actual.syncEpoch !== expected.syncEpoch)
    throw new SyncV2StoreError('sync_epoch_changed', 'sync epoch changed');
  if (actual.cursorEpoch !== expected.cursorEpoch)
    throw new SyncV2StoreError('cursor_epoch_changed', 'cursor epoch changed');
}
