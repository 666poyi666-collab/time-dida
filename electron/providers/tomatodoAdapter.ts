// 番茄 Todo 本地数据库适配器
// 读写 C:\Users\<user>\AppData\Roaming\tomatodo\tomatodo_db.json
// 移植自 fanqie/supervision/tomatodo_writer.py 的写入逻辑（TypeScript 重写）
//
// 设计要点：
//   - 核心函数接收显式 dbPath，不依赖 electron，可在 vitest 中单测
//   - 写入前自动备份；递增 recordIdCounter；marker 去重存入 PCRecord.s1
//   - 保留 tomatodo_db.json 全部既有字段，只追加 PCRecord 并递增计数器
//   - 遵循 AGENTS.md：不拼 shell 字符串操作 JSON，直接用 fs 读写
import fs from 'node:fs';
import path from 'node:path';

import { logger } from '../logger.js';
import {
  buildTomatodoRecord,
  collectSyncedSegmentIds,
  getTomatodoMarker,
  parseSegmentIdFromMarker,
  type TomatodoPCRecord,
  type TomatodoSubject,
} from '../../shared/tomatodoPolicy.js';

/** tomatodo_db.json 结构（仅声明 FocusLink 关心的字段，其余保留透传） */
export interface TomatodoDb {
  PCToDo?: unknown[];
  PCRecord?: TomatodoPCRecord[];
  PCDeletedTodo?: unknown[];
  todoIdCounter?: number;
  recordIdCounter?: number;
  [key: string]: unknown;
}

export interface AddRecordInput {
  segmentId: string;
  subject: TomatodoSubject;
  startedAt: number;
  endedAt: number;
  activeElapsedMs: number;
}

export interface AddRecordResult {
  ok: boolean;
  /** true 表示 marker 已存在，跳过写入 */
  skipped: boolean;
  record?: TomatodoPCRecord;
  recordId?: number;
  backupPath?: string;
  error?: string;
}

export interface DeleteResult {
  ok: boolean;
  deletedCount: number;
  error?: string;
}

