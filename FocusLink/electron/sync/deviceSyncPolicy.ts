import crypto from 'node:crypto';

import {
  DEVICE_SYNC_MAX_BODY_BYTES,
  DEVICE_SYNC_MAX_PULL,
  DEVICE_SYNC_MAX_PUSH,
  DEVICE_SYNC_PROTOCOL_VERSION,
  deviceSyncJsonByteLength,
  type DeviceSyncMutation,
  type DeviceSyncRequest,
} from '@shared/sync/deviceProtocol';

const MAX_CURSOR_LENGTH = 512;

export interface DeviceSyncMutationBatches {
  batches: DeviceSyncMutation[][];
  oversized: DeviceSyncMutation[];
}

/** Hash the connection identity so checkpoints never store the Bearer token itself. */
export function makeDeviceSyncConnectionScope(endpoint: string, accessToken: string): string {
  return crypto
    .createHash('sha256')
    .update('focuslink-device-sync-v2\0')
    .update(endpoint)
    .update('\0')
    .update(accessToken)
    .digest('hex');
}

/**
 * Pack mutations against the transport's real byte ceiling. A maximum-length cursor is used for
 * sizing so every emitted batch remains valid after pagination advances the actual cursor.
 */
export function packDeviceSyncMutations(
  deviceId: string,
  mutations: readonly DeviceSyncMutation[],
): DeviceSyncMutationBatches {
  const batches: DeviceSyncMutation[][] = [];
  const oversized: DeviceSyncMutation[] = [];
  let current: DeviceSyncMutation[] = [];

  for (const mutation of mutations) {
    const candidate = [...current, mutation];
    if (
      candidate.length <= DEVICE_SYNC_MAX_PUSH &&
      requestByteLength(deviceId, candidate) <= DEVICE_SYNC_MAX_BODY_BYTES
    ) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      batches.push(current);
      current = [];
    }

    if (requestByteLength(deviceId, [mutation]) > DEVICE_SYNC_MAX_BODY_BYTES) {
      oversized.push(mutation);
    } else {
      current = [mutation];
    }
  }

  if (current.length > 0) batches.push(current);
  return { batches, oversized };
}

function requestByteLength(deviceId: string, mutations: DeviceSyncMutation[]): number {
  const sizingRequest: DeviceSyncRequest = {
    protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
    deviceId,
    cursor: 'x'.repeat(MAX_CURSOR_LENGTH),
    mutations,
    pullLimit: DEVICE_SYNC_MAX_PULL,
  };
  return deviceSyncJsonByteLength(sizingRequest);
}
