import { randomUUID } from 'node:crypto';

import type {
  SyncV2Ack,
  SyncV2Change,
  SyncV2Epoch,
  SyncV2Mutation,
  SyncV2OutboxItem,
  SyncV2Payload,
} from '@shared/sync/v2Protocol';
import { SYNC_V2_DEFAULT_LEASE_MS } from '@shared/sync/v2Protocol';
import { getDb, getMeta, setMeta } from '../db/index.js';

interface OutboxRow {
  connection_scope: string;
  op_id: string;
  entity_type: SyncV2Mutation['entityType'];
  entity_id: string;
  kind: SyncV2Mutation['kind'];
  base_revision: number;
  base_fingerprint: string | null;
  payload: string | null;
  device_id: string;
  account_generation: number;
  state: SyncV2OutboxItem['state'];
  attempt_count: number;
  next_retry_at: number;
  lease_id: string | null;
  lease_expires_at: number | null;
  claimed_at: number | null;
  error_code: string | null;
  created_at: number;
  updated_at: number;
}

export interface DesktopV2EntityState extends SyncV2Epoch {
  entityType: SyncV2Mutation['entityType'];
  entityId: string;
  confirmedRevision: number;
  confirmedFingerprint: string;
  baseSnapshot: SyncV2Payload | null;
  deleted: boolean;
  changeSeq: number | null;
  sourceDeviceId: string | null;
  updatedAt: number;
}

export interface DesktopV2Status {
  pending: number;
  conflicts: number;
  rejected: number;
}

