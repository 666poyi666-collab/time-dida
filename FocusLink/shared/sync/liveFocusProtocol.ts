import type { TaskSource } from '../types';

export const LIVE_FOCUS_PROTOCOL_VERSION = 1 as const;
export const LIVE_FOCUS_MAX_WAIT_MS = 25_000;
export const LIVE_FOCUS_MAX_TITLE_LENGTH = 1_000;
export const LIVE_FOCUS_MAX_TRANSITIONS = 5_000;
export const LIVE_FOCUS_MAX_COMMAND_BODY_BYTES = 16 * 1024;
export const LIVE_FOCUS_SNAPSHOT_PATH = '/v1/live' as const;
export const LIVE_FOCUS_WAIT_PATH = '/v1/live/wait' as const;
export const LIVE_FOCUS_COMMAND_PATH = '/v1/live/command' as const;

const LIVE_FOCUS_REQUEST_KEYS = new Set(['protocolVersion', 'deviceId', 'command']);
const LIVE_FOCUS_START_COMMAND_KEYS = new Set([
  'commandId',
  'action',
  'expectedRevision',
  'sessionId',
  'title',
  'task',
]);
const LIVE_FOCUS_COMMAND_KEYS = new Set(['commandId', 'action', 'expectedRevision', 'sessionId']);

export type LiveFocusState = 'idle' | 'running' | 'paused';
export type LiveFocusAction = 'start' | 'pause' | 'resume' | 'finish' | 'abort';

interface LiveFocusCommandBase {
  commandId: string;
  expectedRevision: number;
  sessionId: string;
}

export interface LiveFocusStartCommand extends LiveFocusCommandBase {
  action: 'start';
  title: string | null;
  /** Optional for protocol-v1 clients built before task context was introduced. */
  task?: LiveFocusTaskContext | null;
}

export interface LiveFocusTaskContext {
  taskId: string;
  taskSource: TaskSource;
  taskTitle: string | null;
}

export interface LiveFocusTimelineSegment {
  id: string;
  startedAt: number;
  endedAt: number | null;
}

export interface LiveFocusTimelinePause {
  id: string;
  segmentId: string;
  startedAt: number;
  endedAt: number | null;
}

export interface LiveFocusTransitionCommand extends LiveFocusCommandBase {
  action: Exclude<LiveFocusAction, 'start'>;
}

export type LiveFocusCommand = LiveFocusStartCommand | LiveFocusTransitionCommand;

export interface LiveFocusCommandRequest {
  protocolVersion: typeof LIVE_FOCUS_PROTOCOL_VERSION;
  deviceId: string;
  command: LiveFocusCommand;
}

export type LiveFocusCommandAckStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface LiveFocusCommandAck {
  commandId: string;
  status: LiveFocusCommandAckStatus;
  /** Applied revision, original revision for duplicates, or current revision on failure. */
  revision: number;
  errorCode: string | null;
  /** Set only when finish/abort has atomically published a completed ledger entity. */
  completedEntityId: string | null;
}

export interface LiveFocusSessionSnapshot {
  id: string;
  title: string | null;
  state: Exclude<LiveFocusState, 'idle'>;
  startedAt: number;
  activeElapsedMs: number;
  pauseElapsedMs: number;
  wallElapsedMs: number;
  currentPauseStartedAt: number | null;
  segments: LiveFocusTimelineSegment[];
  pauses: LiveFocusTimelinePause[];
  task: LiveFocusTaskContext | null;
  updatedAt: number;
  lastCommandDeviceId: string;
}

export interface LiveFocusSnapshot {
  /** Account-scoped revision. It increases once for every successfully applied command. */
  revision: number;
  state: LiveFocusState;
  session: LiveFocusSessionSnapshot | null;
}

export interface LiveFocusSnapshotResponse {
  protocolVersion: typeof LIVE_FOCUS_PROTOCOL_VERSION;
  snapshot: LiveFocusSnapshot;
  /** Elapsed values in snapshot are materialized at this server timestamp. */
  serverTime: number;
}

export interface LiveFocusWaitResponse extends LiveFocusSnapshotResponse {
  /** False means the bounded wait expired without a revision change. */
  changed: boolean;
}

export interface LiveFocusCommandResponse extends LiveFocusSnapshotResponse {
  ack: LiveFocusCommandAck;
}

export interface LiveFocusCommandValidationResult {
  ok: boolean;
  request?: LiveFocusCommandRequest;
  error?: string;
}

/** Strictly validates a live command body without accepting ownership or provider fields. */
export function validateLiveFocusCommandRequest(value: unknown): LiveFocusCommandValidationResult {
  if (!isRecord(value)) return invalid('request must be an object');
  if (!hasOnlyKeys(value, LIVE_FOCUS_REQUEST_KEYS)) {
    return invalid('request contains unsupported fields');
  }
  if (value.protocolVersion !== LIVE_FOCUS_PROTOCOL_VERSION) {
    return invalid('unsupported protocol version');
  }
  if (!isLiveFocusId(value.deviceId)) return invalid('deviceId is invalid');
  if (!isRecord(value.command)) return invalid('command must be an object');

  const command = value.command;
  const action = command.action;
  if (!isLiveFocusAction(action)) return invalid('command action is invalid');
  const allowedKeys = action === 'start' ? LIVE_FOCUS_START_COMMAND_KEYS : LIVE_FOCUS_COMMAND_KEYS;
  if (!hasOnlyKeys(command, allowedKeys)) {
    return invalid('command contains unsupported fields');
  }
  if (!isLiveFocusId(command.commandId)) return invalid('commandId is invalid');
  if (!isLiveFocusId(command.sessionId)) return invalid('sessionId is invalid');
  if (!isRevision(command.expectedRevision)) return invalid('expectedRevision is invalid');

  if (action === 'start') {
    if (!isNullableTitle(command.title)) return invalid('title is invalid');
    if (command.task !== undefined && !isNullableTask(command.task))
      return invalid('task is invalid');
    return {
      ok: true,
      request: {
        protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
        deviceId: value.deviceId,
        command: {
          commandId: command.commandId,
          action,
          expectedRevision: command.expectedRevision,
          sessionId: command.sessionId,
          title: command.title,
          task: command.task ?? null,
        },
      },
    };
  }

  return {
    ok: true,
    request: {
      protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
      deviceId: value.deviceId,
      command: {
        commandId: command.commandId,
        action,
        expectedRevision: command.expectedRevision,
        sessionId: command.sessionId,
      },
    },
  };
}

export function isLiveFocusId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

export function isLiveFocusRevision(value: unknown): value is number {
  return isRevision(value);
}

function isLiveFocusAction(value: unknown): value is LiveFocusAction {
  return (
    value === 'start' ||
    value === 'pause' ||
    value === 'resume' ||
    value === 'finish' ||
    value === 'abort'
  );
}

function isNullableTitle(value: unknown): value is string | null {
  return (
    value === null || (typeof value === 'string' && value.length <= LIVE_FOCUS_MAX_TITLE_LENGTH)
  );
}

function isNullableTask(value: unknown): value is LiveFocusTaskContext | null {
  if (value === null) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, new Set(['taskId', 'taskSource', 'taskTitle']))) {
    return false;
  }
  return (
    isLiveFocusId(value.taskId) &&
    (value.taskSource === 'local' || value.taskSource === 'ticktick') &&
    isNullableTitle(value.taskTitle)
  );
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function invalid(error: string): LiveFocusCommandValidationResult {
  return { ok: false, error };
}
