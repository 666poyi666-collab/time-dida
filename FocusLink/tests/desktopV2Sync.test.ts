import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fingerprintDeviceSyncValue } from '../shared/sync/deviceProtocol';
import type { FocusSegment, FocusSession, PauseEvent } from '../shared/types';
import type { FocusLedgerV2, FocusMetadataV2 } from '../shared/sync/v2Protocol';

const harness = vi.hoisted(() => ({
  meta: new Map<string, string>(),
  connection: {
    endpoint: 'https://sync.example.test',
    accessToken: `fl2_account1_desktop1_${'x'.repeat(32)}`,
    deviceId: 'device-desktop1',
    scope: 'scope-1',
  },
  state: null as Record<string, unknown> | null,
  states: new Map<string, Record<string, unknown>>(),
  sessions: [] as FocusSession[],
  segments: new Map<string, FocusSegment[]>(),
  pauses: new Map<string, PauseEvent[]>(),
  deleted: [] as string[],
  discarded: [] as string[],
  enqueued: [] as Array<Record<string, unknown>>,
  remoteConflicts: [] as Array<Record<string, unknown>>,
  stored: [] as Array<Record<string, unknown>>,
  repairCalls: 0,
  paths: [] as string[],
  connectionCurrent: true,
}));

vi.mock('../electron/db/index.js', () => ({
  getDb: () => ({ transaction: (operation: () => unknown) => operation }),
  getMeta: (key: string) => harness.meta.get(key) ?? null,
  setMeta: (key: string, value: string) => harness.meta.set(key, value),
  getSession: () => null,
  deleteSession: (id: string) => harness.deleted.push(id),
  insertDeviceSyncBundleIfMissing: () => false,
  listFinishedSessionsForDeviceSync: () => harness.sessions,
  listPauses: (sessionId: string) => harness.pauses.get(sessionId) ?? [],
  listSegments: (sessionId: string) => harness.segments.get(sessionId) ?? [],
}));

vi.mock('../electron/sync/deviceSyncService.js', () => ({
  assertDeviceSyncConnectionCurrent: () => {
    if (!harness.connectionCurrent) throw new Error('stale connection');
  },
  getDeviceSyncDataConnection: () => harness.connection,
  isDeviceSyncConnectionCurrent: () => harness.connectionCurrent,
}));

vi.mock('../electron/sync/v2OutboxStore.js', () => ({
  migrateLegacyV2State: vi.fn(),
  claimV2Outbox: vi.fn(() => ({ leaseId: 'lease', items: [] })),
  discardPendingV2MutationsForEntity: vi.fn((_scope: string, entityId: string) => {
    harness.discarded.push(entityId);
    return 0;
  }),
  enqueueV2Mutation: vi.fn((_scope: string, value: Record<string, unknown>) => {
    harness.enqueued.push(value);
  }),
  hasOpenV2Conflict: vi.fn(() => false),
  hasPendingV2Mutation: vi.fn(() => null),
  listV2EntityStates: vi.fn(() => []),
  readDesktopV2Status: vi.fn(() => ({ pending: 0, conflicts: 0, rejected: 0 })),
  readV2EntityState: vi.fn((_scope: string, entityType: string, entityId: string) => {
    return harness.states.get(`${entityType}:${entityId}`) ?? harness.state;
  }),
  recordRemoteV2History: vi.fn(),
  repairSyntheticCorrectionConflicts: vi.fn(() => {
    harness.repairCalls += 1;
    return 0;
  }),
  requeueStaleGenerationV2Outbox: vi.fn(),
  retryV2Lease: vi.fn(),
  settleV2Ack: vi.fn(() => true),
  writeRemoteV2Conflict: vi.fn(
    (_scope: string, change: Record<string, unknown>, ...rest: unknown[]) => {
      harness.remoteConflicts.push({ change, rest });
    },
  ),
  writeV2EntityState: vi.fn((_scope: string, value: Record<string, unknown>) => {
    harness.stored.push(value);
  }),
}));

import {
  deleteDesktopSessionWithV2Tombstone,
  runDesktopSyncV2,
} from '../electron/sync/deviceSyncV2Service';

