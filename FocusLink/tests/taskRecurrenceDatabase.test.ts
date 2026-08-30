import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { TaskCache } from '../shared/types';

const databaseFixture = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => databaseFixture.userData },
}));

vi.mock('../electron/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  closeDatabase,
  getDb,
  initDatabase,
  listTaskCache,
  upsertTaskCache,
} from '../electron/db/index';

describe('task scheduling SQLite migration', () => {
  beforeAll(() => {
    databaseFixture.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-task-db-'));
    const legacy = new Database(path.join(databaseFixture.userData, 'focuslink.db'));
    legacy.exec(`
      CREATE TABLE tasks_cache (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        project_id TEXT,
        title TEXT NOT NULL,
        status TEXT,
        priority INTEGER,
        due_date INTEGER,
        tags TEXT,
        content TEXT,
        raw_json TEXT,
        last_synced_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    legacy.close();
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
    fs.rmSync(databaseFixture.userData, { recursive: true, force: true });
  });

  it('adds start/recurrence columns and round-trips canonical recurrence JSON', () => {
    const columns = (getDb().pragma('table_info(tasks_cache)') as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(columns).toEqual(expect.arrayContaining(['parent_id', 'start_date', 'recurrence']));

    const recurrence = {
      timezone: 'Asia/Shanghai',
      frequency: 'daily' as const,
      interval: 1,
      byWeekday: [],
      byMonthDay: [],
      endAt: null,
      count: 3,
      completedCount: 1,
      rollover: 'from_schedule' as const,
    };
    const task: TaskCache = {
      id: 'local:scheduled',
      source: 'local',
      externalId: 'scheduled',
      projectId: 'local-inbox',
      parentId: null,
      title: '循环任务',
      status: 'incomplete',
      priority: 3,
      startDate: 1_720_000_000_000,
      dueDate: 1_720_003_600_000,
      recurrence: JSON.stringify(recurrence),
      tags: '["循环"]',
      content: null,
      rawJson: null,
      lastSyncedAt: null,
      createdAt: 1,
      updatedAt: 2,
    };
    upsertTaskCache(task);
    expect(listTaskCache('local')).toEqual([task]);
  });
});
