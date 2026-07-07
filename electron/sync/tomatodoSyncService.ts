// 番茄 Todo 同步服务 - 独立并行同步通道
// 在专注结束后，将 FocusLink 的专注段按学科分类写入番茄 Todo 本地库
// 不侵入现有 syncService（dida 专用单目标队列），与之并行运行
//
// 数据流：FocusSegment → resolveSubject(title + projectId) → addTomatodoRecord
// 删除联动：删除本地 segment 时调用 deleteTomatodoRecordForSegment
import { findTaskCache, getSegment, listSegments } from '../db/index.js';
import { logger } from '../logger.js';
import {
  addTomatodoRecord,
  deleteTomatodoRecordBySegmentId,
  hasRecordForSegment,
  resolveTomatodoDbPath,
} from '../providers/tomatodoAdapter.js';
import { getSettings } from '../settingsStore.js';
import {
  normalizeSubject,
  resolveSubject,
  shouldSyncSegmentToTomatodo,
  type TomatodoSubject,
} from '../../shared/tomatodoPolicy.js';
import type { FocusSegment, TomatodoConfig } from '@shared/types';

export interface TomatodoSyncSegmentResult {
  segmentId: string;
  ok: boolean;
  /** true = marker 已存在，幂等跳过 */
  skipped: boolean;
  /** true = 本次新写入了一条 PCRecord */
  synced: boolean;
  subject: TomatodoSubject;
  minutes: number;
  recordId?: number;
  error?: string;
}

export interface TomatodoSyncSessionResult {
  sessionId: string;
  ok: boolean;
  /** 符合同步条件的段数（已结束且有专注时长） */
  total: number;
  /** 本次新写入 */
  synced: number;
  /** marker 已存在，跳过 */
  skipped: number;
  /** 不符合条件或失败 */
  failed: number;
  results: TomatodoSyncSegmentResult[];
  dbPath: string;
}

/** 读取番茄 Todo 设置；未启用时返回 null */
function getTomatodoConfig(): TomatodoConfig | null {
  const settings = getSettings();
  if (!settings.tomatodo?.enabled) return null;
  return settings.tomatodo;
}

/** 从设置解析学科推断参数；空映射则用默认表（传 undefined 让 policy 走默认） */
function resolveSubjectParams(config: TomatodoConfig) {
  return {
    subjectKeywords:
      config.subjectKeywords && Object.keys(config.subjectKeywords).length > 0
        ? config.subjectKeywords
        : undefined,
    projectSubjectMap:
      config.projectSubjectMap && Object.keys(config.projectSubjectMap).length > 0
        ? config.projectSubjectMap
        : undefined,
    fallbackSubject: normalizeSubject(config.defaultSubject || '杂'),
  };
}

/** 从 segment 推断番茄 Todo 学科 */
export function resolveSegmentSubject(segment: FocusSegment, config: TomatodoConfig): TomatodoSubject {
  // 滴答任务：尝试从任务缓存查 projectId，提升分类精度（项目覆盖标题）
  let projectId: string | null = null;
  if (segment.taskSource === 'ticktick' && segment.taskId) {
    try {
      const task = findTaskCache(segment.taskId, 'ticktick');
      projectId = task?.projectId ?? null;
    } catch (err) {
      logger.warn('tomatodoSync', 'findTaskCache failed, falling back to title-only', err);
    }
  }
  return resolveSubject({
    title: segment.title,
    projectId,
    ...resolveSubjectParams(config),
  });
}

/** 同步单个 segment 到番茄 Todo */
export function syncSegmentToTomatodo(segmentId: string): TomatodoSyncSegmentResult {
  const config = getTomatodoConfig();
  const empty: TomatodoSyncSegmentResult = {
    segmentId,
    ok: false,
    skipped: false,
    synced: false,
    subject: '杂',
    minutes: 0,
  };

  if (!config) {
    return { ...empty, ok: true, skipped: true, error: 'tomatodo_disabled' };
  }

  const segment = getSegment(segmentId);
  if (!segment) {
    return { ...empty, error: 'segment_not_found' };
  }
  if (!shouldSyncSegmentToTomatodo(segment)) {
    return { ...empty, ok: true, skipped: true, error: 'segment_not_ended_or_no_elapsed' };
  }

  const subject = resolveSegmentSubject(segment, config);
  const dbPath = resolveTomatodoDbPath(config.dbPath);

  // marker 去重：已写入则幂等跳过
  if (hasRecordForSegment(dbPath, segmentId)) {
    return {
      ...empty,
      ok: true,
      skipped: true,
      synced: false,
      subject,
      minutes: roundMinutes(segment.activeElapsedMs),
    };
  }

  const result = addTomatodoRecord(dbPath, {
    segmentId,
    subject,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt as number,
    activeElapsedMs: segment.activeElapsedMs,
  });

  return {
    segmentId,
    ok: result.ok,
    skipped: result.skipped,
    synced: result.ok && !result.skipped,
    subject,
    minutes: roundMinutes(segment.activeElapsedMs),
    recordId: result.recordId,
    error: result.error,
  };
}

/** 同步整个会话的所有符合条件 segment 到番茄 Todo */
export function syncSessionToTomatodo(sessionId: string): TomatodoSyncSessionResult {
  const config = getTomatodoConfig();
  const segments = listSegments(sessionId);

  if (!config) {
    return {
      sessionId,
      ok: true,
      total: 0,
      synced: 0,
      skipped: segments.length,
      failed: 0,
      results: [],
      dbPath: '',
    };
  }

  const dbPath = resolveTomatodoDbPath(config.dbPath);
  const eligible = segments.filter((s) => shouldSyncSegmentToTomatodo(s));
  const results = eligible.map((s) => syncSegmentToTomatodo(s.id));

  const synced = results.filter((r) => r.synced).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;

  logger.info('tomatodoSync', 'session synced', {
    sessionId,
    total: eligible.length,
    synced,
    skipped,
    failed,
    dbPath,
  });

  return {
    sessionId,
    ok: failed === 0,
    total: eligible.length,
    synced,
    skipped,
    failed,
    results,
    dbPath,
  };
}

/** 删除番茄 Todo 中某 segment 对应的记录（删除联动） */
export function deleteTomatodoRecordForSegment(segmentId: string): {
  ok: boolean;
  deletedCount: number;
} {
  const config = getTomatodoConfig();
  if (!config) {
    return { ok: true, deletedCount: 0 };
  }
  const dbPath = resolveTomatodoDbPath(config.dbPath);
  const result = deleteTomatodoRecordBySegmentId(dbPath, segmentId);
  return { ok: result.ok, deletedCount: result.deletedCount };
}

/** 查询某会话各 segment 的番茄 Todo 同步状态（供 UI 展示） */
export function getTomatodoSyncStatus(sessionId: string): {
  enabled: boolean;
  dbPath: string;
  segments: Array<{ segmentId: string; synced: boolean; subject: TomatodoSubject }>;
} {
  const config = getTomatodoConfig();
  if (!config) {
    return { enabled: false, dbPath: '', segments: [] };
  }
  const dbPath = resolveTomatodoDbPath(config.dbPath);
  const segments = listSegments(sessionId);
  return {
    enabled: true,
    dbPath,
    segments: segments.map((s) => ({
      segmentId: s.id,
      synced: hasRecordForSegment(dbPath, s.id),
      subject: resolveSegmentSubject(s, config),
    })),
  };
}

function roundMinutes(ms: number): number {
  return Math.max(0.1, Math.round((ms / 60000) * 10000) / 10000);
}
