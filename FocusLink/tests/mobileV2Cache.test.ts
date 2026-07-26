import 'fake-indexeddb/auto';

import { beforeAll, describe, expect, it } from 'vitest';

import { fingerprintDeviceSyncValue } from '../shared/sync/deviceProtocol';
import type { FocusMetadataV2, SyncV2Mutation } from '../shared/sync/v2Protocol';
import {
  claimMobileV2Outbox,
  enqueueMobileV2Mutation,
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
});

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
