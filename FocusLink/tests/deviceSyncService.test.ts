import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FocusSession, Project, Task } from '@shared/types';
import type {
  DeviceSyncRequest,
  DeviceSyncResponse,
  DeviceSyncSessionBundle,
} from '@shared/sync/deviceProtocol';
import {
  TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS,
  type TaskSnapshotPublishRequest,
} from '@shared/sync/taskSnapshotProtocol';
import { FOCUSLINK_CANONICAL_SYNC_ORIGIN } from '@shared/sync/identityProtocol';

const harness = vi.hoisted(() => ({
  meta: new Map<string, string>(),
  token: null as string | null,
  settings: {
    deviceSync: {
      enabled: true,
      endpoint: 'https://sync-a.example',
      autoSync: true,
      liveControlEnabled: false,
    },
  },
  sessions: [] as FocusSession[],
  inserted: [] as DeviceSyncSessionBundle[],
}));

vi.mock('../electron/db/index.js', () => ({
  getMeta: (key: string) => harness.meta.get(key) ?? null,
  setMeta: (key: string, value: string) => harness.meta.set(key, value),
  getSession: (id: string) => harness.sessions.find((session) => session.id === id) ?? null,
  insertDeviceSyncBundleIfMissing: (bundle: DeviceSyncSessionBundle) => {
    harness.inserted.push(bundle);
    harness.sessions.push(bundle.session);
  },
  listFinishedSessionsForDeviceSync: () => harness.sessions,
  listPauses: () => [],
  listSegments: () => [],
}));

vi.mock('../electron/settingsStore.js', () => ({
  getSettings: () => harness.settings,
  updateSettings: (patch: typeof harness.settings) => {
    harness.settings = {
      ...harness.settings,
      ...patch,
      deviceSync: { ...harness.settings.deviceSync, ...patch.deviceSync },
    };
  },
}));

vi.mock('../electron/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../electron/sync/deviceSyncCredentials.js', () => ({
  getDeviceSyncToken: () => harness.token,
  hasDeviceSyncToken: () => Boolean(harness.token),
  setDeviceSyncToken: (token: string | null) => {
    harness.token = token;
  },
}));

import {
  assertDeviceSyncConnectionCurrent,
  configureDeviceSync,
  flushPendingTaskSnapshotForContractTest,
  getDeviceSyncRuntimeConnection,
  invalidateDeviceSyncConnection,
  publishDeviceTaskSnapshot,
  runLegacyDeviceSyncForContractTest as runDeviceSync,
} from '../electron/sync/deviceSyncService';

function finishedSession(id = 'session-1'): FocusSession {
  return {
    id,
    title: '已结束会话',
    status: 'finished',
    startedAt: 1_720_000_000_000,
    endedAt: 1_720_000_001_000,
    activeElapsedMs: 1_000,
    pauseElapsedMs: 0,
    wallElapsedMs: 1_000,
    defaultTaskId: null,
    defaultTaskSource: null,
    defaultTaskTitle: null,
    note: null,
    createdAt: 1_720_000_000_000,
    updatedAt: 1_720_000_001_000,
  };
}

function bundleFromSession(session: FocusSession): DeviceSyncSessionBundle {
  return { session, segments: [], pauses: [] };
}

function pendingTask(id: string, title: string): Task {
  return {
    id,
    source: 'ticktick',
    externalId: id,
    projectId: null,
    title,
    status: 'pending',
    priority: null,
    dueDate: null,
    tags: [],
    content: null,
  };
}

