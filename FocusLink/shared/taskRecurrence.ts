import type { TaskRecurrence, TaskRecurrenceDefinition, TaskRecurrenceFrequency } from './types';
import { DEVICE_SYNC_MAX_TIMESTAMP_MS } from './sync/deviceProtocol';

const MAX_TIME_ZONE_LENGTH = 100;
const MAX_INTERVAL = 999;
const MAX_OCCURRENCE_COUNT = 1_000_000;

export interface RecurringTaskDates {
  startDate: number | null;
  dueDate: number | null;
  recurrence: TaskRecurrence;
}

export interface TaskRecurrenceCompletion {
  startDate: number | null;
  dueDate: number | null;
  recurrence: TaskRecurrence;
  rolled: boolean;
  exhausted: boolean;
}

export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export function isValidTaskTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TIME_ZONE_LENGTH) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeTaskRecurrence(value: unknown): TaskRecurrence | null {
  if (!isRecord(value)) return null;
  const definition = normalizeTaskRecurrenceDefinition({
    timezone: value.timezone,
    frequency: value.frequency,
    interval: value.interval,
    byWeekday: value.byWeekday,
    byMonthDay: value.byMonthDay,
    endAt: value.endAt,
    count: value.count,
    rollover: value.rollover,
  });
  if (
    !hasExactKeys(value, [
      'timezone',
      'frequency',
      'interval',
      'byWeekday',
      'byMonthDay',
      'endAt',
      'count',
      'completedCount',
      'rollover',
    ]) ||
    !isIntegerInRange(value.completedCount, 0, MAX_OCCURRENCE_COUNT) ||
    definition === null
  ) {
    return null;
  }
  if (definition.count !== null && value.completedCount > definition.count) return null;
  return {
    ...definition,
    completedCount: value.completedCount,
  };
}

export function normalizeTaskRecurrenceDefinition(value: unknown): TaskRecurrenceDefinition | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'timezone',
      'frequency',
      'interval',
      'byWeekday',
      'byMonthDay',
      'endAt',
      'count',
      'rollover',
    ]) ||
    !isValidTaskTimeZone(value.timezone) ||
    !isTaskRecurrenceFrequency(value.frequency) ||
    !isIntegerInRange(value.interval, 1, MAX_INTERVAL) ||
    !isCanonicalIntegerList(value.byWeekday, 1, 7) ||
    !isCanonicalIntegerList(value.byMonthDay, 1, 31) ||
    !(value.endAt === null || isTimestamp(value.endAt)) ||
    !(value.count === null || isIntegerInRange(value.count, 1, MAX_OCCURRENCE_COUNT)) ||
    (value.rollover !== 'from_schedule' && value.rollover !== 'from_completion')
  ) {
    return null;
  }
  if (value.frequency !== 'weekly' && value.byWeekday.length > 0) return null;
  if (value.frequency !== 'monthly' && value.byMonthDay.length > 0) return null;
  return {
    timezone: value.timezone,
    frequency: value.frequency,
    interval: value.interval,
    byWeekday: [...value.byWeekday],
    byMonthDay: [...value.byMonthDay],
    endAt: value.endAt,
    count: value.count,
    rollover: value.rollover,
  };
}

export function parseStoredTaskRecurrence(value: string | null | undefined): TaskRecurrence | null {
  if (!value) return null;
  try {
    return normalizeTaskRecurrence(JSON.parse(value));
  } catch {
    return null;
  }
}

export function completeTaskRecurrence(
  task: RecurringTaskDates,
  completedAt: number,
): TaskRecurrenceCompletion {
  if (!isTimestamp(completedAt)) throw new Error('任务完成时间无效');
  const recurrence = normalizeTaskRecurrence(task.recurrence);
  if (!recurrence) throw new Error('任务循环规则无效');
  if (recurrence.count !== null && recurrence.completedCount >= recurrence.count) {
    return { ...task, recurrence, rolled: false, exhausted: true };
  }
  if (recurrence.completedCount >= MAX_OCCURRENCE_COUNT) {
    return { ...task, recurrence, rolled: false, exhausted: true };
  }
  const completedCount = recurrence.completedCount + 1;
  const progressed = { ...recurrence, completedCount };
  if (recurrence.count !== null && completedCount >= recurrence.count) {
    return { ...task, recurrence: progressed, rolled: false, exhausted: true };
  }

  const scheduledAnchor = task.dueDate ?? task.startDate;
  const anchor = recurrence.rollover === 'from_completion' ? completedAt : scheduledAnchor;
  if (anchor === null) {
    return { ...task, recurrence: progressed, rolled: false, exhausted: true };
  }
  const nextAnchor = nextTaskRecurrenceAt(anchor, recurrence);
  if (nextAnchor === null || (recurrence.endAt !== null && nextAnchor > recurrence.endAt)) {
    return { ...task, recurrence: progressed, rolled: false, exhausted: true };
  }
  const scheduledDelta = nextAnchor - (scheduledAnchor ?? anchor);
  const duration =
    task.startDate !== null && task.dueDate !== null ? task.dueDate - task.startDate : 0;
  const completionRelativeStart =
    task.startDate === null
      ? null
      : recurrence.rollover === 'from_completion'
        ? task.dueDate === null
          ? nextAnchor
          : nextAnchor - duration
        : task.startDate + scheduledDelta;
  const completionRelativeDue =
    task.dueDate === null
      ? null
      : recurrence.rollover === 'from_completion'
        ? nextAnchor
        : task.dueDate + scheduledDelta;
  return {
    startDate: completionRelativeStart,
    dueDate: completionRelativeDue,
    recurrence: progressed,
    rolled: true,
    exhausted: false,
  };
}

