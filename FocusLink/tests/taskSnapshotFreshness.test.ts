import { describe, expect, it } from 'vitest';
import {
  parseTaskSnapshotResponse,
  reconcileTaskSnapshot,
  type TaskSnapshotResponse,
} from '@shared/sync/taskSnapshotProtocol';

function snapshot(revision: number, taskId = `task-${revision}`, serverTime = revision * 1_000) {
  return {
    protocolVersion: 1,
    revision,
    sourceDeviceId: 'device-desktop',
    snapshot: {
      publishedAt: serverTime - 100,
      projects: [],
      tasks: [
        {
          id: taskId,
          source: 'ticktick',
          projectId: null,
          title: 'redacted-test-task',
          status: 'pending',
          priority: null,
          dueDate: null,
          tags: [],
          parentId: null,
          isCompleted: false,
          updatedAt: null,
        },
      ],
    },
    serverTime,
  } satisfies TaskSnapshotResponse;
}

describe('task snapshot freshness contract', () => {
  it('advances monotonically and ignores a delayed older GET response', () => {
    const revision36 = snapshot(36);
    const revision37 = snapshot(37);
    expect(reconcileTaskSnapshot(revision36, revision37)).toEqual({
      freshness: 'advance',
      snapshot: revision37,
    });
    expect(reconcileTaskSnapshot(revision37, revision36)).toEqual({
      freshness: 'stale',
      snapshot: revision37,
    });
  });

  it('accepts an equal-revision timing refresh only when source and payload are identical', () => {
    const current = snapshot(36, 'task-stable', 36_000);
    const refreshed = { ...current, serverTime: 37_000 };
    expect(reconcileTaskSnapshot(current, refreshed)).toEqual({
      freshness: 'refresh',
      snapshot: refreshed,
    });
    expect(reconcileTaskSnapshot(current, snapshot(36, 'task-mutated', 37_000))).toEqual({
      freshness: 'inconsistent',
      snapshot: current,
    });
  });

  it('rejects malformed and extra response fields', () => {
    expect(parseTaskSnapshotResponse(snapshot(36))).not.toBeNull();
    expect(parseTaskSnapshotResponse({ ...snapshot(36), privateBody: 'must-not-pass' })).toBeNull();
    expect(parseTaskSnapshotResponse({ ...snapshot(36), revision: 35.5 })).toBeNull();
  });
});
