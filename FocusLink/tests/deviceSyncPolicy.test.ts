import { describe, expect, it } from 'vitest';

import {
  DEVICE_SYNC_ENTITY,
  DEVICE_SYNC_MAX_BODY_BYTES,
  DEVICE_SYNC_MAX_PULL,
  DEVICE_SYNC_PROTOCOL_VERSION,
  deviceSyncJsonByteLength,
  makeDeviceSyncOperationId,
  type DeviceSyncMutation,
  type DeviceSyncRequest,
  type DeviceSyncSessionBundle,
} from '@shared/sync/deviceProtocol';
import {
  makeDeviceSyncConnectionScope,
  packDeviceSyncMutations,
} from '../electron/sync/deviceSyncPolicy';

function makeMutation(index: number): DeviceSyncMutation {
  const entityId = `session-${index}`;
  const startedAt = 1_720_000_000_000 + index * 1_000;
  const bundle: DeviceSyncSessionBundle = {
    session: {
      id: entityId,
      title: `Session ${index}`,
      status: 'finished',
      startedAt,
      endedAt: startedAt + 1_000,
      activeElapsedMs: 1_000,
      pauseElapsedMs: 0,
      wallElapsedMs: 1_000,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: 'x'.repeat(20_000),
      createdAt: startedAt,
      updatedAt: startedAt + 1_000,
    },
    segments: [],
    pauses: [],
  };
  return {
    opId: makeDeviceSyncOperationId(entityId, 'put', 0, bundle),
    entity: DEVICE_SYNC_ENTITY,
    entityId,
    kind: 'put',
    baseRevision: 0,
    payload: bundle,
  };
}

describe('device sync desktop transport policy', () => {
  it('namespaces checkpoints by endpoint and token without persisting the token', () => {
    const token = 'a-test-token-that-must-not-appear-in-meta';
    const first = makeDeviceSyncConnectionScope('https://sync.example/a', token);
    expect(first).toHaveLength(64);
    expect(first).not.toContain(token);
    expect(first).not.toBe(makeDeviceSyncConnectionScope('https://sync.example/b', token));
    expect(first).not.toBe(
      makeDeviceSyncConnectionScope('https://sync.example/a', `${token}-rotated`),
    );
  });

  it('packs valid mutations by serialized bytes as well as item count', () => {
    const mutations = Array.from({ length: 60 }, (_, index) => makeMutation(index));
    const packed = packDeviceSyncMutations('desktop-test-device', mutations);
    expect(packed.oversized).toEqual([]);
    expect(packed.batches.length).toBeGreaterThan(1);
    expect(packed.batches.flat()).toHaveLength(mutations.length);

    for (const batch of packed.batches) {
      const request: DeviceSyncRequest = {
        protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
        deviceId: 'desktop-test-device',
        cursor: 'x'.repeat(512),
        mutations: batch,
        pullLimit: DEVICE_SYNC_MAX_PULL,
      };
      expect(deviceSyncJsonByteLength(request)).toBeLessThanOrEqual(DEVICE_SYNC_MAX_BODY_BYTES);
    }
  });
});