function readRequest(init: RequestInit | undefined): DeviceSyncRequest {
  return JSON.parse(String(init?.body)) as DeviceSyncRequest;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function timestampTooFarAheadResponse(): Response {
  return jsonResponse(
    {
      error: {
        code: 'task_snapshot_timestamp_too_far_ahead',
        message: 'task snapshot publishedAt is too far in the future',
      },
    },
    422,
  );
}

function successResponse(
  request: DeviceSyncRequest,
  nextCursor: string,
  ackStatus: 'applied' | 'conflict' = 'applied',
): DeviceSyncResponse {
  return {
    protocolVersion: 1,
    acks: request.mutations.map((mutation) => ({
      opId: mutation.opId,
      entityId: mutation.entityId,
      status: ackStatus,
      revision: 1,
      errorCode: ackStatus === 'conflict' ? 'revision_conflict' : null,
    })),
    changes: [],
    nextCursor,
    hasMore: false,
    serverTime: Date.now(),
  };
}

describe('desktop device sync checkpoints', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    harness.meta.clear();
    harness.token = null;
    harness.settings = {
      deviceSync: {
        enabled: true,
        endpoint: 'https://sync-a.example',
        autoSync: true,
        liveControlEnabled: false,
      },
    };
    harness.sessions = [finishedSession()];
    harness.inserted = [];
    vi.restoreAllMocks();
  });

  it('durably retries the latest PC task snapshot during automatic sync', async () => {
    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-a.example',
      autoSync: true,
      liveControlEnabled: false,
      accessToken: `fl2_account1_desktop1_${'x'.repeat(32)}`,
    });
    const projects: Project[] = [
      {
        id: 'project-1',
        source: 'ticktick',
        externalId: 'project-1',
        name: '第一张清单',
        color: null,
      },
    ];
    const tasks: Task[] = [
      {
        id: 'task-1',
        source: 'ticktick',
        externalId: 'task-1',
        projectId: 'project-1',
        title: '复习化学',
        status: 'pending',
        priority: null,
        dueDate: null,
        tags: [],
        content: null,
      },
    ];
    let taskCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith('/sync/v2/tasks')) {
          taskCalls += 1;
          if (taskCalls === 1) throw new Error('offline');
          const body = JSON.parse(String(init?.body)) as TaskSnapshotPublishRequest;
          return jsonResponse({
            protocolVersion: 1,
            revision: 1,
            sourceDeviceId: body.deviceId,
            snapshot: body.snapshot,
            serverTime: Date.now(),
          });
        }
        const request = readRequest(init);
        return jsonResponse(successResponse(request, 'cursor-task-retry'));
      }),
    );

    await expect(publishDeviceTaskSnapshot(projects, tasks, Date.now())).resolves.toBe(false);
    expect([...harness.meta.keys()].some((key) => key.includes('pendingTaskSnapshot'))).toBe(true);
    await expect(runDeviceSync()).resolves.toMatchObject({ cursor: 'cursor-task-retry' });
    await expect(publishDeviceTaskSnapshot(projects, tasks, Date.now())).resolves.toBe(true);
    expect(taskCalls).toBe(2);
    expect(
      [...harness.meta.entries()].find(([key]) => key.includes('pendingTaskSnapshot'))?.[1],
    ).toBe('');
  });

  it('uses the fl2 credential-bound device id for live commands and task snapshots', async () => {
    const token = `fl2_account1_desktop1_${'x'.repeat(32)}`;
    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-a.example',
      autoSync: true,
      liveControlEnabled: true,
      accessToken: token,
    });

    expect(getDeviceSyncRuntimeConnection()).toMatchObject({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      accessToken: token,
      deviceId: 'device-desktop1',
    });

    let publishedDeviceId: string | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as TaskSnapshotPublishRequest;
        publishedDeviceId = body.deviceId;
        return jsonResponse({
          protocolVersion: 1,
          revision: 1,
          sourceDeviceId: body.deviceId,
          snapshot: body.snapshot,
          serverTime: Date.now(),
        });
      }),
    );

    await expect(publishDeviceTaskSnapshot([], [], Date.now())).resolves.toBe(true);
    expect(publishedDeviceId).toBe('device-desktop1');
  });

  it('pins every fl2 runtime connection to the canonical origin and invalidates old captures', () => {
    const token = `fl2_account1_desktop1_${'x'.repeat(32)}`;
    configureDeviceSync({
      enabled: true,
      endpoint: 'https://credential-capture.example',
      autoSync: true,
      liveControlEnabled: true,
      accessToken: token,
    });

    const captured = getDeviceSyncRuntimeConnection();
    expect(captured).toMatchObject({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      accessToken: token,
    });
    expect(() => assertDeviceSyncConnectionCurrent(captured!)).not.toThrow();

    invalidateDeviceSyncConnection();
    expect(() => assertDeviceSyncConnectionCurrent(captured!)).toThrow('旧响应已丢弃');
  });

  it('keeps a pending task snapshot when its response belongs to an invalidated connection', async () => {
    const token = `fl2_account1_desktop1_${'x'.repeat(32)}`;
    configureDeviceSync({
      enabled: true,
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      autoSync: true,
      liveControlEnabled: true,
      accessToken: token,
    });
    let request: TaskSnapshotPublishRequest | null = null;
    let resolveFetch: ((response: Response) => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        request = JSON.parse(String(init?.body)) as TaskSnapshotPublishRequest;
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }),
    );

    const publishing = publishDeviceTaskSnapshot([], [], Date.now());
    invalidateDeviceSyncConnection();
    expect(request).not.toBeNull();
    resolveFetch!(
      jsonResponse({
        protocolVersion: 1,
        revision: 1,
        sourceDeviceId: request!.deviceId,
        snapshot: request!.snapshot,
        serverTime: Date.now(),
      }),
    );

    await expect(publishing).resolves.toBe(false);
    expect(
      [...harness.meta.entries()].find(([key]) => key.includes('pendingTaskSnapshot'))?.[1],
    ).toBeTruthy();
  });

  it('never posts account A pending tasks while account B is current', async () => {
    const accountAToken = `fl2_account1_desktop1_${'a'.repeat(32)}`;
    const accountBToken = `fl2_account2_desktop2_${'b'.repeat(32)}`;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    configureDeviceSync({
      enabled: true,
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      autoSync: true,
      liveControlEnabled: false,
      accessToken: accountAToken,
    });

    await expect(
      publishDeviceTaskSnapshot([], [pendingTask('task-a', 'A 的私有任务')], Date.now()),
    ).resolves.toBe(false);
    const accountAPending = [...harness.meta.entries()].find(([key]) =>
      key.includes('pendingTaskSnapshot'),
    );
    expect(accountAPending?.[1]).toContain('A 的私有任务');

    fetchMock.mockClear();
    configureDeviceSync({
      enabled: true,
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      autoSync: true,
      liveControlEnabled: false,
      accessToken: accountBToken,
    });

    await expect(flushPendingTaskSnapshotForContractTest()).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.meta.get(accountAPending![0])).toBe(accountAPending![1]);
  });

  it('lets account B publish without overwriting or sending account A pending tasks', async () => {
    const accountAToken = `fl2_account1_desktop1_${'a'.repeat(32)}`;
    const accountBToken = `fl2_account2_desktop2_${'b'.repeat(32)}`;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    configureDeviceSync({
      enabled: true,
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      autoSync: true,
      liveControlEnabled: false,
      accessToken: accountAToken,
    });
    await expect(
      publishDeviceTaskSnapshot([], [pendingTask('task-a', 'A 的私有任务')], Date.now()),
    ).resolves.toBe(false);
    const accountAPending = [...harness.meta.entries()].find(([key]) =>
      key.includes('pendingTaskSnapshot'),
    );

    const published: TaskSnapshotPublishRequest[] = [];
    fetchMock.mockClear();
    fetchMock.mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as TaskSnapshotPublishRequest;
      published.push(body);
      return jsonResponse({
        protocolVersion: 1,
        revision: 1,
        sourceDeviceId: body.deviceId,
        snapshot: body.snapshot,
        serverTime: Date.now(),
      });
    });
    configureDeviceSync({
      enabled: true,
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      autoSync: true,
      liveControlEnabled: false,
      accessToken: accountBToken,
    });

    await expect(
      publishDeviceTaskSnapshot([], [pendingTask('task-b', 'B 的当前任务')], Date.now()),
    ).resolves.toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0]?.snapshot.tasks.map((task) => task.title)).toEqual(['B 的当前任务']);
    expect(harness.meta.get(accountAPending![0])).toBe(accountAPending![1]);
    expect(
      [...harness.meta.entries()].filter(
        ([key, value]) => key.includes('pendingTaskSnapshot') && value,
      ),
    ).toEqual([accountAPending]);
  });

  it('retries a canonical account pending snapshot after that account rotates its token', async () => {
    const firstToken = `fl2_account1_desktop1_${'a'.repeat(32)}`;
    const rotatedToken = `fl2_account1_desktop1_${'b'.repeat(32)}`;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    configureDeviceSync({
      enabled: true,
      endpoint: 'https://ignored-by-canonical.example',
      autoSync: true,
      liveControlEnabled: false,
      accessToken: firstToken,
    });
    await expect(
      publishDeviceTaskSnapshot([], [pendingTask('task-a', '换令牌后续传')], Date.now()),
    ).resolves.toBe(false);
    const pendingBeforeRotation = [...harness.meta.entries()].find(([key]) =>
      key.includes('pendingTaskSnapshot'),
    );

    let authorization: string | null = null;
    fetchMock.mockClear();
    fetchMock.mockImplementation(async (_input, init) => {
      authorization = (init?.headers as Record<string, string>).Authorization;
      const body = JSON.parse(String(init?.body)) as TaskSnapshotPublishRequest;
      return jsonResponse({
        protocolVersion: 1,
        revision: 1,
        sourceDeviceId: body.deviceId,
        snapshot: body.snapshot,
        serverTime: Date.now(),
      });
    });
    configureDeviceSync({
      enabled: true,
      endpoint: 'https://another-ignored-origin.example',
      autoSync: true,
      liveControlEnabled: false,
      accessToken: rotatedToken,
    });

    await expect(flushPendingTaskSnapshotForContractTest()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authorization).toBe(`Bearer ${rotatedToken}`);
    expect(harness.meta.get(pendingBeforeRotation![0])).toBe('');
    expect([...harness.meta.keys()].filter((key) => key.includes('pendingTaskSnapshot'))).toEqual([
      pendingBeforeRotation![0],
    ]);
  });

  it('discards an invalid pending snapshot only inside the current provider scope', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', fetchMock);
    configureDeviceSync({
      enabled: true,
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      autoSync: true,
      liveControlEnabled: false,
      accessToken: `fl2_account1_desktop1_${'a'.repeat(32)}`,
    });
    await expect(publishDeviceTaskSnapshot([], [], Date.now())).resolves.toBe(false);
    const accountAKey = [...harness.meta.keys()].find((key) =>
      key.includes('pendingTaskSnapshot'),
    )!;
    harness.meta.set(accountAKey, '{invalid-account-a');

    configureDeviceSync({
      enabled: true,
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      autoSync: true,
      liveControlEnabled: false,
      accessToken: `fl2_account2_desktop2_${'b'.repeat(32)}`,
    });
    await expect(publishDeviceTaskSnapshot([], [], Date.now())).resolves.toBe(false);
    const accountBKey = [...harness.meta.keys()].find(
      (key) => key.includes('pendingTaskSnapshot') && key !== accountAKey,
    )!;
    harness.meta.set(accountBKey, '{invalid-account-b');

    fetchMock.mockClear();
    await expect(flushPendingTaskSnapshotForContractTest()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(harness.meta.get(accountAKey)).toBe('{invalid-account-a');
    expect(harness.meta.get(accountBKey)).toBe('');
  });

  it('drops a superseded pending snapshot after the cloud rejects rollback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          {
            error: {
              code: 'stale_task_snapshot',
              message: 'task snapshot is older than the current cloud snapshot',
            },
          },
          409,
        ),
      ),
    );
    configureDeviceSync({
      enabled: true,
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      autoSync: true,
      liveControlEnabled: false,
      accessToken: `fl2_account1_desktop1_${'a'.repeat(32)}`,
    });

    await expect(
      publishDeviceTaskSnapshot([], [pendingTask('old-task', '旧电脑快照')], Date.now() - 60_000),
    ).resolves.toBe(true);
    expect(
      [...harness.meta.entries()].filter(
        ([key, value]) => key.includes('pendingTaskSnapshot') && value,
      ),
    ).toEqual([]);
  });

  it('retains a pending snapshot when the cloud reports an equal-time content conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        jsonResponse(
          {
            error: {
              code: 'task_snapshot_conflict',
              message: 'task snapshot timestamp is already bound to different content',
            },
          },
          409,
        ),
      ),
    );
    configureDeviceSync({
      enabled: true,
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      autoSync: true,
      liveControlEnabled: false,
      accessToken: `fl2_account1_desktop1_${'a'.repeat(32)}`,
    });

    await expect(
      publishDeviceTaskSnapshot([], [pendingTask('conflicted-task', '同时间冲突快照')], Date.now()),
    ).resolves.toBe(false);
    expect(
      [...harness.meta.entries()].filter(
        ([key, value]) => key.includes('pendingTaskSnapshot') && value,
      ),
    ).toHaveLength(1);
    expect(
      [...harness.meta.values()].find((value) => value.includes('同时间冲突快照')),
    ).toBeTruthy();
  });

  it('rebases a future pending snapshot once from trusted normal or legacy cloud time', async () => {
    const serverTime = 1_720_000_000_000;
    for (const [label, cloudPublishedAt, expectedPublishedAt] of [
      ['normal', serverTime - 1, serverTime],
      ['legacy-future', serverTime + TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS + 1, serverTime],
    ] as const) {
      harness.meta.clear();
      const posts: TaskSnapshotPublishRequest[] = [];
      let gets = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (_input, init) => {
          if (init?.method === 'GET') {
            gets += 1;
            return jsonResponse({
              protocolVersion: 1,
              revision: 3,
              sourceDeviceId: 'device-cloud',
              snapshot: { publishedAt: cloudPublishedAt, projects: [], tasks: [] },
              serverTime,
            });
          }
          const body = JSON.parse(String(init?.body)) as TaskSnapshotPublishRequest;
          posts.push(body);
          if (posts.length === 1) {
            return jsonResponse(
              {
                error: {
                  code: 'task_snapshot_timestamp_too_far_ahead',
                  message: 'task snapshot publishedAt is too far in the future',
                },
              },
              422,
            );
          }
          return jsonResponse({
            protocolVersion: 1,
            revision: 4,
            sourceDeviceId: body.deviceId,
            snapshot: body.snapshot,
            serverTime,
          });
        }),
      );
      configureDeviceSync({
        enabled: true,
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        autoSync: true,
        liveControlEnabled: false,
        accessToken: `fl2_account1_desktop1_${'a'.repeat(32)}`,
      });

      await expect(
        publishDeviceTaskSnapshot(
          [],
          [pendingTask(`future-${label}`, `未来时间 ${label}`)],
          serverTime + TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS + 60_000,
        ),
      ).resolves.toBe(true);
      expect(posts).toHaveLength(2);
      expect(gets).toBe(1);
      expect(posts[1]?.snapshot.publishedAt).toBe(expectedPublishedAt);
      expect(
        [...harness.meta.entries()].filter(
          ([key, value]) => key.includes('pendingTaskSnapshot') && value,
        ),
      ).toEqual([]);
    }
  });

  it('preserves the original pending snapshot when timestamp recovery GET, parse, or retry fails', async () => {
    const serverTime = 1_720_000_000_000;
    const failures: Array<{
      name: string;
      expectedPosts: number;
      response: (method: string | undefined, posts: number) => Response;
    }> = [
      {
        name: 'GET',
        expectedPosts: 1,
        response: (method) =>
          method === 'GET'
            ? jsonResponse({ error: { code: 'unavailable', message: 'offline' } }, 503)
            : timestampTooFarAheadResponse(),
      },
      {
        name: 'parse',
        expectedPosts: 1,
        response: (method) =>
          method === 'GET'
            ? jsonResponse({ protocolVersion: 1, invalid: true })
            : timestampTooFarAheadResponse(),
      },
      {
        name: 'retry-422',
        expectedPosts: 2,
        response: (method, posts) => {
          if (method === 'GET') {
            return jsonResponse({
              protocolVersion: 1,
              revision: 3,
              sourceDeviceId: 'device-cloud',
              snapshot: { publishedAt: serverTime - 1, projects: [], tasks: [] },
              serverTime,
            });
          }
          return posts === 1 ? timestampTooFarAheadResponse() : timestampTooFarAheadResponse();
        },
      },
    ];

    for (const failure of failures) {
      harness.meta.clear();
      let posts = 0;
      let gets = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (_input, init) => {
          if (init?.method === 'POST') posts += 1;
          if (init?.method === 'GET') gets += 1;
          return failure.response(init?.method, posts);
        }),
      );
      configureDeviceSync({
        enabled: true,
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        autoSync: true,
        liveControlEnabled: false,
        accessToken: `fl2_account1_desktop1_${'a'.repeat(32)}`,
      });

      await expect(
        publishDeviceTaskSnapshot(
          [],
          [pendingTask(`failure-${failure.name}`, `保留 ${failure.name}`)],
          serverTime + TASK_SNAPSHOT_MAX_FUTURE_SKEW_MS + 60_000,
        ),
      ).resolves.toBe(false);
      expect(posts).toBe(failure.expectedPosts);
      expect(gets).toBe(1);
      expect(
        [...harness.meta.entries()].find(
          ([key, value]) => key.includes('pendingTaskSnapshot') && value,
        )?.[1],
      ).toContain(`保留 ${failure.name}`);
    }
  });

  it('keeps cursor and revision checkpoints isolated by endpoint and token', async () => {
    const requests: Array<{ url: string; request: DeviceSyncRequest }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const request = readRequest(init);
        requests.push({ url, request });
        return jsonResponse(
          successResponse(request, url.includes('sync-a') ? 'cursor-a' : 'cursor-b'),
        );
      }),
    );

    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-a.example',
      autoSync: true,
      accessToken: 'token-a-with-enough-entropy',
    });
    await runDeviceSync();
    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-b.example',
      autoSync: true,
      accessToken: 'token-b-with-enough-entropy',
    });
    await runDeviceSync();

    expect(requests).toHaveLength(2);
    expect(requests[0]?.request.cursor).toBeNull();
    expect(requests[1]?.request.cursor).toBeNull();
    expect(requests[0]?.request.mutations[0]?.baseRevision).toBe(0);
    expect(requests[1]?.request.mutations[0]?.baseRevision).toBe(0);

    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-a.example',
      autoSync: true,
      accessToken: 'token-a-with-enough-entropy',
    });
    const persistedKeys = [...harness.meta.keys()].join('\n');
    expect(persistedKeys).not.toContain('token-a-with-enough-entropy');
    expect(persistedKeys).not.toContain('token-b-with-enough-entropy');
  });

  it('clears only the current checkpoint and retries once after invalid_cursor', async () => {
    const requests: DeviceSyncRequest[] = [];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const request = readRequest(init);
        requests.push(request);
        call += 1;
        if (call === 1) return jsonResponse(successResponse(request, 'stale-cursor'));
        if (call === 2) {
          return jsonResponse(
            { error: { code: 'invalid_cursor', message: 'cursor was reset' } },
            400,
          );
        }
        return jsonResponse(successResponse(request, 'fresh-cursor'));
      }),
    );

    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-a.example',
      autoSync: true,
      accessToken: 'token-a-with-enough-entropy',
    });
    await runDeviceSync();
    await runDeviceSync();

    expect(requests).toHaveLength(3);
    expect(requests[1]).toMatchObject({ cursor: 'stale-cursor', mutations: [] });
    expect(requests[2]?.cursor).toBeNull();
    expect(requests[2]?.mutations[0]?.baseRevision).toBe(0);
  });

  it('persists unresolved conflicts and stops resubmitting them as successful work', async () => {
    const requests: DeviceSyncRequest[] = [];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const request = readRequest(init);
        requests.push(request);
        call += 1;
        return jsonResponse(
          successResponse(request, call === 1 ? 'conflict-cursor' : 'caught-up', 'conflict'),
        );
      }),
    );

    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-a.example',
      autoSync: true,
      accessToken: 'token-a-with-enough-entropy',
    });
    const first = await runDeviceSync();
    const second = await runDeviceSync();

    expect(first.unresolvedConflicts).toBe(1);
    expect(second.unresolvedConflicts).toBe(1);
    expect(requests[0]?.mutations).toHaveLength(1);
    expect(requests[1]?.mutations).toEqual([]);
  });

  it('imports only the latest revision when one pull page contains entity history', async () => {
    harness.sessions = [];
    const firstSession = finishedSession('remote-session');
    const latestSession = {
      ...firstSession,
      title: '远端最新版本',
      updatedAt: firstSession.updatedAt + 1,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const request = readRequest(init);
        return jsonResponse({
          ...successResponse(request, 'latest-cursor'),
          changes: [
            {
              changeSeq: 1,
              deviceId: 'remote-device',
              entity: 'focus_session_bundle',
              entityId: firstSession.id,
              revision: 1,
              deleted: false,
              payload: bundleFromSession(firstSession),
            },
            {
              changeSeq: 2,
              deviceId: 'remote-device',
              entity: 'focus_session_bundle',
              entityId: firstSession.id,
              revision: 2,
              deleted: false,
              payload: bundleFromSession(latestSession),
            },
          ],
        });
      }),
    );

    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-a.example',
      autoSync: true,
      accessToken: 'token-a-with-enough-entropy',
    });
    const result = await runDeviceSync();

    expect(result).toMatchObject({ imported: 1, unresolvedConflicts: 0 });
    expect(harness.inserted).toHaveLength(1);
    expect(harness.inserted[0]?.session.title).toBe('远端最新版本');
  });

  it('buffers pull pages and imports only the latest remote revision', async () => {
    harness.sessions = [];
    const firstSession = finishedSession('paged-remote-session');
    const latestSession = {
      ...firstSession,
      title: '第二页最新版本',
      updatedAt: firstSession.updatedAt + 1,
    };
    let page = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const request = readRequest(init);
        page += 1;
        const session = page === 1 ? firstSession : latestSession;
        return jsonResponse({
          ...successResponse(request, page === 1 ? 'page-1' : 'page-2'),
          changes: [
            {
              changeSeq: page,
              deviceId: 'remote-device',
              entity: 'focus_session_bundle',
              entityId: session.id,
              revision: page,
              deleted: false,
              payload: bundleFromSession(session),
            },
          ],
          hasMore: page === 1,
        });
      }),
    );

    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-a.example',
      autoSync: true,
      accessToken: 'token-a-with-enough-entropy',
    });
    const result = await runDeviceSync();

    expect(result).toMatchObject({ imported: 1, unresolvedConflicts: 0 });
    expect(harness.inserted).toHaveLength(1);
    expect(harness.inserted[0]?.session.title).toBe('第二页最新版本');
  });

  it('persists an invalid local bundle conflict even when the network is offline', async () => {
    harness.sessions = [{ ...finishedSession(), endedAt: null }];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-a.example',
      autoSync: true,
      accessToken: 'token-a-with-enough-entropy',
    });

    await expect(runDeviceSync()).rejects.toThrow(
      '无法连接跨设备同步服务（https://sync-a.example/v1/sync）',
    );
    expect([...harness.meta.values()]).toContain('network_error');
    expect(JSON.stringify([...harness.meta.values()])).not.toContain('sync-a.example');
    expect(JSON.stringify([...harness.meta.values()])).not.toContain('无法连接跨设备同步服务');
  });
});
