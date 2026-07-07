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
  deleteTomatodoRecordBySegmentId,
  hasRecordForSegment,
  listSyncedSegmentIds,
  loadTomatodoDb,
  nextRecordId,
} from '../electron/providers/tomatodoAdapter';

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
    expect(
      nextRecordId({ recordIdCounter: 193, PCRecord: [{ id: 194 }, { id: 193 }] }),
    ).toBe(195);
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
