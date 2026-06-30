"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/selftest.ts
var import_electron3 = require("electron");
var import_node_path3 = __toESM(require("node:path"));
var import_node_fs3 = __toESM(require("node:fs"));

// electron/db/index.ts
var import_better_sqlite3 = __toESM(require("better-sqlite3"));
var import_electron2 = require("electron");
var import_node_path2 = __toESM(require("node:path"));
var import_node_fs2 = __toESM(require("node:fs"));

// electron/logger.ts
var import_electron = require("electron");
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var Logger = class {
  logFile = null;
  stream = null;
  buffer = [];
  init() {
    const logsDir = import_node_path.default.join(import_electron.app.getPath("userData"), "logs");
    if (!import_node_fs.default.existsSync(logsDir)) {
      import_node_fs.default.mkdirSync(logsDir, { recursive: true });
    }
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    this.logFile = import_node_path.default.join(logsDir, `focuslink-${today}.log`);
    this.stream = import_node_fs.default.createWriteStream(this.logFile, { flags: "a" });
    this.buffer.forEach((line) => this.stream?.write(line));
    this.buffer = [];
  }
  write(level, scope, msg, meta) {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    const metaStr = meta != null ? " " + JSON.stringify(meta) : "";
    const line = `[${ts}] [${level.toUpperCase()}] [${scope}] ${msg}${metaStr}
`;
    if (this.stream) {
      this.stream.write(line);
    } else {
      this.buffer.push(line);
    }
    if (level === "error") console.error(line.trim());
  }
  debug(scope, msg, meta) {
    this.write("debug", scope, msg, meta);
  }
  info(scope, msg, meta) {
    this.write("info", scope, msg, meta);
  }
  warn(scope, msg, meta) {
    this.write("warn", scope, msg, meta);
  }
  error(scope, msg, meta) {
    this.write("error", scope, msg, meta);
  }
  getLogDir() {
    return import_node_path.default.join(import_electron.app.getPath("userData"), "logs");
  }
};
var logger = new Logger();

// electron/db/schema.ts
var SCHEMA_SQL = `
-- FocusLink \u6570\u636E\u5E93 Schema
-- \u4E09\u65F6\u95F4\u6A21\u578B\uFF1AactiveElapsed\uFF08\u4E13\u6CE8\uFF09/ pauseElapsed\uFF08\u6682\u505C\uFF09/ wallElapsed\uFF08\u603B\u8DE8\u5EA6\uFF09

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

CREATE INDEX IF NOT EXISTS idx_segments_session ON focus_segments(session_id);
CREATE INDEX IF NOT EXISTS idx_pauses_session ON pause_events(session_id);
CREATE INDEX IF NOT EXISTS idx_pauses_segment ON pause_events(segment_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks_cache(source);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON focus_sessions(started_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_segment_time_check
BEFORE INSERT ON focus_segments
WHEN NEW.ended_at IS NOT NULL AND NEW.ended_at < NEW.started_at
BEGIN
  SELECT RAISE(ABORT, 'segment_ended_at \u4E0D\u80FD\u65E9\u4E8E segment_started_at');
END;

CREATE TRIGGER IF NOT EXISTS trg_segment_time_update
BEFORE UPDATE ON focus_segments
WHEN NEW.ended_at IS NOT NULL AND NEW.ended_at < NEW.started_at
BEGIN
  SELECT RAISE(ABORT, 'segment_ended_at \u4E0D\u80FD\u65E9\u4E8E segment_started_at');
END;

CREATE TRIGGER IF NOT EXISTS trg_pause_time_check
BEFORE INSERT ON pause_events
WHEN NEW.pause_ended_at IS NOT NULL AND NEW.pause_ended_at < NEW.pause_started_at
BEGIN
  SELECT RAISE(ABORT, 'pause_ended_at \u4E0D\u80FD\u65E9\u4E8E pause_started_at');
END;

CREATE TRIGGER IF NOT EXISTS trg_pause_time_update
BEFORE UPDATE ON pause_events
WHEN NEW.pause_ended_at IS NOT NULL AND NEW.pause_ended_at < NEW.pause_started_at
BEGIN
  SELECT RAISE(ABORT, 'pause_ended_at \u4E0D\u80FD\u65E9\u4E8E pause_started_at');
END;

CREATE TRIGGER IF NOT EXISTS trg_session_no_negative
BEFORE UPDATE ON focus_sessions
WHEN NEW.active_elapsed_ms < 0 OR NEW.pause_elapsed_ms < 0 OR NEW.wall_elapsed_ms < 0
BEGIN
  SELECT RAISE(ABORT, '\u4E0D\u5141\u8BB8\u8D1F\u65F6\u95F4');
END;
`;

