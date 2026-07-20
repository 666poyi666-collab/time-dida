import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEVICE_SYNC_ENTITY,
  DEVICE_SYNC_MAX_BODY_BYTES,
  DEVICE_SYNC_PROTOCOL_VERSION,
  deviceSyncJsonByteLength,
  makeDeviceSyncOperationId,
  type DeviceSyncMutation,
  type DeviceSyncRequest,
  type DeviceSyncResponse,
  type DeviceSyncSessionBundle,
} from '@shared/sync/deviceProtocol';
import {
  DEVICE_SYNC_TEST_BODY_LIMIT_BYTES,
  createDeviceSyncCloudServer,
  createDeviceSyncCloudStore,
  type DeviceSyncCloudServer,
} from '../cloud';

const TOKEN_A = 'test-token-account-a';
const TOKEN_B = 'test-token-account-b';
const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';
const ALLOWED_ORIGIN = 'http://localhost:5174';

function makeBundle(sessionId: string, title = `Session ${sessionId}`): DeviceSyncSessionBundle {
  const startedAt = 1_720_000_000_000;
  const endedAt = startedAt + 30 * 60_000;
  return {
    session: {
      id: sessionId,
      title,
      status: 'finished',
      startedAt,
      endedAt,
      activeElapsedMs: 29 * 60_000,
      pauseElapsedMs: 60_000,
      wallElapsedMs: 30 * 60_000,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: null,
      createdAt: startedAt,
      updatedAt: endedAt,
    },
    segments: [
      {
        id: `${sessionId}-segment`,
        sessionId,
        taskId: null,
        taskSource: null,
        title: null,
        startedAt,
        endedAt: startedAt + 29 * 60_000,
        activeElapsedMs: 29 * 60_000,
        note: null,
        tomatodoSubject: null,
        createdAt: startedAt,
        updatedAt: endedAt,
      },
    ],
    pauses: [
      {
        id: `${sessionId}-pause`,
        sessionId,
        segmentId: `${sessionId}-segment`,
        pauseStartedAt: startedAt + 10 * 60_000,
        pauseEndedAt: startedAt + 11 * 60_000,
        durationMs: 60_000,
        reason: null,
        createdAt: startedAt + 10 * 60_000,
        updatedAt: startedAt + 11 * 60_000,
      },
    ],
  };
}

function putMutation(
  opId: string,
  entityId: string,
  baseRevision = 0,
  title?: string,
): DeviceSyncMutation {
  return {
    opId,
    entity: DEVICE_SYNC_ENTITY,
    entityId,
    kind: 'put',
    baseRevision,
    payload: makeBundle(entityId, title),
  };
}

function syncRequest(
  mutations: DeviceSyncMutation[] = [],
  cursor: string | null = null,
  pullLimit = 500,
): DeviceSyncRequest {
  return {
    protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
    deviceId: 'desktop-test-device',
    cursor,
    mutations,
    pullLimit,
  };
}

