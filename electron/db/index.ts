// 数据库访问层 - 集中封装所有 SQL 操作
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../logger.js';
import { SCHEMA_SQL } from './schema.js';
import type {
  FocusSession,
  FocusSegment,
  PauseEvent,
  TaskCache,
  SyncQueueItem,
  SessionStatus,
  TaskSource,
  SyncStatus,
} from '@shared/types';

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath('userData');
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  const dbPath = path.join(userDataPath, 'focuslink.db');
  logger.info('database', `opening database at ${dbPath}`);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 加载内联 schema（确保打包后可用）
  db.exec(SCHEMA_SQL);
  // 运行幂等迁移（新增列，不破坏旧数据）
  runMigrations(db);
  logger.info('database', 'schema initialized');

  return db;
}

/** 幂等迁移：为旧库补充新增列。ALTER TABLE ADD COLUMN 是安全的（列不存在才加） */
function runMigrations(database: Database.Database): void {
  const hasCol = (table: string, col: string): boolean => {
    const rows = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
    return rows.some((r) => r.name === col);
  };
  // focus_sessions.default_task_title
  if (!hasCol('focus_sessions', 'default_task_title')) {
    database.exec('ALTER TABLE focus_sessions ADD COLUMN default_task_title TEXT');
    logger.info('database', 'migration: added focus_sessions.default_task_title');
  }
}

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库未初始化，请先调用 initDatabase()');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('database', 'closed');
  }
}

// ============ Session ============

export function insertSession(session: FocusSession): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO focus_sessions
      (id, title, status, started_at, ended_at, active_elapsed_ms, pause_elapsed_ms,
       wall_elapsed_ms, default_task_id, default_task_source, default_task_title, note, created_at, updated_at)
     VALUES (@id, @title, @status, @startedAt, @endedAt, @activeElapsedMs, @pauseElapsedMs,
       @wallElapsedMs, @defaultTaskId, @defaultTaskSource, @defaultTaskTitle, @note, @createdAt, @updatedAt)`,
  ).run(session);
}

export function updateSession(session: FocusSession): void {
  const db = getDb();
  db.prepare(
    `UPDATE focus_sessions SET
      title = @title, status = @status, ended_at = @endedAt,
      active_elapsed_ms = @activeElapsedMs, pause_elapsed_ms = @pauseElapsedMs,
      wall_elapsed_ms = @wallElapsedMs, default_task_id = @defaultTaskId,
      default_task_source = @defaultTaskSource, default_task_title = @defaultTaskTitle,
      note = @note, updated_at = @updatedAt
     WHERE id = @id`,
  ).run(session);
}

export function getSession(id: string): FocusSession | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(id) as
    SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function getActiveSession(): FocusSession | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM focus_sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1",
    )
    .get() as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

export function listSessions(limit = 100): FocusSession[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM focus_sessions ORDER BY started_at DESC LIMIT ?')
    .all(limit) as SessionRow[];
  return rows.map(rowToSession);
}

export function deleteSession(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM focus_sessions WHERE id = ?').run(id);
}

// ============ Segment ============

export function insertSegment(segment: FocusSegment): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO focus_segments
      (id, session_id, task_id, task_source, title, started_at, ended_at,
       active_elapsed_ms, note, created_at, updated_at)
     VALUES (@id, @sessionId, @taskId, @taskSource, @title, @startedAt, @endedAt,
       @activeElapsedMs, @note, @createdAt, @updatedAt)`,
  ).run(segment);
}

export function updateSegment(segment: FocusSegment): void {
  const db = getDb();
  db.prepare(
    `UPDATE focus_segments SET
      task_id = @taskId, task_source = @taskSource, title = @title, ended_at = @endedAt,
      active_elapsed_ms = @activeElapsedMs, note = @note, updated_at = @updatedAt
     WHERE id = @id`,
  ).run(segment);
}

