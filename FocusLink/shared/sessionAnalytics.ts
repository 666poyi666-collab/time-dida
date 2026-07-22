import type { FocusSegment, FocusSession, PauseEvent } from './types';
import type {
  SessionAnalyticsDaily,
  SessionAnalyticsHourly,
  SessionAnalyticsRange,
  SessionAnalyticsResult,
  SessionAnalyticsSubject,
  SessionAnalyticsTask,
  SessionAnalyticsTimelineItem,
} from './ipc/api';
import { ALL_SUBJECTS, resolveSegmentSubject, TOMATODO_FALLBACK_SUBJECT } from './tomatodoPolicy';

export interface SessionAnalyticsSource {
  sessions: FocusSession[];
  segments: FocusSegment[];
  pauses: PauseEvent[];
}

function startOfLocalDay(timestamp: number): number {
  const value = new Date(timestamp);
  value.setHours(0, 0, 0, 0);
  return value.getTime();
}

function endOfLocalDay(timestamp: number): number {
  const value = new Date(timestamp);
  value.setHours(23, 59, 59, 999);
  return value.getTime();
}

function dayKey(timestamp: number): string {
  const value = new Date(timestamp);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function enumerateDays(start: number, end: number): number[] {
  const result: number[] = [];
  const cursor = new Date(startOfLocalDay(start));
  const last = endOfLocalDay(end);
  while (cursor.getTime() <= last) {
    result.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function effectiveEnd(start: number, end: number | null, durationMs: number): number {
  return Math.max(start, end ?? start + Math.max(0, durationMs));
}

function overlaps(start: number, end: number, rangeStart: number, rangeEnd: number): boolean {
  return start <= rangeEnd && end >= rangeStart;
}

function clippedDuration(start: number, end: number, rangeStart: number, rangeEnd: number): number {
  return Math.max(0, Math.min(end, rangeEnd + 1) - Math.max(start, rangeStart));
}

function addIntervalToDays(
  dailyMap: Map<string, SessionAnalyticsDaily>,
  start: number,
  end: number,
  field: 'activeMs' | 'pauseMs' | 'wallMs',
): void {
  if (end <= start) return;
  let cursor = start;
  while (cursor < end) {
    const nextDay = new Date(cursor);
    nextDay.setHours(24, 0, 0, 0);
    const sliceEnd = Math.min(end, nextDay.getTime());
    const item = dailyMap.get(dayKey(cursor));
    if (item) item[field] += sliceEnd - cursor;
    cursor = sliceEnd;
  }
}

function addRecordedValueToDays(
  dailyMap: Map<string, SessionAnalyticsDaily>,
  start: number,
  end: number,
  rangeStart: number,
  rangeEnd: number,
  recordedMs: number,
  field: 'activeMs' | 'pauseMs',
): void {
  const fullSpan = Math.max(1, end - start);
  let cursor = Math.max(start, rangeStart);
  const clippedEnd = Math.min(end, rangeEnd + 1);
  while (cursor < clippedEnd) {
    const nextDay = new Date(cursor);
    nextDay.setHours(24, 0, 0, 0);
    const sliceEnd = Math.min(clippedEnd, nextDay.getTime());
    const item = dailyMap.get(dayKey(cursor));
    if (item) item[field] += recordedMs * ((sliceEnd - cursor) / fullSpan);
    cursor = sliceEnd;
  }
}

function addRecordedValueToHours(
  hourly: SessionAnalyticsHourly[],
  start: number,
  end: number,
  rangeStart: number,
  rangeEnd: number,
  recordedMs: number,
  field: 'activeMs' | 'pauseMs',
): void {
  const fullSpan = Math.max(1, end - start);
  let cursor = Math.max(start, rangeStart);
  const clippedEnd = Math.min(end, rangeEnd + 1);
  while (cursor < clippedEnd) {
    const nextHour = new Date(cursor);
    nextHour.setMinutes(60, 0, 0);
    const sliceEnd = Math.min(clippedEnd, nextHour.getTime());
    hourly[new Date(cursor).getHours()][field] += recordedMs * ((sliceEnd - cursor) / fullSpan);
    cursor = sliceEnd;
  }
}

function clippedRecordedDuration(
  start: number,
  end: number,
  rangeStart: number,
  rangeEnd: number,
  recordedMs: number,
): number {
  const fullSpan = Math.max(1, end - start);
  return recordedMs * (clippedDuration(start, end, rangeStart, rangeEnd) / fullSpan);
}

function addProportionalSessionValue(
  dailyMap: Map<string, SessionAnalyticsDaily>,
  session: FocusSession,
  rangeStart: number,
  rangeEnd: number,
  amount: number,
  field: 'activeMs' | 'pauseMs',
): void {
  const end = effectiveEnd(session.startedAt, session.endedAt, session.wallElapsedMs);
  const fullSpan = Math.max(1, end - session.startedAt);
  let cursor = Math.max(session.startedAt, rangeStart);
  const clippedEnd = Math.min(end, rangeEnd + 1);
  while (cursor < clippedEnd) {
    const nextDay = new Date(cursor);
    nextDay.setHours(24, 0, 0, 0);
    const sliceEnd = Math.min(clippedEnd, nextDay.getTime());
    const item = dailyMap.get(dayKey(cursor));
    if (item) item[field] += amount * ((sliceEnd - cursor) / fullSpan);
    cursor = sliceEnd;
  }
}

function normalizeRange(range: SessionAnalyticsRange): SessionAnalyticsRange {
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  const timelineStart =
    range.timelineStart === undefined || range.timelineEnd === undefined
      ? undefined
      : Math.min(range.timelineStart, range.timelineEnd);
  const timelineEnd =
    range.timelineStart === undefined || range.timelineEnd === undefined
      ? undefined
      : Math.max(range.timelineStart, range.timelineEnd);
  return { start, end, timelineStart, timelineEnd };
}

export function buildSessionAnalytics(
  requestedRange: SessionAnalyticsRange,
  source: SessionAnalyticsSource,
): SessionAnalyticsResult {
  const range = normalizeRange(requestedRange);
  const sessions = source.sessions
    .filter((session) =>
      overlaps(
        session.startedAt,
        effectiveEnd(session.startedAt, session.endedAt, session.wallElapsedMs),
        range.start,
        range.end,
      ),
    )
    .sort((left, right) => right.startedAt - left.startedAt);
  const sessionIds = new Set(sessions.map((session) => session.id));
  const segments = source.segments.filter((segment) => {
    const end = effectiveEnd(segment.startedAt, segment.endedAt, segment.activeElapsedMs);
    return (
      sessionIds.has(segment.sessionId) && overlaps(segment.startedAt, end, range.start, range.end)
    );
  });
  const pauses = source.pauses.filter((pause) => {
    const end = effectiveEnd(pause.pauseStartedAt, pause.pauseEndedAt, pause.durationMs);
    return (
      sessionIds.has(pause.sessionId) && overlaps(pause.pauseStartedAt, end, range.start, range.end)
    );
  });

  const dailyMap = new Map<string, SessionAnalyticsDaily>();
  for (const timestamp of enumerateDays(range.start, range.end)) {
    const date = dayKey(timestamp);
    dailyMap.set(date, {
      date,
      activeMs: 0,
      pauseMs: 0,
      wallMs: 0,
      sessionCount: 0,
    });
  }
  for (const session of sessions) {
    const end = effectiveEnd(session.startedAt, session.endedAt, session.wallElapsedMs);
    const clippedStart = Math.max(session.startedAt, range.start);
    const clippedEnd = Math.min(end, range.end + 1);
    addIntervalToDays(dailyMap, clippedStart, clippedEnd, 'wallMs');
    for (const timestamp of enumerateDays(clippedStart, Math.max(clippedStart, clippedEnd - 1))) {
      const item = dailyMap.get(dayKey(timestamp));
      if (item) item.sessionCount += 1;
    }
  }
  for (const segment of segments) {
    const end = effectiveEnd(segment.startedAt, segment.endedAt, segment.activeElapsedMs);
    addRecordedValueToDays(
      dailyMap,
      segment.startedAt,
      end,
      range.start,
      range.end,
      segment.activeElapsedMs,
      'activeMs',
    );
  }
  for (const pause of pauses) {
    const end = effectiveEnd(pause.pauseStartedAt, pause.pauseEndedAt, pause.durationMs);
    addRecordedValueToDays(
      dailyMap,
      pause.pauseStartedAt,
      end,
      range.start,
      range.end,
      pause.durationMs,
      'pauseMs',
    );
  }
  const segmentSessionIds = new Set(segments.map((segment) => segment.sessionId));
  const pauseSessionIds = new Set(pauses.map((pause) => pause.sessionId));
  for (const session of sessions) {
    if (!segmentSessionIds.has(session.id) && session.activeElapsedMs > 0) {
      addProportionalSessionValue(
        dailyMap,
        session,
        range.start,
        range.end,
        session.activeElapsedMs,
        'activeMs',
      );
    }
    if (!pauseSessionIds.has(session.id) && session.pauseElapsedMs > 0) {
      addProportionalSessionValue(
        dailyMap,
        session,
        range.start,
        range.end,
        session.pauseElapsedMs,
        'pauseMs',
      );
    }
  }
  const daily = Array.from(dailyMap.values()).sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  const hourly: SessionAnalyticsHourly[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    activeMs: 0,
    pauseMs: 0,
  }));

  for (const segment of segments) {
    const end = effectiveEnd(segment.startedAt, segment.endedAt, segment.activeElapsedMs);
    addRecordedValueToHours(
      hourly,
      segment.startedAt,
      end,
      range.start,
      range.end,
      segment.activeElapsedMs,
      'activeMs',
    );
  }
  for (const pause of pauses) {
    const end = effectiveEnd(pause.pauseStartedAt, pause.pauseEndedAt, pause.durationMs);
    addRecordedValueToHours(
      hourly,
      pause.pauseStartedAt,
      end,
      range.start,
      range.end,
      pause.durationMs,
      'pauseMs',
    );
  }
  for (const session of sessions) {
    const end = effectiveEnd(session.startedAt, session.endedAt, session.wallElapsedMs);
    if (!segmentSessionIds.has(session.id) && session.activeElapsedMs > 0) {
      addRecordedValueToHours(
        hourly,
        session.startedAt,
        end,
        range.start,
        range.end,
        session.activeElapsedMs,
        'activeMs',
      );
    }
    if (!pauseSessionIds.has(session.id) && session.pauseElapsedMs > 0) {
      addRecordedValueToHours(
        hourly,
        session.startedAt,
        end,
        range.start,
        range.end,
        session.pauseElapsedMs,
        'pauseMs',
      );
    }
  }

  const taskMap = new Map<string, SessionAnalyticsTask>();
  for (const segment of segments) {
    const title = segment.title?.trim() || '未关联任务';
    const key = segment.taskId ?? `unlinked:${title}`;
    const item =
      taskMap.get(key) ??
      ({
        key,
        taskId: segment.taskId,
        title,
        activeMs: 0,
        segmentCount: 0,
      } satisfies SessionAnalyticsTask);
    const end = effectiveEnd(segment.startedAt, segment.endedAt, segment.activeElapsedMs);
    item.activeMs += clippedRecordedDuration(
      segment.startedAt,
      end,
      range.start,
      range.end,
      segment.activeElapsedMs,
    );
    item.segmentCount += 1;
    taskMap.set(key, item);
  }
  const tasks = Array.from(taskMap.values()).sort(
    (left, right) => right.activeMs - left.activeMs || left.title.localeCompare(right.title),
  );

  const subjectMap = new Map(
    ALL_SUBJECTS.map(
      (subject) =>
        [
          subject,
          { subject, activeMs: 0, segmentCount: 0 } satisfies SessionAnalyticsSubject,
        ] as const,
    ),
  );
  for (const segment of segments) {
    const end = effectiveEnd(segment.startedAt, segment.endedAt, segment.activeElapsedMs);
    const activeMs = clippedRecordedDuration(
      segment.startedAt,
      end,
      range.start,
      range.end,
      segment.activeElapsedMs,
    );
    if (activeMs <= 0) continue;
    const subject = resolveSegmentSubject(segment, TOMATODO_FALLBACK_SUBJECT);
    const item = subjectMap.get(subject);
    if (!item) continue;
    item.activeMs += activeMs;
    item.segmentCount += 1;
  }
  const subjects: SessionAnalyticsSubject[] = Array.from(subjectMap.values())
    .filter((item) => item.activeMs > 0)
    .sort(
      (left, right) => right.activeMs - left.activeMs || left.subject.localeCompare(right.subject),
    );

  const timelineStart = range.timelineStart ?? range.start;
  const timelineEnd = range.timelineEnd ?? range.end;
  const timelineSessionIds = new Set(
    sessions
      .filter((session) =>
        overlaps(
          session.startedAt,
          effectiveEnd(session.startedAt, session.endedAt, session.wallElapsedMs),
          timelineStart,
          timelineEnd,
        ),
      )
      .map((session) => session.id),
  );
  const timeline: SessionAnalyticsTimelineItem[] = [
    ...segments
      .filter((segment) => {
        const end = effectiveEnd(segment.startedAt, segment.endedAt, segment.activeElapsedMs);
        return (
          timelineSessionIds.has(segment.sessionId) &&
          overlaps(segment.startedAt, end, timelineStart, timelineEnd)
        );
      })
      .map((segment): SessionAnalyticsTimelineItem => {
        const end = effectiveEnd(segment.startedAt, segment.endedAt, segment.activeElapsedMs);
        const startedAt = Math.max(segment.startedAt, timelineStart);
        const clippedEnd = Math.min(end, timelineEnd + 1);
        return {
          id: segment.id,
          sessionId: segment.sessionId,
          kind: 'focus',
          title: segment.title?.trim() || '未关联任务',
          startedAt,
          endedAt: segment.endedAt === null && end <= timelineEnd ? null : clippedEnd,
          durationMs: clippedRecordedDuration(
            segment.startedAt,
            end,
            timelineStart,
            timelineEnd,
            segment.activeElapsedMs,
          ),
          taskId: segment.taskId,
        };
      }),
    ...pauses
      .filter((pause) => {
        const end = effectiveEnd(pause.pauseStartedAt, pause.pauseEndedAt, pause.durationMs);
        return (
          timelineSessionIds.has(pause.sessionId) &&
          overlaps(pause.pauseStartedAt, end, timelineStart, timelineEnd)
        );
      })
      .map((pause): SessionAnalyticsTimelineItem => {
        const end = effectiveEnd(pause.pauseStartedAt, pause.pauseEndedAt, pause.durationMs);
        const startedAt = Math.max(pause.pauseStartedAt, timelineStart);
        const clippedEnd = Math.min(end, timelineEnd + 1);
        return {
          id: pause.id,
          sessionId: pause.sessionId,
          kind: 'pause',
          title: pause.reason?.trim() || '暂停',
          startedAt,
          endedAt: pause.pauseEndedAt === null && end <= timelineEnd ? null : clippedEnd,
          durationMs: clippedRecordedDuration(
            pause.pauseStartedAt,
            end,
            timelineStart,
            timelineEnd,
            pause.durationMs,
          ),
          taskId: null,
        };
      }),
  ].sort((left, right) => left.startedAt - right.startedAt);

  const totals = daily.reduce(
    (result, item) => {
      result.activeMs += item.activeMs;
      result.pauseMs += item.pauseMs;
      result.wallMs += item.wallMs;
      return result;
    },
    { activeMs: 0, pauseMs: 0, wallMs: 0, sessionCount: sessions.length },
  );

  const activeValues = daily.map((item) => item.activeMs);
  const averageDailyActiveMs =
    activeValues.length === 0
      ? 0
      : activeValues.reduce((sum, value) => sum + value, 0) / activeValues.length;
  const variance =
    activeValues.length === 0
      ? 0
      : activeValues.reduce((sum, value) => sum + Math.pow(value - averageDailyActiveMs, 2), 0) /
        activeValues.length;
  const standardDeviationMs = Math.sqrt(variance);
  const score =
    averageDailyActiveMs <= 0
      ? 0
      : Math.round(
          Math.max(0, Math.min(100, 100 * (1 - standardDeviationMs / averageDailyActiveMs))),
        );

  return {
    range,
    daily,
    tasks,
    subjects,
    hourly,
    sessions,
    timeline,
    totals,
    stability: {
      activeDays: daily.filter((item) => item.activeMs > 0).length,
      calendarDays: daily.length,
      averageDailyActiveMs,
      standardDeviationMs,
      score,
    },
  };
}
