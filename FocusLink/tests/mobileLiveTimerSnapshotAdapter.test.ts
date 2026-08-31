import { describe, expect, it } from 'vitest';
import { getCumulativeActiveMs, getCurrentPauseDisplayMs } from '../shared/focus/selectors';
import { liveFocusSnapshotToTimerSnapshot } from '../src/mobile/liveTimerSnapshotAdapter';
import type { LiveFocusSnapshotLike } from '../src/mobile/runtimeModel';

describe('mobile live snapshot to desktop timer snapshot adapter', () => {
  it('projects a running cloud session with the local receipt clock anchor', () => {
    const input = snapshot({
      state: 'running',
      serverTime: 10_000,
      observedAt: 10_500,
      activeElapsedMs: 9_000,
      wallElapsedMs: 9_000,
      currentStateStartedAt: 1_000,
      segments: [{ id: 'segment-1', startedAt: 1_000, endedAt: null }],
    });

    const projected = liveFocusSnapshotToTimerSnapshot(input);
    expect(projected).toMatchObject({
      state: 'running',
      sessionId: 'session-1',
      currentSegmentId: 'segment-1',
      currentTaskId: 'task-1',
      currentTaskTitle: '第一章第二节',
      activeElapsedMs: 9_000,
      pauseElapsedMs: 0,
      wallElapsedMs: 9_000,
      lastTick: 10_500,
    });
    expect(projected.segments[0]).toMatchObject({
      startedAt: 1_500,
      endedAt: null,
      activeElapsedMs: 9_000,
      taskTitle: '第一章第二节',
    });
    expect(getCumulativeActiveMs(projected, 11_000)).toBe(9_500);
  });

  it('keeps closed pause time separate and identifies the active pause', () => {
    const input = snapshot({
      state: 'paused',
      serverTime: 20_000,
      observedAt: 20_250,
      activeElapsedMs: 12_000,
      pauseElapsedMs: 8_000,
      wallElapsedMs: 20_000,
      currentStateStartedAt: 17_000,
      segments: [
        { id: 'segment-1', startedAt: 0, endedAt: 8_000 },
        { id: 'segment-2', startedAt: 12_000, endedAt: 17_000 },
      ],
      pauses: [
        { id: 'pause-1', segmentId: 'segment-1', startedAt: 8_000, endedAt: 12_000 },
        { id: 'pause-2', segmentId: 'segment-2', startedAt: 17_000, endedAt: null },
      ],
    });

    const projected = liveFocusSnapshotToTimerSnapshot(input);
    expect(projected.currentSegmentId).toBeNull();
    expect(projected.pauseElapsedMs).toBe(4_000);
    expect(projected.currentPauseStartedAt).toBe(17_250);
    expect(projected.pauseEvents).toEqual([
      {
        id: 'pause-1',
        segmentId: 'segment-1',
        pauseStartedAt: 8_250,
        pauseEndedAt: 12_250,
        durationMs: 4_000,
        isCurrent: false,
      },
      {
        id: 'pause-2',
        segmentId: 'segment-2',
        pauseStartedAt: 17_250,
        pauseEndedAt: null,
        durationMs: 0,
        isCurrent: true,
      },
    ]);
    expect(getCurrentPauseDisplayMs(projected, 20_750)).toBe(3_500);
  });

  it('splits a local reused segment around pauses so resumed focus remains visible', () => {
    const projected = liveFocusSnapshotToTimerSnapshot(
      snapshot({
        state: 'running',
        serverTime: 25_000,
        observedAt: 25_000,
        activeElapsedMs: 20_000,
        pauseElapsedMs: 5_000,
        wallElapsedMs: 25_000,
        currentStateStartedAt: 15_000,
        segments: [{ id: 'offline-segment', startedAt: 0, endedAt: null }],
        pauses: [
          {
            id: 'offline-pause',
            segmentId: 'offline-segment',
            startedAt: 10_000,
            endedAt: 15_000,
          },
        ],
      }),
    );

    expect(projected.currentPauseStartedAt).toBeNull();
    expect(projected.currentSegmentId).toBe('offline-segment:resume:1');
    expect(projected.segments).toEqual([
      expect.objectContaining({
        id: 'offline-segment',
        startedAt: 0,
        endedAt: 10_000,
        activeElapsedMs: 10_000,
      }),
      expect.objectContaining({
        id: 'offline-segment:resume:1',
        startedAt: 15_000,
        endedAt: null,
        activeElapsedMs: 10_000,
      }),
    ]);
  });

  it('returns the desktop idle contract without stale session material', () => {
    const projected = liveFocusSnapshotToTimerSnapshot(
      snapshot({
        state: 'idle',
        sessionId: null,
        taskId: null,
        taskTitle: null,
        segments: [],
        pauses: [],
      }),
    );

    expect(projected).toMatchObject({
      state: 'idle',
      sessionId: null,
      currentSegmentId: null,
      segments: [],
      pauseEvents: [],
      lastTick: 10_500,
    });
  });
});

function snapshot(overrides: Partial<LiveFocusSnapshotLike>): LiveFocusSnapshotLike {
  return {
    state: 'running',
    revision: 8,
    sessionId: 'session-1',
    startedAt: 1_000,
    updatedAt: 10_000,
    serverTime: 10_000,
    observedAt: 10_500,
    activeElapsedMs: 9_000,
    pauseElapsedMs: 0,
    wallElapsedMs: 9_000,
    currentStateStartedAt: 1_000,
    segments: [{ id: 'segment-1', startedAt: 1_000, endedAt: null }],
    pauses: [],
    title: '第一章第二节',
    ownerDeviceId: 'tablet-a',
    taskId: 'task-1',
    taskSource: 'local',
    taskTitle: '第一章第二节',
    ...overrides,
  };
}