export function getSegment(id: string): FocusSegment | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM focus_segments WHERE id = ?').get(id) as
    SegmentRow | undefined;
  return row ? rowToSegment(row) : null;
}

export function listSegments(sessionId: string): FocusSegment[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM focus_segments WHERE session_id = ? ORDER BY started_at ASC')
    .all(sessionId) as SegmentRow[];
  return rows.map(rowToSegment);
}

export function deleteSegment(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM focus_segments WHERE id = ?').run(id);
}

// ============ Pause ============

export function insertPause(pause: PauseEvent): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO pause_events
      (id, session_id, segment_id, pause_started_at, pause_ended_at, duration_ms,
       reason, created_at, updated_at)
     VALUES (@id, @sessionId, @segmentId, @pauseStartedAt, @pauseEndedAt, @durationMs,
       @reason, @createdAt, @updatedAt)`,
  ).run(pause);
}

export function updatePause(pause: PauseEvent): void {
  const db = getDb();
  db.prepare(
    `UPDATE pause_events SET
      pause_ended_at = @pauseEndedAt, duration_ms = @durationMs, reason = @reason,
      updated_at = @updatedAt
     WHERE id = @id`,
  ).run(pause);
}

export function getOpenPause(sessionId: string): PauseEvent | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM pause_events WHERE session_id = ? AND pause_ended_at IS NULL ORDER BY pause_started_at DESC LIMIT 1`,
    )
    .get(sessionId) as PauseRow | undefined;
  return row ? rowToPause(row) : null;
}

export function listPauses(sessionId: string): PauseEvent[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM pause_events WHERE session_id = ? ORDER BY pause_started_at ASC')
    .all(sessionId) as PauseRow[];
  return rows.map(rowToPause);
}

// ============ Tasks cache ============

export function upsertTaskCache(task: TaskCache): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO tasks_cache
      (id, source, external_id, project_id, title, status, priority, due_date,
       tags, content, raw_json, last_synced_at, created_at, updated_at)
     VALUES (@id, @source, @externalId, @projectId, @title, @status, @priority, @dueDate,
       @tags, @content, @rawJson, @lastSyncedAt, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       source = excluded.source, external_id = excluded.external_id,
       project_id = excluded.project_id, title = excluded.title, status = excluded.status,
       priority = excluded.priority, due_date = excluded.due_date, tags = excluded.tags,
       content = excluded.content, raw_json = excluded.raw_json,
       last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`,
  ).run(task);
}

export function listTaskCache(source?: TaskSource): TaskCache[] {
  const db = getDb();
  const rows = source
    ? (db
        .prepare('SELECT * FROM tasks_cache WHERE source = ? ORDER BY updated_at DESC')
        .all(source) as TaskCacheRow[])
    : (db.prepare('SELECT * FROM tasks_cache ORDER BY updated_at DESC').all() as TaskCacheRow[]);
  return rows.map(rowToTaskCache);
}

export function searchTaskCache(query: string, source?: TaskSource): TaskCache[] {
  const db = getDb();
  const pattern = `%${query}%`;
  const rows = source
    ? (db
        .prepare(
          `SELECT * FROM tasks_cache WHERE source = ? AND (title LIKE ? OR content LIKE ?) ORDER BY updated_at DESC LIMIT 50`,
        )
        .all(source, pattern, pattern) as TaskCacheRow[])
    : (db
        .prepare(
          `SELECT * FROM tasks_cache WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT 50`,
        )
        .all(pattern, pattern) as TaskCacheRow[]);
  return rows.map(rowToTaskCache);
}

// ============ Sync queue ============

export function insertSyncQueue(item: SyncQueueItem): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO sync_queue (id, type, payload, status, retry_count, last_error, created_at, updated_at)
     VALUES (@id, @type, @payload, @status, @retryCount, @lastError, @createdAt, @updatedAt)`,
  ).run(item);
}

