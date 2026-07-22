import { describe, expect, it } from 'vitest';
import { buildMixedTimelineItems, getTimelineDisplayDuration } from '../shared/focus/timeline';

describe('focus ribbon timeline', () => {
  it('clips a focus segment at its first real pause boundary', () => {
    const items = buildMixedTimelineItems({
      segments: [
        {
          id: 'segment-1',
          taskId: null,
          taskTitle: null,
          taskSource: null,
          title: null,
          startedAt: 1_000,
          endedAt: 9_000,
          activeElapsedMs: 4_000,
        },
      ],
      pauseEvents: [
        {
          id: 'pause-1',
          segmentId: 'segment-1',
          pauseStartedAt: 5_000,
          pauseEndedAt: 9_000,
          durationMs: 4_000,
          isCurrent: false,
        },
      ],
      currentSegmentId: 'segment-1',
      state: 'finished',
      now: 9_000,
    });

    expect(items.map(({ type, startedAt, endedAt }) => ({ type, startedAt, endedAt }))).toEqual([
      { type: 'focus', startedAt: 1_000, endedAt: 5_000 },
      { type: 'pause', startedAt: 5_000, endedAt: 9_000 },
    ]);
  });

  it('advances only an ongoing row without rebuilding its timeline item', () => {
    const [focus] = buildMixedTimelineItems({
      segments: [
        {
          id: 'segment-live',
          taskId: null,
          taskTitle: null,
          taskSource: null,
          title: null,
          startedAt: 1_000,
          endedAt: null,
          activeElapsedMs: 4_000,
        },
      ],
      pauseEvents: [],
      currentSegmentId: 'segment-live',
      state: 'running',
      now: 0,
    });

    expect(getTimelineDisplayDuration(focus, 12_000, 10_000)).toBe(6_000);
    expect(getTimelineDisplayDuration({ ...focus, isOngoing: false }, 12_000, 10_000)).toBe(4_000);
  });

  it('derives a live pause duration from its start boundary', () => {
    const [pause] = buildMixedTimelineItems({
      segments: [],
      pauseEvents: [
        {
          id: 'pause-live',
          segmentId: null,
          pauseStartedAt: 5_000,
          pauseEndedAt: null,
          durationMs: 0,
          isCurrent: true,
        },
      ],
      currentSegmentId: null,
      state: 'paused',
      now: 0,
    });

    expect(getTimelineDisplayDuration(pause, 12_500, 0)).toBe(7_500);
  });
});
