import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusSegment, TomatodoSubject } from '@shared/types';

const harness = vi.hoisted(() => ({
  segment: null as FocusSegment | null,
  extraSegment: null as FocusSegment | null,
  running: true,
  addRecord: vi.fn(),
  writeBridge: vi.fn(),
  writeBatchBridge: vi.fn(),
  updateBridge: vi.fn(),
  pendingRecords: [] as Array<{
    recordId: number;
    segmentId: string;
    name: TomatodoSubject;
    time: number;
    startDate: number;
    isSynced: number;
  }>,
  recordStates: new Map<string, { exists: boolean; cloudSynced: boolean }>(),
  settings: new Map<string, string>(),
}));

vi.mock('../electron/db/index', () => ({
  findTaskCache: () => null,
  getSegment: (id: string) =>
    [harness.segment, harness.extraSegment].find((segment) => segment?.id === id) ?? null,
  listSegments: () => [harness.segment, harness.extraSegment].filter(Boolean),
  getSetting: (key: string) => harness.settings.get(key) ?? null,
  setSetting: (key: string, value: string) => harness.settings.set(key, value),
  setSegmentTomatodoSubject: (_id: string, subject: TomatodoSubject | null) => {
    if (harness.segment) harness.segment = { ...harness.segment, tomatodoSubject: subject };
  },
  setSegmentsTomatodoSubject: (ids: string[], subject: TomatodoSubject | null) => {
    if (harness.segment && ids.includes(harness.segment.id)) {
      harness.segment = { ...harness.segment, tomatodoSubject: subject };
      return 1;
    }
    return 0;
  },
}));

vi.mock('../electron/integrations/tomatodo/localDb', () => ({
  addTomatodoRecord: harness.addRecord,
  deleteTomatodoRecordBySegmentId: vi.fn(() => ({ ok: true, deletedCount: 0 })),
  getTomatodoRecordState: vi.fn((_dbPath: string, segmentId: string) =>
    Object.assign({ exists: false, cloudSynced: false }, harness.recordStates.get(segmentId)),
  ),
  isTomatodoRunningAsync: async () => harness.running,
  listPendingTomatodoRecords: () => harness.pendingRecords,
  resolveTomatodoDbPath: () => 'tomatodo_db.json',
  updateTomatodoRecordSubjects: vi.fn(() => ({
    ok: true,
    foundSegmentIds: [],
    updatedCount: 0,
  })),
}));

vi.mock('../electron/integrations/tomatodo/cloudBridge', () => ({
  deleteTomatodoRecordThroughBridge: vi.fn(),
  updateTomatodoSubjectThroughBridge: harness.updateBridge,
  writeTomatodoRecordsThroughBridge: harness.writeBatchBridge,
  writeTomatodoRecordThroughBridge: harness.writeBridge,
}));

vi.mock('../electron/settingsStore', () => ({
  getSettings: () => ({
    tomatodo: { enabled: true, dbPath: '', defaultSubject: '学习' },
  }),
}));

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  setTomatodoSubjectForSegment,
  syncSessionToTomatodo,
  syncSegmentToTomatodo,
  uploadPendingTomatodoRecords,
} from '../electron/sync/tomatodoSyncService';

function makeSegment(): FocusSegment {
  return {
    id: 'segment-1',
    sessionId: 'session-1',
    taskId: null,
    taskSource: null,
    title: '普通任务',
    startedAt: 1_000,
    endedAt: 61_000,
    activeElapsedMs: 60_000,
    note: null,
    cloudFocusId: null,
    tomatodoSubject: null,
    createdAt: 1_000,
    updatedAt: 61_000,
  };
}

