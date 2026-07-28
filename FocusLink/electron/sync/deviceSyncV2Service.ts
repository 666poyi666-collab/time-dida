import {
  fingerprintDeviceSyncValue,
  toDeviceSyncBundle,
  validateDeviceSyncBundle,
  type DeviceSyncSessionBundle,
} from '@shared/sync/deviceProtocol';
import type { DeviceSyncRunResult } from '@shared/ipc/api';
import {
  SYNC_V2_MAX_PULL,
  SYNC_V2_PROTOCOL_VERSION,
  splitBundleForSyncV2,
  type FocusLedgerCorrectionV2,
  type FocusLedgerV2,
  type FocusMetadataV2,
  type SyncV2Ack,
  type SyncV2Change,
  type SyncV2EntityType,
  type SyncV2Epoch,
  type SyncV2Mutation,
  type SyncV2Payload,
  type SyncV2Request,
  type SyncV2Response,
} from '@shared/sync/v2Protocol';
import {
  getDb,
  getMeta,
  getSession,
  insertDeviceSyncBundleIfMissing,
  listFinishedSessionsForDeviceSync,
  listPauses,
  listSegments,
  setMeta,
} from '../db/index.js';
import {
  claimV2Outbox,
  enqueueV2Mutation,
  hasOpenV2Conflict,
  hasPendingV2Mutation,
  listV2EntityStates,
  migrateLegacyV2State,
  readDesktopV2Status,
  readV2EntityState,
  recordRemoteV2History,
  requeueStaleGenerationV2Outbox,
  retryV2Lease,
  settleV2Ack,
  writeRemoteV2Conflict,
  writeV2EntityState,
} from './v2OutboxStore.js';
import {
  getDeviceSyncDataConnection,
  type DeviceSyncRuntimeConnection,
} from './deviceSyncService.js';

const CHECKPOINT_PREFIX = 'syncV2.desktop.checkpointV2';
const LAST_SYNC_PREFIX = 'deviceSync.lastSyncAtV2';
const LAST_ERROR_PREFIX = 'deviceSync.lastErrorV2';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PAGES_PER_RUN = 500;

interface Checkpoint extends SyncV2Epoch {
  version: 2;
  state: 'uninitialized' | 'v2-active';
  cursor: string | null;
  lastChangeSeq: number;
  updatedAt: number;
}

interface EpochStatus extends SyncV2Epoch {
  protocolVersion: typeof SYNC_V2_PROTOCOL_VERSION;
  changeSeq: number;
  serverTime: number;
}

interface LocalEntity {
  entityType: SyncV2EntityType;
  entityId: string;
  payload: SyncV2Payload;
  deviceId: string;
}

