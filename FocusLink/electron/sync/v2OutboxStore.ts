import { randomUUID } from 'node:crypto';

import type {
  SyncV2Ack,
  SyncV2Epoch,
  SyncV2Mutation,
  SyncV2OutboxItem,
  SyncV2Payload,
} from '@shared/sync/v2Protocol';
import { SYNC_V2_DEFAULT_LEASE_MS } from '@shared/sync/v2Protocol';
import { getDb } from '../db/index.js';

interface OutboxRow {
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

export function enqueueV2Mutation(mutation: SyncV2Mutation, now = Date.now()): void {
  getDb()
    .prepare(
      `INSERT INTO sync_outbox (
         op_id, entity_type, entity_id, kind, base_revision, base_fingerprint, payload,
         device_id, account_generation, state, attempt_count, next_retry_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?)
       ON CONFLICT(op_id) DO NOTHING`,
    )
    .run(
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
  limit: number,
  now = Date.now(),
  leaseMs = SYNC_V2_DEFAULT_LEASE_MS,
): { leaseId: string; items: SyncV2OutboxItem[] } {
  const db = getDb();
  const leaseId = randomUUID();
  const claim = db.transaction(() => {
    db.prepare(
      `UPDATE sync_outbox SET state = 'retry', lease_id = NULL, lease_expires_at = NULL,
         claimed_at = NULL, updated_at = ?
       WHERE state = 'uploading' AND lease_expires_at <= ?`,
    ).run(now, now);
    const rows = db
      .prepare(
        `SELECT * FROM sync_outbox
         WHERE state IN ('pending', 'retry') AND next_retry_at <= ?
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(now, Math.max(0, limit)) as OutboxRow[];
    const update = db.prepare(
      `UPDATE sync_outbox SET state = 'uploading', lease_id = ?, lease_expires_at = ?,
       claimed_at = ?, updated_at = ? WHERE op_id = ? AND state IN ('pending', 'retry')`,
    );
    return rows.flatMap((row) =>
      update.run(leaseId, now + leaseMs, now, now, row.op_id).changes === 1
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
    );
  });
  return { leaseId, items: claim() };
}

export function settleV2Ack(
  leaseId: string,
  ack: SyncV2Ack,
  payload: SyncV2Payload | null,
  epoch: SyncV2Epoch,
  now = Date.now(),
): boolean {
  const db = getDb();
  return db.transaction(() => {
    const owned = db
      .prepare('SELECT op_id FROM sync_outbox WHERE op_id = ? AND lease_id = ?')
      .get(ack.opId, leaseId);
    if (!owned) return false;
    if (ack.status === 'applied' || ack.status === 'duplicate') {
      if (ack.revision === null || ack.fingerprint === null) return false;
      db.prepare(
        `INSERT INTO sync_entity_state (
           entity_type, entity_id, confirmed_revision, confirmed_fingerprint, base_snapshot,
           sync_epoch, cursor_epoch, account_generation, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           confirmed_revision=excluded.confirmed_revision,
           confirmed_fingerprint=excluded.confirmed_fingerprint,
           base_snapshot=excluded.base_snapshot, sync_epoch=excluded.sync_epoch,
           cursor_epoch=excluded.cursor_epoch, account_generation=excluded.account_generation,
           updated_at=excluded.updated_at`,
      ).run(
        ack.entityType,
        ack.entityId,
        ack.revision,
        ack.fingerprint,
        payload === null ? null : JSON.stringify(payload),
        epoch.syncEpoch,
        epoch.cursorEpoch,
        epoch.accountGeneration,
        now,
      );
      db.prepare(
        'INSERT OR REPLACE INTO sync_operation_history(op_id, entity_type, entity_id, status, revision, error_code, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(ack.opId, ack.entityType, ack.entityId, ack.status, ack.revision, null, now);
      db.prepare('DELETE FROM sync_outbox WHERE op_id = ? AND lease_id = ?').run(ack.opId, leaseId);
      return true;
    }
    db.prepare(
      `UPDATE sync_outbox SET state = ?, error_code = ?, lease_id = NULL,
       lease_expires_at = NULL, claimed_at = NULL, updated_at = ? WHERE op_id = ? AND lease_id = ?`,
    ).run(ack.status, ack.errorCode, now, ack.opId, leaseId);
    return true;
  })();
}

export function retryV2Lease(
  leaseId: string,
  errorCode: string,
  nextRetryAt: number,
  now = Date.now(),
): number {
  return getDb()
    .prepare(
      `UPDATE sync_outbox SET state = 'retry', attempt_count = attempt_count + 1,
       next_retry_at = ?, error_code = ?, lease_id = NULL, lease_expires_at = NULL,
       claimed_at = NULL, updated_at = ? WHERE lease_id = ? AND state = 'uploading'`,
    )
    .run(nextRetryAt, errorCode, now, leaseId).changes;
}

export function pruneV2OperationHistory(now = Date.now()): number {
  return getDb()
    .prepare('DELETE FROM sync_operation_history WHERE completed_at < ?')
    .run(now - 30 * 24 * 60 * 60 * 1000).changes;
}

export function writeV2EntityState(input: {
  entityType: SyncV2Mutation['entityType'];
  entityId: string;
  revision: number;
  fingerprint: string;
  payload: SyncV2Payload | null;
  epoch: SyncV2Epoch;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  getDb()
    .prepare(
      `INSERT INTO sync_entity_state(entity_type, entity_id, confirmed_revision,
       confirmed_fingerprint, base_snapshot, sync_epoch, cursor_epoch, account_generation, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
       confirmed_revision=excluded.confirmed_revision,
       confirmed_fingerprint=excluded.confirmed_fingerprint, base_snapshot=excluded.base_snapshot,
       sync_epoch=excluded.sync_epoch, cursor_epoch=excluded.cursor_epoch,
       account_generation=excluded.account_generation, updated_at=excluded.updated_at`,
    )
    .run(
      input.entityType,
      input.entityId,
      input.revision,
      input.fingerprint,
      input.payload === null ? null : JSON.stringify(input.payload),
      input.epoch.syncEpoch,
      input.epoch.cursorEpoch,
      input.epoch.accountGeneration,
      now,
    );
}

export function confirmMatchingRemoteV2Entity(input: {
  entityType: SyncV2Mutation['entityType'];
  entityId: string;
  revision: number;
  fingerprint: string;
  payload: SyncV2Payload;
  epoch: SyncV2Epoch;
  now?: number;
}): number {
  const db = getDb();
  return db.transaction(() => {
    writeV2EntityState(input);
    return db
      .prepare(
        `DELETE FROM sync_outbox WHERE entity_type = ? AND entity_id = ?
         AND state = 'conflict' AND error_code = 'revision_conflict'`,
      )
      .run(input.entityType, input.entityId).changes;
  })();
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
