/**
 * FocusLink device-sync test backend store.
 *
 * This module is intentionally limited to local development and contract tests. It does not
 * implement production identity, retention, encryption, backups, or multi-process coordination.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  DEVICE_SYNC_MAX_BODY_BYTES,
  DEVICE_SYNC_ENTITY,
  DEVICE_SYNC_MAX_PULL,
  DEVICE_SYNC_MAX_PUSH,
  DEVICE_SYNC_MAX_TIMESTAMP_MS,
  DEVICE_SYNC_PROTOCOL_VERSION,
  deviceSyncJsonByteLength,
  fingerprintDeviceSyncValue,
  validateDeviceSyncBundle,
} from '../shared/sync/deviceProtocol';
import type {
  DeviceSyncAck,
  DeviceSyncChange,
  DeviceSyncMutation,
  DeviceSyncRequest,
  DeviceSyncResponse,
  DeviceSyncSessionBundle,
} from '../shared/sync/deviceProtocol';
import {
  LIVE_FOCUS_MAX_TRANSITIONS,
  LIVE_FOCUS_MAX_TITLE_LENGTH,
  LIVE_FOCUS_MAX_WAIT_MS,
  LIVE_FOCUS_PROTOCOL_VERSION,
  isLiveFocusId,
  validateLiveFocusCommandRequest,
} from '../shared/sync/liveFocusProtocol';
import type {
  LiveFocusCommand,
  LiveFocusCommandAck,
  LiveFocusCommandRequest,
  LiveFocusCommandResponse,
  LiveFocusSessionSnapshot,
  LiveFocusSnapshot,
  LiveFocusSnapshotResponse,
  LiveFocusState,
  LiveFocusWaitResponse,
  LiveFocusTaskContext,
} from '../shared/sync/liveFocusProtocol';

const STORE_FORMAT = 'focuslink-device-sync-test-v1' as const;
const CURSOR_FORMAT = 'v1';

interface StoredEntity {
  revision: number;
  deleted: boolean;
  payload: DeviceSyncSessionBundle | null;
}

interface StoredOperation {
  fingerprint: string;
  ack: DeviceSyncAck;
}

interface StoredLiveSegment {
  id: string;
  startedAt: number;
  endedAt: number | null;
}

interface StoredLivePause {
  id: string;
  segmentId: string;
  startedAt: number;
  endedAt: number | null;
}

interface StoredLiveSession {
  id: string;
  title: string | null;
  /** Optional on persisted protocol-v1 stores written before task context existed. */
  task?: LiveFocusTaskContext | null;
  state: Exclude<LiveFocusState, 'idle'>;
  startedAt: number;
  updatedAt: number;
  lastCommandDeviceId: string;
  segments: StoredLiveSegment[];
  pauses: StoredLivePause[];
}

interface StoredLiveOperation {
  fingerprint: string;
  ack: LiveFocusCommandAck;
}

interface LiveAccountState {
  revision: number;
  session: StoredLiveSession | null;
  operations: Map<string, StoredLiveOperation>;
}

interface AccountState {
  changeSeq: number;
  entities: Map<string, StoredEntity>;
  operations: Map<string, StoredOperation>;
  changes: DeviceSyncChange[];
  live: LiveAccountState;
}

interface PersistedAccountState {
  changeSeq: number;
  entities: Array<[string, StoredEntity]>;
  operations: Array<[string, StoredOperation]>;
  changes: DeviceSyncChange[];
  /** Optional so stores written before live focus was introduced remain readable. */
  live?: PersistedLiveAccountState;
}

interface PersistedLiveAccountState {
  revision: number;
  session: StoredLiveSession | null;
  operations: Array<[string, StoredLiveOperation]>;
}

interface PersistedStoreFile {
  format: typeof STORE_FORMAT;
  accounts: Array<[string, PersistedAccountState]>;
}

export interface DeviceSyncCloudStoreOptions {
  /** Optional single-process JSON persistence for local testing only. */
  persistencePath?: string;
  now?: () => number;
}

export interface DeviceSyncCloudAccountInspection {
  changeSeq: number;
  entityCount: number;
  operationCount: number;
  changeCount: number;
  liveRevision: number;
  liveState: LiveFocusState;
  liveOperationCount: number;
  liveWaiterCount: number;
}

export class DeviceSyncCloudStoreError extends Error {
  constructor(
    readonly code:
      | 'invalid_account'
      | 'invalid_cursor'
      | 'invalid_request'
      | 'invalid_live_revision'
      | 'store_corrupt',
    message: string,
  ) {
    super(message);
    this.name = 'DeviceSyncCloudStoreError';
  }
}

export class LiveFocusWaitAbortedError extends Error {
  constructor() {
    super('live focus wait was aborted');
    this.name = 'LiveFocusWaitAbortedError';
  }
}

export class DeviceSyncCloudStore {
  private readonly persistencePath: string | undefined;
  private readonly now: () => number;
  private accounts = new Map<string, AccountState>();
  private readonly liveWaiters = new Map<string, Set<() => void>>();

  constructor(options: DeviceSyncCloudStoreOptions = {}) {
    this.persistencePath = options.persistencePath
      ? path.resolve(options.persistencePath)
      : undefined;
    this.now = options.now ?? Date.now;
    if (this.persistencePath) this.accounts = loadPersistedStore(this.persistencePath);
  }

