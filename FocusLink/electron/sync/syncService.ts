import crypto from 'node:crypto';
import {
  insertSyncQueue,
  updateSyncQueue,
  listPendingSync,
  listSyncQueue,
  getSyncQueueItem,
  getSession,
  listSegments,
  getSegment,
  listPauses,
} from '../db/index.js';
import { ticktickAdapter } from '../integrations/ticktick/oauthAdapter.js';
import { ticktickCliProvider } from '../tasks/cliProvider.js';
import { getSettings } from '../settingsStore.js';
import { logger } from '../logger.js';
import type { SyncQueueItem, FocusRecord, TaskProvider } from '@shared/types';

type Payload = {
  type: 'segment-focus' | 'segment-comment' | 'session-note' | 'session-focus';
  segmentId?: string;
  sessionId?: string;
  taskId?: string;
  provider?: 'dida-cli' | 'ticktick-oauth';
};

function getConfiguredProviderKey(): Payload['provider'] | undefined {
  const settings = getSettings();
  if (settings.taskSource === 'ticktick-oauth') return 'ticktick-oauth';
  // `local` 是旧版设置值，不再代表一个可见任务来源；统一按 CLI 优先迁移，避免
  // 工作台能读到滴答任务、专注同步却因为旧设置静默失效。
  return 'dida-cli';
}

function getTaskProvider(providerKey?: Payload['provider']): TaskProvider | null {
  const selected = providerKey ?? getConfiguredProviderKey();
  if (selected === 'dida-cli') return ticktickCliProvider;
  if (selected === 'ticktick-oauth' && ticktickAdapter.isAuthenticated) return ticktickAdapter;
  return null;
}

async function syncFocusRecordToCloud(
  taskId: string,
  record: FocusRecord,
  providerKey?: Payload['provider'],
): Promise<void> {
  const provider = getTaskProvider(providerKey);
  if (!provider) {
    throw new Error('未配置可用的任务提供器（dida CLI 或 TickTick OAuth）');
  }
  const recordWithTask: FocusRecord = {
    ...record,
    taskId,
  };
  // focus-record 模式：优先创建云端专注记录（dida focus create）
  // createFocusRecord 返回 null 表示 provider 不支持（如非 dida 配置），
  // 此时回退到追加任务备注（appendFocusRecordsToTask）
  if (provider.createFocusRecord) {
    const focusId = await provider.createFocusRecord(recordWithTask);
    if (focusId !== null) return;
    logger.info('sync', 'createFocusRecord returned null, falling back to comment sync', {
      segmentId: record.segmentId,
    });
  }
  if (provider.appendFocusRecordsToTask) {
    await provider.appendFocusRecordsToTask(taskId, [recordWithTask]);
    return;
  }
  if (provider.appendFocusRecordToTask) {
    await provider.appendFocusRecordToTask(taskId, recordWithTask);
    return;
  }
  throw new Error('当前任务提供器不支持专注记录同步');
}

async function syncCommentToTask(
  taskId: string,
  records: FocusRecord[],
  providerKey?: Payload['provider'],
): Promise<void> {
  const provider = getTaskProvider(providerKey);
  if (!provider) {
    throw new Error('未配置可用的任务提供器（dida CLI 或 TickTick OAuth）');
  }
  if (provider.appendFocusRecordsToTask) {
    await provider.appendFocusRecordsToTask(taskId, records);
    return;
  }
  for (const record of records) {
    if (provider.appendFocusRecordToTask) {
      await provider.appendFocusRecordToTask(taskId, record);
    }
  }
}

