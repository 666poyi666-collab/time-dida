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
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

import { logger } from '../../logger.js';
import {
  buildTomatodoRecord,
  collectSyncedSegmentIds,
  getTomatodoMarker,
  parseSegmentIdFromMarker,
  TOMATODO_CLOUD_V053_MARKER,
  type TomatodoPCRecord,
} from '../../../shared/tomatodoPolicy.js';
import type { TomatodoSubject } from '@shared/types';

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

/** 将一个已写入 PCRecord 的学科名改为新的分类。 */
export interface UpdateTomatodoRecordSubjectInput {
  segmentId: string;
  subject: TomatodoSubject;
}

export interface UpdateTomatodoRecordSubjectsResult {
  ok: boolean;
  /** 找到 marker 的 FocusLink segment。不存在时不写文件。 */
  foundSegmentIds: string[];
  /** 实际修改的 PCRecord 数（异常重复 marker 也会一并修正）。 */
  updatedCount: number;
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
const WINDOWS_REPLACE_RETRY_DELAYS_MS = [4, 8, 16, 32, 64] as const;
const RETRYABLE_REPLACE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

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
  const dir = path.dirname(dbPath);
  const stem = `tomatodo_db.backup_${nowBeijingStamp()}`;
  let backup = path.join(dir, `${stem}.json`);
  let suffix = 1;
  // 同一秒内可能同步多个 segment；保留每次写入前的备份而不是覆盖前一份。
  while (fs.existsSync(backup)) {
    backup = path.join(dir, `${stem}_${suffix}.json`);
    suffix += 1;
  }
  try {
    fs.copyFileSync(dbPath, backup);
    return backup;
  } catch (err) {
    logger.warn('tomatodoAdapter', 'backup failed', err);
    return null;
  }
}

function waitForFileUnlock(delayMs: number): void {
  // Atomics.wait gives the synchronous adapter a bounded sleep without a busy loop.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function replaceFileWithRetry(tmp: string, dbPath: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tmp, dbPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const delay = WINDOWS_REPLACE_RETRY_DELAYS_MS[attempt];
      if (!delay || !code || !RETRYABLE_REPLACE_CODES.has(code)) throw error;
      logger.warn('tomatodoAdapter', 'atomic replace temporarily blocked, retrying', {
        code,
        attempt: attempt + 1,
        delayMs: delay,
      });
      waitForFileUnlock(delay);
    }
  }
}

/**
 * 原子写：同目录临时文件 fsync 后 rename 覆盖目标。
 * Windows 上杀毒软件或番茄 Todo 可能短暂锁住目标文件，因此仅对锁冲突做有界重试；
 * 持续失败时仍保留旧文件，绝不回退成直接覆写。
 */
