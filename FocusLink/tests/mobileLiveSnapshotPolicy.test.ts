import { describe, expect, it } from 'vitest';
import type { LiveFocusCommandResponse } from '../shared/sync/liveFocusProtocol';
import {
  commandAckNotice,
  restoreCachedLiveSnapshot,
  shouldApplyLiveSnapshot,
} from '../src/mobile/liveSnapshotPolicy';
import { idleLiveFocusSnapshot, type LiveFocusSnapshotLike } from '../src/mobile/runtimeModel';

describe('mobile authoritative live snapshot policy', () => {
  it('never restores an activity snapshot without a configured account', () => {
    const cached = snapshot({ state: 'paused' });
    expect(restoreCachedLiveSnapshot(cached, false)).toBeNull();
    expect(restoreCachedLiveSnapshot(cached, true)).toBe(cached);
  });

  it('accepts only monotonic revisions', () => {
    const current = snapshot({ revision: 8, serverTime: 10_000 });
    expect(shouldApplyLiveSnapshot(current, snapshot({ revision: 9, serverTime: 9_000 }))).toBe(
      true,
    );
    expect(shouldApplyLiveSnapshot(current, snapshot({ revision: 7, serverTime: 20_000 }))).toBe(
      false,
    );
  });

  it('allows a newer materialization but rejects a different state at the same revision', () => {
    const current = snapshot({ revision: 8, serverTime: 10_000 });
    expect(shouldApplyLiveSnapshot(current, snapshot({ revision: 8, serverTime: 11_000 }))).toBe(
      true,
    );
    expect(
      shouldApplyLiveSnapshot(
        current,
        snapshot({ revision: 8, serverTime: 11_000, state: 'paused' }),
      ),
    ).toBe(false);
    expect(
      shouldApplyLiveSnapshot(
        current,
        snapshot({ revision: 8, serverTime: 11_000, sessionId: 'other-session' }),
      ),
    ).toBe(false);
  });

  it('describes conflicts as a non-executed command without claiming an overwrite', () => {
    const response = commandResponse({
      status: 'conflict',
      revision: 12,
      state: 'paused',
      errorCode: 'revision_conflict',
    });
    expect(commandAckNotice('resume', 11, response)).toBe(
      '操作未执行：提交基于 rev 11，云端当前为 rev 12 · 已暂停',
    );
    expect(commandAckNotice('pause', 11, response)).toBe(
      '操作未重复执行；云端已经是已暂停（rev 12）',
    );
  });

  it('does not claim a duplicate command changed the current state', () => {
    const response = commandResponse({
      status: 'duplicate',
      revision: 9,
      state: 'running',
      errorCode: null,
    });
    expect(commandAckNotice('pause', 8, response)).toBe(
      '重复请求未再次执行；云端当前为专注中（rev 9）',
    );
  });
});

function snapshot(overrides: Partial<LiveFocusSnapshotLike>): LiveFocusSnapshotLike {
  return {
    ...idleLiveFocusSnapshot(8, 10_000, 10_000),
    state: 'running',
    sessionId: 'session-1',
    title: '测试专注',
    ...overrides,
  };
}

function commandResponse(input: {
  status: LiveFocusCommandResponse['ack']['status'];
  revision: number;
  state: 'running' | 'paused' | 'idle';
  errorCode: string | null;
}): LiveFocusCommandResponse {
  return {
    protocolVersion: 1,
    serverTime: 20_000,
    ack: {
      commandId: 'command-1',
      status: input.status,
      revision: input.revision,
      errorCode: input.errorCode,
      completedEntityId: null,
    },
    snapshot: {
      revision: input.revision,
      state: input.state,
      session:
        input.state === 'idle'
          ? null
          : {
              id: 'session-1',
              title: '测试专注',
              state: input.state,
              startedAt: 1_000,
              activeElapsedMs: 5_000,
              pauseElapsedMs: 2_000,
              wallElapsedMs: 7_000,
              currentPauseStartedAt: input.state === 'paused' ? 18_000 : null,
              segments: [],
              pauses: [],
              task: null,
              updatedAt: 18_000,
              lastCommandDeviceId: 'phone',
            },
    },
  };
}