export function migrateLegacyV2State(connectionScope: string, now = Date.now()): void {
  const marker = `syncV2.desktop.legacyMigrated.${connectionScope}`;
  if (getMeta(marker) === '1') return;
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO sync_v2_outbox (
         connection_scope, op_id, entity_type, entity_id, kind, base_revision,
         base_fingerprint, payload, device_id, account_generation, state,
         attempt_count, next_retry_at, lease_id, lease_expires_at, claimed_at,
         error_code, created_at, updated_at
       )
       SELECT ?, op_id, entity_type, entity_id, kind, base_revision,
         base_fingerprint, payload, device_id, account_generation,
         CASE WHEN state = 'uploading' THEN 'retry' ELSE state END,
         attempt_count, next_retry_at, NULL, NULL, NULL,
         error_code, created_at, ?
       FROM sync_outbox`,
    ).run(connectionScope, now);
    db.prepare(
      `INSERT OR IGNORE INTO sync_v2_entity_state (
         connection_scope, entity_type, entity_id, confirmed_revision,
         confirmed_fingerprint, base_snapshot, deleted, change_seq, source_device_id,
         sync_epoch, cursor_epoch, account_generation, updated_at
       )
       SELECT ?, entity_type, entity_id, confirmed_revision, confirmed_fingerprint,
         base_snapshot, CASE WHEN base_snapshot IS NULL THEN 1 ELSE 0 END,
         NULL, NULL, sync_epoch, cursor_epoch, account_generation, updated_at
       FROM sync_entity_state`,
    ).run(connectionScope);
    db.prepare(
      `INSERT OR IGNORE INTO sync_v2_conflicts (
         connection_scope, conflict_id, entity_type, entity_id, base_payload,
         local_payload, remote_payload, conflict_fields, source_device_ids,
         status, resolution_op_id, created_at, resolved_at
       )
       SELECT ?, conflict_id, entity_type, entity_id, base_payload, local_payload,
         remote_payload, conflict_fields, source_device_ids, status,
         resolution_op_id, created_at, resolved_at FROM sync_conflicts`,
    ).run(connectionScope);
    db.prepare(
      `INSERT OR IGNORE INTO sync_v2_operation_history (
         connection_scope, op_id, entity_type, entity_id, status, revision,
         error_code, completed_at
       )
       SELECT ?, op_id, entity_type, entity_id, status, revision, error_code,
         completed_at FROM sync_operation_history`,
    ).run(connectionScope);
    setMeta(marker, '1');
  })();
}

export function enqueueV2Mutation(
  connectionScope: string,
  mutation: SyncV2Mutation,
  now = Date.now(),
): void {
  getDb()
    .prepare(
      `INSERT INTO sync_v2_outbox (
         connection_scope, op_id, entity_type, entity_id, kind, base_revision,
         base_fingerprint, payload, device_id, account_generation, state,
         attempt_count, next_retry_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?)
       ON CONFLICT(connection_scope, op_id) DO NOTHING`,
    )
    .run(
      connectionScope,
      mutation.opId,
      mutation.entityType,
      mutation.entityId,
      mutation.kind,
      mutation.baseRevision,
      mutation.baseFingerprint,
      mutation.payload === null ? null : JSON.stringify(mutation.payload),
      mutation.deviceId,
      mutation.accountGeneration,
      now,
      now,
    );
}

export function claimV2Outbox(
  connectionScope: string,
  limit: number,
  now = Date.now(),
  leaseMs = SYNC_V2_DEFAULT_LEASE_MS,
): { leaseId: string; items: SyncV2OutboxItem[] } {
  const db = getDb();
  const leaseId = randomUUID();
  return db.transaction(() => {
    db.prepare(
      `UPDATE sync_v2_outbox SET state = 'retry', lease_id = NULL,
         lease_expires_at = NULL, claimed_at = NULL, updated_at = ?
       WHERE connection_scope = ? AND state = 'uploading' AND lease_expires_at <= ?`,
    ).run(now, connectionScope, now);
    const rows = db
      .prepare(
        `SELECT * FROM sync_v2_outbox
         WHERE connection_scope = ? AND state IN ('pending', 'retry')
           AND next_retry_at <= ?
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(connectionScope, now, Math.max(0, limit)) as OutboxRow[];
    const update = db.prepare(
      `UPDATE sync_v2_outbox SET state = 'uploading', lease_id = ?,
       lease_expires_at = ?, claimed_at = ?, updated_at = ?
       WHERE connection_scope = ? AND op_id = ? AND state IN ('pending', 'retry')`,
    );
    return {
      leaseId,
      items: rows.flatMap((row) =>
        update.run(leaseId, now + leaseMs, now, now, connectionScope, row.op_id).changes === 1
          ? [
              rowToItem({
                ...row,
                state: 'uploading',
                lease_id: leaseId,
                lease_expires_at: now + leaseMs,
                claimed_at: now,
                updated_at: now,
              }),
            ]
          : [],
      ),
    };
  })();
}

