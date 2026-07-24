import type { DeviceSyncSessionBundle } from '@shared/sync/deviceProtocol';
import type { SyncedTask } from '@shared/sync/taskSnapshotProtocol';
import type { LiveFocusSnapshotLike } from './runtimeModel';

export interface OfflineFocusRuntime {
  id: string;
  segmentId: string;
  title: string;
  task: Pick<SyncedTask, 'id' | 'source' | 'title'> | null;
  state: 'running' | 'paused';
  revision: number;
  startedAt: number;
  stateStartedAt: number;
  activeElapsedMs: number;
  pauseElapsedMs: number;
  pauses: Array<{ id: string; startedAt: number; endedAt: number }>;
}

export function startOfflineFocus(input: {
  id: string;
  segmentId: string;
  title: string;
  task: SyncedTask | null;
  now: number;
}): OfflineFocusRuntime {
  return {
    id: input.id,
    segmentId: input.segmentId,
    title: input.title.trim(),
    task: input.task
      ? { id: input.task.id, source: input.task.source, title: input.task.title }
      : null,
    state: 'running',
    revision: 1,
    startedAt: input.now,
    stateStartedAt: input.now,
    activeElapsedMs: 0,
    pauseElapsedMs: 0,
    pauses: [],
  };
}

export function pauseOfflineFocus(
  runtime: OfflineFocusRuntime,
  pauseId: string,
  now: number,
): OfflineFocusRuntime {
  if (runtime.state !== 'running') throw new Error('本机专注当前不能暂停');
  return {
    ...runtime,
    state: 'paused',
    revision: runtime.revision + 1,
    activeElapsedMs: runtime.activeElapsedMs + elapsed(runtime.stateStartedAt, now),
    stateStartedAt: now,
    pauses: [...runtime.pauses, { id: pauseId, startedAt: now, endedAt: 0 }],
  };
}

export function resumeOfflineFocus(runtime: OfflineFocusRuntime, now: number): OfflineFocusRuntime {
  if (runtime.state !== 'paused') throw new Error('本机专注当前不能继续');
  const pauses = runtime.pauses.map((pause, index) =>
    index === runtime.pauses.length - 1 ? { ...pause, endedAt: now } : pause,
  );
  return {
    ...runtime,
    state: 'running',
    revision: runtime.revision + 1,
    pauseElapsedMs: runtime.pauseElapsedMs + elapsed(runtime.stateStartedAt, now),
    stateStartedAt: now,
    pauses,
  };
}

export function offlineRuntimeSnapshot(
  runtime: OfflineFocusRuntime,
  deviceId: string,
  observedAt = Date.now(),
): LiveFocusSnapshotLike {
  const activeElapsedMs =
    runtime.activeElapsedMs +
    (runtime.state === 'running' ? elapsed(runtime.stateStartedAt, observedAt) : 0);
  const pauseElapsedMs =
    runtime.pauseElapsedMs +
    (runtime.state === 'paused' ? elapsed(runtime.stateStartedAt, observedAt) : 0);
  return {
    state: runtime.state,
    revision: runtime.revision,
    sessionId: runtime.id,
    startedAt: runtime.startedAt,
    updatedAt: runtime.stateStartedAt,
    serverTime: observedAt,
    observedAt,
    activeElapsedMs,
    pauseElapsedMs,
    wallElapsedMs: elapsed(runtime.startedAt, observedAt),
    currentStateStartedAt:
      runtime.state === 'paused' ? runtime.stateStartedAt : runtime.stateStartedAt,
    segments: [{ id: runtime.segmentId, startedAt: runtime.startedAt, endedAt: null }],
    pauses: runtime.pauses.map((pause) => ({
      id: pause.id,
      segmentId: runtime.segmentId,
      startedAt: pause.startedAt,
      endedAt: pause.endedAt || null,
    })),
    title: runtime.title,
    ownerDeviceId: deviceId,
    taskId: runtime.task?.id ?? null,
    taskSource: runtime.task?.source ?? null,
    taskTitle: runtime.task?.title ?? null,
  };
}

export function finishOfflineFocus(
  runtime: OfflineFocusRuntime,
  now: number,
): DeviceSyncSessionBundle {
  const activeElapsedMs =
    runtime.activeElapsedMs +
    (runtime.state === 'running' ? elapsed(runtime.stateStartedAt, now) : 0);
  const pauseElapsedMs =
    runtime.pauseElapsedMs +
    (runtime.state === 'paused' ? elapsed(runtime.stateStartedAt, now) : 0);
  const pauses = runtime.pauses.map((pause) => ({
    ...pause,
    endedAt: pause.endedAt || now,
  }));
  return {
    session: {
      id: runtime.id,
      title: runtime.title,
      status: 'finished',
      startedAt: runtime.startedAt,
      endedAt: now,
      activeElapsedMs,
      pauseElapsedMs,
      wallElapsedMs: elapsed(runtime.startedAt, now),
      defaultTaskId: runtime.task?.id ?? null,
      defaultTaskSource: runtime.task?.source ?? null,
      defaultTaskTitle: runtime.task?.title ?? null,
      note: null,
      createdAt: runtime.startedAt,
      updatedAt: now,
    },
    segments: [
      {
        id: runtime.segmentId,
        sessionId: runtime.id,
        taskId: runtime.task?.id ?? null,
        taskSource: runtime.task?.source ?? null,
        title: runtime.title,
        startedAt: runtime.startedAt,
        endedAt: now,
        activeElapsedMs,
        note: null,
        tomatodoSubject: null,
        createdAt: runtime.startedAt,
        updatedAt: now,
      },
    ],
    pauses: pauses.map((pause) => ({
      id: pause.id,
      sessionId: runtime.id,
      segmentId: runtime.segmentId,
      pauseStartedAt: pause.startedAt,
      pauseEndedAt: pause.endedAt,
      durationMs: elapsed(pause.startedAt, pause.endedAt),
      reason: null,
      createdAt: pause.startedAt,
      updatedAt: pause.endedAt,
    })),
  };
}

export function isOfflineFocusRuntime(value: unknown): value is OfflineFocusRuntime {
  if (!value || typeof value !== 'object') return false;
  const runtime = value as Partial<OfflineFocusRuntime>;
  return (
    typeof runtime.id === 'string' &&
    typeof runtime.segmentId === 'string' &&
    typeof runtime.title === 'string' &&
    (runtime.state === 'running' || runtime.state === 'paused') &&
    Number.isSafeInteger(runtime.revision) &&
    typeof runtime.startedAt === 'number' &&
    typeof runtime.stateStartedAt === 'number' &&
    typeof runtime.activeElapsedMs === 'number' &&
    typeof runtime.pauseElapsedMs === 'number' &&
    Array.isArray(runtime.pauses)
  );
}

function elapsed(from: number, to: number): number {
  return Math.max(0, Math.floor(to - from));
}
