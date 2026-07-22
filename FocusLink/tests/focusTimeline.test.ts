import { describe, expect, it } from 'vitest';
import { buildMixedTimelineItems } from '../shared/focus/timeline';

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
});
