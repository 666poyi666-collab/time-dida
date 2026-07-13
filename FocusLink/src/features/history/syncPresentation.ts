import type { SyncQueueItem } from '@shared/types';

export type SessionSyncTone = 'ok' | 'warn' | 'error' | 'muted';

export interface SessionSyncState {
  label: string;
  tone: SessionSyncTone;
  title?: string;
}

interface SyncPayload {
  type?: string;
  sessionId?: string;
  segmentId?: string;
}

export const NOT_SYNCED_STATE: SessionSyncState = {
  label: '未同步',
  tone: 'muted',
  title: '这条记录还没有同步队列记录',
};

export function buildSessionSyncStateMap(queue: SyncQueueItem[]): Record<string, SessionSyncState> {
  // 同一 segment 可能经历多次重试/重建；只保留该逻辑记录最新的一项，再按整场聚合。
  const latestBySessionAndRecord = new Map<string, Map<string, SyncQueueItem>>();

  for (const item of queue) {
    const sessionId = getQueueSessionId(item);
    if (!sessionId) continue;
    const payload = parseSyncPayload(item.payload);
    if (!payload) continue;
    const logicalKey = payload.segmentId
      ? `segment:${payload.segmentId}`
      : `session:${payload.type ?? item.type}`;
    let records = latestBySessionAndRecord.get(sessionId);
    if (!records) {
      records = new Map();
      latestBySessionAndRecord.set(sessionId, records);
    }
    const prev = records.get(logicalKey);
    if (!prev || getQueueTimestamp(item) >= getQueueTimestamp(prev)) {
      records.set(logicalKey, item);
    }
  }

  const out: Record<string, SessionSyncState> = {};
  for (const [sessionId, records] of latestBySessionAndRecord.entries()) {
    out[sessionId] = aggregateSessionItems([...records.values()]);
  }
  return out;
}

function aggregateSessionItems(items: SyncQueueItem[]): SessionSyncState {
  const failed = items.find((item) => item.status === 'failed');
  if (failed) return queueItemToSessionSyncState(failed);
  const pending = items.find((item) => item.status === 'pending');
  if (pending) return queueItemToSessionSyncState(pending);
  const skipped = items.find((item) => item.status === 'skipped');
  if (skipped) return queueItemToSessionSyncState(skipped);
  if (items.length > 0 && items.every((item) => item.status === 'synced')) {
    return queueItemToSessionSyncState(items[0]);
  }
  return NOT_SYNCED_STATE;
}

export function getQueueSessionId(item: SyncQueueItem): string | null {
  const payload = parseSyncPayload(item.payload);
  if (!payload) return null;
  if (payload.type === 'session-note' && payload.sessionId) return payload.sessionId;
  if (payload.type === 'segment-note' && payload.sessionId) return payload.sessionId;
  if (payload.type === 'segment-focus' && payload.sessionId) return payload.sessionId;
  if (payload.type === 'segment-comment' && payload.sessionId) return payload.sessionId;
  return null;
}

export function queueItemToSessionSyncState(item: SyncQueueItem): SessionSyncState {
  if (item.status === 'synced') {
    return {
      label: '已同步',
      tone: 'ok',
      title: '最近一次同步已完成：已写入滴答清单',
    };
  }
  if (item.status === 'pending') {
    return {
      label: '未同步',
      tone: 'warn',
      title: '已有同步队列记录，尚未成功写入滴答清单',
    };
  }
  if (item.status === 'failed') {
    return {
      label: '同步失败',
      tone: 'error',
      title: item.lastError ?? '最近一次同步失败',
    };
  }
  if (item.status === 'skipped') {
    return {
      label: '未同步',
      tone: 'muted',
      title: '最近一次同步被跳过',
    };
  }
  return {
    label: item.status,
    tone: 'muted',
    title: '未知同步状态',
  };
}

function parseSyncPayload(payload: string): SyncPayload | null {
  try {
    const parsed = JSON.parse(payload) as SyncPayload;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getQueueTimestamp(item: SyncQueueItem): number {
  return item.updatedAt || item.createdAt || 0;
}