export async function runDesktopSyncV2(): Promise<DeviceSyncRunResult | null> {
  const connection = getDeviceSyncDataConnection();
  if (!connection) return null;
  migrateLegacyV2State(connection.scope);

  let checkpoint = readCheckpoint(connection.scope);
  const status = await getEpochStatus(connection);
  if (!sameEpoch(checkpoint, status)) {
    requeueStaleGenerationV2Outbox(connection.scope, status.accountGeneration);
    checkpoint = {
      version: 2,
      state: 'uninitialized',
      cursor: null,
      syncEpoch: status.syncEpoch,
      cursorEpoch: status.cursorEpoch,
      accountGeneration: status.accountGeneration,
      lastChangeSeq: 0,
      updatedAt: Date.now(),
    };
    writeCheckpoint(connection.scope, checkpoint);
  }

  const result: DeviceSyncRunResult = {
    pushed: 0,
    pulled: 0,
    imported: 0,
    duplicates: 0,
    conflicts: 0,
    rejected: 0,
    cursor: checkpoint.cursor ?? 'c0',
    unresolvedConflicts: 0,
  };

  try {
    // A new device/account always replays the authority from c0 before staging
    // local mutations.  That prevents an old local inventory from becoming the
    // first writer merely because this client started first.
    if (checkpoint.state !== 'v2-active') {
      checkpoint = await drainPages(connection, checkpoint, result, false);
      checkpoint = { ...checkpoint, state: 'v2-active', updatedAt: Date.now() };
      writeCheckpoint(connection.scope, checkpoint);
    }

    enqueueChangedEntities(connection, checkpoint.accountGeneration);
    checkpoint = await drainPages(connection, checkpoint, result, true);
    const localStatus = readDesktopV2Status(connection.scope);
    result.unresolvedConflicts = localStatus.conflicts;
    setMeta(`${LAST_SYNC_PREFIX}.${connection.scope}`, String(Date.now()));
    setMeta(
      `${LAST_ERROR_PREFIX}.${connection.scope}`,
      localStatus.conflicts > 0
        ? `存在 ${localStatus.conflicts} 个未解决的跨设备冲突`
        : localStatus.rejected > 0
          ? `存在 ${localStatus.rejected} 个被权威拒绝的同步操作`
          : '',
    );
    return result;
  } catch (error) {
    setMeta(
      `${LAST_ERROR_PREFIX}.${connection.scope}`,
      (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
    );
    throw error;
  }
}

export function readDesktopSyncV2Checkpoint(scope: string): {
  cursor: string | null;
  lastChangeSeq: number;
} {
  const checkpoint = readCheckpoint(scope);
  return { cursor: checkpoint.cursor, lastChangeSeq: checkpoint.lastChangeSeq };
}

async function drainPages(
  connection: DeviceSyncRuntimeConnection,
  initial: Checkpoint,
  result: DeviceSyncRunResult,
  allowPush: boolean,
): Promise<Checkpoint> {
  let checkpoint = initial;
  for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
    const claimed = allowPush ? claimV2Outbox(connection.scope, 1) : { leaseId: '', items: [] };
    const request: SyncV2Request = {
      protocolVersion: SYNC_V2_PROTOCOL_VERSION,
      deviceId: connection.deviceId,
      cursor: checkpoint.cursor,
      mutations: claimed.items.map(stripOutboxState),
      pullLimit: Math.min(100, SYNC_V2_MAX_PULL),
      syncEpoch: checkpoint.syncEpoch,
      cursorEpoch: checkpoint.cursorEpoch,
      accountGeneration: checkpoint.accountGeneration,
    };
    let response: SyncV2Response;
    try {
      response = await exchange(connection, request);
      assertResponseMatchesRequest(response, request, checkpoint);
      checkpoint = applyPageAtomically(
        connection,
        checkpoint,
        claimed.leaseId,
        claimed.items,
        response,
        result,
      );
    } catch (error) {
      if (claimed.items.length > 0) {
        retryV2Lease(connection.scope, claimed.leaseId, errorCode(error), Date.now() + 30_000);
      }
      throw error;
    }
    if (claimed.items.length === 0 && !response.hasMore) return checkpoint;
  }
  throw new Error('Sync v2 分页或 outbox 数量超过单轮安全上限');
}

function applyPageAtomically(
  connection: DeviceSyncRuntimeConnection,
  previous: Checkpoint,
  leaseId: string,
  claimed: ReturnType<typeof claimV2Outbox>['items'],
  response: SyncV2Response,
  result: DeviceSyncRunResult,
): Checkpoint {
  const db = getDb();
  return db.transaction(() => {
    for (const ack of response.acks) {
      const item = claimed.find((candidate) => candidate.opId === ack.opId);
      if (!item || !settleV2Ack(connection.scope, leaseId, ack, item.payload, response)) {
        throw new Error('Sync v2 ACK 不属于当前持久 lease');
      }
      if (ack.status === 'applied') result.pushed += 1;
      if (ack.status === 'duplicate') result.duplicates += 1;
      if (ack.status === 'conflict') result.conflicts += 1;
      if (ack.status === 'rejected') result.rejected += 1;
    }

    for (const change of response.changes) {
      const outcome = applyRemoteChange(connection, change, response);
      result.pulled += 1;
      if (outcome === 'imported') result.imported += 1;
      if (outcome === 'conflict') result.conflicts += 1;
      recordRemoteV2History(connection.scope, change);
    }

    const next: Checkpoint = {
      version: 2,
      state: previous.state,
      cursor: response.nextCursor,
      syncEpoch: response.syncEpoch,
      cursorEpoch: response.cursorEpoch,
      accountGeneration: response.accountGeneration,
      lastChangeSeq: response.changes.at(-1)?.changeSeq ?? parseCursor(response.nextCursor),
      updatedAt: Date.now(),
    };
    writeCheckpoint(connection.scope, next);
    result.cursor = response.nextCursor;
    return next;
  })();
}

