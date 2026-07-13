import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addTomatodoRecord,
  loadTomatodoDb,
  nextRecordId,
} from '../electron/integrations/tomatodo/localDb';

const REAL_DB = path.join(os.homedir(), 'AppData', 'Roaming', 'tomatodo', 'tomatodo_db.json');

/** 真实库可能不存在（CI / 非 Windows），整组跳过 */
const itReal = fs.existsSync(REAL_DB) ? it : it.skip;

function copyRealDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomatodo-real-'));
  const dest = path.join(dir, 'tomatodo_db.json');
  fs.copyFileSync(REAL_DB, dest);
  return dest;
}

describe('tomatodo integration against real db schema', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = copyRealDb();
  });
  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  itReal('produces a record whose key set matches a real PCRecord exactly', () => {
    const before = loadTomatodoDb(dbPath);
    const realRecord = before.PCRecord?.[0];
    expect(realRecord).toBeTruthy();
    const realKeys = Object.keys(realRecord as object).sort();

    const result = addTomatodoRecord(dbPath, {
      segmentId: 'integration-test-1',
      subject: '物理',
      startedAt: 1782000000000,
      endedAt: 1782010800000,
      activeElapsedMs: 30 * 60 * 1000,
    });
    expect(result.ok).toBe(true);
    expect(result.record).toBeTruthy();

    const generatedKeys = Object.keys(result.record as object).sort();
    expect(generatedKeys).toEqual(realKeys);
  });

  itReal('increments recordIdCounter without colliding with existing ids', () => {
    const before = loadTomatodoDb(dbPath);
    const counterBefore = Number(before.recordIdCounter || 0);
    const expectedNext = nextRecordId(before);

    const result = addTomatodoRecord(dbPath, {
      segmentId: 'integration-test-2',
      subject: '化学',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });

    expect(result.recordId).toBe(expectedNext);
    const after = loadTomatodoDb(dbPath);
    expect(Number(after.recordIdCounter)).toBe(expectedNext);
    expect(expectedNext).toBeGreaterThan(counterBefore);
  });

  itReal('preserves all pre-existing records and metadata', () => {
    const before = loadTomatodoDb(dbPath);
    const beforeCount = before.PCRecord?.length ?? 0;
    const beforeTodoCounter = before.todoIdCounter;

    addTomatodoRecord(dbPath, {
      segmentId: 'integration-test-3',
      subject: '生物',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });

    const after = loadTomatodoDb(dbPath);
    expect(after.PCRecord?.length).toBe(beforeCount + 1);
    expect(after.todoIdCounter).toBe(beforeTodoCounter);
    // 前 beforeCount 条记录原样保留
    for (let i = 0; i < beforeCount; i++) {
      expect(after.PCRecord?.[i]).toEqual(before.PCRecord?.[i]);
    }
  });

  itReal('is idempotent: re-syncing the same segment does not duplicate', () => {
    addTomatodoRecord(dbPath, {
      segmentId: 'integration-test-4',
      subject: '数学',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });
    const second = addTomatodoRecord(dbPath, {
      segmentId: 'integration-test-4',
      subject: '数学',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });
    expect(second.skipped).toBe(true);

    const after = loadTomatodoDb(dbPath);
    const matches = (after.PCRecord ?? []).filter((r) =>
      (r.s1 ?? '').includes('integration-test-4'),
    );
    expect(matches.length).toBe(1);
  });

  itReal('stores the FocusLink marker in s1 for dedup and deletion linkage', () => {
    const result = addTomatodoRecord(dbPath, {
      segmentId: 'seg-marker-test',
      subject: '英语',
      startedAt: 1,
      endedAt: 2,
      activeElapsedMs: 60000,
    });
    expect(result.record?.s1).toBe('[FocusLink:tomatodo:segment:seg-marker-test]');
  });
});