function makeItem(type: Payload['type'], payload: Payload): SyncQueueItem {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    type,
    payload: JSON.stringify(payload),
    status: 'pending',
    retryCount: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

function findReusablePayload(
  type: Payload['type'],
  matches: (payload: Payload) => boolean,
): SyncQueueItem | null {
  for (const item of listSyncQueue()) {
    if (item.status === 'synced' || item.status === 'skipped') continue;
    try {
      const payload = JSON.parse(item.payload) as Payload;
      if (payload.type === type && matches(payload)) return item;
    } catch {
      // Ignore malformed legacy queue items; processItem will surface them later.
    }
  }
  return null;
}

export function enqueueSegmentSync(segmentId: string): SyncQueueItem {
  const existing = findReusablePayload(
    'segment-focus',
    (payload) => payload.segmentId === segmentId,
  );
  if (existing) return reactivateQueueItem(existing);
  const seg = getSegment(segmentId);
  const item = makeItem('segment-focus', {
    type: 'segment-focus',
    segmentId,
    sessionId: seg?.sessionId,
    provider: getConfiguredProviderKey(),
  });
  insertSyncQueue(item);
  logger.info('sync', `enqueued segment ${segmentId}`);
  return item;
}

/** 删除单个 segment 的云端专注记录并重新同步：
 *  1. 调用 provider.deleteFocusRecord 删除云端记录 + 清空 cloudFocusId
 *  2. 找到该 segment 对应的旧 sync_queue 项（含 synced 状态），重置为 pending
 *  3. 若无旧项，新建一条 pending 项
 *  4. 调用 runPending 立即处理
 *  注意：必须先删云端记录，否则 createFocusRecord 会通过 marker 匹配跳过。 */
async function resyncSegmentUnlocked(
  segmentId: string,
): Promise<{ ok: boolean; queued?: boolean; error?: string }> {
  logger.info('sync', 'resyncSegment called', { segmentId });
  const seg = getSegment(segmentId);
  if (!seg) {
    logger.warn('sync', 'resyncSegment: segment not found', { segmentId });
    return { ok: false, error: '片段不存在' };
  }
  if (!seg.endedAt) {
    logger.warn('sync', 'resyncSegment: segment not ended', { segmentId });
    return { ok: false, error: '片段尚未结束' };
  }
  if (!seg.taskId || seg.taskSource !== 'ticktick') {
    logger.warn('sync', 'resyncSegment: segment not linked to ticktick', {
      segmentId,
      taskId: seg.taskId,
      taskSource: seg.taskSource,
    });
    return { ok: false, error: '片段未关联滴答任务' };
  }
  // 1. 删除云端记录（若有 cloudFocusId，或通过 marker 反查）
  const provider = getTaskProvider();
  if (!provider) {
    logger.warn('sync', 'resyncSegment: no active task provider', { segmentId });
    return { ok: false, error: '未配置可用的任务提供器' };
  }
  if (provider.deleteFocusRecord) {
    logger.info('sync', 'resyncSegment: calling deleteFocusRecord', {
      segmentId,
      cloudFocusId: seg.cloudFocusId,
    });
    let deleteOk = false;
    try {
      deleteOk = await provider.deleteFocusRecord(segmentId);
      logger.info('sync', 'resyncSegment: deleteFocusRecord result', { segmentId, ok: deleteOk });
    } catch (err) {
      logger.warn('sync', 'resyncSegment: delete cloud failed', {
        segmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // 删除失败时不能继续：createFocusRecord 的 marker 去重会找到旧记录并跳过，
    // 导致 resync 静默返回成功但实际未做任何更改
    if (!deleteOk) {
      return {
        ok: false,
        error: '删除云端旧记录失败，无法重新同步。请检查网络或 dida CLI 后重试。',
      };
    }
  } else {
    logger.warn('sync', 'resyncSegment: provider has no deleteFocusRecord', { segmentId });
  }
  // 2. 找到该 segment 对应的旧 sync_queue 项（含 synced 状态），重置为 pending
  let foundItem: SyncQueueItem | null = null;
  for (const item of listSyncQueue()) {
    try {
      const payload = JSON.parse(item.payload) as Payload;
      if (payload.type === 'segment-focus' && payload.segmentId === segmentId) {
        foundItem = item;
        break;
      }
    } catch {
      // ignore malformed
    }
  }
  let targetQueueItemId: string;
  if (foundItem) {
    foundItem.status = 'pending';
    foundItem.lastError = null;
    foundItem.retryCount = 0;
    foundItem.updatedAt = Date.now();
    updateSyncQueue(foundItem);
    targetQueueItemId = foundItem.id;
    logger.info('sync', `resyncSegment: reactivated queue item ${foundItem.id}`, { segmentId });
  } else {
    // 3. 无旧项，新建
    targetQueueItemId = enqueueSegmentSync(segmentId).id;
    logger.info('sync', `resyncSegment: enqueued new item`, { segmentId });
  }
  // 4. 立即处理
  // 当前函数已经持有 dida operation lock；不能递归调用公开 runPending，否则会把自己
  // 排在锁尾形成死锁。直接执行一批并据目标项的持久状态返回结果。
  await runPendingBatch();

  // runPending 可能与更早启动的批次合并，也可能因批次/限流冷却而暂不处理目标项。
  // 只有刚刚重置或创建的那一条 queue item 真正进入 synced，才能向 UI 报成功。
  const targetItem = getSyncQueueItem(targetQueueItemId);
  if (!targetItem) {
    return { ok: false, error: '重新同步队列项不存在，请刷新后重试。' };
  }
  if (targetItem.status === 'synced') return { ok: true };
  if (targetItem.status === 'failed') {
    return { ok: false, error: targetItem.lastError ?? '重新同步失败，请查看同步队列。' };
  }
  if (targetItem.status === 'skipped') {
    return { ok: false, error: '重新同步被跳过，云端记录尚未重新写入。' };
  }
  if (isRateLimitError(targetItem.lastError)) {
    return {
      ok: false,
      queued: true,
      error: '滴答请求频率受限；该片段仍在同步队列中，将在冷却结束后自动重试。',
    };
  }
  if (targetItem.lastError) {
    return {
      ok: false,
      queued: true,
      error: `重新同步尚未完成，已保留在同步队列：${targetItem.lastError}`,
    };
  }
  return {
    ok: false,
    queued: true,
    error: '重新同步已排队，但当前批次尚未处理该片段；冷却结束后会自动继续。',
  };
}

export function resyncSegment(
  segmentId: string,
): Promise<{ ok: boolean; queued?: boolean; error?: string }> {
  // 删除旧记录、重开队列和创建新记录必须成为一个不可穿插的事务区间。
  return withDidaSyncExclusive(() => resyncSegmentUnlocked(segmentId));
}

export function enqueueSessionSync(sessionId: string): SyncQueueItem {
  const segs = listSegments(sessionId);
  let firstSegmentItem: SyncQueueItem | null = null;
  for (const seg of segs) {
    // 跳过未结束的片段：运行中的片段无法同步，入队只会产生失败项
    if (seg.taskId && seg.taskSource === 'ticktick' && seg.endedAt) {
      const item = enqueueSegmentSync(seg.id);
      firstSegmentItem ??= item;
    }
  }

  // 每个 segment 已有独立队列项，History 也会按这些项聚合整场状态。旧实现还追加一个
  // session 级 segment-focus 项，而 processItem 会再次遍历全部片段，导致每场产生约 2N
  // 次 dida 请求。直接返回首个 segment 项即可保留 IPC 契约并消除重复上传/限流压力。
  if (firstSegmentItem) {
    logger.info('sync', `enqueued session ${sessionId}`, {
      segmentItems: segs.filter((seg) => seg.taskId && seg.taskSource === 'ticktick' && seg.endedAt)
        .length,
    });
    return firstSegmentItem;
  }

  // 没有可同步片段时保留一条 session 级审计项；processItem 会把它作为无远端写入的
  // no-op 完成。界面只在存在滴答关联片段时显示云同步徽标。
  const existing = findReusablePayload(
    'segment-focus',
    (payload) => payload.sessionId === sessionId,
  );
  if (existing) return reactivateQueueItem(existing);
  const item = makeItem('segment-focus', { type: 'segment-focus', sessionId });
  insertSyncQueue(item);
  logger.info('sync', `enqueued session ${sessionId} (cascaded to segments)`);
  return item;
}

function reactivateQueueItem(item: SyncQueueItem): SyncQueueItem {
  if (item.status === 'pending' && !item.lastError) return item;
  item.status = 'pending';
  item.lastError = null;
  item.retryCount = 0;
  item.updatedAt = Date.now();
  updateSyncQueue(item);
  return item;
}

export function listQueue(): SyncQueueItem[] {
  return listSyncQueue();
}

export async function retryItem(id: string): Promise<void> {
  const item = getSyncQueueItem(id);
  if (!item) return;
  item.status = 'pending';
  item.lastError = null;
  item.retryCount = 0;
  item.updatedAt = Date.now();
  updateSyncQueue(item);
}

function buildSegmentFocusRecord(seg: {
  id: string;
  sessionId: string;
  taskId: string | null;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  activeElapsedMs: number;
  note: string | null;
}): FocusRecord {
  const session = getSession(seg.sessionId);
  const segPauseMs = session
    ? computeSegmentPauseMs(session.id, seg.id, seg.startedAt, seg.endedAt)
    : 0;
  return {
    sessionId: seg.sessionId,
    segmentId: seg.id,
    taskId: seg.taskId,
    taskTitle: seg.title ?? null,
    startedAt: seg.startedAt,
    endedAt: seg.endedAt,
    activeElapsedMs: seg.activeElapsedMs,
    pauseElapsedMs: segPauseMs,
    wallElapsedMs: seg.endedAt ? seg.endedAt - seg.startedAt : 0,
    note: seg.note,
  };
}

function computeSegmentPauseMs(
  sessionId: string,
  segmentId: string,
  _startedAt: number,
  _endedAt: number | null,
): number {
  // 从 pause_events 表查询属于该 segment 的暂停总时长
  const pauses = listPauses(sessionId);
  let total = 0;
  for (const p of pauses) {
    if (p.segmentId === segmentId && p.durationMs > 0) {
      total += p.durationMs;
    }
  }
  return total;
}

async function processItem(item: SyncQueueItem): Promise<{ ok: boolean; error?: string }> {
  let payload: Payload;
  try {
    payload = JSON.parse(item.payload) as Payload;
  } catch (err) {
    return {
      ok: false,
      error: `同步队列数据格式错误：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const settings = getSettings();

  // runPendingBatch 会在 local-only 下暂停整条队列；这里保留防御性检查，避免设置在
  // 批次执行途中切换时把未上云记录误标为 synced。
  if (settings.syncMode === 'local-only') return { ok: false, error: 'sync_paused_local_only' };

  if (payload.type === 'session-note') {
    return { ok: true };
  }

  try {
    let segmentIds: string[] = [];

    if (payload.type === 'segment-focus' && payload.segmentId) {
      segmentIds = [payload.segmentId];
    } else if (payload.type === 'segment-comment' && payload.segmentId) {
      segmentIds = [payload.segmentId];
    } else if (payload.type === 'segment-focus' && payload.sessionId) {
      // v0.5.x 曾同时入队 N 个 segment 项和一个同类型 session 汇总项。segment 项已经
      // 是唯一云写入单元；汇总项只用于历史审计，不能再次上传整场。
      return { ok: true };
    } else if (payload.type === 'session-focus' && payload.sessionId) {
      // 兼容更老版本仅有 session-focus、没有独立 segment 项的队列数据。
      const segs = listSegments(payload.sessionId);
      segmentIds = segs
        .filter((s) => s.taskId && s.taskSource === 'ticktick' && s.endedAt)
        .map((s) => s.id);
    } else {
      return { ok: true };
    }

    for (const segId of segmentIds) {
      const seg = getSegment(segId);
      if (!seg) continue;
      if (!seg.taskId || seg.taskSource !== 'ticktick') continue;
      if (!seg.endedAt) {
        return { ok: false, error: 'segment 尚未结束' };
      }

      const record = buildSegmentFocusRecord(seg);

      if (settings.syncMode === 'focus-record') {
        await syncFocusRecordToCloud(seg.taskId, record, payload.provider);
      } else if (settings.syncMode === 'comment') {
        await syncCommentToTask(seg.taskId, [record], payload.provider);
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const MAX_RETRIES = 5;

/**
 * dida Open API 当前限制为 100 requests/min。同步一条 segment 往往会触发任务查询、
 * 去重查询和创建记录等多次请求，因此不能把积压队列一次性全部重放。
 */
const RUN_PENDING_BATCH_SIZE = 8;
const BATCH_COOLDOWN_MS = 60_000;
const RATE_LIMIT_BACKOFF_BASE_MS = 60_000;
const RATE_LIMIT_BACKOFF_MAX_MS = 15 * 60_000;
const RATE_LIMIT_ERROR_RE =
  /(?:\b429\b|too many requests?|rate[ -]?limit|100\s*requests?\s*\/\s*min|请求(?:过于|太)?频繁|访问频繁|频率限制|超过[^\n]*(?:频率|限额))/i;
const RATE_LIMIT_ERROR_PREFIX_RE = /^\[rate-limit:(\d+)\]\s*/;

export interface RunPendingResult {
  processed: number;
  succeeded: number;
  failed: number;
}

let runPendingInFlight: Promise<RunPendingResult> | null = null;
let didaOperationTail: Promise<void> = Promise.resolve();
let scheduledRun: ReturnType<typeof setTimeout> | null = null;
let scheduledRunAt = 0;
let nextBatchNotBefore = 0;
let rerunRequested = false;

function withDidaSyncExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const run = didaOperationTail.then(operation, operation);
  didaOperationTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * 在 dida 队列空闲后独占执行删除/本地清理，直至回调结束。与单纯 await 当前 promise
 * 不同，这会阻止新的后台 runPending 在“等待完成”和“开始删除”之间插入。
 */
export function withPendingSyncExclusive<T>(operation: () => Promise<T>): Promise<T> {
  return withDidaSyncExclusive(operation);
}

function isRateLimitError(error: string | null | undefined): boolean {
  return !!error && (RATE_LIMIT_ERROR_PREFIX_RE.test(error) || RATE_LIMIT_ERROR_RE.test(error));
}

function getRateLimitAttempt(error: string | null | undefined): number {
  if (!error) return 0;
  const match = RATE_LIMIT_ERROR_PREFIX_RE.exec(error);
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

function getRateLimitBackoffMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(RATE_LIMIT_BACKOFF_BASE_MS * 2 ** exponent, RATE_LIMIT_BACKOFF_MAX_MS);
}

function formatRateLimitError(error: string, attempt: number): string {
  const message = error.replace(RATE_LIMIT_ERROR_PREFIX_RE, '').trim() || '请求频率受限';
  return `[rate-limit:${attempt}] ${message}`;
}

/**
 * 限流状态保存在 pending item 的 lastError + updatedAt 中，因此应用重启后仍会尊重退避。
 * dida 的限流是账号级的；任意一项仍在退避时，整条队列都应暂停。
 */
function getPersistedRateLimitUntil(items: readonly SyncQueueItem[]): number {
  let blockedUntil = 0;
  for (const item of items) {
    if (!isRateLimitError(item.lastError)) continue;
    const attempt = Math.max(1, getRateLimitAttempt(item.lastError));
    blockedUntil = Math.max(blockedUntil, item.updatedAt + getRateLimitBackoffMs(attempt));
  }
  return blockedUntil;
}

function clearScheduledRun(): void {
  if (scheduledRun) clearTimeout(scheduledRun);
  scheduledRun = null;
  scheduledRunAt = 0;
}

function schedulePendingRun(delayMs: number): void {
  const safeDelay = Math.max(0, delayMs);
  const runAt = Date.now() + safeDelay;
  // 已有更早或相同的唤醒，无需把它推迟。
  if (scheduledRun && scheduledRunAt <= runAt) return;
  clearScheduledRun();
  scheduledRunAt = runAt;
  scheduledRun = setTimeout(() => {
    scheduledRun = null;
    scheduledRunAt = 0;
    void runPending().catch((err) => {
      logger.warn('sync', 'scheduled queue run failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, safeDelay);
  // 后台退避计时不应单独阻止 Node/Electron 进程退出。
  scheduledRun.unref?.();
}

async function runPendingBatch(): Promise<RunPendingResult> {
  const pending = listPendingSync();
  if (pending.length === 0) {
    clearScheduledRun();
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // “仅本地”是暂停远端同步，不是宣告远端同步成功。保留所有 pending，并定期轻量
  // 探测设置是否已恢复；用户手动点击重试时也可立即绕过该定时器执行。
  if (getSettings().syncMode === 'local-only') {
    nextBatchNotBefore = 0;
    schedulePendingRun(BATCH_COOLDOWN_MS);
    logger.info('sync', 'queue paused in local-only mode', { pending: pending.length });
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const now = Date.now();
  const blockedUntil = Math.max(nextBatchNotBefore, getPersistedRateLimitUntil(pending));
  if (blockedUntil > now) {
    schedulePendingRun(blockedUntil - now);
    logger.info('sync', 'queue run deferred by cooldown', {
      pending: pending.length,
      retryInMs: blockedUntil - now,
    });
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const items = pending.slice(0, RUN_PENDING_BATCH_SIZE);
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let rateLimitBackoffUntil = 0;

  for (const item of items) {
    const res = await processItem(item);
    // 设置可能在本批次中途切到 local-only。该项和剩余项都保持 pending，且本次不
    // 消耗 retryCount；下一次探测恢复云模式后继续。
    if (res.error === 'sync_paused_local_only') {
      nextBatchNotBefore = 0;
      schedulePendingRun(BATCH_COOLDOWN_MS);
      break;
    }
    processed++;
    if (res.ok) {
      item.status = 'synced';
      item.lastError = null;
      succeeded++;
    } else if (isRateLimitError(res.error)) {
      // 429/频率限制是服务端的临时状态，不应耗尽用户的 5 次永久重试额度。
      const attempt = getRateLimitAttempt(item.lastError) + 1;
      item.status = 'pending';
      item.lastError = formatRateLimitError(res.error ?? '请求频率受限', attempt);
      failed++;
      rateLimitBackoffUntil = Date.now() + getRateLimitBackoffMs(attempt);
      logger.warn('sync', `item ${item.id} rate limited; retry scheduled`, {
        attempt,
        retryInMs: getRateLimitBackoffMs(attempt),
      });
    } else {
      item.retryCount += 1;
      item.lastError = res.error ?? 'unknown';
      if (item.retryCount >= MAX_RETRIES) {
        item.status = 'failed';
      }
      failed++;
      logger.warn('sync', `item ${item.id} failed: ${item.lastError}`);
    }
    item.updatedAt = Date.now();
    updateSyncQueue(item);

    // 一旦服务端返回限流，立即停止本轮，避免后续 item 继续打 API。
    if (rateLimitBackoffUntil > 0) break;
  }

  const remaining = listPendingSync();
  if (rateLimitBackoffUntil > 0) {
    nextBatchNotBefore = rateLimitBackoffUntil;
    schedulePendingRun(rateLimitBackoffUntil - Date.now());
  } else if (remaining.length > 0) {
    // 积压、新入队项和普通失败项都要自动续跑；一分钟最多启动一批，给每项内部的
    // 多次 dida 请求留余量。不能只在正好处理满 8 项时续跑，否则小队列会永久搁置。
    nextBatchNotBefore = Date.now() + BATCH_COOLDOWN_MS;
    schedulePendingRun(BATCH_COOLDOWN_MS);
  } else if (remaining.length === 0) {
    nextBatchNotBefore = 0;
    clearScheduledRun();
  }

  logger.info('sync', `run complete`, {
    processed,
    succeeded,
    failed,
    pending: remaining.length,
    batchSize: RUN_PENDING_BATCH_SIZE,
  });
  return { processed, succeeded, failed };
}

export function runPending(): Promise<RunPendingResult> {
  if (runPendingInFlight) {
    // 调用可能来自当前批次执行期间的新入队。返回同一 promise 保持 single-flight，
    // 同时记下“还需再看一轮”，避免新项不在本批 snapshot 中而永久 pending。
    rerunRequested = true;
    return runPendingInFlight;
  }
  runPendingInFlight = withDidaSyncExclusive(runPendingBatch).finally(() => {
    runPendingInFlight = null;
    const shouldRerun = rerunRequested;
    rerunRequested = false;
    if (shouldRerun && listPendingSync().length > 0) {
      schedulePendingRun(Math.max(0, nextBatchNotBefore - Date.now()));
    }
  });
  return runPendingInFlight;
}

/** 删除本地账本前等待当前云同步批次结束，避免“刚删完又被 in-flight create 重建”。 */
export async function waitForPendingSyncIdle(): Promise<void> {
  await didaOperationTail;
}
