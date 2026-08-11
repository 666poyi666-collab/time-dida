import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusSegment, FocusSession, SyncQueueItem } from '@shared/types';
import type { RemoteWritebackItem } from '../electron/sync/remoteWritebackStore';

const harness = vi.hoisted(() => ({
  claims: [] as RemoteWritebackItem[],
  leaseNumber: 0,
  sessions: new Map<string, FocusSession>(),
  segments: new Map<string, FocusSegment[]>(),
  ensureSessionSyncQueued: vi.fn(),
  readSyncQueueItems: vi.fn(),
  runPending: vi.fn(),
  getTomatodoSyncStatus: vi.fn(),
  syncSessionToTomatodo: vi.fn(),
  claimNextRemoteWriteback: vi.fn(),
  completeRemoteWriteback: vi.fn(),
  renewRemoteWritebackLease: vi.fn(),
  retryRemoteWriteback: vi.fn(),
}));

vi.mock('../electron/db/index.js', () => ({
  getSession: (sessionId: string) => harness.sessions.get(sessionId) ?? null,
  listSegments: (sessionId: string) => harness.segments.get(sessionId) ?? [],
}));

vi.mock('../electron/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../electron/sync/syncService.js', () => ({
  ensureSessionSyncQueued: harness.ensureSessionSyncQueued,
  readSyncQueueItems: harness.readSyncQueueItems,
  runPending: harness.runPending,
}));

vi.mock('../electron/sync/tomatodoSyncService.js', () => ({
  getTomatodoSyncStatus: harness.getTomatodoSyncStatus,
  syncSessionToTomatodo: harness.syncSessionToTomatodo,
}));

vi.mock('../electron/sync/remoteWritebackStore.js', () => ({
  claimNextRemoteWriteback: harness.claimNextRemoteWriteback,
  completeRemoteWriteback: harness.completeRemoteWriteback,
  renewRemoteWritebackLease: harness.renewRemoteWritebackLease,
  retryRemoteWriteback: harness.retryRemoteWriteback,
}));

import { runRemoteWritebacks } from '../electron/sync/remoteWritebackCoordinator';

function session(id: string): FocusSession {
  return {
    id,
    title: '远端专注',
    status: 'finished',
    startedAt: 1_000,
    endedAt: 2_000,
    activeElapsedMs: 1_000,
    pauseElapsedMs: 0,
    wallElapsedMs: 1_000,
    defaultTaskId: null,
    defaultTaskSource: null,
    defaultTaskTitle: null,
    note: null,
    createdAt: 1_000,
    updatedAt: 2_000,
  };
}

function segment(sessionId: string, taskSource: 'ticktick' | null = null): FocusSegment {
  return {
    id: `${sessionId}-segment`,
    sessionId,
    taskId: taskSource ? 'task-1' : null,
    taskSource,
    title: '远端专注',
    startedAt: 1_000,
    endedAt: 2_000,
    activeElapsedMs: 1_000,
    note: null,
    cloudFocusId: null,
    tomatodoSubject: null,
    createdAt: 1_000,
    updatedAt: 2_000,
  };
}

