import crypto from 'node:crypto';

import { getDb } from '../db/index.js';

export type RemoteWritebackProvider = 'dida' | 'tomatodo';
export type RemoteWritebackState = 'pending' | 'claimed' | 'completed';

export interface RemoteWritebackItem {
  connectionScope: string;
  sessionId: string;
  provider: RemoteWritebackProvider;
  state: RemoteWritebackState;
  attemptCount: number;
  nextRetryAt: number;
  leaseId: string | null;
  leaseExpiresAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface RemoteWritebackRow {
  connection_scope: string;
  session_id: string;
  provider: RemoteWritebackProvider;
  state: RemoteWritebackState;
  attempt_count: number;
  next_retry_at: number;
  lease_id: string | null;
  lease_expires_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface RemoteWritebackClaim {
  leaseId: string;
  item: RemoteWritebackItem | null;
}

const DEFAULT_LEASE_MS = 60_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60_000;

function isSQLiteBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : '';
  return (
    (typeof code === 'string' && code.startsWith('SQLITE_BUSY')) ||
    /database is locked|database is busy/i.test(message)
  );
}

function rowToItem(row: RemoteWritebackRow): RemoteWritebackItem {
  return {
    connectionScope: row.connection_scope,
    sessionId: row.session_id,
    provider: row.provider,
    state: row.state,
    attemptCount: row.attempt_count,
    nextRetryAt: row.next_retry_at,
    leaseId: row.lease_id,
    leaseExpiresAt: row.lease_expires_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

/** Must be called inside the projection transaction that inserted the remote session. */
export function enqueueRemoteWritebackIntents(
  connectionScope: string,
  sessionId: string,
  now = Date.now(),
): void {
  const statement = getDb().prepare(
    `INSERT INTO remote_writeback_queue
      (connection_scope, session_id, provider, state, attempt_count, next_retry_at, lease_id,
       lease_expires_at, last_error, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, 'pending', 0, 0, NULL, NULL, NULL, ?, ?, NULL)
     ON CONFLICT(connection_scope, session_id, provider) DO NOTHING`,
  );
  statement.run(connectionScope, sessionId, 'dida', now, now);
  statement.run(connectionScope, sessionId, 'tomatodo', now, now);
}

/** True only when both independent provider intents already exist for this imported session. */
export function hasRemoteWritebackIntentPair(connectionScope: string, sessionId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT provider) AS provider_count
       FROM remote_writeback_queue
       WHERE connection_scope = ? AND session_id = ?
         AND provider IN ('dida', 'tomatodo')`,
    )
    .get(connectionScope, sessionId) as { provider_count: number } | undefined;
  return row?.provider_count === 2;
}

/**
 * Claims exactly one provider delivery with a compare-and-set UPDATE.  Expired leases are eligible
 * in the same statement, so a crash cannot strand work permanently.
 */
export function claimNextRemoteWriteback(
  connectionScope: string,
  now = Date.now(),
  leaseMs = DEFAULT_LEASE_MS,
): RemoteWritebackClaim {
  const leaseId = crypto.randomUUID();
  const database = getDb();
  let claim: RemoteWritebackRow | null | undefined;
  try {
    claim = database.transaction(() => {
      const candidate = database
        .prepare(
          `SELECT connection_scope, session_id, provider
           FROM remote_writeback_queue
           WHERE connection_scope = ?
             AND ((state = 'pending' AND next_retry_at <= ?)
               OR (state = 'claimed' AND lease_expires_at <= ?))
           ORDER BY next_retry_at ASC, created_at ASC, provider ASC
           LIMIT 1`,
        )
        .get(connectionScope, now, now) as
        | {
            connection_scope: string;
            session_id: string;
            provider: RemoteWritebackProvider;
          }
        | undefined;
      if (!candidate) return null;
      const updated = database
        .prepare(
          `UPDATE remote_writeback_queue
           SET state = 'claimed', lease_id = ?, lease_expires_at = ?, updated_at = ?
           WHERE connection_scope = ? AND session_id = ? AND provider = ?
             AND ((state = 'pending' AND next_retry_at <= ?)
               OR (state = 'claimed' AND lease_expires_at <= ?))`,
        )
        .run(
          leaseId,
          now + Math.max(1, leaseMs),
          now,
          candidate.connection_scope,
          candidate.session_id,
          candidate.provider,
          now,
          now,
        );
      if (updated.changes !== 1) return null;
      return database
        .prepare(
          `SELECT * FROM remote_writeback_queue
           WHERE connection_scope = ? AND session_id = ? AND provider = ? AND lease_id = ?`,
        )
        .get(candidate.connection_scope, candidate.session_id, candidate.provider, leaseId) as
        RemoteWritebackRow | undefined;
    })() as RemoteWritebackRow | null | undefined;
  } catch (error) {
    // Another connection may temporarily hold SQLite's writer lock. Treat it as a no-claim; the
    // durable next_retry_at wake-up will try again instead of failing the whole Sync v2 pass.
    if (isSQLiteBusy(error)) return { leaseId, item: null };
    throw error;
  }
  return { leaseId, item: claim ? rowToItem(claim) : null };
}

export function completeRemoteWriteback(
  item: Pick<RemoteWritebackItem, 'connectionScope' | 'sessionId' | 'provider'>,
  leaseId: string,
  now = Date.now(),
): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE remote_writeback_queue
         SET state = 'completed', lease_id = NULL, lease_expires_at = NULL,
             last_error = NULL, completed_at = ?, updated_at = ?
         WHERE connection_scope = ? AND session_id = ? AND provider = ?
           AND state = 'claimed' AND lease_id = ?`,
      )
      .run(now, now, item.connectionScope, item.sessionId, item.provider, leaseId).changes === 1
  );
}

