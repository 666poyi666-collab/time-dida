import {
  fingerprintDeviceSyncValue,
  normalizeDeviceSyncEndpoint,
} from '@shared/sync/deviceProtocol';
import {
  SYNC_V2_MAX_RESPONSE_BYTES,
  SYNC_V2_MAX_PULL,
  SYNC_V2_PROTOCOL_VERSION,
  parseDeviceToken,
  splitBundleForSyncV2,
  type SyncV2Ack,
  type SyncV2Change,
  type SyncV2Epoch,
  type SyncV2Mutation,
  type SyncV2Response,
} from '@shared/sync/v2Protocol';
import { readDeviceSyncJsonResponse } from '@shared/sync/httpTransport';
import {
  SyncV2ClientError,
  classifySyncV2Error,
  safeSyncV2Error,
} from '@shared/sync/v2ClientError';
import {
  readMobileCache,
  readPendingDeviceSyncBundles,
  removePendingDeviceSyncBundle,
} from './cache';
import {
  applyMobileV2ChangesAndCheckpoint,
  claimMobileV2Outbox,
  enqueueMobileV2Mutation,
  mobileV2EntityMatches,
  readMobileV2Bootstrap,
  readMobileV2EntityState,
  readMobileV2Status,
  resetMobileV2Epoch,
  retryMobileV2Lease,
  writeMobileV2SyncFailure,
  writeMobileV2Bootstrap,
  type MobileV2BootstrapCheckpoint,
} from './v2Cache';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PAGES_PER_RUN = 500;

interface MobileSyncV2Input {
  endpoint: string;
  token: string;
  deviceId: string;
  signal?: AbortSignal;
}

interface MobileSyncV2Result {
  uploaded: number;
  downloaded: number;
  imported: number;
  conflicts: number;
  rejected: number;
  cursor: string;
  unresolvedConflicts: number;
}

interface EpochStatus extends SyncV2Epoch {
  protocolVersion: typeof SYNC_V2_PROTOCOL_VERSION;
  changeSeq: number;
  serverTime: number;
}

export async function runMobileSyncV2(input: MobileSyncV2Input): Promise<MobileSyncV2Result> {
  const routedForStatus = parseDeviceToken(input.token.trim());
  const statusDeviceId = routedForStatus
    ? `device-${routedForStatus.devicePublicId}`
    : input.deviceId;
  try {
    return await runMobileSyncV2Internal(input);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const safe = safeSyncV2Error(error);
    await writeMobileV2SyncFailure(statusDeviceId, safe.code);
    throw safe;
  }
}

async function runMobileSyncV2Internal(input: MobileSyncV2Input): Promise<MobileSyncV2Result> {
  const endpoint = normalizeDeviceSyncEndpoint(input.endpoint);
  const routed = parseDeviceToken(input.token.trim());
  const loopback = ['localhost', '127.0.0.1'].includes(new URL(endpoint).hostname);
  if (!routed && !loopback) {
    throw new Error('canonical Sync v2 只接受通过设备配对签发的 fl2 凭据');
  }
  const connection = {
    ...input,
    endpoint,
    token: input.token.trim(),
    deviceId: routed ? `device-${routed.devicePublicId}` : input.deviceId,
  };
  const status = await getEpochStatus(connection);
  let checkpoint = normalizeCheckpoint(await readMobileV2Bootstrap());
  if (
    !checkpoint ||
    !sameEpoch(checkpoint, status) ||
    checkpoint.boundDeviceId !== connection.deviceId
  ) {
    checkpoint = {
      key: 'syncV2.bootstrap',
      state: 'uninitialized',
      bootstrapId: null,
      cursor: null,
      boundDeviceId: connection.deviceId,
      syncEpoch: status.syncEpoch,
      cursorEpoch: status.cursorEpoch,
      accountGeneration: status.accountGeneration,
      updatedAt: Date.now(),
    };
    await resetMobileV2Epoch(checkpoint);
  } else if (checkpoint.cursor !== null && parseCursor(checkpoint.cursor) > status.changeSeq) {
    throw new SyncV2ClientError('cursor_ahead');
  }

  const result = {
    uploaded: 0,
    downloaded: 0,
    imported: 0,
    conflicts: 0,
    rejected: 0,
    cursor: checkpoint.cursor ?? 'c0',
    unresolvedConflicts: 0,
  };

  // Pull the entire authority first.  No local outbox is claimed until the
  // bootstrap cursor and materialized entities have reached the current tail.
  if (checkpoint.state !== 'v2-active') {
    checkpoint = await drain(connection, checkpoint, result, false);
    checkpoint = { ...checkpoint, state: 'v2-active', updatedAt: Date.now() };
    await writeMobileV2Bootstrap(checkpoint);
  }

  await enqueueLegacyPendingBundles(connection.deviceId, checkpoint.accountGeneration);
  await enqueueChangedCachedEntities(connection.deviceId, checkpoint.accountGeneration);
  checkpoint = await drain(connection, checkpoint, result, true);
  await removeConfirmedLegacyPending(connection.deviceId);
  const localStatus = await readMobileV2Status(connection.deviceId);
  result.unresolvedConflicts = localStatus.conflicts;
  result.rejected = Math.max(result.rejected, localStatus.rejected);
  return result;
}