  /**
   * Apply complete session-bundle mutations and pull changes as one synchronous store operation.
   * A bundle is validated before its entity row and change-log row are committed, so child rows
   * can never be observed partially.
   */
  sync(accountId: string, request: DeviceSyncRequest): DeviceSyncResponse {
    validateAccountId(accountId);
    validateStoreRequest(request);

    const current = this.accounts.get(accountId) ?? createEmptyAccount();
    const cursorSeq = decodeCursor(accountId, request.cursor, current.changeSeq);
    const working = cloneAccount(current);
    const acks: DeviceSyncAck[] = [];
    let dirty = false;

    for (const mutation of request.mutations) {
      const result = applyMutation(working, request.deviceId, mutation);
      acks.push(result.ack);
      dirty ||= result.dirty;
    }

    const serverTime = this.now();
    const availableChanges = coalesceLatestEntityChanges(
      working.changes.filter((change) => change.changeSeq > cursorSeq),
    );
    const changes = selectResponseChanges(availableChanges, request.pullLimit, acks, serverTime);
    const nextSeq = changes.at(-1)?.changeSeq ?? cursorSeq;
    const response: DeviceSyncResponse = {
      protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
      acks,
      changes,
      nextCursor: encodeCursor(accountId, nextSeq),
      hasMore: availableChanges.length > changes.length,
      serverTime,
    };

    if (deviceSyncJsonByteLength(response) > DEVICE_SYNC_MAX_BODY_BYTES) {
      throw new DeviceSyncCloudStoreError('store_corrupt', 'sync response exceeded byte budget');
    }

    if (dirty) {
      const nextAccounts = new Map(this.accounts);
      nextAccounts.set(accountId, working);
      if (this.persistencePath) persistStore(this.persistencePath, nextAccounts);
      this.accounts = nextAccounts;
    }

    return response;
  }

  /** Return the account's server-authoritative active focus state. */
  getLiveSnapshot(accountId: string): LiveFocusSnapshotResponse {
    validateAccountId(accountId);
    const account = this.accounts.get(accountId) ?? createEmptyAccount();
    const serverTime = readServerTime(this.now, account.live.session);
    return {
      protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
      snapshot: materializeLiveSnapshot(account.live, serverTime),
      serverTime,
    };
  }

  /**
   * Apply one idempotent live command and persist it with any completed ledger bundle in a single
   * JSON replacement. The account revision changes only for successfully applied commands.
   */
  commandLive(accountId: string, request: LiveFocusCommandRequest): LiveFocusCommandResponse {
    validateAccountId(accountId);
    validateLiveStoreRequest(request);

    const current = this.accounts.get(accountId) ?? createEmptyAccount();
    const working = cloneAccount(current);
    const serverTime = readServerTime(this.now, working.live.session);
    const result = applyLiveCommand(working, request.deviceId, request.command, serverTime);

    if (result.dirty) {
      const nextAccounts = new Map(this.accounts);
      nextAccounts.set(accountId, working);
      if (this.persistencePath) persistStore(this.persistencePath, nextAccounts);
      this.accounts = nextAccounts;
    }
    if (result.revisionChanged) this.notifyLiveWaiters(accountId);

    return {
      protocolVersion: LIVE_FOCUS_PROTOCOL_VERSION,
      ack: result.ack,
      snapshot: materializeLiveSnapshot(working.live, serverTime),
      serverTime,
    };
  }

  /**
   * Wait until the account live revision advances, or until the bounded timeout expires. An
   * aborted HTTP request removes its waiter immediately instead of retaining a timer/listener.
   */
  async waitForLiveSnapshot(
    accountId: string,
    afterRevision: number,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<LiveFocusWaitResponse> {
    validateAccountId(accountId);
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {
      throw new DeviceSyncCloudStoreError(
        'invalid_live_revision',
        'afterRevision must be a non-negative safe integer',
      );
    }
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > LIVE_FOCUS_MAX_WAIT_MS) {
      throw new DeviceSyncCloudStoreError(
        'invalid_request',
        `waitMs must be between 0 and ${LIVE_FOCUS_MAX_WAIT_MS}`,
      );
    }

    const initialRevision = this.accounts.get(accountId)?.live.revision ?? 0;
    if (afterRevision > initialRevision) {
      throw new DeviceSyncCloudStoreError(
        'invalid_live_revision',
        'afterRevision is ahead of the current account revision',
      );
    }
    if (initialRevision > afterRevision || waitMs === 0) {
      return this.makeLiveWaitResponse(accountId, initialRevision > afterRevision);
    }
    if (signal?.aborted) throw new LiveFocusWaitAbortedError();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const waiters = this.liveWaiters.get(accountId) ?? new Set<() => void>();
      this.liveWaiters.set(accountId, waiters);

      const cleanup = () => {
        clearTimeout(timeout);
        waiters.delete(wake);
        if (waiters.size === 0) this.liveWaiters.delete(accountId);
        signal?.removeEventListener('abort', abort);
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const wake = () => finish(resolve);
      const abort = () => finish(() => reject(new LiveFocusWaitAbortedError()));
      const timeout = setTimeout(wake, waitMs);
      waiters.add(wake);
      signal?.addEventListener('abort', abort, { once: true });
    });

