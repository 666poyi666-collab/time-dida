import { describe, expect, it } from 'vitest';
import type { SyncQueueItem, SyncStatus } from '@shared/types';
import {
  buildSessionSyncStateMap,
  getQueueSessionId,
  NOT_SYNCED_STATE,
  queueItemToSessionSyncState,
} from '../src/lib/syncStatus';

function queueItem(
  id: string,
  payload: unknown,
  status: SyncStatus,
  updatedAt: number,
  lastError: string | null = null,
): SyncQueueItem {
  return {
    id,
    type: 'focus-sync',
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    status,
    retryCount: 0,
    lastError,
    createdAt: updatedAt - 100,
    updatedAt,
  };
}

describe('sync queue status aggregation', () => {
  it('maps synced session queue items to ok status', () => {
    const map = buildSessionSyncStateMap([
      queueItem('a', { type: 'session-note', sessionId: 'session-1' }, 'synced', 100),
    ]);

    expect(map['session-1']).toMatchObject({
      label: '已同步',
      tone: 'ok',
    });
  });

  it('uses the latest queue item for a session', () => {
    const map = buildSessionSyncStateMap([
      queueItem(
        'old',
        { type: 'session-note', sessionId: 'session-1' },
        'failed',
        100,
        'old error',
      ),
      queueItem('new', { type: 'session-note', sessionId: 'session-1' }, 'synced', 200),
    ]);

    expect(map['session-1']).toMatchObject({
      label: '已同步',
      tone: 'ok',
    });
  });

  it('shows pending and failed states with the right tone', () => {
    expect(
      queueItemToSessionSyncState(
        queueItem('pending', { type: 'session-note', sessionId: 'session-1' }, 'pending', 100),
      ),
    ).toMatchObject({
      label: '待同步',
      tone: 'warn',
    });

    expect(
      queueItemToSessionSyncState(
        queueItem(
          'failed',
          { type: 'session-note', sessionId: 'session-1' },
          'failed',
          100,
          'network down',
        ),
      ),
    ).toMatchObject({
      label: '同步失败',
      tone: 'error',
      title: 'network down',
    });
  });

  it('ignores malformed payloads and segment items without session id', () => {
    const map = buildSessionSyncStateMap([
      queueItem('bad', '{not-json', 'pending', 300),
      queueItem('segment', { type: 'segment-note', segmentId: 'seg-1' }, 'synced', 200),
    ]);

    expect(map).toEqual({});
    expect(getQueueSessionId(queueItem('bad', '{not-json', 'pending', 300))).toBeNull();
  });

  it('supports segment queue items that carry session id', () => {
    const map = buildSessionSyncStateMap([
      queueItem(
        'segment',
        { type: 'segment-note', segmentId: 'seg-1', sessionId: 'session-1' },
        'pending',
        100,
      ),
    ]);

    expect(map['session-1']).toMatchObject({
      label: '待同步',
      tone: 'warn',
    });
  });

  it('exposes a muted default for sessions without queue state', () => {
    expect(NOT_SYNCED_STATE).toMatchObject({
      label: '未同步',
      tone: 'muted',
    });
  });
});
