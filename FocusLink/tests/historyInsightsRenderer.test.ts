import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildSessionAnalytics } from '@shared/sessionAnalytics';
import type { FocusSegment, FocusSession } from '@shared/types';
import { HistoryInsights } from '../src/features/history/HistoryInsights';
import { summarizeAnalyticsRange } from '../src/features/history/historyStats';

describe('desktop history insights presentation', () => {
  it('keeps a cross-midnight session visible and uses the selected day clipped totals', () => {
    const previousDay = new Date(2026, 6, 20, 23, 50, 0, 0).getTime();
    const selectedStart = new Date(2026, 6, 21, 0, 0, 0, 0).getTime();
    const selectedEnd = new Date(2026, 6, 21, 23, 59, 59, 999).getTime();
    const session: FocusSession = {
      id: 'cross-midnight',
      title: '跨午夜复习',
      status: 'finished',
      startedAt: previousDay,
      endedAt: previousDay + 30 * 60_000,
      activeElapsedMs: 30 * 60_000,
      pauseElapsedMs: 0,
      wallElapsedMs: 30 * 60_000,
      defaultTaskId: 'task-1',
      defaultTaskSource: 'ticktick',
      defaultTaskTitle: '跨午夜复习',
      note: null,
      createdAt: previousDay,
      updatedAt: previousDay + 30 * 60_000,
    };
    const segment: FocusSegment = {
      id: 'segment-1',
      sessionId: session.id,
      taskId: 'task-1',
      taskSource: 'ticktick',
      title: '跨午夜复习',
      startedAt: previousDay,
      endedAt: previousDay + 30 * 60_000,
      activeElapsedMs: 30 * 60_000,
      note: null,
      tomatodoSubject: null,
      cloudFocusId: null,
      createdAt: previousDay,
      updatedAt: previousDay + 30 * 60_000,
    };
    const analytics = buildSessionAnalytics(
      {
        start: selectedStart,
        end: selectedEnd,
        timelineStart: selectedStart,
        timelineEnd: selectedEnd,
      },
      { sessions: [session], segments: [segment], pauses: [] },
    );
    const summary = summarizeAnalyticsRange(analytics.daily, analytics.sessions.length);

    expect(analytics.sessions.map((item) => item.id)).toEqual(['cross-midnight']);
    expect(summary).toMatchObject({ count: 1, active: 20 * 60_000, wall: 20 * 60_000 });

    const markup = renderToStaticMarkup(
      createElement(HistoryInsights, {
        sessions: analytics.sessions,
        summary,
        range: { start: selectedStart, end: selectedEnd },
        analytics,
        slideDirection: 0,
        onSelectRange: () => undefined,
      }),
    );

    expect(markup).toContain('今日有效专注');
    expect(markup).toContain('20 分钟');
    expect(markup).toContain('完成 1 轮');
    expect(markup).toContain('stats-timeline-detail');
    expect(markup).not.toContain('这段时间还没有专注记录');
  });
});
