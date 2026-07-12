// 番茄 Todo 同步服务 - 独立并行同步通道
// 在专注结束后，将 FocusLink 的专注段按「手动 > 自动关键词 > 兜底」学科写入番茄 Todo 本地库
// 不侵入现有 syncService（dida 专用单目标队列），与之并行运行
//
// 数据流：FocusSegment → resolveSegmentSubject(手动 || 标题/任务文本自动匹配 || 兜底) → addTomatodoRecord
// 删除联动：删除本地 segment 时调用 deleteTomatodoRecordForSegment
import {
  findTaskCache,
  getSegment,
  getSetting,
  listSegments,
  setSetting,
  setSegmentTomatodoSubject,
  setSegmentsTomatodoSubject,
} from '../db/index.js';
import { logger } from '../logger.js';
import {
  addTomatodoRecord,
  deleteTomatodoRecordBySegmentId,
  getTomatodoRecordState,
  isTomatodoRunningAsync,
  listPendingTomatodoRecords,
  resolveTomatodoDbPath,
  updateTomatodoRecordSubjects,
} from '../integrations/tomatodo/localDb.js';
import {
  deleteTomatodoRecordThroughBridge,
  updateTomatodoSubjectThroughBridge,
  writeTomatodoRecordsThroughBridge,
  writeTomatodoRecordThroughBridge,
} from '../integrations/tomatodo/cloudBridge.js';
import { getSettings } from '../settingsStore.js';
import {
  buildTomatodoRecord,
  inferTomatodoSubject,
  isTomatodoSubject,
  resolveSegmentSubject,
  shouldSyncSegmentToTomatodo,
} from '../../shared/tomatodoPolicy.js';
import type { FocusSegment, TomatodoConfig, TomatodoSubject } from '@shared/types';

