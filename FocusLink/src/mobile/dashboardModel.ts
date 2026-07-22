import { buildSessionAnalytics } from '@shared/sessionAnalytics';
import type { SessionAnalyticsResult } from '@shared/ipc/api';
import type { CachedBundle } from './cache';

export type MobileStatsRange = 'today' | '7d' | '30d';

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

export function buildMobileDashboard(
  records: readonly CachedBundle[],
  range: MobileStatsRange,
  now = Date.now(),
): SessionAnalyticsResult {
  const bounds = mobileStatsRange(range, now);
  return buildMobileDashboardInRange(records, bounds, range === 'today');
}

export function buildMobileDashboardInRange(
  records: readonly CachedBundle[],
  bounds: { start: number; end: number },
  includeTimeline = true,
): SessionAnalyticsResult {
  const sessions = records.map((record) => record.bundle.session);
  const segments = records.flatMap((record) =>
    record.bundle.segments.map((segment) => ({ ...segment, cloudFocusId: null })),
  );
  const pauses = records.flatMap((record) => record.bundle.pauses);
  return buildSessionAnalytics(
    {
      ...bounds,
      timelineStart: includeTimeline ? bounds.start : undefined,
      timelineEnd: includeTimeline ? bounds.end : undefined,
    },
    { sessions, segments, pauses },
  );
}