function saveTomatodoDb(dbPath: string, db: TomatodoDb): void {
  const text = JSON.stringify(db, null, 2);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(dbPath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(tmp, 'wx');
    try {
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    replaceFileWithRetry(tmp, dbPath);
  } finally {
    // rename 成功后临时路径已不存在；失败时清理残留，且绝不触碰旧 db 文件。
    if (fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch (error) {
        logger.warn('tomatodoAdapter', 'temporary file cleanup failed', error);
      }
    }
  }
}

export interface TomatodoRecordState {
  exists: boolean;
  recordId?: number;
  /** 只有番茄 Todo 云接口确认上传后才会是 true。 */
  cloudSynced: boolean;
}

export interface MigrateLegacyRecordsResult {
  ok: boolean;
  updatedCount: number;
  backupPath?: string;
  error?: string;
}

export interface MigrateLegacyRecordsOptions {
  /** 可注入以让测试不依赖开发机当前是否启动了番茄 Todo。 */
  isAppRunning?: () => boolean;
}

/** 取 recordIdCounter+1，并保证不与现有 PCRecord.id 冲突 */
export function nextRecordId(db: {
  recordIdCounter?: number;
  PCRecord?: ReadonlyArray<{ id: number }>;
}): number {
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
export function addTomatodoRecord(dbPath: string, input: AddRecordInput): AddRecordResult {
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

/** 返回 marker 对应记录的本地/云端状态，避免把“已写入 JSON”误报为“已上云”。 */
export function getTomatodoRecordState(dbPath: string, segmentId: string): TomatodoRecordState {
  try {
    const db = loadTomatodoDb(dbPath);
    const marker = getTomatodoMarker(segmentId);
    const record = (db.PCRecord ?? []).find((item) => (item.s1 ?? '').includes(marker));
    if (!record) return { exists: false, cloudSynced: false };
    return {
      exists: true,
      recordId: typeof record.id === 'number' ? record.id : undefined,
      cloudSynced: Number(record.isSynced) === 1,
    };
  } catch {
    return { exists: false, cloudSynced: false };
  }
}

export interface PendingTomatodoRecord {
  recordId: number;
  segmentId: string;
  name: string;
  time: number;
  startDate: number;
  isSynced: number;
}

/** 列出所有带 FocusLink marker 且未上云（isSynced=0）的 PCRecord。 */
export function listPendingTomatodoRecords(dbPath: string): PendingTomatodoRecord[] {
  try {
    const db = loadTomatodoDb(dbPath);
    return (db.PCRecord ?? [])
      .filter((r) => {
        if (Number(r.isSynced) === 1) return false;
        return parseSegmentIdFromMarker(r.s1) !== null;
      })
      .map((r) => ({
        recordId: r.id,
        segmentId: parseSegmentIdFromMarker(r.s1)!,
        name: r.name,
        time: r.time,
        startDate: r.startDate,
        isSynced: Number(r.isSynced),
      }));
  } catch {
    return [];
  }
}

/** 统计待上云的 FocusLink 记录数。 */
export function countPendingTomatodoRecords(dbPath: string): number {
  return listPendingTomatodoRecords(dbPath).length;
}

/**
 * 就地更新已同步 PCRecord 的 name 字段，不删除 marker、不改 record id 或其他番茄 Todo 元数据。
 * 这让用户在 FocusLink 中手动改学科后可以同步反映到番茄 Todo，而不会被 marker 幂等逻辑跳过。
 */
export function updateTomatodoRecordSubjects(
  dbPath: string,
  updates: readonly UpdateTomatodoRecordSubjectInput[],
): UpdateTomatodoRecordSubjectsResult {
  try {
    const subjectBySegmentId = new Map<string, TomatodoSubject>();
    for (const update of updates) {
      if (update.segmentId) subjectBySegmentId.set(update.segmentId, update.subject);
    }
    if (subjectBySegmentId.size === 0) {
      return { ok: true, foundSegmentIds: [], updatedCount: 0 };
    }

    const db = loadTomatodoDb(dbPath);
    const records = db.PCRecord ?? [];
    const foundSegmentIds = new Set<string>();
    let updatedCount = 0;
    const nextRecords = records.map((record) => {
      const segmentId = parseSegmentIdFromMarker(record.s1);
      const subject = segmentId ? subjectBySegmentId.get(segmentId) : undefined;
      if (!segmentId || !subject) return record;
      foundSegmentIds.add(segmentId);
      // 同一分类是严格幂等操作：尤其不能把已经由云端确认的 isSynced=1
      // 重新打回待上传。只有分类真实变化时才需要重新进入云同步队列。
      if (record.name === subject) return record;
      updatedCount += 1;
      // 分类变化也必须重新进入番茄 Todo 的云同步队列。
      return { ...record, name: subject, isSynced: 0 };
    });

    // 未写入过的 segment 只保留 FocusLink 本地的手动选择，不创建空 PCRecord。
    if (foundSegmentIds.size === 0 || updatedCount === 0) {
      return {
        ok: true,
        foundSegmentIds: [...foundSegmentIds],
        updatedCount: 0,
      };
    }

    const backupPath = backupDb(dbPath);
    db.PCRecord = nextRecords;
    saveTomatodoDb(dbPath, db);
    logger.info('tomatodoAdapter', 'record subjects updated', {
      segmentIds: [...foundSegmentIds],
      updatedCount,
      backupPath,
    });
    return {
      ok: true,
      foundSegmentIds: [...foundSegmentIds],
      updatedCount,
      backupPath: backupPath ?? undefined,
    };
  } catch (err) {
    logger.error('tomatodoAdapter', 'updateTomatodoRecordSubjects failed', err);
    return {
      ok: false,
      foundSegmentIds: [],
      updatedCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 更新单个已同步 segment 的番茄 Todo 学科名。 */
export function updateTomatodoRecordSubjectBySegmentId(
  dbPath: string,
  segmentId: string,
  subject: TomatodoSubject,
): UpdateTomatodoRecordSubjectsResult {
  return updateTomatodoRecordSubjects(dbPath, [{ segmentId, subject }]);
}

/** 按 segmentId 删除番茄 Todo 中对应的 PCRecord（删除联动） */
export function deleteTomatodoRecordBySegmentId(dbPath: string, segmentId: string): DeleteResult {
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

/**
 * 一次性修复旧版 FocusLink 写入的记录：旧版把未上传记录错误标成 isSynced=1，
 * 并把旧“杂”兜底迁移为“学习”。只处理带稳定 marker 且尚未带新版迁移标记的记录，
 * 防止便携版、全新配置或冒烟测试再次把已经真实上云的记录重置为待同步。
 */
export function migrateLegacyTomatodoRecords(
  dbPath: string,
  options: MigrateLegacyRecordsOptions = {},
): MigrateLegacyRecordsResult {
  try {
    if ((options.isAppRunning ?? isTomatodoRunning)()) {
      return {
        ok: false,
        updatedCount: 0,
        error: 'tomatodo_running_migration_deferred',
      };
    }
    if (!fs.existsSync(dbPath)) return { ok: true, updatedCount: 0 };
    const db = loadTomatodoDb(dbPath);
    let updatedCount = 0;
    const next = (db.PCRecord ?? []).map((record) => {
      if (!parseSegmentIdFromMarker(record.s1)) return record;
      const name = record.name === '杂' ? '学习' : record.name;
      const alreadyMigrated = String(record.s9 ?? '').includes(TOMATODO_CLOUD_V053_MARKER);
      if (alreadyMigrated && name === record.name) return record;
      updatedCount += 1;
      if (alreadyMigrated) return { ...record, name, isSynced: 0 };
      const s9 = [String(record.s9 ?? '').trim(), TOMATODO_CLOUD_V053_MARKER]
        .filter(Boolean)
        .join('\n');
      return { ...record, name, isSynced: 0, s9 };
    });
    if (updatedCount === 0) return { ok: true, updatedCount: 0 };
    const backupPath = backupDb(dbPath);
    // 迁移会批量改动旧记录；无法留下恢复点时宁可延期，也不冒险改用户数据。
    if (!backupPath) {
      return {
        ok: false,
        updatedCount: 0,
        error: 'tomatodo_migration_backup_failed',
      };
    }
    db.PCRecord = next;
    saveTomatodoDb(dbPath, db);
    logger.info('tomatodoAdapter', 'legacy FocusLink records reset for real cloud sync', {
      updatedCount,
      backupPath,
    });
    return { ok: true, updatedCount, backupPath };
  } catch (err) {
    return {
      ok: false,
      updatedCount: 0,
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
    return /tomatodo\.exe/i.test(out);
  } catch {
    return false;
  }
}

/** 非阻塞进程探测，供同步/后台轮询使用，避免 tasklist 最慢 5 秒卡住 Electron 主线程。 */
export function isTomatodoRunningAsync(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', 'IMAGENAME eq TomatoDo.exe', '/NH'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
      (error, stdout) => resolve(!error && /tomatodo\.exe/i.test(stdout)),
    );
  });
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