export function settleV2Ack(
  connectionScope: string,
  leaseId: string,
  ack: SyncV2Ack,
  payload: SyncV2Payload | null,
  epoch: SyncV2Epoch,
  now = Date.now(),
): boolean {
  const db = getDb();
  const item = db
    .prepare(
      `SELECT * FROM sync_v2_outbox
       WHERE connection_scope = ? AND op_id = ? AND lease_id = ?`,
    )
    .get(connectionScope, ack.opId, leaseId) as OutboxRow | undefined;
  if (!item) return false;
  if (ack.status === 'applied' || ack.status === 'duplicate') {
    if (ack.revision === null || ack.fingerprint === null) return false;
    writeV2EntityState(connectionScope, {
      entityType: ack.entityType,
      entityId: ack.entityId,
      revision: ack.revision,
      fingerprint: ack.fingerprint,
      payload,
      deleted: payload === null,
      changeSeq: null,
      sourceDeviceId: item.device_id,
      epoch,
      now,
    });
    db.prepare(
      `DELETE FROM sync_v2_outbox
       WHERE connection_scope = ? AND op_id = ? AND lease_id = ?`,
    ).run(connectionScope, ack.opId, leaseId);
  } else {
    db.prepare(
      `UPDATE sync_v2_outbox SET state = ?, error_code = ?, lease_id = NULL,
       lease_expires_at = NULL, claimed_at = NULL, updated_at = ?
       WHERE connection_scope = ? AND op_id = ? AND lease_id = ?`,
    ).run(ack.status, ack.errorCode, now, connectionScope, ack.opId, leaseId);
    if (ack.status === 'conflict') {
      writeV2Conflict(connectionScope, {
        conflictId: `ack-${ack.opId}`,
        entityType: ack.entityType,
        entityId: ack.entityId,
        base:
          readV2EntityState(connectionScope, ack.entityType, ack.entityId)?.baseSnapshot ?? null,
        local: payload,
        remote: null,
        fields: ['revision'],
        sourceDeviceIds: [item.device_id],
        now,
      });
    }
  }
  db.prepare(
    `INSERT OR REPLACE INTO sync_v2_operation_history (
       connection_scope, op_id, entity_type, entity_id, status, revision,
       error_code, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    connectionScope,
    ack.opId,
    ack.entityType,
    ack.entityId,
    ack.status,
    ack.revision,
    ack.errorCode,
    now,
  );
  return true;
}

export function retryV2Lease(
  connectionScope: string,
  leaseId: string,
  errorCode: string,
  nextRetryAt: number,
  now = Date.now(),
): number {
  return getDb()
    .prepare(
      `UPDATE sync_v2_outbox SET state = 'retry', attempt_count = attempt_count + 1,
       next_retry_at = ?, error_code = ?, lease_id = NULL, lease_expires_at = NULL,
       claimed_at = NULL, updated_at = ?
       WHERE connection_scope = ? AND lease_id = ? AND state = 'uploading'`,
    )
    .run(nextRetryAt, errorCode.slice(0, 240), now, connectionScope, leaseId).changes;
}

export function readV2EntityState(
  connectionScope: string,
  entityType: SyncV2Mutation['entityType'],
  entityId: string,
): DesktopV2EntityState | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM sync_v2_entity_state
       WHERE connection_scope = ? AND entity_type = ? AND entity_id = ?`,
    )
    .get(connectionScope, entityType, entityId) as
    | {
        entity_type: SyncV2Mutation['entityType'];
        entity_id: string;
        confirmed_revision: number;
        confirmed_fingerprint: string;
        base_snapshot: string | null;
        deleted: number;
        change_seq: number | null;
        source_device_id: string | null;
        sync_epoch: string;
        cursor_epoch: string;
        account_generation: number;
        updated_at: number;
      }
    | undefined;
  return row ? entityRow(row) : null;
}

export function listV2EntityStates(
  connectionScope: string,
  entityId?: string,
): DesktopV2EntityState[] {
  const rows = (
    entityId
      ? getDb()
          .prepare(
            `SELECT * FROM sync_v2_entity_state
           WHERE connection_scope = ? AND entity_id = ?`,
          )
          .all(connectionScope, entityId)
      : getDb()
          .prepare('SELECT * FROM sync_v2_entity_state WHERE connection_scope = ?')
          .all(connectionScope)
  ) as Array<Parameters<typeof entityRow>[0]>;
  return rows.map(entityRow);
}

