import { fingerprintDeviceSyncValue } from '@shared/sync/deviceProtocol';
import {
  SYNC_V2_PROTOCOL_VERSION,
  splitBundleForSyncV2,
  type SyncV2BootstrapEntitiesResponse,
  type SyncV2BootstrapInventoryResponse,
  type SyncV2Mutation,
  type SyncV2Response,
} from '@shared/sync/v2Protocol';
import { readMobileCache } from './cache';
import {
  claimMobileV2Outbox,
  enqueueMobileV2Mutation,
  readMobileV2Bootstrap,
  readMobileV2EntityState,
  retryMobileV2Lease,
  settleMobileV2Ack,
  writeMobileV2Bootstrap,
  writeMobileV2EntityState,
} from './v2Cache';

export async function runMobileSyncV2(input: {
  endpoint: string;
  token: string;
  deviceId: string;
  signal?: AbortSignal;
}): Promise<{ uploaded: number; downloaded: number; conflicts: number }> {
  const entities = (await readMobileCache()).bundles.flatMap((cached) => {
    const split = splitBundleForSyncV2(cached.bundle, input.deviceId);
    return [
      { entityType: 'focus_ledger_v2' as const, entityId: cached.entityId, payload: split.ledger },
      {
        entityType: 'focus_metadata_v2' as const,
        entityId: cached.entityId,
        payload: split.metadata,
      },
    ];
  });
  let checkpoint = await readMobileV2Bootstrap();
  if (!checkpoint || checkpoint.state !== 'v2-active') {
    const bootstrapId = checkpoint?.bootstrapId ?? crypto.randomUUID();
    const manifest = await post<SyncV2BootstrapInventoryResponse>(
      input,
      '/v2/bootstrap/inventory',
      {
        protocolVersion: SYNC_V2_PROTOCOL_VERSION,
        deviceId: input.deviceId,
        bootstrapId,
        inventory: entities.map((entity) => ({
          entityId: entity.entityId,
          entityType: entity.entityType,
          fingerprint: fingerprintDeviceSyncValue({ deleted: false, payload: entity.payload }),
          localUpdatedAt:
            'updatedAt' in entity.payload ? Number(entity.payload.updatedAt) : Date.now(),
          deleted: false,
        })),
      },
    );
    await writeMobileV2Bootstrap({
      key: 'syncV2.bootstrap',
      state: 'manifest-received',
      bootstrapId,
      cursor: manifest.cursor,
      syncEpoch: manifest.syncEpoch,
      cursorEpoch: manifest.cursorEpoch,
      accountGeneration: manifest.accountGeneration,
      updatedAt: Date.now(),
    });
    const needed = new Set(
      manifest.manifest
        .filter((item) => item.disposition === 'need-upload')
        .map((item) => `${item.entityType}\u0000${item.entityId}`),
    );
    const mutations: SyncV2Mutation[] = entities
      .filter((entity) => needed.has(`${entity.entityType}\u0000${entity.entityId}`))
      .map((entity) => ({
        ...entity,
        opId: `bootstrap-${fingerprintDeviceSyncValue(entity)}`,
        kind: 'put',
        baseRevision: 0,
        baseFingerprint: null,
        deviceId: input.deviceId,
        accountGeneration: manifest.accountGeneration,
      }));
    const established = await post<SyncV2BootstrapEntitiesResponse>(
      input,
      '/v2/bootstrap/entities',
      {
        protocolVersion: 2,
        deviceId: input.deviceId,
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
        await writeMobileV2EntityState({
          entityType: ack.entityType,
          entityId: ack.entityId,
          confirmedRevision: ack.revision,
          confirmedFingerprint: ack.fingerprint,
          baseSnapshot: mutation.payload,
          syncEpoch: established.syncEpoch,
          cursorEpoch: established.cursorEpoch,
          accountGeneration: established.accountGeneration,
          updatedAt: Date.now(),
        });
      }
    }
    checkpoint = {
      key: 'syncV2.bootstrap',
      state: 'v2-active',
      bootstrapId,
      cursor: established.cursor,
      syncEpoch: established.syncEpoch,
      cursorEpoch: established.cursorEpoch,
      accountGeneration: established.accountGeneration,
      updatedAt: Date.now(),
    };
    await writeMobileV2Bootstrap(checkpoint);
  }
  for (const entity of entities) {
    const state = await readMobileV2EntityState(entity.entityType, entity.entityId);
    const fingerprint = fingerprintDeviceSyncValue({ deleted: false, payload: entity.payload });
    if (state?.confirmedFingerprint === fingerprint) continue;
    const mutation: SyncV2Mutation = {
      ...entity,
      opId: `v2-${fingerprintDeviceSyncValue({ ...entity, baseRevision: state?.confirmedRevision ?? 0 })}`,
      kind: 'put',
      baseRevision: state?.confirmedRevision ?? 0,
      baseFingerprint: state?.confirmedFingerprint ?? null,
      deviceId: input.deviceId,
      accountGeneration: checkpoint.accountGeneration,
    };
    try {
      await enqueueMobileV2Mutation(mutation);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'ConstraintError')) throw error;
    }
  }
  // Keep one potentially large ledger mutation below the Worker 1 MiB request budget.
  const claimed = await claimMobileV2Outbox(1);
  let response: SyncV2Response;
  try {
    response = await post<SyncV2Response>(input, '/v2/sync', {
      protocolVersion: 2,
      deviceId: input.deviceId,
      cursor: checkpoint.cursor,
      mutations: claimed.items.map(
        ({
          state: _state,
          attemptCount: _attemptCount,
          nextRetryAt: _nextRetryAt,
          leaseId: _leaseId,
          leaseExpiresAt: _leaseExpiresAt,
          claimedAt: _claimedAt,
          errorCode: _errorCode,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          ...mutation
        }) => mutation,
      ),
      pullLimit: 500,
      syncEpoch: checkpoint.syncEpoch,
      cursorEpoch: checkpoint.cursorEpoch,
      accountGeneration: checkpoint.accountGeneration,
    });
  } catch (error) {
    await retryMobileV2Lease(
      claimed.leaseId,
      error instanceof Error ? error.message : 'network',
      Date.now() + 30_000,
    );
    throw error;
  }
  for (const ack of response.acks) {
    const item = claimed.items.find((candidate) => candidate.opId === ack.opId);
    if (item)
      await settleMobileV2Ack({
        leaseId: claimed.leaseId,
        ack,
        payload: item.payload,
        epoch: response,
      });
  }
  await writeMobileV2Bootstrap({
    ...checkpoint,
    ...response,
    state: 'v2-active',
    cursor: response.nextCursor,
    updatedAt: Date.now(),
  });
  return {
    uploaded: response.acks.filter((ack) => ack.status === 'applied' || ack.status === 'duplicate')
      .length,
    downloaded: response.changes.length,
    conflicts: response.acks.filter((ack) => ack.status === 'conflict').length,
  };
}

async function post<T>(
  input: { endpoint: string; token: string; signal?: AbortSignal },
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${input.endpoint}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  if (!response.ok)
    throw new Error(`Sync v2 ${path} failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}
