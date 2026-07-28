import { DEVICE_SYNC_MAX_BODY_BYTES, type DeviceSyncSessionBundle } from './deviceProtocol';

export const SYNC_V2_PROTOCOL_VERSION = 2 as const;
export const SYNC_V2_MAX_PUSH = 200;
export const SYNC_V2_MAX_PULL = 500;
export const SYNC_V2_DEFAULT_LEASE_MS = 30_000;
/** Matches foxlink-cloud-mcp MAX_EXCHANGE_BODY_BYTES. */
export const SYNC_V2_MAX_ENTITY_BYTES = DEVICE_SYNC_MAX_BODY_BYTES;
/** Matches foxlink-cloud-mcp MAX_UPSTREAM_RESPONSE_BYTES. */
export const SYNC_V2_MAX_RESPONSE_BYTES = 1_100_000;

export type SyncV2EntityType =
  | 'focus_ledger_v2'
  | 'focus_metadata_v2'
  | 'focus_ledger_correction_v2'
  | 'focus_guard_rule_v1'
  | 'focus_guard_state_v1'
  | 'focus_guard_completion_v1'
  | 'focus_guard_config_v1';
export type SyncV2MutationKind = 'put' | 'delete' | 'restore' | 'purge';
export type SyncV2AckStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';
export type SyncV2BootstrapState =
  'uninitialized' | 'inventory-uploaded' | 'manifest-received' | 'base-established' | 'v2-active';
export type SyncV2OutboxState = 'pending' | 'uploading' | 'retry' | 'conflict' | 'rejected';
export type DeviceScope =
  'sync:read' | 'sync:write' | 'live:read' | 'live:write' | 'devices:manage' | 'backups:manage';
export type PushDeliveryState =
  | 'unsupported'
  | 'credential-missing'
  | 'registered'
  | 'provider-accepted'
  | 'delivered'
  | 'app-awakened'
  | 'sync-confirmed';

export interface FocusTagRef {
  tagId: string;
  name: string;
}

export interface FocusLedgerV2 {
  sessionId: string;
  startedAt: number;
  endedAt: number;
  status: 'finished' | 'aborted';
  activeElapsedMs: number;
  pausedElapsedMs: number;
  wallElapsedMs: number;
  originDeviceId: string;
  segments: DeviceSyncSessionBundle['segments'];
  pauses: DeviceSyncSessionBundle['pauses'];
}

export interface FocusMetadataV2 {
  sessionId: string;
  title: string | null;
  note: string | null;
  subject: string | null;
  tags: FocusTagRef[];
  taskAssociation: { taskId: string; source: 'local' | 'ticktick'; title: string | null } | null;
  updatedAt: number;
  updatedByDeviceId: string;
}

export interface FocusLedgerCorrectionV2 {
  correctionId: string;
  sessionId: string;
  baseLedgerRevision: number;
  before: FocusLedgerV2;
  after: FocusLedgerV2;
  reason: string;
  createdAt: number;
  createdByDeviceId: string;
}

/**
 * Opaque application state for 不做手机控. The authority can validate routing,
 * revision and integrity metadata but never receives a root key or plaintext.
 */
export interface EncryptedFocusGuardEnvelopeV1 {
  version: 1;
  algorithm: 'A256GCM';
  product: 'focus-guard';
  entityKind: 'rule' | 'state' | 'completion' | 'config';
  nonce: string;
  ciphertext: string;
  aadHash: string;
  aadBaseRevision: number;
  operation: 'put' | 'restore';
  createdAt: number;
}

export type SyncV2Payload =
  FocusLedgerV2 | FocusMetadataV2 | FocusLedgerCorrectionV2 | EncryptedFocusGuardEnvelopeV1;

export interface SyncV2Epoch {
  syncEpoch: string;
  cursorEpoch: string;
  accountGeneration: number;
}

export interface SyncV2Mutation {
  opId: string;
  entityType: SyncV2EntityType;
  entityId: string;
  kind: SyncV2MutationKind;
  baseRevision: number;
  baseFingerprint: string | null;
  payload: SyncV2Payload | null;
  deviceId: string;
  accountGeneration: number;
}

export interface SyncV2Ack {
  opId: string;
  entityType: SyncV2EntityType;
  entityId: string;
  status: SyncV2AckStatus;
  revision: number | null;
  fingerprint: string | null;
  errorCode: string | null;
}

