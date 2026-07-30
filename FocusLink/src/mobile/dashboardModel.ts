import {
  buildDayLedger,
  type DayLedgerAnalytics,
  type DayLedgerTask,
} from '@shared/dayLedgerAnalytics';
import type { CachedBundle } from './cache';

export type MobileStatsRange = 'today' | '7d' | '30d';

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
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === '7d') start.setDate(start.getDate() - 6);
  if (range === '30d') start.setDate(start.getDate() - 29);
  return { start: start.getTime(), end: end.getTime() };
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