export function writeV2EntityState(
  connectionScope: string,
  input: {
    entityType: SyncV2Mutation['entityType'];
    entityId: string;
    revision: number;
    fingerprint: string;
    payload: SyncV2Payload | null;
    deleted: boolean;
    changeSeq: number | null;
    sourceDeviceId: string | null;
    epoch: SyncV2Epoch;
    now?: number;
  },
): void {
  const now = input.now ?? Date.now();
  getDb()
    .prepare(
      `INSERT INTO sync_v2_entity_state(
       connection_scope, entity_type, entity_id, confirmed_revision,
       confirmed_fingerprint, base_snapshot, deleted, change_seq, source_device_id,
       sync_epoch, cursor_epoch, account_generation, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(connection_scope, entity_type, entity_id) DO UPDATE SET
       confirmed_revision=excluded.confirmed_revision,
       confirmed_fingerprint=excluded.confirmed_fingerprint,
       base_snapshot=excluded.base_snapshot, deleted=excluded.deleted,
       change_seq=excluded.change_seq, source_device_id=excluded.source_device_id,
       sync_epoch=excluded.sync_epoch, cursor_epoch=excluded.cursor_epoch,
       account_generation=excluded.account_generation, updated_at=excluded.updated_at`,
    )
    .run(
      connectionScope,
      input.entityType,
      input.entityId,
      input.revision,
      input.fingerprint,
      input.payload === null ? null : JSON.stringify(input.payload),
      input.deleted ? 1 : 0,
      input.changeSeq,
      input.sourceDeviceId,
      input.epoch.syncEpoch,
      input.epoch.cursorEpoch,
      input.epoch.accountGeneration,
      now,
    );
}

export function hasPendingV2Mutation(
  connectionScope: string,
  entityType: SyncV2Mutation['entityType'],
  entityId: string,
): SyncV2OutboxItem | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM sync_v2_outbox WHERE connection_scope = ?
       AND entity_type = ? AND entity_id = ?
       AND state IN ('pending', 'uploading', 'retry', 'conflict', 'rejected')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(connectionScope, entityType, entityId) as OutboxRow | undefined;
  return row ? rowToItem(row) : null;
}

export function hasOpenV2Conflict(
  connectionScope: string,
  entityType: SyncV2Mutation['entityType'],
  entityId: string,
): boolean {
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1 FROM sync_v2_conflicts WHERE connection_scope = ?
         AND entity_type = ? AND entity_id = ? AND status = 'open' LIMIT 1`,
      )
      .get(connectionScope, entityType, entityId),
  );
}

export function requeueStaleGenerationV2Outbox(
  connectionScope: string,
  accountGeneration: number,
  now = Date.now(),
): number {
  const db = getDb();
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT * FROM sync_v2_outbox WHERE connection_scope = ?
         AND account_generation <> ? AND state IN ('pending', 'uploading', 'retry')`,
      )
      .all(connectionScope, accountGeneration) as OutboxRow[];
    const history = db.prepare(
      `INSERT OR REPLACE INTO sync_v2_operation_history (
       connection_scope, op_id, entity_type, entity_id, status, revision,
       error_code, completed_at) VALUES (?, ?, ?, ?, 'generation-requeued', NULL,
       'account_generation_changed', ?)`,
    );
    for (const row of rows)
      history.run(connectionScope, row.op_id, row.entity_type, row.entity_id, now);
    if (rows.length > 0) {
      db.prepare(
        `DELETE FROM sync_v2_outbox WHERE connection_scope = ?
         AND account_generation <> ? AND state IN ('pending', 'uploading', 'retry')`,
      ).run(connectionScope, accountGeneration);
    }
    return rows.length;
  })();
}

export function writeRemoteV2Conflict(
  connectionScope: string,
  change: SyncV2Change,
  localPayload: SyncV2Payload | null,
  basePayload: SyncV2Payload | null,
  now = Date.now(),
): void {
  writeV2Conflict(connectionScope, {
    conflictId: `remote-${change.changeSeq}-${change.entityType}-${change.entityId}`,
    entityType: change.entityType,
    entityId: change.entityId,
    base: basePayload,
    local: localPayload,
    remote: change.payload,
    fields: [change.deleted ? 'deleted' : 'payload'],
    sourceDeviceIds: [change.sourceDeviceId],
    now,
  });
}

