import { describe, expect, it } from 'vitest';

import {
  completeTaskRecurrence,
  nextTaskRecurrenceAt,
  normalizeTaskRecurrence,
  restoreFinalTaskRecurrence,
} from '@shared/taskRecurrence';
import { buildFocusLinkTimeContext } from '@shared/timeContext';
import type { TaskRecurrence } from '@shared/types';

const daily: TaskRecurrence = {
  timezone: 'Asia/Shanghai',
  frequency: 'daily',
  interval: 1,
  byWeekday: [],
  byMonthDay: [],
  endAt: null,
  count: null,
  completedCount: 0,
  rollover: 'from_schedule',
};

describe('structured task recurrence', () => {
  it('advances scheduled wall-clock dates and durable occurrence progress', () => {
    const startDate = Date.parse('2026-08-30T08:00:00+08:00');
    const dueDate = Date.parse('2026-08-30T09:00:00+08:00');
    const result = completeTaskRecurrence({ startDate, dueDate, recurrence: daily }, dueDate + 1);

    expect(result).toMatchObject({ rolled: true, exhausted: false });
    expect(new Date(result.startDate!).toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(new Date(result.dueDate!).toISOString()).toBe('2026-08-31T01:00:00.000Z');
    expect(result.recurrence.completedCount).toBe(1);
  });

  it('supports completion-relative rollover while preserving a start/due duration', () => {
    const startDate = Date.parse('2026-08-30T08:00:00+08:00');
    const dueDate = Date.parse('2026-08-30T09:00:00+08:00');
    const completedAt = Date.parse('2026-08-31T14:00:00+08:00');
    const result = completeTaskRecurrence(
      {
        startDate,
        dueDate,
        recurrence: { ...daily, interval: 2, rollover: 'from_completion' },
      },
      completedAt,
    );

    expect(new Date(result.startDate!).toISOString()).toBe('2026-09-02T05:00:00.000Z');
    expect(new Date(result.dueDate!).toISOString()).toBe('2026-09-02T06:00:00.000Z');
  });

  it('uses ISO weekdays and monthly calendar days without losing local time', () => {
    const friday = Date.parse('2026-08-28T09:30:00+08:00');
    const weekly = { ...daily, frequency: 'weekly' as const, byWeekday: [1, 3, 5] };
    expect(new Date(nextTaskRecurrenceAt(friday, weekly)!).toISOString()).toBe(
      '2026-08-31T01:30:00.000Z',
    );

    const january31 = Date.parse('2026-01-31T09:30:00+08:00');
    const monthly = { ...daily, frequency: 'monthly' as const, byMonthDay: [31] };
    expect(new Date(nextTaskRecurrenceAt(january31, monthly)!).toISOString()).toBe(
      '2026-03-31T01:30:00.000Z',
    );
  });

  it('uses every selector in the active week/month before applying an interval jump', () => {
    const monday = Date.parse('2026-08-31T09:30:00+08:00');
    const biweekly = {
      ...daily,
      frequency: 'weekly' as const,
      interval: 2,
      byWeekday: [1, 5],
    };
    const friday = nextTaskRecurrenceAt(monday, biweekly)!;
    expect(new Date(friday).toISOString()).toBe('2026-09-04T01:30:00.000Z');
    expect(new Date(nextTaskRecurrenceAt(friday, biweekly)!).toISOString()).toBe(
      '2026-09-14T01:30:00.000Z',
    );

    const first = Date.parse('2026-09-01T09:30:00+08:00');
    const bimonthly = {
      ...daily,
      frequency: 'monthly' as const,
      interval: 2,
      byMonthDay: [1, 15],
    };
    const fifteenth = nextTaskRecurrenceAt(first, bimonthly)!;
    expect(new Date(fifteenth).toISOString()).toBe('2026-09-15T01:30:00.000Z');
    expect(new Date(nextTaskRecurrenceAt(fifteenth, bimonthly)!).toISOString()).toBe(
      '2026-11-01T01:30:00.000Z',
    );
  });

  it('moves nonexistent DST wall times forward and uses the first real instant of a day', () => {
    const beforeGap = Date.parse('2026-03-07T07:30:00Z'); // 02:30 America/New_York
    const next = nextTaskRecurrenceAt(beforeGap, {
      ...daily,
      timezone: 'America/New_York',
    });
    expect(new Date(next!).toISOString()).toBe('2026-03-08T07:30:00.000Z'); // 03:30 EDT

    const context = buildFocusLinkTimeContext(
      Date.parse('2026-09-06T12:00:00Z'),
      'America/Santiago',
    );
    expect(context.localDate).toBe('2026-09-06');
    expect(new Date(context.dayStart).toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santiago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(context.dayStart),
    ).toContain('01');
  });

  it('exhausts at count/endAt and restores only the final completed occurrence', () => {
    const dueDate = Date.parse('2026-08-30T09:00:00+08:00');
    const countResult = completeTaskRecurrence(
      {
        startDate: null,
        dueDate,
        recurrence: { ...daily, count: 2, completedCount: 1 },
      },
      dueDate,
    );
    expect(countResult).toMatchObject({ rolled: false, exhausted: true });
    expect(countResult.recurrence.completedCount).toBe(2);
    expect(
      completeTaskRecurrence(
        {
          startDate: countResult.startDate,
          dueDate: countResult.dueDate,
          recurrence: countResult.recurrence,
        },
        dueDate + 1,
      ),
    ).toEqual(countResult);
    expect(restoreFinalTaskRecurrence(countResult.recurrence).completedCount).toBe(1);

    const endResult = completeTaskRecurrence(
      {
        startDate: null,
        dueDate,
        recurrence: { ...daily, endAt: dueDate + 1_000 },
      },
      dueDate,
    );
    expect(endResult).toMatchObject({ rolled: false, exhausted: true });
  });

  it('requires canonical selectors, timezone, and frequency-specific fields', () => {
    expect(normalizeTaskRecurrence(daily)).toEqual(daily);
    expect(normalizeTaskRecurrence({ ...daily, timezone: 'Not/AZone' })).toBeNull();
    expect(normalizeTaskRecurrence({ ...daily, byWeekday: [1] })).toBeNull();
    expect(
      normalizeTaskRecurrence({ ...daily, frequency: 'weekly', byWeekday: [3, 1] }),
    ).toBeNull();
  });
});
