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
import { ticktickAdapter } from '../providers/ticktickAdapter.js';
import { ticktickCliProvider } from '../tasks/cliProvider.js';
import { getSettings } from '../settingsStore.js';
import { logger } from '../logger.js';
import type { SyncQueueItem, FocusRecord, SyncStatus, TaskProvider } from '@shared/types';

type Payload = {
  type: 'segment-focus' | 'segment-comment' | 'session-note' | 'session-focus';
  segmentId?: string;
  sessionId?: string;
  taskId?: string;
};

function getActiveTaskProvider(): TaskProvider | null {
  const settings = getSettings();
  if (settings.taskSource === 'ticktick-cli') {
    return ticktickCliProvider;
  }
  if (settings.taskSource === 'ticktick-oauth' && ticktickAdapter.isAuthenticated) {
    return ticktickAdapter;
  }
  return null;
}

async function syncFocusRecordToCloud(taskId: string, record: FocusRecord): Promise<void> {
  const provider = getActiveTaskProvider();
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

async function syncCommentToTask(taskId: string, records: FocusRecord[]): Promise<void> {
  const provider = getActiveTaskProvider();
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
export async function resyncSegment(segmentId: string): Promise<{ ok: boolean; error?: string }> {
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
  const provider = getActiveTaskProvider();
  if (!provider) {
    logger.warn('sync', 'resyncSegment: no active task provider', { segmentId });
    return { ok: false, error: '未配置可用的任务提供器' };
  }
  if (provider.deleteFocusRecord) {
    logger.info('sync', 'resyncSegment: calling deleteFocusRecord', {
      segmentId,
      cloudFocusId: seg.cloudFocusId,
    });
    try {
      const deleteOk = await provider.deleteFocusRecord(segmentId);
      logger.info('sync', 'resyncSegment: deleteFocusRecord result', { segmentId, ok: deleteOk });
    } catch (err) {
      logger.warn('sync', 'resyncSegment: delete cloud failed', {
        segmentId,
        error: err instanceof Error ? err.message : String(err),
      });
      // 继续重新同步：云端可能已删除，或删除失败但用户仍想重新上传
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
  if (foundItem) {
    foundItem.status = 'pending';
    foundItem.lastError = null;
    foundItem.retryCount = 0;
    foundItem.updatedAt = Date.now();
    updateSyncQueue(foundItem);
    logger.info('sync', `resyncSegment: reactivated queue item ${foundItem.id}`, { segmentId });
  } else {
    // 3. 无旧项，新建
    enqueueSegmentSync(segmentId);
    logger.info('sync', `resyncSegment: enqueued new item`, { segmentId });
  }
  // 4. 立即处理
  const result = await runPending();
  if (result.failed > 0 && result.succeeded === 0) {
    return { ok: false, error: '重新同步失败，请查看日志' };
  }
  return { ok: true };
}

export function enqueueSessionSync(sessionId: string): SyncQueueItem {
  const segs = listSegments(sessionId);
  for (const seg of segs) {
    // 跳过未结束的片段：运行中的片段无法同步，入队只会产生失败项
    if (seg.taskId && seg.taskSource === 'ticktick' && seg.endedAt) {
      enqueueSegmentSync(seg.id);
    }
  }
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
  const payload = JSON.parse(item.payload) as Payload;
  const settings = getSettings();

  if (settings.syncMode === 'local-only') {
    return { ok: true };
  }

  if (payload.type === 'session-note') {
    return { ok: true };
  }

  try {
    let segmentIds: string[] = [];

    if (payload.type === 'segment-focus' && payload.segmentId) {
      segmentIds = [payload.segmentId];
    } else if (payload.type === 'segment-comment' && payload.segmentId) {
      segmentIds = [payload.segmentId];
    } else if (
      (payload.type === 'segment-focus' || payload.type === 'session-focus') &&
      payload.sessionId
    ) {
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
        await syncFocusRecordToCloud(seg.taskId, record);
      } else if (settings.syncMode === 'comment') {
        await syncCommentToTask(seg.taskId, [record]);
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const MAX_RETRIES = 5;

export async function runPending(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const items = listPendingSync();
  let succeeded = 0;
  let failed = 0;
  for (const item of items) {
    const res = await processItem(item);
    if (res.ok) {
      item.status = 'synced' as SyncStatus;
      item.lastError = null;
      succeeded++;
    } else {
      item.retryCount += 1;
      item.lastError = res.error ?? 'unknown';
      if (item.retryCount >= MAX_RETRIES) {
        item.status = 'failed' as SyncStatus;
      }
      failed++;
      logger.warn('sync', `item ${item.id} failed: ${item.lastError}`);
    }
    item.updatedAt = Date.now();
    updateSyncQueue(item);
  }
  logger.info('sync', `run complete`, { processed: items.length, succeeded, failed });
  return { processed: items.length, succeeded, failed };
}
