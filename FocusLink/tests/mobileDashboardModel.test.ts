import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildMobileDashboard,
  buildMobileDashboardInRange,
  mobileStatsRange,
} from '../src/mobile/dashboardModel';
import type { CachedBundle } from '../src/mobile/cache';
import { DashboardView } from '../src/mobile/DashboardView';

const now = new Date(2026, 6, 21, 12, 0, 0, 0).getTime();

describe('mobile dashboard model', () => {
  it('uses natural-day windows for all supported ranges', () => {
    const today = mobileStatsRange('today', now);
    const sevenDays = mobileStatsRange('7d', now);
    const thirtyDays = mobileStatsRange('30d', now);
    expect(new Date(today.start).getHours()).toBe(0);
    expect(new Date(today.end).getHours()).toBe(23);
    expect((today.start - sevenDays.start) / 86400000).toBe(6);
    expect((today.start - thirtyDays.start) / 86400000).toBe(29);
  });

  it('reuses the shared analytics contract for subjects and hours', () => {
    const record = makeRecord();
    const result = buildMobileDashboard([record], 'today', now);
    expect(result.totals.activeMs).toBe(25 * 60_000);
    expect(result.subjects).toEqual([{ subject: '数学', activeMs: 25 * 60_000, segmentCount: 1 }]);
    expect(result.hourly[9].activeMs).toBe(25 * 60_000);
  });

  it('recomputes every metric when a heatmap date is selected', () => {
    const current = makeRecord();
    const previous = shiftRecord(current, -24 * 60 * 60_000, 'previous');
    const selected = mobileStatsRange('today', now);
    const result = buildMobileDashboardInRange([previous, current], selected, true);

    expect(result.totals).toMatchObject({
      activeMs: 25 * 60_000,
      pauseMs: 5 * 60_000,
      sessionCount: 1,
    });
    expect(result.tasks.map((item) => item.title)).toEqual(['函数复习']);
    expect(result.sessionActive).toEqual([{ sessionId: 'session-1', activeMs: 25 * 60_000 }]);
  });

  it('renders the analytics model in the mobile dashboard surface', () => {
    const markup = renderToStaticMarkup(
      createElement(DashboardView, {
        records: [makeRecord()],
        ready: true,
        configured: true,
        lastSyncAt: now,
        cursor: 'cursor-1',
        referenceNow: now,
      }),
    );

    expect(markup).toContain('专注统计');
    expect(markup).toContain('近 7 天');
    expect(markup).toContain('专注趋势');
    expect(markup).toContain('数学');
    expect(markup).toContain('24 小时时段');
    expect(markup).toContain('任务投入');
    expect(markup).toContain('任务专注时间构成，函数复习 100%');
    expect(markup).toContain('日期热力');
    expect(markup).toContain('暂停损耗与时间守恒');
    expect(markup).toContain('有效专注 83%，暂停 17%');
    expect(markup).toContain('每日专注与暂停趋势，详细数值见各日期标签');
    expect(markup).not.toContain('tabindex="0"');
    expect(markup).toContain('09:00 至 10:00，专注 25:00，暂停 05:00');
    expect(markup).toContain('函数复习');
  });
});

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
