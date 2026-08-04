import { describe, expect, it, vi } from 'vitest';

import {
  SYNC_V2_MAX_ENTITY_BYTES,
  SYNC_V2_MAX_RESPONSE_BYTES,
  SYNC_V2_PROTOCOL_VERSION,
  canPhysicallyPurge,
  claimOutboxItems,
  isEncryptedFocusGuardEnvelopeV1,
  isFocusGuardEntityType,
  isSyncV2ChangePayload,
  isSyncV2EntityType,
  mergeFocusMetadata,
  mergeTags,
  paginateSyncV2Response,
  parseDeviceToken,
  shouldForceBootstrap,
  type FocusMetadataV2,
  type SyncV2Ack,
  type SyncV2Change,
  type SyncV2OutboxItem,
} from '../shared/sync/v2Protocol';

const base: FocusMetadataV2 = {
  sessionId: 'session-1',
  title: '数学',
  note: 'base',
  subject: '数学',
  tags: [{ tagId: 'tag-math', name: '数学' }],
  taskAssociation: null,
  updatedAt: 1,
  updatedByDeviceId: 'desktop',
};

const epoch = { syncEpoch: 'sync-1', cursorEpoch: 'cursor-1', accountGeneration: 1 };

function change(changeSeq: number, noteBytes: number): SyncV2Change {
  return {
    changeSeq,
    entityType: 'focus_metadata_v2',
    entityId: `session-${changeSeq}`,
    revision: 1,
    fingerprint: 'a'.repeat(64),
    deleted: false,
    payload: {
      ...base,
      sessionId: `session-${changeSeq}`,
      note: 'x'.repeat(noteBytes),
    },
    sourceDeviceId: 'desktop',
  };
}

function pageBytes(
  page: {
    changes: SyncV2Change[];
    nextCursor: string;
    hasMore: boolean;
  },
  acks: SyncV2Ack[] = [],
): number {
  return new TextEncoder().encode(
    JSON.stringify({
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      ...epoch,
      acks,
      ...page,
      serverTime: 100,
    }),
  ).byteLength;
}

describe('Sync v2 merge policy', () => {
  it('merges independent scalar and tag changes without touching ledger data', () => {
    const result = mergeFocusMetadata(
      base,
      { ...base, title: '复数', updatedAt: 2, updatedByDeviceId: 'phone' },
      {
        ...base,
        tags: [...base.tags, { tagId: 'tag-key', name: '重点' }],
        updatedAt: 3,
        updatedByDeviceId: 'tablet',
      },
    );
    expect(result.status).toBe('merged');
    expect(result.value?.title).toBe('复数');
    expect(result.value?.tags.map((tag) => tag.tagId)).toEqual(['tag-math', 'tag-key']);
  });

  it('keeps divergent notes as an explicit conflict with a preview', () => {
    const result = mergeFocusMetadata(
      base,
      { ...base, note: 'local' },
      { ...base, note: 'remote' },
    );
    expect(result.status).toBe('conflict');
    expect(result.conflictFields).toContain('note');
    expect(result.notePreview).toContain('BASE');
  });

  it('detects delete versus explicit tag rename/re-add', () => {
    expect(mergeTags(base.tags, [], [{ tagId: 'tag-math', name: '高数' }])).toEqual({ ok: false });
  });
});