    const changed = (this.accounts.get(accountId)?.live.revision ?? 0) > afterRevision;
    return this.makeLiveWaitResponse(accountId, changed);
  }

  private makeLiveWaitResponse(accountId: string, changed: boolean): LiveFocusWaitResponse {
    return { ...this.getLiveSnapshot(accountId), changed };
  }

  private notifyLiveWaiters(accountId: string): void {
    for (const wake of [...(this.liveWaiters.get(accountId) ?? [])]) wake();
  }

  /** Read-only counters for tests and diagnostics; no record payloads or tokens are exposed. */
  inspectAccount(accountId: string): DeviceSyncCloudAccountInspection {
    validateAccountId(accountId);
    const account = this.accounts.get(accountId) ?? createEmptyAccount();
    return {
      changeSeq: account.changeSeq,
      entityCount: account.entities.size,
      operationCount: account.operations.size,
      changeCount: account.changes.length,
      liveRevision: account.live.revision,
      liveState: account.live.session?.state ?? 'idle',
      liveOperationCount: account.live.operations.size,
      liveWaiterCount: this.liveWaiters.get(accountId)?.size ?? 0,
    };
  }
}

export function createDeviceSyncCloudStore(
  options: DeviceSyncCloudStoreOptions = {},
): DeviceSyncCloudStore {
  return new DeviceSyncCloudStore(options);
}

function applyLiveCommand(
  account: AccountState,
  deviceId: string,
  command: LiveFocusCommand,
  serverTime: number,
): {
  ack: LiveFocusCommandAck;
  dirty: boolean;
  revisionChanged: boolean;
} {
  const fingerprint = fingerprintDeviceSyncValue({ deviceId, command });
  const previousOperation = account.live.operations.get(command.commandId);
  if (previousOperation) {
    if (previousOperation.fingerprint !== fingerprint) {
      return {
        ack: liveRejectedAck(command.commandId, account.live.revision, 'command_id_reused'),
        dirty: false,
        revisionChanged: false,
      };
    }
    if (previousOperation.ack.status === 'applied') {
      return {
        ack: { ...previousOperation.ack, status: 'duplicate', errorCode: null },
        dirty: false,
        revisionChanged: false,
      };
    }
    return {
      ack: { ...previousOperation.ack },
      dirty: false,
      revisionChanged: false,
    };
  }

  if (command.expectedRevision !== account.live.revision) {
    const ack: LiveFocusCommandAck = {
      commandId: command.commandId,
      status: 'conflict',
      revision: account.live.revision,
      errorCode: 'revision_conflict',
      completedEntityId: null,
    };
    account.live.operations.set(command.commandId, { fingerprint, ack: { ...ack } });
    return { ack, dirty: true, revisionChanged: false };
  }

  const rejection = validateLiveTransition(account, command);
  if (rejection) {
    const ack = liveRejectedAck(command.commandId, account.live.revision, rejection);
    account.live.operations.set(command.commandId, { fingerprint, ack: { ...ack } });
    return { ack, dirty: true, revisionChanged: false };
  }

  if (account.live.revision >= Number.MAX_SAFE_INTEGER) {
    const ack = liveRejectedAck(command.commandId, account.live.revision, 'revision_exhausted');
    account.live.operations.set(command.commandId, { fingerprint, ack: { ...ack } });
    return { ack, dirty: true, revisionChanged: false };
  }

  let completedEntityId: string | null = null;
  switch (command.action) {
    case 'start': {
      account.live.session = {
        id: command.sessionId,
        title: command.title,
        task: command.task ?? null,
        state: 'running',
        startedAt: serverTime,
        updatedAt: serverTime,
        lastCommandDeviceId: deviceId,
        segments: [makeLiveSegment(command.sessionId, 0, serverTime)],
        pauses: [],
      };
      break;
    }
    case 'pause': {
      const session = requireLiveSession(account);
      const segment = session.segments.at(-1);
      if (!segment || segment.endedAt !== null) {
        throw new DeviceSyncCloudStoreError(
          'store_corrupt',
          'running live session has no open segment',
        );
      }
      segment.endedAt = serverTime;
      session.pauses.push(makeLivePause(session.id, session.pauses.length, segment.id, serverTime));
      session.state = 'paused';
      session.updatedAt = serverTime;
      session.lastCommandDeviceId = deviceId;
      break;
    }
    case 'resume': {
      const session = requireLiveSession(account);
      const pause = session.pauses.at(-1);
      if (!pause || pause.endedAt !== null) {
        throw new DeviceSyncCloudStoreError(
          'store_corrupt',
          'paused live session has no open pause',
        );
      }
      pause.endedAt = serverTime;
      session.segments.push(makeLiveSegment(session.id, session.segments.length, serverTime));
      session.state = 'running';
      session.updatedAt = serverTime;
      session.lastCommandDeviceId = deviceId;
      break;
    }
    case 'finish':
    case 'abort': {
      const session = requireLiveSession(account);
      closeLivePhase(session, serverTime);
      session.updatedAt = serverTime;
      session.lastCommandDeviceId = deviceId;
      const bundle = buildCompletedLiveBundle(
        session,
        command.action === 'finish' ? 'finished' : 'aborted',
        serverTime,
      );
      publishLiveBundle(account, deviceId, bundle);
      completedEntityId = session.id;
      account.live.session = null;
      break;
    }
  }

  account.live.revision += 1;
  const ack: LiveFocusCommandAck = {
    commandId: command.commandId,
    status: 'applied',
    revision: account.live.revision,
    errorCode: null,
    completedEntityId,
  };
  account.live.operations.set(command.commandId, { fingerprint, ack: { ...ack } });
  return { ack, dirty: true, revisionChanged: true };
}

