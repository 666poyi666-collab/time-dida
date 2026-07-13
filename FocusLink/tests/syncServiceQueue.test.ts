import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusSegment, SyncQueueItem } from '@shared/types';

const harness = vi.hoisted(() => ({
  queue: [] as SyncQueueItem[],
  segments: new Map<string, FocusSegment>(),
  createFocusRecord: vi.fn(),
  deleteFocusRecord: vi.fn(),
  updateSyncQueue: vi.fn(),
  settings: {
    taskSource: 'ticktick-cli',
    syncMode: 'focus-record' as 'focus-record' | 'comment' | 'local-only',
  },
}));

vi.mock('../electron/db/index', () => ({
  insertSyncQueue: (item: SyncQueueItem) => harness.queue.push(item),
  updateSyncQueue: (item: SyncQueueItem) => harness.updateSyncQueue(item),
  listPendingSync: () =>
    harness.queue
      .filter((item) => item.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt),
  listSyncQueue: () => [...harness.queue],
  getSyncQueueItem: (id: string) => harness.queue.find((item) => item.id === id) ?? null,
  getSession: (id: string) => ({ id }),
  listSegments: (sessionId: string) =>
    [...harness.segments.values()].filter((segment) => segment.sessionId === sessionId),
  getSegment: (id: string) => harness.segments.get(id) ?? null,
  listPauses: () => [],
}));

vi.mock('../electron/integrations/ticktick/oauthAdapter', () => ({
  ticktickAdapter: { isAuthenticated: false },
}));

vi.mock('../electron/tasks/cliProvider', () => ({
  ticktickCliProvider: {
    name: 'ticktick-cli',
    isAuthenticated: true,
    createFocusRecord: harness.createFocusRecord,
    deleteFocusRecord: harness.deleteFocusRecord,
  },
}));

vi.mock('../electron/settingsStore', () => ({
  getSettings: () => harness.settings,
}));

vi.mock('../electron/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function addPendingItems(count: number, startIndex = 0): SyncQueueItem[] {
  const items: SyncQueueItem[] = [];
  for (let offset = 0; offset < count; offset++) {
    const index = startIndex + offset;
    const segmentId = `segment-${index}`;
    const sessionId = `session-${index}`;
    const createdAt = Date.now() + index;
    const segment: FocusSegment = {
      id: segmentId,
      sessionId,
      taskId: `task-${index}`,
      taskSource: 'ticktick',
      title: `Task ${index}`,
      startedAt: createdAt,
      endedAt: createdAt + 1_000,
      activeElapsedMs: 1_000,
      note: null,
      cloudFocusId: null,
      tomatodoSubject: null,
      createdAt,
      updatedAt: createdAt,
    };
    const item: SyncQueueItem = {
      id: `queue-${index}`,
      type: 'segment-focus',
      payload: JSON.stringify({ type: 'segment-focus', segmentId, sessionId }),
      status: 'pending',
      retryCount: 0,
      lastError: null,
      createdAt,
      updatedAt: createdAt,
    };
    harness.segments.set(segmentId, segment);
    harness.queue.push(item);
    items.push(item);
  }
  return items;
}

async function loadSyncService() {
  vi.resetModules();
  return import('../electron/sync/syncService');
}

