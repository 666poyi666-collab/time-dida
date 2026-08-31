import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildMobileDashboard,
  buildMobileDashboardInRange,
  mobileCustomStatsRange,
  mobileStatsRange,
  mobileTimelineIntervalAt,
  resolveMobileTimelineTasks,
  selectMobileDashboardLedger,
} from '../src/mobile/dashboardModel';
import type { CachedBundle } from '../src/mobile/cache';
import { DashboardView } from '../src/mobile/DashboardView';
import type { SyncedTask } from '../shared/sync/taskSnapshotProtocol';

const now = new Date(2026, 6, 21, 12, 0, 0, 0).getTime();

describe('mobile dashboard model', () => {
  it('uses half-open local calendar windows for current and previous ranges', () => {
    const today = mobileStatsRange('today', now);
    const yesterday = mobileStatsRange('yesterday', now);
    const sevenDays = mobileStatsRange('7d', now);
    const previousSevenDays = mobileStatsRange('previous-7d', now);
    const thirtyDays = mobileStatsRange('30d', now);
    const previousThirtyDays = mobileStatsRange('previous-30d', now);

    expect(rangeDateKeys(today)).toEqual(['2026-07-21', '2026-07-22']);
    expect(rangeDateKeys(yesterday)).toEqual(['2026-07-20', '2026-07-21']);
    expect(rangeDateKeys(sevenDays)).toEqual(['2026-07-15', '2026-07-22']);
    expect(rangeDateKeys(previousSevenDays)).toEqual(['2026-07-08', '2026-07-15']);
    expect(rangeDateKeys(thirtyDays)).toEqual(['2026-06-22', '2026-07-22']);
    expect(rangeDateKeys(previousThirtyDays)).toEqual(['2026-05-23', '2026-06-22']);
    expect(new Date(today.start).getHours()).toBe(0);
    expect(new Date(today.end).getHours()).toBe(0);
  });

  it('normalizes an inclusive custom date selection without accepting rolled dates', () => {
    const range = mobileCustomStatsRange('2026-03-07', '2026-03-09');
    expect(range && rangeDateKeys(range)).toEqual(['2026-03-07', '2026-03-10']);
    expect(mobileCustomStatsRange('2026-02-30', '2026-03-02')).toBeNull();
    expect(mobileCustomStatsRange('2026-03-10', '2026-03-09')).toBeNull();
  });

  it('keeps custom local dates half-open across a daylight-saving transition', () => {
    const previousTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = 'America/New_York';
    try {
      const range = mobileCustomStatsRange('2026-03-07', '2026-03-09');
      const dstNow = new Date(2026, 2, 9, 12, 0, 0, 0).getTime();
      const yesterday = mobileStatsRange('yesterday', dstNow);
      const sevenDays = mobileStatsRange('7d', dstNow);
      expect(range).not.toBeNull();
      expect(range && rangeDateKeys(range)).toEqual(['2026-03-07', '2026-03-10']);
      expect(range && range.end - range.start).toBe(71 * 60 * 60_000);
      expect(rangeDateKeys(yesterday)).toEqual(['2026-03-08', '2026-03-09']);
      expect(yesterday.end - yesterday.start).toBe(23 * 60 * 60_000);
      expect(rangeDateKeys(sevenDays)).toEqual(['2026-03-03', '2026-03-10']);
      expect(sevenDays.end - sevenDays.start).toBe(167 * 60 * 60_000);
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

  it('builds the mobile surface from the shared effective-day ledger', () => {
    const record = makeRecord();
    const result = buildMobileDashboard([record], 'today', now);
    expect(result.dayLedgers).toHaveLength(1);
    expect(result.dayLedgers[0].totals).toMatchObject({
      focusMs: 25 * 60_000,
      pauseMs: 5 * 60_000,
      gapMs: 150 * 60_000,
      observationMs: 3 * 60 * 60_000,
    });
    expect(result.totals).toMatchObject({
      focusMs: 25 * 60_000,
      pauseMs: 5 * 60_000,
      gapMs: 150 * 60_000,
    });
    expect(result.tasks).toEqual([
      {
        key: 'ticktick:task-1',
        taskId: 'task-1',
        title: '函数复习',
        activeMs: 25 * 60_000,
        segmentCount: 1,
        estimated: false,
      },
    ]);
  });

  it('keeps each day independent and aggregates exact focus, pause and gap', () => {
    const current = makeRecord();
    const previous = shiftRecord(current, -24 * 60 * 60_000, 'previous');
    const selected = mobileStatsRange('7d', now);
    const result = buildMobileDashboardInRange([previous, current], selected, now);

    expect(result.totals).toMatchObject({
      focusMs: 50 * 60_000,
      pauseMs: 10 * 60_000,
    });
    expect(result.dayLedgers).toHaveLength(7);
    expect(result.dayLedgers.filter((ledger) => ledger.status === 'observed')).toHaveLength(2);
    expect(result.tasks).toMatchObject([{ title: '函数复习', activeMs: 50 * 60_000 }]);
  });

  it('selects the requested day and otherwise falls back to the latest observed day', () => {
    const current = makeRecord();
    const previous = shiftRecord(current, -24 * 60 * 60_000, 'previous');
    const analytics = buildMobileDashboardInRange(
      [previous, current],
      mobileStatsRange('7d', now),
      now,
    );

    expect(selectMobileDashboardLedger(analytics.dayLedgers, '2026-07-20')?.date).toBe(
      '2026-07-20',
    );
    expect(selectMobileDashboardLedger(analytics.dayLedgers, null)?.date).toBe('2026-07-21');
    expect(selectMobileDashboardLedger(analytics.dayLedgers, '2099-01-01')).toBeUndefined();
  });

  it('renders the analytics model in the mobile dashboard surface', () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardView, {
        records: [makeRecord()],
        ready: true,
        configured: true,
        lastSyncAt: now,
        cursor: 'cursor-1',
        tasks: [makeTask(false)],
        referenceNow: now,
      }),
    );

    expect(markup).toContain('时间账本');
    expect(markup).toContain('近 7 天');
    expect(markup).toContain('昨天');
    expect(markup).toContain('上个 7 天');
    expect(markup).toContain('上个 30 天');
    expect(markup).toContain('自定义');
    expect(markup).toContain('24 小时时间轴');
    expect(markup).toContain('07:00 至 22:00 为默认有效日');
    expect(markup).toContain('精确空档');
    expect(markup).toContain('任务投入');
    expect(markup).toContain('任务专注时间构成，函数复习 100%');
    expect(markup).toContain('专注、暂停与空档时间守恒');
    expect(markup).toContain('专注 14%，暂停 3%，空档 83%');
    expect(markup).toContain('09:30 至 12:00，空档 02:30:00');
    expect(markup).toContain('class="mobile-day-map-scroll" tabindex="0"');
    expect(markup).toContain('横向查看 24 小时');
    expect(markup.match(/class="mobile-day-periods"/g)).toHaveLength(1);
    expect(markup).toContain('深夜');
    expect(markup).toContain('上午');
    expect(markup).toContain('下午');
    expect(markup).toContain('晚间');
    expect(markup.match(/class="mobile-day-lane-label"/g)).toHaveLength(3);
    expect(markup).toContain('<small>25m</small>');
    expect(markup).toContain('<small>5m</small>');
    expect(markup).toContain('<small>2.5h</small>');
    expect(markup).toContain('函数复习');
    expect(markup).toContain('任务待办');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('class="is-active" aria-pressed="true">近 7 天</button>');
    expect(markup).toContain('role="group" aria-label="时间段明细入口"');
    expect(markup).toContain('class="timeline-interval-choice focus"');
    expect(markup).toContain('class="ledger-interval focus " title=');
  });

  it('uses the current task snapshot instead of the finished session as task completion', () => {
    const record = makeRecord();
    const focus = {
      kind: 'focus' as const,
      startedAt: record.bundle.segments[0].startedAt,
      endedAt: record.bundle.segments[0].endedAt!,
      durationMs: record.bundle.segments[0].activeElapsedMs,
      sessionIds: [record.bundle.session.id],
      sourceIds: [record.bundle.segments[0].id],
      estimated: false as const,
    };
    const pause = {
      ...focus,
      kind: 'pause' as const,
      sourceIds: [record.bundle.pauses[0].id],
    };

    expect(record.bundle.session.status).toBe('finished');
    expect(resolveMobileTimelineTasks(focus, [record], [makeTask(false)])).toMatchObject([
      { title: '函数复习', state: 'pending' },
    ]);
    expect(resolveMobileTimelineTasks(focus, [record], [makeTask(true)])).toMatchObject([
      { title: '函数复习', state: 'completed' },
    ]);
    expect(resolveMobileTimelineTasks(focus, [record], [])).toMatchObject([{ state: 'missing' }]);
    expect(resolveMobileTimelineTasks(focus, [record], null)).toMatchObject([{ state: 'unknown' }]);
    expect(resolveMobileTimelineTasks(pause, [record], [makeTask(false)])).toMatchObject([
      { title: '函数复习', state: 'pending' },
    ]);

    const unlinked = structuredClone(record);
    unlinked.bundle.segments[0].taskId = null;
    unlinked.bundle.segments[0].taskSource = null;
    unlinked.bundle.segments[0].title = '自由阅读';
    expect(resolveMobileTimelineTasks(focus, [unlinked], [makeTask(false)])).toMatchObject([
      { title: '自由阅读', state: 'unlinked' },
    ]);
  });

  it('assigns an adjacent timeline boundary to one interval without overlap', () => {
    const startedAt = new Date(2026, 6, 21, 9, 0, 0, 0).getTime();
    const boundary = startedAt + 25 * 60_000;
    const first = makeInterval('focus', startedAt, boundary, 'segment-1');
    const second = makeInterval('pause', boundary, boundary + 5 * 60_000, 'pause-1');

    expect(mobileTimelineIntervalAt([first, second], boundary - 1)).toBe(first);
    expect(mobileTimelineIntervalAt([first, second], boundary)).toBe(second);
    expect(mobileTimelineIntervalAt([first, second], second.endedAt)).toBeUndefined();
  });
});

