import { describe, expect, it } from 'vitest';
import type { TimerSnapshot } from '../shared/types';
import { getCurrentTaskTitle, getWallElapsedMs } from '../shared/focus/selectors';

function snapshot(overrides: Partial<TimerSnapshot>): TimerSnapshot {
  return {
    state: 'running',
    sessionId: 'session-1',
    currentSegmentId: 'segment-1',
    currentTaskId: null,
    currentTaskTitle: null,
    currentTaskSource: null,
    sessionDefaultTaskId: null,
    sessionDefaultTaskTitle: null,
    activeElapsedMs: 0,
    pauseElapsedMs: 0,
    wallElapsedMs: 0,
    currentPauseStartedAt: null,
    segments: [],
    pauseEvents: [],
    lastTick: 0,
    ...overrides,
  };
}

describe('timer selectors', () => {
  it('includes the live pause interval in wall elapsed time', () => {
    expect(
      getWallElapsedMs(
        snapshot({
          state: 'paused',
          wallElapsedMs: 5_000,
          currentPauseStartedAt: 15_000,
          segments: [
            {
              id: 'segment-1',
              taskId: null,
              taskTitle: null,
              taskSource: null,
              title: null,
              startedAt: 10_000,
              endedAt: 15_000,
              activeElapsedMs: 5_000,
            },
          ],
          pauseEvents: [
            {
              id: 'pause-1',
              segmentId: 'segment-1',
              pauseStartedAt: 15_000,
              pauseEndedAt: null,
              durationMs: 0,
              isCurrent: true,
            },
          ],
        }),
        18_000,
      ),
    ).toBe(8_000);
  });

  it('uses the live current task title first', () => {
    expect(getCurrentTaskTitle(snapshot({ currentTaskTitle: '当前片段任务' }))).toBe(
      '当前片段任务',
    );
  });

  it('falls back to the current segment task title', () => {
    expect(
      getCurrentTaskTitle(
        snapshot({
          segments: [
            {
              id: 'segment-1',
              taskId: 'task-1',
              taskTitle: '片段关联任务',
              taskSource: 'ticktick',
              title: null,
              startedAt: 1,
              endedAt: null,
              activeElapsedMs: 0,
            },
          ],
        }),
      ),
    ).toBe('片段关联任务');
  });

  it('falls back to the session default task title', () => {
    expect(
      getCurrentTaskTitle(
        snapshot({
          sessionDefaultTaskTitle: '本次默认任务',
          segments: [
            {
              id: 'segment-1',
              taskId: null,
              taskTitle: null,
              taskSource: null,
              title: null,
              startedAt: 1,
              endedAt: null,
              activeElapsedMs: 0,
            },
          ],
        }),
      ),
    ).toBe('本次默认任务');
  });
});
