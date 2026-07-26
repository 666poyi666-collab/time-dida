import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceSyncSessionBundle } from '@shared/sync/deviceProtocol';
import {
  completeOfflineFocusRuntime,
  createOfflineFocusRuntime,
  markPendingDeviceSyncFailure,
  markPendingDeviceSyncUploading,
  readLocalSessionSyncMeta,
  readOfflineFocusRuntime,
  readPendingDeviceSyncBundles,
  removePendingDeviceSyncBundle,
  type LocalSessionSyncMeta,
} from '../src/mobile/cache';
import { startOfflineFocus } from '../src/mobile/offlineFocusRuntime';

const DATABASE_NAME = 'focuslink-mobile-preview';

describe('mobile IndexedDB local-first persistence', () => {
  beforeEach(async () => deleteDatabase());
  afterEach(async () => deleteDatabase());

  it('upgrades legacy pending records without changing opId and recovers uploading', async () => {
    await seedVersionTwo([
      { opId: 'legacy-op', entityId: 'legacy-session', bundle: makeBundle('legacy-session') },
      {
        opId: 'uploading-op',
        entityId: 'uploading-session',
        bundle: makeBundle('uploading-session'),
        state: 'uploading',
        attemptCount: 2,
        nextRetryAt: 0,
        lastErrorCode: null,
        createdAt: 10,
        updatedAt: 20,
      },
    ]);

    const records = await readPendingDeviceSyncBundles();

    expect(records.map((record) => record.opId).sort()).toEqual(['legacy-op', 'uploading-op']);
    expect(records.find((record) => record.opId === 'legacy-op')).toMatchObject({
      state: 'pending',
      attemptCount: 0,
    });
    expect(records.find((record) => record.opId === 'uploading-op')).toMatchObject({
      state: 'retry',
      attemptCount: 2,
    });
    expect(await readLocalSessionSyncMeta('legacy-session')).toBeNull();
  });

  it('stores runtime and authority metadata together, then completes into pending', async () => {
    const runtime = startOfflineFocus({
      id: 'local-session',
      segmentId: 'local-segment',
      title: '离线专注',
      task: null,
      now: 1_720_000_000_000,
    });
    const meta = makeMeta(runtime.id);

    await createOfflineFocusRuntime(runtime, meta);
    expect(await readOfflineFocusRuntime()).toEqual(runtime);
    expect(await readLocalSessionSyncMeta(runtime.id)).toEqual(meta);

    const pending = await completeOfflineFocusRuntime(makeBundle(runtime.id));
    expect(await readOfflineFocusRuntime()).toBeNull();
    expect(await readPendingDeviceSyncBundles()).toContainEqual(pending);
    expect(await readLocalSessionSyncMeta(runtime.id)).toEqual(meta);
  });

  it('retains conflict diagnostics and removes pending plus metadata only on acknowledgement', async () => {
    const runtime = startOfflineFocus({
      id: 'conflict-session',
      segmentId: 'conflict-segment',
      title: '并发专注',
      task: null,
      now: 1_720_000_000_000,
    });
    await createOfflineFocusRuntime(runtime, makeMeta(runtime.id));
    const pending = await completeOfflineFocusRuntime(makeBundle(runtime.id));
    const uploading = await markPendingDeviceSyncUploading(pending);
    expect(uploading).toMatchObject({ state: 'uploading', attemptCount: 1 });

    await markPendingDeviceSyncFailure(pending.opId, 'conflict', 'revision-conflict', 0);
    expect(await readPendingDeviceSyncBundles()).toEqual([
      expect.objectContaining({
        opId: pending.opId,
        state: 'conflict',
        lastErrorCode: 'revision-conflict',
      }),
    ]);
    expect(await readLocalSessionSyncMeta(runtime.id)).not.toBeNull();

    await removePendingDeviceSyncBundle(pending.opId);
    expect(await readPendingDeviceSyncBundles()).toEqual([]);
    expect(await readLocalSessionSyncMeta(runtime.id)).toBeNull();
  });
});

function makeMeta(sessionId: string): LocalSessionSyncMeta {
  return {
    sessionId,
    authorityMode: 'local-offline',
    originDeviceId: 'mobile-test',
    baseCloudRevision: null,
    suspectedRemoteSessionId: null,
    detectedRemoteRevision: null,
    detectedAt: null,
  };
}

function makeBundle(sessionId: string): DeviceSyncSessionBundle {
  const startedAt = 1_720_000_000_000;
  const endedAt = startedAt + 60_000;
  return {
    session: {
      id: sessionId,
      title: '离线专注',
      status: 'finished',
      startedAt,
      endedAt,
      activeElapsedMs: 60_000,
      pauseElapsedMs: 0,
      wallElapsedMs: 60_000,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: null,
      createdAt: startedAt,
      updatedAt: endedAt,
    },
    segments: [
      {
        id: `${sessionId}-segment`,
        sessionId,
        taskId: null,
        taskSource: null,
        title: null,
        startedAt,
        endedAt,
        activeElapsedMs: 60_000,
        note: null,
        tomatodoSubject: null,
        createdAt: startedAt,
        updatedAt: endedAt,
      },
    ],
    pauses: [],
  };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('test database deletion blocked'));
  });
}

function seedVersionTwo(records: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('bundles', { keyPath: 'entityId' });
      database.createObjectStore('meta', { keyPath: 'key' });
      const pending = database.createObjectStore('pendingBundles', { keyPath: 'opId' });
      for (const record of records) pending.put(record);
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}
