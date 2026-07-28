import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { fingerprintDeviceSyncValue } from '../shared/sync/deviceProtocol';
import type { FocusMetadataV2, SyncV2Change, SyncV2Mutation } from '../shared/sync/v2Protocol';
import {
  applyMobileV2ChangesAndCheckpoint,
  claimMobileV2Outbox,
  enqueueMobileV2Mutation,
  putMobileDeviceIdentity,
  readMobileDeviceIdentity,
  readMobileV2EntityState,
  readMobileV2Conflicts,
  readMobileV2OperationHistory,
  readMobileV2Status,
  readMobileV2Bootstrap,
  resetMobileV2Epoch,
  retryMobileV2Lease,
  settleMobileV2Ack,
  writeMobileV2SyncFailure,
  writeMobileV2Bootstrap,
  writeMobileV2EntityState,
} from '../src/mobile/v2Cache';

const DATABASE_NAME = 'focuslink-mobile-preview';
const payload: FocusMetadataV2 = {
  sessionId: 'mobile-v2',
  title: '物理',
  note: null,
  subject: '物理',
  tags: [],
  taskAssociation: null,
  updatedAt: 1,
  updatedByDeviceId: 'phone',
};
const mutation: SyncV2Mutation = {
  opId: 'mobile-op',
  entityType: 'focus_metadata_v2',
  entityId: 'mobile-v2',
  kind: 'put',
  baseRevision: 0,
  baseFingerprint: null,
  payload,
  deviceId: 'phone',
  accountGeneration: 1,
};

