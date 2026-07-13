import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// logger.ts 顶层 import { app } from 'electron'；vitest 无 electron 运行时，需 mock
vi.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'focuslink-test') },
}));

import {
  addTomatodoRecord,
  countPendingTomatodoRecords,
  deleteTomatodoRecordBySegmentId,
  getTomatodoRecordState,
  hasRecordForSegment,
  listPendingTomatodoRecords,
  listSyncedSegmentIds,
  loadTomatodoDb,
  migrateLegacyTomatodoRecords,
  nextRecordId,
  updateTomatodoRecordSubjectBySegmentId,
  updateTomatodoRecordSubjects,
} from '../electron/integrations/tomatodo/localDb';

function makeDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomatodo-test-'));
  return path.join(dir, 'tomatodo_db.json');
}

function seedDb(dbPath: string, counter = 193): void {
  const initial = {
    PCToDo: [{ id: 67, name: '数学', time: 45, type: 0 }],
    PCRecord: [{ id: counter, name: '数学', time: 45 }],
    recordIdCounter: counter,
    todoIdCounter: 1163,
  };
  fs.writeFileSync(dbPath, JSON.stringify(initial), 'utf8');
}

describe('tomatodo adapter load/seed', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = makeDbPath();
  });
  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('loads an existing db', () => {
    seedDb(dbPath, 193);
    const db = loadTomatodoDb(dbPath);
    expect(db.recordIdCounter).toBe(193);
    expect(db.PCRecord?.length).toBe(1);
  });

  it('returns empty skeleton for missing file', () => {
    const db = loadTomatodoDb(dbPath);
    expect(db.PCRecord).toEqual([]);
    expect(db.recordIdCounter).toBe(0);
  });
});

describe('tomatodo adapter nextRecordId', () => {
  it('increments counter', () => {
    expect(nextRecordId({ recordIdCounter: 193, PCRecord: [{ id: 193 }] })).toBe(194);
  });

  it('skips existing ids', () => {
    expect(nextRecordId({ recordIdCounter: 193, PCRecord: [{ id: 194 }, { id: 193 }] })).toBe(195);
  });
});

describe('tomatodo adapter addTomatodoRecord', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = makeDbPath();
    seedDb(dbPath, 193);
  });
  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  const input = {
    segmentId: 'seg-1',
    subject: '数学' as const,
    startedAt: 1782000000000,
    endedAt: 1782010800000,
    activeElapsedMs: 25 * 60 * 1000,
  };

  it('appends a PCRecord and increments counter', () => {
    const result = addTomatodoRecord(dbPath, input);
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.recordId).toBe(194);
    expect(result.record?.name).toBe('数学');
    expect(result.record?.time).toBe(25);
    expect(result.record?.s1).toBe('[FocusLink:tomatodo:segment:seg-1]');
    expect(result.record?.isSynced).toBe(0);

    const db = loadTomatodoDb(dbPath);
    expect(db.recordIdCounter).toBe(194);
    expect(db.PCRecord?.length).toBe(2);
    expect(db.PCRecord?.[1].id).toBe(194);
  });

  it('creates a backup file before writing', () => {
    addTomatodoRecord(dbPath, input);
    const backups = fs
      .readdirSync(path.dirname(dbPath))
      .filter((f) => f.startsWith('tomatodo_db.backup_'));
    expect(backups.length).toBe(1);
  });

  it('skips when marker already exists (idempotent)', () => {
    addTomatodoRecord(dbPath, input);
    const second = addTomatodoRecord(dbPath, input);
    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);

    const db = loadTomatodoDb(dbPath);
    expect(db.PCRecord?.length).toBe(2); // 没有重复写入
    expect(db.recordIdCounter).toBe(194); // 没有重复递增
  });

  it('preserves unrelated db fields', () => {
    addTomatodoRecord(dbPath, input);
    const db = loadTomatodoDb(dbPath);
    expect(db.todoIdCounter).toBe(1163); // 保留
    expect(db.PCToDo?.length).toBe(1); // 保留
  });

  it('retries transient Windows file locks without losing the record', () => {
    const renameSync = fs.renameSync.bind(fs);
    let attempts = 0;
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(((from, to) => {
      attempts += 1;
      if (attempts <= 2) {
        throw Object.assign(new Error('file temporarily locked'), { code: 'EPERM' });
      }
      return renameSync(from, to);
    }) as typeof fs.renameSync);

    try {
      const result = addTomatodoRecord(dbPath, input);
      expect(result.ok).toBe(true);
      expect(attempts).toBe(3);
      expect(hasRecordForSegment(dbPath, input.segmentId)).toBe(true);
    } finally {
      renameSpy.mockRestore();
    }
  });
});

