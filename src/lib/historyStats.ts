import type { FocusSession } from '@shared/types';

export type RangePreset = 'today' | 'yesterday' | '7d' | '15d' | '30d' | 'custom';

export interface TimeRange {
  start: number;
  end: number;
}

export interface SessionSummary {
  count: number;
  active: number;
  pause: number;
  wall: number;
}

export interface PeriodSummary {
  label: string;
  active: number;
  count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function summarizeSessions(sessions: FocusSession[]): SessionSummary {
  return sessions.reduce(
    (acc, session) => ({
      count: acc.count + 1,
      active: acc.active + session.activeElapsedMs,
      pause: acc.pause + session.pauseElapsedMs,
      wall: acc.wall + session.wallElapsedMs,
    }),
    { count: 0, active: 0, pause: 0, wall: 0 }
  );
}

export function getRange(
  preset: RangePreset,
  customStart: string,
  customEnd: string,
  now = Date.now()
): TimeRange {
  if (preset === 'today') return { start: startOfDay(now), end: endOfDay(now) };
  if (preset === 'yesterday') {
    const y = now - DAY_MS;
    return { start: startOfDay(y), end: endOfDay(y) };
  }
  if (preset === 'custom') {
    const start = Date.parse(customStart + 'T00:00:00');
    const end = Date.parse(customEnd + 'T23:59:59.999');
    return {
      start: Number.isNaN(start) ? startOfDay(now) : start,
      end: Number.isNaN(end) ? endOfDay(now) : end,
    };
  }
  const days = preset === '7d' ? 7 : preset === '15d' ? 15 : 30;
  return { start: startOfDay(now - (days - 1) * DAY_MS), end: endOfDay(now) };
}

export function filterSessionsByRange(sessions: FocusSession[], range: TimeRange): FocusSession[] {
  return sessions.filter((session) => session.startedAt >= range.start && session.startedAt <= range.end);
}

export function groupByDay(sessions: FocusSession[], range?: TimeRange): PeriodSummary[] {
  const map = groupSessions(sessions, (session) => formatDayLabel(session.startedAt));
  if (range) {
    for (const label of enumerateDayLabels(range)) {
      if (!map.has(label)) map.set(label, { label, active: 0, count: 0 });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.label.localeCompare(a.label));
}

export function groupByWeek(sessions: FocusSession[], range?: TimeRange): PeriodSummary[] {
  const map = groupSessions(sessions, (session) => formatWeekLabel(session.startedAt));
  if (range) {
    for (const label of enumerateWeekLabels(range)) {
      if (!map.has(label)) map.set(label, { label, active: 0, count: 0 });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.label.localeCompare(a.label));
}

function groupSessions(
  sessions: FocusSession[],
  getLabel: (session: FocusSession) => string
): Map<string, PeriodSummary> {
  const map = new Map<string, PeriodSummary>();
  for (const session of sessions) {
    const label = getLabel(session);
    const item = map.get(label) ?? { label, active: 0, count: 0 };
    item.active += session.activeElapsedMs;
    item.count += 1;
    map.set(label, item);
  }
  return map;
}

function enumerateDayLabels(range: TimeRange): string[] {
  const labels: string[] = [];
  for (let day = startOfDay(range.start); day <= range.end; day += DAY_MS) {
    labels.push(formatDayLabel(day));
  }
  return labels;
}

function enumerateWeekLabels(range: TimeRange): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (let day = startOfDay(range.start); day <= range.end; day += DAY_MS) {
    const label = formatWeekLabel(day);
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function toDateInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatShortDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function formatDayLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatWeekLabel(ts: number): string {
  const d = new Date(startOfDay(ts));
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return `${d.getFullYear()} W${String(getWeekNumber(d)).padStart(2, '0')}`;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}
