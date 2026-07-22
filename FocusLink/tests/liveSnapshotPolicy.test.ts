import { describe, expect, it } from 'vitest';
import { liveSnapshotVersion, shouldAcceptLiveSnapshot } from '../shared/sync/liveSnapshotPolicy';

describe('shared live snapshot compare-and-swap policy', () => {
  it('projects protocol responses into a stable version identity', () => {
    expect(
      liveSnapshotVersion({
        serverTime: 2_000,
        snapshot: { revision: 3, state: 'running', session: { id: 'session-3' } },
      }),
    ).toEqual({ revision: 3, state: 'running', sessionId: 'session-3', serverTime: 2_000 });
  });

  it('rejects revision rollback and equal-revision identity changes', () => {
    const current = { revision: 5, state: 'running' as const, sessionId: 'one', serverTime: 5_000 };
    expect(shouldAcceptLiveSnapshot(current, { ...current, revision: 4, serverTime: 6_000 })).toBe(
      false,
    );
    expect(
      shouldAcceptLiveSnapshot(current, { ...current, state: 'paused', serverTime: 6_000 }),
    ).toBe(false);
    expect(
      shouldAcceptLiveSnapshot(current, { ...current, sessionId: 'two', serverTime: 6_000 }),
    ).toBe(false);
  });
});