export function updateSyncQueue(item: SyncQueueItem): void {
  const db = getDb();
  db.prepare(
    `UPDATE sync_queue SET status = @status, retry_count = @retryCount, last_error = @lastError, updated_at = @updatedAt
     WHERE id = @id`,
  ).run(item);
}

export function listSyncQueue(): SyncQueueItem[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM sync_queue ORDER BY created_at DESC LIMIT 200')
    .all() as SyncQueueRow[];
  return rows.map(rowToSyncQueue);
}

export function listPendingSync(): SyncQueueItem[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC")
    .all() as SyncQueueRow[];
  return rows.map(rowToSyncQueue);
}

export function getSyncQueueItem(id: string): SyncQueueItem | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sync_queue WHERE id = ?').get(id) as
    SyncQueueRow | undefined;
  return row ? rowToSyncQueue(row) : null;
}

// ============ Settings ============

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, now);
}

export function getMeta(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

// ============ Row mappers ============

interface SessionRow {
  id: string;
  title: string | null;
  status: string;
  started_at: number;
  ended_at: number | null;
  active_elapsed_ms: number;
  pause_elapsed_ms: number;
  wall_elapsed_ms: number;
  default_task_id: string | null;
  default_task_source: string | null;
  default_task_title: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
}
function rowToSession(r: SessionRow): FocusSession {
  return {
    id: r.id,
    title: r.title,
    status: r.status as SessionStatus,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeElapsedMs: r.active_elapsed_ms,
    pauseElapsedMs: r.pause_elapsed_ms,
    wallElapsedMs: r.wall_elapsed_ms,
    defaultTaskId: r.default_task_id,
    defaultTaskSource: (r.default_task_source as TaskSource | null) ?? null,
    defaultTaskTitle: r.default_task_title ?? null,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface SegmentRow {
  id: string;
  session_id: string;
  task_id: string | null;
  task_source: string | null;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  active_elapsed_ms: number;
  note: string | null;
  created_at: number;
  updated_at: number;
}
function rowToSegment(r: SegmentRow): FocusSegment {
  return {
    id: r.id,
    sessionId: r.session_id,
    taskId: r.task_id,
    taskSource: (r.task_source as TaskSource | null) ?? null,
    title: r.title,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeElapsedMs: r.active_elapsed_ms,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface PauseRow {
  id: string;
  session_id: string;
  segment_id: string | null;
  pause_started_at: number;
  pause_ended_at: number | null;
  duration_ms: number;
  reason: string | null;
  created_at: number;
  updated_at: number;
}
function rowToPause(r: PauseRow): PauseEvent {
  return {
    id: r.id,
    sessionId: r.session_id,
    segmentId: r.segment_id,
    pauseStartedAt: r.pause_started_at,
    pauseEndedAt: r.pause_ended_at,
    durationMs: r.duration_ms,
    reason: r.reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface TaskCacheRow {
  id: string;
  source: string;
  external_id: string;
  project_id: string | null;
  title: string;
  status: string | null;
  priority: number | null;
  due_date: number | null;
  tags: string | null;
  content: string | null;
  raw_json: string | null;
  last_synced_at: number | null;
  created_at: number;
  updated_at: number;
}
function rowToTaskCache(r: TaskCacheRow): TaskCache {
  return {
    id: r.id,
    source: r.source as TaskSource,
    externalId: r.external_id,
    projectId: r.project_id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    dueDate: r.due_date,
    tags: r.tags,
    content: r.content,
    rawJson: r.raw_json,
    lastSyncedAt: r.last_synced_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface SyncQueueRow {
  id: string;
  type: string;
  payload: string;
  status: string;
  retry_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}
function rowToSyncQueue(r: SyncQueueRow): SyncQueueItem {
  return {
    id: r.id,
    type: r.type,
    payload: r.payload,
    status: r.status as SyncStatus,
    retryCount: r.retry_count,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