function validateLiveTransition(account: AccountState, command: LiveFocusCommand): string | null {
  const session = account.live.session;
  if (command.action === 'start') {
    if (session) return 'active_session_exists';
    if (account.entities.has(command.sessionId)) return 'session_id_exists';
    return null;
  }
  if (!session) return 'no_active_session';
  if (session.id !== command.sessionId) return 'session_mismatch';

  switch (command.action) {
    case 'pause':
      if (session.state !== 'running') return 'not_running';
      if (session.pauses.length >= LIVE_FOCUS_MAX_TRANSITIONS) return 'transition_limit';
      return null;
    case 'resume':
      if (session.state !== 'paused') return 'not_paused';
      if (session.segments.length >= LIVE_FOCUS_MAX_TRANSITIONS) return 'transition_limit';
      return null;
    case 'finish':
    case 'abort':
      if (account.entities.has(session.id)) return 'session_id_exists';
      return null;
  }
}

function liveRejectedAck(
  commandId: string,
  revision: number,
  errorCode: string,
): LiveFocusCommandAck {
  return {
    commandId,
    status: 'rejected',
    revision,
    errorCode,
    completedEntityId: null,
  };
}

function requireLiveSession(account: AccountState): StoredLiveSession {
  const session = account.live.session;
  if (!session) {
    throw new DeviceSyncCloudStoreError('store_corrupt', 'live command lost its active session');
  }
  return session;
}

function makeLiveSegment(sessionId: string, index: number, startedAt: number): StoredLiveSegment {
  return {
    id: makeLiveChildId('segment', sessionId, index, startedAt),
    startedAt,
    endedAt: null,
  };
}

function makeLivePause(
  sessionId: string,
  index: number,
  segmentId: string,
  startedAt: number,
): StoredLivePause {
  return {
    id: makeLiveChildId('pause', sessionId, index, startedAt),
    segmentId,
    startedAt,
    endedAt: null,
  };
}

function makeLiveChildId(
  kind: 'segment' | 'pause',
  sessionId: string,
  index: number,
  startedAt: number,
): string {
  const digest = createHash('sha256')
    .update(`${kind}\0${sessionId}\0${index}\0${startedAt}`)
    .digest('hex')
    .slice(0, 32);
  return `live-${kind}-${digest}`;
}

function closeLivePhase(session: StoredLiveSession, endedAt: number): void {
  if (session.state === 'running') {
    const segment = session.segments.at(-1);
    if (!segment || segment.endedAt !== null) {
      throw new DeviceSyncCloudStoreError(
        'store_corrupt',
        'running live session has no open segment',
      );
    }
    segment.endedAt = endedAt;
    return;
  }
  const pause = session.pauses.at(-1);
  if (!pause || pause.endedAt !== null) {
    throw new DeviceSyncCloudStoreError('store_corrupt', 'paused live session has no open pause');
  }
  pause.endedAt = endedAt;
}

function buildCompletedLiveBundle(
  session: StoredLiveSession,
  status: 'finished' | 'aborted',
  endedAt: number,
): DeviceSyncSessionBundle {
  const segments = session.segments.map((segment) => {
    if (segment.endedAt === null) {
      throw new DeviceSyncCloudStoreError('store_corrupt', 'completed live segment is still open');
    }
    return {
      id: segment.id,
      sessionId: session.id,
      taskId: session.task?.taskId ?? null,
      taskSource: session.task?.taskSource ?? null,
      title: session.task?.taskTitle ?? session.title,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      activeElapsedMs: segment.endedAt - segment.startedAt,
      note: null,
      tomatodoSubject: null,
      createdAt: segment.startedAt,
      updatedAt: segment.endedAt,
    };
  });
  const pauses = session.pauses.map((pause) => {
    if (pause.endedAt === null) {
      throw new DeviceSyncCloudStoreError('store_corrupt', 'completed live pause is still open');
    }
    return {
      id: pause.id,
      sessionId: session.id,
      segmentId: pause.segmentId,
      pauseStartedAt: pause.startedAt,
      pauseEndedAt: pause.endedAt,
      durationMs: pause.endedAt - pause.startedAt,
      reason: null,
      createdAt: pause.startedAt,
      updatedAt: pause.endedAt,
    };
  });
  const activeElapsedMs = segments.reduce((total, segment) => total + segment.activeElapsedMs, 0);
  const pauseElapsedMs = pauses.reduce((total, pause) => total + pause.durationMs, 0);
  const wallElapsedMs = endedAt - session.startedAt;
  if (activeElapsedMs + pauseElapsedMs !== wallElapsedMs) {
    throw new DeviceSyncCloudStoreError(
      'store_corrupt',
      'completed live session time is not closed',
    );
  }

  const bundle: DeviceSyncSessionBundle = {
    session: {
      id: session.id,
      title: session.title,
      status,
      startedAt: session.startedAt,
      endedAt,
      activeElapsedMs,
      pauseElapsedMs,
      wallElapsedMs,
      defaultTaskId: session.task?.taskId ?? null,
      defaultTaskSource: session.task?.taskSource ?? null,
      defaultTaskTitle: session.task?.taskTitle ?? null,
      note: null,
      createdAt: session.startedAt,
      updatedAt: endedAt,
    },
    segments,
    pauses,
  };
  const validation = validateDeviceSyncBundle(bundle);
  if (!validation.ok) {
    throw new DeviceSyncCloudStoreError(
      'store_corrupt',
      `completed live bundle is invalid: ${validation.error ?? 'unknown error'}`,
    );
  }
  return bundle;
}

