import {
  buildDayLedger,
  type DayLedgerAnalytics,
  type DayLedgerInterval,
  type DayLedgerTask,
} from '@shared/dayLedgerAnalytics';
import type { SyncedTask } from '@shared/sync/taskSnapshotProtocol';
import type { CachedBundle } from './cache';

export type MobileStatsRange =
  'today' | 'yesterday' | '7d' | 'previous-7d' | '30d' | 'previous-30d';

export type MobileTimelineTaskState =
  'completed' | 'pending' | 'missing' | 'unknown' | 'unlinked' | 'not-applicable';

export interface MobileTimelineTaskDetail {
  key: string;
  title: string;
  state: MobileTimelineTaskState;
}

export interface MobileDashboardTotals {
  focusMs: number;
  pauseMs: number;
  gapMs: number;
  observationMs: number;
  estimatedFocusMs: number;
  estimatedPauseMs: number;
}

export interface MobileDashboardAnalytics {
  range: { start: number; end: number };
  dayLedgers: DayLedgerAnalytics[];
  tasks: DayLedgerTask[];
  totals: MobileDashboardTotals;
  activeDays: number;
  estimated: boolean;
}

export function mobileStatsRange(
  range: MobileStatsRange,
  now = Date.now(),
): { start: number; end: number } {
  const today = startOfLocalDay(now);
  const tomorrow = shiftLocalDays(today, 1);
  switch (range) {
    case 'today':
      return { start: today, end: tomorrow };
    case 'yesterday':
      return { start: shiftLocalDays(today, -1), end: today };
    case '7d':
      return { start: shiftLocalDays(today, -6), end: tomorrow };
    case 'previous-7d':
      return { start: shiftLocalDays(today, -13), end: shiftLocalDays(today, -6) };
    case '30d':
      return { start: shiftLocalDays(today, -29), end: tomorrow };
    case 'previous-30d':
      return { start: shiftLocalDays(today, -59), end: shiftLocalDays(today, -29) };
  }
}

/** Converts inclusive local calendar dates to the half-open range used by the shared ledger. */
export function mobileCustomStatsRange(
  startDate: string,
  endDate: string,
): { start: number; end: number } | null {
  const start = parseLocalDate(startDate);
  const inclusiveEnd = parseLocalDate(endDate);
  if (start === null || inclusiveEnd === null || inclusiveEnd < start) return null;
  return { start, end: shiftLocalDays(inclusiveEnd, 1) };
}

/**
 * The mobile renderer deliberately consumes the shared effective-day ledger.
 * Exact gap intervals are produced only by buildDayLedger and are never
 * reconstructed from session wall time in this layer.
 */
export function buildMobileDashboard(
  records: readonly CachedBundle[],
  range: MobileStatsRange,
  now = Date.now(),
): MobileDashboardAnalytics {
  return buildMobileDashboardInRange(records, mobileStatsRange(range, now), now);
}

export function buildMobileDashboardInRange(
  records: readonly CachedBundle[],
  bounds: { start: number; end: number },
  now = Date.now(),
): MobileDashboardAnalytics {
  const source = {
    sessions: records.map((record) => record.bundle.session),
    segments: records.flatMap((record) =>
      record.bundle.segments.map((segment) => ({ ...segment, cloudFocusId: null })),
    ),
    pauses: records.flatMap((record) => record.bundle.pauses),
  };
  const dayLedgers = localDayStarts(bounds).map((day) => buildDayLedger({ day, now }, source));
  const totals = dayLedgers.reduce<MobileDashboardTotals>(
    (result, ledger) => ({
      focusMs: result.focusMs + ledger.totals.focusMs,
      pauseMs: result.pauseMs + ledger.totals.pauseMs,
      gapMs: result.gapMs + ledger.totals.gapMs,
      observationMs: result.observationMs + ledger.totals.observationMs,
      estimatedFocusMs: result.estimatedFocusMs + ledger.totals.estimatedFocusMs,
      estimatedPauseMs: result.estimatedPauseMs + ledger.totals.estimatedPauseMs,
    }),
    {
      focusMs: 0,
      pauseMs: 0,
      gapMs: 0,
      observationMs: 0,
      estimatedFocusMs: 0,
      estimatedPauseMs: 0,
    },
  );

  return {
    range: bounds,
    dayLedgers,
    tasks: mergeLedgerTasks(dayLedgers),
    totals,
    activeDays: dayLedgers.filter(
      (ledger) => ledger.totals.focusMs + ledger.totals.estimatedFocusMs > 0,
    ).length,
    estimated: dayLedgers.some((ledger) => ledger.estimated),
  };
}