describe('Sync v2 operational policies', () => {
  it('recognizes every canonical entity type and validates opaque Focus Guard envelopes', () => {
    const envelope = {
      version: 1,
      algorithm: 'A256GCM',
      product: 'focus-guard',
      entityKind: 'rule',
      nonce: 'abcdefghijklmnop',
      ciphertext: 'A'.repeat(22),
      aadHash: 'a'.repeat(64),
      aadBaseRevision: 0,
      operation: 'put',
      createdAt: 1,
    };

    for (const [entityType, entityKind] of [
      ['focus_guard_rule_v1', 'rule'],
      ['focus_guard_state_v1', 'state'],
      ['focus_guard_completion_v1', 'completion'],
      ['focus_guard_config_v1', 'config'],
    ] as const) {
      expect(isSyncV2EntityType(entityType)).toBe(true);
      expect(isFocusGuardEntityType(entityType)).toBe(true);
      expect(isEncryptedFocusGuardEnvelopeV1({ ...envelope, entityKind }, entityType)).toBe(true);
    }
    expect(isSyncV2EntityType('future_entity_v1')).toBe(false);
    expect(isEncryptedFocusGuardEnvelopeV1(envelope, 'focus_guard_rule_v1')).toBe(true);
    expect(isSyncV2ChangePayload('focus_guard_rule_v1', false, envelope)).toBe(true);
    expect(
      isEncryptedFocusGuardEnvelopeV1({ ...envelope, entityKind: 'state' }, 'focus_guard_rule_v1'),
    ).toBe(false);
    expect(isEncryptedFocusGuardEnvelopeV1({ ...envelope, plaintext: {} })).toBe(false);
    expect(isSyncV2ChangePayload('focus_guard_rule_v1', true, null)).toBe(true);
    expect(isSyncV2ChangePayload('focus_guard_rule_v1', true, envelope)).toBe(false);
  });

  it('paginates opaque guard updates and tombstones without changing their cursor order', () => {
    const envelope = {
      version: 1 as const,
      algorithm: 'A256GCM' as const,
      product: 'focus-guard' as const,
      entityKind: 'config' as const,
      nonce: 'abcdefghijklmnop',
      ciphertext: 'x'.repeat(600_000),
      aadHash: 'b'.repeat(64),
      aadBaseRevision: 0,
      operation: 'put' as const,
      createdAt: 1,
    };
    const changes: SyncV2Change[] = [
      {
        changeSeq: 1,
        entityType: 'focus_guard_config_v1',
        entityId: 'guard-config:global',
        revision: 1,
        fingerprint: 'c'.repeat(64),
        deleted: false,
        payload: envelope,
        sourceDeviceId: 'desktop',
      },
      {
        changeSeq: 2,
        entityType: 'focus_guard_config_v1',
        entityId: 'guard-config:old',
        revision: 2,
        fingerprint: 'd'.repeat(64),
        deleted: true,
        payload: null,
        sourceDeviceId: 'desktop',
      },
    ];
    const first = paginateSyncV2Response(
      {
        protocolVersion: SYNC_V2_PROTOCOL_VERSION,
        ...epoch,
        acks: [],
        serverTime: 100,
      },
      changes,
      1,
      'c0',
      (item) => `c${item.changeSeq.toString(36)}`,
    );
    const second = paginateSyncV2Response(
      {
        protocolVersion: SYNC_V2_PROTOCOL_VERSION,
        ...epoch,
        acks: [],
        serverTime: 100,
      },
      changes.slice(1),
      1,
      first.nextCursor,
      (item) => `c${item.changeSeq.toString(36)}`,
    );

    expect(first).toMatchObject({ nextCursor: 'c1', hasMore: true });
    expect(first.changes[0]).toMatchObject({ deleted: false, payload: envelope });
    expect(second).toMatchObject({ nextCursor: 'c2', hasMore: false });
    expect(second.changes[0]).toMatchObject({ deleted: true, payload: null });
  });

  it('paginates by bytes without losing or duplicating the next page', () => {
    const available = [change(1, 600_000), change(2, 600_000)];
    const first = paginateSyncV2Response(
      {
        protocolVersion: SYNC_V2_PROTOCOL_VERSION,
        ...epoch,
        acks: [],
        serverTime: 100,
      },
      available,
      500,
      'c0',
      (change) => `c${change.changeSeq.toString(36)}`,
    );

    expect(first.changes.map((item) => item.changeSeq)).toEqual([1]);
    expect(first.nextCursor).toBe('c1');
    expect(first.hasMore).toBe(true);
    expect(pageBytes(first)).toBeLessThanOrEqual(SYNC_V2_MAX_RESPONSE_BYTES);

    const second = paginateSyncV2Response(
      {
        protocolVersion: SYNC_V2_PROTOCOL_VERSION,
        ...epoch,
        acks: [],
        serverTime: 100,
      },
      available.filter((item) => item.changeSeq > 1),
      500,
      first.nextCursor,
      (item) => `c${item.changeSeq.toString(36)}`,
    );
    expect(second.changes.map((item) => item.changeSeq)).toEqual([2]);
    expect(second.nextCursor).toBe('c2');
    expect(second.hasMore).toBe(false);
    expect(pageBytes(second)).toBeLessThanOrEqual(SYNC_V2_MAX_RESPONSE_BYTES);
    expect(SYNC_V2_MAX_ENTITY_BYTES).toBe(1024 * 1024);
  });

  it('fits one near-limit entity together with acknowledgements', () => {
    const acks: SyncV2Ack[] = Array.from({ length: 40 }, (_, index) => ({
      opId: `op-${index}-${'x'.repeat(80)}`,
      entityType: 'focus_metadata_v2',
      entityId: `session-${index}`,
      status: 'applied',
      revision: 1,
      fingerprint: 'b'.repeat(64),
      errorCode: null,
    }));
    const page = paginateSyncV2Response(
      {
        protocolVersion: SYNC_V2_PROTOCOL_VERSION,
        ...epoch,
        acks,
        serverTime: 100,
      },
      [change(1, 1_040_000)],
      500,
      'c0',
      (item) => `c${item.changeSeq.toString(36)}`,
    );
    expect(page.changes).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(pageBytes(page, acks)).toBeLessThanOrEqual(SYNC_V2_MAX_RESPONSE_BYTES);
  });

  it('checks at most logarithmically many serialized prefixes for 500 small changes', () => {
    const available = Array.from({ length: 500 }, (_, index) => change(index + 1, 1));
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      const page = paginateSyncV2Response(
        {
          protocolVersion: SYNC_V2_PROTOCOL_VERSION,
          ...epoch,
          acks: [],
          serverTime: 100,
        },
        available,
        500,
        'c0',
        (item) => `c${item.changeSeq.toString(36)}`,
      );
      expect(page.changes).toHaveLength(500);
      expect(page.hasMore).toBe(false);
      expect(stringify.mock.calls.length).toBeLessThanOrEqual(10);
    } finally {
      stringify.mockRestore();
    }
  });

  it('accounts for the extra byte in a terminal hasMore=false response', () => {
    const available = [change(1, 1)];
    const expected = {
      changes: available,
      nextCursor: 'c1',
      hasMore: false,
    };
    const exactBudget = pageBytes(expected);
    const exact = paginateSyncV2Response(
      {
        protocolVersion: SYNC_V2_PROTOCOL_VERSION,
        ...epoch,
        acks: [],
        serverTime: 100,
      },
      available,
      500,
      'c0',
      (item) => `c${item.changeSeq.toString(36)}`,
      exactBudget,
    );
    expect(pageBytes(exact)).toBe(exactBudget);
    expect(() =>
      paginateSyncV2Response(
        {
          protocolVersion: SYNC_V2_PROTOCOL_VERSION,
          ...epoch,
          acks: [],
          serverTime: 100,
        },
        available,
        500,
        'c0',
        (item) => `c${item.changeSeq.toString(36)}`,
        exactBudget - 1,
      ),
    ).toThrow(/exceeds/);
  });

  it('claims only ready records and recovers expired uploading leases', () => {
    const item = (
      state: SyncV2OutboxItem['state'],
      leaseExpiresAt: number | null,
    ): SyncV2OutboxItem => ({
      opId: `${state}-${leaseExpiresAt}`,
      entityType: 'focus_metadata_v2',
      entityId: 'session-1',
      kind: 'put',
      baseRevision: 0,
      baseFingerprint: null,
      payload: base,
      deviceId: 'phone',
      accountGeneration: 1,
      state,
      attemptCount: 0,
      nextRetryAt: 0,
      leaseId: state === 'uploading' ? 'old' : null,
      leaseExpiresAt,
      claimedAt: null,
      errorCode: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const claimed = claimOutboxItems(
      [item('pending', null), item('uploading', 99), item('uploading', 101)],
      100,
      'lease',
      10,
    );
    expect(claimed).toHaveLength(2);
    expect(claimed.every((record) => record.leaseId === 'lease')).toBe(true);
  });

  it('parses routed device credentials and rejects malformed tokens', () => {
    expect(parseDeviceToken(`fl2_account1_device1_${'x'.repeat(32)}`)?.devicePublicId).toBe(
      'device1',
    );
    expect(parseDeviceToken('owner-token')).toBeNull();
  });

  it('invalidates stale devices and changed generations', () => {
    const epoch = { syncEpoch: 's1', cursorEpoch: 'c1', accountGeneration: 1 };
    expect(shouldForceBootstrap(epoch, epoch, 0, 90 * 24 * 60 * 60 * 1000)).toBe(true);
    expect(shouldForceBootstrap(epoch, { ...epoch, accountGeneration: 2 }, 100, 101)).toBe(true);
  });

  it('purges only after retention, watermarks, conflict and backup gates', () => {
    expect(
      canPhysicallyPurge({
        now: 200,
        purgeAfter: 100,
        deleteChangeSeq: 5,
        activeDeviceWatermarks: [6, 10],
        hasConflict: false,
        backupAllowsPurge: true,
      }),
    ).toBe(true);
    expect(
      canPhysicallyPurge({
        now: 200,
        purgeAfter: 100,
        deleteChangeSeq: 5,
        activeDeviceWatermarks: [5],
        hasConflict: false,
        backupAllowsPurge: true,
      }),
    ).toBe(false);
  });
});