function applyRemoteChange(
  connection: DeviceSyncRuntimeConnection,
  change: SyncV2Change,
  epoch: SyncV2Epoch,
): 'stored' | 'imported' | 'conflict' {
  const existing = readV2EntityState(connection.scope, change.entityType, change.entityId);
  if (existing && change.revision <= existing.confirmedRevision) return 'stored';

  const local = collectLocalEntity(connection.deviceId, change.entityType, change.entityId);
  const pending = hasPendingV2Mutation(connection.scope, change.entityType, change.entityId);
  const localFingerprint = local
    ? fingerprintDeviceSyncValue({ deleted: false, payload: local.payload })
    : null;
  const localChangedFromBase =
    localFingerprint !== null &&
    existing !== null &&
    localFingerprint !== existing.confirmedFingerprint;
  const conflictsWithPending =
    pending !== null &&
    fingerprintDeviceSyncValue({ deleted: pending.payload === null, payload: pending.payload }) !==
      change.fingerprint;

  if ((change.deleted && local !== null) || localChangedFromBase || conflictsWithPending) {
    writeRemoteV2Conflict(
      connection.scope,
      change,
      local?.payload ?? pending?.payload ?? null,
      existing?.baseSnapshot ?? null,
    );
    return 'conflict';
  }

  writeV2EntityState(connection.scope, {
    entityType: change.entityType,
    entityId: change.entityId,
    revision: change.revision,
    fingerprint: change.fingerprint,
    payload: change.payload,
    deleted: change.deleted,
    changeSeq: change.changeSeq,
    sourceDeviceId: change.sourceDeviceId,
    epoch,
  });

  if (change.deleted) return 'stored';
  if (change.entityType === 'focus_metadata_v2' && local !== null && !localChangedFromBase) {
    applyRemoteMetadata(change.payload as FocusMetadataV2);
  }
  return materializeRemoteSession(connection.scope, change.entityId) ? 'imported' : 'stored';
}

function materializeRemoteSession(connectionScope: string, entityId: string): boolean {
  if (getSession(entityId)) return false;
  const states = listV2EntityStates(connectionScope, entityId);
  const ledger = states.find((state) => state.entityType === 'focus_ledger_v2' && !state.deleted)
    ?.baseSnapshot as FocusLedgerV2 | undefined;
  const metadata = states.find(
    (state) => state.entityType === 'focus_metadata_v2' && !state.deleted,
  )?.baseSnapshot as FocusMetadataV2 | undefined;
  if (!ledger || !metadata) return false;
  const bundle = joinV2Bundle(ledger, metadata);
  const validation = validateDeviceSyncBundle(bundle);
  if (!validation.ok) throw new Error(`远端 v2 会话无法物化：${validation.error ?? 'invalid'}`);
  return insertDeviceSyncBundleIfMissing(bundle);
}

