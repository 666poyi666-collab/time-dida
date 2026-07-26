import { randomUUID } from 'node:crypto';

import { fingerprintDeviceSyncValue, toDeviceSyncBundle } from '@shared/sync/deviceProtocol';
import {
  SYNC_V2_MAX_PULL,
  SYNC_V2_PROTOCOL_VERSION,
  splitBundleForSyncV2,
  type SyncV2BootstrapEntitiesResponse,
  type SyncV2BootstrapInventoryResponse,
  type SyncV2Epoch,
  type SyncV2Mutation,
  type SyncV2Request,
  type SyncV2Response,
} from '@shared/sync/v2Protocol';
import {
  getDb,
  getMeta,
  listFinishedSessionsForDeviceSync,
  listPauses,
  listSegments,
  setMeta,
} from '../db/index.js';
import {
  claimV2Outbox,
  confirmMatchingRemoteV2Entity,
  enqueueV2Mutation,
  retryV2Lease,
  settleV2Ack,
  writeV2EntityState,
} from './v2OutboxStore.js';
import { getDeviceSyncDataConnection } from './deviceSyncService.js';

const CHECKPOINT_KEY = 'syncV2.desktop.checkpoint';

interface Checkpoint extends SyncV2Epoch {
  state:
    'uninitialized' | 'inventory-uploaded' | 'manifest-received' | 'base-established' | 'v2-active';
  bootstrapId: string | null;
  cursor: string | null;
}

export async function runDesktopSyncV2(): Promise<{
  uploaded: number;
  downloaded: number;
  conflicts: number;
} | null> {
  const connection = getDeviceSyncDataConnection();
  if (!connection) return null;
  let checkpoint = readCheckpoint();
  if (checkpoint.state !== 'v2-active') checkpoint = await bootstrap(connection, checkpoint);
  enqueueChangedEntities(connection.deviceId, checkpoint.accountGeneration);
  const localEntities = new Map(
    collectEntities(connection.deviceId).map((entity) => [
      `${entity.entityType}\u0000${entity.entityId}`,
      entity,
    ]),
  );
  const migrationConflicts = getDb()
    .prepare(
      "SELECT COUNT(*) AS count FROM sync_outbox WHERE state = 'conflict' AND error_code = 'revision_conflict'",
    )
    .get() as { count: number };
  if (migrationConflicts.count > 0) checkpoint = { ...checkpoint, cursor: null };
  let uploaded = 0;
  let downloaded = 0;
  let conflicts = 0;
  for (let batch = 0; batch < 250; batch += 1) {
    // A single ledger can approach 512 KiB; one mutation keeps the complete request below 1 MiB.
    const claimed = claimV2Outbox(1);
    const request: SyncV2Request = {
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      deviceId: connection.deviceId,
      cursor: checkpoint.cursor,
      mutations: claimed.items.map(toMutation),
      pullLimit: Math.min(20, SYNC_V2_MAX_PULL),
      syncEpoch: checkpoint.syncEpoch,
      cursorEpoch: checkpoint.cursorEpoch,
      accountGeneration: checkpoint.accountGeneration,
    };
    let response: SyncV2Response;
    try {
      response = await post<SyncV2Response>(
        connection.endpoint,
        connection.accessToken,
        '/v2/sync',
        request,
      );
    } catch (error) {
      retryV2Lease(
        claimed.leaseId,
        error instanceof Error ? error.message : 'network',
        Date.now() + 30_000,
      );
      throw error;
    }
    for (const ack of response.acks) {
      const item = claimed.items.find((candidate) => candidate.opId === ack.opId);
      if (item) settleV2Ack(claimed.leaseId, ack, item.payload, response);
    }
    for (const change of response.changes) {
      if (change.deleted || change.payload === null) continue;
      const local = localEntities.get(`${change.entityType}\u0000${change.entityId}`);
      if (!local || local.payload === null) continue;
      const localFingerprint = fingerprintDeviceSyncValue({
        deleted: false,
        payload: local.payload,
      });
      if (localFingerprint !== change.fingerprint) continue;
      confirmMatchingRemoteV2Entity({
        entityType: change.entityType,
        entityId: change.entityId,
        revision: change.revision,
        fingerprint: change.fingerprint,
        payload: local.payload,
        epoch: response,
      });
    }
    uploaded += response.acks.filter(
      (ack) => ack.status === 'applied' || ack.status === 'duplicate',
    ).length;
    downloaded += response.changes.length;
    conflicts += response.acks.filter((ack) => ack.status === 'conflict').length;
    checkpoint = { ...checkpoint, ...response, state: 'v2-active', cursor: response.nextCursor };
    writeCheckpoint(checkpoint);
    if (claimed.items.length === 0 && !response.hasMore) break;
  }
  // Remote materialization is deliberately restricted to metadata until conflict UI chooses a
  // correction; immutable ledgers continue through the proven v1 bundle importer during dual-stack.
  return { uploaded, downloaded, conflicts };
}

