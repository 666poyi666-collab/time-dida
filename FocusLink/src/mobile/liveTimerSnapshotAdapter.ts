import type { LiveFocusSnapshotLike } from './runtimeModel';
import type { TimerSnapshot } from '@shared/types';

/**
 * Adapts the live protocol projection to the desktop timer visual contract.
 *
 * The live service intentionally exposes a smaller, transport-oriented shape. Keeping this
 * conversion pure lets mobile render the exact same TemporalRibbon as desktop without copying
 * timer state or elapsed-time logic into the mobile renderer.
 */
export function liveFocusSnapshotToTimerSnapshot(input: LiveFocusSnapshotLike): TimerSnapshot {
  if (input.state === 'idle' || !input.sessionId) return idleTimerSnapshot(input.observedAt);

  const clockOffsetMs = input.observedAt - input.serverTime;
  const local = (timestamp: number | null) =>
    timestamp === null ? null : timestamp + clockOffsetMs;
  const closedPauseMs = input.pauses.reduce(
    (sum, pause) =>
      sum + (pause.endedAt === null ? 0 : Math.max(0, pause.endedAt - pause.startedAt)),
    0,
  );
  const segments = buildDesktopSegments(input, local);

  return {
    state: input.state,
    sessionId: input.sessionId,
    currentSegmentId: input.state === 'running' ? (segments.at(-1)?.id ?? null) : null,
    currentTaskId: input.taskId,
    currentTaskTitle: input.taskTitle ?? input.title,
    currentTaskSource: input.taskSource,
    sessionDefaultTaskId: input.taskId,
    sessionDefaultTaskTitle: input.taskTitle,
    activeElapsedMs: input.activeElapsedMs,
    pauseElapsedMs: closedPauseMs,
    wallElapsedMs: input.wallElapsedMs,
    currentPauseStartedAt: input.state === 'paused' ? local(input.currentStateStartedAt) : null,
    segments,
    pauseEvents: input.pauses.map((pause) => ({
      id: pause.id,
      segmentId: pause.segmentId,
      pauseStartedAt: local(pause.startedAt)!,
      pauseEndedAt: local(pause.endedAt),
      durationMs: pause.endedAt === null ? 0 : Math.max(0, pause.endedAt - pause.startedAt),
      isCurrent: pause.endedAt === null && input.state === 'paused',
    })),
    lastTick: input.observedAt,
  };
}

function buildDesktopSegments(
  input: LiveFocusSnapshotLike,
  local: (timestamp: number | null) => number | null,
): TimerSnapshot['segments'] {
  return input.segments.flatMap((segment) => {
    const segmentEnd = segment.endedAt ?? input.serverTime;
    const pauses = input.pauses
      .filter(
        (pause) =>
          pause.segmentId === segment.id &&
          pause.startedAt >= segment.startedAt &&
          pause.startedAt <= segmentEnd,
      )
      .sort((left, right) => left.startedAt - right.startedAt);
    const intervals: Array<{ startedAt: number; endedAt: number; ongoing: boolean }> = [];
    let cursor = segment.startedAt;

    for (const pause of pauses) {
      const focusEnd = Math.min(segmentEnd, Math.max(cursor, pause.startedAt));
      if (focusEnd > cursor)
        intervals.push({ startedAt: cursor, endedAt: focusEnd, ongoing: false });
      cursor = Math.max(cursor, Math.min(segmentEnd, pause.endedAt ?? input.serverTime));
    }

    const ongoing = segment.endedAt === null && input.state === 'running';
    if (cursor < segmentEnd || (ongoing && cursor === segmentEnd)) {
      intervals.push({ startedAt: cursor, endedAt: segmentEnd, ongoing });
    }

    return intervals.map((interval, index) => ({
      id: index === 0 ? segment.id : `${segment.id}:resume:${index}`,
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      taskSource: input.taskSource,
      title: input.taskTitle ?? input.title,
      startedAt: local(interval.startedAt)!,
      endedAt: interval.ongoing ? null : local(interval.endedAt),
      activeElapsedMs: Math.max(0, interval.endedAt - interval.startedAt),
    }));
  });
}

function idleTimerSnapshot(now: number): TimerSnapshot {
  return {
    state: 'idle',
    sessionId: null,
    currentSegmentId: null,
    currentTaskId: null,
    currentTaskTitle: null,
    currentTaskSource: null,
    sessionDefaultTaskId: null,
    sessionDefaultTaskTitle: null,
    activeElapsedMs: 0,
    pauseElapsedMs: 0,
    wallElapsedMs: 0,
    currentPauseStartedAt: null,
    segments: [],
    pauseEvents: [],
    lastTick: now,
  };
}