export function selectMobileDashboardLedger(
  ledgers: readonly DayLedgerAnalytics[],
  selectedDate: string | null,
): DayLedgerAnalytics | undefined {
  if (selectedDate) return ledgers.find((ledger) => ledger.date === selectedDate);
  for (let index = ledgers.length - 1; index >= 0; index -= 1) {
    if (ledgers[index].status !== 'not-started') return ledgers[index];
  }
  return ledgers.at(-1);
}

/** Half-open interval lookup keeps adjacent timeline bars unambiguous at their shared boundary. */
export function mobileTimelineIntervalAt(
  intervals: readonly DayLedgerInterval[],
  timestamp: number,
): DayLedgerInterval | undefined {
  return intervals.find(
    (interval) => timestamp >= interval.startedAt && timestamp < interval.endedAt,
  );
}

/**
 * Resolve a timeline interval against the current task snapshot. Session state is intentionally
 * ignored: a finished focus session does not imply that its linked task is complete.
 */
export function resolveMobileTimelineTasks(
  interval: DayLedgerInterval,
  records: readonly CachedBundle[],
  tasks: readonly SyncedTask[] | null,
): MobileTimelineTaskDetail[] {
  if (interval.kind === 'gap') {
    return [{ key: 'gap', title: '观察空档', state: 'not-applicable' }];
  }

  const segments = records.flatMap((record) => record.bundle.segments);
  const segmentsById = new Map(segments.map((segment) => [segment.id, segment] as const));
  const pausesById = new Map(
    records.flatMap((record) => record.bundle.pauses).map((pause) => [pause.id, pause] as const),
  );
  const sourceSegments =
    interval.kind === 'focus'
      ? interval.sourceIds.flatMap((sourceId) => {
          const segment = segmentsById.get(sourceId);
          return segment ? [segment] : [];
        })
      : interval.sourceIds.flatMap((sourceId) => {
          const segmentId = pausesById.get(sourceId)?.segmentId;
          const segment = segmentId ? segmentsById.get(segmentId) : undefined;
          return segment ? [segment] : [];
        });

  if (sourceSegments.length === 0) {
    return [
      {
        key: `${interval.kind}:unlinked`,
        title: interval.kind === 'pause' ? '暂停区间' : '未关联任务',
        state: interval.kind === 'pause' ? 'not-applicable' : 'unlinked',
      },
    ];
  }

  const currentTasks = new Map(
    (tasks ?? []).map((task) => [`${task.source}:${task.id}`, task] as const),
  );
  const details = new Map<string, MobileTimelineTaskDetail>();
  for (const segment of sourceSegments) {
    const historicalTitle = segment.title?.trim() || '未关联任务';
    if (!segment.taskId) {
      details.set(`unlinked:${historicalTitle}`, {
        key: `unlinked:${historicalTitle}`,
        title: historicalTitle,
        state: 'unlinked',
      });
      continue;
    }

    const source = segment.taskSource;
    const key = source ? `${source}:${segment.taskId}` : `unknown:${segment.taskId}`;
    const current = source ? currentTasks.get(`${source}:${segment.taskId}`) : undefined;
    details.set(key, {
      key,
      title: current?.title.trim() || historicalTitle,
      state:
        tasks === null
          ? 'unknown'
          : current
            ? current.isCompleted
              ? 'completed'
              : 'pending'
            : 'missing',
    });
  }
  return Array.from(details.values());
}

function localDayStarts(bounds: { start: number; end: number }): number[] {
  if (!Number.isFinite(bounds.start) || !Number.isFinite(bounds.end) || bounds.end < bounds.start) {
    return [];
  }
  const cursor = new Date(bounds.start);
  cursor.setHours(0, 0, 0, 0);
  const finalDay = new Date(Math.max(bounds.start, bounds.end - 1));
  finalDay.setHours(0, 0, 0, 0);
  const result: number[] = [];
  while (cursor.getTime() <= finalDay.getTime()) {
    result.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function startOfLocalDay(timestamp: number): number {
  const value = new Date(timestamp);
  value.setHours(0, 0, 0, 0);
  return value.getTime();
}

function shiftLocalDays(timestamp: number, amount: number): number {
  const value = new Date(startOfLocalDay(timestamp));
  value.setDate(value.getDate() + amount);
  return value.getTime();
}

function parseLocalDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getTime();
}

function mergeLedgerTasks(dayLedgers: readonly DayLedgerAnalytics[]): DayLedgerTask[] {
  const tasks = new Map<string, DayLedgerTask>();
  for (const ledger of dayLedgers) {
    for (const task of ledger.tasks) {
      const current = tasks.get(task.key);
      tasks.set(
        task.key,
        current
          ? {
              ...current,
              activeMs: current.activeMs + task.activeMs,
              segmentCount: current.segmentCount + task.segmentCount,
            }
          : { ...task },
      );
    }
  }
  return Array.from(tasks.values()).sort(
    (left, right) => right.activeMs - left.activeMs || left.title.localeCompare(right.title),
  );
}