describe('device sync test cloud server', () => {
  let server: DeviceSyncCloudServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = createDeviceSyncCloudServer({
      tokenAccounts: new Map([
        [TOKEN_A, ACCOUNT_A],
        [TOKEN_B, ACCOUNT_B],
      ]),
      allowedOrigins: [ALLOWED_ORIGIN],
    });
    const address = await server.listen();
    baseUrl = address.url;
    expect(address.host).toBe('127.0.0.1');
  });

  afterEach(async () => {
    await server.close();
  });

  async function postSync(
    request: DeviceSyncRequest,
    token: string | null = TOKEN_A,
    origin?: string,
  ): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (origin) headers.Origin = origin;
    return fetch(`${baseUrl}/v1/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
  }

  it('exposes health, requires Bearer auth, and enforces an exact CORS allowlist', async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      ok: true,
      production: false,
      protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
    });

    const unauthenticated = await postSync(syncRequest(), null);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('www-authenticate')).toContain('Bearer');

    const wrongToken = await postSync(syncRequest(), 'wrong-token');
    expect(wrongToken.status).toBe(401);

    const deniedOrigin = await postSync(syncRequest(), TOKEN_A, 'https://not-allowed.example');
    expect(deniedOrigin.status).toBe(403);
    expect(deniedOrigin.headers.get('access-control-allow-origin')).toBeNull();

    const preflight = await fetch(`${baseUrl}/v1/sync`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);

    const allowed = await postSync(syncRequest(), TOKEN_A, ALLOWED_ORIGIN);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
  });

  it('rejects request bodies larger than 1 MiB', async () => {
    const response = await fetch(`${baseUrl}/v1/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN_A}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ padding: 'x'.repeat(DEVICE_SYNC_TEST_BODY_LIMIT_BYTES) }),
    });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'payload_too_large' },
    });
  });

  it('rejects client-supplied ownership or other unsupported request fields', async () => {
    const response = await postSync({
      ...syncRequest(),
      userId: 'attempted-client-owner',
    } as DeviceSyncRequest);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    });
  });

  it('deduplicates a repeated opId without adding another change', async () => {
    const mutation = putMutation('op-create-session-1', 'session-1');
    const firstResponse = await postSync(syncRequest([mutation]));
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as DeviceSyncResponse;
    expect(first.acks).toEqual([
      expect.objectContaining({ status: 'applied', revision: 1, errorCode: null }),
    ]);
    expect(first.changes.map((change) => change.changeSeq)).toEqual([1]);

    const repeatedResponse = await postSync(syncRequest([mutation], first.nextCursor));
    const repeated = (await repeatedResponse.json()) as DeviceSyncResponse;
    expect(repeated.acks).toEqual([
      expect.objectContaining({ status: 'duplicate', revision: 1, errorCode: null }),
    ]);
    expect(repeated.changes).toEqual([]);
    expect(server.store.inspectAccount(ACCOUNT_A)).toMatchObject({
      changeSeq: 1,
      entityCount: 1,
      operationCount: 1,
      changeCount: 1,
    });

    const reusedWithDifferentPayload = putMutation(
      mutation.opId,
      mutation.entityId,
      1,
      'Different payload',
    );
    const reusedResponse = await postSync(
      syncRequest([reusedWithDifferentPayload], first.nextCursor),
    );
    const reused = (await reusedResponse.json()) as DeviceSyncResponse;
    expect(reused.acks).toEqual([
      expect.objectContaining({ status: 'rejected', errorCode: 'op_id_reused' }),
    ]);
    expect(server.store.inspectAccount(ACCOUNT_A).changeCount).toBe(1);
  });

  it('returns the current revision on baseRevision conflicts and applies a rebased operation', async () => {
    const createdResponse = await postSync(
      syncRequest([putMutation('op-create-conflict-session', 'conflict-session')]),
    );
    const created = (await createdResponse.json()) as DeviceSyncResponse;

    const staleResponse = await postSync(
      syncRequest(
        [putMutation('op-stale-update', 'conflict-session', 0, 'Stale title')],
        created.nextCursor,
      ),
    );
    const stale = (await staleResponse.json()) as DeviceSyncResponse;
    expect(stale.acks).toEqual([
      expect.objectContaining({
        status: 'conflict',
        revision: 1,
        errorCode: 'revision_conflict',
      }),
    ]);
    expect(stale.changes).toEqual([]);
    expect(server.store.inspectAccount(ACCOUNT_A).changeSeq).toBe(1);

    const rebasedResponse = await postSync(
      syncRequest(
        [putMutation('op-rebased-update', 'conflict-session', 1, 'Rebased title')],
        created.nextCursor,
      ),
    );
    const rebased = (await rebasedResponse.json()) as DeviceSyncResponse;
    expect(rebased.acks).toEqual([
      expect.objectContaining({ status: 'applied', revision: 2, errorCode: null }),
    ]);
    expect(rebased.changes).toEqual([
      expect.objectContaining({ changeSeq: 2, revision: 2, entityId: 'conflict-session' }),
    ]);
    expect(rebased.changes[0]?.payload?.session.title).toBe('Rebased title');
  });

  it('allows a later revision to return to an earlier payload without reusing its opId', async () => {
    const entityId = 'rollback-session';
    const original = makeBundle(entityId, 'Original');
    const changed = makeBundle(entityId, 'Changed');
    const mutation = (
      bundle: DeviceSyncSessionBundle,
      baseRevision: number,
    ): DeviceSyncMutation => ({
      opId: makeDeviceSyncOperationId(entityId, 'put', baseRevision, bundle),
      entity: DEVICE_SYNC_ENTITY,
      entityId,
      kind: 'put',
      baseRevision,
      payload: bundle,
    });

    const first = (await (
      await postSync(syncRequest([mutation(original, 0)]))
    ).json()) as DeviceSyncResponse;
    const second = (await (
      await postSync(syncRequest([mutation(changed, 1)], first.nextCursor))
    ).json()) as DeviceSyncResponse;
    const third = (await (
      await postSync(syncRequest([mutation(original, 2)], second.nextCursor))
    ).json()) as DeviceSyncResponse;

    expect(third.acks[0]).toMatchObject({ status: 'applied', revision: 3 });
    expect(third.changes[0]?.payload?.session.title).toBe('Original');

    const freshReader = (await (
      await postSync(syncRequest([], null))
    ).json()) as DeviceSyncResponse;
    expect(freshReader.changes).toEqual([
      expect.objectContaining({ entityId, revision: 3, changeSeq: 3 }),
    ]);
    expect(freshReader.changes[0]?.payload?.session.title).toBe('Original');
  });

  it('uses account-scoped monotonic cursors for paginated pulls', async () => {
    const firstPageResponse = await postSync(
      syncRequest(
        [
          putMutation('op-page-1', 'page-session-1'),
          putMutation('op-page-2', 'page-session-2'),
          putMutation('op-page-3', 'page-session-3'),
        ],
        null,
        2,
      ),
    );
    const firstPage = (await firstPageResponse.json()) as DeviceSyncResponse;
    expect(firstPage.changes.map((change) => change.changeSeq)).toEqual([1, 2]);
    expect(firstPage.hasMore).toBe(true);

    const secondPageResponse = await postSync(syncRequest([], firstPage.nextCursor, 2));
    const secondPage = (await secondPageResponse.json()) as DeviceSyncResponse;
    expect(secondPage.changes.map((change) => change.changeSeq)).toEqual([3]);
    expect(secondPage.hasMore).toBe(false);

    const caughtUpResponse = await postSync(syncRequest([], secondPage.nextCursor, 2));
    const caughtUp = (await caughtUpResponse.json()) as DeviceSyncResponse;
    expect(caughtUp.changes).toEqual([]);
    expect(caughtUp.nextCursor).toBe(secondPage.nextCursor);

    const isolatedAccountResponse = await postSync(syncRequest(), TOKEN_B);
    const isolatedAccount = (await isolatedAccountResponse.json()) as DeviceSyncResponse;
    expect(isolatedAccount.changes).toEqual([]);

    const foreignCursor = await postSync(syncRequest([], secondPage.nextCursor), TOKEN_B);
    expect(foreignCursor.status).toBe(400);
    await expect(foreignCursor.json()).resolves.toMatchObject({
      error: { code: 'invalid_cursor' },
    });
  });
});

