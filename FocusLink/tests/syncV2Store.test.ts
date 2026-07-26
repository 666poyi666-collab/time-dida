import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SyncV2Store } from '../cloud/syncV2Store';
import { fingerprintDeviceSyncValue } from '../shared/sync/deviceProtocol';
import {
  SYNC_V2_PROTOCOL_VERSION,
  type FocusMetadataV2,
  type SyncV2Mutation,
} from '../shared/sync/v2Protocol';

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

const metadata: FocusMetadataV2 = {
  sessionId: 'session-v2',
  title: '数学',
  note: null,
  subject: '数学',
  tags: [],
  taskAssociation: null,
  updatedAt: 100,
  updatedByDeviceId: 'desktop',
};

function mutation(overrides: Partial<SyncV2Mutation> = {}): SyncV2Mutation {
  return {
    opId: 'op-v2-1',
    entityType: 'focus_metadata_v2',
    entityId: 'session-v2',
    kind: 'put',
    baseRevision: 0,
    baseFingerprint: null,
    payload: metadata,
    deviceId: 'desktop',
    accountGeneration: 1,
    ...overrides,
  };
}

describe('Node Sync v2 store', () => {
  it('bootstraps by manifest without re-uploading known fingerprints', () => {
    const store = new SyncV2Store({ now: () => 100 });
    const first = store.inventory('account', {
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      deviceId: 'desktop',
      bootstrapId: 'bootstrap-1',
      inventory: [
        {
          entityId: 'session-v2',
          entityType: 'focus_metadata_v2',
          fingerprint: fingerprintDeviceSyncValue(metadata),
          localUpdatedAt: 100,
          deleted: false,
        },
      ],
    });
    expect(first.manifest[0].disposition).toBe('need-upload');
    const established = store.establish('account', {
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      deviceId: 'desktop',
      bootstrapId: 'bootstrap-1',
      entities: [mutation()],
    });
    expect(established.acks[0].status).toBe('applied');
    const again = store.inventory('account', {
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      deviceId: 'phone',
      bootstrapId: 'bootstrap-2',
      inventory: [
        {
          entityId: 'session-v2',
          entityType: 'focus_metadata_v2',
          fingerprint: established.acks[0].fingerprint!,
          localUpdatedAt: 100,
          deleted: false,
        },
      ],
    });
    expect(again.manifest[0].disposition).toBe('already-known');
  });

  it('preserves opId idempotency, revision conflicts, cursors and restart persistence', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-v2-'));
    temporary.push(directory);
    const file = path.join(directory, 'v2.json');
    const epoch = { syncEpoch: 'sync-1', cursorEpoch: 'cursor-1', accountGeneration: 1 };
    const first = new SyncV2Store({ persistencePath: file, now: () => 100 });
    const applied = first.sync('account', {
      protocolVersion: 2,
      deviceId: 'desktop',
      cursor: null,
      mutations: [mutation()],
      pullLimit: 100,
      ...epoch,
    });
    expect(applied.acks[0].status).toBe('applied');
    expect(
      first.sync('account', {
        protocolVersion: 2,
        deviceId: 'desktop',
        cursor: applied.nextCursor,
        mutations: [mutation()],
        pullLimit: 100,
        ...epoch,
      }).acks[0].status,
    ).toBe('duplicate');
    const conflict = first.sync('account', {
      protocolVersion: 2,
      deviceId: 'phone',
      cursor: null,
      mutations: [
        mutation({ opId: 'op-v2-2', deviceId: 'phone', payload: { ...metadata, title: '复数' } }),
      ],
      pullLimit: 100,
      ...epoch,
    });
    expect(conflict.acks[0].status).toBe('conflict');
    const restored = new SyncV2Store({ persistencePath: file, now: () => 200 });
    const pulled = restored.sync('account', {
      protocolVersion: 2,
      deviceId: 'phone',
      cursor: null,
      mutations: [],
      pullLimit: 100,
      ...epoch,
    });
    expect(pulled.changes).toHaveLength(1);
    expect(pulled.changes[0].payload).toEqual(metadata);
  });
});