describe('tomatodo adapter dedup queries', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = makeDbPath();
    seedDb(dbPath, 193);
  });
  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('lists synced segment ids', () => {
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-a',
      subject: '数学',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-b',
      subject: '英语',
      startedAt: 3,
      endedAt: 4,
      activeElapsedMs: 60000,
    });
    expect(listSyncedSegmentIds(dbPath)).toEqual(new Set(['seg-a', 'seg-b']));
  });

  it('detects existing record for segment', () => {
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-x',
      subject: '物理',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });
    expect(hasRecordForSegment(dbPath, 'seg-x')).toBe(true);
    expect(hasRecordForSegment(dbPath, 'seg-y')).toBe(false);
    expect(getTomatodoRecordState(dbPath, 'seg-x')).toMatchObject({
      exists: true,
      cloudSynced: false,
    });
  });
});

describe('tomatodo adapter update subject for an existing marker', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = makeDbPath();
    seedDb(dbPath, 193);
  });
  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('updates only name and preserves the existing marker/id', () => {
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-reclassify',
      subject: '数学',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });
    const before = loadTomatodoDb(dbPath).PCRecord?.find((r) =>
      (r.s1 ?? '').includes('seg-reclassify'),
    );

    const result = updateTomatodoRecordSubjectBySegmentId(dbPath, 'seg-reclassify', '物理');
    const after = loadTomatodoDb(dbPath).PCRecord?.find((r) =>
      (r.s1 ?? '').includes('seg-reclassify'),
    );

    expect(result.ok).toBe(true);
    expect(result.foundSegmentIds).toEqual(['seg-reclassify']);
    expect(result.updatedCount).toBe(1);
    expect(after?.name).toBe('物理');
    expect(after?.isSynced).toBe(0);
    expect(after?.id).toBe(before?.id);
    expect(after?.s1).toBe(before?.s1);
  });

  it('keeps cloud confirmation when the subject is unchanged', () => {
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-idempotent-subject',
      subject: '数学',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });
    const db = loadTomatodoDb(dbPath);
    const record = db.PCRecord?.find((item) => (item.s1 ?? '').includes('seg-idempotent-subject'));
    if (record) record.isSynced = 1;
    fs.writeFileSync(dbPath, JSON.stringify(db), 'utf8');

    const result = updateTomatodoRecordSubjectBySegmentId(dbPath, 'seg-idempotent-subject', '数学');
    const after = getTomatodoRecordState(dbPath, 'seg-idempotent-subject');

    expect(result).toMatchObject({ ok: true, updatedCount: 0 });
    expect(result.foundSegmentIds).toEqual(['seg-idempotent-subject']);
    expect(after.cloudSynced).toBe(true);
  });

  it('batch-updates all existing records with one marker-preserving write', () => {
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-math',
      subject: '数学',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-english',
      subject: '英语',
      startedAt: 3,
      endedAt: 4,
      activeElapsedMs: 60000,
    });

    const result = updateTomatodoRecordSubjects(dbPath, [
      { segmentId: 'seg-math', subject: '化学' },
      { segmentId: 'seg-english', subject: '生物' },
    ]);
    const records = loadTomatodoDb(dbPath).PCRecord ?? [];

    expect(result.ok).toBe(true);
    expect(result.updatedCount).toBe(2);
    expect(records.find((r) => (r.s1 ?? '').includes('seg-math'))?.name).toBe('化学');
    expect(records.find((r) => (r.s1 ?? '').includes('seg-english'))?.name).toBe('生物');
  });

  it('does not create a PCRecord when the marker does not exist', () => {
    const before = loadTomatodoDb(dbPath).PCRecord?.length;
    const result = updateTomatodoRecordSubjectBySegmentId(dbPath, 'seg-not-yet-synced', '语文');

    expect(result.ok).toBe(true);
    expect(result.foundSegmentIds).toEqual([]);
    expect(result.updatedCount).toBe(0);
    expect(loadTomatodoDb(dbPath).PCRecord?.length).toBe(before);
  });

  it('cleans up the atomic-write temporary file', () => {
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-atomic',
      subject: '数学',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });
    const tmpFiles = fs.readdirSync(path.dirname(dbPath)).filter((name) => name.endsWith('.tmp'));
    expect(tmpFiles).toEqual([]);
  });
});

