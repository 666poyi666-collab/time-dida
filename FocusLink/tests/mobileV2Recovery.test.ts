import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FOCUSLINK_CANONICAL_SYNC_ORIGIN } from '../shared/sync/identityProtocol';
import type { SyncV2Mutation } from '../shared/sync/v2Protocol';
import {
  enqueueMobileV2Mutation,
  readMobileV2Bootstrap,
  readMobileV2Status,
  writeMobileV2Bootstrap,
} from '../src/mobile/v2Cache';
import { runMobileSyncV2, validateMobileSyncV2ExchangeRequest } from '../src/mobile/v2Sync';

const DATABASE_NAME = 'focuslink-mobile-preview';
const OLD_DEVICE_ID = 'device-olddev1';
const NEW_DEVICE_ID = 'device-newdev1';
const OLD_TOKEN = `fl2_account-old_olddev1_${'o'.repeat(32)}`;
const NEW_TOKEN = `fl2_account1_newdev1_${'x'.repeat(32)}`;

describe('mobile canonical Sync v2 recovery', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    await deleteDatabase();
  });

  it('pulls first after a credential rebind and never sends the previous device outbox', async () => {
    await writeMobileV2Bootstrap({
      key: 'syncV2.bootstrap',
      state: 'v2-active',
      bootstrapId: null,
      cursor: 'c9',
      boundDeviceId: OLD_DEVICE_ID,
      boundAccountId: 'account-old',
      syncEpoch: 'sync-epoch-1',
      cursorEpoch: 'cursor-epoch-1',
      accountGeneration: 1,
      updatedAt: 1,
    });
    const staleMutation: SyncV2Mutation = {
      opId: 'stale-device-operation',
      entityType: 'focus_metadata_v2',
      entityId: 'stale-session',
      kind: 'put',
      baseRevision: 0,
      baseFingerprint: null,
      payload: {
        sessionId: 'stale-session',
        title: '旧设备离线记录',
        note: null,
        subject: null,
        tags: [],
        taskAssociation: null,
        updatedAt: 1,
        updatedByDeviceId: OLD_DEVICE_ID,
      },
      deviceId: OLD_DEVICE_ID,
      accountGeneration: 1,
    };
    await enqueueMobileV2Mutation(staleMutation, 2);

    const exchangeBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const parsed = new URL(typeof url === 'string' ? url : url instanceof URL ? url : url.url);
        if (parsed.pathname === '/sync/v2/status') return json(status(0));
        if (parsed.pathname === '/sync/v2/exchange') {
          exchangeBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return json(page());
        }
        throw new Error(`unexpected legacy route ${parsed.pathname}`);
      }),
    );

    await runMobileSyncV2({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: NEW_TOKEN,
      deviceId: 'ignored-client-device-id',
    });

    expect(exchangeBodies).toHaveLength(2);
    expect(exchangeBodies[0]).toMatchObject({
      deviceId: NEW_DEVICE_ID,
      cursor: null,
      mutations: [],
    });
    expect(exchangeBodies.every((body) => JSON.stringify(body).includes(staleMutation.opId))).toBe(
      false,
    );
    expect(await readMobileV2Bootstrap()).toMatchObject({
      state: 'v2-active',
      boundDeviceId: NEW_DEVICE_ID,
      boundAccountId: 'account1',
      cursor: 'c0',
    });
    expect(await readMobileV2Status(NEW_DEVICE_ID)).toMatchObject({ pending: 0, rejected: 0 });
  });

  it('rejects an old account exchange inside the cache transaction after a new owner resets it', async () => {
    let resolveOldExchange!: (response: Response) => void;
    let oldExchangeStarted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const parsed = new URL(typeof url === 'string' ? url : url instanceof URL ? url : url.url);
        if (parsed.pathname === '/sync/v2/status') return Promise.resolve(json(status(0)));
        const authorization = new Headers(init?.headers).get('authorization') ?? '';
        if (authorization === `Bearer ${OLD_TOKEN}` && !oldExchangeStarted) {
          oldExchangeStarted = true;
          return new Promise<Response>((resolve) => {
            resolveOldExchange = resolve;
          });
        }
        return Promise.resolve(json(page()));
      }),
    );

    const oldRun = runMobileSyncV2({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: OLD_TOKEN,
      deviceId: 'ignored',
    }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(oldExchangeStarted).toBe(true));

    await runMobileSyncV2({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: NEW_TOKEN,
      deviceId: 'ignored',
    });
    expect(await readMobileV2Bootstrap()).toMatchObject({
      state: 'v2-active',
      boundAccountId: 'account1',
      boundDeviceId: NEW_DEVICE_ID,
      cursor: 'c0',
    });

    resolveOldExchange(json(page()));
    await expect(oldRun).resolves.toMatchObject({ name: 'AbortError' });
    expect(await readMobileV2Bootstrap()).toMatchObject({
      state: 'v2-active',
      boundAccountId: 'account1',
      boundDeviceId: NEW_DEVICE_ID,
      cursor: 'c0',
    });
  });

  it('rejects an ahead cursor without exchange or legacy fallback', async () => {
    await writeMobileV2Bootstrap({
      key: 'syncV2.bootstrap',
      state: 'v2-active',
      bootstrapId: null,
      cursor: 'c9',
      boundDeviceId: NEW_DEVICE_ID,
      boundAccountId: 'account1',
      syncEpoch: 'sync-epoch-1',
      cursorEpoch: 'cursor-epoch-1',
      accountGeneration: 1,
      updatedAt: 1,
    });
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const parsed = new URL(String(url));
        paths.push(parsed.pathname);
        return json(status(3));
      }),
    );
    await expect(
      runMobileSyncV2({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        token: NEW_TOKEN,
        deviceId: 'ignored',
      }),
    ).rejects.toMatchObject({ code: 'cursor_ahead' });
    expect(paths).toEqual(['/sync/v2/status']);
    expect(await readMobileV2Status(NEW_DEVICE_ID)).toMatchObject({
      lastErrorCode: 'cursor_ahead',
    });
  });

  it('redacts hostile transport errors and persists only a fixed error code', async () => {
    const secret = `${NEW_TOKEN} Authorization: Bearer ${NEW_TOKEN}`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(secret);
      }),
    );
    const error = await runMobileSyncV2({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: NEW_TOKEN,
      deviceId: 'ignored',
    }).catch((caught: unknown) => caught);
    expect(String(error)).not.toContain(NEW_TOKEN);
    expect(error).toMatchObject({ code: 'sync_failed' });
    expect(await readMobileV2Status(NEW_DEVICE_ID)).toMatchObject({
      lastErrorCode: 'sync_failed',
    });
  });

  it('reports invalid exchange requests using field names without values', async () => {
    const fields = validateMobileSyncV2ExchangeRequest(
      {
        protocolVersion: 2,
        deviceId: NEW_DEVICE_ID,
        cursor: null,
        mutations: [],
        pullLimit: 100,
        syncEpoch: 'sync-epoch-1',
        cursorEpoch: 'cursor-epoch-1',
        accountGeneration: 1,
        accessToken: NEW_TOKEN,
      },
      NEW_DEVICE_ID,
    );
    expect(fields).toEqual(['accessToken']);
    expect(JSON.stringify(fields)).not.toContain(NEW_TOKEN);
  });

  it('redacts an upstream invalid_exchange_request body and identifies contract drift', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === '/sync/v2/status') return json(status(0));
        return json(
          {
            error: {
              code: 'invalid_exchange_request',
              message: `hostile ${NEW_TOKEN}`,
            },
          },
          400,
        );
      }),
    );
    const error = await runMobileSyncV2({
      endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
      token: NEW_TOKEN,
      deviceId: 'ignored',
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: 'invalid_exchange_request',
      fields: ['server_contract_drift'],
    });
    expect(String(error)).not.toContain(NEW_TOKEN);
    expect(await readMobileV2Status(NEW_DEVICE_ID)).toMatchObject({
      lastErrorCode: 'invalid_exchange_request',
    });
  });
});

function status(changeSeq: number) {
  return {
    protocolVersion: 2,
    syncEpoch: 'sync-epoch-1',
    cursorEpoch: 'cursor-epoch-1',
    accountGeneration: 1,
    changeSeq,
    serverTime: 10,
  };
}

function page() {
  return {
    protocolVersion: 2,
    syncEpoch: 'sync-epoch-1',
    cursorEpoch: 'cursor-epoch-1',
    accountGeneration: 1,
    acks: [],
    changes: [],
    nextCursor: 'c0',
    hasMore: false,
    serverTime: 11,
  };
}

function json(value: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(value), {
    status: statusCode,
    headers: { 'content-type': 'application/json' },
  });
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