describe('device sync test cloud JSON persistence', () => {
  it('paginates large histories by response bytes, not only record count', () => {
    const store = createDeviceSyncCloudStore({ now: () => 100 });
    const mutations = Array.from({ length: 60 }, (_, index) => {
      const mutation = putMutation(`op-large-${index}`, `large-session-${index}`);
      if (mutation.payload) mutation.payload.session.note = '字'.repeat(20_000);
      return mutation;
    });

    let writerCursor: string | null = null;
    for (let index = 0; index < mutations.length; index += 20) {
      let page = store.sync(
        ACCOUNT_A,
        syncRequest(mutations.slice(index, index + 20), writerCursor),
      );
      writerCursor = page.nextCursor;
      while (page.hasMore) {
        page = store.sync(ACCOUNT_A, syncRequest([], writerCursor));
        writerCursor = page.nextCursor;
      }
    }

    let readerCursor: string | null = null;
    let pulled = 0;
    let pages = 0;
    do {
      const page = store.sync(ACCOUNT_A, syncRequest([], readerCursor));
      expect(deviceSyncJsonByteLength(page)).toBeLessThanOrEqual(DEVICE_SYNC_MAX_BODY_BYTES);
      pulled += page.changes.length;
      pages += 1;
      readerCursor = page.nextCursor;
      if (!page.hasMore) break;
    } while (pages < 10);

    expect(pages).toBeGreaterThan(1);
    expect(pulled).toBe(60);
  });

  it('reloads account revisions, operations, changes, and cursors', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focuslink-device-sync-cloud-'));
    const persistencePath = path.join(directory, 'store.json');
    try {
      const firstStore = createDeviceSyncCloudStore({ persistencePath, now: () => 100 });
      const mutation = putMutation('op-persisted', 'persisted-session');
      const first = firstStore.sync(ACCOUNT_A, syncRequest([mutation]));
      expect(first.changes).toHaveLength(1);

      const reloadedStore = createDeviceSyncCloudStore({ persistencePath, now: () => 200 });
      const pulled = reloadedStore.sync(ACCOUNT_A, syncRequest());
      expect(pulled.serverTime).toBe(200);
      expect(pulled.changes).toEqual([
        expect.objectContaining({ changeSeq: 1, entityId: 'persisted-session', revision: 1 }),
      ]);

      const duplicate = reloadedStore.sync(ACCOUNT_A, syncRequest([mutation], first.nextCursor));
      expect(duplicate.acks[0]).toMatchObject({ status: 'duplicate', revision: 1 });
      expect(reloadedStore.inspectAccount(ACCOUNT_A).changeCount).toBe(1);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps the executable cloud/server entry side-effect free when imported', async () => {
    const entry = await import('../cloud/server');
    expect(entry.createDeviceSyncCloudServer).toBeTypeOf('function');
    expect(entry.createDeviceSyncCloudStore).toBeTypeOf('function');
    expect(entry.startDeviceSyncTestBackend).toBeTypeOf('function');
  });
});