describe('mobile Sync v2 persistence', () => {
  beforeEach(deleteDatabase);

  it('claims with a lease, retries after a failure and settles atomically', async () => {
    await enqueueMobileV2Mutation(mutation, 1);
    const first = await claimMobileV2Outbox('phone', 10, 2);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].state).toBe('uploading');
    expect(await retryMobileV2Lease(first.leaseId, 'network', 10, 3)).toBe(1);
    expect((await claimMobileV2Outbox('phone', 10, 9)).items).toHaveLength(0);
    const second = await claimMobileV2Outbox('phone', 10, 10);
    expect(
      await settleMobileV2Ack({
        leaseId: second.leaseId,
        deviceId: 'phone',
        payload,
        ack: {
          opId: mutation.opId,
          entityType: mutation.entityType,
          entityId: mutation.entityId,
          status: 'applied',
          revision: 1,
          fingerprint: fingerprintDeviceSyncValue(payload),
          errorCode: null,
        },
        epoch: { syncEpoch: 's1', cursorEpoch: 'c1', accountGeneration: 1 },
        now: 11,
      }),
    ).toBe(true);
    expect((await claimMobileV2Outbox('phone', 10, 12)).items).toHaveLength(0);
  });

  it('persists the explicit bootstrap migration state', async () => {
    await writeMobileV2Bootstrap({
      key: 'syncV2.bootstrap',
      state: 'manifest-received',
      bootstrapId: 'boot-1',
      cursor: 'cursor',
      boundDeviceId: 'phone',
      syncEpoch: 's1',
      cursorEpoch: 'c1',
      accountGeneration: 1,
      updatedAt: 1,
    });
    expect(await readMobileV2Bootstrap()).toMatchObject({
      state: 'manifest-received',
      bootstrapId: 'boot-1',
    });
  });

  it('does not delete an accepted outbox item before the response page and cursor materialize', async () => {
    const atomicMutation: SyncV2Mutation = {
      ...mutation,
      opId: 'mobile-atomic-op',
      entityId: 'mobile-atomic',
      payload: { ...payload, sessionId: 'mobile-atomic' },
    };
    await enqueueMobileV2Mutation(atomicMutation, 100);
    const claimed = await claimMobileV2Outbox('phone', 1, 100);
    const checkpoint = {
      key: 'syncV2.bootstrap' as const,
      state: 'v2-active' as const,
      bootstrapId: null,
      cursor: 'c1',
      boundDeviceId: 'phone',
      syncEpoch: 's-atomic',
      cursorEpoch: 'c-atomic',
      accountGeneration: 1,
      updatedAt: 101,
    };
    const invalidLedger: SyncV2Change = {
      changeSeq: 1,
      entityType: 'focus_ledger_v2',
      entityId: 'mobile-atomic',
      revision: 1,
      fingerprint: 'a'.repeat(64),
      deleted: false,
      payload: {} as SyncV2Change['payload'],
      sourceDeviceId: 'remote-device',
    };

    await expect(
      applyMobileV2ChangesAndCheckpoint({
        changes: [invalidLedger],
        checkpoint,
        serverTime: 102,
        deviceId: atomicMutation.deviceId,
        leaseId: claimed.leaseId,
        acks: [
          {
            opId: atomicMutation.opId,
            entityType: atomicMutation.entityType,
            entityId: atomicMutation.entityId,
            status: 'applied',
            revision: 1,
            fingerprint: fingerprintDeviceSyncValue(atomicMutation.payload),
            errorCode: null,
          },
        ],
      }),
    ).rejects.toThrow('远端 v2 会话无法物化');

    expect(await readMobileV2EntityState('focus_metadata_v2', 'mobile-atomic')).toBeNull();
    expect(await readMobileV2Status('phone')).toMatchObject({ pending: 1 });
    expect((await claimMobileV2Outbox('phone', 1, 100 + 30_001)).items).toHaveLength(1);
    expect((await readMobileV2Bootstrap())?.cursor).not.toBe('c1');
  });

  it('keeps opId idempotent and rejects the same opId with a different payload', async () => {
    await enqueueMobileV2Mutation(mutation, 1);
    await enqueueMobileV2Mutation(mutation, 2);
    await expect(
      enqueueMobileV2Mutation({
        ...mutation,
        payload: { ...payload, title: '不同内容' },
      }),
    ).rejects.toThrow('同一 Sync v2 opId 对应了不同 payload');
    expect((await claimMobileV2Outbox('phone', 10, 3)).items).toHaveLength(1);
  });

  it('archives old-device outbox rows and never leases them to a rebound credential', async () => {
    await enqueueMobileV2Mutation({ ...mutation, opId: 'old-op', deviceId: 'old-phone' }, 1);
    await enqueueMobileV2Mutation({ ...mutation, opId: 'current-op' }, 2);
    await resetMobileV2Epoch(checkpoint('c0', 'phone'));

    expect((await claimMobileV2Outbox('phone', 10, 3)).items.map((item) => item.opId)).toEqual([
      'current-op',
    ]);
    expect((await claimMobileV2Outbox('old-phone', 10, 3)).items).toHaveLength(0);
    expect(await readMobileV2OperationHistory()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          opId: 'old-op',
          status: 'device-credential-changed',
          errorCode: 'device_credential_changed',
        }),
      ]),
    );
  });

  it('fails closed on same-revision different content and keeps both conflict candidates', async () => {
    await writeMobileV2EntityState({
      entityType: 'focus_metadata_v2',
      entityId: payload.sessionId,
      confirmedRevision: 7,
      confirmedFingerprint: fingerprintDeviceSyncValue(payload),
      baseSnapshot: payload,
      deleted: false,
      changeSeq: 7,
      sourceDeviceId: 'phone',
      syncEpoch: 's1',
      cursorEpoch: 'e1',
      accountGeneration: 1,
      updatedAt: 1,
    });
    const remote = { ...payload, title: '远端不同内容', updatedByDeviceId: 'tablet' };
    await applyMobileV2ChangesAndCheckpoint({
      changes: [
        {
          changeSeq: 8,
          entityType: 'focus_metadata_v2',
          entityId: payload.sessionId,
          revision: 7,
          fingerprint: fingerprintDeviceSyncValue(remote),
          deleted: false,
          payload: remote,
          sourceDeviceId: 'tablet',
        },
      ],
      checkpoint: checkpoint('c8', 'phone'),
      serverTime: 8,
      deviceId: 'phone',
    });

    expect(await readMobileV2EntityState('focus_metadata_v2', payload.sessionId)).toMatchObject({
      confirmedRevision: 7,
      baseSnapshot: payload,
    });
    expect(await readMobileV2Conflicts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          local: payload,
          remote,
          fields: ['same_revision_fingerprint_mismatch'],
          status: 'open',
        }),
      ]),
    );
    expect(await readMobileV2OperationHistory()).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'conflict', revision: 7 })]),
    );
  });

  it('persists tombstones and refuses to revive them from a rollback revision', async () => {
    await writeMobileV2EntityState({
      entityType: 'focus_metadata_v2',
      entityId: payload.sessionId,
      confirmedRevision: 1,
      confirmedFingerprint: fingerprintDeviceSyncValue(payload),
      baseSnapshot: payload,
      deleted: false,
      changeSeq: 1,
      sourceDeviceId: 'phone',
      syncEpoch: 's1',
      cursorEpoch: 'e1',
      accountGeneration: 1,
      updatedAt: 1,
    });
    await applyMobileV2ChangesAndCheckpoint({
      changes: [
        {
          changeSeq: 2,
          entityType: 'focus_metadata_v2',
          entityId: payload.sessionId,
          revision: 2,
          fingerprint: fingerprintDeviceSyncValue({ deleted: true, payload: null }),
          deleted: true,
          payload: null,
          sourceDeviceId: 'tablet',
        },
      ],
      checkpoint: checkpoint('c2', 'phone'),
      serverTime: 2,
      deviceId: 'phone',
    });
    await applyMobileV2ChangesAndCheckpoint({
      changes: [
        {
          changeSeq: 3,
          entityType: 'focus_metadata_v2',
          entityId: payload.sessionId,
          revision: 1,
          fingerprint: fingerprintDeviceSyncValue(payload),
          deleted: false,
          payload,
          sourceDeviceId: 'old-phone',
        },
      ],
      checkpoint: checkpoint('c3', 'phone'),
      serverTime: 3,
      deviceId: 'phone',
    });
    expect(await readMobileV2EntityState('focus_metadata_v2', payload.sessionId)).toMatchObject({
      confirmedRevision: 2,
      deleted: true,
      baseSnapshot: null,
    });
    expect(await readMobileV2Conflicts()).toEqual(
      expect.arrayContaining([expect.objectContaining({ fields: ['revision_rollback'] })]),
    );
  });

  it('stores only public device identity and persists scoped verification/error status', async () => {
    await putMobileDeviceIdentity({
      deviceId: 'phone',
      devicePublicId: 'public-phone',
      accountPublicId: 'public-account',
      displayName: '手机',
      scopes: ['sync:read', 'sync:write'],
      expiresAt: 999,
      token: 'fl2_secret_must_not_persist',
      authorization: 'Bearer secret',
    } as Parameters<typeof putMobileDeviceIdentity>[0] & {
      token: string;
      authorization: string;
    });
    expect(JSON.stringify(await readMobileDeviceIdentity('phone'))).not.toMatch(
      /fl2_|Bearer|token|authorization/i,
    );

    await writeMobileV2SyncFailure('phone', 'network_error');
    expect(await readMobileV2Status('phone')).toMatchObject({
      lastVerifiedAt: null,
      lastErrorCode: 'network_error',
    });
    await applyMobileV2ChangesAndCheckpoint({
      changes: [],
      checkpoint: checkpoint('c0', 'phone'),
      serverTime: 10,
      deviceId: 'phone',
    });
    expect(await readMobileV2Status('phone')).toMatchObject({
      lastVerifiedAt: expect.any(Number),
      lastErrorCode: null,
    });
  });
});

function checkpoint(cursor: string, boundDeviceId: string) {
  return {
    key: 'syncV2.bootstrap' as const,
    state: 'v2-active' as const,
    bootstrapId: null,
    cursor,
    boundDeviceId,
    syncEpoch: 's1',
    cursorEpoch: 'e1',
    accountGeneration: 1,
    updatedAt: 1,
  };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
