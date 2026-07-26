import { describe, expect, it } from 'vitest';

import {
  canPhysicallyPurge,
  claimOutboxItems,
  mergeFocusMetadata,
  mergeTags,
  parseDeviceToken,
  shouldForceBootstrap,
  type FocusMetadataV2,
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