async function drain(
  connection: {
    endpoint: string;
    token: string;
    deviceId: string;
    signal?: AbortSignal;
  },
  initial: MobileV2BootstrapCheckpoint,
  result: {
    uploaded: number;
    downloaded: number;
    imported: number;
    conflicts: number;
    rejected: number;
    cursor: string;
  },
  allowPush: boolean,
): Promise<MobileV2BootstrapCheckpoint> {
  let checkpoint = initial;
  for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
    const claimed = allowPush
      ? await claimMobileV2Outbox(connection.deviceId, 1)
      : { leaseId: '', items: [] };
    const request = {
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
      assertResponse(response, request, checkpoint);
      checkpoint = {
        ...checkpoint,
        ...response,
        state: checkpoint.state,
        cursor: response.nextCursor,
        updatedAt: Date.now(),
      };
      const materialized = await applyMobileV2ChangesAndCheckpoint({
        changes: response.changes,
        checkpoint,
        serverTime: response.serverTime,
        deviceId: connection.deviceId,
        leaseId: claimed.leaseId,
        acks: response.acks,
      });
      for (const ack of response.acks) {
        if (ack.status === 'applied' || ack.status === 'duplicate') result.uploaded += 1;
        if (ack.status === 'conflict') result.conflicts += 1;
        if (ack.status === 'rejected') result.rejected += 1;
      }
      result.downloaded += response.changes.length;
      result.imported += materialized.imported;
      result.conflicts += materialized.conflicts;
      result.cursor = response.nextCursor;
    } catch (error) {
      if (claimed.items.length > 0) {
        await retryMobileV2Lease(claimed.leaseId, classifySyncV2Error(error), Date.now() + 30_000);
      }
      throw error;
    }
    if (claimed.items.length === 0 && !response.hasMore) return checkpoint;
  }
  throw new Error('Sync v2 分页或 outbox 数量超过单轮安全上限');
}

async function enqueueLegacyPendingBundles(deviceId: string, generation: number): Promise<void> {
  for (const record of await readPendingDeviceSyncBundles()) {
    if (record.state === 'conflict' || record.state === 'rejected') continue;
    if (record.syncDeviceId !== null && record.syncDeviceId !== deviceId) continue;
    const split = splitBundleForSyncV2(record.bundle, deviceId);
    for (const entity of [
      { entityType: 'focus_ledger_v2' as const, entityId: record.entityId, payload: split.ledger },
      {
        entityType: 'focus_metadata_v2' as const,
        entityId: record.entityId,
        payload: split.metadata,
      },
    ]) {
      const state = await readMobileV2EntityState(entity.entityType, entity.entityId);
      const fingerprint = fingerprintDeviceSyncValue({ deleted: false, payload: entity.payload });
      if (state?.confirmedFingerprint === fingerprint) continue;
      const baseRevision = state?.confirmedRevision ?? 0;
      await enqueueIgnoringDuplicate({
        ...entity,
        opId: `v2-${fingerprintDeviceSyncValue({ entity, baseRevision, deviceId })}`,
        kind: 'put',
        baseRevision,
        baseFingerprint: state?.confirmedFingerprint ?? null,
        deviceId,
        accountGeneration: generation,
      });
    }
  }
}

async function enqueueChangedCachedEntities(deviceId: string, generation: number): Promise<void> {
  for (const cached of (await readMobileCache()).bundles) {
    const split = splitBundleForSyncV2(cached.bundle, deviceId);
    for (const entity of [
      { entityType: 'focus_ledger_v2' as const, entityId: cached.entityId, payload: split.ledger },
      {
        entityType: 'focus_metadata_v2' as const,
        entityId: cached.entityId,
        payload: split.metadata,
      },
    ]) {
      const state = await readMobileV2EntityState(entity.entityType, entity.entityId);
      // `bundles` is a lossy UI projection. Once a canonical state exists it
      // must not be rebuilt into a mutation on every refresh/re-pair.
      if (state) continue;
      await enqueueIgnoringDuplicate({
        ...entity,
        opId: `v2-${fingerprintDeviceSyncValue({ entity, baseRevision: 0, deviceId })}`,
        kind: 'put',
        baseRevision: 0,
        baseFingerprint: null,
        deviceId,
        accountGeneration: generation,
      });
    }
  }
}

async function removeConfirmedLegacyPending(deviceId: string): Promise<void> {
  for (const record of await readPendingDeviceSyncBundles()) {
    if (record.syncDeviceId !== null && record.syncDeviceId !== deviceId) continue;
    const split = splitBundleForSyncV2(record.bundle, deviceId);
    const ledgerFingerprint = fingerprintDeviceSyncValue({ deleted: false, payload: split.ledger });
    const metadataFingerprint = fingerprintDeviceSyncValue({
      deleted: false,
      payload: split.metadata,
    });
    if (
      (await mobileV2EntityMatches('focus_ledger_v2', record.entityId, ledgerFingerprint)) &&
      (await mobileV2EntityMatches('focus_metadata_v2', record.entityId, metadataFingerprint))
    ) {
      await removePendingDeviceSyncBundle(record.opId);
    }
  }
}