export function restoreFinalTaskRecurrence(recurrence: TaskRecurrence): TaskRecurrence {
  return {
    ...recurrence,
    completedCount: Math.max(0, recurrence.completedCount - 1),
  };
}

export function nextTaskRecurrenceAt(anchor: number, recurrence: TaskRecurrence): number | null {
  if (!isTimestamp(anchor)) return null;
  const parts = zonedDateTimeParts(anchor, recurrence.timezone);
  switch (recurrence.frequency) {
    case 'daily':
      return zonedDateTimeToEpoch(
        addUtcCalendar(parts, { days: recurrence.interval }),
        recurrence.timezone,
      );
    case 'weekly':
      return nextWeeklyOccurrence(parts, recurrence);
    case 'monthly':
      return nextMonthlyOccurrence(parts, recurrence);
    case 'yearly':
      return nextYearlyOccurrence(parts, recurrence);
  }
}

function nextWeeklyOccurrence(
  parts: ZonedDateTimeParts,
  recurrence: TaskRecurrence,
): number | null {
  const currentWeekday = isoWeekday(parts.year, parts.month, parts.day);
  const weekdays = recurrence.byWeekday.length > 0 ? recurrence.byWeekday : [currentWeekday];
  const laterThisWeek = weekdays.find((weekday) => weekday > currentWeekday);
  const days =
    laterThisWeek !== undefined
      ? laterThisWeek - currentWeekday
      : recurrence.interval * 7 - (currentWeekday - weekdays[0]!);
  return zonedDateTimeToEpoch(addUtcCalendar(parts, { days }), recurrence.timezone);
}

function nextMonthlyOccurrence(
  parts: ZonedDateTimeParts,
  recurrence: TaskRecurrence,
): number | null {
  const monthDays = recurrence.byMonthDay.length > 0 ? recurrence.byMonthDay : [parts.day];
  const sameMonth = monthDays.find(
    (day) => day > parts.day && isCalendarDate(parts.year, parts.month, day),
  );
  if (sameMonth !== undefined) {
    return zonedDateTimeToEpoch({ ...parts, day: sameMonth }, recurrence.timezone);
  }
  for (let attempt = 1; attempt <= 1_200; attempt += 1) {
    const target = addUtcCalendar(parts, { months: recurrence.interval * attempt, day: 1 });
    const day = monthDays.find((candidate) => isCalendarDate(target.year, target.month, candidate));
    if (day !== undefined) {
      return zonedDateTimeToEpoch({ ...target, day }, recurrence.timezone);
    }
  }
  return null;
}

function nextYearlyOccurrence(
  parts: ZonedDateTimeParts,
  recurrence: TaskRecurrence,
): number | null {
  for (let attempt = 1; attempt <= 400; attempt += 1) {
    const year = parts.year + recurrence.interval * attempt;
    if (!isCalendarDate(year, parts.month, parts.day)) continue;
    return zonedDateTimeToEpoch({ ...parts, year }, recurrence.timezone);
  }
  return null;
}

export function zonedDateTimeParts(timestamp: number, timeZone: string): ZonedDateTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    second: values.second!,
    millisecond: ((timestamp % 1_000) + 1_000) % 1_000,
  };
}

export function zonedDateTimeToEpoch(parts: ZonedDateTimeParts, timeZone: string): number {
  const targetAsUtc = calendarPartsAsUtc(parts);
  const offsets = new Set<number>();
  for (const deltaHours of [-36, -12, 0, 12, 36]) {
    offsets.add(timeZoneOffsetMinutesAt(targetAsUtc + deltaHours * 60 * 60 * 1_000, timeZone));
  }
  const candidates = [...offsets].map((offsetMinutes) => {
    const epoch = targetAsUtc - offsetMinutes * 60_000;
    const observed = zonedDateTimeParts(epoch, timeZone);
    return { epoch, localDelta: calendarPartsAsUtc(observed) - targetAsUtc };
  });
  const exact = candidates
    .filter((candidate) => candidate.localDelta === 0)
    .sort((left, right) => left.epoch - right.epoch)[0];
  if (exact) return exact.epoch;
  const afterGap = candidates
    .filter((candidate) => candidate.localDelta > 0)
    .sort((left, right) => left.localDelta - right.localDelta || left.epoch - right.epoch)[0];
  if (afterGap) return afterGap.epoch;
  throw new Error('任务循环时间无法映射到指定时区');
}

function addUtcCalendar(
  parts: ZonedDateTimeParts,
  input: { days?: number; months?: number; day?: number },
): ZonedDateTimeParts {
  const date = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1 + (input.months ?? 0),
      input.day ?? parts.day + (input.days ?? 0),
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };
}

function calendarPartsAsUtc(parts: ZonedDateTimeParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

function timeZoneOffsetMinutesAt(timestamp: number, timeZone: string): number {
  const observed = zonedDateTimeParts(timestamp, timeZone);
  const truncated = Math.trunc(timestamp / 1_000) * 1_000;
  return Math.round((calendarPartsAsUtc(observed) - truncated) / 60_000);
}

function isoWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isTaskRecurrenceFrequency(value: unknown): value is TaskRecurrenceFrequency {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly';
}

function isCanonicalIntegerList(value: unknown, min: number, max: number): value is number[] {
  if (!Array.isArray(value) || value.length > max - min + 1) return false;
  let previous = min - 1;
  for (const entry of value) {
    if (!isIntegerInRange(entry, min, max) || entry <= previous) return false;
    previous = entry;
  }
  return true;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= DEVICE_SYNC_MAX_TIMESTAMP_MS
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return (
    Object.keys(value).length === keys.length && Object.keys(value).every((key) => allowed.has(key))
  );
}
