import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPendingDeviceSyncBundles } from '../src/mobile/cache';
import { persistCompletedOfflineFocus } from '../src/mobile/offlineCompletion';
import { readMobileV2Status, writeMobileV2Bootstrap } from '../src/mobile/v2Cache';

const DATABASE_NAME = 'focuslink-mobile-preview';
const DEVICE_ID = 'device-mobile-entry';
const nativePlugin = vi.hoisted(() => ({
  enqueueCompletedLedgerBundle: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: (name: string) => name === 'FocusRuntime',
  },
  registerPlugin: () => nativePlugin,
}));

describe('MobileApp offline completion entry', () => {
  beforeEach(async () => {
    nativePlugin.enqueueCompletedLedgerBundle.mockReset();
    nativePlugin.enqueueCompletedLedgerBundle.mockResolvedValue({ queued: true, pending: 1 });
    await deleteDatabase();
    await writeMobileV2Bootstrap({
      key: 'syncV2.bootstrap',
      state: 'v2-active',
      bootstrapId: null,
      cursor: 'c4',
      boundDeviceId: DEVICE_ID,
      boundAccountId: 'account-entry',
      syncEpoch: 'sync-entry',
      cursorEpoch: 'cursor-entry',
      accountGeneration: 2,
      updatedAt: 1,
    });
  });

  it('durably fans one real completion into native WorkManager and canonical v2 outboxes', async () => {
    const result = await persistCompletedOfflineFocus(bundle(), DEVICE_ID);

    expect(result.nativeQueued).toBe(true);
    expect(result.pending).toMatchObject({
      entityId: 'session-entry',
      state: 'pending',
      syncDeviceId: DEVICE_ID,
    });
    expect(await readPendingDeviceSyncBundles()).toEqual([
      expect.objectContaining({ entityId: 'session-entry', syncDeviceId: DEVICE_ID }),
    ]);
    expect(await readMobileV2Status(DEVICE_ID)).toMatchObject({
      pending: 2,
      conflicts: 0,
      rejected: 0,
    });

    const nativeRecord = nativePlugin.enqueueCompletedLedgerBundle.mock.calls[0][0].record;
    expect(nativeRecord).toMatchObject({
      schemaVersion: 1,
      bundleId: 'session-entry',
      deviceId: DEVICE_ID,
    });
    expect(nativeRecord.mutations.map((item: { entityType: string }) => item.entityType)).toEqual([
      'focus_ledger_v2',
      'focus_metadata_v2',
    ]);
    expect(JSON.stringify(nativeRecord)).not.toMatch(
      /accessToken|authorization|cookie|cursor|password|secret/i,
    );
  });

  it('keeps the canonical IndexedDB delivery path when the OEM native bridge is unavailable', async () => {
    nativePlugin.enqueueCompletedLedgerBundle.mockRejectedValue(
      new Error('vendor scheduler unavailable'),
    );

    await expect(persistCompletedOfflineFocus(bundle(), DEVICE_ID)).resolves.toMatchObject({
      nativeQueued: false,
      pending: { entityId: 'session-entry', state: 'pending' },
    });
    expect(await readMobileV2Status(DEVICE_ID)).toMatchObject({ pending: 2 });
  });
});

function bundle() {
  return {
    session: {
      id: 'session-entry',
      title: '户外化学复习',
      status: 'finished' as const,
      startedAt: 1_000,
      endedAt: 61_000,
      activeElapsedMs: 50_000,
      pauseElapsedMs: 10_000,
      wallElapsedMs: 60_000,
      defaultTaskId: 'task-chemistry',
      defaultTaskSource: 'ticktick' as const,
      defaultTaskTitle: '化学错题',
      note: null,
      createdAt: 1_000,
      updatedAt: 61_000,
    },
    segments: [],
    pauses: [],
  };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('database deletion blocked'));
  });
}