async function enqueueIgnoringDuplicate(mutation: SyncV2Mutation): Promise<void> {
  await enqueueMobileV2Mutation(mutation);
}

async function getEpochStatus(input: {
  endpoint: string;
  token: string;
  signal?: AbortSignal;
}): Promise<EpochStatus> {
  const value = await requestJson(input, '/sync/v2/status', 'GET');
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
  input: { endpoint: string; token: string; signal?: AbortSignal },
  body: unknown,
): Promise<SyncV2Response> {
  return (await requestJson(input, '/sync/v2/exchange', 'POST', body)) as SyncV2Response;
}

async function requestJson(
  input: { endpoint: string; token: string; signal?: AbortSignal },
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) abort();
  else input.signal?.addEventListener('abort', abort, { once: true });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${input.endpoint}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${input.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      throw new SyncV2ClientError('contract_error');
    }
    const value = await readDeviceSyncJsonResponse(response, SYNC_V2_MAX_RESPONSE_BYTES);
    if (!response.ok) {
      if (response.status === 401) throw new SyncV2ClientError('authentication_failed');
      if (response.status === 403) throw new SyncV2ClientError('authorization_failed');
      throw new SyncV2ClientError('contract_error');
    }
    return value;
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (timedOut) throw new SyncV2ClientError('timeout');
    throw error;
  } finally {
    window.clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
  }
}

function assertResponse(
  value: unknown,
  request: { mutations: SyncV2Mutation[]; cursor: string | null },
  checkpoint: MobileV2BootstrapCheckpoint,
): asserts value is SyncV2Response {
  if (
    !isRecord(value) ||
    value.protocolVersion !== SYNC_V2_PROTOCOL_VERSION ||
    !isEpoch(value) ||
    !Array.isArray(value.acks) ||
    !Array.isArray(value.changes) ||
    typeof value.nextCursor !== 'string' ||
    typeof value.hasMore !== 'boolean' ||
    !isTimestamp(value.serverTime) ||
    !sameEpoch(value as unknown as SyncV2Epoch, checkpoint)
  ) {
    throw new Error('canonical Sync v2 exchange 响应格式无效');
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
  let previousSeq = request.cursor === null ? 0 : parseCursor(request.cursor);
  for (const candidate of value.changes) {
    if (!isChange(candidate) || candidate.changeSeq <= previousSeq) {
      throw new Error('canonical Sync v2 change feed 非严格单调');
    }
    previousSeq = candidate.changeSeq;
  }
  const next = parseCursor(value.nextCursor);
  const before = request.cursor === null ? 0 : parseCursor(request.cursor);
  if (next < before || (value.hasMore && next === before)) {
    throw new Error('canonical Sync v2 cursor 未单调推进');
  }
}

function normalizeCheckpoint(
  value: MobileV2BootstrapCheckpoint | null,
): MobileV2BootstrapCheckpoint | null {
  if (!value || !isEpoch(value as unknown as Record<string, unknown>)) return null;
  if (!isId(value.boundDeviceId)) return null;
  if (value.cursor !== null) {
    try {
      parseCursor(value.cursor);
    } catch {
      return null;
    }
  }
  return value;
}

function stripOutboxState(
  item: Awaited<ReturnType<typeof claimMobileV2Outbox>>['items'][number],
): SyncV2Mutation {
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

function isAck(value: unknown): value is SyncV2Ack {
  return (
    isRecord(value) &&
    isId(value.opId) &&
    isEntityType(value.entityType) &&
    isId(value.entityId) &&
    ['applied', 'duplicate', 'conflict', 'rejected'].includes(String(value.status)) &&
    (value.revision === null ||
      (Number.isSafeInteger(value.revision) && Number(value.revision) >= 1)) &&
    (value.fingerprint === null || isFingerprint(value.fingerprint)) &&
    (value.errorCode === null || typeof value.errorCode === 'string')
  );
}

function isChange(value: unknown): value is SyncV2Change {
  return (
    isRecord(value) &&
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

function parseCursor(value: string): number {
  if (!/^c[0-9a-z]+$/.test(value)) throw new Error('canonical Sync v2 cursor 格式无效');
  const parsed = Number.parseInt(value.slice(1), 36);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Sync v2 cursor 数值无效');
  return parsed;
}

function sameEpoch(left: SyncV2Epoch, right: SyncV2Epoch): boolean {
  return (
    left.syncEpoch === right.syncEpoch &&
    left.cursorEpoch === right.cursorEpoch &&
    left.accountGeneration === right.accountGeneration
  );
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

function isEntityType(value: unknown): boolean {
  return (
    value === 'focus_ledger_v2' ||
    value === 'focus_metadata_v2' ||
    value === 'focus_ledger_correction_v2'
  );
}

function isFingerprint(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{32,128}$/i.test(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200;
}

function isTimestamp(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
