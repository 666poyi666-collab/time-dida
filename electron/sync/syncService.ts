// 同步服务 - 处理 sync_queue
// 不阻塞 UI；失败不丢数据；离线先保存本地；网络恢复后手动/自动同步
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
} from '../db/index.js';
import { ticktickAdapter } from '../providers/ticktickAdapter.js';
import { experimentalFocusAdapter } from '../providers/experimentalFocus.js';
import { ticktickCliProvider } from '../tasks/cliProvider.js';
import { getSettings } from '../settingsStore.js';
import { logger } from '../logger.js';
import type {
  SyncQueueItem,
  FocusRecord,
  SyncStatus,
} from '@shared/types';

type Payload = {
  type: 'segment-note' | 'session-note' | 'focus-record';
  segmentId?: string;
  sessionId?: string;
  taskId?: string;
};

async function appendFocusRecord(taskId: string, record: FocusRecord): Promise<void> {
  const settings = getSettings();
  if (settings.taskSource === 'ticktick-cli') {
    await ticktickCliProvider.appendFocusRecordToTask(taskId, record);
    return;
  }
  if (!ticktickAdapter.isAuthenticated) {
    throw new Error('未登录 TickTick OAuth；若使用 dida CLI，请在设置中把任务来源切到 dida CLI。');
  }
  await ticktickAdapter.appendFocusRecordToTask(taskId, record);
}

function makeItem(type: string, payload: Payload): SyncQueueItem {
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

function findPendingPayload(
  type: Payload['type'],
  matches: (payload: Payload) => boolean
): SyncQueueItem | null {
  for (const item of listPendingSync()) {
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
  const existing = findPendingPayload(
    'segment-note',
    (payload) => payload.segmentId === segmentId
  );
  if (existing) return existing;
  const seg = getSegment(segmentId);
  const item = makeItem('segment-note', { type: 'segment-note', segmentId, sessionId: seg?.sessionId });
  insertSyncQueue(item);
  logger.info('sync', `enqueued segment ${segmentId}`);
  return item;
}

export function enqueueSessionSync(sessionId: string): SyncQueueItem {
  const existing = findPendingPayload(
    'session-note',
    (payload) => payload.sessionId === sessionId
  );
  if (existing) return existing;
  const item = makeItem('session-note', { type: 'session-note', sessionId });
  insertSyncQueue(item);
  logger.info('sync', `enqueued session ${sessionId}`);
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
  item.updatedAt = Date.now();
  updateSyncQueue(item);
}

/** 处理一个队列项，返回是否成功 */
async function processItem(item: SyncQueueItem): Promise<{ ok: boolean; error?: string }> {
  const payload = JSON.parse(item.payload) as Payload;
  const settings = getSettings();

  // 本地模式直接跳过
  if (settings.syncMode === 'local-only') {
    return { ok: true };
  }

  try {
    if (payload.type === 'segment-note' && payload.segmentId) {
      const seg = getSegment(payload.segmentId);
      if (!seg) return { ok: false, error: 'segment 不存在' };
      if (!seg.taskId || seg.taskSource !== 'ticktick') {
        return { ok: true }; // 本地任务无需同步
      }
      const session = getSession(seg.sessionId);
      const record: FocusRecord = {
        sessionId: seg.sessionId,
        segmentId: seg.id,
        taskTitle: seg.title ?? null,
        startedAt: seg.startedAt,
        endedAt: seg.endedAt,
        activeElapsedMs: seg.activeElapsedMs,
        pauseElapsedMs: 0,
        wallElapsedMs: seg.endedAt ? seg.endedAt - seg.startedAt : 0,
        note: seg.note,
      };
      // 稳定通道：追加到任务备注
      if (settings.syncMode === 'note' || settings.syncMode === 'experimental-focus') {
        await appendFocusRecord(seg.taskId, record);
      }
      // 实验性 Focus 记录
      if (settings.syncMode === 'experimental-focus' && settings.experimentalFocusEnabled) {
        await experimentalFocusAdapter.createFocusRecord(record);
      }
      return { ok: true };
    }

    if (payload.type === 'session-note' && payload.sessionId) {
      const session = getSession(payload.sessionId);
      if (!session) return { ok: false, error: 'session 不存在' };
      const segs = listSegments(payload.sessionId).filter(
        (s) => s.taskId && s.taskSource === 'ticktick'
      );
      for (const seg of segs) {
        const record: FocusRecord = {
          sessionId: seg.sessionId,
          segmentId: seg.id,
          taskTitle: seg.title ?? null,
          startedAt: seg.startedAt,
          endedAt: seg.endedAt,
          activeElapsedMs: seg.activeElapsedMs,
          pauseElapsedMs: session.pauseElapsedMs,
          wallElapsedMs: session.wallElapsedMs,
          note: seg.note,
        };
        if (settings.syncMode === 'note' || settings.syncMode === 'experimental-focus') {
          await appendFocusRecord(seg.taskId!, record);
        }
      }
      if (settings.syncMode === 'experimental-focus' && settings.experimentalFocusEnabled) {
        const record: FocusRecord = {
          sessionId: session.id,
          taskTitle: session.title ?? null,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          activeElapsedMs: session.activeElapsedMs,
          pauseElapsedMs: session.pauseElapsedMs,
          wallElapsedMs: session.wallElapsedMs,
        };
        await experimentalFocusAdapter.createFocusRecord(record);
      }
      return { ok: true };
    }

    return { ok: false, error: `未知 payload type: ${payload.type}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const MAX_RETRIES = 5;

/** 运行所有 pending 项 */
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
