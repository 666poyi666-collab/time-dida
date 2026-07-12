import { describe, expect, it } from 'vitest';
import type { FocusSession } from '@shared/types';
import {
  filterSessionsByRange,
  formatDayLabel,
  getRange,
  groupByDay,
  groupByWeek,
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
  it('builds an inclusive recent 7 day range', () => {
    const range = getRange('7d', '', '', at(2026, 6, 30));

    expect(formatDayLabel(range.start)).toBe('2026-06-24');
    expect(formatDayLabel(range.end)).toBe('2026-06-30');
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