describe('sync queue rate limiting and batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'));
    harness.queue.length = 0;
    harness.segments.clear();
    harness.createFocusRecord.mockReset();
    harness.createFocusRecord.mockResolvedValue('focus-id');
    harness.deleteFocusRecord.mockReset();
    harness.deleteFocusRecord.mockResolvedValue(true);
    harness.updateSyncQueue.mockReset();
    harness.settings.taskSource = 'ticktick-cli';
    harness.settings.syncMode = 'focus-record';
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('processes at most eight items per run and leaves the backlog pending', async () => {
    const items = addPendingItems(10);
    const { runPending } = await loadSyncService();

    await expect(runPending()).resolves.toEqual({ processed: 8, succeeded: 8, failed: 0 });

    expect(harness.createFocusRecord).toHaveBeenCalledTimes(8);
    expect(items.slice(0, 8).every((item) => item.status === 'synced')).toBe(true);
    expect(items.slice(8).every((item) => item.status === 'pending')).toBe(true);

    // 同一分钟内再次触发不会绕过批次冷却。
    await expect(runPending()).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0 });
    expect(harness.createFocusRecord).toHaveBeenCalledTimes(8);
  });

  it('coalesces concurrent runPending calls into one in-flight run', async () => {
    addPendingItems(1);
    let resolveCreate!: (value: string) => void;
    harness.createFocusRecord.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const { runPending } = await loadSyncService();

    const first = runPending();
    const second = runPending();
    await Promise.resolve();

    expect(second).toBe(first);
    expect(harness.createFocusRecord).toHaveBeenCalledTimes(1);
    resolveCreate('focus-id');
    await expect(first).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });
    await expect(second).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });
  });

  it('prevents a background batch from entering an exclusive delete window', async () => {
    const { runPending, withPendingSyncExclusive } = await loadSyncService();
    let releaseExclusive!: () => void;
    const exclusive = withPendingSyncExclusive(
      () =>
        new Promise<void>((resolve) => {
          releaseExclusive = resolve;
        }),
    );
    await Promise.resolve();
    addPendingItems(1);

    const queuedRun = runPending();
    await Promise.resolve();
    expect(harness.createFocusRecord).not.toHaveBeenCalled();

    releaseExclusive();
    await exclusive;
    await expect(queuedRun).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(harness.createFocusRecord).toHaveBeenCalledTimes(1);
  });

  it('keeps every item pending while sync mode is local-only', async () => {
    const [item] = addPendingItems(1);
    harness.settings.syncMode = 'local-only';
    const { runPending } = await loadSyncService();

    await expect(runPending()).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0 });
    expect(item).toMatchObject({ status: 'pending', retryCount: 0, lastError: null });
    expect(harness.createFocusRecord).not.toHaveBeenCalled();
  });

  it('enqueues exactly one cloud-write item per linked segment in a session', async () => {
    addPendingItems(2);
    harness.queue.length = 0;
    for (const segment of harness.segments.values()) segment.sessionId = 'session-shared';
    const { enqueueSessionSync, runPending } = await loadSyncService();

    const returned = enqueueSessionSync('session-shared');
    expect(harness.queue).toHaveLength(2);
    expect(returned).toBe(harness.queue[0]);
    expect(harness.queue.map((item) => JSON.parse(item.payload) as { segmentId?: string })).toEqual(
      [
        expect.objectContaining({ segmentId: 'segment-0' }),
        expect.objectContaining({ segmentId: 'segment-1' }),
      ],
    );

    await runPending();
    expect(harness.createFocusRecord).toHaveBeenCalledTimes(2);
  });

  it('keeps the provider captured at enqueue time after the active source changes', async () => {
    addPendingItems(1);
    harness.queue.length = 0;
    const { enqueueSegmentSync, runPending } = await loadSyncService();

    const item = enqueueSegmentSync('segment-0');
    expect(JSON.parse(item.payload)).toMatchObject({ provider: 'dida-cli' });
    harness.settings.taskSource = 'local';

    await expect(runPending()).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(harness.createFocusRecord).toHaveBeenCalledTimes(1);
  });

  it('treats legacy segment-focus session summaries as audit-only no-ops', async () => {
    addPendingItems(1);
    harness.queue.length = 0;
    const now = Date.now();
    harness.queue.push({
      id: 'legacy-session-summary',
      type: 'segment-focus',
      payload: JSON.stringify({ type: 'segment-focus', sessionId: 'session-0' }),
      status: 'pending',
      retryCount: 0,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
    const { runPending } = await loadSyncService();

    await expect(runPending()).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(harness.createFocusRecord).not.toHaveBeenCalled();
  });

  it('does not lose an item enqueued around a short in-flight run', async () => {
    addPendingItems(1);
    let resolveCreate!: (value: string) => void;
    harness.createFocusRecord.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const { runPending } = await loadSyncService();

    const first = runPending();
    const later = addPendingItems(1, 1)[0];
    const coalesced = runPending();
    await Promise.resolve();
    resolveCreate('focus-id');
    await first;
    await coalesced;

    // Depending on whether the exclusive batch captured its snapshot before or after insertion,
    // the item is handled now or by the scheduled continuation. Both paths must converge.
    if (later.status === 'pending') await vi.advanceTimersByTimeAsync(60_000);
    expect(later.status).toBe('synced');
    expect(harness.createFocusRecord).toHaveBeenCalledTimes(2);
  });

  it('keeps a rate-limited item pending without consuming permanent retries', async () => {
    const items = addPendingItems(3);
    harness.createFocusRecord.mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'));
    const { runPending } = await loadSyncService();

    await expect(runPending()).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 });

    expect(harness.createFocusRecord).toHaveBeenCalledTimes(1);
    expect(items[0]).toMatchObject({ status: 'pending', retryCount: 0 });
    expect(items[0].lastError).toContain('[rate-limit:1]');
    expect(items[1].status).toBe('pending');
    expect(items[2].status).toBe('pending');

    // 退避期内整条账号级队列暂停。
    await expect(runPending()).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0 });
    expect(harness.createFocusRecord).toHaveBeenCalledTimes(1);

    // 一分钟后可恢复处理，rate-limit 不会把 retryCount 推向 failed。
    vi.setSystemTime(Date.now() + 60_000);
    harness.createFocusRecord.mockResolvedValue('focus-id');
    await expect(runPending()).resolves.toEqual({ processed: 3, succeeded: 3, failed: 0 });
    expect(items.every((item) => item.status === 'synced')).toBe(true);
    expect(items[0].retryCount).toBe(0);
  });

  it('reports resync as queued when the target is still behind the current batch', async () => {
    addPendingItems(9);
    const { resyncSegment } = await loadSyncService();

    await expect(resyncSegment('segment-8')).resolves.toMatchObject({
      ok: false,
      queued: true,
    });
    expect(harness.queue[8].status).toBe('pending');
    expect(harness.deleteFocusRecord).toHaveBeenCalledWith('segment-8');
  });

  it('waits for an in-flight create before deleting and recreating during resync', async () => {
    addPendingItems(1);
    let resolveCreate!: (value: string) => void;
    harness.createFocusRecord.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const { resyncSegment, runPending } = await loadSyncService();

    const activeRun = runPending();
    const resync = resyncSegment('segment-0');
    await Promise.resolve();
    expect(harness.deleteFocusRecord).not.toHaveBeenCalled();

    resolveCreate('focus-first');
    await activeRun;
    await expect(resync).resolves.toEqual({ ok: true });
    expect(harness.deleteFocusRecord).toHaveBeenCalledTimes(1);
    expect(harness.createFocusRecord).toHaveBeenCalledTimes(2);
  });

  it('still exhausts the retry budget for ordinary permanent failures', async () => {
    const [item] = addPendingItems(1);
    harness.createFocusRecord.mockRejectedValue(new Error('network down'));
    const { runPending } = await loadSyncService();

    await expect(runPending()).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 });
    expect(item.retryCount).toBe(1);
    for (let attempt = 2; attempt <= 5; attempt++) {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(item.retryCount).toBe(attempt);
    }

    expect(item.status).toBe('failed');
    expect(item.lastError).toBe('network down');
    expect(harness.createFocusRecord).toHaveBeenCalledTimes(5);
  });
});