function makeInterval(
  kind: 'focus' | 'pause',
  startedAt: number,
  endedAt: number,
  sourceId: string,
) {
  return {
    kind,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    sessionIds: ['session-1'],
    sourceIds: [sourceId],
    estimated: false as const,
  };
}

function makeTask(isCompleted: boolean): SyncedTask {
  return {
    id: 'task-1',
    source: 'ticktick',
    projectId: null,
    title: '函数复习',
    status: isCompleted ? 'completed' : null,
    priority: null,
    startDate: null,
    dueDate: null,
    recurrence: null,
    tags: [],
    parentId: null,
    isCompleted,
    updatedAt: now,
  };
}

function rangeDateKeys(range: { start: number; end: number }): [string, string] {
  return [dateKey(range.start), dateKey(range.end)];
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function makeRecord(): CachedBundle {
  const startedAt = new Date(2026, 6, 21, 9, 0, 0, 0).getTime();
  return {
    entityId: 'session-1',
    revision: 1,
    changeSeq: 1,
    sourceDeviceId: 'desktop-1',
    bundle: {
      session: {
        id: 'session-1',
        title: '函数复习',
        status: 'finished',
        startedAt,
        endedAt: startedAt + 30 * 60_000,
        activeElapsedMs: 25 * 60_000,
        pauseElapsedMs: 5 * 60_000,
        wallElapsedMs: 30 * 60_000,
        defaultTaskId: 'task-1',
        defaultTaskSource: 'ticktick',
        defaultTaskTitle: '函数复习',
        note: null,
        createdAt: startedAt,
        updatedAt: startedAt + 30 * 60_000,
      },
      segments: [
        {
          id: 'segment-1',
          sessionId: 'session-1',
          taskId: 'task-1',
          taskSource: 'ticktick',
          title: '函数复习',
          startedAt,
          endedAt: startedAt + 25 * 60_000,
          activeElapsedMs: 25 * 60_000,
          note: null,
          tomatodoSubject: null,
          createdAt: startedAt,
          updatedAt: startedAt + 25 * 60_000,
        },
      ],
      pauses: [
        {
          id: 'pause-1',
          sessionId: 'session-1',
          segmentId: 'segment-1',
          pauseStartedAt: startedAt + 25 * 60_000,
          pauseEndedAt: startedAt + 30 * 60_000,
          durationMs: 5 * 60_000,
          reason: null,
          createdAt: startedAt + 25 * 60_000,
          updatedAt: startedAt + 30 * 60_000,
        },
      ],
    },
  };
}

function shiftRecord(record: CachedBundle, offset: number, suffix: string): CachedBundle {
  const copy = structuredClone(record);
  copy.entityId = `${copy.entityId}-${suffix}`;
  copy.bundle.session.id = `${copy.bundle.session.id}-${suffix}`;
  copy.bundle.session.startedAt += offset;
  copy.bundle.session.endedAt = (copy.bundle.session.endedAt ?? 0) + offset;
  copy.bundle.session.createdAt += offset;
  copy.bundle.session.updatedAt += offset;
  for (const segment of copy.bundle.segments) {
    segment.id = `${segment.id}-${suffix}`;
    segment.sessionId = copy.bundle.session.id;
    segment.startedAt += offset;
    segment.endedAt = (segment.endedAt ?? 0) + offset;
    segment.createdAt += offset;
    segment.updatedAt += offset;
  }
  for (const pause of copy.bundle.pauses) {
    pause.id = `${pause.id}-${suffix}`;
    pause.sessionId = copy.bundle.session.id;
    pause.segmentId = pause.segmentId ? `${pause.segmentId}-${suffix}` : null;
    pause.pauseStartedAt += offset;
    pause.pauseEndedAt = (pause.pauseEndedAt ?? 0) + offset;
    pause.createdAt += offset;
    pause.updatedAt += offset;
  }
  return copy;
}