function publishLiveBundle(
  account: AccountState,
  deviceId: string,
  bundle: DeviceSyncSessionBundle,
): void {
  if (account.entities.has(bundle.session.id)) {
    throw new DeviceSyncCloudStoreError('store_corrupt', 'live session entity already exists');
  }
  if (account.changeSeq >= Number.MAX_SAFE_INTEGER) {
    throw new DeviceSyncCloudStoreError('store_corrupt', 'device sync change sequence exhausted');
  }
  account.changeSeq += 1;
  const change: DeviceSyncChange = {
    changeSeq: account.changeSeq,
    deviceId,
    entity: DEVICE_SYNC_ENTITY,
    entityId: bundle.session.id,
    revision: 1,
    deleted: false,
    payload: cloneBundle(bundle),
  };
  account.entities.set(bundle.session.id, {
    revision: 1,
    deleted: false,
    payload: cloneBundle(bundle),
  });
  account.changes.push(change);
}

function materializeLiveSnapshot(live: LiveAccountState, serverTime: number): LiveFocusSnapshot {
  const session = live.session;
  if (!session) return { revision: live.revision, state: 'idle', session: null };

  const activeElapsedMs = session.segments.reduce(
    (total, segment) => total + ((segment.endedAt ?? serverTime) - segment.startedAt),
    0,
  );
  const pauseElapsedMs = session.pauses.reduce(
    (total, pause) => total + ((pause.endedAt ?? serverTime) - pause.startedAt),
    0,
  );
  const currentPause = session.state === 'paused' ? session.pauses.at(-1) : null;
  const snapshotSession: LiveFocusSessionSnapshot = {
    id: session.id,
    title: session.title,
    state: session.state,
    startedAt: session.startedAt,
    activeElapsedMs,
    pauseElapsedMs,
    wallElapsedMs: serverTime - session.startedAt,
    currentPauseStartedAt: currentPause?.startedAt ?? null,
    segments: session.segments.map((segment) => ({ ...segment })),
    pauses: session.pauses.map((pause) => ({ ...pause })),
    task: session.task ?? null,
    updatedAt: session.updatedAt,
    lastCommandDeviceId: session.lastCommandDeviceId,
  };
  return { revision: live.revision, state: session.state, session: snapshotSession };
}

function readServerTime(now: () => number, session: StoredLiveSession | null): number {
  const value = now();
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > DEVICE_SYNC_MAX_TIMESTAMP_MS
  ) {
    throw new DeviceSyncCloudStoreError('store_corrupt', 'server clock is outside Date range');
  }
  return Math.max(Math.trunc(value), session?.updatedAt ?? 0);
}

function validateLiveStoreRequest(request: LiveFocusCommandRequest): void {
  const validation = validateLiveFocusCommandRequest(request);
  if (!validation.ok) {
    throw new DeviceSyncCloudStoreError(
      'invalid_request',
      validation.error ?? 'invalid live command request',
    );
  }
}

