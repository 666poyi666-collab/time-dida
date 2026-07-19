import { describe, expect, it } from 'vitest';
import type { FocusSession } from '@shared/types';
import {
  filterSessionsByRange,
  formatDayLabel,
  getDayRange,
  getRange,
  groupByDay,
  groupByWeek,
  isSameLocalDay,
  shiftLocalDay,
  summarizeSessions,
} from '../src/features/history/historyStats';

function at(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
}

function session(id: string, startedAt: number, activeMinutes: number): FocusSession {
  return {
    id,
    title: null,
    status: 'finished',
    startedAt,
    endedAt: startedAt + activeMinutes * 60_000,
    activeElapsedMs: activeMinutes * 60_000,
    pauseElapsedMs: 0,
    wallElapsedMs: activeMinutes * 60_000,
    defaultTaskId: null,
    defaultTaskSource: null,
    defaultTaskTitle: null,
    note: null,
    createdAt: startedAt,
    updatedAt: startedAt + activeMinutes * 60_000,
  };
}

describe('history stats and range grouping', () => {
  it('builds and moves an exact local day without allowing range spillover', () => {
    const selected = at(2026, 7, 17, 19);
    const range = getDayRange(selected);

    expect(formatDayLabel(range.start)).toBe('2026-07-17');
    expect(formatDayLabel(range.end)).toBe('2026-07-17');
    expect(isSameLocalDay(shiftLocalDay(selected, -1), at(2026, 7, 16))).toBe(true);
    expect(isSameLocalDay(shiftLocalDay(selected, 1), at(2026, 7, 18))).toBe(true);
  });

  it('builds an inclusive recent 7 day range', () => {
    const range = getRange('7d', '', '', at(2026, 6, 30));

    expect(formatDayLabel(range.start)).toBe('2026-06-24');
    expect(formatDayLabel(range.end)).toBe('2026-06-30');
  });

  it('builds inclusive 15 and 30 day ranges anchored on today', () => {
    const halfMonth = getRange('15d', '', '', at(2026, 6, 30));
    expect(formatDayLabel(halfMonth.start)).toBe('2026-06-16');
    expect(formatDayLabel(halfMonth.end)).toBe('2026-06-30');

    const month = getRange('30d', '', '', at(2026, 6, 30));
    expect(formatDayLabel(month.start)).toBe('2026-06-01');
    expect(formatDayLabel(month.end)).toBe('2026-06-30');
  });

  it('every multi-day preset keeps today as the range end', () => {
    for (const preset of ['7d', '15d', '30d'] as const) {
      expect(formatDayLabel(getRange(preset, '', '', at(2026, 6, 30)).end)).toBe('2026-06-30');
    }
  });

  it('builds a custom range and falls back to today on invalid input', () => {
    const custom = getRange('custom', '2026-06-10', '2026-06-12', at(2026, 6, 30));
    expect(formatDayLabel(custom.start)).toBe('2026-06-10');
    expect(formatDayLabel(custom.end)).toBe('2026-06-12');

    const fallback = getRange('custom', 'not-a-date', '', at(2026, 6, 30));
    expect(formatDayLabel(fallback.start)).toBe('2026-06-30');
    expect(formatDayLabel(fallback.end)).toBe('2026-06-30');
  });

  it('shows every day in the selected range, including days without sessions', () => {
    const range = getRange('7d', '', '', at(2026, 6, 30));
    const sessions = [
      session('today-a', at(2026, 6, 30, 9), 40),
      session('today-b', at(2026, 6, 30, 20), 20),
      session('week-start', at(2026, 6, 24), 15),
      session('outside', at(2026, 6, 23), 90),
    ];

    const filtered = filterSessionsByRange(sessions, range);
    const daily = groupByDay(filtered, range);

    expect(daily).toHaveLength(7);
    expect(daily[0]).toMatchObject({
      label: '2026-06-30',
      count: 2,
      active: 60 * 60_000,
    });
    expect(daily.find((item) => item.label === '2026-06-29')).toMatchObject({
      count: 0,
      active: 0,
    });
    expect(daily.find((item) => item.label === '2026-06-24')).toMatchObject({
      count: 1,
      active: 15 * 60_000,
    });
  });

  it('shows every week touched by the selected range', () => {
    const range = getRange('15d', '', '', at(2026, 6, 30));
    const weekly = groupByWeek([session('today', at(2026, 6, 30), 30)], range);

    expect(weekly.map((item) => item.label)).toEqual(['2026 W27', '2026 W26', '2026 W25']);
    expect(weekly.find((item) => item.label === '2026 W26')).toMatchObject({
      count: 0,
      active: 0,
    });
  });

  it('summarizes the filtered range totals', () => {
    const summary = summarizeSessions([
      session('a', at(2026, 6, 30, 9), 25),
      {
        ...session('b', at(2026, 6, 30, 10), 35),
        pauseElapsedMs: 5 * 60_000,
        wallElapsedMs: 40 * 60_000,
      },
    ]);

    expect(summary).toEqual({
      count: 2,
      active: 60 * 60_000,
      pause: 5 * 60_000,
      wall: 65 * 60_000,
    });
  });
});