export interface SyncV2Change {
  changeSeq: number;
  entityType: SyncV2EntityType;
  entityId: string;
  revision: number;
  fingerprint: string;
  deleted: boolean;
  payload: SyncV2Payload | null;
  sourceDeviceId: string;
}

export interface SyncV2Request extends SyncV2Epoch {
  protocolVersion: typeof SYNC_V2_PROTOCOL_VERSION;
  deviceId: string;
  cursor: string | null;
  mutations: SyncV2Mutation[];
  pullLimit: number;
}

export interface SyncV2Response extends SyncV2Epoch {
  protocolVersion: typeof SYNC_V2_PROTOCOL_VERSION;
  acks: SyncV2Ack[];
  changes: SyncV2Change[];
  nextCursor: string;
  hasMore: boolean;
  serverTime: number;
}

export interface SyncV2ResponsePage {
  changes: SyncV2Change[];
  nextCursor: string;
  hasMore: boolean;
}

/**
 * Selects a response page by both record count and the canonical adapter's
 * serialized byte budget. The cursor advances only through the last returned
 * change; a truncated byte page always advertises hasMore.
 */
export function paginateSyncV2Response(
  base: Omit<SyncV2Response, 'changes' | 'nextCursor' | 'hasMore'>,
  available: readonly SyncV2Change[],
  pullLimit: number,
  initialCursor: string,
  cursorFor: (change: SyncV2Change) => string,
  maxBytes = SYNC_V2_MAX_RESPONSE_BYTES,
): SyncV2ResponsePage {
  const maximumCount = Math.min(pullLimit, available.length);
  if (maximumCount === 0) {
    return { changes: [], nextCursor: initialCursor, hasMore: available.length > 0 };
  }
  let lower = 1;
  let upper = maximumCount;
  let acceptedCount = 0;
  // Serialized response size is monotonic as an ordered prefix grows. Binary
  // search avoids repeatedly stringifying the whole prefix for all 500 items.
  while (lower <= upper) {
    const candidateCount = Math.floor((lower + upper) / 2);
    const candidateChanges = available.slice(0, candidateCount);
    const candidateCursor = cursorFor(candidateChanges[candidateChanges.length - 1]);
    const trial: SyncV2Response = {
      ...base,
      changes: candidateChanges,
      nextCursor: candidateCursor,
      hasMore: available.length > candidateCount,
    };
    if (new TextEncoder().encode(JSON.stringify(trial)).byteLength <= maxBytes) {
      acceptedCount = candidateCount;
      lower = candidateCount + 1;
    } else {
      upper = candidateCount - 1;
    }
  }
  if (acceptedCount === 0) {
    throw new RangeError('one stored v2 change exceeds the canonical response byte budget');
  }
  const changes = available.slice(0, acceptedCount);
  return {
    changes,
    nextCursor: cursorFor(changes[changes.length - 1]),
    hasMore: available.length > changes.length,
  };
}

export interface SyncV2InventoryItem {
  entityId: string;
  entityType: SyncV2EntityType;
  fingerprint: string;
  localUpdatedAt: number;
  deleted: boolean;
}

export type SyncV2ManifestDisposition =
  'already-known' | 'need-upload' | 'need-download' | 'fingerprint-conflict';

export interface SyncV2ManifestItem extends SyncV2InventoryItem {
  disposition: SyncV2ManifestDisposition;
  confirmedRevision: number | null;
  confirmedFingerprint: string | null;
}

export interface SyncV2BootstrapInventoryRequest {
  protocolVersion: typeof SYNC_V2_PROTOCOL_VERSION;
  deviceId: string;
  bootstrapId: string;
  inventory: SyncV2InventoryItem[];
}

export interface SyncV2BootstrapInventoryResponse extends SyncV2Epoch {
  protocolVersion: typeof SYNC_V2_PROTOCOL_VERSION;
  bootstrapId: string;
  state: 'manifest-received';
  manifest: SyncV2ManifestItem[];
  cursor: string;
}

export interface SyncV2BootstrapEntitiesRequest {
  protocolVersion: typeof SYNC_V2_PROTOCOL_VERSION;
  deviceId: string;
  bootstrapId: string;
  entities: SyncV2Mutation[];
}