function applyMutation(
  account: AccountState,
  deviceId: string,
  mutation: DeviceSyncMutation,
): { ack: DeviceSyncAck; dirty: boolean } {
  const fingerprint = fingerprintDeviceSyncValue(mutation);
  const previousOperation = account.operations.get(mutation.opId);
  if (previousOperation) {
    if (previousOperation.fingerprint !== fingerprint) {
      return {
        ack: rejectedAck(
          mutation,
          account.entities.get(mutation.entityId)?.revision ?? null,
          'op_id_reused',
        ),
        dirty: false,
      };
    }
    if (previousOperation.ack.status === 'applied') {
      return {
        ack: { ...previousOperation.ack, status: 'duplicate', errorCode: null },
        dirty: false,
      };
    }
    return { ack: { ...previousOperation.ack }, dirty: false };
  }

  const rejection = validateMutation(mutation);
  if (rejection) {
    const ack = rejectedAck(
      mutation,
      account.entities.get(mutation.entityId)?.revision ?? null,
      rejection,
    );
    account.operations.set(mutation.opId, { fingerprint, ack: { ...ack } });
    return { ack, dirty: true };
  }

  if (account.live.session?.id === mutation.entityId) {
    const ack = rejectedAck(
      mutation,
      account.entities.get(mutation.entityId)?.revision ?? null,
      'live_session_reserved',
    );
    account.operations.set(mutation.opId, { fingerprint, ack: { ...ack } });
    return { ack, dirty: true };
  }

  const current = account.entities.get(mutation.entityId);
  const currentRevision = current?.revision ?? 0;
  if (mutation.baseRevision !== currentRevision) {
    const ack: DeviceSyncAck = {
      opId: mutation.opId,
      entityId: mutation.entityId,
      status: 'conflict',
      revision: current?.revision ?? null,
      errorCode: 'revision_conflict',
    };
    account.operations.set(mutation.opId, { fingerprint, ack: { ...ack } });
    return { ack, dirty: true };
  }

  const revision = currentRevision + 1;
  const deleted = mutation.kind === 'delete';
  const payload = deleted ? null : cloneBundle(mutation.payload as DeviceSyncSessionBundle);
  account.changeSeq += 1;
  const change: DeviceSyncChange = {
    changeSeq: account.changeSeq,
    deviceId,
    entity: DEVICE_SYNC_ENTITY,
    entityId: mutation.entityId,
    revision,
    deleted,
    payload: cloneBundleOrNull(payload),
  };
  account.entities.set(mutation.entityId, {
    revision,
    deleted,
    payload: cloneBundleOrNull(payload),
  });
  account.changes.push(change);

  const ack: DeviceSyncAck = {
    opId: mutation.opId,
    entityId: mutation.entityId,
    status: 'applied',
    revision,
    errorCode: null,
  };
  account.operations.set(mutation.opId, { fingerprint, ack: { ...ack } });
  return { ack, dirty: true };
}

function validateMutation(mutation: DeviceSyncMutation): string | null {
  if (mutation.entity !== DEVICE_SYNC_ENTITY) return 'unsupported_entity';
  if (mutation.kind === 'delete') {
    return mutation.payload === null ? null : 'invalid_delete_payload';
  }
  if (mutation.kind !== 'put' || mutation.payload === null) return 'invalid_put_payload';
  const validation = validateDeviceSyncBundle(mutation.payload);
  if (!validation.ok) return 'invalid_bundle';
  if (mutation.payload.session.id !== mutation.entityId) return 'entity_id_mismatch';
  return null;
}

function rejectedAck(
  mutation: Pick<DeviceSyncMutation, 'opId' | 'entityId'>,
  revision: number | null,
  errorCode: string,
): DeviceSyncAck {
  return {
    opId: mutation.opId,
    entityId: mutation.entityId,
    status: 'rejected',
    revision,
    errorCode,
  };
}

function validateStoreRequest(request: DeviceSyncRequest): void {
  if (request.protocolVersion !== DEVICE_SYNC_PROTOCOL_VERSION) {
    throw new DeviceSyncCloudStoreError('invalid_request', 'unsupported protocol version');
  }
  if (!isId(request.deviceId)) {
    throw new DeviceSyncCloudStoreError('invalid_request', 'invalid device id');
  }
  if (!Array.isArray(request.mutations) || request.mutations.length > DEVICE_SYNC_MAX_PUSH) {
    throw new DeviceSyncCloudStoreError('invalid_request', 'invalid mutation count');
  }
  if (
    !Number.isInteger(request.pullLimit) ||
    request.pullLimit < 1 ||
    request.pullLimit > DEVICE_SYNC_MAX_PULL
  ) {
    throw new DeviceSyncCloudStoreError('invalid_request', 'invalid pull limit');
  }
}

function selectResponseChanges(
  availableChanges: readonly DeviceSyncChange[],
  pullLimit: number,
  acks: readonly DeviceSyncAck[],
  serverTime: number,
): DeviceSyncChange[] {
  const selected: DeviceSyncChange[] = [];
  const sizingResponse: DeviceSyncResponse = {
    protocolVersion: DEVICE_SYNC_PROTOCOL_VERSION,
    acks: acks.map((ack) => ({ ...ack })),
    changes: [],
    nextCursor: 'x'.repeat(512),
    hasMore: true,
    serverTime,
  };
  let responseBytes = deviceSyncJsonByteLength(sizingResponse);
  for (const available of availableChanges) {
    if (selected.length >= pullLimit) break;
    const candidate = cloneChange(available);
    const candidateBytes = deviceSyncJsonByteLength(candidate) + (selected.length > 0 ? 1 : 0);
    if (responseBytes + candidateBytes > DEVICE_SYNC_MAX_BODY_BYTES) break;
    selected.push(candidate);
    responseBytes += candidateBytes;
  }

  if (selected.length === 0 && availableChanges.length > 0) {
    throw new DeviceSyncCloudStoreError(
      'store_corrupt',
      'one stored change exceeds the sync response byte budget',
    );
  }
  return selected;
}

function coalesceLatestEntityChanges(changes: readonly DeviceSyncChange[]): DeviceSyncChange[] {
  const latestByEntity = new Map<string, DeviceSyncChange>();
  for (const change of changes) latestByEntity.set(change.entityId, change);
  return [...latestByEntity.values()]
    .sort((left, right) => left.changeSeq - right.changeSeq)
    .map(cloneChange);
}

function validateAccountId(accountId: string): void {
  if (!isId(accountId)) {
    throw new DeviceSyncCloudStoreError('invalid_account', 'invalid account id');
  }
}