export interface TomatodoSyncSegmentResult {
  segmentId: string;
  ok: boolean;
  /** true = marker 已存在，幂等跳过 */
  skipped: boolean;
  /** true = 本次新写入了一条 PCRecord */
  synced: boolean;
  /** 已经存在于番茄 Todo 本地库。 */
  localWritten: boolean;
  /** 番茄 Todo 云接口已确认上传。 */
  cloudSynced: boolean;
  syncState: 'skipped' | 'local-pending' | 'cloud-pending' | 'cloud-synced' | 'failed';
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

const TOMATODO_DURABLE_QUEUE_KEY = 'tomatodo.pendingSegmentIdsV060';
let tomatodoOperationTail: Promise<void> = Promise.resolve();

function withTomatodoOperationLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = tomatodoOperationTail.then(operation, operation);
  tomatodoOperationTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readDurablePendingSegmentIds(): string[] {
  try {
    const raw = getSetting(TOMATODO_DURABLE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(parsed.filter((value): value is string => typeof value === 'string' && !!value)),
    ];
  } catch {
    return [];
  }
}

function writeDurablePendingSegmentIds(segmentIds: readonly string[]): void {
  setSetting(TOMATODO_DURABLE_QUEUE_KEY, JSON.stringify([...new Set(segmentIds.filter(Boolean))]));
}

function enqueueDurableTomatodoSegments(segmentIds: readonly string[]): void {
  if (segmentIds.length === 0) return;
  writeDurablePendingSegmentIds([...readDurablePendingSegmentIds(), ...segmentIds]);
}

function completeDurableTomatodoSegments(segmentIds: readonly string[]): void {
  if (segmentIds.length === 0) return;
  const completed = new Set(segmentIds);
  writeDurablePendingSegmentIds(
    readDurablePendingSegmentIds().filter((segmentId) => !completed.has(segmentId)),
  );
}

/** 读取番茄 Todo 设置；未启用时返回 null */
function getTomatodoConfig(): TomatodoConfig | null {
  const settings = getSettings();
  if (!settings.tomatodo?.enabled) return null;
  return settings.tomatodo;
}

/**
 * 构造自动匹配候选文本。FocusSegment.title 是最可靠的任务快照；任务缓存存在时再补充
 * 最新标题、正文和标签，以兼容“任务标题/任务内容”里写学科的工作流。
 */
function getSubjectCandidateTexts(segment: FocusSegment): Array<string | null | undefined> {
  // segment.title 已由 resolveSegmentSubject 作为第一个候选处理；这里补充缓存任务文本。
  const candidates: Array<string | null | undefined> = [];
  if (!segment.taskId) return candidates;
  try {
    const task = findTaskCache(segment.taskId, segment.taskSource ?? undefined);
    if (task) {
      candidates.push(task.title, task.content, task.tags);
    }
  } catch (err) {
    // 自动分类不能因缓存读取失败阻断专注记录同步；仍可退回 segment.title / 默认分类。
    logger.warn('tomatodoSync', 'failed to load task text for subject matching', {
      segmentId: segment.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return candidates;
}

type TomatodoSubjectSource = 'manual' | 'auto' | 'fallback';

function getSubjectResolutionForSegment(
  segment: FocusSegment,
  config: TomatodoConfig,
): { subject: TomatodoSubject; source: TomatodoSubjectSource } {
  if ((segment.tomatodoSubject as string | null) === '杂') {
    return { subject: '学习', source: 'manual' };
  }
  if (segment.tomatodoSubject && isTomatodoSubject(segment.tomatodoSubject)) {
    return { subject: segment.tomatodoSubject, source: 'manual' };
  }
  const inferred = inferTomatodoSubject(segment.title, ...getSubjectCandidateTexts(segment));
  if (inferred) return { subject: inferred, source: 'auto' };
  return {
    subject: resolveSegmentSubject(segment, config.defaultSubject),
    source: 'fallback',
  };
}

function resolveSubjectForSegment(segment: FocusSegment, config: TomatodoConfig): TomatodoSubject {
  return getSubjectResolutionForSegment(segment, config).subject;
}

interface ExistingRecordUpdateResult {
  ok: boolean;
  foundCount: number;
  updatedCount: number;
  error?: string;
}

/**
 * 只更新已存在 marker 的 PCRecord；不会因为用户改单个学科而创建新的番茄 Todo 记录。
 */
function updateExistingTomatodoRecords(
  segments: readonly FocusSegment[],
  config: TomatodoConfig | null,
): ExistingRecordUpdateResult {
  if (!config || segments.length === 0) {
    return { ok: true, foundCount: 0, updatedCount: 0 };
  }
  const dbPath = resolveTomatodoDbPath(config.dbPath);
  const result = updateTomatodoRecordSubjects(
    dbPath,
    segments.map((segment) => ({
      segmentId: segment.id,
      subject: resolveSubjectForSegment(segment, config),
    })),
  );
  return {
    ok: result.ok,
    foundCount: result.foundSegmentIds.length,
    updatedCount: result.updatedCount,
    error: result.error,
  };
}

/** 同步单个 segment 到番茄 Todo；调用方必须持有服务级操作锁。 */
async function syncSegmentToTomatodoUnlocked(
  segmentId: string,
): Promise<TomatodoSyncSegmentResult> {
  const config = getTomatodoConfig();
  const empty: TomatodoSyncSegmentResult = {
    segmentId,
    ok: false,
    skipped: false,
    synced: false,
    subject: '学习',
    minutes: 0,
    localWritten: false,
    cloudSynced: false,
    syncState: 'failed',
  };

  if (!config) {
    return {
      ...empty,
      ok: true,
      skipped: true,
      syncState: 'skipped',
      error: 'tomatodo_disabled',
    };
  }

  const segment = getSegment(segmentId);
  if (!segment) {
    return { ...empty, error: 'segment_not_found' };
  }
  if (!shouldSyncSegmentToTomatodo(segment)) {
    return {
      ...empty,
      ok: true,
      skipped: true,
      syncState: 'skipped',
      error: 'segment_not_ended_or_no_elapsed',
    };
  }

  // 在任何外部调用前先持久化意图。即使客户端正在运行但桥不可用，重启后仍可补传。
  enqueueDurableTomatodoSegments([segmentId]);

  const subject = resolveSubjectForSegment(segment, config);
  const dbPath = resolveTomatodoDbPath(config.dbPath);

  const record = buildTomatodoRecord({
    segmentId,
    subject,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt as number,
    activeElapsedMs: segment.activeElapsedMs,
  });

  // 番茄 Todo 正在运行时只能走它自己的 addRecord/cloudSync API；直接改 JSON 会被回写覆盖。
  if (await isTomatodoRunningAsync()) {
    const bridge = await writeTomatodoRecordThroughBridge(record);
    if (!bridge.available) {
      return {
        ...empty,
        subject,
        minutes: roundMinutes(segment.activeElapsedMs),
        error:
          '番茄 Todo 正在运行，但本地同步桥不可用；请关闭番茄 Todo 后重试，或以云同步桥模式启动。',
      };
    }
    if (bridge.cloudSynced) completeDurableTomatodoSegments([segmentId]);
    return {
      ...empty,
      ok: bridge.ok,
      skipped: bridge.skipped,
      synced: bridge.localWritten && !bridge.skipped,
      localWritten: bridge.localWritten,
      cloudSynced: bridge.cloudSynced,
      syncState: bridge.ok ? (bridge.cloudSynced ? 'cloud-synced' : 'cloud-pending') : 'failed',
      subject,
      minutes: roundMinutes(segment.activeElapsedMs),
      recordId: bridge.recordId,
      error: bridge.error ?? bridge.cloudError,
    };
  }

  // 番茄 Todo 未运行时安全写入本地库，并保持 isSynced=0，待它下次启动后上传。
  const existing = getTomatodoRecordState(dbPath, segmentId);
  if (existing.exists) {
    const update = updateTomatodoRecordSubjects(dbPath, [{ segmentId, subject }]);
    const state = getTomatodoRecordState(dbPath, segmentId);
    if (state.cloudSynced) completeDurableTomatodoSegments([segmentId]);
    return {
      ...empty,
      ok: update.ok,
      skipped: update.ok,
      localWritten: true,
      cloudSynced: state.cloudSynced,
      syncState: state.cloudSynced ? 'cloud-synced' : 'local-pending',
      subject,
      minutes: roundMinutes(segment.activeElapsedMs),
      recordId: state.recordId,
      error: update.error,
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
    localWritten: result.ok,
    cloudSynced: false,
    syncState: result.ok ? 'local-pending' : 'failed',
    subject,
    minutes: roundMinutes(segment.activeElapsedMs),
    recordId: result.recordId,
    error: result.error,
  };
}

export function syncSegmentToTomatodo(segmentId: string): Promise<TomatodoSyncSegmentResult> {
  return withTomatodoOperationLock(() => syncSegmentToTomatodoUnlocked(segmentId));
}

/** 同步整个会话的所有符合条件 segment 到番茄 Todo */
async function syncSessionToTomatodoUnlocked(
  sessionId: string,
): Promise<TomatodoSyncSessionResult> {
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
  enqueueDurableTomatodoSegments(eligible.map((segment) => segment.id));
  let results: TomatodoSyncSegmentResult[];
  if (await isTomatodoRunningAsync()) {
    const bridge = await writeTomatodoRecordsThroughBridge(
      eligible.map((segment) =>
        buildTomatodoRecord({
          segmentId: segment.id,
          subject: resolveSubjectForSegment(segment, config),
          startedAt: segment.startedAt,
          endedAt: segment.endedAt as number,
          activeElapsedMs: segment.activeElapsedMs,
        }),
      ),
    );
    results = eligible.map((segment, index) => {
      const subject = resolveSubjectForSegment(segment, config);
      const item = bridge.results[index];
      if (!bridge.available || !item) {
        return {
          segmentId: segment.id,
          ok: false,
          skipped: false,
          synced: false,
          localWritten: false,
          cloudSynced: false,
          syncState: 'failed',
          subject,
          minutes: roundMinutes(segment.activeElapsedMs),
          error:
            bridge.error ??
            '番茄 Todo 正在运行，但批量同步桥不可用；本地记录保持不变，请稍后重试。',
        };
      }
      return {
        segmentId: segment.id,
        ok: item.ok,
        skipped: item.skipped,
        synced: item.localWritten && !item.skipped,
        localWritten: item.localWritten,
        cloudSynced: item.cloudSynced,
        syncState: item.ok ? (item.cloudSynced ? 'cloud-synced' : 'cloud-pending') : 'failed',
        subject,
        minutes: roundMinutes(segment.activeElapsedMs),
        recordId: item.recordId,
        error: item.error ?? item.cloudError,
      };
    });
    completeDurableTomatodoSegments(
      results.filter((result) => result.cloudSynced).map((result) => result.segmentId),
    );
  } else {
    // 客户端关闭时只能安全写本地；逐条原子写入并保持 isSynced=0。
    results = [];
    for (const segment of eligible) {
      results.push(await syncSegmentToTomatodoUnlocked(segment.id));
    }
  }

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

export function syncSessionToTomatodo(sessionId: string): Promise<TomatodoSyncSessionResult> {
  return withTomatodoOperationLock(() => syncSessionToTomatodoUnlocked(sessionId));
}

export interface TomatodoSubjectSetResult {
  /** false 只表示外部记录更新失败或 segment 不存在；本地手动选择仍会保留。 */
  ok: boolean;
  updatedCount: number;
  externalFoundCount: number;
  externalUpdatedCount: number;
  error?: string;
}

function parseManualSubject(subject: string | null): TomatodoSubject | null {
  if (subject === null) return null;
  if (subject === '杂') return '学习';
  if (!isTomatodoSubject(subject)) {
    throw new Error('无效的番茄 Todo 学科分类');
  }
  return subject;
}

/**
 * 保存单个 segment 的手动分类；若已同步 PCRecord 存在则同步更新其 name，
 * 若功能禁用或尚未写入记录则只保存本地选择。
 */
async function setTomatodoSubjectForSegmentUnlocked(
  segmentId: string,
  subject: string | null,
): Promise<TomatodoSubjectSetResult> {
  try {
    const manualSubject = parseManualSubject(subject);
    const existing = getSegment(segmentId);
    if (!existing) {
      return {
        ok: false,
        updatedCount: 0,
        externalFoundCount: 0,
        externalUpdatedCount: 0,
        error: 'segment_not_found',
      };
    }

    setSegmentTomatodoSubject(segmentId, manualSubject);
    const updated = getSegment(segmentId);
    if (!updated) {
      return {
        ok: false,
        updatedCount: 0,
        externalFoundCount: 0,
        externalUpdatedCount: 0,
        error: 'segment_not_found_after_update',
      };
    }

    const config = getTomatodoConfig();
    let external: ExistingRecordUpdateResult;
    if (config && (await isTomatodoRunningAsync())) {
      const bridge = await updateTomatodoSubjectThroughBridge(
        segmentId,
        resolveSubjectForSegment(updated, config),
      );
      external = {
        ok: bridge.available && bridge.ok,
        foundCount: bridge.recordFound ? 1 : 0,
        updatedCount: bridge.localChanged ? 1 : 0,
        error: bridge.error ?? bridge.cloudError,
      };
    } else {
      external = updateExistingTomatodoRecords([updated], config);
    }
    if (!external.ok) {
      logger.warn(
        'tomatodoSync',
        'manual subject saved locally but external record update failed',
        {
          segmentId,
          error: external.error,
        },
      );
    }
    return {
      ok: external.ok,
      updatedCount: 1,
      externalFoundCount: external.foundCount,
      externalUpdatedCount: external.updatedCount,
      error: external.error,
    };
  } catch (err) {
    return {
      ok: false,
      updatedCount: 0,
      externalFoundCount: 0,
      externalUpdatedCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function setTomatodoSubjectForSegment(
  segmentId: string,
  subject: string | null,
): Promise<TomatodoSubjectSetResult> {
  return withTomatodoOperationLock(() => setTomatodoSubjectForSegmentUnlocked(segmentId, subject));
}

/** 批量保存手动分类，并用一次番茄 Todo JSON 写入更新所有已同步 marker。 */
async function setTomatodoSubjectsForSegmentsUnlocked(
  segmentIds: string[],
  subject: string | null,
): Promise<TomatodoSubjectSetResult> {
  try {
    const manualSubject = parseManualSubject(subject);
    const uniqueIds = [...new Set(segmentIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return { ok: true, updatedCount: 0, externalFoundCount: 0, externalUpdatedCount: 0 };
    }

    const updatedCount = setSegmentsTomatodoSubject(uniqueIds, manualSubject);
    const updatedSegments = uniqueIds
      .map((segmentId) => getSegment(segmentId))
      .filter((segment): segment is FocusSegment => segment !== null);
    const config = getTomatodoConfig();
    let external: ExistingRecordUpdateResult;
    if (config && (await isTomatodoRunningAsync())) {
      let foundCount = 0;
      let externalUpdatedCount = 0;
      let error: string | undefined;
      for (const segment of updatedSegments) {
        const bridge = await updateTomatodoSubjectThroughBridge(
          segment.id,
          resolveSubjectForSegment(segment, config),
        );
        if (bridge.recordFound) foundCount += 1;
        if (bridge.localChanged) externalUpdatedCount += 1;
        if (!bridge.available || !bridge.ok) error ??= bridge.error ?? bridge.cloudError;
      }
      external = {
        ok: !error,
        foundCount,
        updatedCount: externalUpdatedCount,
        error,
      };
    } else {
      external = updateExistingTomatodoRecords(updatedSegments, config);
    }
    if (!external.ok) {
      logger.warn('tomatodoSync', 'manual subject batch saved locally but external update failed', {
        segmentIds: uniqueIds,
        error: external.error,
      });
    }
    return {
      ok: external.ok,
      updatedCount,
      externalFoundCount: external.foundCount,
      externalUpdatedCount: external.updatedCount,
      error: external.error,
    };
  } catch (err) {
    return {
      ok: false,
      updatedCount: 0,
      externalFoundCount: 0,
      externalUpdatedCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function setTomatodoSubjectsForSegments(
  segmentIds: string[],
  subject: string | null,
): Promise<TomatodoSubjectSetResult> {
  return withTomatodoOperationLock(() =>
    setTomatodoSubjectsForSegmentsUnlocked(segmentIds, subject),
  );
}

/** 删除番茄 Todo 中某 segment 对应的记录（删除联动） */
export function deleteTomatodoRecordForSegment(segmentId: string): Promise<{
  ok: boolean;
  deletedCount: number;
}> {
  return withTomatodoOperationLock(async () => {
    // 即使用户刚关闭同步，也要清理此前已写入的 marker，避免本地记录删除后番茄 Todo 留下孤儿记录。
    // “关闭”只禁止新增/更新，不应阻断删除联动。
    const config = getSettings().tomatodo;
    const dbPath = resolveTomatodoDbPath(config.dbPath);
    if (await isTomatodoRunningAsync()) {
      const bridge = await deleteTomatodoRecordThroughBridge(segmentId);
      if (bridge.available) {
        if (bridge.ok) completeDurableTomatodoSegments([segmentId]);
        return { ok: bridge.ok, deletedCount: bridge.deletedCount };
      }
      return { ok: false, deletedCount: 0 };
    }
    const result = deleteTomatodoRecordBySegmentId(dbPath, segmentId);
    if (result.ok) completeDurableTomatodoSegments([segmentId]);
    return { ok: result.ok, deletedCount: result.deletedCount };
  });
}

/** 查询某会话各 segment 的番茄 Todo 同步状态（供 UI 展示） */
export function getTomatodoSyncStatus(sessionId: string): {
  enabled: boolean;
  dbPath: string;
  segments: Array<{
    segmentId: string;
    /** 兼容旧渲染层；现在只在番茄 Todo 云端已确认时为 true。 */
    synced: boolean;
    writtenLocally: boolean;
    cloudSynced: boolean;
    state: 'not-written' | 'local-pending' | 'cloud-synced';
    subject: TomatodoSubject;
    source: TomatodoSubjectSource;
  }>;
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
    segments: segments.map((s) => {
      const resolution = getSubjectResolutionForSegment(s, config);
      const recordState = getTomatodoRecordState(dbPath, s.id);
      return {
        segmentId: s.id,
        synced: recordState.cloudSynced,
        writtenLocally: recordState.exists,
        cloudSynced: recordState.cloudSynced,
        state: recordState.cloudSynced
          ? ('cloud-synced' as const)
          : recordState.exists
            ? ('local-pending' as const)
            : ('not-written' as const),
        subject: resolution.subject,
        source: resolution.source,
      };
    }),
  };
}

function roundMinutes(ms: number): number {
  return Math.max(0.1, Math.round((ms / 60000) * 10000) / 10000);
}

export interface PendingUploadResult {
  ok: boolean;
  total: number;
  uploaded: number;
  failed: number;
  error?: string;
}

const TOMATODO_CLOUD_CONFIRMATION_GRACE_MS = 2000;
const TOMATODO_CLOUD_CONFIRMATION_POLL_MS = 100;

/**
 * TomaToDo may finish its own automatic upload just after the bridge call returns a transient
 * failure. Give the external source of truth a short grace window so a manual click does not show
 * “still pending” while the JSON has already been confirmed as isSynced=1.
 */
async function reconcileTomatodoCloudConfirmation(
  dbPath: string,
  segmentIds: readonly string[],
  initiallyConfirmed: readonly string[],
): Promise<string[]> {
  const confirmed = new Set(initiallyConfirmed);
  if (confirmed.size >= segmentIds.length) return [...confirmed];
  const deadline = Date.now() + TOMATODO_CLOUD_CONFIRMATION_GRACE_MS;
  while (true) {
    for (const segmentId of segmentIds) {
      if (confirmed.has(segmentId)) continue;
      try {
        if (getTomatodoRecordState(dbPath, segmentId).cloudSynced) confirmed.add(segmentId);
      } catch {
        // Atomic replacement can make a single read race with TomaToDo; retry inside the grace.
      }
    }
    if (confirmed.size >= segmentIds.length || Date.now() >= deadline) return [...confirmed];
    await new Promise((resolve) => setTimeout(resolve, TOMATODO_CLOUD_CONFIRMATION_POLL_MS));
  }
}

/**
 * 上传番茄 Todo 本地库中所有待同步（isSynced=0）的 FocusLink 记录到云端。
 * 仅在番茄 Todo 桌面端运行时有效（需要 CDP 桥）。
 * 番茄 Todo 未运行时返回当前待同步数量但不尝试上传。
 */
async function uploadPendingTomatodoRecordsUnlocked(): Promise<PendingUploadResult> {
  const config = getTomatodoConfig();
  if (!config) {
    return { ok: true, total: 0, uploaded: 0, failed: 0 };
  }
  const dbPath = resolveTomatodoDbPath(config.dbPath);
  const pendingBySegmentId = new Map(
    listPendingTomatodoRecords(dbPath).map((record) => [record.segmentId, record]),
  );
  const durableIds = readDurablePendingSegmentIds();
  const inputs: Array<{
    segmentId: string;
    record: ReturnType<typeof buildTomatodoRecord>;
  }> = [];
  for (const record of pendingBySegmentId.values()) {
    inputs.push({
      segmentId: record.segmentId,
      record: buildTomatodoRecord({
        segmentId: record.segmentId,
        subject: isTomatodoSubject(record.name) ? record.name : config.defaultSubject,
        startedAt: record.startDate,
        endedAt: record.startDate + Math.round(record.time * 60000),
        activeElapsedMs: Math.round(record.time * 60000),
      }),
    });
  }
  const invalidDurableIds: string[] = [];
  for (const segmentId of durableIds) {
    if (pendingBySegmentId.has(segmentId)) continue;
    const segment = getSegment(segmentId);
    if (!segment || !shouldSyncSegmentToTomatodo(segment)) {
      invalidDurableIds.push(segmentId);
      continue;
    }
    inputs.push({
      segmentId,
      record: buildTomatodoRecord({
        segmentId,
        subject: resolveSubjectForSegment(segment, config),
        startedAt: segment.startedAt,
        endedAt: segment.endedAt as number,
        activeElapsedMs: segment.activeElapsedMs,
      }),
    });
  }
  completeDurableTomatodoSegments(invalidDurableIds);

  if (inputs.length === 0) {
    return { ok: true, total: 0, uploaded: 0, failed: 0 };
  }

  if (!(await isTomatodoRunningAsync())) {
    // Durable 队列中可能有“客户端运行但桥不可用”时尚未写入 JSON 的 segment。
    // 客户端现已关闭，可以安全落到本地库；保留 durable id，待下次运行后上云确认。
    for (const segmentId of durableIds) {
      if (pendingBySegmentId.has(segmentId) || invalidDurableIds.includes(segmentId)) continue;
      await syncSegmentToTomatodoUnlocked(segmentId);
    }
    return {
      ok: false,
      total: inputs.length,
      uploaded: 0,
      failed: 0,
      error: '番茄 Todo 未运行；记录已安全写入本地待传队列，将在下次启动后上传。',
    };
  }

  const bridge = await writeTomatodoRecordsThroughBridge(inputs.map((input) => input.record));
  if (!bridge.available) {
    return {
      ok: false,
      total: inputs.length,
      uploaded: 0,
      failed: inputs.length,
      error: '番茄 Todo 同步桥不可用。请确保番茄 Todo 已启动。',
    };
  }

  const bridgeConfirmedSegmentIds = inputs
    .filter((_, index) => bridge.results[index]?.cloudSynced)
    .map((input) => input.segmentId);
  const uploadedSegmentIds = await reconcileTomatodoCloudConfirmation(
    dbPath,
    inputs.map((input) => input.segmentId),
    bridgeConfirmedSegmentIds,
  );
  completeDurableTomatodoSegments(uploadedSegmentIds);
  const uploaded = uploadedSegmentIds.length;
  const failed = Math.max(0, inputs.length - uploaded);

  logger.info('tomatodoSync', 'pending upload completed', {
    total: inputs.length,
    uploaded,
    failed,
  });

  return {
    ok: failed === 0,
    total: inputs.length,
    uploaded,
    failed,
    error: failed > 0 ? `${failed} 条仍待云端确认，已保留并将在后台自动重试` : undefined,
  };
}

export function uploadPendingTomatodoRecords(): Promise<PendingUploadResult> {
  return withTomatodoOperationLock(uploadPendingTomatodoRecordsUnlocked);
}

/** 返回当前待上云的 FocusLink 记录数（供 UI 展示）。 */
export function getPendingTomatodoCount(): number {
  const config = getTomatodoConfig();
  if (!config) return 0;
  const dbPath = resolveTomatodoDbPath(config.dbPath);
  const pending = new Set(listPendingTomatodoRecords(dbPath).map((record) => record.segmentId));
  for (const segmentId of readDurablePendingSegmentIds()) pending.add(segmentId);
  return pending.size;
}
