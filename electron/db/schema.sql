-- FocusLink 数据库 Schema
-- 三时间模型：activeElapsed（专注）/ pauseElapsed（暂停）/ wallElapsed（总跨度）

CREATE TABLE IF NOT EXISTS focus_sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT NOT NULL,           -- active | finished | aborted
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  active_elapsed_ms INTEGER NOT NULL DEFAULT 0,
  pause_elapsed_ms INTEGER NOT NULL DEFAULT 0,
  wall_elapsed_ms INTEGER NOT NULL DEFAULT 0,
  default_task_id TEXT,
  default_task_source TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS focus_segments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT,
  task_source TEXT,
  title TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  active_elapsed_ms INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(session_id) REFERENCES focus_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pause_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  segment_id TEXT,
  pause_started_at INTEGER NOT NULL,
  pause_ended_at INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(session_id) REFERENCES focus_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks_cache (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,           -- local | ticktick
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

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,             -- segment-note | session-note | focus-record
  payload TEXT NOT NULL,          -- JSON
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | synced | failed | skipped
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_segments_session ON focus_segments(session_id);
CREATE INDEX IF NOT EXISTS idx_pauses_session ON pause_events(session_id);
CREATE INDEX IF NOT EXISTS idx_pauses_segment ON pause_events(segment_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks_cache(source);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON focus_sessions(started_at DESC);

-- 数据完整性约束（触发器）
-- 不允许 segment_ended_at 早于 segment_started_at
CREATE TRIGGER IF NOT EXISTS trg_segment_time_check
BEFORE INSERT ON focus_segments
WHEN NEW.ended_at IS NOT NULL AND NEW.ended_at < NEW.started_at
BEGIN
  SELECT RAISE(ABORT, 'segment_ended_at 不能早于 segment_started_at');
END;

CREATE TRIGGER IF NOT EXISTS trg_segment_time_update
BEFORE UPDATE ON focus_segments
WHEN NEW.ended_at IS NOT NULL AND NEW.ended_at < NEW.started_at
BEGIN
  SELECT RAISE(ABORT, 'segment_ended_at 不能早于 segment_started_at');
END;

-- 不允许 pause_ended_at 早于 pause_started_at
CREATE TRIGGER IF NOT EXISTS trg_pause_time_check
BEFORE INSERT ON pause_events
WHEN NEW.pause_ended_at IS NOT NULL AND NEW.pause_ended_at < NEW.pause_started_at
BEGIN
  SELECT RAISE(ABORT, 'pause_ended_at 不能早于 pause_started_at');
END;

CREATE TRIGGER IF NOT EXISTS trg_pause_time_update
BEFORE UPDATE ON pause_events
WHEN NEW.pause_ended_at IS NOT NULL AND NEW.pause_ended_at < NEW.pause_started_at
BEGIN
  SELECT RAISE(ABORT, 'pause_ended_at 不能早于 pause_started_at');
END;

-- 不允许负时间
CREATE TRIGGER IF NOT EXISTS trg_session_no_negative
BEFORE UPDATE ON focus_sessions
WHEN NEW.active_elapsed_ms < 0 OR NEW.pause_elapsed_ms < 0 OR NEW.wall_elapsed_ms < 0
BEGIN
  SELECT RAISE(ABORT, '不允许负时间');
END;
