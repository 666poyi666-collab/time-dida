import { describe, expect, it } from 'vitest';
import { buildSessionAnalytics } from '@shared/sessionAnalytics';
import type { FocusSegment, FocusSession, PauseEvent } from '@shared/types';

const day = new Date(2026, 6, 18, 0, 0, 0, 0).getTime();

function session(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: 'session-1',
    title: null,
    status: 'finished',
    startedAt: day + 9 * 60 * 60 * 1000,
    endedAt: day + 10 * 60 * 60 * 1000,
    activeElapsedMs: 45 * 60 * 1000,
    pauseElapsedMs: 15 * 60 * 1000,
    wallElapsedMs: 60 * 60 * 1000,
    defaultTaskId: 'task-1',
    defaultTaskSource: 'ticktick',
    defaultTaskTitle: '有机化学',
    note: null,
    createdAt: day,
    updatedAt: day,
    ...overrides,
  };
}

function segment(overrides: Partial<FocusSegment> = {}): FocusSegment {
  return {
    id: 'segment-1',
    sessionId: 'session-1',
    taskId: 'task-1',
    taskSource: 'ticktick',
    title: '有机化学',
    startedAt: day + 9 * 60 * 60 * 1000,
    endedAt: day + 9.75 * 60 * 60 * 1000,
    activeElapsedMs: 45 * 60 * 1000,
    note: null,
    cloudFocusId: null,
    tomatodoSubject: null,
    createdAt: day,
    updatedAt: day,
    ...overrides,
  };
}

function pause(overrides: Partial<PauseEvent> = {}): PauseEvent {
  return {
    id: 'pause-1',
    sessionId: 'session-1',
    segmentId: 'segment-1',
    pauseStartedAt: day + 9.75 * 60 * 60 * 1000,
    pauseEndedAt: day + 10 * 60 * 60 * 1000,
    durationMs: 15 * 60 * 1000,
    reason: null,
    createdAt: day,
    updatedAt: day,
    ...overrides,
  };
}

describe('buildSessionAnalytics', () => {
  it('aggregates daily, task, totals and mixed timeline data without mutating records', () => {
    const result = buildSessionAnalytics(
      {
        start: day,
        end: day + 24 * 60 * 60 * 1000 - 1,
        timelineStart: day,
        timelineEnd: day + 24 * 60 * 60 * 1000 - 1,
      },
      { sessions: [session()], segments: [segment()], pauses: [pause()] },
    );

    expect(result.totals).toEqual({
      activeMs: 45 * 60 * 1000,
      pauseMs: 15 * 60 * 1000,
      wallMs: 60 * 60 * 1000,
      sessionCount: 1,
    });
    expect(result.sessionActive).toEqual([{ sessionId: 'session-1', activeMs: 45 * 60 * 1000 }]);
    expect(result.daily).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      taskId: 'task-1',
      title: '有机化学',
      activeMs: 45 * 60 * 1000,
      segmentCount: 1,
    });
    expect(result.timeline.map((item) => item.kind)).toEqual(['focus', 'pause']);
    expect(result.subjects).toEqual([
      { subject: '化学', activeMs: 45 * 60 * 1000, segmentCount: 1 },
    ]);
    expect(result.hourly[9]).toMatchObject({
      activeMs: 45 * 60 * 1000,
      pauseMs: 15 * 60 * 1000,
    });
    expect(result.stability).toMatchObject({ activeDays: 1, calendarDays: 1, score: 100 });
  });

  it('includes zero days and prevents out-of-range sessions from leaking into analytics', () => {
    const nextDay = new Date(2026, 6, 19, 0, 0, 0, 0).getTime();
    const result = buildSessionAnalytics(
      { start: day, end: nextDay + 24 * 60 * 60 * 1000 - 1 },
      {
        sessions: [
          session(),
          session({
            id: 'outside',
            startedAt: new Date(2026, 6, 21, 9).getTime(),
            activeElapsedMs: 9_999,
          }),
        ],
        segments: [segment()],
        pauses: [pause()],
      },
    );

    expect(result.daily).toHaveLength(2);
    expect(result.daily[1]).toMatchObject({ activeMs: 0, sessionCount: 0 });
    expect(result.sessions.map((item) => item.id)).toEqual(['session-1']);
    expect(result.stability.score).toBe(0);
  });
});