describe('tomatodo sync service bridge safety and state', () => {
  beforeEach(() => {
    harness.segment = makeSegment();
    harness.extraSegment = null;
    harness.running = true;
    harness.addRecord.mockReset();
    harness.writeBridge.mockReset();
    harness.writeBatchBridge.mockReset();
    harness.updateBridge.mockReset();
    harness.pendingRecords = [];
    harness.recordStates.clear();
    harness.settings.clear();
  });

  it('does not count a skipped missing subject marker as externally found', async () => {
    harness.updateBridge.mockResolvedValue({
      available: true,
      ok: true,
      recordFound: false,
      localWritten: false,
      localChanged: false,
      uploadConfirmed: false,
      cloudRecordReadbackSupported: false,
      skipped: true,
    });

    const result = await setTomatodoSubjectForSegment('segment-1', '数学');

    expect(result).toMatchObject({
      ok: true,
      updatedCount: 1,
      externalFoundCount: 0,
      externalUpdatedCount: 0,
    });
  });

  it('fails safely when the running app bridge is unavailable and never writes JSON directly', async () => {
    harness.writeBridge.mockResolvedValue({
      available: false,
      ok: false,
      recordFound: false,
      localWritten: false,
      localChanged: false,
      uploadConfirmed: false,
      cloudRecordReadbackSupported: false,
      skipped: false,
      error: 'tomatodo_bridge_unavailable',
    });

    const result = await syncSegmentToTomatodo('segment-1');

    expect(result).toMatchObject({
      ok: false,
      localWritten: false,
      cloudSynced: false,
      syncState: 'failed',
      subject: '学习',
    });
    expect(harness.addRecord).not.toHaveBeenCalled();
    expect(JSON.parse(harness.settings.get('tomatodo.pendingSegmentIdsV060') ?? '[]')).toEqual([
      'segment-1',
    ]);
  });

  it('reports a locally written but unconfirmed upload as cloud-pending', async () => {
    harness.writeBridge.mockResolvedValue({
      available: true,
      ok: true,
      recordFound: true,
      localWritten: true,
      localChanged: true,
      uploadConfirmed: false,
      cloudRecordReadbackSupported: false,
      skipped: false,
      recordId: 205,
      cloudError: 'offline',
    });

    const result = await syncSegmentToTomatodo('segment-1');

    expect(result).toMatchObject({
      ok: true,
      localWritten: true,
      cloudSynced: false,
      syncState: 'cloud-pending',
      error: 'offline',
    });
    expect(harness.addRecord).not.toHaveBeenCalled();
  });

  it('uses cloud-synced only for an upload-confirmed bridge result', async () => {
    harness.writeBridge.mockResolvedValue({
      available: true,
      ok: true,
      recordFound: true,
      localWritten: true,
      localChanged: true,
      uploadConfirmed: true,
      cloudRecordReadbackSupported: false,
      skipped: false,
      recordId: 206,
    });

    const result = await syncSegmentToTomatodo('segment-1');

    expect(result).toMatchObject({
      ok: true,
      localWritten: true,
      cloudSynced: true,
      syncState: 'cloud-synced',
    });
    expect(JSON.parse(harness.settings.get('tomatodo.pendingSegmentIdsV060') ?? '[]')).toEqual([]);
  });

  it('replays a durable segment that never reached the TomaToDo JSON', async () => {
    harness.settings.set('tomatodo.pendingSegmentIdsV060', JSON.stringify(['segment-1']));
    harness.writeBatchBridge.mockResolvedValue({
      available: true,
      ok: true,
      results: [
        {
          available: true,
          ok: true,
          recordFound: true,
          localWritten: true,
          localChanged: true,
          uploadConfirmed: true,
          cloudRecordReadbackSupported: false,
          skipped: false,
          recordId: 210,
        },
      ],
    });

    const result = await uploadPendingTomatodoRecords();

    expect(result).toEqual({ ok: true, total: 1, uploaded: 1, failed: 0, error: undefined });
    expect(harness.writeBatchBridge).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.settings.get('tomatodo.pendingSegmentIdsV060') ?? '[]')).toEqual([]);
  });

  it('writes a durable bridge failure to local JSON after TomaToDo closes', async () => {
    harness.running = false;
    harness.settings.set('tomatodo.pendingSegmentIdsV060', JSON.stringify(['segment-1']));
    harness.addRecord.mockReturnValue({
      ok: true,
      skipped: false,
      recordId: 214,
    });

    const result = await uploadPendingTomatodoRecords();

    expect(result).toMatchObject({ ok: false, total: 1, uploaded: 0, failed: 0 });
    expect(result.error).toContain('已安全写入本地待传队列');
    expect(harness.addRecord).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.settings.get('tomatodo.pendingSegmentIdsV060') ?? '[]')).toEqual([
      'segment-1',
    ]);
  });

  it('reconciles a transient bridge failure when TomaToDo confirms the record moments later', async () => {
    harness.pendingRecords = [
      {
        recordId: 212,
        segmentId: 'segment-1',
        name: '学习',
        time: 1,
        startDate: 1_000,
        isSynced: 0,
      },
    ];
    harness.writeBatchBridge.mockResolvedValue({
      available: true,
      ok: false,
      results: [
        {
          available: true,
          ok: false,
          recordFound: true,
          localWritten: true,
          localChanged: false,
          uploadConfirmed: false,
          cloudRecordReadbackSupported: false,
          skipped: true,
          recordId: 212,
          cloudError: 'transient startup race',
        },
      ],
    });
    setTimeout(() => {
      harness.recordStates.set('segment-1', { exists: true, cloudSynced: true });
    }, 50);

    const result = await uploadPendingTomatodoRecords();

    expect(result).toEqual({ ok: true, total: 1, uploaded: 1, failed: 0, error: undefined });
  });

  it('serializes concurrent segment uploads through one service-level operation slot', async () => {
    let active = 0;
    let maxActive = 0;
    harness.writeBridge.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return {
        available: true,
        ok: true,
        recordFound: true,
        localWritten: true,
        localChanged: true,
        uploadConfirmed: true,
        cloudRecordReadbackSupported: false,
        skipped: false,
        recordId: 211,
      };
    });

    await Promise.all([syncSegmentToTomatodo('segment-1'), syncSegmentToTomatodo('segment-1')]);

    expect(maxActive).toBe(1);
  });

  it('uploads all eligible session records in one bridge batch', async () => {
    harness.extraSegment = {
      ...makeSegment(),
      id: 'segment-2',
      startedAt: 62_000,
      endedAt: 122_000,
    };
    harness.writeBatchBridge.mockResolvedValue({
      available: true,
      ok: true,
      results: [
        {
          available: true,
          ok: true,
          recordFound: true,
          localWritten: true,
          localChanged: true,
          uploadConfirmed: true,
          cloudRecordReadbackSupported: false,
          skipped: false,
          recordId: 207,
        },
        {
          available: true,
          ok: true,
          recordFound: true,
          localWritten: true,
          localChanged: true,
          uploadConfirmed: true,
          cloudRecordReadbackSupported: false,
          skipped: false,
          recordId: 208,
        },
      ],
    });

    const result = await syncSessionToTomatodo('session-1');

    expect(harness.writeBatchBridge).toHaveBeenCalledTimes(1);
    expect(harness.writeBatchBridge.mock.calls[0][0]).toHaveLength(2);
    expect(result).toMatchObject({ ok: true, total: 2, synced: 2, failed: 0 });
    expect(result.results.every((item) => item.cloudSynced)).toBe(true);
    expect(harness.writeBridge).not.toHaveBeenCalled();
  });
});
