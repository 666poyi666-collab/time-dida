// 数据库 Schema - 内联字符串，确保打包后可用
export const SCHEMA_SQL = `
-- FocusLink 数据库 Schema
-- 三时间模型：activeElapsed（专注）/ pauseElapsed（暂停）/ wallElapsed（总跨度）

CREATE TABLE IF NOT EXISTS focus_sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
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

CREATE TABLE IF NOT EXISTS sync_outbox (
  op_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  base_fingerprint TEXT,
  payload TEXT,
  device_id TEXT NOT NULL,
  account_generation INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_expires_at INTEGER,
  claimed_at INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_entity_state (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  confirmed_revision INTEGER NOT NULL,
  confirmed_fingerprint TEXT NOT NULL,
  base_snapshot TEXT,
  sync_epoch TEXT NOT NULL,
  cursor_epoch TEXT NOT NULL,
  account_generation INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  conflict_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  base_payload TEXT,
  local_payload TEXT,
  remote_payload TEXT,
  conflict_fields TEXT NOT NULL,
  source_device_ids TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_op_id TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS sync_operation_history (
  op_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER,
  error_code TEXT,
  completed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_device_identity (
  device_id TEXT PRIMARY KEY,
  device_public_id TEXT NOT NULL UNIQUE,
  account_public_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  credential_ref TEXT,
  scopes TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Canonical Sync v2 state is connection-scoped.  The earlier provisional
-- tables above are intentionally retained as a read-only migration source;
-- their primary keys could not safely represent two accounts/endpoints.
CREATE TABLE IF NOT EXISTS sync_v2_outbox (
  connection_scope TEXT NOT NULL,
  op_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  base_fingerprint TEXT,
  payload TEXT,
  device_id TEXT NOT NULL,
  account_generation INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_expires_at INTEGER,
  claimed_at INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(connection_scope, op_id)
);

CREATE TABLE IF NOT EXISTS sync_v2_entity_state (
  connection_scope TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  confirmed_revision INTEGER NOT NULL,
  confirmed_fingerprint TEXT NOT NULL,
  base_snapshot TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0, 1)),
  change_seq INTEGER,
  source_device_id TEXT,
  sync_epoch TEXT NOT NULL,
  cursor_epoch TEXT NOT NULL,
  account_generation INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(connection_scope, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS sync_v2_conflicts (
  connection_scope TEXT NOT NULL,
  conflict_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  base_payload TEXT,
  local_payload TEXT,
  remote_payload TEXT,
  conflict_fields TEXT NOT NULL,
  source_device_ids TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_op_id TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  PRIMARY KEY(connection_scope, conflict_id)
);

CREATE TABLE IF NOT EXISTS sync_v2_operation_history (
  connection_scope TEXT NOT NULL,
  op_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER,
  error_code TEXT,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY(connection_scope, op_id)
);

CREATE INDEX IF NOT EXISTS idx_segments_session ON focus_segments(session_id);
CREATE INDEX IF NOT EXISTS idx_pauses_session ON pause_events(session_id);
CREATE INDEX IF NOT EXISTS idx_pauses_segment ON pause_events(segment_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks_cache(source);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON focus_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_ready ON sync_outbox(state, next_retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_lease ON sync_outbox(lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_operation_history_completed ON sync_operation_history(completed_at);
CREATE INDEX IF NOT EXISTS idx_sync_v2_outbox_ready
  ON sync_v2_outbox(connection_scope, state, next_retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_v2_outbox_lease
  ON sync_v2_outbox(connection_scope, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_sync_v2_conflicts_status
  ON sync_v2_conflicts(connection_scope, status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_v2_history_completed
  ON sync_v2_operation_history(connection_scope, completed_at);

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

CREATE TRIGGER IF NOT EXISTS trg_session_no_negative
BEFORE UPDATE ON focus_sessions
WHEN NEW.active_elapsed_ms < 0 OR NEW.pause_elapsed_ms < 0 OR NEW.wall_elapsed_ms < 0
BEGIN
  SELECT RAISE(ABORT, '不允许负时间');
END;
`;