function queueItem(status: SyncQueueItem['status']): SyncQueueItem {
  return {
    id: `queue-${status}`,
    type: 'segment-focus',
    payload: '{}',
    status,
    retryCount: 0,
    lastError: null,
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function writebackItem(
  provider: RemoteWritebackItem['provider'],
  sessionId = 'session-1',
): RemoteWritebackItem {
  return {
    connectionScope: 'scope-a',
    sessionId,
    provider,
    state: 'claimed',
    attemptCount: 0,
    nextRetryAt: 0,
    leaseId: 'lease',
    leaseExpiresAt: 60_000,
    lastError: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    completedAt: null,
  };
}

describe('remote write-back coordinator', () => {
  beforeEach(() => {
    harness.claims = [];
    harness.leaseNumber = 0;
    harness.sessions.clear();
    harness.segments.clear();
    harness.ensureSessionSyncQueued.mockReset();
    harness.readSyncQueueItems.mockReset();
    harness.runPending.mockReset();
    harness.getTomatodoSyncStatus.mockReset();
    harness.syncSessionToTomatodo.mockReset();
    harness.claimNextRemoteWriteback.mockReset();
    harness.completeRemoteWriteback.mockReset();
    harness.renewRemoteWritebackLease.mockReset();
    harness.retryRemoteWriteback.mockReset();
    harness.claimNextRemoteWriteback.mockImplementation((connectionScope: string) => ({
      leaseId: `lease-${++harness.leaseNumber}`,
      item: harness.claims.shift() ?? null,
      connectionScope,
    }));
    harness.completeRemoteWriteback.mockReturnValue(true);
    harness.renewRemoteWritebackLease.mockReturnValue(true);
    harness.retryRemoteWriteback.mockReturnValue(true);
  });

  it('drains the existing dida queue and completes only after durable confirmation', async () => {
    const remote = writebackItem('dida');
    const pending = queueItem('pending');
    const synced = { ...pending, status: 'synced' as const };
    harness.claims.push(remote);
    harness.sessions.set(remote.sessionId, session(remote.sessionId));
    harness.segments.set(remote.sessionId, [segment(remote.sessionId, 'ticktick')]);
    harness.ensureSessionSyncQueued.mockReturnValue([pending]);
    harness.readSyncQueueItems.mockReturnValue([synced]);
    harness.runPending.mockResolvedValue({ processed: 1, succeeded: 1, failed: 0 });

    await expect(runRemoteWritebacks('scope-a')).resolves.toEqual({
      processed: 1,
      completed: 1,
      deferred: 0,
    });

    expect(harness.claimNextRemoteWriteback).toHaveBeenCalledWith('scope-a');
    expect(harness.ensureSessionSyncQueued).toHaveBeenCalledWith(remote.sessionId);
    expect(harness.runPending).toHaveBeenCalledOnce();
    expect(harness.renewRemoteWritebackLease).toHaveBeenCalledWith(remote, 'lease-1');
    expect(harness.completeRemoteWriteback).toHaveBeenCalledWith(remote, 'lease-1');
    expect(harness.retryRemoteWriteback).not.toHaveBeenCalled();
  });

  it('keeps TomaToDo work durable until cloud confirmation is observed', async () => {
    const remote = writebackItem('tomatodo');
    const remoteSegment = segment(remote.sessionId);
    harness.claims.push(remote);
    harness.sessions.set(remote.sessionId, session(remote.sessionId));
    harness.segments.set(remote.sessionId, [remoteSegment]);
    harness.syncSessionToTomatodo.mockResolvedValue({ ok: true, failed: 0 });
    harness.getTomatodoSyncStatus.mockReturnValue({
      enabled: true,
      segments: [{ segmentId: remoteSegment.id, cloudSynced: false }],
    });

    await expect(runRemoteWritebacks('scope-a')).resolves.toEqual({
      processed: 1,
      completed: 0,
      deferred: 1,
    });

    expect(harness.syncSessionToTomatodo).toHaveBeenCalledWith(remote.sessionId);
    expect(harness.completeRemoteWriteback).not.toHaveBeenCalled();
    expect(harness.retryRemoteWriteback).toHaveBeenCalledWith(
      remote,
      'lease-1',
      'tomatodo_cloud_pending:1',
    );
  });

  it('renews the SQLite lease while a slow provider delivery is in flight', async () => {
    vi.useFakeTimers();
    try {
      const remote = writebackItem('dida');
      const pending = queueItem('pending');
      const synced = { ...pending, status: 'synced' as const };
      let resolvePending!: () => void;
      harness.claims.push(remote);
      harness.sessions.set(remote.sessionId, session(remote.sessionId));
      harness.segments.set(remote.sessionId, [segment(remote.sessionId, 'ticktick')]);
      harness.ensureSessionSyncQueued.mockReturnValue([pending]);
      harness.readSyncQueueItems.mockReturnValue([synced]);
      harness.runPending.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvePending = resolve;
          }),
      );

      const running = runRemoteWritebacks('scope-a');
      await Promise.resolve();
      await Promise.resolve();
      expect(harness.runPending).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(20_000);
      expect(harness.renewRemoteWritebackLease).toHaveBeenCalledTimes(2);

      resolvePending();
      await expect(running).resolves.toMatchObject({ completed: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('completes a dida intent with no linked dida segment as a terminal no-op', async () => {
    const remote = writebackItem('dida');
    harness.claims.push(remote);
    harness.sessions.set(remote.sessionId, session(remote.sessionId));
    harness.segments.set(remote.sessionId, [segment(remote.sessionId)]);

    await expect(runRemoteWritebacks('scope-a')).resolves.toEqual({
      processed: 1,
      completed: 1,
      deferred: 0,
    });

    expect(harness.ensureSessionSyncQueued).not.toHaveBeenCalled();
    expect(harness.completeRemoteWriteback).toHaveBeenCalledWith(remote, 'lease-1');
  });
});