// electron/db/index.ts
var db = null;
function initDatabase() {
  if (db) return db;
  const userDataPath = import_electron2.app.getPath("userData");
  if (!import_node_fs2.default.existsSync(userDataPath)) {
    import_node_fs2.default.mkdirSync(userDataPath, { recursive: true });
  }
  const dbPath = import_node_path2.default.join(userDataPath, "focuslink.db");
  logger.info("database", `opening database at ${dbPath}`);
  db = new import_better_sqlite3.default(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  runMigrations(db);
  logger.info("database", "schema initialized");
  return db;
}
function runMigrations(database) {
  const hasCol = (table, col) => {
    const rows = database.pragma(`table_info(${table})`);
    return rows.some((r) => r.name === col);
  };
  if (!hasCol("focus_sessions", "default_task_title")) {
    database.exec("ALTER TABLE focus_sessions ADD COLUMN default_task_title TEXT");
    logger.info("database", "migration: added focus_sessions.default_task_title");
  }
}
function getDb() {
  if (!db) throw new Error("\u6570\u636E\u5E93\u672A\u521D\u59CB\u5316\uFF0C\u8BF7\u5148\u8C03\u7528 initDatabase()");
  return db;
}
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    logger.info("database", "closed");
  }
}
function insertSession(session) {
  const db2 = getDb();
  db2.prepare(
    `INSERT INTO focus_sessions
      (id, title, status, started_at, ended_at, active_elapsed_ms, pause_elapsed_ms,
       wall_elapsed_ms, default_task_id, default_task_source, default_task_title, note, created_at, updated_at)
     VALUES (@id, @title, @status, @startedAt, @endedAt, @activeElapsedMs, @pauseElapsedMs,
       @wallElapsedMs, @defaultTaskId, @defaultTaskSource, @defaultTaskTitle, @note, @createdAt, @updatedAt)`
  ).run(session);
}
function updateSession(session) {
  const db2 = getDb();
  db2.prepare(
    `UPDATE focus_sessions SET
      title = @title, status = @status, ended_at = @endedAt,
      active_elapsed_ms = @activeElapsedMs, pause_elapsed_ms = @pauseElapsedMs,
      wall_elapsed_ms = @wallElapsedMs, default_task_id = @defaultTaskId,
      default_task_source = @defaultTaskSource, default_task_title = @defaultTaskTitle,
      note = @note, updated_at = @updatedAt
     WHERE id = @id`
  ).run(session);
}
function getSession(id) {
  const db2 = getDb();
  const row = db2.prepare("SELECT * FROM focus_sessions WHERE id = ?").get(id);
  return row ? rowToSession(row) : null;
}
function getActiveSession() {
  const db2 = getDb();
  const row = db2.prepare("SELECT * FROM focus_sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1").get();
  return row ? rowToSession(row) : null;
}
function insertSegment(segment) {
  const db2 = getDb();
  db2.prepare(
    `INSERT INTO focus_segments
      (id, session_id, task_id, task_source, title, started_at, ended_at,
       active_elapsed_ms, note, created_at, updated_at)
     VALUES (@id, @sessionId, @taskId, @taskSource, @title, @startedAt, @endedAt,
       @activeElapsedMs, @note, @createdAt, @updatedAt)`
  ).run(segment);
}
function updateSegment(segment) {
  const db2 = getDb();
  db2.prepare(
    `UPDATE focus_segments SET
      task_id = @taskId, task_source = @taskSource, title = @title, ended_at = @endedAt,
      active_elapsed_ms = @activeElapsedMs, note = @note, updated_at = @updatedAt
     WHERE id = @id`
  ).run(segment);
}
function getSegment(id) {
  const db2 = getDb();
  const row = db2.prepare("SELECT * FROM focus_segments WHERE id = ?").get(id);
  return row ? rowToSegment(row) : null;
}
function listSegments(sessionId) {
  const db2 = getDb();
  const rows = db2.prepare("SELECT * FROM focus_segments WHERE session_id = ? ORDER BY started_at ASC").all(sessionId);
  return rows.map(rowToSegment);
}
function deleteSegment(id) {
  const db2 = getDb();
  db2.prepare("DELETE FROM focus_segments WHERE id = ?").run(id);
}
function insertPause(pause) {
  const db2 = getDb();
  db2.prepare(
    `INSERT INTO pause_events
      (id, session_id, segment_id, pause_started_at, pause_ended_at, duration_ms,
       reason, created_at, updated_at)
     VALUES (@id, @sessionId, @segmentId, @pauseStartedAt, @pauseEndedAt, @durationMs,
       @reason, @createdAt, @updatedAt)`
  ).run(pause);
}
function updatePause(pause) {
  const db2 = getDb();
  db2.prepare(
    `UPDATE pause_events SET
      pause_ended_at = @pauseEndedAt, duration_ms = @durationMs, reason = @reason,
      updated_at = @updatedAt
     WHERE id = @id`
  ).run(pause);
}
function getOpenPause(sessionId) {
  const db2 = getDb();
  const row = db2.prepare(
    `SELECT * FROM pause_events WHERE session_id = ? AND pause_ended_at IS NULL ORDER BY pause_started_at DESC LIMIT 1`
  ).get(sessionId);
  return row ? rowToPause(row) : null;
}
function listPauses(sessionId) {
  const db2 = getDb();
  const rows = db2.prepare("SELECT * FROM pause_events WHERE session_id = ? ORDER BY pause_started_at ASC").all(sessionId);
  return rows.map(rowToPause);
}
function getMeta(key) {
  const db2 = getDb();
  const row = db2.prepare("SELECT value FROM app_meta WHERE key = ?").get(key);
  return row?.value ?? null;
}
function setMeta(key, value) {
  const db2 = getDb();
  db2.prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
function rowToSession(r) {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeElapsedMs: r.active_elapsed_ms,
    pauseElapsedMs: r.pause_elapsed_ms,
    wallElapsedMs: r.wall_elapsed_ms,
    defaultTaskId: r.default_task_id,
    defaultTaskSource: r.default_task_source ?? null,
    defaultTaskTitle: r.default_task_title ?? null,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
function rowToSegment(r) {
  return {
    id: r.id,
    sessionId: r.session_id,
    taskId: r.task_id,
    taskSource: r.task_source ?? null,
    title: r.title,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    activeElapsedMs: r.active_elapsed_ms,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}
function rowToPause(r) {
  return {
    id: r.id,
    sessionId: r.session_id,
    segmentId: r.segment_id,
    pauseStartedAt: r.pause_started_at,
    pauseEndedAt: r.pause_ended_at,
    durationMs: r.duration_ms,
    reason: r.reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

// electron/timer/manager.ts
var import_node_crypto = __toESM(require("node:crypto"));

// electron/timer/stateMachine.ts
var TRANSITIONS = {
  idle: { START: "running" },
  running: { PAUSE: "paused", STOP: "finished" },
  paused: { RESUME: "running", STOP: "finished" },
  stopping: { STOP: "finished" },
  finished: { RESET: "idle" }
};
function transition(current, event) {
  const next = TRANSITIONS[current]?.[event];
  if (!next) {
    return {
      newState: current,
      ok: false,
      reason: `\u975E\u6CD5\u72B6\u6001\u8F6C\u6362: ${current} + ${event}`
    };
  }
  return { newState: next, ok: true };
}
function getToggleEvent(state) {
  switch (state) {
    case "idle":
      return "START";
    case "running":
      return "PAUSE";
    case "paused":
      return "RESUME";
    default:
      return null;
  }
}

// electron/timer/manager.ts
var TICK_INTERVAL_MS = 1e3;
var PERSIST_INTERVAL_MS = 5e3;
var META_LAST_TICK = "timer.lastTick";
var META_LAST_STATE = "timer.lastState";
var META_LAST_SEGMENT = "timer.lastSegmentId";
var TimerManager = class {
  state = "idle";
  session = null;
  currentSegment = null;
  currentPause = null;
  /** 当前 segment 自上次持久化以来已累计的活跃毫秒（增量） */
  activeElapsedMs = 0;
  pauseElapsedMs = 0;
  /** 上一次 tick 的时间戳，用于增量计算 */
  lastTick = 0;
  tickTimer = null;
  persistTimer = null;
  listeners = /* @__PURE__ */ new Set();
  segmentBehavior = "new-segment";
  constructor(segmentBehavior = "new-segment") {
    this.segmentBehavior = segmentBehavior;
  }
  setSegmentBehavior(b) {
    this.segmentBehavior = b;
  }
  onSnapshot(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit() {
    const snap = this.getSnapshot();
    this.listeners.forEach((l) => l(snap));
  }
  // ============ 启动 / 恢复 ============
  /** 程序启动时调用，从 DB 恢复状态 */
  recover() {
    const active = getActiveSession();
    if (!active) {
      logger.info("timer", "no active session to recover");
      return;
    }
    this.session = active;
    const segments = listSegments(active.id);
    const lastSegment = segments[segments.length - 1] ?? null;
    const openPause = getOpenPause(active.id);
    const lastTickStr = getMeta(META_LAST_TICK);
    const lastState = getMeta(META_LAST_STATE) ?? "running";
    const lastTick = lastTickStr ? Number(lastTickStr) : 0;
    if (openPause) {
      this.currentPause = openPause;
      this.currentSegment = lastSegment;
      this.activeElapsedMs = active.activeElapsedMs;
      this.pauseElapsedMs = active.pauseElapsedMs;
      this.state = "paused";
      logger.info("timer", "recovered as paused", { sessionId: active.id });
    } else if (lastState === "running" && lastSegment && lastTick > 0) {
      this.currentSegment = lastSegment;
      this.activeElapsedMs = active.activeElapsedMs;
      this.pauseElapsedMs = active.pauseElapsedMs;
      const now = Date.now();
      const delta = Math.max(0, now - lastTick);
      this.activeElapsedMs += delta;
      this.lastTick = now;
      this.state = "running";
      logger.info("timer", "recovered as running, recalculated", {
        sessionId: active.id,
        deltaMs: delta
      });
      this.startTick();
    } else {
      logger.warn("timer", "unclear recovery state, finishing session", { sessionId: active.id });
      this.session = active;
      this.stop();
      return;
    }
    this.emit();
  }
  // ============ 状态转换 ============
  toggle() {
    const event = getToggleEvent(this.state);
    if (!event) {
      logger.warn("timer", `toggle ignored in state ${this.state}`);
      return this.getSnapshot();
    }
    if (event === "START") return this.start();
    if (event === "PAUSE") return this.pause();
    if (event === "RESUME") return this.resume();
    return this.getSnapshot();
  }
  start() {
    const result = transition(this.state, "START");
    if (!result.ok) {
      logger.warn("timer", result.reason ?? "start failed");
      return this.getSnapshot();
    }
    const now = Date.now();
    const session = {
      id: import_node_crypto.default.randomUUID(),
      title: null,
      status: "active",
      startedAt: now,
      endedAt: null,
      activeElapsedMs: 0,
      pauseElapsedMs: 0,
      wallElapsedMs: 0,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: null,
      createdAt: now,
      updatedAt: now
    };
    insertSession(session);
    this.session = session;
    const segment = this.createSegment(session.id, now);
    this.currentSegment = segment;
    this.activeElapsedMs = 0;
    this.pauseElapsedMs = 0;
    this.lastTick = now;
    this.state = "running";
    this.persistMeta(now);
    this.startTick();
    logger.info("timer", "started", { sessionId: session.id, segmentId: segment.id });
    this.emit();
    return this.getSnapshot();
  }
  /** 带任务原子启动：开始专注时同时写入 Session 默认任务 + 第一个 Segment 任务。
   *  避免出现"先 start 再 link"的中间脏状态。 */
  startWithTask(taskId, taskSource, taskTitle) {
    const result = transition(this.state, "START");
    if (!result.ok) {
      logger.warn("timer", result.reason ?? "startWithTask failed");
      return this.getSnapshot();
    }
    const now = Date.now();
    const session = {
      id: import_node_crypto.default.randomUUID(),
      title: null,
      status: "active",
      startedAt: now,
      endedAt: null,
      activeElapsedMs: 0,
      pauseElapsedMs: 0,
      wallElapsedMs: 0,
      // Session 默认任务 = 用户选择的任务
      defaultTaskId: taskId,
      defaultTaskSource: taskSource,
      defaultTaskTitle: taskTitle ?? null,
      note: null,
      createdAt: now,
      updatedAt: now
    };
    insertSession(session);
    this.session = session;
    const segment = this.createSegment(session.id, now);
    segment.taskId = taskId;
    segment.taskSource = taskSource;
    if (taskTitle != null) segment.title = taskTitle;
    segment.updatedAt = now;
    updateSegment(segment);
    this.currentSegment = segment;
    this.activeElapsedMs = 0;
    this.pauseElapsedMs = 0;
    this.lastTick = now;
    this.state = "running";
    this.persistMeta(now);
    this.startTick();
    logger.info("timer", "started with task", {
      sessionId: session.id,
      segmentId: segment.id,
      taskId,
      taskTitle
    });
    this.emit();
    return this.getSnapshot();
  }
  pause() {
    const result = transition(this.state, "PAUSE");
    if (!result.ok) {
      logger.warn("timer", result.reason ?? "pause failed");
      return this.getSnapshot();
    }
    const now = Date.now();
    this.settleActive(now);
    if (this.session && this.currentSegment) {
      const pause = {
        id: import_node_crypto.default.randomUUID(),
        sessionId: this.session.id,
        segmentId: this.currentSegment.id,
        pauseStartedAt: now,
        pauseEndedAt: null,
        durationMs: 0,
        reason: null,
        createdAt: now,
        updatedAt: now
      };
      insertPause(pause);
      this.currentPause = pause;
    }
    this.state = "paused";
    this.persistMeta(now);
    this.stopTick();
    logger.info("timer", "paused", { activeMs: this.activeElapsedMs });
    this.emit();
    return this.getSnapshot();
  }
  resume() {
    const result = transition(this.state, "RESUME");
    if (!result.ok) {
      logger.warn("timer", result.reason ?? "resume failed");
      return this.getSnapshot();
    }
    const now = Date.now();
    if (this.currentPause && this.session) {
      const duration = Math.max(0, now - this.currentPause.pauseStartedAt);
      this.currentPause.pauseEndedAt = now;
      this.currentPause.durationMs = duration;
      this.currentPause.updatedAt = now;
      updatePause(this.currentPause);
      this.pauseElapsedMs += duration;
    }
    this.currentPause = null;
    if (this.segmentBehavior === "new-segment" && this.session) {
      this.closeSegment(now);
      const seg = this.createSegment(this.session.id, now);
      this.currentSegment = seg;
      if (this.session.defaultTaskId && this.session.defaultTaskSource) {
        seg.taskId = this.session.defaultTaskId;
        seg.taskSource = this.session.defaultTaskSource;
        if (this.session.defaultTaskTitle) seg.title = this.session.defaultTaskTitle;
        updateSegment(seg);
      }
    }
    this.lastTick = now;
    this.state = "running";
    this.persistMeta(now);
    this.startTick();
    logger.info("timer", "resumed", {
      newSegment: this.segmentBehavior === "new-segment",
      pauseMs: this.pauseElapsedMs
    });
    this.emit();
    return this.getSnapshot();
  }
  stop() {
    const fromState = this.state;
    const result = transition(this.state, "STOP");
    if (!result.ok) {
      logger.warn("timer", result.reason ?? "stop failed");
      return this.getSnapshot();
    }
    const now = Date.now();
    if (fromState === "running") {
      this.settleActive(now);
    }
    if (this.currentPause && this.session) {
      const duration = Math.max(0, now - this.currentPause.pauseStartedAt);
      this.currentPause.pauseEndedAt = now;
      this.currentPause.durationMs = duration;
      this.currentPause.updatedAt = now;
      updatePause(this.currentPause);
      this.pauseElapsedMs += duration;
      this.currentPause = null;
    }
    this.closeSegment(now);
    if (this.session) {
      this.session.status = "finished";
      this.session.endedAt = now;
      this.session.activeElapsedMs = this.activeElapsedMs;
      this.session.pauseElapsedMs = this.pauseElapsedMs;
      this.session.wallElapsedMs = Math.max(0, now - this.session.startedAt);
      this.session.updatedAt = now;
      updateSession(this.session);
    }
    this.state = "finished";
    this.stopTick();
    this.clearMeta();
    logger.info("timer", "stopped", {
      activeMs: this.activeElapsedMs,
      pauseMs: this.pauseElapsedMs,
      wallMs: this.session?.wallElapsedMs
    });
    this.emit();
    setTimeout(() => this.reset(), 1500);
    return this.getSnapshot();
  }
  reset() {
    const result = transition(this.state, "RESET");
    if (!result.ok) {
      if (this.state !== "finished" && this.state !== "idle") {
        logger.warn("timer", `force reset from ${this.state}`);
      }
    }
    this.session = null;
    this.currentSegment = null;
    this.currentPause = null;
    this.activeElapsedMs = 0;
    this.pauseElapsedMs = 0;
    this.lastTick = 0;
    this.state = "idle";
    this.stopTick();
    this.clearMeta();
    this.emit();
    return this.getSnapshot();
  }
  // ============ 任务关联 ============
  linkSegmentTask(segmentId, taskId, taskSource, taskTitle) {
    const seg = getSegment(segmentId);
    if (!seg) throw new Error(`segment \u4E0D\u5B58\u5728: ${segmentId}`);
    seg.taskId = taskId;
    seg.taskSource = taskSource;
    if (taskTitle != null) seg.title = taskTitle;
    seg.updatedAt = Date.now();
    updateSegment(seg);
    if (this.currentSegment?.id === segmentId) {
      this.currentSegment = seg;
    }
    logger.info("timer", "linked task to segment", { segmentId, taskId, taskSource });
    this.emit();
  }
  /** 清除某 segment 的任务关联 */
  clearSegmentTask(segmentId) {
    const seg = getSegment(segmentId);
    if (!seg) throw new Error(`segment \u4E0D\u5B58\u5728: ${segmentId}`);
    seg.taskId = null;
    seg.taskSource = null;
    seg.title = null;
    seg.updatedAt = Date.now();
    updateSegment(seg);
    if (this.currentSegment?.id === segmentId) {
      this.currentSegment = seg;
    }
    logger.info("timer", "cleared segment task link", { segmentId });
    this.emit();
  }
  linkSessionTask(sessionId, taskId, taskSource, taskTitle) {
    if (!this.session || this.session.id !== sessionId) {
      const s = getSession(sessionId);
      if (!s) throw new Error(`session \u4E0D\u5B58\u5728: ${sessionId}`);
      this.session = s;
    }
    this.session.defaultTaskId = taskId;
    this.session.defaultTaskSource = taskSource;
    this.session.defaultTaskTitle = taskTitle ?? null;
    this.session.updatedAt = Date.now();
    updateSession(this.session);
    if (this.currentSegment && !this.currentSegment.taskId) {
      this.currentSegment.taskId = taskId;
      this.currentSegment.taskSource = taskSource;
      if (taskTitle != null) this.currentSegment.title = taskTitle;
      this.currentSegment.updatedAt = Date.now();
      updateSegment(this.currentSegment);
    }
    logger.info("timer", "linked task to session", { sessionId, taskId, taskSource });
    this.emit();
  }
  /** 清除 session 的默认任务 */
  clearSessionDefaultTask(sessionId) {
    if (!this.session || this.session.id !== sessionId) {
      const s = getSession(sessionId);
      if (!s) throw new Error(`session \u4E0D\u5B58\u5728: ${sessionId}`);
      this.session = s;
    }
    this.session.defaultTaskId = null;
    this.session.defaultTaskSource = null;
    this.session.defaultTaskTitle = null;
    this.session.updatedAt = Date.now();
    updateSession(this.session);
    logger.info("timer", "cleared session default task", { sessionId });
    this.emit();
  }
  /** 批量关联一个 session 的 segments 到指定任务
   *  onlyUnlinked=true: 只关联未设置任务的 segment
   *  onlyUnlinked=false: 覆盖所有 segment
   *  返回被更新的 segment 数量
   */
  linkSegmentsBatch(sessionId, taskId, taskSource, taskTitle, onlyUnlinked) {
    const segs = listSegments(sessionId);
    let count = 0;
    for (const seg of segs) {
      if (onlyUnlinked && seg.taskId) continue;
      seg.taskId = taskId;
      seg.taskSource = taskSource;
      if (taskTitle != null) seg.title = taskTitle;
      seg.updatedAt = Date.now();
      updateSegment(seg);
      if (this.currentSegment?.id === seg.id) {
        this.currentSegment = seg;
      }
      count++;
    }
    if (count > 0) {
      if (!this.session || this.session.id !== sessionId) {
        const s = getSession(sessionId);
        if (s) this.session = s;
      }
      if (this.session) {
        this.session.defaultTaskId = taskId;
        this.session.defaultTaskSource = taskSource;
        this.session.defaultTaskTitle = taskTitle;
        this.session.updatedAt = Date.now();
        updateSession(this.session);
      }
    }
    logger.info("timer", "batch linked segments", { sessionId, count, onlyUnlinked });
    this.emit();
    return count;
  }
  setSegmentTitle(segmentId, title) {
    const seg = getSegment(segmentId);
    if (!seg) throw new Error(`segment \u4E0D\u5B58\u5728: ${segmentId}`);
    seg.title = title;
    seg.updatedAt = Date.now();
    updateSegment(seg);
    if (this.currentSegment?.id === segmentId) {
      this.currentSegment = seg;
    }
    this.emit();
  }
  /** 合并多个 segment 为一个（按时间顺序拼接，时长相加） */
  mergeSegments(segmentIds) {
    if (!this.session || segmentIds.length < 2) return;
    const segs = listSegments(this.session.id).filter((s) => segmentIds.includes(s.id));
    if (segs.length < 2) return;
    segs.sort((a, b) => a.startedAt - b.startedAt);
    const first = segs[0];
    const last = segs[segs.length - 1];
    const totalActive = segs.reduce((sum, s) => sum + s.activeElapsedMs, 0);
    first.endedAt = last.endedAt;
    first.activeElapsedMs = totalActive;
    first.updatedAt = Date.now();
    updateSegment(first);
    for (let i = 1; i < segs.length; i++) {
      deleteSegment(segs[i].id);
    }
    if (this.currentSegment && segmentIds.includes(this.currentSegment.id)) {
      this.currentSegment = first;
    }
    logger.info("timer", "merged segments", { count: segs.length, into: first.id });
    this.emit();
  }
  // ============ 内部辅助 ============
  createSegment(sessionId, startedAt) {
    const now = startedAt;
    const segment = {
      id: import_node_crypto.default.randomUUID(),
      sessionId,
      taskId: null,
      taskSource: null,
      title: null,
      startedAt,
      endedAt: null,
      activeElapsedMs: 0,
      note: null,
      createdAt: now,
      updatedAt: now
    };
    insertSegment(segment);
    return segment;
  }
  closeSegment(now) {
    if (!this.currentSegment) return;
    this.currentSegment.endedAt = now;
    this.currentSegment.activeElapsedMs = this.activeElapsedMs;
    this.currentSegment.updatedAt = now;
    updateSegment(this.currentSegment);
  }
  /** 把自 lastTick 到 now 的活跃时间计入 activeElapsedMs */
  settleActive(now) {
    if (this.state !== "running" || this.lastTick === 0) return;
    const delta = Math.max(0, now - this.lastTick);
    this.activeElapsedMs += delta;
    this.lastTick = now;
  }
  startTick() {
    this.stopTick();
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.persistTimer = setInterval(() => this.persistSnapshot(), PERSIST_INTERVAL_MS);
  }
  stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
  }
  tick() {
    if (this.state !== "running") return;
    const now = Date.now();
    this.settleActive(now);
    this.emit();
  }
  /** 周期性持久化 activeElapsedMs 快照，便于崩溃恢复 */
  persistSnapshot() {
    if (this.state !== "running" && this.state !== "paused") return;
    const now = Date.now();
    this.settleActive(now);
    if (this.currentSegment && this.session) {
      this.currentSegment.activeElapsedMs = this.activeElapsedMs;
      this.currentSegment.updatedAt = now;
      updateSegment(this.currentSegment);
      this.session.activeElapsedMs = this.activeElapsedMs;
      this.session.pauseElapsedMs = this.pauseElapsedMs;
      this.session.wallElapsedMs = Math.max(0, now - this.session.startedAt);
      this.session.updatedAt = now;
      updateSession(this.session);
    }
    this.persistMeta(now);
  }
  persistMeta(now) {
    setMeta(META_LAST_TICK, String(now));
    setMeta(META_LAST_STATE, this.state);
    if (this.currentSegment) {
      setMeta(META_LAST_SEGMENT, this.currentSegment.id);
    }
  }
  clearMeta() {
    setMeta(META_LAST_TICK, "0");
    setMeta(META_LAST_STATE, "idle");
    setMeta(META_LAST_SEGMENT, "");
  }
  // ============ 快照 ============
  getSnapshot() {
    const now = Date.now();
    const activeMs = this.activeElapsedMs;
    const pauseMs = this.pauseElapsedMs;
    let wallMs = 0;
    let currentPauseStartedAt = null;
    if (this.session) {
      wallMs = Math.max(0, now - this.session.startedAt);
      if (this.state === "paused" && this.currentPause) {
        currentPauseStartedAt = this.currentPause.pauseStartedAt;
      }
    }
    const segments = this.buildSegmentSummaries(now);
    return {
      state: this.state,
      sessionId: this.session?.id ?? null,
      currentSegmentId: this.currentSegment?.id ?? null,
      currentTaskId: this.currentSegment?.taskId ?? this.session?.defaultTaskId ?? null,
      // 当前片段标题优先；否则用 session 默认任务标题；均为空则 null（渲染层显示"未关联任务"）
      currentTaskTitle: this.currentSegment?.title ?? this.session?.defaultTaskTitle ?? null,
      currentTaskSource: this.currentSegment?.taskSource ?? this.session?.defaultTaskSource ?? null,
      // Session 默认任务（用于任务区高亮"本次默认"标识 + TimerPanel 显示）
      sessionDefaultTaskId: this.session?.defaultTaskId ?? null,
      sessionDefaultTaskTitle: this.session?.defaultTaskTitle ?? null,
      activeElapsedMs: activeMs,
      pauseElapsedMs: pauseMs,
      wallElapsedMs: wallMs,
      currentPauseStartedAt,
      segments,
      // lastTick = 上次活跃结算时间（running 时）；渲染层用 (now - lastTick) 算增量
      lastTick: this.lastTick > 0 ? this.lastTick : now
    };
  }
  buildSegmentSummaries(_now) {
    if (!this.session) return [];
    const segs = listSegments(this.session.id);
    return segs.map((s) => {
      const activeMs = this.currentSegment?.id === s.id ? this.activeElapsedMs : s.activeElapsedMs;
      return {
        id: s.id,
        taskId: s.taskId,
        // segment.title 存储的是关联任务标题（linkSegmentTask 时写入）
        taskTitle: s.title,
        taskSource: s.taskSource,
        title: s.title,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        activeElapsedMs: activeMs
      };
    });
  }
  dispose() {
    this.stopTick();
    this.persistSnapshot();
  }
};

// scripts/selftest.ts
var RESULT_FILE = import_node_path3.default.join(process.cwd(), "selftest-result.json");
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runSelfTest() {
  logger.init();
  initDatabase();
  const timer = new TimerManager("new-segment");
  timer.recover();
  const result = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    steps: [],
    db: null,
    errors: []
  };
  try {
    let snap = timer.start();
    result.steps.push({ step: "start", state: snap.state, sessionId: snap.sessionId, at: Date.now() });
    const sessionId = snap.sessionId;
    const realStart = Date.now();
    await sleep(2e3);
    snap = timer.pause();
    result.steps.push({
      step: "pause",
      state: snap.state,
      activeElapsedMs: snap.activeElapsedMs,
      pauseElapsedMs: snap.pauseElapsedMs,
      at: Date.now()
    });
    await sleep(1e3);
    snap = timer.resume();
    result.steps.push({
      step: "resume",
      state: snap.state,
      activeElapsedMs: snap.activeElapsedMs,
      pauseElapsedMs: snap.pauseElapsedMs,
      at: Date.now()
    });
    await sleep(2e3);
    snap = timer.stop();
    result.steps.push({
      step: "stop",
      state: snap.state,
      activeElapsedMs: snap.activeElapsedMs,
      pauseElapsedMs: snap.pauseElapsedMs,
      wallElapsedMs: snap.wallElapsedMs,
      at: Date.now()
    });
    const realEnd = Date.now();
    const active = snap.activeElapsedMs;
    const pause = snap.pauseElapsedMs;
    const wall = snap.wallElapsedMs;
    const realWall = realEnd - realStart;
    result.summary = {
      activeElapsedMs: active,
      pauseElapsedMs: pause,
      wallElapsedMs: wall,
      realWallMs: realWall,
      activeSeconds: (active / 1e3).toFixed(2),
      pauseSeconds: (pause / 1e3).toFixed(2),
      wallSeconds: (wall / 1e3).toFixed(2),
      // 期望：active ≈ 4000, pause ≈ 1000, wall ≈ 5000
      activeOk: active >= 3500 && active <= 5500,
      pauseOk: pause >= 700 && pause <= 2e3,
      wallOk: wall >= 4500 && wall <= 6500,
      noNegative: active >= 0 && pause >= 0 && wall >= 0,
      wallGeActive: wall >= active
    };
    const session = getSession(sessionId);
    const segments = listSegments(sessionId);
    const pauses = listPauses(sessionId);
    result.db = {
      session: session ? {
        id: session.id,
        status: session.status,
        activeElapsedMs: session.activeElapsedMs,
        pauseElapsedMs: session.pauseElapsedMs,
        wallElapsedMs: session.wallElapsedMs,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        endedAtNotNull: session.endedAt !== null
      } : null,
      segments: segments.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        activeElapsedMs: s.activeElapsedMs,
        endedAtGeStartedAt: s.endedAt ? s.endedAt >= s.startedAt : false
      })),
      pauses: pauses.map((p) => ({
        id: p.id,
        pauseStartedAt: p.pauseStartedAt,
        pauseEndedAt: p.pauseEndedAt,
        durationMs: p.durationMs,
        endedAtGeStartedAt: p.pauseEndedAt ? p.pauseEndedAt >= p.pauseStartedAt : false
      })),
      segmentsCount: segments.length,
      pausesCount: pauses.length,
      // segment 时间不重叠
      segmentsNonOverlapping: segments.length === 2 ? (segments[0].endedAt ?? 0) <= segments[1].startedAt : true
    };
    result.success = result.summary.activeOk && result.summary.pauseOk && result.summary.noNegative;
  } catch (err) {
    result.errors.push(err?.message ?? String(err));
    result.success = false;
  } finally {
    timer.dispose();
    closeDatabase();
  }
  return result;
}
import_electron3.app.whenReady().then(async () => {
  const result = await runSelfTest();
  import_node_fs3.default.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.log("===== SELF-TEST RESULT =====");
  console.log(JSON.stringify(result, null, 2));
  import_electron3.app.exit(result.success ? 0 : 1);
});