export interface SyncV2BootstrapEntitiesResponse extends SyncV2Epoch {
  protocolVersion: typeof SYNC_V2_PROTOCOL_VERSION;
  bootstrapId: string;
  state: 'base-established';
  acks: SyncV2Ack[];
  cursor: string;
}

export interface SyncV2OutboxItem extends SyncV2Mutation {
  state: SyncV2OutboxState;
  attemptCount: number;
  nextRetryAt: number;
  leaseId: string | null;
  leaseExpiresAt: number | null;
  claimedAt: number | null;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SyncV2Conflict<T = SyncV2Payload> {
  conflictId: string;
  entityType: SyncV2EntityType;
  entityId: string;
  base: T | null;
  local: T | null;
  remote: T | null;
  fields: string[];
  sourceDeviceIds: string[];
  status: 'open' | 'resolved';
  createdAt: number;
  resolvedAt: number | null;
  resolutionOpId: string | null;
}

export interface MetadataMergeResult {
  status: 'merged' | 'conflict';
  value: FocusMetadataV2 | null;
  conflictFields: string[];
  notePreview: string | null;
}

export function mergeFocusMetadata(
  base: FocusMetadataV2,
  local: FocusMetadataV2,
  remote: FocusMetadataV2,
): MetadataMergeResult {
  const conflicts: string[] = [];
  const merged = { ...base, tags: [...base.tags] };
  for (const field of ['title', 'subject', 'taskAssociation', 'note'] as const) {
    const outcome = mergeScalar(base[field], local[field], remote[field]);
    if (!outcome.ok) conflicts.push(field);
    else merged[field] = outcome.value as never;
  }
  const tags = mergeTags(base.tags, local.tags, remote.tags);
  if (!tags.ok) conflicts.push('tags');
  else merged.tags = tags.value;
  if (conflicts.length > 0) {
    return {
      status: 'conflict',
      value: null,
      conflictFields: conflicts,
      notePreview: conflicts.includes('note')
        ? makeNotePreview(base.note, local.note, remote.note)
        : null,
    };
  }
  merged.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  merged.updatedByDeviceId =
    local.updatedAt >= remote.updatedAt ? local.updatedByDeviceId : remote.updatedByDeviceId;
  return { status: 'merged', value: merged, conflictFields: [], notePreview: null };
}

export function mergeTags(
  base: readonly FocusTagRef[],
  local: readonly FocusTagRef[],
  remote: readonly FocusTagRef[],
): { ok: true; value: FocusTagRef[] } | { ok: false } {
  const baseMap = new Map(base.map((tag) => [tag.tagId, tag]));
  const localMap = new Map(local.map((tag) => [tag.tagId, tag]));
  const remoteMap = new Map(remote.map((tag) => [tag.tagId, tag]));
  const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
  const result = new Map<string, FocusTagRef>();
  for (const id of ids) {
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const r = remoteMap.get(id);
    if (b && !l && r && r.name !== b.name) return { ok: false };
    if (b && l && !r && l.name !== b.name) return { ok: false };
    const scalar = mergeScalar(b ?? null, l ?? null, r ?? null);
    if (!scalar.ok) return { ok: false };
    if (scalar.value) result.set(id, scalar.value);
  }
  const order = [...local, ...remote, ...base].map((tag) => tag.tagId);
  return {
    ok: true,
    value: [...new Set(order)].flatMap((id) => (result.has(id) ? [result.get(id)!] : [])),
  };
}

export function claimOutboxItems(
  items: readonly SyncV2OutboxItem[],
  now: number,
  leaseId: string,
  limit: number,
  leaseMs = SYNC_V2_DEFAULT_LEASE_MS,
): SyncV2OutboxItem[] {
  return items
    .filter(
      (item) =>
        (item.state === 'pending' ||
          item.state === 'retry' ||
          (item.state === 'uploading' && (item.leaseExpiresAt ?? 0) <= now)) &&
        item.nextRetryAt <= now,
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, Math.max(0, limit))
    .map((item) => ({
      ...item,
      state: 'uploading',
      leaseId,
      claimedAt: now,
      leaseExpiresAt: now + leaseMs,
      updatedAt: now,
    }));
}

export function parseDeviceToken(token: string): {
  accountPublicId: string;
  devicePublicId: string;
  randomSecret: string;
} | null {
  const match = /^fl2_([A-Za-z0-9-]{6,80})_([A-Za-z0-9-]{6,80})_([A-Za-z0-9_-]{32,160})$/.exec(
    token,
  );
  return match
    ? { accountPublicId: match[1], devicePublicId: match[2], randomSecret: match[3] }
    : null;
}

export function isEncryptedFocusGuardEnvelopeV1(
  value: unknown,
  entityType?: SyncV2EntityType,
): value is EncryptedFocusGuardEnvelopeV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const expectedKind =
    entityType === 'focus_guard_rule_v1'
      ? 'rule'
      : entityType === 'focus_guard_state_v1'
        ? 'state'
        : entityType === 'focus_guard_completion_v1'
          ? 'completion'
          : entityType === 'focus_guard_config_v1'
            ? 'config'
            : null;
  return (
    record.version === 1 &&
    record.algorithm === 'A256GCM' &&
    record.product === 'focus-guard' &&
    typeof record.entityKind === 'string' &&
    (expectedKind === null || record.entityKind === expectedKind) &&
    typeof record.nonce === 'string' &&
    /^[A-Za-z0-9_-]{16,64}$/.test(record.nonce) &&
    typeof record.ciphertext === 'string' &&
    /^[A-Za-z0-9_-]{16,700000}$/.test(record.ciphertext) &&
    typeof record.aadHash === 'string' &&
    /^[a-f0-9]{64}$/i.test(record.aadHash) &&
    Number.isSafeInteger(record.aadBaseRevision) &&
    Number(record.aadBaseRevision) >= 0 &&
    (record.operation === 'put' || record.operation === 'restore') &&
    typeof record.createdAt === 'number' &&
    Number.isSafeInteger(record.createdAt) &&
    record.createdAt >= 0
  );
}