function encodeCursor(accountId: string, sequence: number): string {
  const body = `${CURSOR_FORMAT}:${accountScope(accountId)}:${sequence}`;
  return Buffer.from(body, 'utf8').toString('base64url');
}

function decodeCursor(accountId: string, cursor: string | null, maxSequence: number): number {
  if (cursor === null) return 0;
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 512) {
    throw new DeviceSyncCloudStoreError('invalid_cursor', 'invalid cursor');
  }
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new DeviceSyncCloudStoreError('invalid_cursor', 'invalid cursor encoding');
  }
  const match = /^v1:([a-f0-9]{16}):(0|[1-9]\d*)$/.exec(decoded);
  const sequence = match ? Number(match[2]) : Number.NaN;
  if (
    !match ||
    match[1] !== accountScope(accountId) ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    sequence > maxSequence
  ) {
    throw new DeviceSyncCloudStoreError('invalid_cursor', 'cursor is invalid for this account');
  }
  return sequence;
}

function accountScope(accountId: string): string {
  return createHash('sha256').update(accountId).digest('hex').slice(0, 16);
}

function createEmptyAccount(): AccountState {
  return {
    changeSeq: 0,
    entities: new Map(),
    operations: new Map(),
    changes: [],
    live: createEmptyLiveAccount(),
  };
}

function createEmptyLiveAccount(): LiveAccountState {
  return { revision: 0, session: null, operations: new Map() };
}

function cloneAccount(account: AccountState): AccountState {
  return {
    changeSeq: account.changeSeq,
    entities: new Map(
      [...account.entities].map(([entityId, entity]) => [
        entityId,
        {
          revision: entity.revision,
          deleted: entity.deleted,
          payload: cloneBundleOrNull(entity.payload),
        },
      ]),
    ),
    operations: new Map(
      [...account.operations].map(([opId, operation]) => [
        opId,
        { fingerprint: operation.fingerprint, ack: { ...operation.ack } },
      ]),
    ),
    changes: account.changes.map(cloneChange),
    live: cloneLiveAccount(account.live),
  };
}

function cloneLiveAccount(live: LiveAccountState): LiveAccountState {
  return {
    revision: live.revision,
    session: live.session === null ? null : structuredClone(live.session),
    operations: new Map(
      [...live.operations].map(([commandId, operation]) => [
        commandId,
        { fingerprint: operation.fingerprint, ack: { ...operation.ack } },
      ]),
    ),
  };
}

function cloneChange(change: DeviceSyncChange): DeviceSyncChange {
  return { ...change, payload: cloneBundleOrNull(change.payload) };
}

function cloneBundle(bundle: DeviceSyncSessionBundle): DeviceSyncSessionBundle {
  return structuredClone(bundle);
}

function cloneBundleOrNull(bundle: DeviceSyncSessionBundle | null): DeviceSyncSessionBundle | null {
  return bundle === null ? null : cloneBundle(bundle);
}

