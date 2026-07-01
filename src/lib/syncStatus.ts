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
  const latest = new Map<string, SyncQueueItem>();

  for (const item of queue) {
    const sessionId = getQueueSessionId(item);
    if (!sessionId) continue;
    const prev = latest.get(sessionId);
    if (!prev || getQueueTimestamp(item) >= getQueueTimestamp(prev)) {
      latest.set(sessionId, item);
    }
  }

  const out: Record<string, SessionSyncState> = {};
  for (const [sessionId, item] of latest.entries()) {
    out[sessionId] = queueItemToSessionSyncState(item);
  }
  return out;
}

export function getQueueSessionId(item: SyncQueueItem): string | null {
  const payload = parseSyncPayload(item.payload);
  if (!payload) return null;
  if (payload.type === 'session-note' && payload.sessionId) return payload.sessionId;
  if (payload.type === 'segment-note' && payload.sessionId) return payload.sessionId;
  return null;
}

export function queueItemToSessionSyncState(item: SyncQueueItem): SessionSyncState {
  if (item.status === 'synced') {
    return {
      label: '已同步',
      tone: 'ok',
      title: '最近一次同步已完成：已写入滴答任务评论或任务内容',
    };
  }
  if (item.status === 'pending') {
    return {
      label: '待同步',
      tone: 'warn',
      title: '已有同步队列记录，尚未成功写入滴答',
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
      label: '已跳过',
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
