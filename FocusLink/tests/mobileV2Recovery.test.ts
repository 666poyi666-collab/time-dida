import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FOCUSLINK_CANONICAL_SYNC_ORIGIN } from '../shared/sync/identityProtocol';
import type { SyncV2Mutation } from '../shared/sync/v2Protocol';
import {
  claimMobileV2Outbox,
  enqueueMobileV2Mutation,
  readMobileV2Bootstrap,
  readMobileV2EntityState,
  readMobileV2Status,
  retryMobileV2Lease,
  writeMobileV2Bootstrap,
  writeMobileV2SyncSuccess,
  type MobileV2BootstrapCheckpoint,
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
    const oldOwner = {
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
    } as const;
    await writeMobileV2Bootstrap(oldOwner);
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
    await enqueueMobileV2Mutation(staleMutation, oldOwner, 2);

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

    const guardFields = validateMobileSyncV2ExchangeRequest(
      {
        protocolVersion: 2,
        deviceId: NEW_DEVICE_ID,
        cursor: null,
        mutations: [
          {
            opId: 'guard-invalid',
            entityType: 'focus_guard_rule_v1',
            entityId: 'guard-rule:study',
            kind: 'put',
            baseRevision: 0,
            baseFingerprint: null,
            payload: { plaintext: { leaked: true } },
            deviceId: NEW_DEVICE_ID,
            accountGeneration: 1,
          },
        ],
        pullLimit: 100,
        syncEpoch: 'sync-epoch-1',
        cursorEpoch: 'cursor-epoch-1',
        accountGeneration: 1,
      },
      NEW_DEVICE_ID,
    );
    expect(guardFields).toEqual(['mutations[0].payload']);
  });

  it('persists opaque Focus Guard changes while continuing the mixed-version feed', async () => {
    const envelope = focusGuardEnvelope('config');
    let exchanges = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === '/sync/v2/status') return json(status(1));
        exchanges += 1;
        return json(
          exchanges === 1
            ? {
                ...page(),
                changes: [
                  {
                    changeSeq: 1,
                    entityType: 'focus_guard_config_v1',
                    entityId: 'guard-config-global',
                    revision: 1,
                    fingerprint: 'a'.repeat(64),
                    deleted: false,
                    payload: envelope,
                    sourceDeviceId: 'device-desktop1',
                  },
                ],
                nextCursor: 'c1',
              }
            : { ...page(), nextCursor: 'c1' },
        );
      }),
    );

    await expect(
      runMobileSyncV2({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        token: NEW_TOKEN,
        deviceId: 'ignored',
      }),
    ).resolves.toMatchObject({ downloaded: 1, cursor: 'c1' });
    await expect(
      readMobileV2EntityState('focus_guard_config_v1', 'guard-config-global'),
    ).resolves.toMatchObject({ confirmedRevision: 1, baseSnapshot: envelope });
  });

  it('rejects malformed encrypted guard data without committing its cursor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === '/sync/v2/status') return json(status(1));
        return json({
          ...page(),
          changes: [
            {
              changeSeq: 1,
              entityType: 'focus_guard_config_v1',
              entityId: 'guard-config-invalid',
              revision: 1,
              fingerprint: 'a'.repeat(64),
              deleted: false,
              payload: { ...focusGuardEnvelope('config'), plaintext: { leaked: true } },
              sourceDeviceId: 'device-desktop1',
            },
          ],
          nextCursor: 'c1',
        });
      }),
    );

    await expect(
      runMobileSyncV2({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        token: NEW_TOKEN,
        deviceId: 'ignored',
      }),
    ).rejects.toMatchObject({ code: 'contract_error' });
    expect(await readMobileV2Bootstrap()).toMatchObject({ cursor: null });
    expect(
      await readMobileV2EntityState('focus_guard_config_v1', 'guard-config-invalid'),
    ).toBeNull();
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

  it.each([
    ['conflict', 'conflicts', 'conflict_present', { conflicts: 1, rejected: 0 }],
    ['rejected', 'rejected', 'rejected_operation', { conflicts: 0, rejected: 1 }],
  ] as const)(
    'keeps a %s acknowledgement durable and records its partial-sync code',
    async (ackStatus, resultKey, expectedErrorCode, expectedStatus) => {
      const checkpoint = activeCheckpoint();
      const mutation = partialMutation(ackStatus);
      await writeMobileV2Bootstrap(checkpoint);
      await writeMobileV2SyncSuccess(NEW_DEVICE_ID, 123);
      await enqueueMobileV2Mutation(mutation, checkpoint, 1);

      let exchanges = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          const parsed = new URL(String(url));
          if (parsed.pathname === '/sync/v2/status') return json(status(0));
          exchanges += 1;
          return json(
            exchanges === 1
              ? {
                  ...page(),
                  acks: [
                    {
                      opId: mutation.opId,
                      entityType: mutation.entityType,
                      entityId: mutation.entityId,
                      status: ackStatus,
                      revision: null,
                      fingerprint: null,
                      errorCode: `server_${ackStatus}`,
                    },
                  ],
                }
              : page(),
          );
        }),
      );

      await expect(
        runMobileSyncV2({
          endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
          token: NEW_TOKEN,
          deviceId: 'ignored',
        }),
      ).resolves.toMatchObject({ [resultKey]: 1 });

      expect(await readMobileV2Status(NEW_DEVICE_ID)).toMatchObject({
        ...expectedStatus,
        lastVerifiedAt: 123,
        lastErrorCode: expectedErrorCode,
      });
    },
  );

  it('keeps a deferred retry visible and durable after a later empty sync round', async () => {
    const checkpoint = activeCheckpoint();
    await writeMobileV2Bootstrap(checkpoint);
    await writeMobileV2SyncSuccess(NEW_DEVICE_ID, 123);
    await enqueueMobileV2Mutation(partialMutation('conflict'), checkpoint, 1);
    const claimed = await claimMobileV2Outbox(checkpoint, 1);
    expect(claimed.items).toHaveLength(1);
    await retryMobileV2Lease(claimed.leaseId, 'network_error', Date.now() + 60_000);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const parsed = new URL(String(url));
        if (parsed.pathname === '/sync/v2/status') return json(status(0));
        return json(page());
      }),
    );

    await expect(
      runMobileSyncV2({
        endpoint: FOCUSLINK_CANONICAL_SYNC_ORIGIN,
        token: NEW_TOKEN,
        deviceId: 'ignored',
      }),
    ).resolves.toMatchObject({ pending: 1, conflicts: 0, rejected: 0 });
    expect(await readMobileV2Status(NEW_DEVICE_ID)).toMatchObject({
      pending: 1,
      lastVerifiedAt: 123,
      lastErrorCode: 'sync_failed',
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

function activeCheckpoint(): MobileV2BootstrapCheckpoint {
  return {
    key: 'syncV2.bootstrap',
    state: 'v2-active',
    bootstrapId: null,
    cursor: 'c0',
    boundDeviceId: NEW_DEVICE_ID,
    boundAccountId: 'account1',
    syncEpoch: 'sync-epoch-1',
    cursorEpoch: 'cursor-epoch-1',
    accountGeneration: 1,
    updatedAt: 1,
  };
}

function partialMutation(status: 'conflict' | 'rejected'): SyncV2Mutation {
  const entityId = `partial-${status}-session`;
  return {
    opId: `partial-${status}-operation`,
    entityType: 'focus_metadata_v2',
    entityId,
    kind: 'put',
    baseRevision: 0,
    baseFingerprint: null,
    payload: {
      sessionId: entityId,
      title: '待处理离线专注',
      note: null,
      subject: null,
      tags: [],
      taskAssociation: null,
      updatedAt: 1,
      updatedByDeviceId: NEW_DEVICE_ID,
    },
    deviceId: NEW_DEVICE_ID,
    accountGeneration: 1,
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

function focusGuardEnvelope(entityKind: 'rule' | 'state' | 'completion' | 'config') {
  return {
    version: 1,
    algorithm: 'A256GCM',
    product: 'focus-guard',
    entityKind,
    nonce: 'abcdefghijklmnop',
    ciphertext: 'A'.repeat(22),
    aadHash: 'a'.repeat(64),
    aadBaseRevision: 0,
    operation: 'put',
    createdAt: 1,
  };
}