function loadPersistedStore(filePath: string): Map<string, AccountState> {
  if (!fs.existsSync(filePath)) return new Map();
  let parsed: PersistedStoreFile;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PersistedStoreFile;
  } catch (error) {
    throw new DeviceSyncCloudStoreError(
      'store_corrupt',
      `unable to read test store: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed.format !== STORE_FORMAT || !Array.isArray(parsed.accounts)) {
    throw new DeviceSyncCloudStoreError('store_corrupt', 'unsupported test store format');
  }

  const accounts = new Map<string, AccountState>();
  for (const entry of parsed.accounts) {
    if (!Array.isArray(entry) || entry.length !== 2 || !isId(entry[0])) {
      throw new DeviceSyncCloudStoreError('store_corrupt', 'invalid account entry');
    }
    const [accountId, persisted] = entry;
    if (
      !persisted ||
      !Number.isSafeInteger(persisted.changeSeq) ||
      persisted.changeSeq < 0 ||
      !Array.isArray(persisted.entities) ||
      !Array.isArray(persisted.operations) ||
      !Array.isArray(persisted.changes)
    ) {
      throw new DeviceSyncCloudStoreError('store_corrupt', 'invalid account state');
    }
    const account: AccountState = {
      changeSeq: persisted.changeSeq,
      entities: new Map(persisted.entities),
      operations: new Map(persisted.operations),
      changes: persisted.changes,
      live: hydratePersistedLiveAccount(persisted.live),
    };
    // Reuse the normal clone path so caller mutations cannot retain references into parsed JSON.
    accounts.set(accountId, cloneAccount(account));
  }
  return accounts;
}

function persistStore(filePath: string, accounts: Map<string, AccountState>): void {
  const persisted: PersistedStoreFile = {
    format: STORE_FORMAT,
    accounts: [...accounts].map(([accountId, account]) => [accountId, serializeAccount(account)]),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(persisted), 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  }
}

function serializeAccount(account: AccountState): PersistedAccountState {
  return {
    changeSeq: account.changeSeq,
    entities: [...account.entities].map(([id, entity]) => [
      id,
      { ...entity, payload: cloneBundleOrNull(entity.payload) },
    ]),
    operations: [...account.operations].map(([id, operation]) => [
      id,
      { fingerprint: operation.fingerprint, ack: { ...operation.ack } },
    ]),
    changes: account.changes.map(cloneChange),
    live: {
      revision: account.live.revision,
      session: account.live.session === null ? null : structuredClone(account.live.session),
      operations: [...account.live.operations].map(([commandId, operation]) => [
        commandId,
        { fingerprint: operation.fingerprint, ack: { ...operation.ack } },
      ]),
    },
  };
}

function hydratePersistedLiveAccount(
  persisted: PersistedLiveAccountState | undefined,
): LiveAccountState {
  if (persisted === undefined) return createEmptyLiveAccount();
  if (
    !persisted ||
    !Number.isSafeInteger(persisted.revision) ||
    persisted.revision < 0 ||
    !Array.isArray(persisted.operations) ||
    !isStoredLiveSessionOrNull(persisted.session)
  ) {
    throw new DeviceSyncCloudStoreError('store_corrupt', 'invalid persisted live focus state');
  }

  const operations = new Map<string, StoredLiveOperation>();
  for (const entry of persisted.operations) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !isLiveFocusId(entry[0]) ||
      !isStoredLiveOperation(entry[1]) ||
      operations.has(entry[0])
    ) {
      throw new DeviceSyncCloudStoreError('store_corrupt', 'invalid persisted live operation');
    }
    operations.set(entry[0], {
      fingerprint: entry[1].fingerprint,
      ack: { ...entry[1].ack },
    });
  }
  return {
    revision: persisted.revision,
    session: persisted.session === null ? null : structuredClone(persisted.session),
    operations,
  };
}

function isStoredLiveSessionOrNull(value: unknown): value is StoredLiveSession | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Partial<StoredLiveSession>;
  if (
    !isLiveFocusId(session.id) ||
    (session.title !== null &&
      (typeof session.title !== 'string' || session.title.length > LIVE_FOCUS_MAX_TITLE_LENGTH)) ||
    (session.state !== 'running' && session.state !== 'paused') ||
    !isStoredTimestamp(session.startedAt) ||
    !isStoredTimestamp(session.updatedAt) ||
    session.updatedAt < session.startedAt ||
    !isLiveFocusId(session.lastCommandDeviceId) ||
    !isStoredLiveTaskOrMissing(session.task) ||
    !Array.isArray(session.segments) ||
    !Array.isArray(session.pauses) ||
    session.segments.length < 1 ||
    session.segments.length > LIVE_FOCUS_MAX_TRANSITIONS ||
    session.pauses.length > LIVE_FOCUS_MAX_TRANSITIONS
  ) {
    return false;
  }
  const segmentIds = new Set<string>();
  for (const segment of session.segments) {
    if (
      !segment ||
      typeof segment !== 'object' ||
      Array.isArray(segment) ||
      !isLiveFocusId(segment.id) ||
      segmentIds.has(segment.id) ||
      !isStoredTimestamp(segment.startedAt) ||
      (segment.endedAt !== null && !isStoredTimestamp(segment.endedAt)) ||
      (segment.endedAt !== null && segment.endedAt < segment.startedAt)
    ) {
      return false;
    }
    segmentIds.add(segment.id);
  }
  for (const pause of session.pauses) {
    if (
      !pause ||
      typeof pause !== 'object' ||
      Array.isArray(pause) ||
      !isLiveFocusId(pause.id) ||
      !isLiveFocusId(pause.segmentId) ||
      !segmentIds.has(pause.segmentId) ||
      !isStoredTimestamp(pause.startedAt) ||
      (pause.endedAt !== null && !isStoredTimestamp(pause.endedAt)) ||
      (pause.endedAt !== null && pause.endedAt < pause.startedAt)
    ) {
      return false;
    }
  }
  const openSegments = session.segments.filter((segment) => segment.endedAt === null).length;
  const openPauses = session.pauses.filter((pause) => pause.endedAt === null).length;
  return session.state === 'running'
    ? openSegments === 1 && openPauses === 0
    : openSegments === 0 && openPauses === 1;
}

function isStoredLiveTaskOrMissing(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const task = value as Partial<LiveFocusTaskContext>;
  return (
    isLiveFocusId(task.taskId) &&
    (task.taskSource === 'local' || task.taskSource === 'ticktick') &&
    (task.taskTitle === null ||
      (typeof task.taskTitle === 'string' && task.taskTitle.length <= LIVE_FOCUS_MAX_TITLE_LENGTH))
  );
}

function isStoredLiveOperation(value: unknown): value is StoredLiveOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const operation = value as Partial<StoredLiveOperation>;
  const ack = operation.ack as Partial<LiveFocusCommandAck> | undefined;
  return (
    typeof operation.fingerprint === 'string' &&
    operation.fingerprint.length > 0 &&
    !!ack &&
    isLiveFocusId(ack.commandId) &&
    (ack.status === 'applied' ||
      ack.status === 'duplicate' ||
      ack.status === 'conflict' ||
      ack.status === 'rejected') &&
    Number.isSafeInteger(ack.revision) &&
    Number(ack.revision) >= 0 &&
    (ack.errorCode === null || typeof ack.errorCode === 'string') &&
    (ack.completedEntityId === null || isLiveFocusId(ack.completedEntityId))
  );
}

function isStoredTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= DEVICE_SYNC_MAX_TIMESTAMP_MS
  );
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}
