import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FocusSession } from '@shared/types';
import type {
  DeviceSyncRequest,
  DeviceSyncResponse,
  DeviceSyncSessionBundle,
} from '@shared/sync/deviceProtocol';

const harness = vi.hoisted(() => ({
  meta: new Map<string, string>(),
  token: null as string | null,
  settings: {
    deviceSync: { enabled: true, endpoint: 'https://sync-a.example', autoSync: true },
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
  configureDeviceSync,
  getDeviceSyncStatus,
  runDeviceSync,
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

function readRequest(init: RequestInit | undefined): DeviceSyncRequest {
  return JSON.parse(String(init?.body)) as DeviceSyncRequest;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
      deviceSync: { enabled: true, endpoint: 'https://sync-a.example', autoSync: true },
    };
    harness.sessions = [finishedSession()];
    harness.inserted = [];
    vi.restoreAllMocks();
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
    expect(getDeviceSyncStatus().cursor).toBe('cursor-a');
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
    expect(getDeviceSyncStatus().cursor).toBe('fresh-cursor');
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
    expect(getDeviceSyncStatus()).toMatchObject({
      unresolvedConflicts: 1,
      lastError: expect.stringContaining('未解决'),
    });
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

    await expect(runDeviceSync()).rejects.toThrow('offline');
    expect(getDeviceSyncStatus()).toMatchObject({
      unresolvedConflicts: 1,
      lastError: expect.stringContaining('offline'),
    });
  });

  it('does not reuse an in-flight result after the configured connection changes', async () => {
    const deferred: {
      request?: DeviceSyncRequest;
      resolve?: (response: Response) => void;
    } = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            deferred.request = readRequest(init);
            deferred.resolve = resolve;
          }),
      ),
    );
    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-a.example',
      autoSync: true,
      accessToken: 'token-a-with-enough-entropy',
    });
    const runningA = runDeviceSync();

    configureDeviceSync({
      enabled: true,
      endpoint: 'https://sync-b.example',
      autoSync: true,
      accessToken: 'token-b-with-enough-entropy',
    });
    await expect(runDeviceSync()).rejects.toThrow('同步连接已变更');

    if (!deferred.request || !deferred.resolve) throw new Error('request A did not start');
    deferred.resolve(jsonResponse(successResponse(deferred.request, 'cursor-a')));
    await expect(runningA).resolves.toMatchObject({ cursor: 'cursor-a' });
  });
});