export function recordRemoteV2History(
  connectionScope: string,
  change: SyncV2Change,
  now = Date.now(),
): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO sync_v2_operation_history (
       connection_scope, op_id, entity_type, entity_id, status, revision,
       error_code, completed_at) VALUES (?, ?, ?, ?, 'remote', ?, NULL, ?)`,
    )
    .run(
      connectionScope,
      `remote-${change.changeSeq}`,
      change.entityType,
      change.entityId,
      change.revision,
      now,
    );
}

export function readDesktopV2Status(connectionScope: string): DesktopV2Status {
  const db = getDb();
  const states = db
    .prepare(
      `SELECT state, COUNT(*) AS count FROM sync_v2_outbox
       WHERE connection_scope = ? GROUP BY state`,
    )
    .all(connectionScope) as Array<{ state: string; count: number }>;
  const byState = new Map(states.map((row) => [row.state, row.count]));
  const conflicts = db
    .prepare(
      `SELECT COUNT(*) AS count FROM sync_v2_conflicts
       WHERE connection_scope = ? AND status = 'open'`,
    )
    .get(connectionScope) as { count: number };
  return {
    pending:
      (byState.get('pending') ?? 0) + (byState.get('uploading') ?? 0) + (byState.get('retry') ?? 0),
    conflicts: conflicts.count + (byState.get('conflict') ?? 0),
    rejected: byState.get('rejected') ?? 0,
  };
}

export function pruneV2OperationHistory(connectionScope: string, now = Date.now()): number {
  return getDb()
    .prepare(
      `DELETE FROM sync_v2_operation_history
       WHERE connection_scope = ? AND completed_at < ?`,
    )
    .run(connectionScope, now - 30 * 24 * 60 * 60 * 1000).changes;
}

function writeV2Conflict(
  connectionScope: string,
  input: {
    conflictId: string;
    entityType: SyncV2Mutation['entityType'];
    entityId: string;
    base: SyncV2Payload | null;
    local: SyncV2Payload | null;
    remote: SyncV2Payload | null;
    fields: string[];
    sourceDeviceIds: string[];
    now: number;
  },
): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO sync_v2_conflicts (
       connection_scope, conflict_id, entity_type, entity_id, base_payload,
       local_payload, remote_payload, conflict_fields, source_device_ids,
       status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(
      connectionScope,
      input.conflictId,
      input.entityType,
      input.entityId,
      input.base === null ? null : JSON.stringify(input.base),
      input.local === null ? null : JSON.stringify(input.local),
      input.remote === null ? null : JSON.stringify(input.remote),
      JSON.stringify(input.fields),
      JSON.stringify(input.sourceDeviceIds),
      input.now,
    );
}

function entityRow(row: {
  entity_type: SyncV2Mutation['entityType'];
  entity_id: string;
  confirmed_revision: number;
  confirmed_fingerprint: string;
  base_snapshot: string | null;
  deleted: number;
  change_seq: number | null;
  source_device_id: string | null;
  sync_epoch: string;
  cursor_epoch: string;
  account_generation: number;
  updated_at: number;
}): DesktopV2EntityState {
  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    confirmedRevision: row.confirmed_revision,
    confirmedFingerprint: row.confirmed_fingerprint,
    baseSnapshot: row.base_snapshot ? (JSON.parse(row.base_snapshot) as SyncV2Payload) : null,
    deleted: Boolean(row.deleted),
    changeSeq: row.change_seq,
    sourceDeviceId: row.source_device_id,
    syncEpoch: row.sync_epoch,
    cursorEpoch: row.cursor_epoch,
    accountGeneration: row.account_generation,
    updatedAt: row.updated_at,
  };
}

function rowToItem(row: OutboxRow): SyncV2OutboxItem {
  return {
    opId: row.op_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    kind: row.kind,
    baseRevision: row.base_revision,
    baseFingerprint: row.base_fingerprint,
    payload: row.payload ? (JSON.parse(row.payload) as SyncV2Payload) : null,
    deviceId: row.device_id,
    accountGeneration: row.account_generation,
    state: row.state,
    attemptCount: row.attempt_count,
    nextRetryAt: row.next_retry_at,
    leaseId: row.lease_id,
    leaseExpiresAt: row.lease_expires_at,
    claimedAt: row.claimed_at,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
