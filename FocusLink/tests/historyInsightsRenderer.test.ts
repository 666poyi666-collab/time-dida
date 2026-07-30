import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildSessionAnalytics } from '@shared/sessionAnalytics';
import type { FocusSegment, FocusSession, PauseEvent } from '@shared/types';
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
        summary,
        range: { start: selectedStart, end: selectedEnd },
        analytics,
        slideDirection: 0,
        onSelectRange: () => undefined,
      }),
    );

    expect(markup).toContain('当日有效专注');
    expect(markup).toContain('这一天的时间，花在了哪里');
    expect(markup).toContain('0 分钟');
    expect(markup).toContain('完成 1 轮');
    expect(markup).toContain('24 小时时间轴');
    expect(markup).toContain('当日没有真实 focus 起点');
    expect(markup).not.toContain('跨午夜复习 · 20 分钟');
    expect(markup).not.toContain('这段时间还没有专注记录');
  });

  it('renders the shared conservative donut, effective-day axis and exact gap ledger', () => {
    const selectedStart = new Date(2026, 6, 22, 0, 0, 0, 0).getTime();
    const selectedEnd = new Date(2026, 6, 22, 23, 59, 59, 999).getTime();
    const startedAt = selectedStart + 9 * 60 * 60_000;
    const endedAt = selectedStart + 10 * 60 * 60_000;
    const focusSession: FocusSession = {
      id: 'focus-session',
      title: '结构化复习',
      status: 'finished',
      startedAt,
      endedAt,
      activeElapsedMs: 50 * 60_000,
      pauseElapsedMs: 10 * 60_000,
      wallElapsedMs: 60 * 60_000,
      defaultTaskId: null,
      defaultTaskSource: null,
      defaultTaskTitle: null,
      note: null,
      createdAt: startedAt,
      updatedAt: endedAt,
    };
    const focusSegment: FocusSegment = {
      id: 'focus-segment',
      sessionId: focusSession.id,
      taskId: null,
      taskSource: null,
      title: '结构化复习',
      startedAt,
      endedAt,
      activeElapsedMs: 50 * 60_000,
      note: null,
      tomatodoSubject: null,
      cloudFocusId: null,
      createdAt: startedAt,
      updatedAt: endedAt,
    };
    const pause: PauseEvent = {
      id: 'pause-1',
      sessionId: focusSession.id,
      segmentId: focusSegment.id,
      pauseStartedAt: startedAt + 20 * 60_000,
      pauseEndedAt: startedAt + 30 * 60_000,
      durationMs: 10 * 60_000,
      reason: null,
      createdAt: startedAt,
      updatedAt: endedAt,
    };
    const analytics = buildSessionAnalytics(
      {
        start: selectedStart,
        end: selectedEnd,
        timelineStart: selectedStart,
        timelineEnd: selectedEnd,
      },
      { sessions: [focusSession], segments: [focusSegment], pauses: [pause] },
      selectedEnd + 1,
    );
    const summary = summarizeAnalyticsRange(analytics.daily, analytics.sessions.length);
    const markup = renderToStaticMarkup(
      createElement(HistoryInsights, {
        summary,
        range: { start: selectedStart, end: selectedEnd },
        analytics,
        slideDirection: 1,
        onSelectRange: () => undefined,
      }),
    );

    expect(markup).toContain('观察时间构成：专注 50 分钟，暂停 10 分钟，空档 12 小时');
    expect(markup).toContain('07:00 至 22:00 为默认有效日');
    expect(markup).toContain('stats-ledger-block gap');
    expect(markup).toContain('10:00');
    expect(markup).toContain('22:00');
    expect(markup).toContain('精确空档');
  });

  it('says today has not started instead of treating the whole day as gap', () => {
    const now = Date.now();
    const selectedStart = new Date(now).setHours(0, 0, 0, 0);
    const selectedEnd = new Date(now).setHours(23, 59, 59, 999);
    const analytics = buildSessionAnalytics(
      { start: selectedStart, end: selectedEnd },
      { sessions: [], segments: [], pauses: [] },
      now,
    );
    const markup = renderToStaticMarkup(
      createElement(HistoryInsights, {
        summary: summarizeAnalyticsRange(analytics.daily, 0),
        range: { start: selectedStart, end: selectedEnd },
        analytics,
        slideDirection: 0,
        onSelectRange: () => undefined,
      }),
    );

    expect(markup).toContain('今日尚未启动');
    expect(analytics.dayLedgers[0].totals.gapMs).toBe(0);
  });
});