describe('tomatodo adapter legacy cloud migration', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = makeDbPath();
    fs.writeFileSync(
      dbPath,
      JSON.stringify({
        PCRecord: [
          {
            id: 1,
            name: '杂',
            isSynced: 1,
            s1: '[FocusLink:tomatodo:segment:legacy]',
          },
          { id: 2, name: '数学', isSynced: 1, s1: '' },
        ],
        recordIdCounter: 2,
      }),
      'utf8',
    );
  });
  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('resets only FocusLink records and renames the fallback to 学习', () => {
    const before = fs.readFileSync(dbPath, 'utf8');
    const result = migrateLegacyTomatodoRecords(dbPath, { isAppRunning: () => false });
    const records = loadTomatodoDb(dbPath).PCRecord ?? [];
    expect(result).toMatchObject({ ok: true, updatedCount: 1 });
    expect(result.backupPath).toBeTruthy();
    expect(fs.readFileSync(result.backupPath as string, 'utf8')).toBe(before);
    expect(records[0]).toMatchObject({
      name: '学习',
      isSynced: 0,
      s9: '[FocusLink:tomatodo:cloud-v053]',
    });
    expect(records[1]).toMatchObject({ name: '数学', isSynced: 1 });

    records[0]!.isSynced = 1;
    fs.writeFileSync(dbPath, JSON.stringify({ PCRecord: records, recordIdCounter: 2 }), 'utf8');
    const retry = migrateLegacyTomatodoRecords(dbPath, { isAppRunning: () => false });
    expect(retry).toEqual({ ok: true, updatedCount: 0 });
    expect(loadTomatodoDb(dbPath).PCRecord?.[0]).toMatchObject({ isSynced: 1 });
  });

  it('defers without touching the database while 番茄 Todo is running', () => {
    const before = fs.readFileSync(dbPath, 'utf8');

    const result = migrateLegacyTomatodoRecords(dbPath, { isAppRunning: () => true });

    expect(result).toEqual({
      ok: false,
      updatedCount: 0,
      error: 'tomatodo_running_migration_deferred',
    });
    expect(fs.readFileSync(dbPath, 'utf8')).toBe(before);
    expect(
      fs.readdirSync(path.dirname(dbPath)).filter((name) => name.startsWith('tomatodo_db.backup_')),
    ).toEqual([]);
  });
});

describe('tomatodo adapter deleteBySegmentId', () => {
  let dbPath: string;
  beforeEach(() => {
    dbPath = makeDbPath();
    seedDb(dbPath, 193);
  });
  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('removes the record matching the segment marker', () => {
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-del',
      subject: '化学',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });
    expect(hasRecordForSegment(dbPath, 'seg-del')).toBe(true);

    const result = deleteTomatodoRecordBySegmentId(dbPath, 'seg-del');
    expect(result.ok).toBe(true);
    expect(result.deletedCount).toBe(1);
    expect(hasRecordForSegment(dbPath, 'seg-del')).toBe(false);
  });

  it('is a no-op when no record matches', () => {
    const result = deleteTomatodoRecordBySegmentId(dbPath, 'seg-none');
    expect(result.ok).toBe(true);
    expect(result.deletedCount).toBe(0);
  });

  it('leaves other records intact', () => {
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-keep',
      subject: '数学',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-remove',
      subject: '英语',
      startedAt: 3,
      endedAt: 4,
      activeElapsedMs: 60000,
    });
    deleteTomatodoRecordBySegmentId(dbPath, 'seg-remove');
    expect(hasRecordForSegment(dbPath, 'seg-keep')).toBe(true);
    expect(hasRecordForSegment(dbPath, 'seg-remove')).toBe(false);
  });
});

describe('listPendingTomatodoRecords and countPendingTomatodoRecords', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeDbPath();
    seedDb(dbPath);
  });

  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('returns empty when no FocusLink records exist', () => {
    expect(listPendingTomatodoRecords(dbPath)).toEqual([]);
    expect(countPendingTomatodoRecords(dbPath)).toBe(0);
  });

  it('lists FocusLink records with isSynced=0 as pending', () => {
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-pending',
      subject: '学习',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 120000,
    });
    addTomatodoRecord(dbPath, {
      segmentId: 'seg-synced',
      subject: '数学',
      startedAt: 3,
      endedAt: 4,
      activeElapsedMs: 60000,
    });
    // Manually mark seg-synced as isSynced=1
    const db = loadTomatodoDb(dbPath);
    const synced = db.PCRecord!.find((r) => (r.s1 ?? '').includes('seg-synced'));
    if (synced) synced.isSynced = 1;
    fs.writeFileSync(dbPath, JSON.stringify(db), 'utf8');

    const pending = listPendingTomatodoRecords(dbPath);
    expect(pending).toHaveLength(1);
    expect(pending[0].segmentId).toBe('seg-pending');
    expect(pending[0].name).toBe('学习');
    expect(countPendingTomatodoRecords(dbPath)).toBe(1);
  });

  it('excludes non-FocusLink records', () => {
    const db = loadTomatodoDb(dbPath);
    (db.PCRecord as unknown as Array<{ [key: string]: unknown }>).push({
      id: 999,
      name: '杂',
      time: 30,
      startDate: Date.now(),
      isSynced: 0,
      s1: 'not a focuslink marker',
    });
    fs.writeFileSync(dbPath, JSON.stringify(db), 'utf8');

    expect(listPendingTomatodoRecords(dbPath)).toEqual([]);
    expect(countPendingTomatodoRecords(dbPath)).toBe(0);
  });
});