describe('buildSessionAnalytics edge cases', () => {
  it('keeps sessions outside the timeline window in totals but out of the mixed timeline', () => {
    const day2 = new Date(2026, 6, 19, 0, 0, 0, 0).getTime();
    const result = buildSessionAnalytics(
      {
        start: day,
        end: day2 + 24 * 60 * 60 * 1000 - 1,
        timelineStart: day,
        timelineEnd: day + 24 * 60 * 60 * 1000 - 1,
      },
      {
        sessions: [
          session(),
          session({
            id: 'session-2',
            startedAt: day2 + 9 * 60 * 60 * 1000,
            endedAt: day2 + 10 * 60 * 60 * 1000,
          }),
        ],
        segments: [
          segment(),
          segment({
            id: 'segment-2',
            sessionId: 'session-2',
            startedAt: day2 + 9 * 60 * 60 * 1000,
            endedAt: day2 + 10 * 60 * 60 * 1000,
          }),
        ],
        pauses: [pause()],
      },
    );

    // 两天都计入日聚合与总计，但混合时间轴只包含 timeline 窗口内（第一天）的会话。
    expect(result.daily).toHaveLength(2);
    expect(result.totals.sessionCount).toBe(2);
    expect(new Set(result.timeline.map((item) => item.sessionId))).toEqual(new Set(['session-1']));
    expect(result.timeline.map((item) => item.kind)).toEqual(['focus', 'pause']);
  });

  it('normalizes reversed ranges instead of producing empty analytics', () => {
    const result = buildSessionAnalytics(
      { start: day + 24 * 60 * 60 * 1000 - 1, end: day },
      { sessions: [session()], segments: [segment()], pauses: [pause()] },
    );

    expect(result.range.start).toBeLessThan(result.range.end);
    expect(result.daily).toHaveLength(1);
    expect(result.totals.sessionCount).toBe(1);
  });

  it('enumerates daily buckets across month and year boundaries', () => {
    const jan30 = new Date(2026, 0, 30, 0, 0, 0, 0).getTime();
    const feb2End = new Date(2026, 1, 2, 23, 59, 59, 999).getTime();
    const result = buildSessionAnalytics(
      { start: jan30, end: feb2End },
      { sessions: [], segments: [], pauses: [] },
    );

    expect(result.daily.map((item) => item.date)).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
    expect(result.stability.calendarDays).toBe(4);
    expect(result.stability.activeDays).toBe(0);
    expect(result.totals.sessionCount).toBe(0);
  });

  it('splits a cross-midnight session across both natural days and clips a single-day query', () => {
    const nextDay = new Date(2026, 6, 19, 0, 0, 0, 0).getTime();
    const crossSession = session({
      id: 'cross-midnight',
      startedAt: day + 23.5 * 60 * 60 * 1000,
      endedAt: nextDay + 30 * 60 * 1000,
      activeElapsedMs: 45 * 60 * 1000,
      pauseElapsedMs: 15 * 60 * 1000,
      wallElapsedMs: 60 * 60 * 1000,
    });
    const crossFocus = segment({
      id: 'cross-focus',
      sessionId: crossSession.id,
      startedAt: crossSession.startedAt,
      endedAt: nextDay + 15 * 60 * 1000,
      activeElapsedMs: 45 * 60 * 1000,
    });
    const crossPause = pause({
      id: 'cross-pause',
      sessionId: crossSession.id,
      segmentId: crossFocus.id,
      pauseStartedAt: nextDay + 15 * 60 * 1000,
      pauseEndedAt: nextDay + 30 * 60 * 1000,
      durationMs: 15 * 60 * 1000,
    });

    const bothDays = buildSessionAnalytics(
      { start: day, end: nextDay + 24 * 60 * 60 * 1000 - 1 },
      { sessions: [crossSession], segments: [crossFocus], pauses: [crossPause] },
    );
    expect(bothDays.daily[0]).toMatchObject({
      activeMs: 30 * 60 * 1000,
      pauseMs: 0,
      wallMs: 30 * 60 * 1000,
      sessionCount: 1,
    });
    expect(bothDays.daily[1]).toMatchObject({
      activeMs: 15 * 60 * 1000,
      pauseMs: 15 * 60 * 1000,
      wallMs: 30 * 60 * 1000,
      sessionCount: 1,
    });

    const secondDayOnly = buildSessionAnalytics(
      { start: nextDay, end: nextDay + 24 * 60 * 60 * 1000 - 1 },
      { sessions: [crossSession], segments: [crossFocus], pauses: [crossPause] },
    );
    expect(secondDayOnly.sessions.map((item) => item.id)).toEqual(['cross-midnight']);
    expect(secondDayOnly.totals).toMatchObject({
      activeMs: 15 * 60 * 1000,
      pauseMs: 15 * 60 * 1000,
      wallMs: 30 * 60 * 1000,
      sessionCount: 1,
    });
    expect(secondDayOnly.sessionActive).toEqual([
      { sessionId: 'cross-midnight', activeMs: 15 * 60 * 1000 },
    ]);
  });

  it('does not count a session that ends exactly at the selected day boundary', () => {
    const nextDay = new Date(2026, 6, 19, 0, 0, 0, 0).getTime();
    const result = buildSessionAnalytics(
      { start: nextDay, end: nextDay + 24 * 60 * 60 * 1000 - 1 },
      {
        sessions: [
          session({
            id: 'ends-at-midnight',
            startedAt: nextDay - 30 * 60 * 1000,
            endedAt: nextDay,
            activeElapsedMs: 30 * 60 * 1000,
            pauseElapsedMs: 0,
            wallElapsedMs: 30 * 60 * 1000,
          }),
        ],
        segments: [],
        pauses: [],
      },
    );

    expect(result.sessions).toEqual([]);
    expect(result.totals.sessionCount).toBe(0);
    expect(result.daily[0]).toMatchObject({ activeMs: 0, pauseMs: 0, wallMs: 0 });
  });

  it('keeps identical task ids from different providers separate', () => {
    const result = buildSessionAnalytics(
      { start: day, end: day + 24 * 60 * 60 * 1000 - 1 },
      {
        sessions: [session()],
        segments: [
          segment({
            id: 'local-segment',
            taskId: 'same-id',
            taskSource: 'local',
            title: '本地任务',
          }),
          segment({
            id: 'remote-segment',
            taskId: 'same-id',
            taskSource: 'ticktick',
            title: '滴答任务',
          }),
        ],
        pauses: [],
      },
    );

    expect(result.tasks.map((item) => item.key).sort()).toEqual([
      'local:same-id',
      'ticktick:same-id',
    ]);
  });

  it('groups unlinked segments by trimmed title and falls back to 未关联任务', () => {
    const result = buildSessionAnalytics(
      { start: day, end: day + 24 * 60 * 60 * 1000 - 1 },
      {
        sessions: [session()],
        segments: [
          segment({
            id: 's1',
            taskId: null,
            taskSource: null,
            title: '  ',
            activeElapsedMs: 60000,
          }),
          segment({
            id: 's2',
            taskId: null,
            taskSource: null,
            title: '自由专注',
            activeElapsedMs: 120000,
          }),
          segment({
            id: 's3',
            taskId: null,
            taskSource: null,
            title: '自由专注',
            activeElapsedMs: 60000,
          }),
        ],
        pauses: [],
      },
    );

    expect(result.tasks).toHaveLength(2);
    const untitled = result.tasks.find((item) => item.title === '未关联任务');
    const free = result.tasks.find((item) => item.title === '自由专注');
    expect(untitled).toMatchObject({ taskId: null, activeMs: 60000, segmentCount: 1 });
    expect(free).toMatchObject({ taskId: null, activeMs: 180000, segmentCount: 2 });
    // 时间轴标题同样回退为 未关联任务，且不产生空字符串标题。
    expect(result.timeline.every((item) => item.title.trim().length > 0)).toBe(true);
  });

  it('derives a non-trivial stability score from daily variance without fabricating data', () => {
    const day2 = new Date(2026, 6, 19, 0, 0, 0, 0).getTime();
    const result = buildSessionAnalytics(
      { start: day, end: day2 + 24 * 60 * 60 * 1000 - 1 },
      {
        sessions: [
          session({ activeElapsedMs: 30 * 60 * 1000 }),
          session({
            id: 'session-2',
            startedAt: day2 + 9 * 60 * 60 * 1000,
            endedAt: day2 + 11 * 60 * 60 * 1000,
            activeElapsedMs: 90 * 60 * 1000,
          }),
        ],
        segments: [],
        pauses: [],
      },
    );

    expect(result.stability.calendarDays).toBe(2);
    expect(result.stability.activeDays).toBe(2);
    expect(result.stability.averageDailyActiveMs).toBe(60 * 60 * 1000);
    expect(result.stability.standardDeviationMs).toBeCloseTo(30 * 60 * 1000, 3);
    expect(result.stability.score).toBe(50);
  });

  it('keeps manual subjects above inference and uses 学习 only as the fallback', () => {
    const result = buildSessionAnalytics(
      { start: day, end: day + 24 * 60 * 60 * 1000 - 1 },
      {
        sessions: [session()],
        segments: [
          segment({
            id: 'manual',
            title: '数学函数',
            tomatodoSubject: '物理',
            activeElapsedMs: 120000,
          }),
          segment({
            id: 'fallback',
            title: '整理错题',
            taskId: null,
            taskSource: null,
            activeElapsedMs: 60000,
          }),
        ],
        pauses: [],
      },
    );

    expect(result.subjects).toEqual([
      { subject: '物理', activeMs: 120000, segmentCount: 1 },
      { subject: '学习', activeMs: 60000, segmentCount: 1 },
    ]);
  });

  it('sorts the mixed timeline by start time and preserves running segments with null endedAt', () => {
    const result = buildSessionAnalytics(
      { start: day, end: day + 24 * 60 * 60 * 1000 - 1 },
      {
        sessions: [session()],
        segments: [
          segment({
            id: 'segment-late',
            startedAt: day + 11 * 60 * 60 * 1000,
            endedAt: null,
            activeElapsedMs: 5 * 60 * 1000,
          }),
          segment(),
        ],
        pauses: [pause()],
      },
    );

    expect(result.timeline.map((item) => item.id)).toEqual([
      'segment-1',
      'pause-1',
      'segment-late',
    ]);
    expect(result.timeline[2].endedAt).toBeNull();
  });
});