async function bootstrap(
  connection: { endpoint: string; accessToken: string; deviceId: string },
  checkpoint: Checkpoint,
): Promise<Checkpoint> {
  const entities = collectEntities(connection.deviceId);
  const bootstrapId = checkpoint.bootstrapId ?? randomUUID();
  const manifest = await post<SyncV2BootstrapInventoryResponse>(
    connection.endpoint,
    connection.accessToken,
    '/v2/bootstrap/inventory',
    {
      protocolVersion: 2,
      deviceId: connection.deviceId,
      bootstrapId,
      inventory: entities.map((entity) => ({
        entityId: entity.entityId,
        entityType: entity.entityType,
        fingerprint: fingerprintDeviceSyncValue({ deleted: false, payload: entity.payload }),
        localUpdatedAt:
          entity.payload && 'updatedAt' in entity.payload
            ? Number(entity.payload.updatedAt)
            : Date.now(),
        deleted: false,
      })),
    },
  );
  const needed = new Set(
    manifest.manifest
      .filter((item) => item.disposition === 'need-upload')
      .map((item) => `${item.entityType}\u0000${item.entityId}`),
  );
  const mutations = entities
    .filter((entity) => needed.has(`${entity.entityType}\u0000${entity.entityId}`))
    .map((entity) => ({
      ...entity,
      opId: `bootstrap-${fingerprintDeviceSyncValue(entity)}`,
      kind: 'put' as const,
      baseRevision: 0,
      baseFingerprint: null,
      accountGeneration: manifest.accountGeneration,
    }));
  const established = await post<SyncV2BootstrapEntitiesResponse>(
    connection.endpoint,
    connection.accessToken,
    '/v2/bootstrap/entities',
    {
      protocolVersion: 2,
      deviceId: connection.deviceId,
      bootstrapId,
      entities: mutations,
    },
  );
  for (const ack of established.acks) {
    const mutation = mutations.find((candidate) => candidate.opId === ack.opId);
    if (
      mutation &&
      ack.revision !== null &&
      ack.fingerprint !== null &&
      (ack.status === 'applied' || ack.status === 'duplicate')
    ) {
      writeV2EntityState({
        entityType: ack.entityType,
        entityId: ack.entityId,
        revision: ack.revision,
        fingerprint: ack.fingerprint,
        payload: mutation.payload,
        epoch: established,
      });
    }
  }
  const next: Checkpoint = {
    state: 'v2-active',
    bootstrapId,
    cursor: established.cursor,
    syncEpoch: established.syncEpoch,
    cursorEpoch: established.cursorEpoch,
    accountGeneration: established.accountGeneration,
  };
  writeCheckpoint(next);
  return next;
}

function enqueueChangedEntities(deviceId: string, accountGeneration: number): void {
  const db = getDb();
  for (const entity of collectEntities(deviceId)) {
    const row = db
      .prepare(
        'SELECT confirmed_revision AS revision, confirmed_fingerprint AS fingerprint FROM sync_entity_state WHERE entity_type = ? AND entity_id = ?',
      )
      .get(entity.entityType, entity.entityId) as
      { revision: number; fingerprint: string } | undefined;
    const fingerprint = fingerprintDeviceSyncValue({ deleted: false, payload: entity.payload });
    if (row?.fingerprint === fingerprint) continue;
    enqueueV2Mutation({
      ...entity,
      opId: `v2-${fingerprintDeviceSyncValue({ ...entity, baseRevision: row?.revision ?? 0 })}`,
      kind: 'put',
      baseRevision: row?.revision ?? 0,
      baseFingerprint: row?.fingerprint ?? null,
      accountGeneration,
    });
  }
}

function collectEntities(
  deviceId: string,
): Array<Pick<SyncV2Mutation, 'entityType' | 'entityId' | 'payload' | 'deviceId'>> {
  return listFinishedSessionsForDeviceSync().flatMap((session) => {
    const split = splitBundleForSyncV2(
      toDeviceSyncBundle(session, listSegments(session.id), listPauses(session.id)),
      deviceId,
    );
    return [
      {
        entityType: 'focus_ledger_v2' as const,
        entityId: session.id,
        payload: split.ledger,
        deviceId,
      },
      {
        entityType: 'focus_metadata_v2' as const,
        entityId: session.id,
        payload: split.metadata,
        deviceId,
      },
    ];
  });
}

function toMutation(item: ReturnType<typeof claimV2Outbox>['items'][number]): SyncV2Mutation {
  return {
    opId: item.opId,
    entityType: item.entityType,
    entityId: item.entityId,
    kind: item.kind,
    baseRevision: item.baseRevision,
    baseFingerprint: item.baseFingerprint,
    payload: item.payload,
    deviceId: item.deviceId,
    accountGeneration: item.accountGeneration,
  };
}

function readCheckpoint(): Checkpoint {
  const raw = getMeta(CHECKPOINT_KEY);
  if (!raw)
    return {
      state: 'uninitialized',
      bootstrapId: null,
      cursor: null,
      syncEpoch: '',
      cursorEpoch: '',
      accountGeneration: 1,
    };
  try {
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return {
      state: 'uninitialized',
      bootstrapId: null,
      cursor: null,
      syncEpoch: '',
      cursorEpoch: '',
      accountGeneration: 1,
    };
  }
}
function writeCheckpoint(value: Checkpoint): void {
  setMeta(CHECKPOINT_KEY, JSON.stringify(value));
}
async function post<T>(
  endpoint: string,
  token: string,
  pathname: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${endpoint}${pathname}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`Sync v2 ${pathname} failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}