/** 北京时区偏移（备份文件名用） */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function nowBeijingStamp(): string {
  const d = new Date(Date.now() + BEIJING_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    '_' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

/** 读取 tomatodo_db.json；文件不存在或解析失败返回空骨架 */
export function loadTomatodoDb(dbPath: string): TomatodoDb {
  if (!fs.existsSync(dbPath)) {
    return { PCToDo: [], PCRecord: [], todoIdCounter: 0, recordIdCounter: 0 };
  }
  const raw = fs.readFileSync(dbPath, 'utf8').trim();
  if (!raw) {
    return { PCToDo: [], PCRecord: [], todoIdCounter: 0, recordIdCounter: 0 };
  }
  return JSON.parse(raw) as TomatodoDb;
}

/** 备份当前 db 文件到 tomatodo_db.backup_YYYYMMDD_HHMMSS.json，返回备份路径 */
function backupDb(dbPath: string): string | null {
  if (!fs.existsSync(dbPath)) return null;
  const backup = path.join(
    path.dirname(dbPath),
    `tomatodo_db.backup_${nowBeijingStamp()}.json`,
  );
  try {
    fs.copyFileSync(dbPath, backup);
    return backup;
  } catch (err) {
    logger.warn('tomatodoAdapter', 'backup failed', err);
    return null;
  }
}

/** 原子写：先写临时文件再覆盖目标，避免半写状态 */
function saveTomatodoDb(dbPath: string, db: TomatodoDb): void {
  const text = JSON.stringify(db, null, 2);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${dbPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  // Windows 上 renameSync 覆盖已存在目标可能失败，直接用 writeFileSync 落盘
  fs.writeFileSync(dbPath, text, 'utf8');
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* tmp 可能已被覆盖写时合并，忽略 */
  }
}

/** 取 recordIdCounter+1，并保证不与现有 PCRecord.id 冲突 */
export function nextRecordId(
  db: { recordIdCounter?: number; PCRecord?: ReadonlyArray<{ id: number }> },
): number {
  const counter = Number(db.recordIdCounter || 0);
  const existing = new Set<number>();
  for (const r of db.PCRecord ?? []) {
    if (typeof r.id === 'number') existing.add(r.id);
  }
  let next = counter + 1;
  while (existing.has(next)) next += 1;
  return next;
}

/** 列出已同步的 segmentId 集合（通过 marker 反查） */
export function listSyncedSegmentIds(dbPath: string): Set<string> {
  try {
    const db = loadTomatodoDb(dbPath);
    return collectSyncedSegmentIds(db.PCRecord ?? []);
  } catch (err) {
    logger.warn('tomatodoAdapter', 'listSyncedSegmentIds failed', err);
    return new Set();
  }
}

/** 检测某 segment 是否已写入番茄 Todo（marker 去重） */
export function hasRecordForSegment(dbPath: string, segmentId: string): boolean {
  try {
    const db = loadTomatodoDb(dbPath);
    const marker = getTomatodoMarker(segmentId);
    return (db.PCRecord ?? []).some((r) => (r.s1 ?? '').includes(marker));
  } catch {
    return false;
  }
}

/** 追加一条 PCRecord。marker 已存在则跳过（幂等）。 */
export function addTomatodoRecord(
  dbPath: string,
  input: AddRecordInput,
): AddRecordResult {
  try {
    const db = loadTomatodoDb(dbPath);
    const records = db.PCRecord ?? [];
    const marker = getTomatodoMarker(input.segmentId);

    // 去重：marker 已存在则跳过
    if (records.some((r) => (r.s1 ?? '').includes(marker))) {
      return { ok: true, skipped: true };
    }

    const recordId = nextRecordId(db);
    const partial = buildTomatodoRecord({
      segmentId: input.segmentId,
      subject: input.subject,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      activeElapsedMs: input.activeElapsedMs,
    });
    const record: TomatodoPCRecord = { id: recordId, ...partial };

    const backupPath = backupDb(dbPath);
    db.PCRecord = [...records, record];
    db.recordIdCounter = recordId;
    saveTomatodoDb(dbPath, db);

    logger.info('tomatodoAdapter', 'record added', {
      segmentId: input.segmentId,
      subject: input.subject,
      recordId,
      minutes: record.time,
      backupPath,
    });

    return { ok: true, skipped: false, record, recordId, backupPath: backupPath ?? undefined };
  } catch (err) {
    logger.error('tomatodoAdapter', 'addTomatodoRecord failed', err);
    return { ok: false, skipped: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 按 segmentId 删除番茄 Todo 中对应的 PCRecord（删除联动） */
export function deleteTomatodoRecordBySegmentId(
  dbPath: string,
  segmentId: string,
): DeleteResult {
  try {
    const db = loadTomatodoDb(dbPath);
    const records = db.PCRecord ?? [];
    const before = records.length;
    const remaining = records.filter((r) => {
      const sid = parseSegmentIdFromMarker(r.s1);
      return sid !== segmentId;
    });
    if (remaining.length === before) {
      return { ok: true, deletedCount: 0 };
    }
    const backupPath = backupDb(dbPath);
    db.PCRecord = remaining;
    saveTomatodoDb(dbPath, db);
    logger.info('tomatodoAdapter', 'record deleted', {
      segmentId,
      deletedCount: before - remaining.length,
      backupPath,
    });
    return { ok: true, deletedCount: before - remaining.length };
  } catch (err) {
    logger.error('tomatodoAdapter', 'deleteTomatodoRecordBySegmentId failed', err);
    return {
      ok: false,
      deletedCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 粗略检测番茄 Todo 桌面端是否在运行（写入后可能被覆盖，仅作提示） */
export function isTomatodoRunning(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq TomatoDo.exe', '/NH'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return out.includes('TomatoDo');
  } catch {
    return false;
  }
}

/**
 * 解析默认 tomatodo_db.json 路径。
 * 仅在主进程调用（依赖 electron app）；测试中应直接传 dbPath。
 */
export function resolveDefaultTomatodoDbPath(): string {
  // 动态 require，避免在 vitest（无 electron）中加载本模块时崩溃
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  return path.join(app.getPath('appData'), 'tomatodo', 'tomatodo_db.json');
}

/** 根据设置中的 dbPath（可能为空）解析最终路径 */
export function resolveTomatodoDbPath(configuredPath: string): string {
  if (configuredPath && configuredPath.trim()) return configuredPath.trim();
  return resolveDefaultTomatodoDbPath();
}
