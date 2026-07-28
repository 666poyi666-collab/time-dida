import 'fake-indexeddb/auto';

import { beforeAll, describe, expect, it } from 'vitest';

import { fingerprintDeviceSyncValue } from '../shared/sync/deviceProtocol';
import type { FocusMetadataV2, SyncV2Change, SyncV2Mutation } from '../shared/sync/v2Protocol';
import {
  applyMobileV2ChangesAndCheckpoint,
  claimMobileV2Outbox,
  enqueueMobileV2Mutation,
  readMobileV2EntityState,
  readMobileV2Status,
  readMobileV2Bootstrap,
  retryMobileV2Lease,
  settleMobileV2Ack,
  writeMobileV2Bootstrap,
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
  beforeAll(deleteDatabase);

  it('claims with a lease, retries after a failure and settles atomically', async () => {
    await enqueueMobileV2Mutation(mutation, 1);
    const first = await claimMobileV2Outbox(10, 2);
    expect(first.items).toHaveLength(1);
    expect(first.items[0].state).toBe('uploading');
    expect(await retryMobileV2Lease(first.leaseId, 'network', 10, 3)).toBe(1);
    expect((await claimMobileV2Outbox(10, 9)).items).toHaveLength(0);
    const second = await claimMobileV2Outbox(10, 10);
    expect(
      await settleMobileV2Ack({
        leaseId: second.leaseId,
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
    expect((await claimMobileV2Outbox(10, 12)).items).toHaveLength(0);
  });

  it('persists the explicit bootstrap migration state', async () => {
    await writeMobileV2Bootstrap({
      key: 'syncV2.bootstrap',
      state: 'manifest-received',
      bootstrapId: 'boot-1',
      cursor: 'cursor',
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
    const claimed = await claimMobileV2Outbox(1, 100);
    const checkpoint = {
      key: 'syncV2.bootstrap' as const,
      state: 'v2-active' as const,
      bootstrapId: null,
      cursor: 'c1',
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
    expect(await readMobileV2Status()).toMatchObject({ pending: 1 });
    expect((await claimMobileV2Outbox(1, 100 + 30_001)).items).toHaveLength(1);
    expect((await readMobileV2Bootstrap())?.cursor).not.toBe('c1');
  });
});

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