describe('desktop canonical Sync v2 boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    harness.meta.clear();
    harness.state = null;
    harness.states.clear();
    harness.sessions = [];
    harness.segments.clear();
    harness.pauses.clear();
    harness.deleted = [];
    harness.discarded = [];
    harness.enqueued = [];
    harness.remoteConflicts = [];
    harness.stored = [];
    harness.repairCalls = 0;
    harness.paths = [];
    harness.connectionCurrent = true;
  });

  it('uses only canonical v2 status/exchange routes and never falls back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        harness.paths.push(path);
        if (path === '/sync/v2/status') return json(status(0));
        return json(page('c0'));
      }),
    );
    await expect(runDesktopSyncV2()).resolves.toMatchObject({ cursor: 'c0' });
    expect(harness.paths).toEqual(['/sync/v2/status', '/sync/v2/exchange', '/sync/v2/exchange']);
    expect(harness.paths.some((path) => path.includes('/v1/') || path.includes('/sync/push'))).toBe(
      false,
    );
  });

  it('records a fixed authentication failure and never includes the device credential', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'invalid_token' } }, 401)),
    );
    const error = await runDesktopSyncV2().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'authentication_failed' });
    expect(String(error)).not.toContain(harness.connection.accessToken);
    expect(harness.meta.get('deviceSync.lastErrorV2.scope-1')).toBe('authentication_failed');
  });

  it('discards a page that returns after the captured connection is invalidated', async () => {
    let resolveExchange: ((response: Response) => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === '/sync/v2/status') return json(status(0));
        return new Promise<Response>((resolve) => {
          resolveExchange = resolve;
        });
      }),
    );

    const syncing = runDesktopSyncV2();
    await vi.waitFor(() => expect(resolveExchange).not.toBeNull());
    harness.connectionCurrent = false;
    resolveExchange!(json(page('c9')));

    await expect(syncing).rejects.toMatchObject({ code: 'sync_failed' });
    const checkpoint = JSON.parse(
      harness.meta.get('syncV2.desktop.checkpointV2.scope-1') ?? '{}',
    ) as Record<string, unknown>;
    expect(checkpoint).toMatchObject({ state: 'uninitialized', cursor: null });
    expect(harness.meta.has('deviceSync.lastErrorV2.scope-1')).toBe(false);
    expect(harness.remoteConflicts).toEqual([]);
  });

  it('stores a same-revision different-fingerprint response as a conflict', async () => {
    const payload: FocusMetadataV2 = {
      sessionId: 'session-1',
      title: '本机版本',
      note: null,
      subject: null,
      tags: [],
      taskAssociation: null,
      updatedAt: 1,
      updatedByDeviceId: 'device-desktop1',
    };
    harness.state = {
      entityType: 'focus_metadata_v2',
      entityId: 'session-1',
      confirmedRevision: 7,
      confirmedFingerprint: fingerprintDeviceSyncValue(payload),
      baseSnapshot: payload,
      deleted: false,
      changeSeq: 7,
      sourceDeviceId: 'device-desktop1',
      syncEpoch: 'sync-1',
      cursorEpoch: 'cursor-1',
      accountGeneration: 1,
      updatedAt: 1,
    };
    harness.meta.set(
      'syncV2.desktop.checkpointV2.scope-1',
      JSON.stringify({
        version: 2,
        state: 'v2-active',
        cursor: 'c7',
        boundDeviceId: 'device-desktop1',
        syncEpoch: 'sync-1',
        cursorEpoch: 'cursor-1',
        accountGeneration: 1,
        lastChangeSeq: 7,
        updatedAt: 1,
      }),
    );
    const remote = { ...payload, title: '平板版本', updatedByDeviceId: 'device-tablet1' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === '/sync/v2/status') return json(status(8));
        return json({
          ...page('c8'),
          changes: [
            {
              changeSeq: 8,
              entityType: 'focus_metadata_v2',
              entityId: 'session-1',
              revision: 7,
              fingerprint: fingerprintDeviceSyncValue(remote),
              deleted: false,
              payload: remote,
              sourceDeviceId: 'device-tablet1',
            },
          ],
        });
      }),
    );

    await expect(runDesktopSyncV2()).resolves.toMatchObject({ conflicts: 1, cursor: 'c8' });
    expect(harness.remoteConflicts).toHaveLength(1);
    const recorded = harness.remoteConflicts[0] as { rest: unknown[] };
    expect(recorded.rest[recorded.rest.length - 1]).toEqual(['same_revision_fingerprint_mismatch']);
  });

  it('isolates an opaque Focus Guard entity without rejecting the mixed-version page', async () => {
    const envelope = focusGuardEnvelope('rule');
    let exchanges = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === '/sync/v2/status') return json(status(1));
        exchanges += 1;
        return json(
          exchanges === 1
            ? {
                ...page('c1'),
                changes: [
                  {
                    changeSeq: 1,
                    entityType: 'focus_guard_rule_v1',
                    entityId: 'rule-study-hours',
                    revision: 1,
                    fingerprint: fingerprintDeviceSyncValue({ deleted: false, payload: envelope }),
                    deleted: false,
                    payload: envelope,
                    sourceDeviceId: 'device-phone1',
                  },
                ],
              }
            : page('c1'),
        );
      }),
    );

    await expect(runDesktopSyncV2()).resolves.toMatchObject({ pulled: 1, cursor: 'c1' });
    expect(harness.stored).toContainEqual(
      expect.objectContaining({
        entityType: 'focus_guard_rule_v1',
        entityId: 'rule-study-hours',
        payload: envelope,
      }),
    );
    expect(harness.remoteConflicts).toEqual([]);
  });

  it('rejects a malformed Focus Guard envelope before advancing the cursor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === '/sync/v2/status') return json(status(1));
        return json({
          ...page('c1'),
          changes: [
            {
              changeSeq: 1,
              entityType: 'focus_guard_rule_v1',
              entityId: 'rule-invalid',
              revision: 1,
              fingerprint: 'a'.repeat(64),
              deleted: false,
              payload: { ...focusGuardEnvelope('rule'), plaintext: { leaked: true } },
              sourceDeviceId: 'device-phone1',
            },
          ],
        });
      }),
    );

    await expect(runDesktopSyncV2()).rejects.toMatchObject({ code: 'contract_error' });
    expect(harness.stored).toEqual([]);
    expect(
      JSON.parse(harness.meta.get('syncV2.desktop.checkpointV2.scope-1') ?? '{}'),
    ).toMatchObject({ state: 'uninitialized', cursor: null, lastChangeSeq: 0 });
  });

  it('writes paired tombstones before removing a locally confirmed session', () => {
    harness.state = {
      entityType: 'focus_metadata_v2',
      entityId: 'session-delete',
      confirmedRevision: 4,
      confirmedFingerprint: 'a'.repeat(64),
      baseSnapshot: {},
      deleted: false,
      changeSeq: 4,
      sourceDeviceId: 'device-desktop1',
      syncEpoch: 'sync-1',
      cursorEpoch: 'cursor-1',
      accountGeneration: 1,
      updatedAt: 1,
    };
    deleteDesktopSessionWithV2Tombstone('session-delete');
    expect(harness.enqueued).toHaveLength(2);
    expect(harness.enqueued.every((mutation) => mutation.kind === 'delete')).toBe(true);
    expect(harness.discarded).toEqual(['session-delete']);
    expect(harness.deleted).toEqual(['session-delete']);
  });

  it('uses one stable correction and stops enqueueing it after cloud confirmation', async () => {
    const session: FocusSession = {
      id: 'session-correction',
      title: '化学',
      status: 'finished',
      startedAt: 1_000,
      endedAt: 31_000,
      activeElapsedMs: 25_000,
      pauseElapsedMs: 5_000,
      wallElapsedMs: 30_000,
      defaultTaskId: 'task-chemistry',
      defaultTaskSource: 'local',
      defaultTaskTitle: '化学',
      note: null,
      createdAt: 1_000,
      updatedAt: 31_000,
    };
    const segment: FocusSegment = {
      id: 'segment-correction',
      sessionId: session.id,
      taskId: 'task-chemistry',
      taskSource: 'local',
      title: '化学',
      startedAt: 1_000,
      endedAt: 31_000,
      activeElapsedMs: 25_000,
      note: null,
      cloudFocusId: null,
      tomatodoSubject: null,
      createdAt: 1_000,
      updatedAt: 31_000,
    };
    const pause: PauseEvent = {
      id: 'pause-correction',
      sessionId: session.id,
      segmentId: segment.id,
      pauseStartedAt: 11_000,
      pauseEndedAt: 16_000,
      durationMs: 5_000,
      reason: null,
      createdAt: 11_000,
      updatedAt: 16_000,
    };
    const priorLedger: FocusLedgerV2 = {
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt: 31_000,
      status: 'finished',
      activeElapsedMs: 20_000,
      pausedElapsedMs: 10_000,
      wallElapsedMs: session.wallElapsedMs,
      originDeviceId: 'device-desktop1',
      segments: [segment],
      pauses: [pause],
    };
    harness.sessions = [session];
    harness.segments.set(session.id, [segment]);
    harness.pauses.set(session.id, [pause]);
    harness.states.set(`focus_ledger_v2:${session.id}`, {
      entityType: 'focus_ledger_v2',
      entityId: session.id,
      confirmedRevision: 7,
      confirmedFingerprint: fingerprintDeviceSyncValue({ deleted: false, payload: priorLedger }),
      baseSnapshot: priorLedger,
      deleted: false,
      changeSeq: 7,
      sourceDeviceId: 'device-phone',
      syncEpoch: 'sync-1',
      cursorEpoch: 'cursor-1',
      accountGeneration: 1,
      updatedAt: 31_000,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        return path === '/sync/v2/status' ? json(status(7)) : json(page('c7'));
      }),
    );

    await runDesktopSyncV2();
    const firstCorrections = harness.enqueued.filter(
      (mutation) => mutation.entityType === 'focus_ledger_correction_v2',
    );
    expect(firstCorrections).toHaveLength(1);
    expect(firstCorrections[0]).toMatchObject({
      baseRevision: 0,
      baseFingerprint: null,
      payload: { createdAt: session.endedAt, baseLedgerRevision: 7 },
    });
    const correctionId = firstCorrections[0]!.entityId as string;
    harness.states.set(`focus_ledger_correction_v2:${correctionId}`, {
      entityType: 'focus_ledger_correction_v2',
      entityId: correctionId,
      confirmedRevision: 1,
      confirmedFingerprint: 'c'.repeat(64),
      baseSnapshot: firstCorrections[0]!.payload,
      deleted: false,
      changeSeq: 8,
      sourceDeviceId: 'device-desktop1',
      syncEpoch: 'sync-1',
      cursorEpoch: 'cursor-1',
      accountGeneration: 1,
      updatedAt: 31_000,
    });

    await runDesktopSyncV2();
    expect(
      harness.enqueued.filter((mutation) => mutation.entityType === 'focus_ledger_correction_v2'),
    ).toEqual(firstCorrections);
    expect(harness.repairCalls).toBe(2);
  });
});

function status(changeSeq: number) {
  return {
    protocolVersion: 2,
    syncEpoch: 'sync-1',
    cursorEpoch: 'cursor-1',
    accountGeneration: 1,
    changeSeq,
    serverTime: 10,
  };
}

function page(nextCursor: string) {
  return {
    protocolVersion: 2,
    syncEpoch: 'sync-1',
    cursorEpoch: 'cursor-1',
    accountGeneration: 1,
    acks: [],
    changes: [],
    nextCursor,
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

function focusGuardEnvelope(entityKind: 'rule' | 'state' | 'completion' | 'config') {
  return {
    version: 1,
    algorithm: 'A256GCM',
    product: 'focus-guard',
    entityKind,
    nonce: 'abcdefghijklmnop',
    ciphertext: 'abcdefghijklmnop',
    aadHash: 'a'.repeat(64),
    aadBaseRevision: 0,
    operation: 'put',
    createdAt: 1,
  };
}