/** Keep a provider operation owned while a slow dida/TomaToDo call is in progress. */
export function renewRemoteWritebackLease(
  item: Pick<RemoteWritebackItem, 'connectionScope' | 'sessionId' | 'provider'>,
  leaseId: string,
  now = Date.now(),
  leaseMs = DEFAULT_LEASE_MS,
): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE remote_writeback_queue
         SET lease_expires_at = ?, updated_at = ?
         WHERE connection_scope = ? AND session_id = ? AND provider = ?
           AND state = 'claimed' AND lease_id = ?`,
      )
      .run(
        now + Math.max(1, leaseMs),
        now,
        item.connectionScope,
        item.sessionId,
        item.provider,
        leaseId,
      ).changes === 1
  );
}

export function retryRemoteWriteback(
  item: Pick<RemoteWritebackItem, 'connectionScope' | 'sessionId' | 'provider' | 'attemptCount'>,
  leaseId: string,
  error: string,
  now = Date.now(),
): boolean {
  const nextAttempt = item.attemptCount + 1;
  const delay = Math.min(RETRY_BASE_MS * 2 ** Math.min(nextAttempt - 1, 16), RETRY_MAX_MS);
  return (
    getDb()
      .prepare(
        `UPDATE remote_writeback_queue
         SET state = 'pending', attempt_count = ?, next_retry_at = ?, lease_id = NULL,
             lease_expires_at = NULL, last_error = ?, updated_at = ?, completed_at = NULL
         WHERE connection_scope = ? AND session_id = ? AND provider = ?
           AND state = 'claimed' AND lease_id = ?`,
      )
      .run(
        nextAttempt,
        now + delay,
        error.slice(0, 1_000),
        now,
        item.connectionScope,
        item.sessionId,
        item.provider,
        leaseId,
      ).changes === 1
  );
}

/**
 * The earliest local retry/recovery for a connection scope, used by the main-process wake-up
 * scheduler. An inherited claimed lease is included so a crash recovers promptly after expiry.
 */
export function getNextRemoteWritebackRetryAt(connectionScope: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT MIN(
         CASE WHEN state = 'claimed' THEN COALESCE(lease_expires_at, next_retry_at)
         ELSE next_retry_at END
       ) AS next_retry_at
       FROM remote_writeback_queue
       WHERE connection_scope = ? AND state IN ('pending', 'claimed')`,
    )
    .get(connectionScope) as { next_retry_at: number | null } | undefined;
  return typeof row?.next_retry_at === 'number' ? row.next_retry_at : null;
}

export function listRemoteWritebacks(sessionId?: string): RemoteWritebackItem[] {
  const rows = (
    sessionId
      ? getDb()
          .prepare('SELECT * FROM remote_writeback_queue WHERE session_id = ? ORDER BY provider')
          .all(sessionId)
      : getDb().prepare('SELECT * FROM remote_writeback_queue ORDER BY created_at, provider').all()
  ) as RemoteWritebackRow[];
  return rows.map(rowToItem);
}