function applyRemoteMetadata(metadata: FocusMetadataV2): void {
  if (!getSession(metadata.sessionId)) return;
  getDb()
    .prepare(
      `UPDATE focus_sessions SET title = ?, note = ?, default_task_id = ?,
       default_task_source = ?, default_task_title = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      metadata.title,
      metadata.note,
      metadata.taskAssociation?.taskId ?? null,
      metadata.taskAssociation?.source ?? null,
      metadata.taskAssociation?.title ?? null,
      metadata.updatedAt,
      metadata.sessionId,
    );
}

function joinV2Bundle(ledger: FocusLedgerV2, metadata: FocusMetadataV2): DeviceSyncSessionBundle {
  return {
    session: {
      id: ledger.sessionId,
      title: metadata.title,
      status: ledger.status,
      startedAt: ledger.startedAt,
      endedAt: ledger.endedAt,
      activeElapsedMs: ledger.activeElapsedMs,
      pauseElapsedMs: ledger.pausedElapsedMs,
      wallElapsedMs: ledger.wallElapsedMs,
      defaultTaskId: metadata.taskAssociation?.taskId ?? null,
      defaultTaskSource: metadata.taskAssociation?.source ?? null,
      defaultTaskTitle: metadata.taskAssociation?.title ?? null,
      note: metadata.note,
      createdAt: ledger.startedAt,
      updatedAt: Math.max(metadata.updatedAt, ledger.endedAt),
    },
    segments: ledger.segments,
    pauses: ledger.pauses,
  };
}

function enqueueChangedEntities(
  connection: DeviceSyncRuntimeConnection,
  accountGeneration: number,
): void {
  for (const entity of collectEntities(connection.deviceId)) {
    if (hasOpenV2Conflict(connection.scope, entity.entityType, entity.entityId)) continue;
    const state = readV2EntityState(connection.scope, entity.entityType, entity.entityId);
    const fingerprint = fingerprintDeviceSyncValue({ deleted: false, payload: entity.payload });
    if (state?.confirmedFingerprint === fingerprint) continue;

    if (entity.entityType === 'focus_ledger_v2' && state?.baseSnapshot && !state.deleted) {
      const correctionId = `correction-${fingerprintDeviceSyncValue({
        entityId: entity.entityId,
        before: state.confirmedFingerprint,
        after: fingerprint,
      })}`;
      const payload: FocusLedgerCorrectionV2 = {
        correctionId,
        sessionId: entity.entityId,
        baseLedgerRevision: state.confirmedRevision,
        before: state.baseSnapshot as FocusLedgerV2,
        after: entity.payload as FocusLedgerV2,
        reason: 'local_ledger_changed_after_sync',
        createdAt: Date.now(),
        createdByDeviceId: connection.deviceId,
      };
      enqueueV2Mutation(connection.scope, {
        opId: `v2-${fingerprintDeviceSyncValue({ connection: connection.scope, payload })}`,
        entityType: 'focus_ledger_correction_v2',
        entityId: correctionId,
        kind: 'put',
        baseRevision: 0,
        baseFingerprint: null,
        payload,
        deviceId: connection.deviceId,
        accountGeneration,
      });
      continue;
    }

    enqueueV2Mutation(connection.scope, {
      ...entity,
      opId: `v2-${fingerprintDeviceSyncValue({
        connection: connection.scope,
        entity,
        baseRevision: state?.confirmedRevision ?? 0,
      })}`,
      kind: 'put',
      baseRevision: state?.confirmedRevision ?? 0,
      baseFingerprint: state?.confirmedFingerprint ?? null,
      accountGeneration,
    });
  }
}

function collectEntities(deviceId: string): LocalEntity[] {
  return listFinishedSessionsForDeviceSync().flatMap((session) => {
    const split = splitBundleForSyncV2(
      toDeviceSyncBundle(session, listSegments(session.id), listPauses(session.id)),
      deviceId,
    );
    return [
      {
        entityType: 'focus_ledger_v2' as const,
        entityId: session.id,
        payload: split.ledger,
        deviceId,
      },
      {
        entityType: 'focus_metadata_v2' as const,
        entityId: session.id,
        payload: split.metadata,
        deviceId,
      },
    ];
  });
}

function collectLocalEntity(
  deviceId: string,
  entityType: SyncV2EntityType,
  entityId: string,
): LocalEntity | null {
  if (entityType === 'focus_ledger_correction_v2') return null;
  const session = getSession(entityId);
  if (!session || session.endedAt === null) return null;
  const split = splitBundleForSyncV2(
    toDeviceSyncBundle(session, listSegments(entityId), listPauses(entityId)),
    deviceId,
  );
  return {
    entityType,
    entityId,
    payload: entityType === 'focus_ledger_v2' ? split.ledger : split.metadata,
    deviceId,
  };
}

async function getEpochStatus(connection: DeviceSyncRuntimeConnection): Promise<EpochStatus> {
  const value = await requestJson(connection, '/sync/v2/status', 'GET');
  if (
    !isRecord(value) ||
    value.protocolVersion !== SYNC_V2_PROTOCOL_VERSION ||
    !isEpoch(value) ||
    !Number.isSafeInteger(value.changeSeq) ||
    Number(value.changeSeq) < 0 ||
    !isTimestamp(value.serverTime)
  ) {
    throw new Error('canonical Sync v2 status 响应无效');
  }
  return value as unknown as EpochStatus;
}

async function exchange(
  connection: DeviceSyncRuntimeConnection,
  request: SyncV2Request,
): Promise<SyncV2Response> {
  return (await requestJson(connection, '/sync/v2/exchange', 'POST', request)) as SyncV2Response;
}

async function requestJson(
  connection: DeviceSyncRuntimeConnection,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${connection.endpoint}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${connection.accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      throw new Error(`canonical Sync v2 ${path} 返回非 JSON 响应`);
    }
    const value = (await response.json()) as unknown;
    if (!response.ok) {
      const code =
        isRecord(value) && isRecord(value.error) && typeof value.error.code === 'string'
          ? value.error.code.slice(0, 120)
          : `http_${response.status}`;
      throw new Error(`canonical Sync v2 ${path} failed: ${response.status} ${code}`);
    }
    return value;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`canonical Sync v2 ${path} 请求超时`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function assertResponseMatchesRequest(
  value: unknown,
  request: SyncV2Request,
  previous: Checkpoint,
): asserts value is SyncV2Response {
  if (
    !isRecord(value) ||
    value.protocolVersion !== SYNC_V2_PROTOCOL_VERSION ||
    !isEpoch(value) ||
    !Array.isArray(value.acks) ||
    !Array.isArray(value.changes) ||
    typeof value.nextCursor !== 'string' ||
    typeof value.hasMore !== 'boolean' ||
    !isTimestamp(value.serverTime)
  ) {
    throw new Error('canonical Sync v2 exchange 响应格式无效');
  }
  if (!sameEpoch(value as unknown as SyncV2Epoch, previous)) {
    throw new Error('canonical Sync v2 响应 epoch 与请求不一致');
  }
  const expected = new Map(request.mutations.map((mutation) => [mutation.opId, mutation]));
  if (expected.size !== request.mutations.length || value.acks.length !== expected.size) {
    throw new Error('canonical Sync v2 ACK 数量无效');
  }
  const seen = new Set<string>();
  for (const candidate of value.acks) {
    if (!isAck(candidate)) throw new Error('canonical Sync v2 ACK 格式无效');
    const mutation = expected.get(candidate.opId);
    if (
      !mutation ||
      seen.has(candidate.opId) ||
      candidate.entityType !== mutation.entityType ||
      candidate.entityId !== mutation.entityId
    ) {
      throw new Error('canonical Sync v2 ACK 不属于本次请求');
    }
    seen.add(candidate.opId);
  }
  let lastSeq = previous.lastChangeSeq;
  for (const candidate of value.changes) {
    if (!isChange(candidate) || candidate.changeSeq <= lastSeq) {
      throw new Error('canonical Sync v2 change feed 非严格单调');
    }
    lastSeq = candidate.changeSeq;
  }
  const next = parseCursor(value.nextCursor);
  const previousCursor = previous.cursor === null ? 0 : parseCursor(previous.cursor);
  if (next < previousCursor || (value.hasMore && next === previousCursor)) {
    throw new Error('canonical Sync v2 cursor 未单调推进');
  }
}

function isAck(value: unknown): value is SyncV2Ack {
  if (!isRecord(value)) return false;
  return (
    isId(value.opId) &&
    isEntityType(value.entityType) &&
    isId(value.entityId) &&
    ['applied', 'duplicate', 'conflict', 'rejected'].includes(String(value.status)) &&
    (value.revision === null ||
      (Number.isSafeInteger(value.revision) && Number(value.revision) >= 1)) &&
    (value.fingerprint === null || isFingerprint(value.fingerprint)) &&
    (value.errorCode === null ||
      (typeof value.errorCode === 'string' && value.errorCode.length <= 240))
  );
}

function isChange(value: unknown): value is SyncV2Change {
  if (!isRecord(value)) return false;
  return (
    Number.isSafeInteger(value.changeSeq) &&
    Number(value.changeSeq) >= 1 &&
    isEntityType(value.entityType) &&
    isId(value.entityId) &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) >= 1 &&
    isFingerprint(value.fingerprint) &&
    typeof value.deleted === 'boolean' &&
    ((value.deleted && value.payload === null) || (!value.deleted && isRecord(value.payload))) &&
    isId(value.sourceDeviceId)
  );
}

function stripOutboxState(item: ReturnType<typeof claimV2Outbox>['items'][number]): SyncV2Mutation {
  return {
    opId: item.opId,
    entityType: item.entityType,
    entityId: item.entityId,
    kind: item.kind,
    baseRevision: item.baseRevision,
    baseFingerprint: item.baseFingerprint,
    payload: item.payload,
    deviceId: item.deviceId,
    accountGeneration: item.accountGeneration,
  };
}

function readCheckpoint(scope: string): Checkpoint {
  const raw = getMeta(`${CHECKPOINT_PREFIX}.${scope}`);
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown;
      if (
        isRecord(value) &&
        value.version === 2 &&
        (value.state === 'uninitialized' || value.state === 'v2-active') &&
        (value.cursor === null ||
          (typeof value.cursor === 'string' && parseCursor(value.cursor) >= 0)) &&
        isEpoch(value) &&
        Number.isSafeInteger(value.lastChangeSeq) &&
        Number(value.lastChangeSeq) >= 0 &&
        isTimestamp(value.updatedAt)
      ) {
        return value as unknown as Checkpoint;
      }
    } catch {
      // A malformed checkpoint is isolated by its connection-scoped key and
      // rebuilt from c0; durable outbox/conflict rows stay untouched.
    }
  }
  return {
    version: 2,
    state: 'uninitialized',
    cursor: null,
    syncEpoch: '',
    cursorEpoch: '',
    accountGeneration: 1,
    lastChangeSeq: 0,
    updatedAt: 0,
  };
}

function writeCheckpoint(scope: string, checkpoint: Checkpoint): void {
  setMeta(`${CHECKPOINT_PREFIX}.${scope}`, JSON.stringify(checkpoint));
}

function sameEpoch(left: SyncV2Epoch, right: SyncV2Epoch): boolean {
  return (
    left.syncEpoch === right.syncEpoch &&
    left.cursorEpoch === right.cursorEpoch &&
    left.accountGeneration === right.accountGeneration
  );
}

function parseCursor(value: string): number {
  if (!/^c[0-9a-z]+$/.test(value)) throw new Error('canonical Sync v2 cursor 格式无效');
  const parsed = Number.parseInt(value.slice(1), 36);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('canonical Sync v2 cursor 数值无效');
  }
  return parsed;
}

function isEpoch(value: Record<string, unknown>): boolean {
  return (
    typeof value.syncEpoch === 'string' &&
    value.syncEpoch.length >= 1 &&
    value.syncEpoch.length <= 128 &&
    typeof value.cursorEpoch === 'string' &&
    value.cursorEpoch.length >= 1 &&
    value.cursorEpoch.length <= 128 &&
    Number.isSafeInteger(value.accountGeneration) &&
    Number(value.accountGeneration) >= 1
  );
}

function isEntityType(value: unknown): value is SyncV2EntityType {
  return (
    value === 'focus_ledger_v2' ||
    value === 'focus_metadata_v2' ||
    value === 'focus_ledger_correction_v2'
  );
}

function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32,128}$/i.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorCode(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 240);
}