export function shouldForceBootstrap(
  local: SyncV2Epoch,
  remote: SyncV2Epoch,
  deviceLastSeenAt: number,
  now: number,
): boolean {
  return (
    local.syncEpoch !== remote.syncEpoch ||
    local.cursorEpoch !== remote.cursorEpoch ||
    local.accountGeneration !== remote.accountGeneration ||
    now - deviceLastSeenAt >= 90 * 24 * 60 * 60 * 1000
  );
}

export function canPhysicallyPurge(input: {
  now: number;
  purgeAfter: number;
  deleteChangeSeq: number;
  activeDeviceWatermarks: readonly number[];
  hasConflict: boolean;
  backupAllowsPurge: boolean;
}): boolean {
  return (
    input.now >= input.purgeAfter &&
    !input.hasConflict &&
    input.backupAllowsPurge &&
    input.activeDeviceWatermarks.every((watermark) => watermark > input.deleteChangeSeq)
  );
}

export function splitBundleForSyncV2(
  bundle: DeviceSyncSessionBundle,
  originDeviceId: string,
): { ledger: FocusLedgerV2; metadata: FocusMetadataV2 } {
  const session = bundle.session;
  if (session.endedAt === null || (session.status !== 'finished' && session.status !== 'aborted'))
    throw new Error('Sync v2 only accepts completed focus ledgers');
  return {
    ledger: {
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      status: session.status,
      activeElapsedMs: session.activeElapsedMs,
      pausedElapsedMs: session.pauseElapsedMs,
      wallElapsedMs: session.wallElapsedMs,
      originDeviceId,
      segments: bundle.segments,
      pauses: bundle.pauses,
    },
    metadata: {
      sessionId: session.id,
      title: session.title,
      note: session.note,
      subject: bundle.segments.find((segment) => segment.tomatodoSubject)?.tomatodoSubject ?? null,
      tags: [],
      taskAssociation:
        session.defaultTaskId && session.defaultTaskSource
          ? {
              taskId: session.defaultTaskId,
              source: session.defaultTaskSource,
              title: session.defaultTaskTitle ?? null,
            }
          : null,
      updatedAt: session.updatedAt,
      updatedByDeviceId: originDeviceId,
    },
  };
}

function mergeScalar<T>(base: T, local: T, remote: T): { ok: true; value: T } | { ok: false } {
  if (same(local, remote)) return { ok: true, value: local };
  if (same(local, base)) return { ok: true, value: remote };
  if (same(remote, base)) return { ok: true, value: local };
  return { ok: false };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function makeNotePreview(base: string | null, local: string | null, remote: string | null): string {
  return `BASE\n${base ?? ''}\nLOCAL\n${local ?? ''}\nREMOTE\n${remote ?? ''}`;
}
