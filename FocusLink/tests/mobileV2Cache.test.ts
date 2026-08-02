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
    const owner = checkpoint('c0', 'phone');
    await writeMobileV2Bootstrap(owner);
    await enqueueMobileV2Mutation(mutation, owner, 1);
    const first = await claimMobileV2Outbox(owner, 10, 2);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].state).toBe('uploading');
    expect(await retryMobileV2Lease(first.leaseId, 'network', 10, 3)).toBe(1);
    expect((await claimMobileV2Outbox(owner, 10, 9)).items).toHaveLength(0);
    const second = await claimMobileV2Outbox(owner, 10, 10);
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
    expect((await claimMobileV2Outbox(owner, 10, 12)).items).toHaveLength(0);
  });

  it('persists a standalone delete ACK as a tombstone', async () => {
    const deleted: SyncV2Mutation = {
      ...mutation,
      opId: 'mobile-delete-op',
      entityId: 'mobile-deleted',
      kind: 'delete',
      payload: null,
    };
    const owner = checkpoint('c0', 'phone');
    await writeMobileV2Bootstrap(owner);
    await enqueueMobileV2Mutation(deleted, owner, 1);
    const claimed = await claimMobileV2Outbox(owner, 1, 2);
    await expect(
      settleMobileV2Ack({
        leaseId: claimed.leaseId,
        deviceId: 'phone',
        payload: null,
        ack: {
          opId: deleted.opId,
          entityType: deleted.entityType,
          entityId: deleted.entityId,
          status: 'applied',
          revision: 2,
          fingerprint: fingerprintDeviceSyncValue({ deleted: true, payload: null }),
          errorCode: null,
        },
        epoch: { syncEpoch: 's1', cursorEpoch: 'c1', accountGeneration: 1 },
      }),
    ).resolves.toBe(true);
    expect(await readMobileV2EntityState(deleted.entityType, deleted.entityId)).toMatchObject({
      deleted: true,
      baseSnapshot: null,
    });
  });

  it('rejects an ACK whose lease, device or epoch no longer matches the owner', async () => {
    const owner = checkpoint('c0', 'phone');
    await writeMobileV2Bootstrap(owner);
    await enqueueMobileV2Mutation(mutation, owner, 1);
    const claimed = await claimMobileV2Outbox(owner, 1, 2);
    const ack = {
      opId: mutation.opId,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      status: 'applied' as const,
      revision: 1,
      fingerprint: fingerprintDeviceSyncValue(payload),
      errorCode: null,
    };
    const epoch = { syncEpoch: 's1', cursorEpoch: 'c1', accountGeneration: 1 };
    await expect(
      settleMobileV2Ack({ leaseId: 'other-lease', deviceId: 'phone', payload, ack, epoch }),
    ).resolves.toBe(false);
    await expect(
      settleMobileV2Ack({
        leaseId: claimed.leaseId,
        deviceId: 'other-device',
        payload,
        ack,
        epoch,
      }),
    ).resolves.toBe(false);
    await expect(
      settleMobileV2Ack({
        leaseId: claimed.leaseId,
        deviceId: 'phone',
        payload,
        ack,
        epoch: { ...epoch, accountGeneration: 2 },
      }),
    ).resolves.toBe(false);
    expect(await readMobileV2Status('phone')).toMatchObject({ pending: 1 });
    await expect(
      settleMobileV2Ack({ leaseId: claimed.leaseId, deviceId: 'phone', payload, ack, epoch }),
    ).resolves.toBe(true);
    expect(await readMobileV2Status('phone')).toMatchObject({ pending: 0 });
  });

  it('persists the explicit bootstrap migration state', async () => {
    await writeMobileV2Bootstrap({
      key: 'syncV2.bootstrap',
      state: 'manifest-received',
      bootstrapId: 'boot-1',
      cursor: 'cursor',
      boundDeviceId: 'phone',
      boundAccountId: 'account-test',
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
    const owner = checkpoint('c0', 'phone');
    await writeMobileV2Bootstrap(owner);
    await enqueueMobileV2Mutation(atomicMutation, owner, 100);
    const claimed = await claimMobileV2Outbox(owner, 1, 100);
    const nextCheckpoint = {
      key: 'syncV2.bootstrap' as const,
      state: 'v2-active' as const,
      bootstrapId: null,
      cursor: 'c1',
      boundDeviceId: 'phone',
      boundAccountId: 'account-test',
      syncEpoch: 's-atomic',
      cursorEpoch: 'c-atomic',
      accountGeneration: 1,
      updatedAt: 101,
    };
    await writeMobileV2Bootstrap({ ...nextCheckpoint, cursor: 'c0' });
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
        checkpoint: nextCheckpoint,
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
    expect(
      (await claimMobileV2Outbox({ ...nextCheckpoint, cursor: 'c0' }, 1, 100 + 30_001)).items,
    ).toHaveLength(1);
    expect((await readMobileV2Bootstrap())?.cursor).not.toBe('c1');
  });

  it('keeps opId idempotent and rejects the same opId with a different payload', async () => {
    const owner = checkpoint('c0', 'phone');
    await writeMobileV2Bootstrap(owner);
    await enqueueMobileV2Mutation(mutation, owner, 1);
    await enqueueMobileV2Mutation(mutation, owner, 2);
    await expect(
      enqueueMobileV2Mutation(
        {
          ...mutation,
          payload: { ...payload, title: '不同内容' },
        },
        owner,
      ),
    ).rejects.toThrow('同一 Sync v2 opId 对应了不同 payload');
    expect((await claimMobileV2Outbox(owner, 10, 3)).items).toHaveLength(1);
  });

  it('archives old-device outbox rows and never leases them to a rebound credential', async () => {
    const oldOwner = checkpoint('c0', 'old-phone');
    await writeMobileV2Bootstrap(oldOwner);
    await enqueueMobileV2Mutation(
      { ...mutation, opId: 'old-op', deviceId: 'old-phone' },
      oldOwner,
      1,
    );
    const currentOwner = checkpoint('c0', 'phone');
    await resetMobileV2Epoch(currentOwner, oldOwner);
    await enqueueMobileV2Mutation({ ...mutation, opId: 'current-op' }, currentOwner, 2);

    expect((await claimMobileV2Outbox(currentOwner, 10, 3)).items.map((item) => item.opId)).toEqual(
      ['current-op'],
    );
    await expect(claimMobileV2Outbox(oldOwner, 10, 3)).rejects.toMatchObject({
      name: 'AbortError',
    });
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

  it('rejects an old account enqueue after a newer owner committed its checkpoint', async () => {
    const oldOwner = {
      ...checkpoint('c1', 'device-old'),
      boundAccountId: 'account-old',
    };
    await writeMobileV2Bootstrap(oldOwner);
    const newOwner = {
      ...checkpoint('c0', 'device-new'),
      boundAccountId: 'account-new',
      syncEpoch: 'sync-new',
      cursorEpoch: 'cursor-new',
    };
    await resetMobileV2Epoch(newOwner, oldOwner);

    await expect(
      enqueueMobileV2Mutation(
        { ...mutation, opId: 'released-old-enqueue', deviceId: 'device-old' },
        oldOwner,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readMobileV2Status('device-new')).toMatchObject({ pending: 0 });
    expect(await readMobileV2Bootstrap()).toEqual(newOwner);
  });

  it('uses a transaction CAS so an old account cannot reset a newer bootstrap owner', async () => {
    const observedOld = {
      ...checkpoint('c9', 'device-old'),
      boundAccountId: 'account-old',
      updatedAt: 9,
    };
    await writeMobileV2Bootstrap(observedOld);
    const currentNew = {
      ...checkpoint('c2', 'device-new'),
      boundAccountId: 'account-new',
      syncEpoch: 'sync-new',
      cursorEpoch: 'cursor-new',
      updatedAt: 20,
    };
    await writeMobileV2Bootstrap(currentNew);

    await expect(
      resetMobileV2Epoch(
        {
          ...observedOld,
          state: 'uninitialized',
          cursor: null,
          syncEpoch: 'sync-old-reset',
          cursorEpoch: 'cursor-old-reset',
          updatedAt: 21,
        },
        observedOld,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readMobileV2Bootstrap()).toEqual(currentNew);
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
    await writeMobileV2Bootstrap(checkpoint('c7', 'phone'));
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
    await writeMobileV2Bootstrap(checkpoint('c1', 'phone'));
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
    await writeMobileV2Bootstrap(checkpoint('c0', 'phone'));
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
    boundAccountId: 'account-test',
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
